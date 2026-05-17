import { Ball, Level, Particle, Rect, Segment, Vec } from './types';

const GRAVITY = 720;
const AIR_DRAG = 0.997;
const REST_SPEED = 12;
const REST_FRAMES = 28;

const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec) => Math.hypot(v.x, v.y);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const norm = (v: Vec): Vec => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};

export function rectToSegments(rect: Rect): Segment[] {
  if (rect.active === false && rect.kind !== 'bridge') return [];
  if (rect.kind === 'bridge' && rect.active === false) return [];
  const { x, y, w, h } = rect;
  const common = { id: rect.id, kind: rect.kind, color: rect.color, active: rect.active, safePlayers: rect.safePlayers, bounce: rect.bounce };
  return [
    { a: { x, y }, b: { x: x + w, y }, ...common },
    { a: { x: x + w, y }, b: { x: x + w, y: y + h }, ...common },
    { a: { x: x + w, y: y + h }, b: { x, y: y + h }, ...common },
    { a: { x, y: y + h }, b: { x, y }, ...common },
  ];
}

function collideSegment(ball: Ball, segment: Segment, particles: Particle[]) {
  if (segment.active === false) return;
  if (segment.kind === 'hazard' && segment.safePlayers?.includes(ball.playerId)) return;
  const ab = sub(segment.b, segment.a);
  const t = clamp(dot(sub(ball.pos, segment.a), ab) / Math.max(dot(ab, ab), 0.0001), 0, 1);
  const closest = { x: segment.a.x + ab.x * t, y: segment.a.y + ab.y * t };
  const delta = sub(ball.pos, closest);
  const distance = len(delta);
  if (distance >= ball.radius || distance === 0) return;

  const normal = norm(delta);
  const penetration = ball.radius - distance;
  ball.pos.x += normal.x * (penetration + 0.2);
  ball.pos.y += normal.y * (penetration + 0.2);

  const intoSurface = dot(ball.vel, normal);
  if (intoSurface < 0) {
    const bounce = segment.bounce ?? (segment.kind === 'bumper' ? 1.08 : 0.48);
    ball.vel.x -= (1 + bounce) * intoSurface * normal.x;
    ball.vel.y -= (1 + bounce) * intoSurface * normal.y;
    const tangent = { x: -normal.y, y: normal.x };
    const tangentSpeed = dot(ball.vel, tangent) * (segment.friction ?? 0.985);
    ball.vel.x = normal.x * Math.max(0, dot(ball.vel, normal)) + tangent.x * tangentSpeed;
    ball.vel.y = normal.y * Math.max(0, dot(ball.vel, normal)) + tangent.y * tangentSpeed;
    if (Math.abs(intoSurface) > 90) {
      for (let i = 0; i < 5; i += 1) {
        particles.push({ pos: { ...closest }, vel: { x: (Math.random() - 0.5) * 90, y: -Math.random() * 80 }, life: 0.45, color: segment.color ?? '#fff2c7', size: 3 + Math.random() * 3 });
      }
    }
  }
}

export function stepBall(ball: Ball, level: Level, dt: number, particles: Particle[]) {
  if (ball.sunk) return;
  ball.vel.x += level.wind * dt;
  ball.vel.y += GRAVITY * dt;
  ball.vel.x *= AIR_DRAG;
  ball.vel.y *= AIR_DRAG;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

  const segments = [...level.terrain, ...level.rects.flatMap(rectToSegments)];
  for (let i = 0; i < 3; i += 1) {
    for (const segment of segments) collideSegment(ball, segment, particles);
  }

  if (ball.pos.y > level.height + 120) {
    ball.pos.x = level.spawns[ball.playerId % level.spawns.length].x;
    ball.pos.y = level.spawns[ball.playerId % level.spawns.length].y - 50;
    ball.vel = { x: 0, y: 0 };
  }

  ball.trail.unshift({ ...ball.pos });
  ball.trail = ball.trail.slice(0, 18);

  if (Math.hypot(ball.vel.x, ball.vel.y) < REST_SPEED) {
    ball.vel.x *= 0.88;
    ball.vel.y *= 0.88;
    ball.restingFrames += 1;
  } else {
    ball.restingFrames = 0;
  }
  ball.moving = ball.restingFrames < REST_FRAMES;
}

export function isBallStopped(ball: Ball) {
  return !ball.sunk && ball.restingFrames >= REST_FRAMES;
}

export function predictPath(start: Vec, angleDeg: number, power: number, wind: number, steps = 46): Vec[] {
  const rad = (angleDeg * Math.PI) / 180;
  const pos = { ...start };
  const vel = { x: Math.cos(rad) * power * 8.2, y: -Math.sin(rad) * power * 8.2 };
  const points: Vec[] = [];
  for (let i = 0; i < steps; i += 1) {
    vel.x += wind * 0.035;
    vel.y += GRAVITY * 0.035;
    vel.x *= AIR_DRAG;
    vel.y *= AIR_DRAG;
    pos.x += vel.x * 0.035;
    pos.y += vel.y * 0.035;
    if (i % 2 === 0) points.push({ ...pos });
  }
  return points;
}

export function updateSwitches(level: Level, balls: Ball[]) {
  for (const sw of level.switches) {
    sw.pressed = balls.some((ball) => !ball.sunk && ball.restingFrames > 12 && ball.pos.x > sw.x - ball.radius && ball.pos.x < sw.x + sw.w + ball.radius && ball.pos.y > sw.y - 22 && ball.pos.y < sw.y + sw.h + 22);
    for (const target of level.rects.filter((rect) => sw.targetIds.includes(rect.id ?? ''))) {
      if (!target.base) target.base = { x: target.x, y: target.y, w: target.w, h: target.h };
      const destination = sw.pressed && target.movesTo ? target.movesTo : target.base;
      target.x += (destination.x - target.x) * 0.18;
      target.y += (destination.y - target.y) * 0.18;
      target.w += (destination.w - target.w) * 0.18;
      target.h += (destination.h - target.h) * 0.18;
      target.active = sw.pressed || target.kind === 'gate';
      if (target.kind === 'gate') target.active = true;
    }
  }
}

export function stepParticles(particles: Particle[], dt: number) {
  for (const particle of particles) {
    particle.life -= dt;
    particle.vel.y += 220 * dt;
    particle.pos.x += particle.vel.x * dt;
    particle.pos.y += particle.vel.y * dt;
  }
  return particles.filter((particle) => particle.life > 0);
}
