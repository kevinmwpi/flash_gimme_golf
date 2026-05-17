import { Ball, Golfer, GroundBlock, Level, Particle, Rect, Segment, Vec } from './types';
import { isOverHole, surfaceNormalAt, surfaceYAt } from './terrain';

export const GRAVITY = 620;
const REST_SPEED = 20;
const GROUND_ROLL_DAMP = 0.992;
const SAND_ROLL_DAMP = 0.91;
const SLOPE_GRAVITY_SCALE = 0.85;
const EPSILON = 0.0001;

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (v: Vec) => Math.hypot(v.x, v.y);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const normalize = (v: Vec): Vec => {
  const length = len(v);
  return length < EPSILON ? { x: 0, y: -1 } : { x: v.x / length, y: v.y / length };
};
export const distance = (a: Vec, b: Vec) => len(sub(a, b));

export function isRectActive(rect: Rect, level: Level) {
  if (!rect.switchId) return true;
  const pressed = level.switches.find((item) => item.id === rect.switchId)?.pressed ?? false;
  return pressed === (rect.activeWhen ?? true);
}

export function isSegmentActive(segment: Segment, level: Level) {
  if (!segment.switchId) return true;
  const pressed = level.switches.find((item) => item.id === segment.switchId)?.pressed ?? false;
  return pressed === (segment.activeWhen ?? true);
}

export function updateSwitches(level: Level, balls: Ball[]) {
  for (const sw of level.switches) {
    sw.pressed = balls.some((ball) => !ball.sunk && ball.asleep && circleRectOverlap(ball.pos, ball.radius + 2, sw));
  }
}

export function updateGolferApproach(golfer: Golfer, ball: Ball, level: Level, dt: number) {
  if (ball.sunk) {
    golfer.ready = false;
    return;
  }
  const facing = ball.pos.x >= golfer.pos.x ? 1 : -1;
  const targetX = ball.pos.x - 24 * facing;
  const surface = surfaceYAt(level, targetX);
  const targetY = surface !== null ? surface - ball.radius - 20 : ball.pos.y - ball.radius - 20;
  const dx = targetX - golfer.pos.x;
  const dy = targetY - golfer.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) {
    golfer.pos = { x: targetX, y: targetY };
    golfer.facing = facing;
    golfer.ready = true;
    return;
  }
  const speed = 220;
  golfer.pos.x += (dx / dist) * speed * dt;
  golfer.pos.y += (dy / dist) * speed * dt;
  golfer.facing = facing;
  golfer.ready = false;
}

export function stepBall(ball: Ball, level: Level, dt: number, particles: Particle[]) {
  if (ball.sunk) return;
  if (ball.sinking) {
    stepBallIntoCup(ball, level, dt, particles);
    return;
  }

  ball.prevPos = { ...ball.pos };
  ball.asleep = false;

  ball.vel.x += level.wind * dt;
  ball.vel.y += GRAVITY * dt;
  for (const rect of level.rects) {
    if (rect.kind === 'fan' && isRectActive(rect, level) && circleRectOverlap(ball.pos, ball.radius + 15, rect)) {
      ball.vel.y -= 920 * dt;
      ball.vel.x += 40 * dt;
    }
  }

  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

  let grounded = false;
  let onSand = false;
  for (let i = 0; i < 4; i += 1) {
    grounded = collideBlocks(ball, level.blocks) || grounded;
    grounded = collideRamps(ball, level) || grounded;
    const rectHit = collideRects(ball, level, particles);
    grounded = grounded || rectHit.grounded;
    onSand = onSand || rectHit.onSand;
  }

  const bounds = level.width;
  if (ball.pos.x < ball.radius) {
    ball.pos.x = ball.radius;
    ball.vel.x = Math.abs(ball.vel.x) * 0.5;
  }
  if (ball.pos.x > bounds - ball.radius) {
    ball.pos.x = bounds - ball.radius;
    ball.vel.x = -Math.abs(ball.vel.x) * 0.5;
  }
  if (ball.pos.y > level.height + 200) {
    const startX = level.starts[ball.playerId]?.x ?? 100;
    const surface = surfaceYAt(level, startX);
    ball.pos = { x: startX, y: (surface ?? 560) - ball.radius };
    ball.vel = { x: 0, y: 0 };
    ball.asleep = true;
    burst(particles, ball.pos, '#b6f3ff', 12);
    return;
  }

  if (grounded) {
    const normal = surfaceNormalAt(level, ball.pos.x);
    const tangent = { x: -normal.y, y: normal.x };
    const gTan = dot({ x: 0, y: GRAVITY }, tangent) * SLOPE_GRAVITY_SCALE;
    ball.vel.x += tangent.x * gTan * dt;
    ball.vel.y += tangent.y * gTan * dt;
    const rollDamp = onSand ? SAND_ROLL_DAMP : GROUND_ROLL_DAMP;
    const damp = Math.pow(rollDamp, dt * 60);
    ball.vel.x *= damp;
    ball.vel.y *= damp;
    const tangentSpeed = dot(ball.vel, tangent);
    ball.vel.x -= tangent.x * tangentSpeed * (1 - damp);
    ball.vel.y -= tangent.y * tangentSpeed * (1 - damp);
  } else {
    ball.vel.x *= Math.pow(0.998, dt * 60);
  }

  const speed = len(ball.vel);
  if (speed < REST_SPEED && grounded) {
    ball.vel = { x: 0, y: 0 };
    ball.asleep = true;
  }

  if (!ball.sunk && !ball.sinking && isOverHole(level, ball.pos, ball.radius) && speed < 150) {
    ball.sinking = true;
    ball.sinkT = 0;
    ball.asleep = false;
  }

  ball.trail.push({ ...ball.pos });
  if (ball.trail.length > 24) ball.trail.shift();
}

function stepBallIntoCup(ball: Ball, level: Level, dt: number, particles: Particle[]) {
  const { hole } = level;
  ball.sinkT += dt;
  ball.pos.x += (hole.x - ball.pos.x) * Math.min(1, 6 * dt);
  ball.pos.y += 95 * dt;
  ball.vel = mul(ball.vel, 0.82);
  if (ball.pos.y >= hole.y + hole.depth || ball.sinkT > 0.55) {
    ball.sunk = true;
    ball.sinking = false;
    ball.pos = { x: hole.x, y: hole.y + hole.depth * 0.5 };
    ball.vel = { x: 0, y: 0 };
    ball.asleep = true;
    burst(particles, { x: hole.x, y: hole.rimY }, ball.color, 28);
  }
}

function collideBlocks(ball: Ball, blocks: GroundBlock[]): boolean {
  let grounded = false;
  for (const block of blocks) {
    const cx = ball.pos.x;
    const cy = ball.pos.y;
    const r = ball.radius;
    if (cx + r < block.x || cx - r > block.x + block.w) continue;

    const top = block.y;
    const onTop = cy + r > top && cy + r < top + 28 && ball.vel.y >= -30;
    if (onTop && cx >= block.x - 4 && cx <= block.x + block.w + 4) {
      ball.pos.y = top - r;
      if (ball.vel.y > 0) ball.vel.y *= -0.35;
      const tangent = { x: 1, y: 0 };
      const vt = dot(ball.vel, tangent);
      ball.vel.x -= tangent.x * vt * 0.08;
      grounded = true;
      continue;
    }

    if (cy - r < block.y + block.h && cy + r > block.y) {
      if (cx < block.x && cx + r > block.x) {
        ball.pos.x = block.x - r;
        ball.vel.x = -Math.abs(ball.vel.x) * 0.45;
        grounded = true;
      } else if (cx > block.x + block.w && cx - r < block.x + block.w) {
        ball.pos.x = block.x + block.w + r;
        ball.vel.x = Math.abs(ball.vel.x) * 0.45;
        grounded = true;
      }
    }
  }
  return grounded;
}

function collideRamps(ball: Ball, level: Level): boolean {
  let touched = false;
  for (const segment of level.segments) {
    if (segment.kind !== 'ramp' || !isSegmentActive(segment, level)) continue;
    const closest = closestPointOnSegment(ball.pos, segment.a, segment.b);
    const delta = sub(ball.pos, closest);
    const distanceToLine = len(delta);
    if (distanceToLine >= ball.radius) continue;
    const normal = distanceToLine < EPSILON ? segmentNormal(segment) : normalize(delta);
    if (normal.y > 0) normal.y = -normal.y;
    resolveCollision(ball, normal, ball.radius - distanceToLine, segment.bounce ?? 0.42);
    touched = true;
  }
  return touched;
}

function collideRects(ball: Ball, level: Level, particles: Particle[]) {
  let grounded = false;
  let onSand = false;
  for (const rect of level.rects) {
    if (!isRectActive(rect, level)) continue;
    if (rect.kind === 'hazard' && rect.color === ball.safeColor) continue;
    const liveRect = liveRectPosition(rect, level);
    const closest = {
      x: clamp(ball.pos.x, liveRect.x, liveRect.x + liveRect.w),
      y: clamp(ball.pos.y, liveRect.y, liveRect.y + liveRect.h),
    };
    const delta = sub(ball.pos, closest);
    const distanceToRect = len(delta);
    if (distanceToRect >= ball.radius) continue;
    const normal = distanceToRect < EPSILON ? rectEscapeNormal(ball, liveRect) : normalize(delta);
    const bounce = rect.kind === 'hazard' ? 1.05 : rect.kind === 'spring' ? (rect.bounce ?? 1.4) : rect.kind === 'bumper' ? (rect.bounce ?? 1.2) : 0.4;
    resolveCollision(ball, normal, ball.radius - distanceToRect, bounce);
    if (rect.kind === 'sand') onSand = true;
    if (rect.kind === 'spring') {
      ball.vel.y -= 160;
      ball.vel.x += (ball.pos.x < liveRect.x + liveRect.w / 2 ? -1 : 1) * 40;
    }
    if (rect.kind === 'hazard') burst(particles, closest, hazardColor(rect.color), 5);
    if (rect.kind === 'bridge' || rect.kind === 'gate') grounded = true;
    if (rect.kind === 'sand' || rect.kind === 'bumper') grounded = true;
  }
  return { grounded, onSand };
}

function resolveCollision(ball: Ball, normal: Vec, penetration: number, bounce: number) {
  ball.pos = add(ball.pos, mul(normal, penetration + 0.1));
  const velocityIntoSurface = dot(ball.vel, normal);
  if (velocityIntoSurface < 0) {
    ball.vel = sub(ball.vel, mul(normal, (1 + bounce) * velocityIntoSurface));
    const tangent = { x: -normal.y, y: normal.x };
    const tangentSpeed = dot(ball.vel, tangent);
    ball.vel = sub(ball.vel, mul(tangent, tangentSpeed * 0.06));
  }
}

function closestPointOnSegment(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), EPSILON), 0, 1);
  return add(a, mul(ab, t));
}

function segmentNormal(segment: Segment) {
  const d = sub(segment.b, segment.a);
  const n = normalize({ x: -d.y, y: d.x });
  if (n.y > 0) return { x: -n.x, y: -n.y };
  return n;
}

function rectEscapeNormal(ball: Ball, rect: Rect) {
  const left = Math.abs(ball.pos.x - rect.x);
  const right = Math.abs(ball.pos.x - (rect.x + rect.w));
  const top = Math.abs(ball.pos.y - rect.y);
  const bottom = Math.abs(ball.pos.y - (rect.y + rect.h));
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { x: -1, y: 0 };
  if (min === right) return { x: 1, y: 0 };
  if (min === top) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function liveRectPosition(rect: Rect, level: Level) {
  if (!rect.switchId || (!rect.vx && !rect.vy)) return rect;
  const pressed = level.switches.find((sw) => sw.id === rect.switchId)?.pressed ?? false;
  return pressed ? { ...rect, x: rect.x + (rect.vx ?? 0), y: rect.y + (rect.vy ?? 0) } : rect;
}

function circleRectOverlap(pos: Vec, radius: number, rect: { x: number; y: number; w: number; h: number }) {
  const cx = clamp(pos.x, rect.x, rect.x + rect.w);
  const cy = clamp(pos.y, rect.y, rect.y + rect.h);
  return Math.hypot(pos.x - cx, pos.y - cy) <= radius;
}

export function predictArc(start: Vec, angle: number, power: number, wind: number) {
  const points: Vec[] = [];
  const speed = power * 8.8;
  const velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  const pos = { ...start };
  for (let i = 0; i < 80; i += 1) {
    velocity.x += wind * 0.035;
    velocity.y += GRAVITY * 0.035;
    pos.x += velocity.x * 0.035;
    pos.y += velocity.y * 0.035;
    if (i % 3 === 0) points.push({ ...pos });
  }
  return points;
}

export function burst(particles: Particle[], pos: Vec, color: string, amount: number) {
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 45 + Math.random() * 180;
    particles.push({
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.45 + Math.random() * 0.4,
      maxLife: 0.85,
      color,
      size: 2 + Math.random() * 4,
    });
  }
}

function hazardColor(color?: string) {
  if (color === 'red') return '#ff4f6d';
  if (color === 'blue') return '#45b5ff';
  if (color === 'green') return '#6bed77';
  return '#ffe66d';
}
