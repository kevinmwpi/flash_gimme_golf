// OWNER: sim
// Worlds 2-3 devices (LEVELS.md TRAP / CANNON / WAITING rule, BUILD_DECISIONS D10.4-D10.6, CONTRACT §1-§5 + §4a):
// the trap and the cannon, the WAITING-rule hand-off with its scoped reset, the flight watchdog, the flush-footed
// door, the new validity rules, predictLaunch, and the replay / snapshot guarantees on device scenarios.
import { describe, expect, it, vi } from 'vitest';
import {
  breechAt,
  cannonHolding,
  isCannonLit,
  isTrapArmed,
  onCannonBreech,
  releaseIdsOf,
  releaseLabel,
  trapHolding,
  waitingOf,
} from '../devices';
import { validateLevel } from '../levels/authoring';
import { evaluateSwitches, predictLaunch, stepBall, type StepBallOut } from '../physics';
import { SerializeError, decodeSnapshot, encodeSnapshot } from '../serialize';
import { createSim, runReplay, stepSim } from '../sim';
import { collidersFor, isRectActive, pointInPiece, solidColliders } from '../terrain';
import type {
  BallState,
  CannonRect,
  Level,
  LevelRect,
  PlayerCommand,
  PlayerId,
  PressureSwitch,
  SimConfig,
  SimEvent,
  SimEventType,
  SimState,
  StepResult,
  TrapRect,
  Vec,
} from '../types';
import { BACK_PENALTY, BALL_RADIUS, FLIGHT_WATCHDOG_TICKS, MAX_BALL_SPEED, REST_TICKS, SNAPSHOT_VERSION, TURN_DELAY_TICKS } from '../types';
import {
  CANNON_LAUNCH,
  DOOR_W,
  DOOR_X,
  FLOOR_Y,
  MACHINE_LOG,
  MACHINE_LOG_TICKS,
  cannonLevel,
  deviceConfig,
  flushDoorLevel,
  machineLevel,
  pogoLevel,
  trapLevel,
} from './device-fixtures';

vi.mock('../levels/index', async () => (await import('./device-fixtures')).deviceRegistry);

const TEE_Y = FLOOR_Y - BALL_RADIUS;

function rectOf<K extends LevelRect['kind']>(level: Level, kind: K): Extract<LevelRect, { kind: K }> {
  const rect = level.rects.find((r): r is Extract<LevelRect, { kind: K }> => r.kind === kind);
  if (rect === undefined) throw new Error(`fixture ${level.id} has no ${kind}`);
  return rect;
}

const SNARE: TrapRect = rectOf(trapLevel, 'trap');
const CANNON: CannonRect = rectOf(cannonLevel, 'cannon');

function plateOf(level: Level, id: string): PressureSwitch {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`fixture ${level.id} has no plate ${id}`);
  return sw;
}

/** trapLevel's release plate and cannonLevel's FIRE plate: both x 370-470 on the fairway. */
const FREE = plateOf(trapLevel, 'free');
const FIRE = plateOf(cannonLevel, 'fire');

const onPlate = (sw: PressureSwitch, ball: Readonly<BallState>): boolean => ball.pos.x >= sw.x && ball.pos.x <= sw.x + sw.w;

/** A resting ball at x on the flat fairway; `lastRest` defaults to the spot itself. */
function parked(x: number, lastRest: Vec = { x, y: TEE_Y }): BallState {
  return { pos: { x, y: TEE_Y }, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest };
}

/** A ball rolling right at vx from x, whose safe spot is `lastRestX` on the fairway. */
function rolling(x: number, vx: number, lastRestX: number): BallState {
  return { pos: { x, y: TEE_Y }, vel: { x: vx, y: 0 }, asleep: false, sunk: false, grounded: true, restTicks: 0, lastRest: { x: lastRestX, y: TEE_Y } };
}

/** An `aiming` state on `level` with crafted balls; the switch map is the one the balls imply (consistent). */
function aimingState(level: Level, balls: [BallState, BallState], activePlayer: PlayerId = 0, mode: 'solo' | 'local' = 'local'): SimState {
  const intro = createSim(deviceConfig(level, mode)).state;
  const aiming = stepSim(intro, [{ type: 'continue', playerId: 0 }]).state;
  return { ...aiming, balls, activePlayer, switches: evaluateSwitches(level, aiming.switches, balls), turnDelayTicks: 0 };
}

/** The same, in `flying` (a shot is still settling: the next settled tick hands off). */
function flyingState(level: Level, balls: [BallState, BallState], activePlayer: PlayerId = 0, mode: 'solo' | 'local' = 'local'): SimState {
  return { ...aimingState(level, balls, activePlayer, mode), phase: 'flying' };
}

type Trace = { results: StepResult[]; state: SimState; events: SimEvent[] };

function run(state: SimState, ticks: number, commandsAt: Record<number, PlayerCommand[]> = {}): Trace {
  const results: StepResult[] = [];
  const events: SimEvent[] = [];
  let s = state;
  for (let i = 0; i < ticks; i += 1) {
    const r = stepSim(s, commandsAt[i] ?? []);
    results.push(r);
    events.push(...r.events);
    s = r.state;
  }
  return { results, state: s, events };
}

/** Steps until the phase is `aiming` again (a hand-off happened) or `limit` ticks passed. */
function untilAiming(state: SimState, limit = 3000): Trace {
  const results: StepResult[] = [];
  const events: SimEvent[] = [];
  let s = state;
  for (let i = 0; i < limit; i += 1) {
    const r = stepSim(s, []);
    results.push(r);
    events.push(...r.events);
    s = r.state;
    if (s.phase !== 'flying') break;
  }
  return { results, state: s, events };
}

const ofType = <T extends SimEventType>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const shot = (playerId: PlayerId, angle: number, power: number): PlayerCommand[] => [
  { type: 'setAim', playerId, angle, power },
  { type: 'shoot', playerId },
];

/** ARCH R5 over every tick: a tick whose switch map changed never also hands the turn over. */
function expectR5(results: readonly StepResult[]): void {
  for (const r of results) {
    const switched = r.events.some((e) => e.type === 'switchOn' || e.type === 'switchOff');
    if (switched) expect(r.events.some((e) => e.type === 'turnStart'), `tick ${r.state.tick}`).toBe(false);
  }
}

/** `turnSkipped` only ever directly precedes its `turnStart`, in the same tick. */
function expectSkipsBeforeTurnStart(results: readonly StepResult[]): void {
  for (const r of results) {
    r.events.forEach((e, i) => {
      if (e.type !== 'turnSkipped') return;
      const start = r.events.slice(i + 1).find((x) => x.type === 'turnStart');
      expect(start, `tick ${r.state.tick}`).toMatchObject({ type: 'turnStart', playerId: e.nextPlayer, tick: e.tick });
    });
  }
}

/** flightTicks is within 0..FLIGHT_WATCHDOG_TICKS-1 every tick and 0 outside 'flying'. */
function expectFlightTicksInRange(results: readonly StepResult[]): void {
  for (const r of results) {
    const { flightTicks, phase } = r.state;
    expect(Number.isInteger(flightTicks)).toBe(true);
    expect(flightTicks).toBeGreaterThanOrEqual(0);
    expect(flightTicks).toBeLessThanOrEqual(FLIGHT_WATCHDOG_TICKS - 1);
    if (phase !== 'flying') expect(flightTicks, `tick ${r.state.tick} ${phase}`).toBe(0);
  }
}

/** A ball's safe spot moves only while it is free: never caught, never on a breech, always to a supported free spot. */
function expectSafeSpotsOnlyWhileFree(level: Level, from: SimState, results: readonly StepResult[]): void {
  let prev = from;
  for (const r of results) {
    for (const i of [0, 1] as const) {
      const before = prev.balls[i].lastRest;
      const ball = r.state.balls[i];
      if (ball.lastRest.x === before.x && ball.lastRest.y === before.y) continue;
      const toTee = r.events.some((e) => e.type === 'trapReturn' && e.playerId === i && e.toTee);
      // a gimme records the rest spot, then concedes the ball into the cup
      if (!toTee && !ball.sunk) expect(ball.lastRest, `tick ${r.state.tick} slot ${i}`).toEqual(ball.pos);
      expect(waitingOf(level, r.state.switches, ball), `tick ${r.state.tick} slot ${i}`).toBeNull();
      expect(onCannonBreech(level, ball.lastRest)).toBe(false);
    }
    prev = r.state;
  }
}

describe('device queries (devices.ts)', () => {
  it('a trap is ARMED until a release is held (isRectActive default activeWhen false); a cannon is LIT while FIRE is held', () => {
    expect(isRectActive(SNARE, { free: false })).toBe(true);
    expect(isRectActive(SNARE, { free: true })).toBe(false);
    expect(isTrapArmed(SNARE, { free: false })).toBe(true);
    expect(isTrapArmed(SNARE, { free: true })).toBe(false);
    expect(isRectActive({ ...SNARE, activeWhen: true }, { free: true })).toBe(true);
    expect(isRectActive(CANNON, { fire: false })).toBe(false);
    expect(isCannonLit(CANNON, { fire: false })).toBe(false);
    expect(isCannonLit(CANNON, { fire: true })).toBe(true);
  });

  it('trapHolding / cannonHolding / waitingOf need a RESTING ball; caught wins over loaded; sunk or moving balls never wait', () => {
    const inJaws = parked(750);
    expect(trapHolding(trapLevel, { free: false }, inJaws)?.id).toBe('snare');
    expect(trapHolding(trapLevel, { free: true }, inJaws)).toBeNull();
    expect(trapHolding(trapLevel, { free: false }, { ...inJaws, asleep: false })).toBeNull();
    expect(trapHolding(trapLevel, { free: false }, { ...inJaws, sunk: true })).toBeNull();
    expect(waitingOf(trapLevel, { free: false }, inJaws)).toEqual({ reason: 'caught', rectId: 'snare' });
    expect(waitingOf(trapLevel, { free: false }, parked(650))).toBeNull();
    const inBreech = parked(700);
    expect(breechAt(cannonLevel, inBreech.pos)?.id).toBe('cannon');
    expect(onCannonBreech(cannonLevel, inBreech.pos)).toBe(true);
    expect(onCannonBreech(cannonLevel, { x: 700, y: TEE_Y - 40 })).toBe(false);
    expect(onCannonBreech(cannonLevel, { x: 730, y: TEE_Y })).toBe(false);
    expect(cannonHolding(cannonLevel, { fire: false }, inBreech)?.id).toBe('cannon');
    expect(cannonHolding(cannonLevel, { fire: true }, inBreech)).toBeNull();
    expect(waitingOf(cannonLevel, { fire: false }, inBreech)).toEqual({ reason: 'loaded', rectId: 'cannon' });
    expect(waitingOf(cannonLevel, { fire: false }, { ...inBreech, asleep: false })).toBeNull();
  });

  it('releaseIdsOf names the plates and whether the cup holds one; releaseLabel names every plate by label (else its id)', () => {
    expect(releaseIdsOf(trapLevel, SNARE)).toEqual({ switchIds: ['free'], cup: true });
    expect(releaseIdsOf(machineLevel, rectOf(machineLevel, 'trap'))).toEqual({ switchIds: ['free'], cup: false });
    expect(releaseLabel(trapLevel, SNARE)).toBe('FREE');
    expect(releaseLabel(cannonLevel, CANNON)).toBe('FIRE');
    const unlabelled: Level = { ...cannonLevel, switches: cannonLevel.switches.map(({ label: _ignored, ...sw }) => sw) };
    expect(releaseLabel(unlabelled, CANNON)).toBe('FIRE');
    expect(releaseLabel(trapLevel, { ...SNARE, switchIds: ['plate-b'] })).toBe('PLATE-B');
    // several plates: distinct labels in authored order, so the chip never names only one the partner cannot reach
    expect(releaseLabel(trapLevel, { ...SNARE, switchIds: ['free', 'plate-b'] })).toBe('FREE or PLATE-B');
    expect(releaseLabel(trapLevel, { ...SNARE, switchIds: ['free', 'plate-b', 'plate-c'] })).toBe('FREE, PLATE-B or PLATE-C');
    expect(releaseLabel(trapLevel, { ...SNARE, switchIds: ['free', 'free'] })).toBe('FREE');
  });
});

describe('TRAP', () => {
  it('catches only a RESTING ball: a roll through the jaws never catches; a ball stopping inside is caught (ballRest, then trapCaught)', () => {
    const through = run(flyingState(trapLevel, [rolling(600, 300, 200), parked(260)]), 400);
    const inside = through.results.filter((r) => r.state.balls[0].pos.x >= SNARE.x && r.state.balls[0].pos.x <= SNARE.x + SNARE.w);
    expect(inside.length).toBeGreaterThan(5);
    for (const r of inside) expect(waitingOf(trapLevel, r.state.switches, r.state.balls[0])).toBeNull();
    expect(ofType(through.events, 'trapCaught')).toEqual([]);
    expect(through.state.balls[0].pos.x).toBeGreaterThan(SNARE.x + SNARE.w);

    const stop = run(flyingState(trapLevel, [rolling(730, 72, 200), parked(260)]), 120);
    const rest = ofType(stop.events, 'ballRest');
    expect(rest).toHaveLength(1);
    const x = stop.state.balls[0].pos.x;
    expect(x).toBeGreaterThan(SNARE.x);
    expect(x).toBeLessThan(SNARE.x + SNARE.w);
    const restTick = stop.results.find((r) => r.events.some((e) => e.type === 'ballRest'));
    expect(restTick?.events.map((e) => e.type).slice(0, 2)).toEqual(['ballRest', 'trapCaught']);
    expect(ofType(stop.events, 'trapCaught')).toEqual([{ type: 'trapCaught', playerId: 0, pos: stop.state.balls[0].pos, rectId: 'snare', tick: restTick?.state.tick }]);
    // the safe spot is never written while caught
    expect(stop.state.balls[0].lastRest).toEqual({ x: 200, y: TEE_Y });
    expect(waitingOf(trapLevel, stop.state.switches, stop.state.balls[0])).toEqual({ reason: 'caught', rectId: 'snare' });
  });

  it('a release plate frees the caught ball the tick a ball first touches it (trapFreed); letting go of it catches the ball again (trapCaught)', () => {
    // blue rolls onto FREE (x 370-470) from the left and stops on it: red is freed on blue's first contact,
    // while blue is still rolling (D11), and stays free as blue comes to rest there
    const start = flyingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), rolling(330, 100, 260)], 1);
    expect(start.switches.free).toBe(false);
    expect(waitingOf(trapLevel, start.switches, start.balls[0])).toEqual({ reason: 'caught', rectId: 'snare' });
    const freeing = run(start, 120);
    const onAt = freeing.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn'));
    expect(onAt).toBeGreaterThan(0);
    expect(onAt).toBe(freeing.results.findIndex((r) => onPlate(FREE, r.state.balls[1])));
    const onTick = freeing.results[onAt];
    expect(onTick?.events.filter((e) => e.type !== 'bounce').map((e) => e.type)).toEqual(['switchOn', 'trapFreed']);
    expect(onTick?.state.balls[1].asleep).toBe(false);
    expect(ofType(freeing.events, 'trapFreed')).toEqual([{ type: 'trapFreed', playerId: 0, pos: { x: 750, y: TEE_Y }, rectId: 'snare', tick: onTick?.state.tick }]);
    const restAt = freeing.results.findIndex((r) => r.events.some((e) => e.type === 'ballRest' && e.playerId === 1));
    expect(restAt).toBeGreaterThan(onAt);
    expect(onPlate(FREE, freeing.state.balls[1])).toBe(true);
    for (const r of freeing.results.slice(onAt)) expect(r.state.switches.free).toBe(true);
    expect(ofType(freeing.events, 'switchOff')).toEqual([]);
    expect(ofType(freeing.events, 'trapCaught')).toEqual([]);
    expect(waitingOf(trapLevel, freeing.state.switches, freeing.state.balls[0])).toBeNull();

    // blue holds FREE, red is free in the open jaws; blue's putt rolls off the plate and the jaws close on red
    // the tick blue's centre leaves x 370-470, not on the shot tick (blue is still on the plate then)
    const held = aimingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), parked(420)], 1);
    expect(held.switches.free).toBe(true);
    const leaving = run(held, 120, { 0: shot(1, -0.03, 20) });
    expect(leaving.results[0]?.events.filter((e) => e.type !== 'bounce').map((e) => e.type)).toEqual(['ballHit']);
    const offAt = leaving.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff'));
    expect(offAt).toBeGreaterThan(0);
    expect(offAt).toBe(leaving.results.findIndex((r) => !onPlate(FREE, r.state.balls[1])));
    for (const r of leaving.results.slice(0, offAt)) expect(r.state.switches.free).toBe(true);
    const offTick = leaving.results[offAt];
    expect(offTick?.events.filter((e) => e.type !== 'bounce').map((e) => e.type)).toEqual(['switchOff', 'trapCaught']);
    expect(ofType(offTick?.events ?? [], 'trapCaught')).toEqual([{ type: 'trapCaught', playerId: 0, pos: { x: 750, y: TEE_Y }, rectId: 'snare', tick: offTick?.state.tick }]);
    expect(ofType(leaving.events, 'bridgeToggle')).toEqual([]);
    expect(ofType(leaving.events, 'trapFreed')).toEqual([]);
  });

  it('a partner rolling ACROSS a release plate frees the caught ball only while it is on it (trapFreed, then trapCaught); still caught at the hand-off, it is skipped', () => {
    const start = flyingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), rolling(330, 200, 260)], 1);
    const trace = untilAiming(start);
    const freedAt = trace.results.findIndex((r) => onPlate(FREE, r.state.balls[1]));
    const caughtAt = trace.results.findIndex((r, i) => i > freedAt && !onPlate(FREE, r.state.balls[1]));
    expect(freedAt).toBeGreaterThan(0);
    expect(caughtAt - freedAt).toBeGreaterThan(3);
    // FREE is down, and the jaws open, exactly while blue's centre is over x 370-470
    trace.results.forEach((r, i) => {
      const on = i >= freedAt && i < caughtAt;
      expect(r.state.switches.free, `tick ${r.state.tick}`).toBe(on);
      expect(waitingOf(trapLevel, r.state.switches, r.state.balls[0]), `tick ${r.state.tick}`).toEqual(on ? null : { reason: 'caught', rectId: 'snare' });
    });
    for (const r of trace.results.slice(freedAt, caughtAt)) expect(r.state.balls[1].asleep).toBe(false);
    expect(trace.results[freedAt]?.events.filter((e) => e.type !== 'bounce').map((e) => e.type)).toEqual(['switchOn', 'trapFreed']);
    expect(trace.results[caughtAt]?.events.filter((e) => e.type !== 'bounce').map((e) => e.type)).toEqual(['switchOff', 'trapCaught']);
    expect(ofType(trace.events, 'trapFreed')).toEqual([expect.objectContaining({ playerId: 0, pos: { x: 750, y: TEE_Y }, rectId: 'snare' })]);
    expect(ofType(trace.events, 'trapCaught')).toEqual([expect.objectContaining({ playerId: 0, pos: { x: 750, y: TEE_Y }, rectId: 'snare' })]);
    // blue rests beyond the plate (short of the jaws): red is caught at the hand-off, skipped, and keeps its safe spot
    const last = trace.results[trace.results.length - 1];
    expect(last?.events.map((e) => e.type)).toEqual(['ballRest', 'turnSkipped', 'turnStart']);
    expect(last?.events[1]).toMatchObject({ type: 'turnSkipped', playerId: 0, reason: 'caught', rectId: 'snare', nextPlayer: 1 });
    expect(last?.events[2]).toMatchObject({ type: 'turnStart', playerId: 1, sameAsBefore: true });
    expect(trace.state.balls[1].pos.x).toBeGreaterThan(FREE.x + FREE.w);
    expect(trace.state.balls[1].pos.x).toBeLessThan(SNARE.x);
    for (const r of trace.results) expect(r.state.balls[0].lastRest).toEqual({ x: 200, y: TEE_Y });
    expectR5(trace.results);
  });

  it('the cup holding a release frees a caught ball the tick its partner holes out', () => {
    const trace = run(flyingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), rolling(1375, 120, 260)], 1), 120);
    const sinkTick = trace.results.find((r) => r.events.some((e) => e.type === 'sink'));
    expect(sinkTick?.events.map((e) => e.type)).toEqual(['sink', 'switchOn', 'trapFreed']);
    expect(ofType(sinkTick?.events ?? [], 'switchOn')[0]).toMatchObject({ switchId: 'free', byPlayer: 1 });
    expect(ofType(trace.events, 'turnStart')).toEqual([expect.objectContaining({ playerId: 0, sameAsBefore: false })]);
    expect(trace.state.activePlayer).toBe(0);
  });

  it('a ball freed in place records its safe spot at the hand-off (not before), and only because its partner STAYS on the release plate', () => {
    // blue rolls onto FREE and stops there: red is freed on blue's first contact, many ticks before the hand-off
    const start = flyingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), rolling(330, 100, 260)], 1);
    const trace = untilAiming(start);
    const freedAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'trapFreed'));
    expect(freedAt).toBeGreaterThan(0);
    const handOffAt = trace.results.length - 1;
    expect(handOffAt - freedAt).toBeGreaterThan(REST_TICKS);
    for (const r of trace.results.slice(0, handOffAt)) expect(r.state.balls[0].lastRest).toEqual({ x: 200, y: TEE_Y });
    // blue's rest on the plate changes no switch, so that same tick hands the turn to the freed red ball
    const handOff = trace.results[handOffAt];
    expect(handOff?.events.map((e) => e.type)).toEqual(['ballRest', 'turnStart']);
    expect(handOff?.events[1]).toMatchObject({ type: 'turnStart', playerId: 0, sameAsBefore: false });
    expect(onPlate(FREE, handOff!.state.balls[1])).toBe(true);
    expect(handOff?.state.switches.free).toBe(true);
    expect(handOff?.state.balls[0].lastRest).toEqual({ x: 750, y: TEE_Y });
    expectSafeSpotsOnlyWhileFree(trapLevel, start, trace.results);
  });
});

describe('WAITING rule (hand-off)', () => {
  it('a caught partner is skipped: turnSkipped comes before turnStart in the same tick and the free ball shoots again', () => {
    const caught = parked(750, { x: 200, y: TEE_Y });
    const trace = untilAiming(flyingState(trapLevel, [caught, rolling(450, 150, 260)], 1));
    const last = trace.results[trace.results.length - 1];
    // the shooter came to rest, and the same tick hands the turn back to it past its caught partner
    expect(last?.events.map((e) => e.type)).toEqual(['ballRest', 'turnSkipped', 'turnStart']);
    expect(last?.events[1]).toMatchObject({ type: 'turnSkipped', playerId: 0, reason: 'caught', rectId: 'snare', nextPlayer: 1 });
    expect(last?.events[2]).toMatchObject({ type: 'turnStart', playerId: 1, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: true });
    const ready = run(trace.state, TURN_DELAY_TICKS).state;
    const again = stepSim(ready, shot(1, -0.03, 20));
    expect(ofType(again.events, 'commandRejected')).toEqual([]);
    expect(ofType(again.events, 'ballHit')).toEqual([expect.objectContaining({ playerId: 1 })]);
  });

  it('a loaded partner is skipped too (reason loaded)', () => {
    const trace = untilAiming(flyingState(cannonLevel, [parked(700, { x: 200, y: TEE_Y }), rolling(250, 100, 260)], 1));
    expect(trace.results[trace.results.length - 1]?.events).toEqual([
      expect.objectContaining({ type: 'ballRest', playerId: 1 }),
      expect.objectContaining({ type: 'turnSkipped', playerId: 0, reason: 'loaded', rectId: 'cannon', nextPlayer: 1 }),
      expect.objectContaining({ type: 'turnStart', playerId: 1, sameAsBefore: true }),
    ]);
  });

  it('solo mode hands the solo player the free ball (seat 0 shoots it, nothing rejected)', () => {
    const trace = untilAiming(flyingState(trapLevel, [parked(750, { x: 200, y: TEE_Y }), rolling(450, 150, 260)], 1, 'solo'));
    expect(trace.state.activePlayer).toBe(1);
    expect(ofType(trace.events, 'turnSkipped')).toEqual([expect.objectContaining({ playerId: 0, nextPlayer: 1 })]);
    const ready = run(trace.state, TURN_DELAY_TICKS).state;
    const again = stepSim(ready, shot(1, -0.03, 20));
    expect(ofType(again.events, 'commandRejected')).toEqual([]);
    expect(again.state.phase).toBe('flying');
  });

  it('both waiting: the scoped reset sends the shooter back to its safe spot with BACK_PENALTY, then it shoots again', () => {
    const start = flyingState(trapLevel, [parked(720, { x: 200, y: TEE_Y }), rolling(700, 72, 300)], 1);
    const strokesBefore = start.players.map((p) => p.strokes);
    const trace = untilAiming(start);
    const last = trace.results[trace.results.length - 1];
    const caughtPos = ofType(trace.events, 'trapCaught').find((e) => e.playerId === 1)?.pos;
    expect(caughtPos).toBeDefined();
    // blue comes to rest in the occupied jaws; the same tick's hand-off finds nobody free and resets blue
    expect(last?.events.map((e) => e.type)).toEqual(['ballRest', 'trapCaught', 'trapReturn', 'turnSkipped', 'turnStart']);
    expect(last?.events[2]).toMatchObject({
      type: 'trapReturn',
      playerId: 1,
      pos: caughtPos,
      respawnPos: { x: 300, y: TEE_Y },
      strokes: (strokesBefore[1] ?? 0) + BACK_PENALTY,
      toTee: false,
    });
    expect(last?.events[3]).toMatchObject({ playerId: 0, reason: 'caught', nextPlayer: 1 });
    expect(last?.events[4]).toMatchObject({ playerId: 1, sameAsBefore: true });
    expect(trace.state.balls[1]).toMatchObject({ pos: { x: 300, y: TEE_Y }, asleep: true, grounded: true, restTicks: REST_TICKS, vel: { x: 0, y: 0 } });
    expect(trace.state.players.map((p) => p.strokes)).toEqual([strokesBefore[0], (strokesBefore[1] ?? 0) + BACK_PENALTY]);
    expect(trace.state.activePlayer).toBe(1);
  });

  it('a reset whose ball already sits at its safe spot is skipped (no stroke, no event); the other waiting ball is reset', () => {
    const start = flyingState(trapLevel, [parked(720, { x: 200, y: TEE_Y }), parked(760)], 1);
    const trace = untilAiming(start);
    const returns = ofType(trace.events, 'trapReturn');
    expect(returns).toEqual([expect.objectContaining({ playerId: 0, respawnPos: { x: 200, y: TEE_Y }, toTee: false })]);
    expect(trace.state.players.map((p) => p.strokes)).toEqual([BACK_PENALTY, 0]);
    expect(ofType(trace.events, 'turnStart')).toEqual([expect.objectContaining({ playerId: 0, sameAsBefore: false })]);
  });

  it('a reset that changes a switch defers the hand-off: diff now, turnStart only on the next settled tick (R5 on every tick)', () => {
    const start = flyingState(trapLevel, [parked(720, { x: 200, y: TEE_Y }), parked(760, { x: 420, y: TEE_Y })], 1);
    const trace = run(start, 3);
    const [resetTick, handOffTick] = trace.results;
    expect(resetTick?.events.map((e) => e.type)).toEqual(['trapReturn', 'switchOn', 'trapFreed']);
    expect(resetTick?.state.phase).toBe('flying');
    expect(resetTick?.state.switches.free).toBe(true);
    expect(resetTick?.state.balls[0].lastRest).toEqual({ x: 200, y: TEE_Y });
    expect(handOffTick?.events.map((e) => e.type)).toEqual(['turnStart']);
    expect(handOffTick?.events[0]).toMatchObject({ playerId: 0, sameAsBefore: false });
    // red was freed where it sits, so the hand-off records that spot as its safe spot
    expect(handOffTick?.state.balls[0].lastRest).toEqual({ x: 720, y: TEE_Y });
    expect(trace.state.players.map((p) => p.strokes)).toEqual([0, BACK_PENALTY]);
    expectR5(trace.results);
  });

  it('a reset that lands its ball in armed jaws re-reports it caught (trapCaught after trapReturn), then the other waiting ball is reset', () => {
    // red's safe spot is inside the jaws (it was freed there earlier); red moved last and is caught elsewhere in them
    const start = flyingState(trapLevel, [parked(720, { x: 750, y: TEE_Y }), parked(760, { x: 300, y: TEE_Y })], 0);
    const trace = untilAiming(start);
    expect(trace.events.map((e) => `${e.type}:${'playerId' in e ? e.playerId : ''}`)).toEqual(['trapReturn:0', 'trapCaught:0', 'trapReturn:1', 'turnStart:1']);
    expect(ofType(trace.events, 'trapCaught')[0]).toMatchObject({ pos: { x: 750, y: TEE_Y }, rectId: 'snare' });
    expect(trace.state.players.map((p) => p.strokes)).toEqual([BACK_PENALTY, BACK_PENALTY]);
    expect(waitingOf(trapLevel, trace.state.switches, trace.state.balls[0])).toEqual({ reason: 'caught', rectId: 'snare' });
  });

  it('a fall that respawns a ball inside armed jaws reports it caught (fellOffWorld, then trapCaught)', () => {
    const ball: BallState = { ...rolling(750, 0, 750), pos: { x: 750, y: 900 }, vel: { x: 0, y: 200 }, grounded: false };
    const out: StepBallOut = { events: [] };
    const switches = { free: false };
    stepBall(ball, { level: trapLevel, switches, playerId: 1, colliders: collidersFor(solidColliders(trapLevel, switches), 1) }, out);
    expect(out.events.map((e) => e.type)).toEqual(['fellOffWorld', 'trapCaught']);
    expect(out.events[1]).toMatchObject({ playerId: 1, pos: { x: 750, y: TEE_Y }, rectId: 'snare' });
  });

  it('the tee guard runs only when both waiting balls already sit at their safe spots (a crafted state)', () => {
    const start = flyingState(trapLevel, [parked(720), parked(760)], 1);
    const trace = untilAiming(start);
    const tee = trapLevel.starts[1];
    expect(trace.results[trace.results.length - 1]?.events.map((e) => e.type)).toEqual(['trapReturn', 'turnSkipped', 'turnStart']);
    expect(ofType(trace.events, 'trapReturn')).toEqual([
      expect.objectContaining({ playerId: 1, pos: { x: 760, y: TEE_Y }, respawnPos: tee, strokes: BACK_PENALTY, toTee: true }),
    ]);
    expect(trace.state.balls[1]).toMatchObject({ pos: tee, lastRest: tee, asleep: true });
    expect(trace.state.activePlayer).toBe(1);
    expect(ofType(trace.events, 'turnSkipped')).toEqual([expect.objectContaining({ playerId: 0, reason: 'caught' })]);
  });
});

describe('CANNON', () => {
  /** A ball dropped onto the breech centre from 40 px above. */
  const dropped = (lastRestX = 200): BallState => ({ ...rolling(700, 0, lastRestX), pos: { x: 700, y: TEE_Y - 40 }, grounded: false });

  it('a cold cannon is ordinary ground: a ball resting on the breech is LOADED (ballRest, then cannonLoad) and keeps its safe spot', () => {
    const trace = run(flyingState(cannonLevel, [dropped(), parked(260)]), 120);
    expect(ofType(trace.events, 'cannonFire')).toEqual([]);
    const restTick = trace.results.find((r) => r.events.some((e) => e.type === 'ballRest'));
    const types = restTick?.events.filter((e) => e.type !== 'bounce').map((e) => e.type) ?? [];
    expect(types.slice(0, 2)).toEqual(['ballRest', 'cannonLoad']);
    expect(ofType(trace.events, 'cannonLoad')).toEqual([expect.objectContaining({ playerId: 0, rectId: 'cannon' })]);
    expect(waitingOf(cannonLevel, trace.state.switches, trace.state.balls[0])).toEqual({ reason: 'loaded', rectId: 'cannon' });
    expect(trace.state.balls[0].lastRest).toEqual({ x: 200, y: TEE_Y });
  });

  it('a lit cannon fires on entry exactly like a spring, with cannonFire and NO spring event (dropped in or rolled in)', () => {
    for (const ball of [dropped(), rolling(640, 200, 200)]) {
      // the partner rests on FIRE (x 370-470), so the cannon stays lit every tick
      const trace = run(flyingState(cannonLevel, [ball, parked(420)]), 60);
      expect(trace.state.switches.fire).toBe(true);
      const fire = ofType(trace.events, 'cannonFire');
      expect(fire).toEqual([expect.objectContaining({ playerId: 0, rectId: 'cannon', launch: CANNON_LAUNCH })]);
      expect(ofType(trace.events, 'spring')).toEqual([]);
      const fireTick = trace.results.findIndex((r) => r.events.some((e) => e.type === 'cannonFire'));
      expect(trace.results[fireTick]?.state.balls[0].vel.y).toBe(CANNON_LAUNCH.y);
      expect(trace.results[fireTick + 1]?.state.balls[0].pos.y).toBeLessThan(TEE_Y - 5);
    }
  });

  it('a loaded ball fires the tick after its partner first touches FIRE (the wake rule), even when the partner only rolls across it; no turnStart meanwhile', () => {
    // blue rolls across FIRE (x 370-470) from the left and comes to rest beyond it, short of the breech
    const start = flyingState(cannonLevel, [parked(700, { x: 200, y: TEE_Y }), rolling(330, 200, 260)], 1);
    expect(start.switches.fire).toBe(false);
    expect(waitingOf(cannonLevel, start.switches, start.balls[0])).toEqual({ reason: 'loaded', rectId: 'cannon' });
    const trace = run(start, 300);
    const onAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn' && e.switchId === 'fire'));
    const fireAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'cannonFire'));
    expect(onAt).toBeGreaterThan(0);
    expect(onAt).toBe(trace.results.findIndex((r) => onPlate(FIRE, r.state.balls[1])));
    expect(fireAt).toBe(onAt + 1);
    expect(ofType(trace.results[fireAt]?.events ?? [], 'cannonFire')).toEqual([expect.objectContaining({ playerId: 0, rectId: 'cannon', launch: CANNON_LAUNCH })]);
    // on the tick FIRE goes down red still sits loaded and blue is rolling, not resting
    expect(trace.results[onAt]?.state.balls[0].asleep).toBe(true);
    expect(trace.results[onAt]?.state.balls[1].asleep).toBe(false);
    // blue rolls on off the plate: FIRE comes up and the cannon goes cold, but red's shot is already away
    const offAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'fire'));
    expect(offAt).toBe(trace.results.findIndex((r, i) => i > onAt && !onPlate(FIRE, r.state.balls[1])));
    expect(offAt).toBeGreaterThan(fireAt);
    expect(trace.results[offAt]?.state.balls[0].pos.y).toBeLessThan(TEE_Y - 100);
    expect(ofType(trace.events, 'cannonFire')).toHaveLength(1);
    expect(ofType(trace.events, 'cannonLoad')).toEqual([]);
    for (const r of trace.results.slice(0, fireAt + 1)) expect(r.events.some((e) => e.type === 'turnStart')).toBe(false);
    expect(ofType(trace.events, 'bridgeToggle')).toEqual([]);
    expectR5(trace.results);
    // both come to rest, blue short of the breech and red on the landing sand: red (the other ball) shoots next
    expect(trace.state.phase).toBe('aiming');
    expect(trace.state.activePlayer).toBe(0);
    expect(trace.state.balls[1].pos.x).toBeGreaterThan(FIRE.x + FIRE.w);
    expect(trace.state.balls[1].pos.x).toBeLessThan(CANNON.x);
    expect(trace.state.balls[0].pos.x).toBeGreaterThan(1350);
    expect(trace.state.switches.fire).toBe(false);
  });

  it('a safe spot is never recorded on a breech, lit or cold', () => {
    const cold = run(flyingState(cannonLevel, [dropped(260), parked(200)]), 120);
    expect(cold.state.balls[0].lastRest).toEqual({ x: 260, y: TEE_Y });
    const handOff = untilAiming(cold.state);
    expect(handOff.state.balls[0].lastRest).toEqual({ x: 260, y: TEE_Y });
  });
});

describe('predictLaunch', () => {
  it('is the real stepBall on a scratch ball with the switches fixed, and previews the real cannon flight', () => {
    const lit = { fire: true };
    const from = { x: 700, y: TEE_Y };
    const preview = predictLaunch(cannonLevel, lit, from, CANNON_LAUNCH, 0);
    expect(preview.outcome).toBe('rest');
    const ball: BallState = { pos: from, vel: CANNON_LAUNCH, asleep: false, sunk: false, grounded: false, restTicks: 0, lastRest: from };
    const colliders = collidersFor(solidColliders(cannonLevel, lit), 0);
    const out: StepBallOut = { events: [] };
    const points: Vec[] = [];
    while (!ball.asleep && points.length < 600) {
      stepBall(ball, { level: cannonLevel, switches: lit, playerId: 0, colliders }, out);
      points.push(ball.pos);
    }
    expect(preview.points).toEqual(points);
    // the real sim fires a ball resting on the breech once its partner holds FIRE: the preview lands within a few px of it
    const real = run(flyingState(cannonLevel, [{ ...parked(700, { x: 200, y: TEE_Y }), asleep: false }, parked(420)]), 400);
    expect(ofType(real.events, 'cannonFire')).toHaveLength(1);
    const landing = preview.points[preview.points.length - 1];
    expect(Math.abs((landing?.x ?? 0) - real.state.balls[0].pos.x)).toBeLessThan(4);
    expect(landing?.x).toBeGreaterThan(1350);
    // a fall reports 'fell' and ends the list in the pit, never at the respawn point
    const pit: Level = {
      ...cannonLevel,
      terrain: {
        pieces: [
          { surface: [{ x: 0, y: FLOOR_Y }, { x: 1000, y: FLOOR_Y }], baseY: 720 },
          { surface: [{ x: 1300, y: FLOOR_Y }, { x: 2400, y: FLOOR_Y }], baseY: 720 },
        ],
        gaps: [{ x1: 1000, x2: 1300 }],
      },
    };
    const off = predictLaunch(pit, lit, { x: 950, y: TEE_Y }, { x: 150, y: -300 }, 0);
    expect(off.outcome).toBe('fell');
    const last = off.points[off.points.length - 1];
    expect(last?.x).toBeGreaterThan(1000);
    expect(last?.y).toBeGreaterThan(FLOOR_Y + BALL_RADIUS);
  });
});

describe('flight watchdog', () => {
  it('ends a perpetual straight-up spring pogo on its FLIGHT_WATCHDOG_TICKS-th tick: flightTimeout, safe spot, no stroke', () => {
    const start = aimingState(pogoLevel, [parked(200), parked(260)], 0);
    const results: StepResult[] = [stepSim(start, shot(0, -0.03, 50))];
    let s = results[0]!.state;
    for (let i = 0; i < FLIGHT_WATCHDOG_TICKS + 100 && s.phase === 'flying'; i += 1) {
      const r = stepSim(s, []);
      results.push(r);
      s = r.state;
    }
    const events = results.flatMap((r) => r.events);
    const hit = ofType(events, 'ballHit')[0];
    const timeout = ofType(events, 'flightTimeout');
    expect(ofType(events, 'spring').length).toBeGreaterThan(10);
    expect(timeout).toEqual([expect.objectContaining({ playerId: 0, respawnPos: { x: 200, y: TEE_Y } })]);
    expect((timeout[0]?.tick ?? 0) - (hit?.tick ?? 0) + 1).toBe(FLIGHT_WATCHDOG_TICKS);
    const fired = results.find((r) => r.events.some((e) => e.type === 'flightTimeout'));
    expect(fired?.events.map((e) => e.type)).toEqual(['flightTimeout', 'turnStart']);
    expect(fired?.state.balls[0]).toMatchObject({ pos: { x: 200, y: TEE_Y }, asleep: true, vel: { x: 0, y: 0 } });
    expect(s.players.map((p) => p.strokes)).toEqual([1, 0]);
    expect(Math.max(...results.map((r) => r.state.flightTicks))).toBe(FLIGHT_WATCHDOG_TICKS - 1);
    expectFlightTicksInRange(results);
    for (const r of results) expect(() => decodeSnapshot(encodeSnapshot(r.state), deviceConfig(pogoLevel))).not.toThrow();
  });

  it('a watchdog teleport that presses a plate defers the hand-off a tick and still restarts the flight count', () => {
    // red shoots off the PERCH plate (its safe spot) into the pogo spring; the watchdog puts it back on the plate
    const start = aimingState(pogoLevel, [parked(420), parked(260)], 0);
    expect(start.switches.perch).toBe(true);
    const results: StepResult[] = [stepSim(start, shot(0, -0.03, 40))];
    let s = results[0]!.state;
    for (let i = 0; i < FLIGHT_WATCHDOG_TICKS + 100 && s.phase === 'flying'; i += 1) {
      const r = stepSim(s, []);
      results.push(r);
      s = r.state;
    }
    const at = results.findIndex((r) => r.events.some((e) => e.type === 'flightTimeout'));
    const fired = results[at];
    expect(fired?.events.map((e) => e.type)).toEqual(['flightTimeout', 'switchOn']);
    expect(fired?.state).toMatchObject({ phase: 'flying', flightTicks: 0 });
    expect(results[at + 1]?.events.map((e) => e.type)).toEqual(['turnStart']);
    expect(s.phase).toBe('aiming');
    expectFlightTicksInRange(results);
    expectR5(results);
    for (const r of results) expect(() => decodeSnapshot(encodeSnapshot(r.state), deviceConfig(pogoLevel))).not.toThrow();
  });
});

describe('flush-footed door (D10.12)', () => {
  it('a door standing flush on the floor that closes on a ball in its doorway ejects it sideways, never into the floor', () => {
    const piece = flushDoorLevel.terrain.pieces[0];
    if (piece === undefined) throw new Error('fixture');
    for (const x of [DOOR_X + 1, DOOR_X + 10, DOOR_X + DOOR_W / 2, DOOR_X + 30, DOOR_X + DOOR_W - 1]) {
      const open = aimingState(flushDoorLevel, [parked(420), parked(x)], 0);
      expect(open.switches.door).toBe(true);
      const closing = stepSim({ ...open, balls: [parked(150), open.balls[1]] }, []);
      expect(closing.state.switches.door).toBe(false);
      const trace = run(closing.state, 300);
      for (const r of trace.results) {
        const b = r.state.balls[1];
        expect(b.pos.y + BALL_RADIUS, `x ${x} tick ${r.state.tick}`).toBeLessThanOrEqual(FLOOR_Y + 0.5);
        expect(pointInPiece(piece, b.pos)).toBe(false);
      }
      const end = trace.state.balls[1];
      expect(end.asleep).toBe(true);
      expect(end.pos.x <= DOOR_X - BALL_RADIUS || end.pos.x >= DOOR_X + DOOR_W + BALL_RADIUS, `x ${x} -> ${end.pos.x}`).toBe(true);
      expect(end.pos.y).toBeCloseTo(TEE_Y, 0);
    }
  });
});

describe('validity rules for devices and worlds 2-3', () => {
  const errorsOf = (level: Level): string => validateLevel(level).join(' | ');
  const withRect = (level: Level, id: string, patch: Partial<LevelRect>): Level => ({
    ...level,
    rects: level.rects.map((r) => (r.id === id ? ({ ...r, ...patch } as LevelRect) : r)),
  });

  it('every fixture is valid; a world-2 hole may introduce nothing', () => {
    for (const level of [trapLevel, cannonLevel, pogoLevel, flushDoorLevel, machineLevel]) expect(validateLevel(level), level.id).toEqual([]);
    expect(machineLevel.mechanicsIntroduced).toEqual([]);
    expect(machineLevel.mechanicsPresent).toEqual(['sand', 'switch', 'trap', 'cannon']);
  });

  it('meta: wind 0 in every world, at most one introduced mechanic, exactly one in World 1', () => {
    expect(errorsOf({ ...trapLevel, wind: 30 })).toMatch(/wind must be 0/);
    expect(errorsOf({ ...trapLevel, world: 3, wind: -10 })).toMatch(/wind must be 0/);
    expect(errorsOf({ ...flushDoorLevel, world: 1 })).toMatch(/World 1 level introduces exactly one mechanic/);
    const two = ['trap', 'switch'] as unknown as Level['mechanicsIntroduced'];
    expect(errorsOf({ ...trapLevel, mechanicsIntroduced: two })).toMatch(/at most one mechanic/);
  });

  it('rect ids and switch ids are disjoint within a level', () => {
    expect(errorsOf(withRect(trapLevel, 'snare', { id: 'free' }))).toMatch(/switch id "free" is also a rect id/);
  });

  it('trap: label, release plates that resolve, no tee or cup inside, ground under it, no release plate inside it', () => {
    expect(errorsOf(withRect(trapLevel, 'snare', { label: ' ' }))).toMatch(/trap "snare" needs a label/);
    expect(errorsOf(withRect(trapLevel, 'snare', { switchIds: [] }))).toMatch(/trap "snare" needs a non-empty switchIds/);
    expect(errorsOf(withRect(trapLevel, 'snare', { switchIds: ['ghost'] }))).toMatch(/unknown switch "ghost"/);
    expect(errorsOf(withRect(trapLevel, 'snare', { x: 150 }))).toMatch(/trap "snare" holds tee 0/);
    expect(errorsOf(withRect(trapLevel, 'snare', { x: 1350 }))).toMatch(/trap "snare" holds the cup rim/);
    expect(errorsOf(withRect(trapLevel, 'snare', { x: 1700 }))).toMatch(/trap "snare" has no ground under its centre/);
    expect(errorsOf(withRect(trapLevel, 'snare', { x: 400 }))).toMatch(/trap "snare" holds its own release plate "free"/);
  });

  it('cannon: label, FIRE plates, a finite upward launch within MAX_BALL_SPEED and sideways enough, a flat breech, a pad, a clear muzzle, no tee', () => {
    expect(errorsOf(withRect(cannonLevel, 'cannon', { label: '' }))).toMatch(/cannon "cannon" needs a label/);
    expect(errorsOf(withRect(cannonLevel, 'cannon', { switchIds: [] }))).toMatch(/cannon "cannon" needs a non-empty switchIds/);
    expect(errorsOf(withRect(cannonLevel, 'cannon', { launch: { x: Number.NaN, y: -700 } } as Partial<LevelRect>))).toMatch(/cannon "cannon" launch is not finite/);
    expect(errorsOf(withRect(cannonLevel, 'cannon', { launch: { x: 400, y: 0 } } as Partial<LevelRect>))).toMatch(/cannon "cannon" must launch upward/);
    expect(errorsOf(withRect(cannonLevel, 'cannon', { launch: { x: 800, y: -900 } } as Partial<LevelRect>))).toMatch(/cannon "cannon" launch exceeds MAX_BALL_SPEED/);
    expect(MAX_BALL_SPEED).toBeLessThan(Math.sqrt(800 * 800 + 900 * 900));
    expect(errorsOf(withRect(cannonLevel, 'cannon', { launch: { x: 300, y: -700 } } as Partial<LevelRect>))).toMatch(/cannon "cannon" launches too steeply/);
    expect(errorsOf(withRect(cannonLevel, 'cannon', { launch: { x: -350, y: -700 } } as Partial<LevelRect>))).toBe('');
    const sloped: Level = {
      ...cannonLevel,
      terrain: {
        pieces: [{ surface: [{ x: 0, y: FLOOR_Y }, { x: 680, y: FLOOR_Y }, { x: 720, y: FLOOR_Y - 8 }, { x: 2400, y: FLOOR_Y - 8 }], baseY: 720 }],
        gaps: [],
      },
    };
    expect(errorsOf(sloped)).toMatch(/cannon "cannon" breech floor is steeper than 0.1/);
    expect(errorsOf(withRect(cannonLevel, 'landing', { x: 700 }))).toMatch(/overlaps/);
    const wall: LevelRect = { kind: 'blocker', id: 'wall', x: 735, y: FLOOR_Y - 160, w: 40, h: 180 };
    expect(errorsOf({ ...cannonLevel, rects: [...cannonLevel.rects, wall] })).toMatch(/cannon "cannon" muzzle is blocked/);
    const door: LevelRect = { ...wall, id: 'door', switchIds: ['fire'] };
    expect(errorsOf({ ...cannonLevel, rects: [...cannonLevel.rects, door] })).not.toMatch(/muzzle/);
    expect(errorsOf({ ...cannonLevel, starts: [{ x: 700, y: TEE_Y }, cannonLevel.starts[1]] })).toMatch(/cannon "cannon" breech holds tee 0/);
  });
});

describe('device scenario (fixture-machine, real shots)', () => {
  const CONFIG: SimConfig = deviceConfig(machineLevel);

  function stepped(): { results: StepResult[]; first: SimState } {
    const first = createSim(CONFIG).state;
    const results: StepResult[] = [];
    let state = first;
    for (let t = 0; t < MACHINE_LOG_TICKS; t += 1) {
      const r = stepSim(state, MACHINE_LOG.filter((e) => e.tick === t).map((e) => e.cmd));
      results.push(r);
      state = r.state;
    }
    return { results, first };
  }

  const { results: STEPS, first: FIRST } = stepped();
  const EVENTS = STEPS.flatMap((r) => r.events);

  it('plays every device moment in order and holes out', () => {
    expect(ofType(EVENTS, 'commandRejected')).toEqual([]);
    const moments = EVENTS.filter((e) =>
      ['trapCaught', 'trapFreed', 'trapReturn', 'cannonLoad', 'cannonFire', 'turnSkipped', 'flightTimeout'].includes(e.type),
    ).map((e) => `${e.type}:${'playerId' in e ? e.playerId : ''}`);
    expect(moments).toEqual([
      'trapCaught:0', // red stops in the jaws
      'trapFreed:0', // blue's roll to the jaws crosses FREE: red is free while blue is on it (D11) ...
      'trapCaught:0', // ... and caught again as blue rolls off
      'trapCaught:1', // blue stops in the jaws too
      'trapReturn:1', // nobody can shoot: BACK +1 for blue, which moved last
      'turnSkipped:0', // red is still caught: blue shoots again
      'trapFreed:0', // blue stops on FREE: red is freed where it sits
      'cannonLoad:0', // red rolls into the cold breech
      'turnSkipped:0', // blue taps along FREE: red stays loaded
      'cannonFire:0', // blue rolls into the FIRE dish: red fires the tick after blue first touches FIRE
      'cannonFire:1', // red holed out (the cup holds FIRE): blue rolls into the lit breech, fired on entry
    ]);
    // every press and release of FREE, with the trap moment it caused in the same tick
    const freePlate = STEPS.flatMap((r) =>
      r.events
        .filter((e) => (e.type === 'switchOn' || e.type === 'switchOff') && e.switchId === 'free')
        .map((e) => [e.type, ...r.events.filter((x) => x.type === 'trapFreed' || x.type === 'trapCaught').map((x) => x.type)].join('+')),
    );
    expect(freePlate).toEqual([
      'switchOn', // red rolls over FREE on its way to the jaws: nobody is caught yet
      'switchOff',
      'switchOn+trapFreed', // blue crosses FREE on its way to the jaws
      'switchOff+trapCaught',
      'switchOn+trapFreed', // blue stops on FREE
      'switchOff', // blue leaves FREE for FIRE: red is loaded by then, not caught
    ]);
    const end = STEPS[STEPS.length - 1]!.state;
    expect(end.phase).toBe('levelResults');
    expect(end.balls.every((b) => b.sunk)).toBe(true);
    const hits = ofType(EVENTS, 'ballHit').length;
    const gimmes = ofType(EVENTS, 'gimme').length;
    expect(end.players[0].strokes + end.players[1].strokes).toBe(hits + gimmes + BACK_PENALTY);
  });

  it('R5, turnSkipped order, flightTicks and safe spots hold on every tick; bridgeToggle never fires for a device', () => {
    expectR5(STEPS);
    expectSkipsBeforeTurnStart(STEPS);
    expectFlightTicksInRange(STEPS);
    expectSafeSpotsOnlyWhileFree(machineLevel, FIRST, STEPS);
    expect(ofType(EVENTS, 'bridgeToggle')).toEqual([]);
    // red's own roll through the FIRE dish before it is loaded fires nothing
    const loadAt = STEPS.findIndex((r) => r.events.some((e) => e.type === 'cannonLoad'));
    const fireOnAt = (from: number): number => STEPS.findIndex((r, i) => i > from && r.events.some((e) => e.type === 'switchOn' && e.switchId === 'fire'));
    const early = fireOnAt(-1);
    expect(early).toBeLessThan(loadAt);
    expect(STEPS.slice(early, loadAt).some((r) => r.events.some((e) => e.type === 'cannonFire'))).toBe(false);
    // the partner-fired flight happens on the tick after FIRE is next pressed, during the partner's turn, while the
    // partner is still rolling into the dish (D11: touching FIRE is enough)
    const fireOn = fireOnAt(loadAt);
    expect(STEPS[fireOn + 1]?.events.some((e) => e.type === 'cannonFire' && e.playerId === 0)).toBe(true);
    expect(STEPS[fireOn + 1]?.state.activePlayer).toBe(1);
    expect(STEPS[fireOn]?.state.balls[1].asleep).toBe(false);
  });

  it('runReplay twice is identical, and a run split anywhere (a pass-over press, a turn delay, a partner-fired flight) equals the whole run', () => {
    const a = runReplay(CONFIG, MACHINE_LOG, MACHINE_LOG_TICKS);
    const b = runReplay(CONFIG, MACHINE_LOG, MACHINE_LOG_TICKS);
    expect(JSON.stringify(encodeSnapshot(a.state))).toBe(JSON.stringify(encodeSnapshot(b.state)));
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(STEPS[STEPS.length - 1]?.state);
    // split while blue's roll holds FREE down (red freed in passing), while blue aims, and while blue rolls in the
    // FIRE dish with red in the air: a resumed run carries the switch map the hold band depends on
    const freeOn = STEPS.findIndex((r) => r.events.some((e) => e.type === 'trapFreed'));
    const fired = STEPS.findIndex((r) => r.events.some((e) => e.type === 'cannonFire'));
    const splits = [freeOn + 3, 1000, fired + 3];
    expect(STEPS[freeOn + 2]?.state.switches.free).toBe(true);
    expect(STEPS[freeOn + 2]?.state.balls[1].asleep).toBe(false);
    expect(STEPS[fired + 2]?.state.switches.fire).toBe(true);
    expect(STEPS[fired + 2]?.state.balls.every((ball) => !ball.asleep)).toBe(true);
    for (const split of splits) {
      const half = runReplay(CONFIG, MACHINE_LOG, split);
      let state = half.state;
      const events = [...half.events];
      for (let t = split; t < MACHINE_LOG_TICKS; t += 1) {
        const r = stepSim(state, MACHINE_LOG.filter((e) => e.tick === t).map((e) => e.cmd));
        state = r.state;
        events.push(...r.events);
      }
      expect(state, `split at ${split}`).toEqual(a.state);
      expect(events, `split at ${split}`).toEqual(a.events);
    }
  });

  it('every tick round-trips through the snapshot codec (settled states losslessly, flights within 2 dp)', () => {
    for (const r of STEPS) {
      const snap = encodeSnapshot(r.state);
      expect(snap[snap.length - 1]).toBe(r.state.flightTicks);
      const back = decodeSnapshot(snap, CONFIG);
      expect(encodeSnapshot(back)).toEqual(snap);
      if (r.state.balls.every((b) => b.asleep || b.sunk)) expect(back).toEqual(r.state);
    }
  });
});

describe('snapshot version 2: flightTicks', () => {
  const CONFIG = deviceConfig(cannonLevel);
  const flying = run(stepSim(aimingState(cannonLevel, [parked(200), parked(260)]), shot(0, -0.6, 70)).state, 40).state;

  it('a mid-flight state carries flightTicks as the LAST snapshot element and round-trips it', () => {
    expect(flying.phase).toBe('flying');
    expect(flying.flightTicks).toBe(41);
    const snap = encodeSnapshot(flying);
    expect(snap[0]).toBe(SNAPSHOT_VERSION);
    expect(snap).toHaveLength(12);
    expect(snap[11]).toBe(41);
    expect(decodeSnapshot(snap, CONFIG).flightTicks).toBe(41);
  });

  it('rejects an out-of-range or non-integer flightTicks, and a flightTicks outside a flight', () => {
    const edit = (state: SimState, value: unknown): unknown => {
      const snap: unknown[] = [...(encodeSnapshot(state) as unknown[])];
      snap[11] = value;
      return snap;
    };
    for (const value of [-1, 1.5, FLIGHT_WATCHDOG_TICKS, FLIGHT_WATCHDOG_TICKS + 1, Number.NaN, '5', null]) {
      expect(() => decodeSnapshot(edit(flying, value), CONFIG), String(value)).toThrow(SerializeError);
    }
    expect(decodeSnapshot(edit(flying, FLIGHT_WATCHDOG_TICKS - 1), CONFIG).flightTicks).toBe(FLIGHT_WATCHDOG_TICKS - 1);
    const resting = aimingState(cannonLevel, [parked(200), parked(260)]);
    expect(() => decodeSnapshot(edit(resting, 3), CONFIG)).toThrow(SerializeError);
    expect(decodeSnapshot(edit(resting, 0), CONFIG)).toEqual(resting);
  });

  it('rejects a safe spot on a cannon breech (it would fire, fall and respawn into it forever)', () => {
    const onBreech = aimingState(cannonLevel, [parked(200, { x: 700, y: TEE_Y }), parked(260)]);
    expect(() => decodeSnapshot(encodeSnapshot(onBreech), CONFIG)).toThrow(SerializeError);
    const caughtSpot = aimingState(trapLevel, [parked(750), parked(260)]);
    expect(decodeSnapshot(encodeSnapshot(caughtSpot), deviceConfig(trapLevel))).toEqual(caughtSpot);
  });
});
