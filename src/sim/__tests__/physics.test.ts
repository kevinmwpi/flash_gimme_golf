// OWNER: sim
// ARCH.md §4 physics row (physics-notes §3-§4). The level registry is mocked with the fixtures so
// `stepSim` can drive a real shot for the predictShot parity rows.
import { describe, expect, it, vi } from 'vitest';
import { launchVelocity, predictShot, stepBall, type StepBallOut } from '../physics';
import { createSim, stepSim } from '../sim';
import { collidersFor, groundAt, hasSupport, pointInPiece, restsOnPermanentGround, solidColliders, surfaceYOnPiece } from '../terrain';
import type { Aim, BallState, Level, PlayerId, SimEventType, SimState } from '../types';
import {
  BALL_RADIUS,
  BUMPER_SPEED,
  CEILING_Y,
  DT,
  FAN_FORCE,
  FAN_MAX_LIFT,
  GRAVITY,
  MAX_BALL_SPEED,
  REST_MAX_SLOPE,
  ROLL_FRICTION,
} from '../types';
import {
  BRIDGE_H,
  BRIDGE_X1,
  BRIDGE_X2,
  GROUND_Y,
  OVERHANG_BASE_Y,
  SPRING_LAUNCH,
  blockerLevel,
  cliffLevel,
  fanLevel,
  fixtureConfig,
  flatLevel,
  gapBridgeLevel,
  gateLevel,
  overhangLevel,
  sandSpringBumperLevel,
  slopeLevel,
} from './fixtures';

vi.mock('../levels/index', async () => (await import('./fixtures')).fixtureRegistry);

const TEE_Y = GROUND_Y - BALL_RADIUS;
const NONE: Record<string, boolean> = {};

function ball(x: number, y: number, vx = 0, vy = 0, grounded = false): BallState {
  return { pos: { x, y }, vel: { x: vx, y: vy }, asleep: false, sunk: false, grounded, restTicks: 0, lastRest: { x, y } };
}

type Run = { ball: BallState; out: StepBallOut; strokes: number; ticks: number; trace: BallState[] };

/** Steps one ball alone (other ball absent) until asleep/sunk or maxTicks, recording a copy per tick. */
function runAlone(level: Level, b: BallState, playerId: PlayerId, maxTicks: number, switches = NONE): Run {
  const out: StepBallOut = { events: [] };
  const colliders = collidersFor(solidColliders(level, switches), playerId);
  const trace: BallState[] = [];
  let strokes = 0;
  let ticks = 0;
  while (ticks < maxTicks && !b.asleep && !b.sunk) {
    strokes += stepBall(b, { level, switches, playerId, colliders }, out);
    trace.push({ ...b });
    ticks += 1;
  }
  return { ball: b, out, strokes, ticks, trace };
}

const eventTypes = (out: StepBallOut): SimEventType[] => out.events.map((e) => e.type);
const speedOf = (b: BallState): number => Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);

const PHASES = 28;
const SPEEDS = [600, 900, 1100];
const ALL_HELD = { near: true, far: false, deck: false };

describe('physics', () => {
  it('no tunnelling: 28 phase offsets x speeds {600, 900, 1100} dropped on a 16 px bridge, on terrain and against an overhang base => never below/inside', () => {
    const bridgeTop = GROUND_Y;
    const bridgeMidX = (BRIDGE_X1 + BRIDGE_X2) / 2;
    for (const speed of SPEEDS) {
      for (let k = 0; k < PHASES; k += 1) {
        const offset = (k / PHASES) * (speed * DT);
        for (const dir of [{ x: 0, y: 1 }, { x: 0.5, y: 0.8660254 }]) {
          // bridge slab (gap below it): never below its top, never inside the slab
          const onBridge = runAlone(gapBridgeLevel, ball(bridgeMidX - 40 * dir.x, bridgeTop - BALL_RADIUS - 30 - offset, speed * dir.x, speed * dir.y), 0, 12, ALL_HELD);
          for (const t of onBridge.trace) {
            if (t.pos.x >= BRIDGE_X1 && t.pos.x <= BRIDGE_X2) {
              expect(t.pos.y + BALL_RADIUS, `bridge speed ${speed} phase ${k}`).toBeLessThanOrEqual(bridgeTop + 1e-9);
              expect(t.pos.y + BALL_RADIUS, `bridge slab speed ${speed} phase ${k}`).not.toBeGreaterThan(bridgeTop + BRIDGE_H);
            }
          }
          // flat terrain
          const onGround = runAlone(flatLevel, ball(600, TEE_Y - 30 - offset, speed * dir.x, speed * dir.y), 0, 12);
          for (const t of onGround.trace) {
            expect(t.pos.y + BALL_RADIUS, `terrain speed ${speed} phase ${k}`).toBeLessThanOrEqual(GROUND_Y + 1e-9);
            expect(pointInPiece(flatLevel.terrain.pieces[0] as never, t.pos)).toBe(false);
          }
          // overhang base, shot upward from below
          const underhang = runAlone(overhangLevel, ball(800, OVERHANG_BASE_Y + BALL_RADIUS + 30 + offset, speed * dir.x, -speed * dir.y), 0, 12);
          for (const t of underhang.trace) {
            if (t.pos.x >= 700 && t.pos.x <= 900) expect(t.pos.y - BALL_RADIUS, `overhang speed ${speed} phase ${k}`).toBeGreaterThanOrEqual(OVERHANG_BASE_Y - 1e-9);
            for (const piece of overhangLevel.terrain.pieces) expect(pointInPiece(piece, t.pos)).toBe(false);
          }
        }
      }
    }
  });

  it('energy bound: 600 ticks on a bumper and on a spring => len(vel) <= MAX_BALL_SPEED and y >= CEILING_Y', () => {
    for (const x of [1230, 930]) {
      const b = ball(x, 300);
      const out: StepBallOut = { events: [] };
      const colliders = collidersFor(solidColliders(sandSpringBumperLevel, NONE), 0);
      for (let i = 0; i < 600; i += 1) {
        stepBall(b, { level: sandSpringBumperLevel, switches: NONE, playerId: 0, colliders }, out);
        expect(speedOf(b)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
        expect(b.pos.y).toBeGreaterThanOrEqual(CEILING_Y);
      }
      expect(b.asleep || b.sunk).toBe(true);
    }
  });

  it('a 300 px/s roll on flat grass stops after 400-700 px', () => {
    const b = ball(200, TEE_Y, 300, 0, true);
    const run = runAlone(flatLevel, b, 0, 2000);
    expect(b.asleep).toBe(true);
    expect(b.pos.x - 200).toBeGreaterThan(400);
    expect(b.pos.x - 200).toBeLessThan(700);
    expect(eventTypes(run.out)).toEqual(['ballRest']);
    expect(b.pos).toEqual({ x: Math.round(b.pos.x * 100) / 100, y: Math.round(b.pos.y * 100) / 100 });
  });

  it('the friction floor ends the slow tail: a 72 px/s roll stops within 1 s and 40 px, 36 px/s within 0.5 s', () => {
    const slow = ball(200, TEE_Y, 72, 0, true);
    const slowRun = runAlone(flatLevel, slow, 0, 600);
    expect(slow.asleep).toBe(true);
    expect(slowRun.ticks).toBeLessThanOrEqual(60);
    expect(slow.pos.x - 200).toBeLessThan(40);
    const creep = ball(200, TEE_Y, 36, 0, true);
    const creepRun = runAlone(flatLevel, creep, 0, 600);
    expect(creep.asleep).toBe(true);
    expect(creepRun.ticks).toBeLessThanOrEqual(30);
    // never reverses: a ball slower than the per-tick loss only loses speed, it is never pushed backwards
    const crawl = (ROLL_FRICTION * DT) / 2;
    const still = ball(200, TEE_Y, crawl, 0, true);
    stepBall(still, { level: flatLevel, switches: NONE, playerId: 0, colliders: collidersFor(solidColliders(flatLevel, NONE), 0) }, { events: [] });
    expect(still.vel.x).toBeGreaterThanOrEqual(0);
    expect(still.vel.x).toBeLessThan(crawl);
  });

  it('rest never happens on a slope > 15 degrees', () => {
    const piece = slopeLevel.terrain.pieces[0];
    if (piece === undefined) throw new Error('fixture');
    for (const x0 of [450, 480, 950, 1100, 1250]) {
      const y0 = surfaceYOnPiece(piece, x0);
      if (y0 === null) throw new Error('fixture');
      const b = ball(x0, y0 - BALL_RADIUS - 1);
      runAlone(slopeLevel, b, 0, 3000);
      expect(b.asleep).toBe(true);
      const slope = groundAt(slopeLevel, NONE, b.pos, 0)?.slope ?? Number.POSITIVE_INFINITY;
      expect(slope).toBeLessThan(REST_MAX_SLOPE);
    }
  });

  it('a ball on a 70 degree face starts rolling', () => {
    const piece = slopeLevel.terrain.pieces[0];
    if (piece === undefined) throw new Error('fixture');
    const y0 = surfaceYOnPiece(piece, 450);
    if (y0 === null) throw new Error('fixture');
    const b = ball(450, y0 - BALL_RADIUS - 0.5, 0, 0, true);
    const run = runAlone(slopeLevel, b, 0, 60);
    expect(run.ticks).toBe(60);
    expect(b.asleep).toBe(false);
    expect(b.pos.x).toBeLessThan(440);
    expect(speedOf(b)).toBeGreaterThan(100);
  });

  it('a ball creeping off a blocker top corner never sleeps or records lastRest unsupported, then rests on the fairway', () => {
    const wallRight = 1240;
    const wallTop = GROUND_Y - 160;
    for (const d of [0.3, 1, 1.3]) {
      const b = { ...ball(wallRight + d, wallTop - Math.sqrt(BALL_RADIUS * BALL_RADIUS - d * d), 0, 0, true), lastRest: { x: 100, y: TEE_Y } };
      const run = runAlone(blockerLevel, b, 0, 600);
      for (const t of run.trace) {
        if (t.asleep) expect(hasSupport(blockerLevel, NONE, t, 0), `d=${d} asleep at (${t.pos.x}, ${t.pos.y})`).toBe(true);
        expect(restsOnPermanentGround(blockerLevel, NONE, t.lastRest, 0) && hasSupport(blockerLevel, NONE, { ...t, pos: t.lastRest }, 0)).toBe(true);
      }
      for (const e of run.out.events) {
        if (e.type === 'ballRest') expect(hasSupport(blockerLevel, NONE, { ...b, pos: e.pos }, 0), `d=${d} ballRest at (${e.pos.x}, ${e.pos.y})`).toBe(true);
      }
      expect(b.asleep).toBe(true);
      expect(b.pos.y).toBeCloseTo(GROUND_Y - BALL_RADIUS, 1);
      expect(eventTypes(run.out).filter((type) => type === 'ballRest')).toHaveLength(1);
    }
  });

  it('cliff: never inside, pointInPiece false every tick, respawn count 0', () => {
    const piece = cliffLevel.terrain.pieces[0];
    if (piece === undefined) throw new Error('fixture');
    const b = ball(900, 648 - BALL_RADIUS, 300, 100, true);
    const run = runAlone(cliffLevel, b, 0, 1200);
    for (const t of run.trace) {
      expect(pointInPiece(piece, t.pos)).toBe(false);
      expect(t.pos.x).toBeLessThanOrEqual(946 + 1e-9);
    }
    expect(b.asleep).toBe(true);
    expect(run.strokes).toBe(0);
    expect(eventTypes(run.out)).not.toContain('fellOffWorld');
    expect(run.out.events.some((e) => e.type === 'bounce' && e.surface === 'dirtWall')).toBe(true);
  });

  it('wrong colour bounces + hazardBlock; right colour passes + gatePass', () => {
    const red = runAlone(gateLevel, ball(500, TEE_Y, 300, 0, true), 0, 1200);
    expect(red.ball.pos.x).toBeGreaterThan(740);
    expect(eventTypes(red.out)).toContain('gatePass');
    const pass = red.out.events.find((e) => e.type === 'gatePass');
    if (pass?.type === 'gatePass') expect(pass).toMatchObject({ rectId: 'gate-red', colour: 'red', playerId: 0 });

    const blue = runAlone(gateLevel, ball(500, TEE_Y, 300, 0, true), 1, 1200);
    expect(blue.ball.pos.x).toBeLessThan(700 - BALL_RADIUS);
    expect(eventTypes(blue.out)).toContain('hazardBlock');
    expect(eventTypes(blue.out)).not.toContain('gatePass');
    const block = blue.out.events.find((e) => e.type === 'hazardBlock');
    if (block?.type === 'hazardBlock') expect(block).toMatchObject({ rectId: 'gate-red', colour: 'red', playerId: 1 });
  });

  it('sand: landing with vy 400 => vOut 0 (restitution decided before the bounce); a 300 px/s roll stops within 150 px', () => {
    const landing = ball(600, 400, 0, 400);
    const out: StepBallOut = { events: [] };
    const colliders = collidersFor(solidColliders(sandSpringBumperLevel, NONE), 0);
    let landedTick = -1;
    for (let i = 0; i < 60 && landedTick < 0; i += 1) {
      stepBall(landing, { level: sandSpringBumperLevel, switches: NONE, playerId: 0, colliders }, out);
      if (landing.grounded) landedTick = i;
    }
    expect(landedTick).toBeGreaterThan(0);
    expect(landing.vel.y).toBe(0);
    expect(eventTypes(out)).toContain('enterSand');

    const roll = runAlone(sandSpringBumperLevel, ball(400, TEE_Y, 300, 0, true), 0, 1200);
    expect(roll.ball.asleep).toBe(true);
    expect(roll.ball.pos.x).toBeGreaterThan(500);
    expect(roll.ball.pos.x - 500).toBeLessThan(150);
    expect(eventTypes(roll.out).filter((t) => t === 'enterSand')).toHaveLength(1);
  });

  it('spring, bumper and fan are implemented although World 1 does not use them (D2)', () => {
    const colliders = collidersFor(solidColliders(sandSpringBumperLevel, NONE), 0);
    const onSpring = ball(930, 300);
    const springOut: StepBallOut = { events: [] };
    for (let i = 0; i < 60 && springOut.events.every((e) => e.type !== 'spring'); i += 1) {
      stepBall(onSpring, { level: sandSpringBumperLevel, switches: NONE, playerId: 0, colliders }, springOut);
    }
    const spring = springOut.events.find((e) => e.type === 'spring');
    expect(spring?.type).toBe('spring');
    if (spring?.type === 'spring') expect(spring.launch).toEqual(SPRING_LAUNCH);
    expect(onSpring.grounded).toBe(false);

    const onBumper = ball(1230, 300);
    const bumperOut: StepBallOut = { events: [] };
    for (let i = 0; i < 60 && bumperOut.events.every((e) => e.type !== 'bumper'); i += 1) {
      stepBall(onBumper, { level: sandSpringBumperLevel, switches: NONE, playerId: 0, colliders }, bumperOut);
    }
    const bumper = bumperOut.events.find((e) => e.type === 'bumper');
    expect(bumper?.type).toBe('bumper');
    if (bumper?.type === 'bumper') {
      expect(-bumper.outVel.y).toBeGreaterThan(BUMPER_SPEED * 0.9);
      expect(bumper.outVel.x).toBeGreaterThan(0);
    }

    const fanOn = { 'fan-plate': true };
    const inFan = ball(850, 500);
    const fanOut: StepBallOut = { events: [] };
    const fanColliders = collidersFor(solidColliders(fanLevel, fanOn), 0);
    stepBall(inFan, { level: fanLevel, switches: fanOn, playerId: 0, colliders: fanColliders }, fanOut);
    expect(inFan.vel.y).toBeCloseTo((GRAVITY - FAN_FORCE) * DT, 9);
    let highest = inFan.pos.y;
    for (let i = 0; i < 120; i += 1) {
      stepBall(inFan, { level: fanLevel, switches: fanOn, playerId: 0, colliders: fanColliders }, fanOut);
      expect(inFan.vel.y).toBeGreaterThanOrEqual(-FAN_MAX_LIFT);
      highest = Math.min(highest, inFan.pos.y);
    }
    expect(highest).toBeLessThan(400);
    const entering = ball(850, 650 - 30, 0, -300);
    const entryOut: StepBallOut = { events: [] };
    for (let i = 0; i < 30; i += 1) stepBall(entering, { level: fanLevel, switches: fanOn, playerId: 0, colliders: fanColliders }, entryOut);
    expect(eventTypes(entryOut).filter((t) => t === 'fan')).toHaveLength(1);
  });

  it('groundAt under an overhang returns the fairway', () => {
    const g = groundAt(overhangLevel, NONE, { x: 800, y: TEE_Y }, 0);
    expect(g).toMatchObject({ y: GROUND_Y, source: 'piece', index: 0, permanent: true, slope: 0 });
    const onTop = groundAt(overhangLevel, NONE, { x: 800, y: 440 - BALL_RADIUS }, 0);
    expect(onTop).toMatchObject({ y: 440, index: 1 });
  });

  it('groundAt prefers the active bridge/blocker/wrong-colour gate top the ball stands on', () => {
    expect(groundAt(gapBridgeLevel, ALL_HELD, { x: 580, y: TEE_Y }, 0)).toMatchObject({ source: 'bridge', permanent: false, y: GROUND_Y });
    expect(groundAt(gapBridgeLevel, NONE, { x: 580, y: TEE_Y }, 0)).toBeNull();
    expect(groundAt(blockerLevel, NONE, { x: 1220, y: 440 - BALL_RADIUS }, 0)).toMatchObject({ source: 'blocker', permanent: true, y: 440 });
    expect(groundAt(gateLevel, NONE, { x: 720, y: 440 - BALL_RADIUS }, 1)).toMatchObject({ source: 'colourGate', y: 440 });
    // the red ball passes through the red gate: only the fairway far below is ground for it
    expect(groundAt(gateLevel, NONE, { x: 720, y: 440 - BALL_RADIUS }, 0)).toMatchObject({ source: 'piece', y: GROUND_Y });
  });

  describe('predictShot parity with the real sim', () => {
    /** Plays `aim` from the intro state with stepSim and returns the active ball's position per tick after the shot. */
    function realShot(level: Level, aim: Aim, ticks: number): { positions: BallState['pos'][]; events: SimEventType[]; final: SimState } {
      let state = createSim(fixtureConfig([level])).state;
      state = stepSim(state, [{ type: 'continue', playerId: 0 }]).state;
      const p = state.activePlayer;
      const positions: BallState['pos'][] = [];
      const events: SimEventType[] = [];
      let r = stepSim(state, [{ type: 'setAim', playerId: p, ...aim }, { type: 'shoot', playerId: p }]);
      positions.push(r.state.balls[p].pos);
      events.push(...r.events.map((e) => e.type));
      for (let i = 1; i < ticks; i += 1) {
        r = stepSim(r.state, []);
        positions.push(r.state.balls[p].pos);
        events.push(...r.events.map((e) => e.type));
      }
      return { positions, events, final: r.state };
    }

    function expectParity(level: Level, aim: Aim): SimEventType[] {
      const intro = createSim(fixtureConfig([level])).state;
      const p = intro.activePlayer;
      const preview = predictShot(level, intro.switches, intro.balls[p], p, aim, [intro.balls[1 - p === 0 ? 0 : 1]], 150);
      // the real run goes on past the preview's 150 ticks: a chip onto a plate presses it only once it RESTS
      const real = realShot(level, aim, 400);
      expect(preview.points.length).toBeGreaterThan(0);
      for (let k = 0; k < preview.points.length; k += 1) {
        expect(preview.points[k], `tick ${k}`).toEqual(real.positions[k]);
      }
      expect(preview.landing).not.toBeNull();
      return real.events;
    }

    it('predictShot points equal a real shot positions for 150 ticks exactly on sandSpringBumperLevel', () => {
      const events = expectParity(sandSpringBumperLevel, { angle: -0.7854, power: 100 });
      expect(events).toContain('spring');
      expect(expectParity(sandSpringBumperLevel, { angle: -0.7854, power: 50 })).toContain('enterSand');
    });

    it('predictShot points equal a real shot positions on blockerLevel where the shot lands on a plate that opens the blocker', () => {
      const aim: Aim = { angle: -0.7854, power: 40 };
      const events = expectParity(blockerLevel, aim);
      expect(events).toContain('switchOn');
      expect(events).toContain('bridgeToggle');
      const preview = predictShot(blockerLevel, { door: false }, createSim(fixtureConfig([blockerLevel])).state.balls[0], 0, aim, [], 400);
      expect(preview.outcome).toBe('rest');
      const rest = preview.points[preview.points.length - 1];
      expect(rest && rest.x >= 260 && rest.x <= 560).toBe(true);
    });

    it('predictShot reports fell/sink/rest outcomes and never emits into state', () => {
      const start = createSim(fixtureConfig([gapBridgeLevel])).state;
      const fell = predictShot(gapBridgeLevel, start.switches, start.balls[0], 0, { angle: -0.7854, power: 60 }, [start.balls[1]], 600);
      expect(fell.outcome).toBe('fell');
      const holder: BallState = { ...start.balls[1], pos: { x: 350, y: TEE_Y }, lastRest: { x: 350, y: TEE_Y } };
      const held = predictShot(gapBridgeLevel, { near: true, far: false, deck: false }, start.balls[0], 0, { angle: -0.7854, power: 60 }, [holder], 600);
      expect(held.outcome).toBe('rest');
      expect(held.points[held.points.length - 1]?.x).toBeGreaterThan(BRIDGE_X2);
      const flat = createSim(fixtureConfig([flatLevel])).state;
      const putt = predictShot(flatLevel, flat.switches, { ...flat.balls[0], pos: { x: 1300, y: TEE_Y }, lastRest: { x: 1300, y: TEE_Y } }, 0, { angle: -0.03, power: 25 }, [flat.balls[1]], 600);
      expect(['sink', 'gimme']).toContain(putt.outcome);
      expect(start.balls[0].asleep).toBe(true);
    });

    it('launchVelocity is power * SHOT_SPEED_PER_POWER along the aim', () => {
      const v = launchVelocity({ angle: -1.5708, power: 100 });
      expect(v.x).toBeCloseTo(0, 2);
      expect(v.y).toBeCloseTo(-650, 6);
    });

    it('stepSim with two balls costs under 0.1 ms per tick and predictShot(150) under 1 ms (best of 5 warmed runs)', () => {
      let state = createSim(fixtureConfig([gapBridgeLevel])).state;
      state = stepSim(state, [{ type: 'continue', playerId: 0 }]).state;
      const flying = stepSim(state, [{ type: 'setAim', playerId: 0, angle: -0.7854, power: 60 }, { type: 'shoot', playerId: 0 }]).state;
      const bestOf = (runs: number, fn: () => void): number => {
        let best = Number.POSITIVE_INFINITY;
        for (let r = 0; r < runs; r += 1) {
          const t0 = performance.now();
          fn();
          best = Math.min(best, performance.now() - t0);
        }
        return best;
      };
      const ticks = 600;
      const stepMs = bestOf(5, () => {
        let s = flying;
        for (let i = 0; i < ticks; i += 1) s = stepSim(s, []).state;
      });
      expect(stepMs / ticks).toBeLessThan(0.1);
      const previews = 10;
      const previewMs = bestOf(5, () => {
        for (let i = 0; i < previews; i += 1) predictShot(gapBridgeLevel, flying.switches, flying.balls[0], 0, { angle: -0.7854, power: 70 }, [flying.balls[1]], 150);
      });
      expect(previewMs / previews).toBeLessThan(1);
    });
  });
});
