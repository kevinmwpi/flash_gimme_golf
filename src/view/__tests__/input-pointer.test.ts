// @vitest-environment jsdom
// OWNER: input-loop
// ARCH.md §4 input-pointer row (BUILD_DECISIONS D1: DRAG_FULL_POWER_PX 240 => move 120 px => power 55),
// UX.md §5.2 (cancel keeps the previous aim; miss feedback) and §4.6 (downward pull room), and
// BUILD_DECISIONS D10.9 (a press anywhere starts the drag from the press point; the band is anchored at
// the ball; D7's compression stays for presses on an edge ball).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BallState, Level, PlayerCommand, PlayerId, SimConfig, SimPhase, SimState, Vec } from '../../sim/types';
import {
  AIM_ANGLE_MAX,
  DRAG_FULL_POWER_PX,
  DRAG_GRAB_RADIUS_PX,
  DRAG_GRAB_RADIUS_TOUCH_PX,
  KEY_POWER_RATE,
  MAX_POWER,
  MIN_TEE_SEPARATION,
  REST_TICKS,
  VIEWPORT_H,
  quantize1,
} from '../../sim/types';
import { dragVisual } from '../GameCanvas';
import { createInputSystem, type InputContext, type InputFrame, type InputSystem } from '../input/index';
import {
  DRAG_EDGE_MARGIN_PX,
  DRAG_MIN_FULL_POWER_PX,
  WRONG_BALL_RADIUS_PX,
  WRONG_BALL_RADIUS_TOUCH_PX,
  fullPowerPx,
  pullReachable,
  stageRoom,
} from '../input/pointer';
import { createViewState, worldToScreen, type ViewState } from '../view';

/**
 * Hand-written flat level so these tests never depend on the LEVELS registry. The surface sits high
 * (y 400) so the canonical pull geometry is tested with no stage-room limit; the low-ball tests move
 * the ball down to where the real levels keep it.
 */
const level: Level = {
  id: 'test-flat',
  name: 'Flat',
  world: 1,
  order: 1,
  par: 4,
  hint: 'hint',
  aha: 'aha',
  watchOut: 'watch out',
  mechanicsIntroduced: ['sand'],
  firstPlayer: 0,
  mechanicsPresent: [],
  width: 1600,
  height: 720,
  wind: 0,
  terrain: { pieces: [{ surface: [{ x: 0, y: 400 }, { x: 1600, y: 400 }], baseY: 720 }], gaps: [] },
  rects: [],
  switches: [],
  hole: { x: 1400, rimY: 400, radius: 16 },
  starts: [{ x: 420, y: 388 }, { x: 520, y: 388 }],
};

/** Stored aims differ from DEFAULT_AIM so a drag that lands on (-PI/4, 55) is a real change. */
const STORED_AIM = { angle: -1.5, power: 30 };
const RESTORE_CMD: PlayerCommand = { type: 'setAim', playerId: 0, angle: -1.5, power: 30 };
/** Where the real levels keep a resting ball (floor at 620): 112 px of stage below it. */
const LOW_BALL_Y = 608;

function restingBall(pos: Vec): BallState {
  return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos };
}

/** `ballX` moves slot 0 (the active ball) only, `ballY` both balls; `phase` defaults to aiming. */
type RigOptions = { ballX?: number; ballY?: number; phase?: SimPhase };

function aimingState(mode: SimConfig['mode'], opts: RigOptions): SimState {
  const config: SimConfig = { playerCount: mode === 'solo' ? 1 : 2, levelIds: [level.id], seed: 7, mode };
  const at = (p: PlayerId): Vec => ({ x: p === 0 ? (opts.ballX ?? level.starts[0].x) : level.starts[1].x, y: opts.ballY ?? level.starts[p].y });
  return {
    config,
    tick: 0,
    phase: opts.phase ?? 'aiming',
    levelIndex: 0,
    levelId: level.id,
    players: [{ strokes: 0, aim: STORED_AIM }, { strokes: 0, aim: STORED_AIM }],
    balls: [restingBall(at(0)), restingBall(at(1))],
    switches: {},
    activePlayer: 0,
    turnDelayTicks: 0,
    rng: 0,
    campaign: [],
    flightTicks: 0,
  };
}

const RECT = { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

type Rig = {
  canvas: HTMLCanvasElement;
  input: InputSystem;
  state: SimState;
  view: ViewState;
  ball: { x: number; y: number };
  poll(nowMs?: number): PlayerCommand[];
  frame(nowMs?: number): InputFrame;
  pointer(type: string, x: number, y: number, init?: PointerEventInit): void;
};

const captured = new Set<number>();

beforeEach(() => {
  const proto = HTMLElement.prototype;
  proto.setPointerCapture = (id: number) => void captured.add(id);
  proto.releasePointerCapture = (id: number) => void captured.delete(id);
  proto.hasPointerCapture = (id: number) => captured.has(id);
});

afterEach(() => {
  document.body.innerHTML = '';
  captured.clear();
  vi.restoreAllMocks();
});

function rig(seats: readonly PlayerId[] = [0], mode: SimConfig['mode'] = 'solo', opts: RigOptions = {}): Rig {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.appendChild(canvas);
  const input = createInputSystem();
  input.attach(canvas);
  const state = aimingState(mode, opts);
  const view = createViewState(level, state);
  const ball = worldToScreen(view, state.balls[state.activePlayer].pos);
  let last = 0;
  const frame = (nowMs = last + 16): InputFrame => {
    const ctx: InputContext = { state, seats, view, canvasRect: RECT, dt: (nowMs - last) / 1000, nowMs };
    last = nowMs;
    return input.poll(ctx);
  };
  const poll = (nowMs?: number): PlayerCommand[] => frame(nowMs).commands;
  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y, bubbles: true, ...init }),
    );
  };
  return { canvas, input, state, view, ball, poll, frame, pointer };
}

describe('pointer drag-to-aim', () => {
  it('press at the ball, move 120 px to the lower-left => angle -PI/4 (quantised -0.7854), power 55', () => {
    const r = rig();
    const s = 120 / Math.SQRT2;
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - s, r.ball.y + s);
    const cmds = r.poll();
    expect(cmds).toEqual([{ type: 'setAim', playerId: 0, angle: -0.7854, power: 55 }]);
    expect(r.input.localAim()).toEqual({ angle: -0.7854, power: 55 });
  });

  it('move 10 px => no command (dead zone), but the frame reports the drag in its cancel ring', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 7, r.ball.y + 7);
    const frame = r.frame();
    expect(frame.commands).toEqual([]);
    expect(frame.drag).toEqual({ offset: { x: -7, y: 7 }, cancel: true, clamped: false });
    expect(frame.device).toBe('pointer');
    expect(frame.miss).toBeNull();
  });

  it('release inside the cancel radius => no shoot, and one setAim restores the aim held before the drag', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 100, r.ball.y + 100);
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: -0.7854, power: 63 }]);
    r.pointer('pointermove', r.ball.x - 10, r.ball.y + 10);
    r.pointer('pointerup', r.ball.x - 10, r.ball.y + 10);
    expect(r.poll()).toEqual([RESTORE_CMD]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
    expect(r.poll()).toEqual([]);
  });

  it('release outside => one setAim then one shoot, in that order, within the same frame', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 60, r.ball.y + 60);
    expect(r.poll().map((c) => c.type)).toEqual(['setAim']);
    r.pointer('pointermove', r.ball.x - 150, r.ball.y + 90);
    r.pointer('pointerup', r.ball.x - 150, r.ball.y + 90);
    const cmds = r.poll();
    expect(cmds.map((c) => c.type)).toEqual(['setAim', 'shoot']);
    const aim = cmds[0];
    if (aim?.type !== 'setAim') throw new Error('expected setAim');
    expect(aim.angle).toBeCloseTo(-Math.atan2(90, 150), 4);
    expect(aim.power).toBe(10 + Math.round((Math.sqrt(150 * 150 + 90 * 90) / 240) * 90 * 10) / 10);
    expect(r.poll()).toEqual([]);
  });

  it('a quick tap on the ball never shoots', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointerup', r.ball.x + 3, r.ball.y + 2);
    expect(r.poll()).toEqual([]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
  });

  it('a touch press near the ball reports device touch and measures the pull from the press point', () => {
    const r = rig();
    const dx = DRAG_GRAB_RADIUS_TOUCH_PX - 4;
    r.pointer('pointerdown', r.ball.x + dx, r.ball.y, { pointerType: 'touch' });
    r.pointer('pointermove', r.ball.x + dx - 120, r.ball.y, { pointerType: 'touch' });
    const frame = r.frame();
    expect(frame.device).toBe('touch');
    expect(frame.commands).toEqual([{ type: 'setAim', playerId: 0, angle: -0.03, power: 55 }]);
  });

  it('a pull that would aim downward clamps to the nearer horizontal bound', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 100, r.ball.y - 30);
    const cmd = r.poll()[0];
    if (cmd?.type !== 'setAim') throw new Error('expected setAim');
    expect(cmd.angle).toBe(-0.03);
  });

  it("produces no gameplay commands on the partner's turn", () => {
    const r = rig([1], 'local');
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 100, r.ball.y + 100);
    r.pointer('pointerup', r.ball.x - 100, r.ball.y + 100);
    expect(r.poll()).toEqual([]);
    expect(r.input.localAim()).toBeNull();
  });

  it('a second pointer during the drag cancels it and restores the previous aim', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y, { pointerType: 'touch' });
    r.pointer('pointermove', r.ball.x - 100, r.ball.y + 100, { pointerType: 'touch' });
    expect(r.poll()).toHaveLength(1);
    r.pointer('pointerdown', r.ball.x + 300, r.ball.y, { pointerId: 2, pointerType: 'touch' });
    r.pointer('pointerup', r.ball.x - 100, r.ball.y + 100, { pointerType: 'touch' });
    expect(r.poll()).toEqual([RESTORE_CMD]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
  });

  it('window blur mid-drag cancels and restores the previous aim', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 100, r.ball.y + 100);
    expect(r.poll()).toHaveLength(1);
    window.dispatchEvent(new Event('blur'));
    expect(r.poll()).toEqual([RESTORE_CMD]);
    expect(r.frame().drag).toBeNull();
  });
});

describe('press anywhere on the stage (BUILD_DECISIONS D10.9)', () => {
  it('a press away from the ball starts a drag measured from the press point: the same pull makes the same shot as from the ball', () => {
    const fromBall = rig();
    fromBall.pointer('pointerdown', fromBall.ball.x, fromBall.ball.y);
    fromBall.pointer('pointermove', fromBall.ball.x - 150, fromBall.ball.y + 90);
    fromBall.pointer('pointerup', fromBall.ball.x - 150, fromBall.ball.y + 90);
    const expected = fromBall.poll();
    expect(expected.map((c) => c.type)).toEqual(['setAim', 'shoot']);

    const r = rig();
    const down = { x: r.ball.x + DRAG_GRAB_RADIUS_PX + 300, y: r.ball.y - 200 };
    r.pointer('pointerdown', down.x, down.y);
    const first = r.frame();
    expect(first.miss).toBeNull();
    expect(first.commands).toEqual([]);
    expect(first.drag).toEqual({ offset: { x: 0, y: 0 }, cancel: true, clamped: false });
    r.pointer('pointermove', down.x - 150, down.y + 90);
    r.pointer('pointerup', down.x - 150, down.y + 90);
    expect(r.poll()).toEqual(expected);
  });

  it('a ball at the left stage edge: a press in open space pulls on the full 240 px scale up to power 100 (the playtest complaint)', () => {
    const r = rig([0], 'solo', { ballX: 20, ballY: LOW_BALL_Y });
    expect(r.ball).toEqual({ x: 20, y: LOW_BALL_Y });
    // From the ball itself only 20 px of stage lie to its left: a flat full-power drive cannot be pulled.
    expect(pullReachable(r.ball, { angle: AIM_ANGLE_MAX, power: MAX_POWER })).toBe(false);
    const down = { x: 700, y: 300 };
    r.pointer('pointerdown', down.x, down.y);
    r.pointer('pointermove', down.x - DRAG_FULL_POWER_PX / 2, down.y);
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: 55 }]);
    r.pointer('pointermove', down.x - DRAG_FULL_POWER_PX, down.y);
    r.pointer('pointerup', down.x - DRAG_FULL_POWER_PX, down.y);
    expect(r.poll()).toEqual([
      { type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: MAX_POWER },
      { type: 'shoot', playerId: 0 },
    ]);
  });

  it("World 1's first tee (90 px from the edge): a press on the ball keeps D7's compression, a press in open space the 240 px scale", () => {
    const r = rig([0], 'solo', { ballX: 90, ballY: LOW_BALL_Y });
    expect(fullPowerPx(stageRoom(r.ball, { x: -1, y: 0 }))).toBe(84);
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 60, r.ball.y);
    // 60 px of an 84 px full-power pull: 10 + 60 / 84 * 90.
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: 74.3 }]);
    r.pointer('pointerup', r.ball.x - 3, r.ball.y);
    expect(r.poll()).toEqual([RESTORE_CMD]);
    r.pointer('pointerdown', 700, 300);
    r.pointer('pointermove', 700 - 60, 300);
    // The same 60 px pulled in open space: 10 + 60 / 240 * 90.
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: 32.5 }]);
  });

  it('a press high on the stage keeps the 240 px scale for a steep lob from a floor ball (no bottom-edge compression)', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    r.pointer('pointerdown', r.ball.x, 200);
    r.pointer('pointermove', r.ball.x, 320);
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: -1.5708, power: 55 }]);
  });

  it('a tap away from the ball never shoots and is no miss (mouse or touch, decided before or after the release)', () => {
    for (const pointerType of ['mouse', 'touch']) {
      const r = rig();
      r.pointer('pointerdown', r.ball.x + 300, r.ball.y - 150, { pointerType });
      expect(r.frame().miss, pointerType).toBeNull();
      r.pointer('pointerup', r.ball.x + 303, r.ball.y - 148, { pointerType });
      expect(r.poll(), pointerType).toEqual([]);
      r.pointer('pointerdown', r.ball.x - 250, r.ball.y - 100, { pointerType });
      r.pointer('pointerup', r.ball.x - 245, r.ball.y - 104, { pointerType });
      const quick = r.frame();
      expect(quick.commands, pointerType).toEqual([]);
      expect(quick.miss, pointerType).toBeNull();
      expect(r.input.localAim(), pointerType).toEqual(STORED_AIM);
    }
  });

  it('a drag held inside the dead zone emits nothing, frame after frame, and never shoots', () => {
    const r = rig();
    const down = { x: r.ball.x + 300, y: r.ball.y - 150 };
    r.pointer('pointerdown', down.x, down.y);
    for (let i = 1; i <= 5; i += 1) {
      r.pointer('pointermove', down.x - 4 * i, down.y + 2 * i);
      const frame = r.frame();
      expect(frame.commands).toEqual([]);
      expect(frame.drag).toEqual({ offset: { x: -4 * i, y: 2 * i }, cancel: true, clamped: false });
    }
    r.pointer('pointerup', down.x - 20, down.y + 10);
    expect(r.poll()).toEqual([]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
  });

  it('an off-ball drag released back at its press point cancels: no shot, the aim held before the drag restored', () => {
    const r = rig();
    const down = { x: r.ball.x + 300, y: r.ball.y - 150 };
    r.pointer('pointerdown', down.x, down.y);
    r.pointer('pointermove', down.x - 150, down.y + 90);
    expect(r.poll().map((c) => c.type)).toEqual(['setAim']);
    r.pointer('pointermove', down.x - 10, down.y + 10);
    const back = r.frame();
    expect(back.commands).toEqual([]);
    expect(back.drag).toEqual({ offset: { x: -10, y: 10 }, cancel: true, clamped: false });
    r.pointer('pointerup', down.x - 10, down.y + 10);
    expect(r.poll()).toEqual([RESTORE_CMD]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
  });

  it('a touch drag off the ball aims and shoots from the press point and reports device touch', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    const down = { x: r.ball.x + 200, y: 300 };
    r.pointer('pointerdown', down.x, down.y, { pointerType: 'touch' });
    const frame = r.frame();
    expect(frame.miss).toBeNull();
    expect(frame.device).toBe('touch');
    r.pointer('pointermove', down.x - 120, down.y, { pointerType: 'touch' });
    r.pointer('pointerup', down.x - 120, down.y, { pointerType: 'touch' });
    expect(r.poll()).toEqual([
      { type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: 55 },
      { type: 'shoot', playerId: 0 },
    ]);
  });

  it('a touch swipe off the ball that comes back inside the cancel ring never shoots and restores the aim', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    const down = { x: r.ball.x + 200, y: VIEWPORT_H - 120 };
    r.pointer('pointerdown', down.x, down.y, { pointerType: 'touch' });
    r.pointer('pointermove', down.x - 120, down.y + 40, { pointerType: 'touch' });
    expect(r.poll().map((c) => c.type)).toEqual(['setAim']);
    r.pointer('pointermove', down.x - 10, down.y + 5, { pointerType: 'touch' });
    r.pointer('pointerup', down.x - 10, down.y + 5, { pointerType: 'touch' });
    expect(r.poll()).toEqual([RESTORE_CMD]);
    expect(r.input.localAim()).toEqual(STORED_AIM);
  });

  it('a second finger cancels an off-ball touch drag and restores the aim', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x + 250, r.ball.y - 150, { pointerType: 'touch' });
    r.pointer('pointermove', r.ball.x + 150, r.ball.y - 50, { pointerType: 'touch' });
    expect(r.poll()).toHaveLength(1);
    r.pointer('pointerdown', r.ball.x + 500, r.ball.y - 150, { pointerId: 2, pointerType: 'touch' });
    r.pointer('pointerup', r.ball.x + 150, r.ball.y - 50, { pointerType: 'touch' });
    expect(r.poll()).toEqual([RESTORE_CMD]);
  });

  it('an OS pointercancel (a touch edge gesture) on an off-ball drag cancels it and restores the aim', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x + 250, r.ball.y - 150, { pointerType: 'touch' });
    r.pointer('pointermove', r.ball.x + 100, r.ball.y - 60, { pointerType: 'touch' });
    expect(r.poll()).toHaveLength(1);
    r.pointer('pointercancel', r.ball.x + 100, r.ball.y - 60, { pointerType: 'touch' });
    const frame = r.frame();
    expect(frame.commands).toEqual([RESTORE_CMD]);
    expect(frame.drag).toBeNull();
  });
});

describe('miss feedback (UX.md §5.2; since D10.9 only the partner ball and the other seat)', () => {
  it('a press off the ball on my turn is a drag, never a miss; released where it started it emits nothing', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x + 200, r.ball.y);
    const frame = r.frame();
    expect(frame.miss).toBeNull();
    expect(frame.commands).toEqual([]);
    expect(frame.drag).toEqual({ offset: { x: 0, y: 0 }, cancel: true, clamped: false });
    r.pointer('pointerup', r.ball.x + 200, r.ball.y);
    const next = r.frame();
    expect(next.miss).toBeNull();
    expect(next.commands).toEqual([]);
    expect(next.drag).toBeNull();
  });

  it("a press on the partner's ball reports 'wrongBall'", () => {
    const r = rig([0, 1], 'local');
    const other = worldToScreen(r.view, r.state.balls[1].pos);
    r.pointer('pointerdown', other.x, other.y);
    expect(r.frame().miss).toBe('wrongBall');
  });

  it("a touch on the partner's ball resting in the lower half reports 'wrongBall', not a grab", () => {
    const r = rig([0, 1], 'local', { ballY: LOW_BALL_Y });
    const other = worldToScreen(r.view, r.state.balls[1].pos);
    expect(other.y).toBeGreaterThan(VIEWPORT_H / 2);
    r.pointer('pointerdown', other.x, other.y, { pointerType: 'touch' });
    expect(r.frame().miss).toBe('wrongBall');
    r.pointer('pointermove', other.x - 120, other.y, { pointerType: 'touch' });
    r.pointer('pointerup', other.x - 120, other.y, { pointerType: 'touch' });
    expect(r.poll()).toEqual([]);
  });

  it("only a press ON the partner's ball is refused: inside WRONG_BALL_RADIUS_PX (touch: _TOUCH_PX) it never aims, just outside it is a drag", () => {
    // D10.9: half the grab radii, 24 px for mouse and pen, 40 px for touch.
    expect([WRONG_BALL_RADIUS_PX, WRONG_BALL_RADIUS_TOUCH_PX]).toEqual([24, 40]);
    const cases = [
      { pointerType: 'mouse', radius: WRONG_BALL_RADIUS_PX },
      { pointerType: 'touch', radius: WRONG_BALL_RADIUS_TOUCH_PX },
    ];
    for (const { pointerType, radius } of cases) {
      const on = rig([0, 1], 'local');
      const other = worldToScreen(on.view, on.state.balls[1].pos);
      const inside = { x: other.x + radius - 1, y: other.y };
      on.pointer('pointerdown', inside.x, inside.y, { pointerType });
      const refused = on.frame();
      expect(refused.miss, pointerType).toBe('wrongBall');
      expect(refused.drag, pointerType).toBeNull();
      on.pointer('pointermove', inside.x - 120, inside.y, { pointerType });
      on.pointer('pointerup', inside.x - 120, inside.y, { pointerType });
      expect(on.poll(), pointerType).toEqual([]);

      const beside = rig([0, 1], 'local');
      beside.pointer('pointerdown', other.x + radius + 4, other.y, { pointerType });
      const grabbed = beside.frame();
      expect(grabbed.miss, pointerType).toBeNull();
      expect(grabbed.drag, pointerType).toEqual({ offset: { x: 0, y: 0 }, cancel: true, clamped: false });
    }
  });

  it("tees 50 px apart: the active ball's grab radius wins, so a touch on the partner's ball grabs while a mouse press on it is wrongBall", () => {
    const ballX = level.starts[1].x - MIN_TEE_SEPARATION;
    const touch = rig([0, 1], 'local', { ballX });
    const blue = worldToScreen(touch.view, touch.state.balls[1].pos);
    expect(blue.x - touch.ball.x).toBe(MIN_TEE_SEPARATION);
    touch.pointer('pointerdown', blue.x, blue.y, { pointerType: 'touch' });
    const t = touch.frame();
    expect(t.miss).toBeNull();
    expect(t.drag).not.toBeNull();

    const mouse = rig([0, 1], 'local', { ballX });
    mouse.pointer('pointerdown', blue.x, blue.y);
    const m = mouse.frame();
    expect(m.miss).toBe('wrongBall');
    expect(m.drag).toBeNull();
  });

  it("tees 50 px apart: the open space just past the partner's ball still starts a drag (mouse 30 px, touch 50 px from it)", () => {
    const ballX = level.starts[1].x - MIN_TEE_SEPARATION;
    for (const { pointerType, dx } of [
      { pointerType: 'mouse', dx: 30 },
      { pointerType: 'touch', dx: 50 },
    ]) {
      const r = rig([0, 1], 'local', { ballX });
      const blue = worldToScreen(r.view, r.state.balls[1].pos);
      r.pointer('pointerdown', blue.x + dx, blue.y, { pointerType });
      const frame = r.frame();
      expect(frame.miss, pointerType).toBeNull();
      expect(frame.drag, pointerType).not.toBeNull();
    }
  });

  it("a press by the seat that is not aiming reports 'notYourTurn'", () => {
    const r = rig([1], 'online');
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    expect(r.frame().miss).toBe('notYourTurn');
  });

  it("a press anywhere by the seat that is not aiming reports 'notYourTurn' and never drags or aims", () => {
    const r = rig([1], 'online');
    r.pointer('pointerdown', r.ball.x + 300, r.ball.y - 150);
    const frame = r.frame();
    expect(frame.miss).toBe('notYourTurn');
    expect(frame.drag).toBeNull();
    r.pointer('pointermove', r.ball.x + 150, r.ball.y - 50);
    r.pointer('pointerup', r.ball.x + 150, r.ball.y - 50);
    expect(r.poll()).toEqual([]);
  });

  it('a press while the ball is flying is no miss and no drag', () => {
    const r = rig([0], 'solo', { phase: 'flying' });
    r.pointer('pointerdown', r.ball.x + 200, r.ball.y);
    const frame = r.frame();
    expect(frame.miss).toBeNull();
    expect(frame.drag).toBeNull();
  });

  it("hover cursor: grab anywhere on my turn, none over the partner's ball or on the other seat's turn, grabbing while dragging", () => {
    const r = rig([0, 1], 'local');
    const other = worldToScreen(r.view, r.state.balls[1].pos);
    r.pointer('pointermove', r.ball.x + 400, r.ball.y - 200);
    r.frame();
    expect(r.canvas.style.cursor).toBe('grab');
    r.pointer('pointermove', other.x, other.y);
    r.frame();
    expect(r.canvas.style.cursor).toBe('');
    r.pointer('pointerdown', r.ball.x + 400, r.ball.y - 200);
    r.frame();
    expect(r.canvas.style.cursor).toBe('grabbing');

    const watcher = rig([1], 'online');
    watcher.pointer('pointermove', watcher.ball.x + 400, watcher.ball.y - 200);
    watcher.frame();
    expect(watcher.canvas.style.cursor).toBe('');
  });
});

describe('downward pull room (UX.md §4.6)', () => {
  it('stageRoom measures the distance to the stage edge along the pull; fullPowerPx compresses the pull to fit', () => {
    expect(stageRoom({ x: 576, y: 608 }, { x: 0, y: 1 })).toBe(VIEWPORT_H - 608);
    expect(stageRoom({ x: 576, y: 608 }, { x: -1, y: 0 })).toBe(576);
    expect(fullPowerPx(1000)).toBe(240);
    expect(fullPowerPx(200)).toBe(200 - DRAG_EDGE_MARGIN_PX);
    expect(fullPowerPx(20)).toBe(DRAG_MIN_FULL_POWER_PX);
  });

  it('a horizontal pull from a low ball keeps the 240 px scale', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - 120, r.ball.y);
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: -0.03, power: 55 }]);
  });

  it('a straight-down pull from a low ball reads full power just short of the stage bottom', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    const room = VIEWPORT_H - LOW_BALL_Y;
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x, r.ball.y + 100);
    const expected = Math.round((10 + (100 / (room - DRAG_EDGE_MARGIN_PX)) * 90) * 10) / 10;
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: -1.5708, power: expected }]);
  });

  it('a 60 degree lob pulled to the bottom edge reads power 100 from a floor ball', () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    const len = (VIEWPORT_H - 1 - LOW_BALL_Y) / Math.sin(Math.PI / 3);
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    r.pointer('pointermove', r.ball.x - len * Math.cos(Math.PI / 3), VIEWPORT_H - 1);
    expect(r.poll()).toEqual([{ type: 'setAim', playerId: 0, angle: -1.0472, power: 100 }]);
  });

  it('pullReachable: every angle at full power from a floor or dish ball, not from a press 20 px above the edge', () => {
    for (const y of [LOW_BALL_Y, 628]) {
      for (let deg = 5; deg <= 175; deg += 5) expect(pullReachable({ x: 576, y }, { angle: (-deg * Math.PI) / 180, power: 100 }), `${deg} deg from y ${y}`).toBe(true);
    }
    expect(pullReachable({ x: 576, y: 700 }, { angle: -Math.PI / 2, power: 100 })).toBe(false);
    expect(pullReachable({ x: 576, y: 700 }, { angle: -Math.PI / 2, power: 20 })).toBe(true);
  });
});

describe('keyboard parity (BUILD_DECISIONS D10.9: every click on my turn is a grab)', () => {
  it.each([
    { what: 'a click away from the ball', dx: 300, dy: -150, rightClick: false },
    { what: 'a click on the ball', dx: 0, dy: 0, rightClick: false },
    { what: 'a press cancelled by a right-click', dx: 300, dy: -150, rightClick: true },
  ])('$what while an aim key is held never snaps the keyboard aim back', ({ dx, dy, rightClick }) => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const r = rig();
    const powers = (cmds: readonly PlayerCommand[]): number[] => cmds.flatMap((c) => (c.type === 'setAim' ? [c.power] : []));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
    const seen = powers(r.poll(100));
    r.pointer('pointerdown', r.ball.x + dx, r.ball.y + dy);
    seen.push(...powers(r.poll(116)));
    if (rightClick) r.canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    else r.pointer('pointerup', r.ball.x + dx + 2, r.ball.y + dy + 1);
    const after = r.poll(132);
    seen.push(...powers(after), ...powers(r.poll(148)));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
    expect(after.some((c) => c.type === 'shoot')).toBe(false);
    // ArrowUp integrates KEY_POWER_RATE from the stored power straight through the press: one rising setAim per frame.
    expect(seen).toEqual([100, 116, 132, 148].map((ms) => quantize1(STORED_AIM.power + (KEY_POWER_RATE * ms) / 1000)));
  });
});

describe('drag visual: the loop anchors the drag at the ball (BUILD_DECISIONS D10.9)', () => {
  it('an off-ball drag is drawn from the ball along the pull at any zoom; back at the press point it sits on the ball', () => {
    const r = rig([0], 'solo', { ballX: 20, ballY: LOW_BALL_Y });
    const ball = r.state.balls[0].pos;
    r.pointer('pointerdown', 700, 300);
    r.pointer('pointermove', 700 - 150, 300 + 90);
    const pulled = r.frame().drag;
    expect(pulled).toEqual({ offset: { x: -150, y: 90 }, cancel: false, clamped: false });
    expect(dragVisual(r.view, pulled, ball)).toEqual({ pointer: { x: ball.x - 150, y: ball.y + 90 }, cancel: false, clamped: false });
    // Overview at zoom 0.5: the band doubles in world px, so on screen it is still exactly the pull.
    r.view.camera = { x: 0, y: 0, zoom: 0.5 };
    expect(dragVisual(r.view, pulled, ball)?.pointer).toEqual({ x: ball.x - 300, y: ball.y + 180 });
    r.pointer('pointermove', 702, 300);
    const back = r.frame().drag;
    expect(back?.cancel).toBe(true);
    expect(dragVisual(r.view, back, ball)?.pointer).toEqual({ x: ball.x + 4, y: ball.y });
    expect(dragVisual(r.view, null, ball)).toBeNull();
  });
});
