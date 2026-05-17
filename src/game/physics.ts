import type { Ball, Level, Player, Segment, Vec } from './types';

export const BALL_RADIUS = 10;
const GRAVITY = 720;
const AIR_DRAG = 0.996;
const REST_SPEED = 18;
const REST_TIME = 0.34;
const EPS = 0.00001;
const restTimers = new WeakMap<Ball, number>();

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function updateBall(player: Player, level: Level, dt: number) {
  const ball = player.ball;
  if (ball.inHole) return;
  ball.onGround = false;
  ball.vel.y += GRAVITY * dt;
  ball.vel.x += level.wind * dt;
  for (const fan of level.fans ?? []) {
    if (ball.pos.x > fan.x && ball.pos.x < fan.x + fan.w && ball.pos.y > fan.y && ball.pos.y < fan.y + fan.h) {
      ball.vel.x += fan.force.x * dt;
      ball.vel.y += fan.force.y * dt;
    }
  }
  ball.vel.x *= Math.pow(AIR_DRAG, dt * 60);
  ball.vel.y *= Math.pow(AIR_DRAG, dt * 60);
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

  for (let i = 0; i < 3; i += 1) {
    for (const segment of activeSegments(level)) collideSegment(ball, segment, player.id);
    for (const rect of activeRects(level)) collideRectTop(ball, rect);
  }

  if (ball.pos.x < ball.radius) { ball.pos.x = ball.radius; ball.vel.x = Math.abs(ball.vel.x) * 0.55; }
  if (ball.pos.x > level.width - ball.radius) { ball.pos.x = level.width - ball.radius; ball.vel.x = -Math.abs(ball.vel.x) * 0.55; }
  if (ball.pos.y > level.height + 120) {
    const start = level.starts[player.id] ?? level.starts[0];
    ball.pos = { ...start };
    ball.vel = { x: 0, y: 0 };
  }

  ball.trail.push({ ...ball.pos });
  if (ball.trail.length > 32) ball.trail.shift();

  const cupDistance = Math.hypot(ball.pos.x - level.hole.x, ball.pos.y - level.hole.y);
  if (cupDistance < 22 && len(ball.vel) < 96 && ball.pos.y < level.hole.y + 18) {
    ball.inHole = true;
    ball.moving = false;
    ball.vel = { x: 0, y: 0 };
    ball.pos = { x: level.hole.x, y: level.hole.y + 4 };
    return;
  }

  const speed = len(ball.vel);
  if (speed < REST_SPEED && ball.onGround) {
    const t = (restTimers.get(ball) ?? 0) + dt;
    restTimers.set(ball, t);
    if (t > REST_TIME) {
      ball.vel = { x: 0, y: 0 };
      ball.moving = false;
    }
  } else {
    restTimers.set(ball, 0);
    ball.moving = true;
  }
}

export function activeSegments(level: Level): Segment[] {
  return level.segments.map((s) => {
    if (s.kind === 'moving' && s.switchId && s.moveTo && level.switches.find((sw) => sw.id === s.switchId)?.pressed) {
      return { ...s, a: s.moveTo.a, b: s.moveTo.b };
    }
    return s;
  }).filter((s) => {
    if (!s.switchId || s.kind === 'moving') return true;
    const pressed = !!level.switches.find((sw) => sw.id === s.switchId)?.pressed;
    return s.openWhenPressed ? !pressed : pressed;
  });
}

export function activeRects(level: Level) {
  return level.platforms.filter((rect) => !rect.switchId || level.switches.find((sw) => sw.id === rect.switchId)?.pressed);
}

function collideSegment(ball: Ball, segment: Segment, playerId: number) {
  if (segment.kind === 'hazard' && segment.safeFor?.includes(playerId)) return;
  const ab = sub(segment.b, segment.a);
  const t = clamp(dot(sub(ball.pos, segment.a), ab) / (dot(ab, ab) || 1), 0, 1);
  const closest = add(segment.a, mul(ab, t));
  const delta = sub(ball.pos, closest);
  const distance = len(delta);
  if (distance >= ball.radius || distance < EPS) return;
  let normal = norm(delta);
  if (normal.y > 0.85 && segment.kind !== 'gate') normal = { x: -normal.x, y: -normal.y };
  const penetration = ball.radius - distance;
  ball.pos = add(ball.pos, mul(normal, penetration + 0.2));
  const vn = dot(ball.vel, normal);
  if (vn < 0) {
    const bounce = segment.bounce ?? (segment.kind === 'bumper' ? 1.15 : segment.kind === 'hazard' ? 0.95 : 0.45);
    ball.vel = sub(ball.vel, mul(normal, (1 + bounce) * vn));
    const tangent = { x: -normal.y, y: normal.x };
    const tangentSpeed = dot(ball.vel, tangent);
    const friction = normal.y < -0.35 ? 0.9 : 0.98;
    ball.vel = add(mul(normal, dot(ball.vel, normal)), mul(tangent, tangentSpeed * friction));
  }
  if (normal.y < -0.35) ball.onGround = true;
}

function collideRectTop(ball: Ball, rect: { x: number; y: number; w: number; h: number }) {
  const closestX = clamp(ball.pos.x, rect.x, rect.x + rect.w);
  const closestY = clamp(ball.pos.y, rect.y, rect.y + rect.h);
  const delta = { x: ball.pos.x - closestX, y: ball.pos.y - closestY };
  const distance = len(delta);
  if (distance >= ball.radius || distance < EPS) return;
  const normal = norm(delta.y === 0 && delta.x === 0 ? { x: 0, y: -1 } : delta);
  ball.pos = add(ball.pos, mul(normal, ball.radius - distance + 0.1));
  const vn = dot(ball.vel, normal);
  if (vn < 0) ball.vel = sub(ball.vel, mul(normal, 1.45 * vn));
  if (normal.y < -0.35) {
    ball.onGround = true;
    ball.vel.x *= 0.88;
  }
}

export function updateSwitches(level: Level, players: Player[]) {
  for (const sw of level.switches) {
    const isPressed = players.some((p) => !p.ball.inHole && Math.abs(p.ball.pos.x - (sw.x + sw.w / 2)) < sw.w / 2 + 8 && Math.abs(p.ball.pos.y - sw.y) < 18 && len(p.ball.vel) < 24);
    sw.pressed = isPressed || (players.length === 1 && sw.pressed);
  }
}

export function predictArc(player: Player, level: Level) {
  const points: Vec[] = [];
  let pos = { ...player.ball.pos };
  const radians = (player.angle * Math.PI) / 180;
  let vel = { x: Math.cos(radians) * player.power * 7.2, y: -Math.sin(radians) * player.power * 7.2 };
  for (let i = 0; i < 52; i += 1) {
    vel.y += GRAVITY * 0.035;
    vel.x += level.wind * 0.035;
    vel.x *= 0.996;
    vel.y *= 0.996;
    pos = add(pos, mul(vel, 0.035));
    points.push({ ...pos });
    if (pos.y > level.height || pos.x < 0 || pos.x > level.width) break;
  }
  return points;
}
