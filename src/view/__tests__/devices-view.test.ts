// OWNER: view
// BUILD_DECISIONS D10.4-D10.8: trap and cannon art (fake 2D context with a tracked transform), device callouts
// and their priority, teleport snaps, the camera that follows a device-launched ball through the partner's
// turn (a real-sim partner-fired cannon flight), golfers beside a waiting ball, wires to device hardware, device
// labels and the off-screen ball marker.
import { describe, expect, it, vi } from 'vitest';
import { CANNON_LAUNCH, MACHINE_LOG, MACHINE_LOG_TICKS, cannonLevel, deviceConfig, machineLevel, trapLevel } from '../../sim/__tests__/device-fixtures';
import { level as firstFairway } from '../../sim/levels/w1-01-first-fairway';
import { level as springStep } from '../../sim/levels/w2-05-spring-step';
import { level as boobyTrap } from '../../sim/levels/w2-06-booby-trap';
import { level as loadAndFire } from '../../sim/levels/w2-07-load-and-fire';
import { level as colourLift } from '../../sim/levels/w2-08-colour-lift';
import { level as skyBridge } from '../../sim/levels/w3-10-sky-bridge';
import { level as grandMachine } from '../../sim/levels/w3-12-grand-machine';
import { predictLaunch } from '../../sim/physics';
import { createSim, stepSim } from '../../sim/sim';
import type { BallState, CannonRect, Level, PlayerId, SimEvent, SimState, SpringRect, TrapRect } from '../../sim/types';
import { BALL_RADIUS, DEFAULT_AIM, DT, REST_TICKS, VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import { cannonGeometry, cannonSpan, trapGeometry } from '../render/devices';
import { calloutExtent, drawCallouts } from '../render/effects';
import { layoutStickers, renderFrame, type RenderScene } from '../render/index';
import { chevronTilt, drawRect, drawWire, wirePosts } from '../render/mechanics';
import { PALETTE } from '../render/palette';
import { fairwayYAt } from '../render/surface';
import { applySimEvents, cameraFor, createViewState, updateView, worldToScreen, type ViewState } from '../view';

vi.mock('../../sim/levels/index', async () => (await import('../../sim/__tests__/device-fixtures')).deviceRegistry);

// ---- fixtures -------------------------------------------------------------------------------------------

function rested(x: number, y: number, extra: Partial<BallState> = {}): BallState {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: { x, y }, ...extra };
}

function stateOn(level: Level, overrides: Partial<SimState> = {}): SimState {
  return {
    config: { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' },
    tick: 0,
    phase: 'aiming',
    levelIndex: 0,
    levelId: level.id,
    players: [
      { strokes: 0, aim: DEFAULT_AIM },
      { strokes: 0, aim: DEFAULT_AIM },
    ],
    balls: [rested(level.starts[0].x, level.starts[0].y), rested(level.starts[1].x, level.starts[1].y)],
    switches: Object.fromEntries(level.switches.map((s) => [s.id, false])),
    activePlayer: 0,
    turnDelayTicks: 0,
    rng: 1,
    campaign: [],
    flightTicks: 0,
    ...overrides,
  };
}

function withBalls(state: SimState, b0: BallState, b1: BallState): SimState {
  return { ...state, balls: [b0, b1] };
}

const ev = <T extends SimEvent['type']>(type: T, body: Omit<Extract<SimEvent, { type: T }>, 'type' | 'tick'>, tick = 10): SimEvent =>
  ({ type, tick, ...body }) as unknown as SimEvent;

function rectOf<K extends 'trap' | 'cannon' | 'spring'>(level: Level, kind: K): Extract<Level['rects'][number], { kind: K }> {
  const rect = level.rects.find((r) => r.kind === kind);
  if (rect === undefined) throw new Error(`${level.id} has no ${kind}`);
  return rect as Extract<Level['rects'][number], { kind: K }>;
}

function switchOf(level: Level, id: string): Level['switches'][number] {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`${level.id} has no switch ${id}`);
  return sw;
}

/** Where the follow camera parks for a ball at x: 45 % of the stage, clamped to the level (D7). */
function followX(level: Level, x: number): number {
  return Math.min(level.width - VIEWPORT_W, Math.max(0, x - VIEWPORT_W * 0.45));
}

// ---- recording 2D context with a tracked transform -------------------------------------------------------

type Matrix = readonly [number, number, number, number, number, number];
type Call = { name: string; args: readonly unknown[]; m: Matrix; fillStyle: unknown; strokeStyle: unknown; alpha: unknown };

function mul(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

/** Every call with its args, the transform and styles in force; `stageScale` feeds getTransform (labelScale, HUD scale). */
function recorder(stageScale = 1): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string | symbol, unknown> = { fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const record = (name: string, args: readonly unknown[]): void => {
    calls.push({ name, args, m, fillStyle: props.fillStyle, strokeStyle: props.strokeStyle, alpha: props.globalAlpha });
  };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop in props) return props[prop];
      switch (prop) {
        case 'measureText':
          return (text: string) => ({ width: text.length * 8 });
        case 'getTransform':
          return () => ({ a: stageScale, b: 0, c: 0, d: stageScale, e: 0, f: 0 });
        case 'createLinearGradient':
          return () => ({ addColorStop: () => undefined });
        case 'save':
          return () => void stack.push(m);
        case 'restore':
          return () => void (m = stack.pop() ?? m);
        case 'translate':
          return (x: number, y: number) => void (m = mul(m, [1, 0, 0, 1, x, y]));
        case 'scale':
          return (x: number, y: number) => void (m = mul(m, [x, 0, 0, y, 0, 0]));
        case 'rotate':
          return (a: number) => {
            record('rotate', [a]);
            m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
          };
        default:
          return (...args: unknown[]) => record(String(prop), args);
      }
    },
    set(_t, prop, value) {
      props[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as CanvasRenderingContext2D, calls };
}

/** Where a call's local point lands on the canvas. */
function at(c: Call, x = 0, y = 0): { x: number; y: number } {
  return { x: c.m[0] * x + c.m[2] * y + c.m[4], y: c.m[1] * x + c.m[3] * y + c.m[5] };
}

function scene(state: SimState, view: ViewState): RenderScene {
  return { state, view, seat: null, device: 'pointer', showAim: false };
}

function followView(level: Level, state: SimState, camX: number): ViewState {
  const view = createViewState(level, state);
  view.camera = { x: camX, y: 0, zoom: 1 };
  view.cameraMode = 'follow';
  return view;
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

// ---- callouts ---------------------------------------------------------------------------------------------

describe('device callouts (D10)', () => {
  it('SNAP!, FREE!, BACK +1 / BACK TO TEE +1, LOADED! and BOOM! (at the muzzle); never LOCKED! for a trap', () => {
    const state = stateOn(machineLevel);
    const view = createViewState(machineLevel, state);
    const pos = { x: 600, y: 588 };
    const say = (e: SimEvent): string | undefined => {
      applySimEvents(view, [e], state);
      return view.callouts[view.callouts.length - 1]?.text;
    };
    expect(say(ev('trapCaught', { playerId: 0, pos, rectId: 'snare' }))).toBe('SNAP!');
    expect(say(ev('trapFreed', { playerId: 0, pos, rectId: 'snare' }))).toBe('FREE!');
    expect(say(ev('trapReturn', { playerId: 0, pos, respawnPos: { x: 100, y: 588 }, strokes: 2, toTee: false }))).toBe('BACK +1');
    expect(say(ev('trapReturn', { playerId: 0, pos, respawnPos: { x: 100, y: 588 }, strokes: 3, toTee: true }))).toBe('BACK TO TEE +1');
    const breech = { x: 1200, y: 603 };
    expect(say(ev('cannonLoad', { playerId: 1, pos: breech, rectId: 'cannon' }))).toBe('LOADED!');
    expect(say(ev('cannonFire', { playerId: 1, pos: breech, rectId: 'cannon', launch: CANNON_LAUNCH }))).toBe('BOOM!');
    const boom = view.callouts.find((c) => c.text === 'BOOM!');
    const muzzle = cannonGeometry(rectOf(machineLevel, 'cannon')).muzzle;
    expect(boom?.worldPos).toEqual(muzzle);
    expect(muzzle.x).toBeGreaterThan(breech.x);
    expect(muzzle.y).toBeLessThan(breech.y - BALL_RADIUS);
    expect(view.callouts.map((c) => c.text)).not.toContain('LOCKED!');
  });

  it('a flight timeout is a puff and a snap with no stroke callout; a device bridgeToggle says nothing', () => {
    const state = stateOn(machineLevel);
    const view = createViewState(machineLevel, state);
    applySimEvents(view, [ev('flightTimeout', { playerId: 0, pos: { x: 900, y: 300 }, respawnPos: { x: 100, y: 588 } })], state);
    applySimEvents(view, [ev('bridgeToggle', { rectId: 'snare', kind: 'trap', active: false, switchId: 'free' })], state);
    applySimEvents(view, [ev('bridgeToggle', { rectId: 'cannon', kind: 'cannon', active: true, switchId: 'fire' })], state);
    expect(view.callouts).toHaveLength(0);
    expect(view.particles.length).toBeGreaterThan(0);
    expect(view.renderBalls[0].snapNextFrame).toBe(true);
  });

  it('BOOM! blows a rising smoke puff out of the muzzle and shakes the screen, except under reduced motion', () => {
    const state = stateOn(machineLevel);
    const fire = ev('cannonFire', { playerId: 1, pos: { x: 1200, y: 603 }, rectId: 'cannon', launch: CANNON_LAUNCH });
    const loud = createViewState(machineLevel, state);
    loud.reducedMotion = false;
    applySimEvents(loud, [fire], state);
    expect(loud.shake.t).toBeGreaterThan(0);
    const smoke = loud.particles.filter((p) => p.gravity < 0);
    expect(smoke.length).toBeGreaterThan(3);
    expect(smoke.every((p) => p.vel.x > 0 && p.vel.y < 0)).toBe(true);
    const calm = createViewState(machineLevel, state);
    calm.reducedMotion = true;
    applySimEvents(calm, [fire], state);
    expect(calm.shake.t).toBe(0);
  });

  it('a device moment is never pushed out by a switch or bridge callout (L10: A HELD + BRIDGE OPEN + BOOM! keeps BOOM!)', () => {
    const state = stateOn(skyBridge, { activePlayer: 0 });
    const view = createViewState(skyBridge, state);
    const texts = (): string[] => view.callouts.map((c) => c.text);
    const a = switchOf(skyBridge, 'a');
    applySimEvents(view, [ev('switchOn', { switchId: 'a', byPlayer: 0, pos: { x: 730, y: 404 } }), ev('bridgeToggle', { rectId: 'bridge', kind: 'bridge', active: true, switchId: 'a' })], state);
    expect(texts()).toEqual([`SWITCH ${a.label} HELD`, 'BRIDGE OPEN']);
    applySimEvents(view, [ev('cannonFire', { playerId: 1, pos: { x: 100, y: 588 }, rectId: 'cannon', launch: rectOf(skyBridge, 'cannon').launch })], state);
    expect(texts()).toEqual(['BRIDGE OPEN', 'BOOM!']);
    applySimEvents(view, [ev('switchOn', { switchId: 'b', byPlayer: 1, pos: { x: 1685, y: 404 } })], state);
    expect(texts()).toEqual(['BOOM!', 'SWITCH B HELD']);
    applySimEvents(view, [ev('bridgeToggle', { rectId: 'bridge', kind: 'bridge', active: false, switchId: 'b' })], state);
    expect(texts()).toEqual(['BOOM!', 'BRIDGE GONE']);
    applySimEvents(view, [ev('trapCaught', { playerId: 0, pos: { x: 730, y: 404 }, rectId: 'cannon' })], state);
    expect(texts()).toEqual(['BOOM!', 'SNAP!']);
    applySimEvents(view, [ev('switchOn', { switchId: 'a', byPlayer: 0, pos: { x: 730, y: 404 } })], state);
    expect(texts()).toEqual(['BOOM!', 'SNAP!']);
    applySimEvents(view, [ev('sink', { playerId: 0, pos: { x: 1875, y: 400 }, strokes: 3, speed: 90 })], state);
    expect(texts()).toEqual(['SNAP!', 'IN THE HOLE!']);
  });

  it('a launcher landing on a plate in a sand bowl stacks FIRE HELD above SAND… for its whole life, never over it (L7 far side)', () => {
    const state = stateOn(loadAndFire);
    const view = followView(loadAndFire, state, 680);
    applySimEvents(view, [ev('enterSand', { playerId: 0, pos: { x: 1610, y: 392 }, rectId: 'landing' })], state);
    view.timeSec += 0.25;
    applySimEvents(view, [ev('switchOn', { switchId: 'fire-far', byPlayer: 0, pos: { x: 1640, y: 398 } })], state);
    const centres = (): Map<string, { x: number; y: number }> => {
      const { ctx, calls } = recorder();
      drawCallouts(ctx, view, (p) => worldToScreen(view, p));
      // the colour pass of each outlined text is the fillText at (0, 0) under the callout's own translate
      return new Map(calls.filter((c) => c.name === 'fillText' && c.args[2] === 0).map((c) => [c.args[0] as string, at(c)]));
    };
    for (const age of [0, 0.3]) {
      view.timeSec += age;
      const drawn = centres();
      const sand = drawn.get('SAND…');
      const held = drawn.get('FIRE HELD');
      if (sand === undefined || held === undefined) throw new Error('both callouts are drawn');
      const a = calloutExtent({ text: 'SAND…', sizePx: 28 });
      const b = calloutExtent({ text: 'FIRE HELD', sizePx: 20 });
      expect(Math.abs(sand.x - held.x)).toBeLessThan(a.halfW + b.halfW);
      expect(held.y + b.below, `FIRE HELD clears SAND… ${age} s on`).toBeLessThanOrEqual(sand.y - a.above);
    }
  });
});

// ---- teleports ----------------------------------------------------------------------------------------------

describe('teleports snap the ball locally (D10.4)', () => {
  for (const type of ['trapReturn', 'flightTimeout'] as const) {
    it(`${type}: no interpolation across the jump, the trail is cleared, the ball pops in`, () => {
      const caught = withBalls(stateOn(trapLevel), rested(750, 588, { lastRest: { x: 200, y: 588 } }), rested(260, 588));
      const home = withBalls(caught, rested(200, 588), caught.balls[1]);
      const view = createViewState(trapLevel, caught);
      updateView(view, caught, caught, 1, DT);
      view.trails[0].push({ x: 740, y: 560 }, { x: 750, y: 580 });
      const body = { playerId: 0 as const, pos: { x: 750, y: 588 }, respawnPos: { x: 200, y: 588 } };
      applySimEvents(view, [type === 'trapReturn' ? ev('trapReturn', { ...body, strokes: 2, toTee: false }) : ev('flightTimeout', body)], home);
      const rb = view.renderBalls[0];
      expect(rb.snapNextFrame).toBe(true);
      expect(rb.scale).toBe(0);
      expect(rb.hop).toBeNull();
      expect(view.trails[0]).toHaveLength(0);
      updateView(view, caught, home, 0.5, DT);
      expect(rb.pos).toEqual({ x: 200, y: 588 });
    });
  }
});

// ---- camera ----------------------------------------------------------------------------------------------------

describe('camera follows a device-launched ball (D10.7)', () => {
  it('a partner-fired cannon flight (real sim) is followed until the next turnStart, inside the D7 clamp', () => {
    let state = createSim(deviceConfig(machineLevel)).state;
    const view = createViewState(machineLevel, state);
    let fired: PlayerId | null = null;
    let partnerFired = 0;
    let followedTicks = 0;
    for (let t = 0; t < MACHINE_LOG_TICKS; t += 1) {
      const prev = state;
      const r = stepSim(state, MACHINE_LOG.filter((e) => e.tick === t).map((e) => e.cmd));
      state = r.state;
      applySimEvents(view, r.events, state);
      updateView(view, prev, state, 1, DT);
      for (const e of r.events) {
        if (e.type === 'cannonFire') {
          fired = e.playerId;
          if (e.playerId !== state.activePlayer) partnerFired += 1;
        }
        if (e.type === 'turnStart') fired = null;
      }
      expect(view.cameraTarget.x).toBeGreaterThanOrEqual(0);
      expect(view.cameraTarget.x).toBeLessThanOrEqual(machineLevel.width - VIEWPORT_W);
      if (fired !== null) {
        expect(view.cameraTarget.x, `tick ${t}`).toBe(followX(machineLevel, state.balls[fired].pos.x));
        followedTicks += 1;
      }
    }
    expect(partnerFired).toBeGreaterThan(0);
    expect(followedTicks).toBeGreaterThan(60);
  });

  it('the camera holds the fired ball after it rests and returns to the active ball only at turnStart', () => {
    const level = loadAndFire;
    const flying = stateOn(level, { phase: 'flying', activePlayer: 1, balls: [rested(910, 553), rested(550, 628)], switches: { fire: true, 'fire-far': false } });
    const view = createViewState(level, flying);
    applySimEvents(view, [ev('cannonFire', { playerId: 0, pos: { x: 910, y: 553 }, rectId: 'cannon', launch: rectOf(level, 'cannon').launch })], flying);
    const mid = withBalls(flying, { ...rested(1300, 200), asleep: false, grounded: false }, flying.balls[1]);
    updateView(view, flying, mid, 1, DT);
    expect(view.cameraTarget.x).toBe(followX(level, 1300));
    // it lands on the far FIRE plate: the switch changed, so R5 defers the hand-off to the next settled tick
    const landed = withBalls(flying, rested(1640, 398), flying.balls[1]);
    applySimEvents(view, [ev('ballRest', { playerId: 0, pos: { x: 1640, y: 398 }, onPermanentGround: true }), ev('switchOn', { switchId: 'fire-far', byPlayer: 0, pos: { x: 1640, y: 398 } })], landed);
    updateView(view, mid, landed, 1, DT);
    expect(view.cameraTarget.x).toBe(followX(level, 1640));
    const aiming = { ...landed, phase: 'aiming' as const, activePlayer: 1 as const };
    applySimEvents(view, [ev('turnStart', { playerId: 1, readyInTicks: 27, sameAsBefore: true })], aiming);
    updateView(view, landed, aiming, 1, DT);
    expect(view.cameraTarget.x).toBe(followX(level, 550));
  });

  it('a spring that throws the waiting ball is followed too, and cameraFor keeps its 3-argument form', () => {
    const state = stateOn(cannonLevel, { phase: 'flying', balls: [rested(200, 588), { ...rested(1500, 300), asleep: false }] });
    const view = createViewState(cannonLevel, state);
    applySimEvents(view, [ev('spring', { playerId: 1, pos: { x: 1500, y: 588 }, rectId: 'pad', launch: { x: 100, y: -600 } })], state);
    updateView(view, state, state, 1, DT);
    expect(view.cameraTarget.x).toBe(followX(cannonLevel, 1500));
    expect(cameraFor(cannonLevel, state, 'follow')).toEqual(cameraFor(cannonLevel, state, 'follow', 0));
    expect(cameraFor(cannonLevel, state, 'follow', 1).x).toBe(followX(cannonLevel, 1500));
  });
});

// ---- golfers ------------------------------------------------------------------------------------------------

describe('golfers and devices (D10)', () => {
  it("a caught ball's golfer stands beside it on the ground there, never back at its old safe spot", () => {
    const snare = rectOf(boobyTrap, 'trap');
    const caught = rested(410, 628, { lastRest: { x: 540, y: 608 } });
    const state = withBalls(stateOn(boobyTrap, { activePlayer: 1 }), caught, rested(715, 624));
    const view = createViewState(boobyTrap, state);
    applySimEvents(view, [ev('turnStart', { playerId: 1, readyInTicks: 27, sameAsBefore: false })], state);
    const to = view.golfers[0].walkTo;
    expect(Math.abs(to.x - 410)).toBeLessThanOrEqual(42);
    expect(to.y).toBe(fairwayYAt(boobyTrap, to.x));
    expect(to.y).toBeLessThan(snare.y + snare.h);
  });

  it("a loaded ball's golfer stands beside its cannon", () => {
    const loaded = rested(700, 588, { lastRest: { x: 200, y: 588 } });
    const state = withBalls(stateOn(cannonLevel, { activePlayer: 1 }), loaded, rested(260, 588));
    const view = createViewState(cannonLevel, state);
    applySimEvents(view, [ev('turnStart', { playerId: 1, readyInTicks: 27, sameAsBefore: false })], state);
    expect(Math.abs(view.golfers[0].walkTo.x - 700)).toBeLessThanOrEqual(42);
  });

  it('a ball that rode a cannon across a chasm takes its golfer with a pop, never a long hop', () => {
    const before = withBalls(stateOn(loadAndFire), rested(700, 608), rested(550, 628));
    const after = withBalls(before, rested(1640, 398), before.balls[1]);
    const launched = createViewState(loadAndFire, before);
    applySimEvents(launched, [ev('ballHit', { playerId: 0, pos: { x: 700, y: 608 }, angle: -1, power: 40, speed: 260 })], before);
    applySimEvents(launched, [ev('cannonFire', { playerId: 0, pos: { x: 910, y: 553 }, rectId: 'cannon', launch: rectOf(loadAndFire, 'cannon').launch })], before);
    applySimEvents(launched, [ev('turnStart', { playerId: 0, readyInTicks: 27, sameAsBefore: true })], after);
    expect(launched.golfers[0].move).toBe('pop');
    const lobbed = createViewState(loadAndFire, before);
    applySimEvents(lobbed, [ev('ballHit', { playerId: 0, pos: { x: 700, y: 608 }, angle: -1, power: 40, speed: 260 })], before);
    applySimEvents(lobbed, [ev('turnStart', { playerId: 0, readyInTicks: 27, sameAsBefore: true })], after);
    expect(lobbed.golfers[0].move).toBe('hop');
  });

  it('a waiting golfer keeps out of a trap its ball is not in (L6 tees)', () => {
    const snare = rectOf(boobyTrap, 'trap');
    const view = createViewState(boobyTrap, stateOn(boobyTrap));
    const x = view.golfers[1].pos.x;
    expect(x <= snare.x - 22 || x >= snare.x + snare.w + 22).toBe(true);
  });

  it("the golfer of a ball caught in L12's pit never stands on the cannon's mount (that reads as LOADED): off it, facing its ball", () => {
    const cannon = rectOf(grandMachine, 'cannon');
    const mount = cannonSpan(grandMachine, cannon);
    expect(mount.x1).toBeLessThan(cannon.x);
    expect(mount.x2).toBeGreaterThan(cannon.x + cannon.w);
    for (const caught of [0, 1] as const) {
      const other = caught === 0 ? 1 : 0;
      const balls: [BallState, BallState] = [rested(0, 0), rested(0, 0)];
      balls[caught] = rested(22, 628, { lastRest: grandMachine.starts[caught] });
      balls[other] = rested(grandMachine.starts[other].x, grandMachine.starts[other].y);
      const view = createViewState(grandMachine, stateOn(grandMachine, { activePlayer: other, balls }));
      const g = view.golfers[caught];
      expect(g.pos.x <= mount.x1 - 22 || g.pos.x >= mount.x2 + 22, `${caught === 0 ? 'red' : 'blue'} golfer at ${g.pos.x}`).toBe(true);
      expect(g.pos.y).toBe(fairwayYAt(grandMachine, g.pos.x));
      expect(g.facing).toBe(-1);
    }
    // a LOADED ball's golfer still stands on the mount, beside its cannon
    const loaded = withBalls(stateOn(grandMachine, { activePlayer: 1 }), rested(cannon.x + cannon.w / 2, cannon.y - BALL_RADIUS), rested(350, 608));
    const x = createViewState(grandMachine, loaded).golfers[0].pos.x;
    expect(x > mount.x1 - 22 && x < mount.x2 + 22).toBe(true);
  });

  /** The golfer's body (44 px wide) and so its turn marker (24 px, drawn at its feet) wholly on the stage. */
  const onStage = (view: ViewState, p: PlayerId): boolean => {
    const feet = worldToScreen(view, view.golfers[p].pos);
    return feet.x - 22 >= 0 && feet.x + 22 <= VIEWPORT_W;
  };

  it("L12's pit retry: the freed ball's golfer addresses it from the mount side, facing back at it, on the stage whichever way it aims", () => {
    // the real hand-off (real sim: red lobs 104° / 100 into the pit, blue rolls 20° / 20 onto FIRE)
    const pit = { x: 24.52, y: 627.95 };
    const caught = withBalls(stateOn(grandMachine, { activePlayer: 1 }), rested(pit.x, pit.y, { lastRest: { x: 300, y: 608 } }), rested(350, 608));
    const players: SimState['players'] = [
      { strokes: 1, aim: { angle: -1.8151, power: 100 } },
      { strokes: 1, aim: { angle: -0.3491, power: 20 } },
    ];
    const freed = withBalls(stateOn(grandMachine, { players, switches: { fire: true, door: false, top: false } }), rested(pit.x, pit.y), rested(488.63, 627.95));
    const view = createViewState(grandMachine, caught);
    applySimEvents(
      view,
      [
        ev('switchOn', { switchId: 'fire', byPlayer: 1, pos: { x: 510, y: 640 } }, 411),
        ev('trapFreed', { playerId: 0, pos: pit, rectId: 'pit' }, 411),
        ev('turnStart', { playerId: 0, readyInTicks: 27, sameAsBefore: false }, 412),
      ],
      freed,
    );
    const g = view.golfers[0];
    // red's carried-over leftward lob, then the retry lob back into the cannon (70°) and a flat 45° (it hits the mount)
    for (const aim of [{ angle: -1.8151, power: 100 }, { angle: -1.2217, power: 60 }, { angle: -0.7854, power: 55 }]) {
      const aiming: SimState = { ...freed, players: [{ strokes: 1, aim }, players[1]] };
      for (let i = 0; i < 60; i += 1) updateView(view, aiming, aiming, 1, DT);
      const where = `aim ${aim.angle}: golfer at ${g.pos.x}`;
      expect(view.camera.x, 'the camera never pans past the edge (D7)').toBe(0);
      expect(onStage(view, 0), where).toBe(true);
      expect(g.facing, where).toBe(-1);
      expect(g.pos.x - pit.x, `${where}: off its ball`).toBeGreaterThanOrEqual(26);
      expect(g.walkT, `${where}: settled, no re-stand when the aim swings over`).toBe(1);
    }
  });

  it('a ball deep in a right-edge back bunker, aiming back at the cup, is addressed from the cup side, facing back at it (L5 and World 1)', () => {
    for (const level of [springStep, firstFairway]) {
      const bunker = level.rects.find((r) => r.id === 'back-bunker');
      if (bunker === undefined) throw new Error(`${level.id} has a back bunker`);
      const x = bunker.x + bunker.w - 14;
      const partnerX = level.hole.x - 160;
      const ground = (at: number): number => (fairwayYAt(level, at) ?? level.hole.rimY) - BALL_RADIUS;
      const state = withBalls(stateOn(level), rested(x, ground(x)), rested(partnerX, ground(partnerX)));
      const atCup: SimState = { ...state, players: [{ strokes: 0, aim: { angle: -2.356, power: 40 } }, state.players[1]] };
      const view = createViewState(level, atCup);
      const g = view.golfers[0];
      expect(onStage(view, 0), `${level.id}: golfer at ${g.pos.x}`).toBe(true);
      expect(g.pos.x, level.id).toBeLessThanOrEqual(level.width - 26);
      expect(x - g.pos.x, `${level.id}: in front of its ball, off it`).toBeGreaterThanOrEqual(26);
      expect(g.facing, level.id).toBe(1);
    }
  });
});

// ---- art ---------------------------------------------------------------------------------------------------

describe('device art (D10.4, D10.8)', () => {
  it('a spring plate is as wide as its pad and its chevrons point along the launch', () => {
    const spring: SpringRect = { kind: 'spring', id: 'pad', x: 976, y: 580, w: 64, h: 14, launch: { x: 200, y: -740 } };
    const { ctx, calls } = recorder();
    drawRect(ctx, spring, true, 1);
    expect(calls.some((c) => c.name === 'roundRect' && c.args[0] === 976 && c.args[2] === 64)).toBe(true);
    expect(chevronTilt(spring.launch)).toBeCloseTo(Math.atan2(200, 740));
    expect(calls.some((c) => c.name === 'rotate' && near(c.args[0] as number, Math.atan2(200, 740)))).toBe(true);
  });

  it('a cannon barrel lies along its launch; its fuse lamp is mint while LIT and grey while COLD', () => {
    const cannon: CannonRect = rectOf(cannonLevel, 'cannon');
    const lit = recorder();
    drawRect(lit.ctx, cannon, true, 1);
    expect(lit.calls.some((c) => c.name === 'rotate' && near(c.args[0] as number, Math.atan2(cannon.launch.y, cannon.launch.x)))).toBe(true);
    expect(lit.calls.some((c) => c.name === 'fill' && c.fillStyle === PALETTE.mint)).toBe(true);
    expect(lit.calls.some((c) => c.name === 'fill' && c.fillStyle === PALETTE.iron)).toBe(true);
    const cold = recorder();
    drawRect(cold.ctx, cannon, false, 1);
    expect(cold.calls.some((c) => c.name === 'fill' && c.fillStyle === PALETTE.mint)).toBe(false);
  });

  it('trap jaws are SET (raised, leaning out) while armed and FOLDED FLAT while open', () => {
    const trap: TrapRect = rectOf(trapLevel, 'trap');
    const angles = (set01: number): number[] => {
      const { ctx, calls } = recorder();
      drawRect(ctx, trap, set01 > 0.5, set01);
      return calls.filter((c) => c.name === 'rotate').map((c) => c.args[0] as number);
    };
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    const set = angles(1).map(wrap);
    expect(set.some((a) => near(a, -Math.PI / 2 - 0.6))).toBe(true);
    expect(set.some((a) => near(a, -Math.PI / 2 + 0.6))).toBe(true);
    const flat = angles(0).map(wrap);
    expect(flat.some((a) => near(a, 0))).toBe(true);
    expect(flat.some((a) => near(Math.abs(a), Math.PI))).toBe(true);
  });

  it('jaws close on a caught ball AFTER the balls are drawn (a seat plate can never hide them)', () => {
    const state = withBalls(stateOn(trapLevel, { activePlayer: 1 }), rested(750, 588, { lastRest: { x: 200, y: 588 } }), rested(260, 588));
    const view = followView(trapLevel, state, 100);
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(state, view));
    const ballAt = { x: 750 - 100, y: 588 };
    const ball = calls.findIndex((c) => c.name === 'fill' && c.fillStyle === PALETTE.p1 && near(at(c).x, ballAt.x) && near(at(c).y, ballAt.y));
    const jaw = calls.findIndex((c) => c.name === 'arc' && c.args[2] === 17 && near(at(c).x, ballAt.x) && near(at(c).y, ballAt.y));
    expect(ball).toBeGreaterThanOrEqual(0);
    expect(jaw).toBeGreaterThan(ball);
  });

  it('a cannon shows the dotted arc of its real flight while LOADED (faint) or LIT, never while cold and empty', () => {
    const cannon = rectOf(cannonLevel, 'cannon');
    const flight = predictLaunch(cannonLevel, { fire: true }, { x: cannon.x + cannon.w / 2, y: cannon.y - BALL_RADIUS }, cannon.launch, 1).points;
    const dots = (state: SimState): Call[] => {
      const { ctx, calls } = recorder();
      renderFrame(ctx, scene(state, followView(cannonLevel, state, 300)));
      return calls.filter((c) => c.name === 'arc' && c.args[2] === 3.5);
    };
    expect(dots(stateOn(cannonLevel))).toHaveLength(0);
    const lit = dots(stateOn(cannonLevel, { activePlayer: 1, switches: { fire: true } }));
    expect(lit.length).toBeGreaterThan(10);
    for (const d of lit) expect(flight.some((p) => p.x === d.args[0] && p.y === d.args[1])).toBe(true);
    const loaded = dots(withBalls(stateOn(cannonLevel, { activePlayer: 1 }), rested(700, 588, { lastRest: { x: 200, y: 588 } }), rested(260, 588)));
    expect(loaded.length).toBeGreaterThan(10);
    expect(loaded.every((c) => (c.alpha as number) < (lit[0]?.alpha as number))).toBe(true);
  });

  it("a LOADED cannon's faint arc is the flight it fires on: L10's crosses the bridge its FIRE plate raises and rests on B", () => {
    const cannon = rectOf(skyBridge, 'cannon');
    const plateB = switchOf(skyBridge, 'b');
    const bridge = skyBridge.rects.find((r) => r.kind === 'bridge');
    const gap = skyBridge.terrain.gaps[0];
    if (bridge === undefined || gap === undefined) throw new Error('Sky Bridge has a bridge over its gap');
    const breech = { x: cannon.x + cannon.w / 2, y: cannon.y - BALL_RADIUS };
    // blue waits LOADED in the cold cannon (no plate held, so no bridge), red aims from its tee
    const loaded = withBalls(stateOn(skyBridge, { activePlayer: 0 }), rested(280, 608), rested(breech.x, breech.y, { lastRest: { x: 330, y: 608 } }));
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(loaded, followView(skyBridge, loaded, 0)));
    const dots = calls.filter((c) => c.name === 'arc' && c.args[2] === 3.5).map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
    expect(dots.length).toBeGreaterThan(10);
    // the flight the cannon fires when red rests on A (its first FIRE plate), which raises the bridge too
    const fired = predictLaunch(skyBridge, { a: true, b: false, deck: false }, breech, cannon.launch, 1).points;
    for (const d of dots) expect(fired.some((p) => p.x === d.x && p.y === d.y)).toBe(true);
    const overGap = dots.filter((d) => d.x > gap.x1 && d.x < gap.x2);
    expect(overGap.length).toBeGreaterThan(0);
    for (const d of overGap) expect(d.y, 'never down into the chasm').toBeLessThan(bridge.y);
    const ring = calls.filter((c) => c.name === 'arc' && c.args[2] === 12 && near(c.args[1] as number, plateB.surfaceY - BALL_RADIUS, 2));
    expect(ring).toHaveLength(1);
    const ringX = ring[0]?.args[0] as number;
    expect(ringX).toBeGreaterThanOrEqual(plateB.x);
    expect(ringX).toBeLessThanOrEqual(plateB.x + plateB.w);
  });

  it('wires reach a trap hinge and a cannon fuse lamp; a wire across a chasm stays inside the frame', () => {
    const snare = rectOf(boobyTrap, 'trap');
    const hinges = wirePosts(boobyTrap, snare);
    expect(hinges).toHaveLength(2);
    expect(hinges.map((h) => h.lampY)).toEqual(trapGeometry(boobyTrap, snare).hinges.map((h) => h.y));
    const cannon = rectOf(loadAndFire, 'cannon');
    const [lamp] = wirePosts(loadAndFire, cannon);
    expect(lamp).toEqual({ x: cannonGeometry(cannon).lampPos.x, lampY: cannonGeometry(cannon).lampPos.y });
    const { ctx, calls } = recorder();
    drawWire(ctx, switchOf(loadAndFire, 'fire-far'), wirePosts(loadAndFire, cannon), false, (x) => fairwayYAt(loadAndFire, x));
    const path = calls.filter((c) => c.name === 'moveTo' || c.name === 'lineTo').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
    expect(path.length).toBe(4);
    const [, down, across] = path;
    const gap = loadAndFire.terrain.gaps[0];
    expect(gap).toBeDefined();
    // the run crosses the chasm at the far plate's depth class: 46 px under the deepest REAL fairway between the ends
    expect(down?.y).toBe(across?.y);
    expect(Math.min(down?.x ?? 0, across?.x ?? 0)).toBeLessThan(gap?.x1 ?? 0);
    expect(Math.max(down?.x ?? 0, across?.x ?? 0)).toBeGreaterThan(gap?.x2 ?? 0);
    let deepest = 0;
    for (let x = Math.min(down?.x ?? 0, across?.x ?? 0); x <= Math.max(down?.x ?? 0, across?.x ?? 0); x += 1) deepest = Math.max(deepest, fairwayYAt(loadAndFire, x) ?? 0);
    expect(across?.y).toBeLessThanOrEqual(deepest + 46);
    expect(across?.y).toBeLessThan(VIEWPORT_H - 10);
    expect(path[path.length - 1]).toEqual({ x: lamp?.x, y: lamp?.lampY });
    // a fairway deeper than any shipped hole still keeps the run inside the frame
    const deep = recorder();
    drawWire(deep.ctx, switchOf(loadAndFire, 'fire-far'), wirePosts(loadAndFire, cannon), false, () => 700);
    for (const c of deep.calls.filter((k) => k.name === 'lineTo')) expect(c.args[1] as number).toBeLessThanOrEqual(VIEWPORT_H - 10);
  });

  it('a colour field is striped in its own colour, opaque, so a red field over the sky reads red, not switch-purple (L8, L11)', () => {
    const field = colourLift.rects.find((r) => r.id === 'red-field');
    if (field === undefined) throw new Error('Colour Lift has a red field');
    const { ctx, calls } = recorder();
    drawRect(ctx, field, true, 1);
    const stripes = calls.filter((c) => c.name === 'stroke' && c.strokeStyle === PALETTE.p1 && c.alpha === 1);
    expect(stripes.length).toBeGreaterThan(field.h / 16);
    expect(calls.some((c) => c.name === 'stroke' && String(c.strokeStyle).startsWith('rgba(255,255,255'))).toBe(false);
  });

  it('keeps the clip budget at or under 8 per frame with traps, a seat and a cannon on screen', () => {
    const state = stateOn(grandMachine);
    const view = createViewState(grandMachine, state);
    view.cameraMode = 'overview';
    view.camera = { ...cameraFor(grandMachine, state, 'overview') };
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(state, view));
    expect(calls.filter((c) => c.name === 'clip').length).toBeLessThanOrEqual(8);
  });
});

// ---- labels -------------------------------------------------------------------------------------------------

describe('device labels (D10.8)', () => {
  const texts = (level: Level, state: SimState, camX: number): string[] => layoutStickers(recorder().ctx, state, followView(level, state, camX)).map((s) => s.text);

  it("a device label beside a waiting golfer steps just over its cap, and a device label never dodges below its prop (L6 caught, L10 tee)", () => {
    const snare = rectOf(boobyTrap, 'trap');
    const floorY = trapGeometry(boobyTrap, snare).floorY;
    const caught = withBalls(stateOn(boobyTrap, { activePlayer: 1 }), rested(410, 628, { lastRest: { x: 540, y: 608 } }), rested(590, 608));
    const view = createViewState(boobyTrap, caught);
    view.camera = { ...cameraFor(boobyTrap, caught, 'follow') };
    const trap = layoutStickers(recorder().ctx, caught, view).find((s) => s.key === `rect:${snare.id}`);
    if (trap === undefined) throw new Error('TRAP · ARMED is placed');
    const anchor = floorY - 48;
    expect(trap.y + trap.h / 2, 'never down onto the trap').toBeLessThanOrEqual(floorY - 24);
    // red's golfer stands beside its caught ball: the label clears its cap, about 100 px up, not the 145 px of a full aiming box
    const golfer = view.golfers[0].pos;
    expect(Math.abs(golfer.x - 410)).toBeLessThanOrEqual(42);
    expect(anchor - trap.y).toBeLessThan(100);
    const cannon = rectOf(skyBridge, 'cannon');
    const tee = stateOn(skyBridge, { activePlayer: 1 });
    for (const stageScale of [1, 0.5]) {
      const label = layoutStickers(recorder(stageScale).ctx, tee, followView(skyBridge, tee, 0)).find((s) => s.key === `rect:${cannon.id}`);
      if (label === undefined) throw new Error('CANNON · COLD is placed');
      expect(label.y + label.h / 2, `stage scale ${stageScale}: never down onto the grass under the golfers`).toBeLessThanOrEqual(cannon.y);
    }
  });

  it('TRAP · ARMED / TRAP · OPEN and CANNON · COLD / CANNON · LIT follow the switches', () => {
    expect(texts(trapLevel, stateOn(trapLevel), 100)).toContain('TRAP · ARMED');
    expect(texts(trapLevel, stateOn(trapLevel, { switches: { free: true } }), 100)).toContain('TRAP · OPEN');
    expect(texts(cannonLevel, stateOn(cannonLevel), 100)).toContain('CANNON · COLD');
    expect(texts(cannonLevel, stateOn(cannonLevel, { switches: { fire: true } }), 100)).toContain('CANNON · LIT');
  });

  it('label and pulse keys are namespaced, so a rect and a plate may share an id', () => {
    const shared: Level = {
      ...trapLevel,
      id: 'fixture-shared-id',
      rects: [...trapLevel.rects, { kind: 'blocker', id: 'free', x: 1000, y: 480, w: 40, h: 120, switchIds: ['free'], activeWhen: false, label: 'GATE' }],
    };
    const state = stateOn(shared);
    const view = followView(shared, state, 0);
    const keys = layoutStickers(recorder().ctx, state, view).map((s) => s.key);
    expect(keys).toContain('rect:free');
    expect(keys).toContain('switch:free');
    applySimEvents(view, [ev('switchOn', { switchId: 'free', byPlayer: 0, pos: { x: 420, y: 588 } })], state);
    expect([...view.stickerPulse.keys()]).toEqual(['switch:free']);
  });

  it("a colour field that rises off the top of the screen keeps its label, and its badge under that label, in the visible playfield (L8's red field, 1280 and phone)", () => {
    const field = colourLift.rects.find((r) => r.id === 'red-field');
    if (field === undefined) throw new Error('Colour Lift has a red field');
    expect(field.y).toBeLessThan(0);
    const state = stateOn(colourLift);
    const x = field.x + field.w / 2;
    for (const stageScale of [1, 0.5]) {
      const view = followView(colourLift, state, 640);
      const band = 12 + 48 * Math.min(1.7, Math.max(1, 0.9 / stageScale)) + 8;
      const label = layoutStickers(recorder(stageScale).ctx, state, view).find((s) => s.key === 'rect:red-field');
      if (label === undefined) throw new Error(`RED ONLY is placed at stage scale ${stageScale}`);
      expect(label.text).toBe('RED ONLY');
      expect(label.y - label.h / 2).toBeGreaterThanOrEqual(band);
      const { ctx, calls } = recorder(stageScale);
      renderFrame(ctx, scene(state, view));
      // the badge's paper (76 x 28, over its ink shadow 3 px lower), drawn in world px: camera y 0, zoom 1
      const papers = calls.filter((c) => c.name === 'roundRect' && c.args[0] === x - 38 && c.args[2] === 76 && c.args[3] === 28).map((c) => c.args[1] as number);
      expect(papers.length, `stage scale ${stageScale}`).toBe(2);
      const top = Math.min(...papers);
      expect(top, `badge below RED ONLY at stage scale ${stageScale}`).toBeGreaterThanOrEqual(label.y + label.h / 2);
      expect(top + 28, 'badge above the bottom emitter').toBeLessThanOrEqual(field.y + field.h - 14);
    }
  });

  it("L8's blue field, with the WINDOW standing on it, hangs BLUE ONLY beside the field, never in the window red lobs through", () => {
    const field = colourLift.rects.find((r) => r.id === 'blue-field');
    const window = colourLift.rects.find((r) => r.id === 'window-gate');
    if (field === undefined || window === undefined) throw new Error('Colour Lift has a blue field under its window');
    expect(window.y + window.h).toBe(field.y);
    for (const held of [false, true]) {
      const state = stateOn(colourLift, { activePlayer: 1, switches: { window: held, door: false } });
      for (const stageScale of [1, 0.5]) {
        const label = layoutStickers(recorder(stageScale).ctx, state, followView(colourLift, state, 0)).find((s) => s.key === 'rect:blue-field');
        if (label === undefined) throw new Error('BLUE ONLY is placed');
        const where = `${held ? 'open' : 'shut'} window, stage scale ${stageScale}`;
        const clearOfWindow = label.x + label.w / 2 <= window.x || label.x - label.w / 2 >= window.x + window.w || label.y + label.h / 2 <= window.y || label.y - label.h / 2 >= window.y + window.h;
        expect(clearOfWindow, where).toBe(true);
        expect(label.x + label.w / 2, where).toBeLessThanOrEqual(field.x);
        expect(Math.abs(label.y - (field.y + 4)), `${where}: level with the top emitter`).toBeLessThan(10);
      }
    }
  });
});

// ---- off-screen marker ----------------------------------------------------------------------------------------

describe('off-screen ball marker (D10.7)', () => {
  /** The marker's fills: the player colour under the marker's own translate, in the top part of the stage (y 0-250). */
  const markers = (calls: Call[], colour: string): { x: number; y: number }[] =>
    calls.filter((c) => c.name === 'fill' && c.fillStyle === colour && c.m[1] === 0 && c.m[4] > 0 && c.m[5] > 0 && c.m[5] < 250).map((c) => ({ x: c.m[4], y: c.m[5] }));

  function flyingHigh(x: number, y: number): SimState {
    return withBalls(stateOn(cannonLevel, { phase: 'flying' }), { ...rested(x, y), asleep: false, grounded: false, vel: { x: 0, y: -50 } }, rested(260, 588));
  }

  it('a ball above the top of the frame gets a marker in its colour just below the HUD band; none while it is in view', () => {
    const high = flyingHigh(1000, -60);
    const view = followView(cannonLevel, high, 400);
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(high, view));
    const found = markers(calls, PALETTE.p1);
    expect(found).toHaveLength(2);
    for (const m of found) {
      expect(m.x).toBeCloseTo(600);
      expect(m.y).toBeGreaterThan(68);
      expect(m.y).toBeLessThan(68 + 40);
    }
    const low = flyingHigh(1000, 300);
    const seen = recorder();
    renderFrame(seen.ctx, scene(low, followView(cannonLevel, low, 400)));
    expect(markers(seen.calls, PALETTE.p1)).toHaveLength(0);
  });

  it('it drops below the turn banner while one may be showing over it, and keeps below a HUD-scaled band on a phone', () => {
    const high = flyingHigh(1000, -60);
    const view = followView(cannonLevel, high, 400);
    view.timeSec = 10;
    view.turnAt = 9.5;
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(high, view));
    for (const m of markers(calls, PALETTE.p1)) expect(m.y).toBeGreaterThan(68 + 12 + 72);
    const phone = recorder(0.5);
    renderFrame(phone.ctx, scene(high, followView(cannonLevel, high, 400)));
    const band = 12 + 48 * 1.7 + 8;
    const onPhone = markers(phone.calls, PALETTE.p1);
    expect(onPhone.length).toBeGreaterThan(0);
    // its tip (18 px above its centre, x labelScale 1.8) stays below the HUD-scaled band
    for (const m of onPhone) expect(m.y - 18 * 1.8).toBeGreaterThanOrEqual(band);
  });

  it('a MOVING ball beyond the left or right edge gets an edge marker; a resting one does not', () => {
    const away = withBalls(stateOn(cannonLevel, { phase: 'flying' }), rested(200, 588), { ...rested(2000, 300), asleep: false, grounded: false });
    const { ctx, calls } = recorder();
    renderFrame(ctx, scene(away, followView(cannonLevel, away, 0)));
    const edge = calls.filter((c) => c.name === 'fill' && c.fillStyle === PALETTE.p2 && c.m[1] !== 0);
    expect(edge.length).toBeGreaterThan(0);
    for (const c of edge) expect(c.m[4]).toBeGreaterThan(VIEWPORT_W - 40);
    const resting = withBalls(away, rested(200, 588), rested(2000, 588));
    const still = recorder();
    renderFrame(still.ctx, scene(resting, followView(cannonLevel, resting, 0)));
    expect(still.calls.some((c) => c.name === 'fill' && c.fillStyle === PALETTE.p2 && c.m[1] !== 0)).toBe(false);
  });
});
