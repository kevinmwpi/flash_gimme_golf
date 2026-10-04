// OWNER: sim
// ARCH.md §4 switches row + BUILD_DECISIONS D2 (switchIds OR, onRectId deck plates, cupHoldsSwitch, door closing on a ball).
import { describe, expect, it, vi } from 'vitest';
import { evaluateSwitches } from '../physics';
import { createSim, stepSim } from '../sim';
import { isRectActive } from '../terrain';
import type { BallState, Level, PlayerCommand, PlayerId, SimEvent, SimEventType, SimState, StepResult } from '../types';
import { BALL_RADIUS, FALL_PENALTY, REST_TICKS, SUNK_BALL_DROP, SWITCH_CONTACT_TOLERANCE } from '../types';
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

const bridge = gapBridgeLevel.rects[0];
if (bridge === undefined) throw new Error('fixture');

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

  it('a ball rolling across a plate never presses it: a plate is held by a RESTING ball', () => {
    const start = { ...aimingState(gapBridgeLevel, [moving(150, 250), parked(210)]), phase: 'flying' as const };
    const trace = run(start, 400);
    const overNear = trace.results.filter((r) => !r.state.balls[0].asleep && r.state.balls[0].pos.x >= 300 && r.state.balls[0].pos.x <= 400);
    expect(overNear.length).toBeGreaterThan(3);
    for (const r of overNear) expect(r.state.switches.near).toBe(false);
    expect(ofType(trace.events, 'switchOn')).toHaveLength(0);
    expect(ofType(trace.events, 'switchOff')).toHaveLength(0);
    expect(ofType(trace.events, 'bridgeToggle')).toHaveLength(0);
    // it rolls off the plate and stops short of the gap it never bridged
    expect(trace.state.balls[0].asleep).toBe(true);
    expect(trace.state.balls[0].pos.x).toBeGreaterThan(400);
    expect(trace.state.balls[0].pos.x).toBeLessThan(BRIDGE_X1 - BALL_RADIUS);
    expect(ofType(trace.events, 'fellOffWorld')).toHaveLength(0);
  });

  it('a landing presses the plate exactly once, on its ballRest tick, however hard it hits (no chatter through the hops)', () => {
    // 100 px/s into the floor hops 2 px; 700 px/s hops about 48 px (restitution 0.35), far outside SWITCH_CONTACT_TOLERANCE
    for (const vy of [100, 400, 700]) {
      const landing: BallState = { ...moving(350, 0, TEE_Y - 10), vel: { x: 0, y: vy }, grounded: false };
      const start = { ...aimingState(gapBridgeLevel, [landing, parked(210)]), phase: 'flying' as const };
      const trace = run(start, 400);
      const restIndex = trace.results.findIndex((r) => r.events.some((e) => e.type === 'ballRest' && e.playerId === 0));
      const onIndex = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn' && e.switchId === 'near'));
      expect(restIndex, `vy ${vy}`).toBeGreaterThan(0);
      expect(onIndex, `vy ${vy}`).toBe(restIndex);
      expect(ofType(trace.events, 'switchOn')).toHaveLength(1);
      expect(ofType(trace.events, 'switchOff')).toHaveLength(0);
      expect(ofType(trace.events, 'bridgeToggle')).toEqual([expect.objectContaining({ rectId: 'bridge', active: true, switchId: 'near' })]);
      const beforeRest = trace.results.slice(0, restIndex);
      expect(beforeRest.some((r) => !r.state.balls[0].grounded)).toBe(true);
      for (const r of beforeRest) expect(r.state.switches.near).toBe(false);
      expect(trace.state.switches.near).toBe(true);
    }
  });

  it('the hardest landing hops well out of the contact band before it rests, which is what used to chatter the plate', () => {
    const landing: BallState = { ...moving(350, 0, TEE_Y - 10), vel: { x: 0, y: 700 }, grounded: false };
    const start = { ...aimingState(gapBridgeLevel, [landing, parked(210)]), phase: 'flying' as const };
    const trace = run(start, 400);
    const firstGround = trace.results.findIndex((r) => r.state.balls[0].grounded);
    expect(firstGround).toBeGreaterThanOrEqual(0);
    const apex = Math.min(...trace.results.slice(firstGround).map((r) => r.state.balls[0].pos.y));
    expect(TEE_Y - apex).toBeGreaterThan(SWITCH_CONTACT_TOLERANCE);
    expect(ofType(trace.events, 'switchOn')).toHaveLength(1);
    expect(ofType(trace.events, 'switchOff')).toHaveLength(0);
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

  it('a ball parked on a bridge FALLS the tick after the holder leaves and respawns at lastRest with +1 credited to the FALLING ball owner', () => {
    // red holds `near`; blue is parked on the bridge OUTSIDE the deck plate (x 510 < 524) so only red holds it up.
    // A bridge is never permanent ground, so blue's lastRest is still its tee.
    const onBridge: BallState = { ...parked(510), lastRest: { x: 210, y: TEE_Y } };
    const held = run(aimingState(gapBridgeLevel, [parked(350), onBridge], 0, 'local', { near: true, far: false, deck: false }), 1).state;
    expect(held.switches).toEqual({ near: true, far: false, deck: false });
    expect(held.balls[1]).toEqual(onBridge);
    // the holder chips away from the gap (leftwards) so only blue is over the vanished bridge
    const shot: PlayerCommand[] = [{ type: 'setAim', playerId: 0, angle: -2.3562, power: 40 }, { type: 'shoot', playerId: 0 }];
    const trace = run(held, 600, { 0: shot });
    // the plate releases on the shot tick itself: the holder is no longer RESTING, although its bottom is
    // still inside the contact band (the press is a rest test, not a height test)
    const offIndex = trace.results.findIndex((r) => r.events.some((e) => e.type === 'switchOff' && e.switchId === 'near'));
    expect(offIndex).toBe(0);
    const plateY = gapBridgeLevel.switches[0]?.surfaceY ?? GROUND_Y;
    const struck = trace.results[0]!.state.balls[0];
    expect(struck.asleep).toBe(false);
    expect(plateY - (struck.pos.y + BALL_RADIUS)).toBeLessThanOrEqual(SWITCH_CONTACT_TOLERANCE);
    expect(held.switches.near).toBe(true);
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

  it('a deck plate (onRectId) is pressed only while its rect is active and the resting ball ground source is that rect', () => {
    const deckBall = parked(580);
    expect(evaluateSwitches(gapBridgeLevel, { near: true, far: false, deck: false }, [parked(350), deckBall])).toEqual({ near: true, far: false, deck: true });
    // the deck holds itself once pressed (bridge active via `deck`)
    expect(evaluateSwitches(gapBridgeLevel, { near: false, far: false, deck: true }, [parked(150), deckBall])).toEqual({ near: false, far: false, deck: true });
    // bridge inactive: a ball at deck height over the gap stands on nothing
    expect(evaluateSwitches(gapBridgeLevel, { near: false, far: false, deck: false }, [parked(150), deckBall])).toEqual({ near: false, far: false, deck: false });
    // a ball on the near lip (x 510 < 524) stands on the bridge but outside the deck plate
    expect(evaluateSwitches(gapBridgeLevel, { near: true, far: false, deck: false }, [parked(350), parked(510)])).toEqual({ near: true, far: false, deck: false });
    // from a cold start (all false) the deck ball has no support in the stale switches: it is woken on the
    // first tick, lands on the bridge `near` has just raised, and holds the deck once it is RESTING again
    const cold = run(aimingState(gapBridgeLevel, [parked(350), deckBall]), REST_TICKS + 2);
    expect(cold.results[0]?.state.switches).toEqual({ near: true, far: false, deck: false });
    expect(cold.results[0]?.state.balls[1].asleep).toBe(false);
    const deckOn = cold.results.findIndex((r) => r.events.some((e) => e.type === 'switchOn' && e.switchId === 'deck'));
    expect(deckOn).toBe(REST_TICKS);
    expect(cold.results[deckOn]?.events.some((e) => e.type === 'ballRest' && e.playerId === 1)).toBe(true);
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
