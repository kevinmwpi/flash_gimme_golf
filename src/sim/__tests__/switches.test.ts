// OWNER: sim
// ARCH.md §4 switches row + BUILD_DECISIONS D2 (switchIds OR, onRectId deck plates, cupHoldsSwitch, door closing on a ball)
// + D11 (a plate is pressed by any ball on it: down on contact, held through hops, up the tick no ball is on it).
import { describe, expect, it, vi } from 'vitest';
import { evaluateSwitches } from '../physics';
import { createSim, stepSim } from '../sim';
import { isRectActive } from '../terrain';
import type { Aim, BallState, Level, PlayerCommand, PlayerId, PressureSwitch, SimEvent, SimEventType, SimState, StepResult } from '../types';
import {
  BALL_RADIUS,
  FALL_PENALTY,
  GRAVITY,
  GROUND_RESTITUTION,
  PLATE_HOLD_HEIGHT_PX,
  REST_TICKS,
  SHOT_SPEED_PER_POWER,
  SUNK_BALL_DROP,
  SWITCH_CONTACT_TOLERANCE,
} from '../types';
import {
  BRIDGE_X1,
  BRIDGE_X2,
  GROUND_Y,
  blockerLevel,
  cupHoldsLevel,
  fanLevel,
  fixtureConfig,
  gapBridgeLevel,
  gateLevel,
  overhangLevel,
} from './fixtures';

vi.mock('../levels/index', async () => (await import('./fixtures')).fixtureRegistry);

const TEE_Y = GROUND_Y - BALL_RADIUS;

function parked(x: number, y = TEE_Y): BallState {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: { x, y } };
}

function moving(x: number, vx: number, y = TEE_Y): BallState {
  return { pos: { x, y }, vel: { x: vx, y: 0 }, asleep: false, sunk: false, grounded: true, restTicks: 0, lastRest: { x, y } };
}

/**
 * An `aiming` state on `level` with crafted balls. Switches default to all false (as after a restart or a
 * URL load: the first tick recomputes them); pass `switches` to craft a state that is already consistent.
 */
function aimingState(
  level: Level,
  balls: [BallState, BallState],
  activePlayer: PlayerId = 0,
  mode: 'solo' | 'local' = 'local',
  switches?: Record<string, boolean>,
): SimState {
  const intro = createSim(fixtureConfig([level], mode)).state;
  const aiming = stepSim(intro, [{ type: 'continue', playerId: 0 }]).state;
  return { ...aiming, balls, activePlayer, switches: switches ?? aiming.switches };
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

const ofType = <T extends SimEventType>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const shoot = (playerId: PlayerId, aim: Aim): PlayerCommand[] => [
  { type: 'setAim', playerId, ...aim },
  { type: 'shoot', playerId },
];

const bridge = gapBridgeLevel.rects[0];
if (bridge === undefined) throw new Error('fixture');

function plate(id: string): PressureSwitch {
  const sw = gapBridgeLevel.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error('fixture');
  return sw;
}

/** `near`: x 300-400 on the fairway before the gap; `deck`: x 524-636 on the bridge. */
const NEAR = plate('near');
const DECK = plate('deck');

/** How far a ball's bottom is above a plate (negative: below it). */
const heightAbove = (sw: PressureSwitch, ball: Readonly<BallState>): number => sw.surfaceY - (ball.pos.y + BALL_RADIUS);

const overPlate = (sw: PressureSwitch, ball: Readonly<BallState>): boolean => ball.pos.x >= sw.x && ball.pos.x <= sw.x + sw.w;

/**
 * D11 restated from the balls' positions, for a plate on open fairway (nothing but the plate's own piece under
 * it): after every tick the plate is down iff some unsunk ball's centre x is over it with its bottom at most
 * SWITCH_CONTACT_TOLERANCE below it and at most SWITCH_CONTACT_TOLERANCE above it (contact) or, when the plate
 * was already down the tick before, at most PLATE_HOLD_HEIGHT_PX above it (hold).
 */
function expectPlateRule(sw: PressureSwitch, from: SimState, results: readonly StepResult[]): void {
  let down = from.switches[sw.id] === true;
  for (const r of results) {
    const reach = down ? PLATE_HOLD_HEIGHT_PX : SWITCH_CONTACT_TOLERANCE;
    down = r.state.balls.some((b) => !b.sunk && overPlate(sw, b) && heightAbove(sw, b) >= -SWITCH_CONTACT_TOLERANCE && heightAbove(sw, b) <= reach);
    expect(r.state.switches[sw.id], `${sw.id} after tick ${r.state.tick}`).toBe(down);
  }
}

/** Red dropped onto the middle of `near` from 10 px above it at `vy` (red's tee ball parked at 210). */
function landOnNear(vy: number): { start: SimState; trace: Trace } {
  const landing: BallState = { ...moving(350, 0, TEE_Y - 10), vel: { x: 0, y: vy }, grounded: false };
  const start = { ...aimingState(gapBridgeLevel, [landing, parked(210)]), phase: 'flying' as const };
  return { start, trace: run(start, 400) };
}

/** The highest hop after a landing's first touchdown, as the ball's bottom above the plate. */
function firstHop(trace: Trace): number {
  const touchdown = trace.results.findIndex((r) => r.state.balls[0].grounded);
  expect(touchdown).toBeGreaterThanOrEqual(0);
  return Math.max(...trace.results.slice(touchdown).map((r) => heightAbove(NEAR, r.state.balls[0])));
}

describe('switches, bridges, blockers', () => {
  it('a ball resting on a plate => pressed next tick, switchOn emitted once', () => {
    const start = aimingState(gapBridgeLevel, [parked(350), parked(210)]);
    expect(start.switches.near).toBe(false);
    const first = stepSim(start, []);
    expect(first.state.switches.near).toBe(true);
    expect(ofType(first.events, 'switchOn')).toEqual([{ type: 'switchOn', switchId: 'near', byPlayer: 0, pos: { x: 350, y: GROUND_Y }, tick: first.state.tick }]);
    expect(ofType(first.events, 'bridgeToggle')).toEqual([{ type: 'bridgeToggle', rectId: 'bridge', kind: 'bridge', active: true, switchId: 'near', tick: first.state.tick }]);
    const later = run(first.state, 120);
    expect(ofType(later.events, 'switchOn')).toHaveLength(0);
    expect(ofType(later.events, 'bridgeToggle')).toHaveLength(0);
    expect(later.state.phase).toBe('aiming');
  });

  it('a ball rolling across a plate presses it while it is over it and lets it up as it rolls off: switchOn and switchOff once each (D11)', () => {
    const start = { ...aimingState(gapBridgeLevel, [moving(150, 250), parked(210)]), phase: 'flying' as const };
    const trace = run(start, 400);
    const onAt = trace.results.findIndex((r) => overPlate(NEAR, r.state.balls[0]));
    const offAt = trace.results.findIndex((r, i) => i > onAt && !overPlate(NEAR, r.state.balls[0]));
    expect(onAt).toBeGreaterThan(0);
    expect(offAt - onAt).toBeGreaterThan(3);
    // down exactly while the ball's centre is over x 300-400, and the ball rolls (never rests) all that time
    trace.results.forEach((r, i) => expect(r.state.switches.near, `tick ${r.state.tick}`).toBe(i >= onAt && i < offAt));
    for (const r of trace.results.slice(onAt, offAt)) expect(r.state.balls[0].asleep).toBe(false);
    const plateCentre = { x: NEAR.x + NEAR.w / 2, y: NEAR.surfaceY };
    expect(ofType(trace.events, 'switchOn')).toEqual([{ type: 'switchOn', switchId: 'near', byPlayer: 0, pos: plateCentre, tick: trace.results[onAt]?.state.tick }]);
    expect(ofType(trace.events, 'switchOff')).toEqual([{ type: 'switchOff', switchId: 'near', pos: plateCentre, tick: trace.results[offAt]?.state.tick }]);
    expect(ofType(trace.events, 'bridgeToggle')).toEqual([
      expect.objectContaining({ rectId: 'bridge', active: true, switchId: 'near', tick: trace.results[onAt]?.state.tick }),
      expect.objectContaining({ rectId: 'bridge', active: false, switchId: 'near', tick: trace.results[offAt]?.state.tick }),
    ]);
    expectPlateRule(NEAR, start, trace.results);
    // the bridge is up only while the ball is on the plate, 100 px before the gap, so the ball never gets to
    // use it: it rolls off the plate and stops short of the gap
    expect(trace.state.balls[0].asleep).toBe(true);
    expect(trace.state.balls[0].pos.x).toBeGreaterThan(NEAR.x + NEAR.w);
    expect(trace.state.balls[0].pos.x).toBeLessThan(BRIDGE_X1 - BALL_RADIUS);
    expect(trace.state.switches.near).toBe(false);
    expect(ofType(trace.events, 'fellOffWorld')).toHaveLength(0);
  });

  it('a landing presses the plate on its first contact and holds it through every bounce hop: one switchOn, no switchOff (impacts up to 700 px/s)', () => {
    // 100 px/s into the floor hops 2 px; 700 px/s hops about 47 px (restitution 0.35): far outside
    // SWITCH_CONTACT_TOLERANCE, inside PLATE_HOLD_HEIGHT_PX
    for (const vy of [100, 250, 400, 550, 700]) {
      const { start, trace } = landOnNear(vy);
      const contactAt = trace.results.findIndex((r) => heightAbove(NEAR, r.state.balls[0]) <= SWITCH_CONTACT_TOLERANCE);
      const touchdown = trace.results.findIndex((r) => r.state.balls[0].grounded);
      const onAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn' && e.switchId === 'near'));
      const restAt = trace.results.findIndex((r) => r.events.some((e) => e.type === 'ballRest' && e.playerId === 0));
      // down on contact (bottom within the contact tolerance), never later than the touchdown and long before the rest
      expect(onAt, `vy ${vy}`).toBe(contactAt);
      expect(onAt, `vy ${vy}`).toBeLessThanOrEqual(touchdown);
      expect(restAt, `vy ${vy}`).toBeGreaterThan(touchdown);
      // the ball leaves the ground again after its touchdown, and the plate never comes up
      expect(trace.results.slice(touchdown, restAt).some((r) => !r.state.balls[0].grounded), `vy ${vy}`).toBe(true);
      trace.results.forEach((r, i) => expect(r.state.switches.near, `vy ${vy} tick ${r.state.tick}`).toBe(i >= onAt));
      expect(ofType(trace.events, 'switchOn')).toHaveLength(1);
      expect(ofType(trace.events, 'switchOff')).toHaveLength(0);
      expect(ofType(trace.events, 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'bridge', active: true, switchId: 'near' })]);
      expectPlateRule(NEAR, start, trace.results);
    }
  });

  it('the hold band is what keeps a hard landing down; a landing whose hop clears PLATE_HOLD_HEIGHT_PX lets the plate up mid-hop and presses it again on contact', () => {
    // 700 px/s: the first hop leaves the contact band (which used to chatter a door) but stays inside the hold band
    const hard = landOnNear(700);
    expect(firstHop(hard.trace)).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
    expect(firstHop(hard.trace)).toBeLessThanOrEqual(PLATE_HOLD_HEIGHT_PX);
    expect(ofType(hard.trace.events, 'switchOn')).toHaveLength(1);
    expect(ofType(hard.trace.events, 'switchOff')).toHaveLength(0);
    // the edge of the band: an impact whose first hop is about 8 px higher than PLATE_HOLD_HEIGHT_PX
    const vy = Math.ceil(Math.sqrt(2 * GRAVITY * (PLATE_HOLD_HEIGHT_PX + 8)) / GROUND_RESTITUTION);
    const harder = landOnNear(vy);
    expect(firstHop(harder.trace), `vy ${vy}`).toBeGreaterThan(PLATE_HOLD_HEIGHT_PX);
    const { results } = harder.trace;
    const offAt = results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'near'));
    expect(offAt).toBe(results.findIndex((r) => heightAbove(NEAR, r.state.balls[0]) > PLATE_HOLD_HEIGHT_PX));
    const againAt = results.findIndex((r, i) => i > offAt && r.events.some((e) => e.type === 'switchOn' && e.switchId === 'near'));
    expect(againAt).toBe(results.findIndex((r, i) => i > offAt && heightAbove(NEAR, r.state.balls[0]) <= SWITCH_CONTACT_TOLERANCE));
    expect(ofType(harder.trace.events, 'switchOn')).toHaveLength(2);
    expect(ofType(harder.trace.events, 'switchOff')).toHaveLength(1);
    expect(harder.trace.state.switches.near).toBe(true);
    expectPlateRule(NEAR, harder.start, results);
  });

  it('a stall tap keeps the plate down throughout, so the partner parked on the bridge it holds never falls (D11 hold band)', () => {
    // the World 1 stall taps (levels README `stall` pass): straight up at 10 and 15, 80 degrees at 20, 100 degrees at 15
    const taps: Aim[] = [
      { angle: -1.5708, power: 10 },
      { angle: -1.5708, power: 15 },
      { angle: -1.3963, power: 20 },
      { angle: -1.7453, power: 15 },
    ];
    const peaks: number[] = [];
    for (const aim of taps) {
      const label = `${aim.angle}/${aim.power}`;
      const onBridge: BallState = { ...parked(510), lastRest: { x: 210, y: TEE_Y } };
      const held = run(aimingState(gapBridgeLevel, [parked(350), onBridge], 0, 'local', { near: true, far: false, deck: false }), 1).state;
      const trace = run(held, 300, { 0: shoot(0, aim) });
      expect(ofType(trace.events, 'ballHit'), label).toHaveLength(1);
      for (const r of trace.results) expect(r.state.switches.near, `${label} tick ${r.state.tick}`).toBe(true);
      expect(ofType(trace.events, 'switchOff'), label).toEqual([]);
      expect(ofType(trace.events, 'bridgeToggle'), label).toEqual([]);
      expect(ofType(trace.events, 'fellOffWorld'), label).toEqual([]);
      expect(trace.state.balls[1], label).toEqual(onBridge);
      peaks.push(Math.max(...trace.results.map((r) => heightAbove(NEAR, r.state.balls[0]))));
      // the tap lands back on the plate and the turn passes to blue with the bridge still up
      expect(overPlate(NEAR, trace.state.balls[0]), label).toBe(true);
      expect(trace.state.balls[0].asleep, label).toBe(true);
      expect(trace.state.phase, label).toBe('aiming');
      expect(trace.state.activePlayer, label).toBe(1);
      expectPlateRule(NEAR, held, trace.results);
    }
    for (const peak of peaks) expect(peak).toBeLessThanOrEqual(PLATE_HOLD_HEIGHT_PX);
    // three of the four taps rise past the contact band: only the hold band keeps their plate down
    expect(peaks.filter((peak) => peak > SWITCH_CONTACT_TOLERANCE)).toHaveLength(3);
  });

  it('a lob off a plate lets it up the tick the ball rises above PLATE_HOLD_HEIGHT_PX or leaves its x-range, and presses it again on contact', () => {
    const holding = (): SimState => aimingState(gapBridgeLevel, [parked(350), parked(210)], 0, 'local', { near: true, far: false, deck: false });
    // straight up, aimed about 12 px past the hold band (power 50 for 72 px: an 82 px lob), back down onto the plate
    const lobPower = Math.ceil(Math.sqrt(2 * GRAVITY * (PLATE_HOLD_HEIGHT_PX + 12)) / SHOT_SPEED_PER_POWER);
    const start = holding();
    const up = run(start, 300, { 0: shoot(0, { angle: -1.5708, power: lobPower }) });
    const offAt = up.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'near'));
    expect(offAt).toBeGreaterThan(0);
    expect(offAt).toBe(up.results.findIndex((r) => heightAbove(NEAR, r.state.balls[0]) > PLATE_HOLD_HEIGHT_PX));
    expect(overPlate(NEAR, up.results[offAt]!.state.balls[0])).toBe(true);
    const backAt = up.results.findIndex((r, i) => i > offAt && r.events.some((e) => e.type === 'switchOn' && e.switchId === 'near'));
    expect(backAt).toBe(up.results.findIndex((r, i) => i > offAt && heightAbove(NEAR, r.state.balls[0]) <= SWITCH_CONTACT_TOLERANCE));
    // the plate stays up the whole way back down through the hold band: once up, only contact presses it
    const descent = up.results.slice(offAt, backAt);
    expect(descent.some((r) => heightAbove(NEAR, r.state.balls[0]) <= PLATE_HOLD_HEIGHT_PX)).toBe(true);
    for (const r of descent) expect(r.state.switches.near).toBe(false);
    expect(ofType(up.events, 'switchOff')).toHaveLength(1);
    expect(ofType(up.events, 'switchOn')).toHaveLength(1);
    expect(up.state.switches.near).toBe(true);
    expectPlateRule(NEAR, start, up.results);
    // a chip to the left: the plate comes up the tick the ball's centre leaves x 300-400, while the ball is still
    // inside the hold band
    const chipStart = holding();
    const chip = run(chipStart, 300, { 0: shoot(0, { angle: -2.3562, power: 40 }) });
    const chipOff = chip.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'near'));
    expect(chipOff).toBe(chip.results.findIndex((r) => !overPlate(NEAR, r.state.balls[0])));
    expect(heightAbove(NEAR, chip.results[chipOff]!.state.balls[0])).toBeLessThanOrEqual(PLATE_HOLD_HEIGHT_PX);
    expect(heightAbove(NEAR, chip.results[chipOff]!.state.balls[0])).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
    expect(ofType(chip.events, 'switchOn')).toEqual([]);
    expect(chip.state.switches.near).toBe(false);
    expectPlateRule(NEAR, chipStart, chip.results);
  });

  it('a ball flying over a plate it never touches does not press it, even inside the hold band (the band only keeps a plate down)', () => {
    // lobs to the left from x 470, between the plate and the gap: one crosses x 300-400 entirely 29-34 px up
    // (inside the hold band), one crosses the band's edge on its way up
    const lobs: { aim: Aim; insideBand: boolean }[] = [
      { aim: { angle: -2.618, power: 65 }, insideBand: true },
      { aim: { angle: -2.4435, power: 80 }, insideBand: false },
    ];
    for (const { aim, insideBand } of lobs) {
      const label = `${aim.angle}/${aim.power}`;
      const start = aimingState(gapBridgeLevel, [parked(470), parked(210)], 0, 'local', { near: false, far: false, deck: false });
      const trace = run(start, 400, { 0: shoot(0, aim) });
      const heights = trace.results.filter((r) => overPlate(NEAR, r.state.balls[0])).map((r) => heightAbove(NEAR, r.state.balls[0]));
      expect(heights.length, label).toBeGreaterThan(10);
      for (const h of heights) expect(h, label).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
      expect(heights.every((h) => h <= PLATE_HOLD_HEIGHT_PX), label).toBe(insideBand);
      for (const r of trace.results) expect(r.state.switches.near, `${label} tick ${r.state.tick}`).toBe(false);
      expect(ofType(trace.events, 'switchOn'), label).toEqual([]);
      expect(ofType(trace.events, 'bridgeToggle'), label).toEqual([]);
      // it came down beyond the plate and rested there
      expect(trace.state.balls[0].asleep, label).toBe(true);
      expect(trace.state.balls[0].pos.x, label).toBeLessThan(NEAR.x);
    }
  });

  it('a bridge appears exactly when activeWhen matches', () => {
    expect(isRectActive(bridge, { near: false, far: false, deck: false })).toBe(false);
    expect(isRectActive(bridge, { near: true, far: false, deck: false })).toBe(true);
    expect(isRectActive({ ...bridge, activeWhen: false }, { near: true, far: false, deck: false })).toBe(false);
    expect(isRectActive({ ...bridge, activeWhen: false }, { near: false, far: false, deck: false })).toBe(true);
    const door = blockerLevel.rects[0];
    const wall = blockerLevel.rects[1];
    if (door === undefined || wall === undefined) throw new Error('fixture');
    expect(isRectActive(door, { door: false })).toBe(true);
    expect(isRectActive(door, { door: true })).toBe(false);
    expect(isRectActive({ ...door, activeWhen: true }, { door: true })).toBe(true);
    expect(isRectActive(wall, { door: true })).toBe(true);
  });

  it('a ball parked on a bridge FALLS the tick after the holder leaves the plate and respawns at lastRest with +1 credited to the FALLING ball owner', () => {
    // red holds `near`; blue is parked on the bridge OUTSIDE the deck plate (x 510 < 524) so only red holds it up.
    // A bridge is never permanent ground, so blue's lastRest is still its tee.
    const onBridge: BallState = { ...parked(510), lastRest: { x: 210, y: TEE_Y } };
    const held = run(aimingState(gapBridgeLevel, [parked(350), onBridge], 0, 'local', { near: true, far: false, deck: false }), 1).state;
    expect(held.switches).toEqual({ near: true, far: false, deck: false });
    expect(held.balls[1]).toEqual(onBridge);
    // the holder chips away from the gap (leftwards) so only blue is over the vanished bridge
    const shot: PlayerCommand[] = [{ type: 'setAim', playerId: 0, angle: -2.3562, power: 40 }, { type: 'shoot', playerId: 0 }];
    const trace = run(held, 600, { 0: shot });
    // D11: the struck holder keeps the plate down while it is still over it, on the shot tick and every tick
    // after it, until its centre leaves x 300-400; it is still inside the hold band then, so the x-range is
    // what lets the plate up
    const offIndex = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'near'));
    expect(offIndex).toBeGreaterThan(0);
    expect(offIndex).toBe(trace.results.findIndex((r) => !overPlate(NEAR, r.state.balls[0])));
    for (const r of trace.results.slice(0, offIndex)) {
      expect(r.state.switches.near, `tick ${r.state.tick}`).toBe(true);
      expect(r.state.balls[0].asleep).toBe(false);
    }
    expect(trace.results[0]?.events.map((e) => e.type)).toEqual(['ballHit']);
    const leaving = trace.results[offIndex]!.state.balls[0];
    expect(heightAbove(NEAR, leaving)).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
    expect(heightAbove(NEAR, leaving)).toBeLessThanOrEqual(PLATE_HOLD_HEIGHT_PX);
    expectPlateRule(NEAR, held, trace.results);
    const offTick = trace.results[offIndex];
    expect(ofType(offTick?.events ?? [], 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'bridge', active: false })]);
    expect(offTick?.state.balls[1].asleep).toBe(true);
    const nextTick = trace.results[offIndex + 1];
    expect(nextTick?.state.balls[1].asleep).toBe(false);
    expect(nextTick?.state.balls[1].pos.y).toBeGreaterThan(TEE_Y);
    const fell = ofType(trace.events, 'fellOffWorld');
    expect(fell).toHaveLength(1);
    expect(fell[0]).toMatchObject({ playerId: 1, respawnPos: { x: 210, y: TEE_Y }, strokes: FALL_PENALTY });
    expect(trace.state.players[1].strokes).toBe(FALL_PENALTY);
    expect(trace.state.players[0].strokes).toBe(1);
    expect(trace.state.balls[1].pos).toEqual({ x: 210, y: TEE_Y });
    expect(trace.state.balls[1].asleep).toBe(true);
  });

  it('a blocker with switchId vanishes while held', () => {
    const trace = run(aimingState(blockerLevel, [parked(400), parked(160)]), 2);
    expect(trace.state.switches.door).toBe(true);
    const door = blockerLevel.rects[0];
    if (door === undefined) throw new Error('fixture');
    expect(isRectActive(door, trace.state.switches)).toBe(false);
    expect(ofType(trace.events, 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'door', kind: 'blocker', active: false, switchId: 'door' })]);
    // a rolling ball now passes where the door stood
    const open = { ...trace.state, balls: [trace.state.balls[0], moving(700, 300)] as const, phase: 'flying' as const };
    const rolled = run(open, 600).state;
    expect(rolled.balls[1].pos.x).toBeGreaterThan(840 + BALL_RADIUS);
  });

  it('a permanent blocker (no switchId) never emits bridgeToggle', () => {
    const trace = run(aimingState(blockerLevel, [parked(400), moving(1000, 300)]), 600);
    expect(ofType(trace.events, 'bridgeToggle').some((e) => e.rectId === 'wall')).toBe(false);
    expect(trace.state.balls[1].pos.x).toBeLessThan(1200 - BALL_RADIUS);
    expect(trace.events.some((e) => e.type === 'bounce' && e.surface === 'blocker')).toBe(true);
  });

  it('a ball resting on TOP of a blocker / wrong-colour gate stays asleep for 600 ticks (no wake loop)', () => {
    const onWall = run(aimingState(blockerLevel, [parked(100), parked(1220, 440 - BALL_RADIUS)]), 600);
    expect(onWall.state.balls[1]).toEqual(parked(1220, 440 - BALL_RADIUS));
    expect(onWall.state.phase).toBe('aiming');
    const onGate = run(aimingState(gateLevel, [parked(100), parked(720, 440 - BALL_RADIUS)]), 600);
    expect(onGate.state.balls[1]).toEqual(parked(720, 440 - BALL_RADIUS));
    expect(onGate.state.phase).toBe('aiming');
    expect(onGate.events.filter((e) => e.type !== 'commandRejected')).toHaveLength(0);
  });

  it('a ball resting under an overhang stays asleep for 600 ticks', () => {
    const trace = run(aimingState(overhangLevel, [parked(800), parked(160)]), 600);
    expect(trace.state.balls[0]).toEqual(parked(800));
    expect(trace.state.phase).toBe('aiming');
  });

  it('a switch-driven fan activating under a parked ball wakes it', () => {
    const trace = run(aimingState(fanLevel, [parked(350), parked(850)]), 3);
    expect(trace.results[0]?.state.switches['fan-plate']).toBe(true);
    expect(ofType(trace.results[0]?.events ?? [], 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'fan', kind: 'fan', active: true })]);
    expect(trace.results[1]?.state.balls[1].asleep).toBe(false);
    expect(ofType(trace.results[1]?.events ?? [], 'fan')).toEqual([expect.objectContaining({ playerId: 1, rectId: 'fan' })]);
    expect(trace.results[1]?.state.phase).toBe('flying');
    expect(trace.results[2]?.state.balls[1].vel.y).toBeLessThan(0);
  });

  it('the tick a switch changes never also emits turnStart', () => {
    const start = aimingState(gapBridgeLevel, [parked(150), parked(760)]);
    const shot: PlayerCommand[] = [{ type: 'setAim', playerId: 0, angle: -0.7854, power: 48 }, { type: 'shoot', playerId: 0 }];
    const trace = run(start, 900, { 0: shot });
    const switchTicks = trace.results.filter((r) => r.events.some((e) => e.type === 'switchOn' || e.type === 'switchOff'));
    expect(switchTicks.length).toBeGreaterThan(0);
    for (const r of switchTicks) expect(r.events.some((e) => e.type === 'turnStart')).toBe(false);
    expect(ofType(trace.events, 'turnStart').length).toBeGreaterThan(0);
  });

  it('solo (seat 0) can hold with ball 0 and cross with ball 1', () => {
    const start = aimingState(gapBridgeLevel, [parked(350), parked(210)], 1, 'solo');
    const shot: PlayerCommand[] = [{ type: 'setAim', playerId: 1, angle: -0.7854, power: 60 }, { type: 'shoot', playerId: 1 }];
    const trace = run(start, 900, { 1: shot });
    expect(ofType(trace.events, 'commandRejected')).toHaveLength(0);
    expect(ofType(trace.events, 'ballHit')).toEqual([expect.objectContaining({ playerId: 1 })]);
    expect(ofType(trace.events, 'fellOffWorld')).toHaveLength(0);
    expect(trace.state.balls[1].asleep).toBe(true);
    expect(trace.state.balls[1].pos.x).toBeGreaterThan(BRIDGE_X2);
    expect(trace.state.balls[0]).toEqual(parked(350));

    const unheld = aimingState(gapBridgeLevel, [parked(150), parked(210)], 1, 'solo');
    const control = run(unheld, 900, { 1: shot });
    expect(ofType(control.events, 'fellOffWorld')).toEqual([expect.objectContaining({ playerId: 1 })]);
  });

  it('switchIds (OR): the rect is active while ANY listed switch is pressed; bridgeToggle fires once per change', () => {
    expect(isRectActive(bridge, { near: false, far: true, deck: false })).toBe(true);
    expect(isRectActive(bridge, { near: false, far: false, deck: true })).toBe(true);
    expect(isRectActive(bridge, { near: true, far: true, deck: true })).toBe(true);
    let state = aimingState(gapBridgeLevel, [parked(150), parked(210)]);
    const toggles: SimEvent[] = [];
    const place = (balls: [BallState, BallState]): void => {
      const r = stepSim({ ...state, balls }, []);
      toggles.push(...ofType(r.events, 'bridgeToggle'));
      state = r.state;
    };
    place([parked(350), parked(210)]); // near on  -> toggle on
    place([parked(350), parked(800)]); // far on   -> still active, no toggle
    place([parked(150), parked(800)]); // near off -> still active, no toggle
    expect(isRectActive(bridge, state.switches)).toBe(true);
    place([parked(150), parked(210)]); // far off  -> toggle off
    expect(toggles).toEqual([
      expect.objectContaining({ rectId: 'bridge', active: true, switchId: 'near' }),
      expect.objectContaining({ rectId: 'bridge', active: false, switchId: 'far' }),
    ]);
  });

  it('a deck plate (onRectId) is pressed only while its rect is active and the ball ground source is that rect', () => {
    const deckBall = parked(580);
    expect(evaluateSwitches(gapBridgeLevel, { near: true, far: false, deck: false }, [parked(350), deckBall])).toEqual({ near: true, far: false, deck: true });
    // the deck holds itself once pressed (bridge active via `deck`)
    expect(evaluateSwitches(gapBridgeLevel, { near: false, far: false, deck: true }, [parked(150), deckBall])).toEqual({ near: false, far: false, deck: true });
    // bridge inactive: a ball at deck height over the gap stands on nothing
    expect(evaluateSwitches(gapBridgeLevel, { near: false, far: false, deck: false }, [parked(150), deckBall])).toEqual({ near: false, far: false, deck: false });
    // a ball on the near lip (x 510 < 524) stands on the bridge but outside the deck plate
    expect(evaluateSwitches(gapBridgeLevel, { near: true, far: false, deck: false }, [parked(350), parked(510)])).toEqual({ near: true, far: false, deck: false });
    // from a cold start (all false) the deck ball has no support in the stale switches: it is woken on the
    // first tick, and the next tick it lands on the bridge `near` has just raised and presses the deck on that
    // first contact (D11), while it is still moving: it rests REST_TICKS later with the deck already down
    const cold = run(aimingState(gapBridgeLevel, [parked(350), deckBall]), REST_TICKS + 2);
    expect(cold.results[0]?.state.switches).toEqual({ near: true, far: false, deck: false });
    expect(cold.results[0]?.state.balls[1].asleep).toBe(false);
    const deckOn = cold.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn' && e.switchId === 'deck'));
    expect(deckOn).toBe(1);
    expect(cold.results[deckOn]?.state.balls[1]).toMatchObject({ grounded: true, asleep: false });
    expect(ofType(cold.results[deckOn]?.events ?? [], 'switchOn')).toEqual([expect.objectContaining({ switchId: 'deck', byPlayer: 1 })]);
    const restAt = cold.results.findIndex((r) => r.events.some((e) => e.type === 'ballRest' && e.playerId === 1));
    expect(restAt).toBe(REST_TICKS);
    expect(ofType(cold.results[restAt]?.events ?? [], 'switchOn')).toEqual([]);
    for (const r of cold.results.slice(deckOn)) expect(r.state.switches.deck).toBe(true);
    expect(ofType(cold.events, 'switchOff')).toEqual([]);
    expect(cold.state.switches).toEqual({ near: true, far: false, deck: true });
    expect(Math.abs(cold.state.balls[1].pos.y - deckBall.pos.y)).toBeLessThan(0.1);
    expect(ofType(cold.events, 'fellOffWorld')).toHaveLength(0);
    // stepped: red leaves `near`, blue stays parked on the deck -> the bridge never drops
    const held = run(aimingState(gapBridgeLevel, [parked(350), deckBall], 0, 'local', { near: true, far: false, deck: true }), 1).state;
    expect(held.switches).toEqual({ near: true, far: false, deck: true });
    expect(held.balls[1]).toEqual(deckBall);
    const shot: PlayerCommand[] = [{ type: 'setAim', playerId: 0, angle: -0.7854, power: 60 }, { type: 'shoot', playerId: 0 }];
    const trace = run(held, 600, { 0: shot });
    expect(ofType(trace.events, 'bridgeToggle')).toHaveLength(0);
    expect(ofType(trace.events, 'fellOffWorld')).toHaveLength(0);
    expect(trace.state.balls[1]).toEqual(deckBall);
    expect(trace.state.switches.deck).toBe(true);
  });

  it('a deck plate is pressed by a ball ROLLING across the deck, only while it is on it; a lone deck ball keeps its bridge up through its own stall tap (D11)', () => {
    // red holds `near`; blue rolls from the near fairway over the bridge to the far side
    const start = { ...aimingState(gapBridgeLevel, [parked(350), moving(470, 200)], 1, 'local', { near: true, far: false, deck: false }), phase: 'flying' as const };
    const trace = run(start, 400);
    const onAt = trace.results.findIndex((r) => overPlate(DECK, r.state.balls[1]));
    const offAt = trace.results.findIndex((r, i) => i > onAt && !overPlate(DECK, r.state.balls[1]));
    expect(onAt).toBeGreaterThan(0);
    expect(offAt - onAt).toBeGreaterThan(3);
    trace.results.forEach((r, i) => expect(r.state.switches.deck, `tick ${r.state.tick}`).toBe(i >= onAt && i < offAt));
    for (const r of trace.results.slice(onAt, offAt)) expect(r.state.balls[1].asleep).toBe(false);
    expect(ofType(trace.events, 'switchOn')).toEqual([expect.objectContaining({ switchId: 'deck', byPlayer: 1, tick: trace.results[onAt]?.state.tick })]);
    expect(ofType(trace.events, 'switchOff')).toEqual([expect.objectContaining({ switchId: 'deck', tick: trace.results[offAt]?.state.tick })]);
    // `near` holds the bridge throughout, so the deck changes nothing it drives
    expect(ofType(trace.events, 'bridgeToggle')).toEqual([]);
    expect(ofType(trace.events, 'fellOffWorld')).toEqual([]);
    expect(trace.state.balls[1].asleep).toBe(true);
    expect(trace.state.balls[1].pos.x).toBeGreaterThan(BRIDGE_X2);

    // blue alone on the deck holds the bridge it stands on; its stall taps keep the deck (and so the bridge) down
    for (const aim of [{ angle: -1.5708, power: 15 }, { angle: -1.3963, power: 20 }] as const) {
      const alone = aimingState(gapBridgeLevel, [parked(150), parked(580)], 1, 'local', { near: false, far: false, deck: true });
      const tap = run(alone, 200, { 0: shoot(1, aim) });
      expect(Math.max(...tap.results.map((r) => heightAbove(DECK, r.state.balls[1])))).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
      for (const r of tap.results) expect(r.state.switches.deck, `${aim.angle}/${aim.power} tick ${r.state.tick}`).toBe(true);
      expect(ofType(tap.events, 'bridgeToggle')).toEqual([]);
      expect(ofType(tap.events, 'fellOffWorld')).toEqual([]);
      expect(tap.state.balls[1].asleep).toBe(true);
      expect(overPlate(DECK, tap.state.balls[1])).toBe(true);
    }
  });

  it('cupHoldsSwitch: while any ball is sunk the wired switch counts as pressed', () => {
    const sunk: BallState = { ...parked(cupHoldsLevel.hole.x, cupHoldsLevel.hole.rimY + SUNK_BALL_DROP), sunk: true };
    expect(evaluateSwitches(cupHoldsLevel, { door: false }, [parked(100), parked(160)])).toEqual({ door: false });
    expect(evaluateSwitches(cupHoldsLevel, { door: false }, [sunk, parked(160)])).toEqual({ door: true });
    expect(evaluateSwitches(cupHoldsLevel, { door: false }, [parked(100), sunk])).toEqual({ door: true });
    const trace = run(aimingState(cupHoldsLevel, [sunk, parked(160)], 1), 2);
    expect(trace.state.switches.door).toBe(true);
    expect(ofType(trace.results[0]?.events ?? [], 'switchOn')).toEqual([expect.objectContaining({ switchId: 'door', byPlayer: 0 })]);
    expect(ofType(trace.events, 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'door', active: false })]);
    const door = cupHoldsLevel.rects[0];
    if (door === undefined) throw new Error('fixture');
    expect(isRectActive(door, trace.state.switches)).toBe(false);
  });

  it('a ball asleep inside a rect that just became solid is woken and ejected through the nearest face', () => {
    // red holds the door open from the plate; blue is parked in the doorway (door x 800-840)
    const open = run(aimingState(blockerLevel, [parked(400), parked(820)], 0, 'local', { door: true }), 1).state;
    expect(open.switches.door).toBe(true);
    expect(open.balls[1]).toEqual(parked(820));
    // red leaves the plate: the switch releases this tick, the door is solid from the next tick
    const closing = stepSim({ ...open, balls: [parked(150), open.balls[1]] }, []);
    expect(closing.state.switches.door).toBe(false);
    expect(closing.state.balls[1].asleep).toBe(true);
    const ejected = stepSim(closing.state, []);
    expect(ejected.state.balls[1].asleep).toBe(false);
    expect(ejected.state.phase).toBe('flying');
    const settled = run(ejected.state, 300).state;
    const x = settled.balls[1].pos.x;
    expect(x <= 800 - BALL_RADIUS || x >= 840 + BALL_RADIUS).toBe(true);
    expect(settled.balls[1].pos.y).toBeCloseTo(TEE_Y, 0);
    expect(settled.balls[1].asleep).toBe(true);
    expect(settled.phase).toBe('aiming');
  });
});
