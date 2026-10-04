// OWNER: sim
// ARCH.md §4 cup row (physics-notes §4.9, §5; GIMME_RADIUS = 40 per BUILD_DECISIONS D1).
import { describe, expect, it } from 'vitest';
import { stepBall, type StepBallOut } from '../physics';
import { collidersFor, distanceToCup, solidColliders } from '../terrain';
import type { BallState, Level, SimEventType } from '../types';
import { BALL_RADIUS, GIMME_RADIUS, LIP_OUT_DAMP, SINK_INSET, SINK_MAX_SPEED, SUNK_BALL_DROP } from '../types';
import { GROUND_Y, flatLevel } from './fixtures';

const TEE_Y = GROUND_Y - BALL_RADIUS;
const CUP_X = flatLevel.hole.x;

function rolling(x: number, vx: number): BallState {
  return { pos: { x, y: TEE_Y }, vel: { x: vx, y: 0 }, asleep: false, sunk: false, grounded: true, restTicks: 0, lastRest: { x, y: TEE_Y } };
}

/** Steps one ball alone until it sleeps/sinks or `maxTicks`; returns the strokes credited and the events. */
function runAlone(level: Level, ball: BallState, maxTicks = 600): { strokes: number; out: StepBallOut; ticks: number } {
  const out: StepBallOut = { events: [] };
  const colliders = collidersFor(solidColliders(level, {}), 0);
  let strokes = 0;
  let ticks = 0;
  while (ticks < maxTicks && !ball.asleep && !ball.sunk) {
    strokes += stepBall(ball, { level, switches: {}, playerId: 0, colliders, strokes }, out);
    ticks += 1;
  }
  return { strokes, out, ticks };
}

const types = (out: StepBallOut): SimEventType[] => out.events.map((e) => e.type);

describe('cup, sink, gimme', () => {
  it('crossing the cup at 200 px/s sinks (+sink event)', () => {
    const ball = rolling(CUP_X - 100, 200);
    const { out } = runAlone(flatLevel, ball);
    expect(ball.sunk).toBe(true);
    expect(ball.pos).toEqual({ x: CUP_X, y: flatLevel.hole.rimY + SUNK_BALL_DROP });
    expect(ball.vel).toEqual({ x: 0, y: 0 });
    const sink = out.events.find((e) => e.type === 'sink');
    expect(sink).toBeDefined();
    if (sink?.type === 'sink') {
      expect(sink.speed).toBeLessThanOrEqual(SINK_MAX_SPEED);
      expect(sink.strokes).toBe(0);
    }
    expect(types(out)).not.toContain('lipOut');
  });

  it('crossing at 400 px/s lips out (lipOut, vx x 0.8)', () => {
    const ball = rolling(CUP_X - 100, 400);
    const out: StepBallOut = { events: [] };
    const colliders = collidersFor(solidColliders(flatLevel, {}), 0);
    let before: BallState | null = null;
    for (let i = 0; i < 60 && out.events.every((e) => e.type !== 'lipOut'); i += 1) {
      before = { ...ball, vel: { ...ball.vel } };
      stepBall(ball, { level: flatLevel, switches: {}, playerId: 0, colliders }, out);
    }
    const lip = out.events.find((e) => e.type === 'lipOut');
    expect(lip?.type).toBe('lipOut');
    expect(ball.sunk).toBe(false);
    if (lip?.type === 'lipOut') expect(lip.speed).toBeGreaterThan(SINK_MAX_SPEED);
    // vx after the lip-out tick = (velocity the tick would otherwise have produced) * LIP_OUT_DAMP;
    // compare against an undamped twin stepped from the same pre-tick state.
    expect(before).not.toBeNull();
    if (before !== null) {
      const twin: BallState = { ...before, pos: { ...before.pos }, vel: { ...before.vel } };
      const farCup: Level = { ...flatLevel, hole: { ...flatLevel.hole, x: 10 } };
      stepBall(twin, { level: farCup, switches: {}, playerId: 0, colliders }, { events: [] });
      expect(ball.vel.x).toBeCloseTo(twin.vel.x * LIP_OUT_DAMP, 9);
    }
  });

  it('resting 20 px from the cup => gimme, strokes +1 to that ball owner, sunk', () => {
    const ball = rolling(CUP_X - 20, 0);
    const { strokes, out } = runAlone(flatLevel, ball);
    expect(strokes).toBe(1);
    expect(ball.sunk).toBe(true);
    expect(ball.pos).toEqual({ x: CUP_X, y: flatLevel.hole.rimY + SUNK_BALL_DROP });
    expect(types(out)).toEqual(['gimme']);
    const gimme = out.events[0];
    if (gimme?.type === 'gimme') {
      expect(gimme.strokes).toBe(1);
      expect(gimme.pos.x).toBe(CUP_X - 20);
    }
  });

  it('resting 60 px from the cup => nearCup, no stroke', () => {
    const ball = rolling(CUP_X - 60, 0);
    const { strokes, out } = runAlone(flatLevel, ball);
    expect(strokes).toBe(0);
    expect(ball.sunk).toBe(false);
    expect(ball.asleep).toBe(true);
    expect(types(out)).toEqual(['ballRest', 'nearCup']);
    const near = out.events[1];
    if (near?.type === 'nearCup') expect(near.distance).toBeCloseTo(60, 3);
  });

  it('resting at exactly d = GIMME_RADIUS => gimme (inclusive)', () => {
    // A rim exactly at the resting ball's bottom (surface - contact skin) makes d a pure horizontal distance.
    const level: Level = { ...flatLevel, hole: { ...flatLevel.hole, rimY: GROUND_Y - 0.05 } };
    const edge = rolling(CUP_X - GIMME_RADIUS, 0);
    const { strokes, out } = runAlone(level, edge);
    expect(types(out)).toEqual(['gimme']);
    expect(strokes).toBe(1);
    const gimme = out.events[0];
    if (gimme?.type === 'gimme') expect(distanceToCup(level, gimme.pos)).toBe(GIMME_RADIUS);

    const beyond = rolling(CUP_X - GIMME_RADIUS - 0.01, 0);
    const far = runAlone(level, beyond);
    expect(types(far.out)).toEqual(['ballRest', 'nearCup']);
    expect(far.strokes).toBe(0);
  });

  it('an 1100 px/s crossing is detected (swept) and lips out the tick the ball leaves the window', () => {
    const ball = rolling(CUP_X - 100, 1100);
    const out: StepBallOut = { events: [] };
    const colliders = collidersFor(solidColliders(flatLevel, {}), 0);
    let crossedAt = -1;
    let lippedAt = -1;
    for (let i = 0; i < 20 && lippedAt < 0; i += 1) {
      const before = ball.pos.x;
      stepBall(ball, { level: flatLevel, switches: {}, playerId: 0, colliders }, out);
      if (crossedAt < 0 && before < CUP_X && ball.pos.x >= CUP_X) {
        expect(ball.pos.x - before).toBeGreaterThan(flatLevel.hole.radius);
        crossedAt = i;
      }
      if (out.events.some((e) => e.type === 'lipOut')) lippedAt = i;
    }
    expect(crossedAt).toBeGreaterThanOrEqual(0);
    expect(lippedAt).toBeGreaterThanOrEqual(crossedAt);
    expect(lippedAt - crossedAt).toBeLessThanOrEqual(1);
    expect(Math.abs(ball.pos.x - CUP_X)).toBeGreaterThan(flatLevel.hole.radius - SINK_INSET);
    expect(ball.sunk).toBe(false);
    expect(types(out).filter((k) => k === 'lipOut')).toHaveLength(1);
  });

  it('every crossing gets exactly one verdict, sink or lipOut, never a lipOut followed by a sink', () => {
    const window = flatLevel.hole.radius - SINK_INSET;
    let sinks = 0;
    let lips = 0;
    for (let v = 240; v <= 340; v += 5) {
      const ball = rolling(CUP_X - 100, v);
      const { out } = runAlone(flatLevel, ball);
      const verdicts = out.events.filter((e) => e.type === 'sink' || e.type === 'lipOut');
      expect(verdicts, `v=${v}`).toHaveLength(1);
      const verdict = verdicts[0];
      if (verdict?.type === 'sink') {
        sinks += 1;
        expect(ball.sunk).toBe(true);
      } else if (verdict?.type === 'lipOut') {
        lips += 1;
        expect(ball.sunk).toBe(false);
        // reported once the ball is clear of the window, so the damped speed can never sink it there a tick later
        expect(Math.abs(verdict.pos.x - CUP_X)).toBeGreaterThan(window);
      }
    }
    expect(sinks).toBeGreaterThan(0);
    expect(lips).toBeGreaterThan(0);
  });

  it('a slow ball parked over the cup drops in before the rest test can fire', () => {
    const ball = rolling(CUP_X + 5, 0);
    const { out } = runAlone(flatLevel, ball);
    expect(ball.sunk).toBe(true);
    expect(types(out)).toEqual(['sink']);
  });
});
