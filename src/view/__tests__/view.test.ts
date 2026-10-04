// OWNER: view
// ARCH.md §4 view row + BUILD_DECISIONS D2 sticker words, D7 follow camera clamped to the level, render smoke tests.
import { describe, expect, it } from 'vitest';
import type { BallState, Level, SimEvent, SimState } from '../../sim/types';
import { BALL_RADIUS, DEFAULT_AIM, HOLE_RADIUS, REST_TICKS, TURN_DELAY_TICKS, VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import { drawAim } from '../render/aim';
import { drawSwitch, rectLetter, switchGeometry } from '../render/mechanics';
import { drawTerrain } from '../render/world';
import { renderFrame, type RenderScene } from '../render/index';
import { applySimEvents, cameraFor, createViewState, updateView, type ViewState } from '../view';

const GROUND_Y = 620;

/** One level with every World 1 mechanic kind present (plus spring/bumper/fan, which the view must draw too). */
const mechanicsLevel: Level = {
  id: 'fixture-view-all',
  name: 'Fixture Everything',
  world: 1,
  order: 1,
  par: 8,
  hint: 'fixture',
  aha: 'fixture',
  watchOut: 'fixture',
  mechanicsIntroduced: ['switch'],
  firstPlayer: 0,
  mechanicsPresent: ['sand', 'spring', 'bumper', 'fan', 'colourGate', 'switch', 'bridge', 'blocker'],
  width: 2600,
  height: VIEWPORT_H,
  wind: 0,
  terrain: {
    pieces: [
      { surface: [{ x: 0, y: GROUND_Y }, { x: 400, y: GROUND_Y }, { x: 480, y: 600 }, { x: 700, y: 600 }], baseY: VIEWPORT_H },
      { surface: [{ x: 900, y: 600 }, { x: 2600, y: 600 }], baseY: VIEWPORT_H },
    ],
    gaps: [{ x1: 700, x2: 900 }],
  },
  rects: [
    { kind: 'sand', id: 'bunker', x: 200, y: GROUND_Y, w: 120, h: 16 },
    { kind: 'spring', id: 'boing', x: 560, y: 600, w: 56, h: 14, launch: { x: 120, y: -500 } },
    { kind: 'bumper', id: 'bonk', x: 1000, y: 600, w: 54, h: 12 },
    { kind: 'fan', id: 'lift', x: 1100, y: 300, w: 48, h: 300 },
    { kind: 'colourGate', id: 'red-field', x: 1600, y: 180, w: 20, h: 420, colour: 'red' },
    { kind: 'bridge', id: 'bridge', x: 700, y: 601, w: 200, h: 18, switchIds: ['a', 'deck'] },
    { kind: 'blocker', id: 'door', x: 1800, y: 500, w: 40, h: 100, switchId: 'a', activeWhen: false, label: 'DOOR' },
    { kind: 'blocker', id: 'wall', x: 1800, y: 180, w: 40, h: 320 },
  ],
  switches: [
    { id: 'a', x: 380, w: 70, surfaceY: GROUND_Y, colour: '#b57bee' },
    { id: 'deck', x: 724, w: 152, surfaceY: 601, colour: '#b57bee', label: 'DECK', onRectId: 'bridge' },
  ],
  hole: { x: 2300, rimY: 600, radius: HOLE_RADIUS },
  starts: [
    { x: 100, y: GROUND_Y - BALL_RADIUS },
    { x: 150, y: GROUND_Y - BALL_RADIUS },
  ],
};

function ball(x: number, y: number, extra: Partial<BallState> = {}): BallState {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: { x, y }, ...extra };
}

function stateFor(level: Level, overrides: Partial<SimState> = {}): SimState {
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
    balls: [ball(level.starts[0].x, level.starts[0].y), ball(level.starts[1].x, level.starts[1].y)],
    switches: Object.fromEntries(level.switches.map((s) => [s.id, false])),
    activePlayer: 0,
    turnDelayTicks: 0,
    rng: 1,
    campaign: [],
    ...overrides,
  };
}

function withBall(state: SimState, p: 0 | 1, b: BallState): SimState {
  const balls: [BallState, BallState] = [state.balls[0], state.balls[1]];
  balls[p] = b;
  return { ...state, balls };
}

const ev = <T extends SimEvent['type']>(type: T, body: Omit<Extract<SimEvent, { type: T }>, 'type' | 'tick'>, tick = 10): SimEvent =>
  ({ type, tick, ...body }) as unknown as SimEvent;

/** Where a text was drawn: the last `translate` before its `fillText` (stickers translate to their centre). */
type DrawnText = { text: string; x: number; y: number };

/**
 * Recording 2D context: every method is a no-op that logs its name + args; text is captured for assertions.
 * `stageScale` feeds getTransform so labelScale (phones: 0.3 -> 1.8) can be exercised.
 */
type FakeCtx = { ctx: CanvasRenderingContext2D; texts: string[]; drawn: DrawnText[]; roundRects: number[][]; calls: Map<string, number> };

function fakeCtx(stageScale = 1): FakeCtx {
  const texts: string[] = [];
  const drawn: DrawnText[] = [];
  const roundRects: number[][] = [];
  const calls = new Map<string, number>();
  const props: Record<string | symbol, unknown> = {};
  let origin = { x: 0, y: 0 };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop in props) return props[prop];
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (prop === 'getTransform') return () => ({ a: stageScale, b: 0, c: 0, d: stageScale, e: 0, f: 0 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (prop === 'translate') return (x: number, y: number) => void (origin = { x, y });
      if (prop === 'roundRect') return (...args: number[]) => void roundRects.push(args);
      if (prop === 'fillText' || prop === 'strokeText') {
        return (text: string) => {
          calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
          if (prop === 'fillText') {
            texts.push(text);
            drawn.push({ text, x: origin.x, y: origin.y });
          }
        };
      }
      return () => {
        calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
      };
    },
    set(_t, prop, value) {
      props[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as CanvasRenderingContext2D, texts, drawn, roundRects, calls };
}

/** Sticker box as the renderer measures it with the fake font (8 px/char at any size): text + accent 18 + pad 18, height size + 12. */
function stickerBox(d: DrawnText, sizePx: number, labelScale = 1): { l: number; r: number; t: number; b: number } {
  const w = d.text.length * 8 + 18 + 18;
  const h = sizePx * labelScale + 12;
  return { l: d.x - w / 2, r: d.x + w / 2, t: d.y - h / 2, b: d.y + h / 2 };
}

function boxesIntersect(a: ReturnType<typeof stickerBox>, b: ReturnType<typeof stickerBox>): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

/** Two Doors in miniature: wall at x 920 with a WINDOW gate (350-520) over a DOOR gate (520-640), plates 110 / 190 px wide. */
const twoDoorsLevel: Level = {
  ...mechanicsLevel,
  id: 'fixture-two-doors',
  order: 2,
  mechanicsPresent: ['switch', 'blocker'],
  width: 1800,
  terrain: { pieces: [{ surface: [{ x: 0, y: GROUND_Y }, { x: 1800, y: GROUND_Y }], baseY: VIEWPORT_H }], gaps: [] },
  rects: [
    { kind: 'blocker', id: 'wall-cap', x: 908, y: 200, w: 24, h: 150 },
    { kind: 'blocker', id: 'window-gate', x: 908, y: 350, w: 24, h: 170, switchId: 'window', activeWhen: false, label: 'WINDOW' },
    { kind: 'blocker', id: 'door-gate', x: 908, y: 520, w: 24, h: 120, switchId: 'door', activeWhen: false, label: 'DOOR' },
  ],
  switches: [
    { id: 'door', x: 740, w: 110, surfaceY: GROUND_Y, colour: '#b57bee', label: 'DOOR' },
    { id: 'window', x: 990, w: 190, surfaceY: GROUND_Y, colour: '#b57bee', label: 'WINDOW' },
  ],
  hole: { x: 1680, rimY: GROUND_Y, radius: HOLE_RADIUS },
};

function scene(state: SimState, view: ViewState, extra: Partial<RenderScene> = {}): RenderScene {
  return { state, view, seat: null, device: 'pointer', showAim: false, ...extra };
}

/** Overview camera so every mechanic of the fixture is on screen (off-screen stickers are skipped). */
function overviewOf(level: Level, state: SimState): ViewState {
  const view = createViewState(level, state);
  view.cameraMode = 'overview';
  view.camera = { ...cameraFor(level, state, 'overview') };
  return view;
}

describe('view state: balls', () => {
  it('applySimEvents(fellOffWorld) sets renderBalls[p].snapNextFrame', () => {
    const state = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, state);
    applySimEvents(view, [ev('fellOffWorld', { playerId: 1, pos: { x: 800, y: 900 }, respawnPos: { x: 150, y: 608 }, strokes: 2 })], state);
    expect(view.renderBalls[1].snapNextFrame).toBe(true);
    expect(view.renderBalls[0].snapNextFrame).toBe(false);
  });

  it('updateView with the flag copies next without interpolation and clears it', () => {
    const prev = stateFor(mechanicsLevel);
    const next = withBall(prev, 0, ball(900, 400));
    const view = createViewState(mechanicsLevel, prev);
    view.renderBalls[0].snapNextFrame = true;
    updateView(view, prev, next, 0.5, 1 / 60);
    expect(view.renderBalls[0].pos).toEqual({ x: 900, y: 400 });
    expect(view.renderBalls[0].snapNextFrame).toBe(false);
    updateView(view, prev, next, 0.5, 1 / 60);
    expect(view.renderBalls[0].pos.x).toBeCloseTo(500);
  });

  it('sunk balls never interpolate', () => {
    const prev = stateFor(mechanicsLevel);
    const sunk = ball(mechanicsLevel.hole.x, mechanicsLevel.hole.rimY + 10, { sunk: true });
    const next = withBall(prev, 1, sunk);
    const view = createViewState(mechanicsLevel, prev);
    updateView(view, prev, next, 0.5, 1 / 60);
    expect(view.renderBalls[1].pos).toEqual({ x: sunk.pos.x, y: sunk.pos.y });
  });

  it('gimme hops the render ball to the cup over 0.4 s, then snaps and starts the sink shrink', () => {
    const state = stateFor(mechanicsLevel);
    const near = ball(mechanicsLevel.hole.x - 30, mechanicsLevel.hole.rimY - BALL_RADIUS);
    const s1 = withBall(state, 0, near);
    const view = createViewState(mechanicsLevel, s1);
    updateView(view, s1, s1, 0, 1 / 60);
    applySimEvents(view, [ev('gimme', { playerId: 0, pos: near.pos, strokes: 3 })], s1);
    expect(view.renderBalls[0].hop).not.toBeNull();
    const s2 = withBall(s1, 0, ball(mechanicsLevel.hole.x, mechanicsLevel.hole.rimY + 10, { sunk: true }));
    for (let i = 0; i < 30; i += 1) updateView(view, s2, s2, 0, 1 / 60);
    expect(view.renderBalls[0].hop).toBeNull();
    expect(view.renderBalls[0].sinkT).toBeGreaterThan(0);
    expect(view.gimmeSeen).toBe(true);
  });
});

describe('view state: callouts, golfers, anims', () => {
  it('builds callouts for gimme / sink / fellOffWorld / hazardBlock / nearCup / switch events (max 2 alive)', () => {
    const state = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, state);
    const pos = { x: 500, y: 588 };
    const expectCallout = (e: SimEvent, text: string): void => {
      applySimEvents(view, [e], state);
      const last = view.callouts[view.callouts.length - 1];
      expect(last?.text).toBe(text);
      expect(view.callouts.length).toBeLessThanOrEqual(2);
    };
    expectCallout(ev('gimme', { playerId: 0, pos, strokes: 2 }), 'GIMME! +1');
    expectCallout(ev('sink', { playerId: 1, pos, strokes: 2, speed: 100 }), 'IN THE HOLE!');
    expectCallout(ev('fellOffWorld', { playerId: 0, pos, respawnPos: pos, strokes: 3 }), 'OUT! +1');
    expectCallout(ev('hazardBlock', { playerId: 1, pos, rectId: 'red-field', colour: 'red' }), 'LOCKED!');
    expectCallout(ev('nearCup', { playerId: 0, pos, distance: 60 }), 'SO CLOSE');
    expectCallout(ev('switchOn', { switchId: 'a', byPlayer: 0, pos }), 'SWITCH A HELD');
    expectCallout(ev('switchOn', { switchId: 'deck', byPlayer: 0, pos }), 'DECK HELD');
    expectCallout(ev('bridgeToggle', { rectId: 'door', kind: 'blocker', active: false, switchId: 'a' }), 'DOOR OPEN');
    expectCallout(ev('bridgeToggle', { rectId: 'bridge', kind: 'bridge', active: true, switchId: 'a' }), 'BRIDGE OPEN');
  });

  it('turnStart walks the active golfer to 42 px behind its ball, facing the shot direction', () => {
    const state = stateFor(mechanicsLevel);
    const moved = withBall(state, 0, ball(600, 588));
    const view = createViewState(mechanicsLevel, state);
    applySimEvents(view, [ev('turnStart', { playerId: 0, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false })], moved);
    const g = view.golfers[0];
    expect(g.move).toBe('walk');
    expect(g.walkTo).toEqual({ x: 600 - 42, y: 588 + BALL_RADIUS });
    expect(g.facing).toBe(1);
    for (let i = 0; i < 30; i += 1) updateView(view, moved, moved, 0, 1 / 60);
    expect(g.pos.x).toBeCloseTo(558);
  });

  it('crossing an unbridged gap: hop when the ball crossed it this turn, otherwise a pop (never walks on air)', () => {
    const state = stateFor(mechanicsLevel);
    const crossed = withBall(state, 1, ball(1200, 588));
    const hopView = createViewState(mechanicsLevel, state);
    applySimEvents(hopView, [ev('turnStart', { playerId: 1, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false })], crossed);
    expect(hopView.golfers[1].move).toBe('hop');
    const popView = createViewState(mechanicsLevel, state);
    popView.shotFromX[1] = 1200;
    applySimEvents(popView, [ev('turnStart', { playerId: 1, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false })], crossed);
    expect(popView.golfers[1].move).toBe('pop');
  });

  it('switch / bridge anims tween toward the sim state and ballHit starts the swing + shake', () => {
    const state = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, state);
    const held = { ...state, switches: { a: true, deck: false } };
    for (let i = 0; i < 20; i += 1) updateView(view, held, held, 0, 1 / 60);
    expect(view.switchAnims.get('a')).toBe(1);
    expect(view.rectAnims.get('bridge')).toBe(1);
    expect(view.rectAnims.get('door')).toBe(0);
    applySimEvents(view, [ev('ballHit', { playerId: 0, pos: { x: 100, y: 608 }, angle: -0.7854, power: 80, speed: 520 })], state);
    expect(view.golfers[0].swingT).toBeLessThan(0.1);
    expect(view.shake.t).toBeGreaterThan(0);
    expect(view.particles.length).toBe(8);
  });

  it('the waiting golfer never crowds the active one at a shared tee (>= 64 px apart, off both balls, out of the arc)', () => {
    const balls = [100, 150];
    const clearOfBalls = (x: number): void => {
      for (const b of balls) expect(Math.abs(x - b)).toBeGreaterThanOrEqual(24);
    };
    const state = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, state);
    expect(view.golfers[0].pos.x).toBe(100 - 42);
    expect(Math.abs(view.golfers[1].pos.x - view.golfers[0].pos.x)).toBeGreaterThanOrEqual(64);
    clearOfBalls(view.golfers[1].pos.x);
    // Red aims right from 100: Blue addresses its own ball tightly instead of standing in front of it, in the arc.
    expect(view.golfers[1].pos.x).toBe(150 - 26);
    expect(view.golfers[1].facing).toBe(1);
    const blueTurn: SimState = { ...state, activePlayer: 1 };
    applySimEvents(view, [ev('turnStart', { playerId: 1, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false })], blueTurn);
    // 150 - 42 = 108 would put Blue's shoes on Red's ball at 100: the tight address keeps it clear.
    expect(view.golfers[1].walkTo.x).toBe(150 - 26);
    expect(Math.abs(view.golfers[0].walkTo.x - view.golfers[1].walkTo.x)).toBeGreaterThanOrEqual(64);
    clearOfBalls(view.golfers[0].walkTo.x);
  });

  it('a levelStart for a state already in play (resumed ?state= link, restart) keeps the follow camera', () => {
    const aiming = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, aiming);
    applySimEvents(view, [ev('levelStart', { levelId: mechanicsLevel.id, levelIndex: 0, firstPlayer: 0, restarted: false }, 0)], aiming);
    expect(view.cameraMode).toBe('follow');
  });

  it('levelStart resets everything and puts the camera in overview; playStart returns to follow', () => {
    const state = stateFor(mechanicsLevel, { phase: 'intro' });
    const view = createViewState(mechanicsLevel, state);
    view.particles.push({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, life: 1, maxLife: 1, size: 4, colour: '#fff', gravity: 0, shape: 'disc' });
    applySimEvents(view, [ev('levelStart', { levelId: mechanicsLevel.id, levelIndex: 0, firstPlayer: 0, restarted: false }, 0)], state);
    expect(view.particles).toHaveLength(0);
    expect(view.cameraMode).toBe('overview');
    expect(view.renderBalls[0].snapNextFrame).toBe(true);
    applySimEvents(view, [ev('playStart', { levelId: mechanicsLevel.id }, 1)], { ...state, phase: 'aiming' });
    expect(view.cameraMode).toBe('follow');
  });
});

describe('cameraFor', () => {
  it('follow never pans past the level edges, even while aiming from a tee near the left edge (D7)', () => {
    const aiming = stateFor(mechanicsLevel);
    expect(cameraFor(mechanicsLevel, aiming, 'follow').x).toBe(0);
    const flying = { ...aiming, phase: 'flying' as const };
    expect(cameraFor(mechanicsLevel, flying, 'follow').x).toBe(0);
  });

  it('follow keeps the active ball at 45 % (55 % when aiming left) and clamps to the level', () => {
    const mid = withBall(stateFor(mechanicsLevel), 0, ball(1000, 588));
    expect(cameraFor(mechanicsLevel, mid, 'follow')).toEqual({ x: 1000 - VIEWPORT_W * 0.45, y: 0, zoom: 1 });
    const midLeft: SimState = { ...mid, players: [{ strokes: 0, aim: { angle: -2.4, power: 50 } }, mid.players[1]] };
    expect(cameraFor(mechanicsLevel, midLeft, 'follow').x).toBe(1000 - VIEWPORT_W * 0.55);
    const rightEdge = withBall(stateFor(mechanicsLevel), 0, ball(2550, 588));
    const leftAim: SimState = { ...rightEdge, players: [{ strokes: 0, aim: { angle: -2.4, power: 50 } }, rightEdge.players[1]] };
    expect(cameraFor(mechanicsLevel, leftAim, 'follow').x).toBe(mechanicsLevel.width - VIEWPORT_W);
    expect(cameraFor(mechanicsLevel, rightEdge, 'follow').x).toBe(mechanicsLevel.width - VIEWPORT_W);
  });

  it('a one-screen level never scrolls, so the cup stays in view while aiming from the tee (D7)', () => {
    const oneScreen: Level = { ...mechanicsLevel, id: 'fixture-one-screen', width: VIEWPORT_W, hole: { ...mechanicsLevel.hole, x: 1190 } };
    const aiming = stateFor(oneScreen);
    for (const phase of ['aiming', 'flying'] as const) {
      const cam = cameraFor(oneScreen, { ...aiming, phase }, 'follow');
      expect(cam.x).toBe(0);
      expect(oneScreen.hole.x - cam.x).toBeLessThan(VIEWPORT_W);
    }
  });

  it('the follow target is latched per turn: a drag that swings past vertical never re-targets the world', () => {
    const aiming = withBall(stateFor(mechanicsLevel), 0, ball(1000, 588));
    const view = createViewState(mechanicsLevel, aiming);
    updateView(view, aiming, aiming, 1, 1 / 60);
    const latched = view.cameraTarget.x;
    expect(latched).toBe(1000 - VIEWPORT_W * 0.45);
    const leftAim: SimState = { ...aiming, players: [{ strokes: 0, aim: { angle: -2.4, power: 90 } }, aiming.players[1]] };
    updateView(view, leftAim, leftAim, 1, 1 / 60);
    expect(view.cameraTarget.x).toBe(latched);
    const flying: SimState = { ...leftAim, phase: 'flying' };
    updateView(view, flying, flying, 1, 1 / 60);
    expect(view.cameraTarget.x).toBe(cameraFor(mechanicsLevel, flying, 'follow').x);
    updateView(view, leftAim, leftAim, 1, 1 / 60);
    expect(view.cameraTarget.x).toBe(cameraFor(mechanicsLevel, leftAim, 'follow').x);
    expect(view.cameraTarget.x).not.toBe(latched);
  });

  it('overview fits the whole level and puts the ground at ~70 % height', () => {
    const cam = cameraFor(mechanicsLevel, stateFor(mechanicsLevel), 'overview');
    expect(cam.zoom).toBeCloseTo(VIEWPORT_W / mechanicsLevel.width);
    expect(cam.x).toBe(0);
    expect((mechanicsLevel.hole.rimY - cam.y) * cam.zoom).toBeCloseTo(VIEWPORT_H * 0.7);
  });
});

describe('renderFrame', () => {
  it('draws every mechanic and the D2 sticker words without throwing (fake 2D context)', () => {
    const state = stateFor(mechanicsLevel);
    const view = overviewOf(mechanicsLevel, state);
    view.aimPreview = { points: [{ x: 120, y: 580 }, { x: 140, y: 560 }, { x: 160, y: 545 }, { x: 180, y: 536 }], landing: { x: 400, y: 608 }, outcome: 'rest', playerId: 0, remote: false };
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view, { showAim: true }));
    for (const word of ['SAND', 'SPRING', 'BUMPER', 'FAN', 'RED ONLY', 'BRIDGE · OFF', 'SWITCH A · OFF', 'DOOR · SHUT', 'GIMME ZONE']) {
      expect(texts, word).toContain(word);
    }
    // the 200 px gap is narrower than the one-line pit sticker + 24 px, so it is drawn on two lines
    expect(texts).toContain('OUT OF BOUNDS');
    expect(texts).toContain('+1');
    expect(texts).not.toContain('DECK · OFF');
  });

  it('hides the pit sticker while a solid bridge spans the gap', () => {
    const state = stateFor(mechanicsLevel, { switches: { a: true, deck: false } });
    const view = overviewOf(mechanicsLevel, state);
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    expect(texts).toContain('BRIDGE · ON');
    expect(texts).not.toContain('OUT OF BOUNDS');
  });

  it('aim dots stay full size up to the landing tick even when the landing is higher than the tee', () => {
    const ys = [578, 570, 563, 557, 552, 548, 545, 543, 542, 542, 542, 542];
    const points = ys.map((y, i) => ({ x: 100 + i * 10, y }));
    const preview = { points, landing: points[9]!, outcome: 'rest', playerId: 0 as const, remote: false };
    const { ctx, calls } = fakeCtx();
    drawAim(ctx, { x: 100, y: 578 }, DEFAULT_AIM, preview, 'pointer', true);
    // flight dots at ticks 2, 5, 8 (before the landing at 9) plus one faded roll dot at 11
    expect(calls.get('arc')).toBe(4);
  });

  it('sticker words follow the switch state and the deck plate appears only while its bridge exists', () => {
    const state = stateFor(mechanicsLevel, { switches: { a: true, deck: false } });
    const view = overviewOf(mechanicsLevel, state);
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    expect(texts).toContain('SWITCH A · ON');
    expect(texts).toContain('BRIDGE · ON');
    expect(texts).toContain('DOOR · OPEN');
    expect(texts).toContain('DECK · OFF');
  });

  it('renders remote aim, the partner tag, callouts and the YOU tag in an online seat', () => {
    const state = stateFor(mechanicsLevel, { activePlayer: 1 });
    const view = overviewOf(mechanicsLevel, state);
    view.aimPreview = { points: [{ x: 170, y: 590 }], landing: null, outcome: 'running', playerId: 1, remote: true };
    applySimEvents(view, [ev('sink', { playerId: 0, pos: { x: 2300, y: 588 }, strokes: 2, speed: 90 })], state);
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view, { seat: 0, showAim: true, device: 'keyboard' }));
    expect(texts).toContain('BLUE AIMING');
    expect(texts).toContain('YOU');
    expect(texts).toContain('IN THE HOLE!');
  });

  it('density cap: at most 6 stickers per 1280 px window, decoration labels drop before switch-driven ones', () => {
    const bunkers = Array.from({ length: 7 }, (_, i) => ({ kind: 'sand' as const, id: `s${i}`, x: 100 + i * 90, y: GROUND_Y, w: 60, h: 16 }));
    const dense: Level = { ...mechanicsLevel, rects: [...bunkers, mechanicsLevel.rects[6]!], switches: [mechanicsLevel.switches[0]!] };
    const state = stateFor(dense);
    const view = overviewOf(dense, state);
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    expect(texts.filter((t) => t === 'SAND')).toHaveLength(5);
    expect(texts).toContain('DOOR · SHUT');
    expect(texts).toContain('SWITCH A · OFF');
  });

  it('skips stickers whose anchor is off screen instead of clamping them onto the edge', () => {
    const state = stateFor(mechanicsLevel);
    const view = createViewState(mechanicsLevel, state);
    view.camera = { x: 0, y: 0, zoom: 1 };
    const { ctx, texts } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    expect(texts).toContain('SAND');
    expect(texts).not.toContain('RED ONLY');
    expect(texts).not.toContain('DOOR · SHUT');
  });

  it('draws the pressure plate exactly as wide as its press zone (min 64), tag and lamp at the ends', () => {
    const wide = mechanicsLevel.switches[1]!;
    expect(switchGeometry(wide)).toMatchObject({ baseW: 152, capW: 140, tagX: 724 + 6, lampX: 724 + 152 - 6 });
    expect(switchGeometry({ ...wide, w: 40 }).baseW).toBe(64);
    const plain = mechanicsLevel.switches[0]!;
    const { ctx, roundRects } = fakeCtx();
    drawSwitch(ctx, plain, 0, 'A');
    expect(roundRects[0]?.slice(0, 4)).toEqual([plain.x, plain.surfaceY - 4, plain.w, 14]);
    // a DECK plate is a thin strip on the planks (8 px up + 2 px overlap), never a base + cap
    const deckFirst = roundRects.length;
    drawSwitch(ctx, wide, 0, 'B');
    expect(roundRects[deckFirst]?.slice(0, 4)).toEqual([wide.x, wide.surfaceY - 8, wide.w, 10]);
  });

  it('each plate and the gate it opens carry the same letter (switch index), whatever their labels say', () => {
    const { ctx, texts } = fakeCtx();
    drawTerrain(ctx, twoDoorsLevel);
    expect(texts.filter((t) => t.length === 1)).toEqual(['A', 'B']);
    const gate = (id: string) => twoDoorsLevel.rects.find((r) => r.id === id)!;
    expect(rectLetter(twoDoorsLevel, gate('door-gate'))).toBe('A');
    expect(rectLetter(twoDoorsLevel, gate('window-gate'))).toBe('B');
  });

  it('BRIDGE sits above the beam, the pit sticker stays at y 626 and no label reaches the HUD band (y > 652)', () => {
    const state = withBall(stateFor(mechanicsLevel), 0, ball(700, 588));
    const view = createViewState(mechanicsLevel, state);
    view.camera = { x: 300, y: 0, zoom: 1 };
    const { ctx, drawn } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    const bridge = drawn.find((d) => d.text === 'BRIDGE · OFF');
    const pit = drawn.find((d) => d.text === 'OUT OF BOUNDS');
    expect(bridge?.y).toBeLessThan(601);
    expect(Math.abs((pit?.y ?? 0) - 626)).toBeLessThanOrEqual(15);
    for (const word of ['SPRING', 'BRIDGE · OFF', 'OUT OF BOUNDS', '+1']) {
      const d = drawn.find((t) => t.text === word);
      expect(d, word).toBeDefined();
      expect(stickerBox(d!, word === 'OUT OF BOUNDS' || word === '+1' ? 13 : 15).b, word).toBeLessThanOrEqual(652);
    }
  });

  it('door / window labels hang beside the top post, never over the stripes, and no two labels overlap at labelScale 1.8', () => {
    const state = stateFor(twoDoorsLevel);
    const view = overviewOf(twoDoorsLevel, state);
    const { ctx, drawn } = fakeCtx(0.3);
    renderFrame(ctx, scene(state, view));
    const words = ['WINDOW · SHUT', 'DOOR · SHUT', 'DOOR · OFF', 'WINDOW · OFF'];
    const boxes = words.map((w) => {
      const d = drawn.find((t) => t.text === w);
      expect(d, w).toBeDefined();
      return stickerBox(d!, 15, 1.8);
    });
    const gateLeft = (908 - view.camera.x) * view.camera.zoom;
    expect(boxes[0]!.r).toBeLessThanOrEqual(gateLeft);
    expect(boxes[1]!.r).toBeLessThanOrEqual(gateLeft);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(boxesIntersect(boxes[i]!, boxes[j]!), `${words[i]} vs ${words[j]}`).toBe(false);
    }
  });

  it('a wide plate half off screen keeps its label over the visible half instead of dropping or centring it', () => {
    const state = stateFor(twoDoorsLevel);
    const view = createViewState(twoDoorsLevel, state);
    view.camera = { x: 1085, y: 0, zoom: 1 };
    const { ctx, drawn } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    const d = drawn.find((t) => t.text === 'WINDOW · OFF');
    expect(d).toBeDefined();
    expect(stickerBox(d!, 15).l).toBeGreaterThanOrEqual(0);
    expect(d!.x).toBeLessThanOrEqual(1180 - 1085);
    expect(drawn.find((t) => t.text === 'DOOR · OFF')).toBeUndefined();
  });

  it('keeps the clip budget at or under 8 per frame outside the cached layer', () => {
    const state = stateFor(mechanicsLevel, { switches: { a: true, deck: false } });
    const view = overviewOf(mechanicsLevel, state);
    const { ctx, calls } = fakeCtx();
    renderFrame(ctx, scene(state, view));
    const firstFrameClips = calls.get('clip') ?? 0;
    expect(firstFrameClips).toBeLessThanOrEqual(8);
  });
});
