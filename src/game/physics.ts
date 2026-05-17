import { Ball, Level, Particle, Rect, Segment, Vec } from './types';

export const GRAVITY = 620;
const REST_SPEED = 16;
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

export function stepBall(ball: Ball, level: Level, dt: number, particles: Particle[]) {
  if (ball.sunk) return;
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
  for (let i = 0; i < 3; i += 1) {
    const touchedSegment = collideSegments(ball, level);
    const touchedRect = collideRects(ball, level, particles);
    grounded = grounded || touchedSegment || touchedRect;
  }

  if (ball.pos.x < ball.radius) {
    ball.pos.x = ball.radius;
    ball.vel.x = Math.abs(ball.vel.x) * 0.55;
  }
  if (ball.pos.x > level.width - ball.radius) {
    ball.pos.x = level.width - ball.radius;
    ball.vel.x = -Math.abs(ball.vel.x) * 0.55;
  }
  if (ball.pos.y > level.height + 160) {
    ball.pos = { ...level.starts[ball.playerId] };
    ball.vel = { x: 0, y: 0 };
    ball.asleep = true;
    burst(particles, ball.pos, '#b6f3ff', 12);
  }

  if (grounded) {
    ball.vel.x *= Math.pow(0.72, dt * 6);
    if (Math.abs(ball.vel.y) < 24) ball.vel.y *= 0.35;
  } else {
    ball.vel.x *= Math.pow(0.997, dt * 60);
  }

  const speed = len(ball.vel);
  if (speed < REST_SPEED && grounded) {
    ball.vel = { x: 0, y: 0 };
    ball.asleep = true;
  }

  if (distance(ball.pos, level.hole) < level.hole.radius + 7 && speed < 120) {
    ball.sunk = true;
    ball.asleep = true;
    ball.pos = { x: level.hole.x, y: level.hole.y + 4 };
    ball.vel = { x: 0, y: 0 };
    burst(particles, ball.pos, ball.color, 24);
  }

  ball.trail.push({ ...ball.pos });
  if (ball.trail.length > 24) ball.trail.shift();
}

function collideSegments(ball: Ball, level: Level) {
  let touched = false;
  for (const segment of level.segments) {
    if (!isSegmentActive(segment, level)) continue;
    const closest = closestPointOnSegment(ball.pos, segment.a, segment.b);
    const delta = sub(ball.pos, closest);
    const distanceToLine = len(delta);
    if (distanceToLine >= ball.radius) continue;
    const normal = distanceToLine < EPSILON ? segmentNormal(segment) : normalize(delta);
    resolveCollision(ball, normal, ball.radius - distanceToLine, segment.bounce ?? (segment.kind === 'bumper' ? 1.1 : 0.48));
    touched = true;
  }
  return touched;
}

function collideRects(ball: Ball, level: Level, particles: Particle[]) {
  let touched = false;
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
    const bounce = rect.kind === 'hazard' ? 1.08 : rect.kind === 'spring' ? (rect.bounce ?? 1.45) : rect.kind === 'bumper' ? (rect.bounce ?? 1.25) : 0.45;
    resolveCollision(ball, normal, ball.radius - distanceToRect, bounce);
    if (rect.kind === 'sand') ball.vel = mul(ball.vel, 0.58);
    if (rect.kind === 'spring') ball.vel.y -= 130;
    if (rect.kind === 'hazard') burst(particles, closest, hazardColor(rect.color), 5);
    touched = true;
  }
  return touched;
}

function resolveCollision(ball: Ball, normal: Vec, penetration: number, bounce: number) {
  ball.pos = add(ball.pos, mul(normal, penetration + 0.15));
  const velocityIntoSurface = dot(ball.vel, normal);
  if (velocityIntoSurface < 0) {
    ball.vel = sub(ball.vel, mul(normal, (1 + bounce) * velocityIntoSurface));
    const tangent = { x: -normal.y, y: normal.x };
    const tangentSpeed = dot(ball.vel, tangent);
    ball.vel = sub(ball.vel, mul(tangent, tangentSpeed * 0.035));
  }
}

function closestPointOnSegment(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), EPSILON), 0, 1);
  return add(a, mul(ab, t));
}

function segmentNormal(segment: Segment) {
  const d = sub(segment.b, segment.a);
  return normalize({ x: -d.y, y: d.x });
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
