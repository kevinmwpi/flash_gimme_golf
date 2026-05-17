import type { Ball, Bumper, Fan, Hazard, Rect, Segment, Vec } from './types';

const EPS = 0.00001;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (v: Vec) => Math.hypot(v.x, v.y);
export const norm = (v: Vec): Vec => { const l = len(v); return l < EPS ? { x: 0, y: -1 } : { x: v.x / l, y: v.y / l }; };
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const dist = (a: Vec, b: Vec) => len(sub(a, b));

export function closestPointOnSegment(point: Vec, segment: Segment): Vec {
  const ab = sub(segment.b, segment.a);
  const t = clamp(dot(sub(point, segment.a), ab) / Math.max(EPS, dot(ab, ab)), 0, 1);
  return add(segment.a, mul(ab, t));
}

export function collideBallWithSegment(ball: Ball, segment: Segment): boolean {
  const p = closestPointOnSegment(ball.pos, segment);
  const delta = sub(ball.pos, p);
  const distance = len(delta);
  if (distance >= ball.radius || distance < EPS) return false;
  const normal = norm(delta);
  ball.pos = add(p, mul(normal, ball.radius + 0.1));
  const vn = dot(ball.vel, normal);
  if (vn < 0) {
    ball.vel = sub(ball.vel, mul(normal, (1 + (segment.bounce ?? 0.42)) * vn));
    const tangent = { x: -normal.y, y: normal.x };
    const vt = dot(ball.vel, tangent) * (segment.friction ?? 0.985);
    ball.vel = add(mul(normal, dot(ball.vel, normal)), mul(tangent, vt));
  }
  return true;
}

export function collideBallWithRect(ball: Ball, rect: Rect, bounce = 0.38, friction = 0.98): boolean {
  const closest = { x: clamp(ball.pos.x, rect.x, rect.x + rect.w), y: clamp(ball.pos.y, rect.y, rect.y + rect.h) };
  let delta = sub(ball.pos, closest);
  let distance = len(delta);
  if (distance >= ball.radius) return false;
  if (distance < EPS) {
    const left = Math.abs(ball.pos.x - rect.x);
    const right = Math.abs(rect.x + rect.w - ball.pos.x);
    const top = Math.abs(ball.pos.y - rect.y);
    const bottom = Math.abs(rect.y + rect.h - ball.pos.y);
    const m = Math.min(left, right, top, bottom);
    delta = m === left ? { x: -1, y: 0 } : m === right ? { x: 1, y: 0 } : m === top ? { x: 0, y: -1 } : { x: 0, y: 1 };
    distance = 0;
  }
  const normal = norm(delta);
  ball.pos = add(ball.pos, mul(normal, ball.radius - distance + 0.1));
  const vn = dot(ball.vel, normal);
  if (vn < 0) ball.vel = sub(ball.vel, mul(normal, (1 + bounce) * vn));
  ball.vel.x *= friction;
  return true;
}

export function collideBallWithBumper(ball: Ball, bumper: Bumper): boolean {
  const delta = sub(ball.pos, bumper.center);
  const distance = len(delta);
  const minDistance = ball.radius + bumper.radius;
  if (distance >= minDistance) return false;
  const normal = norm(delta);
  ball.pos = add(bumper.center, mul(normal, minDistance + 0.1));
  const speed = Math.max(len(ball.vel), 230) * bumper.strength;
  ball.vel = mul(normal, speed);
  return true;
}

export function applyFan(ball: Ball, fan: Fan, dt: number) {
  if (ball.pos.x > fan.rect.x && ball.pos.x < fan.rect.x + fan.rect.w && ball.pos.y > fan.rect.y && ball.pos.y < fan.rect.y + fan.rect.h) {
    ball.vel.x += fan.force.x * dt;
    ball.vel.y += fan.force.y * dt;
  }
}

export function resolveHazard(ball: Ball, hazard: Hazard, playerId: number): boolean {
  if (playerId === hazard.safePlayer) return false;
  if (hazard.mode === 'block') return collideBallWithRect(ball, hazard.rect, 0.65, 0.96);
  const hit = collideBallWithRect(ball, hazard.rect, 0.92, 0.99);
  if (hit) ball.vel.y -= 90;
  return hit;
}

export function integrateBall(ball: Ball, dt: number, wind: number) {
  if (ball.inHole) return;
  ball.vel.x += wind * dt;
  ball.vel.y += 620 * dt;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.vel.x *= 0.999;
  ball.vel.y *= 0.999;
  if (len(ball.vel) > 18) ball.stopped = false;
}

export function updateRest(ball: Ball, dt: number) {
  const speed = len(ball.vel);
  if (speed < 16) {
    ball.restTime += dt;
    ball.vel.x *= 0.9;
    ball.vel.y *= 0.9;
    if (ball.restTime > 0.45) {
      ball.stopped = true;
      ball.vel = { x: 0, y: 0 };
    }
  } else {
    ball.restTime = 0;
    ball.stopped = false;
  }
}
