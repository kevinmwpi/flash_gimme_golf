// @vitest-environment jsdom
// OWNER: input-loop
// ARCH.md §4 input-pointer row (BUILD_DECISIONS D1: DRAG_FULL_POWER_PX 240 => move 120 px => power 55),
// UX.md §5.2 (cancel keeps the previous aim; miss feedback) and §4.6 (downward pull room).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BallState, Level, PlayerCommand, PlayerId, SimConfig, SimPhase, SimState, Vec } from '../../sim/types';
import { DRAG_GRAB_RADIUS_PX, DRAG_GRAB_RADIUS_TOUCH_PX, REST_TICKS, VIEWPORT_H } from '../../sim/types';
import { createInputSystem, type InputContext, type InputFrame, type InputSystem } from '../input/index';
import { DRAG_EDGE_MARGIN_PX, DRAG_MIN_FULL_POWER_PX, fullPowerPx, pullReachable, stageRoom } from '../input/pointer';
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

type RigOptions = { ballY?: number; phase?: SimPhase };

function aimingState(mode: SimConfig['mode'], opts: RigOptions): SimState {
  const config: SimConfig = { playerCount: mode === 'solo' ? 1 : 2, levelIds: [level.id], seed: 7, mode };
  const at = (p: PlayerId): Vec => ({ x: level.starts[p].x, y: opts.ballY ?? level.starts[p].y });
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
    expect(frame.drag).toEqual({ pointer: { x: r.ball.x - 7, y: r.ball.y + 7 }, cancel: true, clamped: false });
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

  it('a press outside the grab radius is not a drag', () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x + DRAG_GRAB_RADIUS_PX + 10, r.ball.y);
    r.pointer('pointermove', r.ball.x - 100, r.ball.y + 100);
    r.pointer('pointerup', r.ball.x - 100, r.ball.y + 100);
    expect(r.poll()).toEqual([]);
  });

  it('touch grab radius is DRAG_GRAB_RADIUS_TOUCH_PX and reports device touch', () => {
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

describe('miss feedback (UX.md §5.2)', () => {
  it("a press off the ball on my turn reports 'miss' once and never a command", () => {
    const r = rig();
    r.pointer('pointerdown', r.ball.x + 200, r.ball.y);
    const frame = r.frame();
    expect(frame.miss).toBe('miss');
    expect(frame.commands).toEqual([]);
    r.pointer('pointerup', r.ball.x + 200, r.ball.y);
    const next = r.frame();
    expect(next.miss).toBeNull();
    expect(next.commands).toEqual([]);
  });

  it("a press on the partner's ball reports 'wrongBall'", () => {
    const r = rig([0, 1], 'local');
    const other = worldToScreen(r.view, r.state.balls[1].pos);
    r.pointer('pointerdown', other.x, other.y);
    expect(r.frame().miss).toBe('wrongBall');
  });

  it("a touch swipe on the lower half of the stage, off the ball, reports 'miss' and never shoots", () => {
    const r = rig([0], 'solo', { ballY: LOW_BALL_Y });
    const down = { x: r.ball.x + 200, y: VIEWPORT_H - 120 };
    expect(down.y).toBeGreaterThan(VIEWPORT_H / 2);
    r.pointer('pointerdown', down.x, down.y, { pointerType: 'touch' });
    const frame = r.frame();
    expect(frame.miss).toBe('miss');
    expect(frame.commands).toEqual([]);
    r.pointer('pointermove', down.x - 120, down.y + 40, { pointerType: 'touch' });
    r.pointer('pointerup', down.x - 120, down.y + 40, { pointerType: 'touch' });
    expect(r.poll()).toEqual([]);
    expect(r.state.players[0].strokes).toBe(0);
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

  it("a press by the seat that is not aiming reports 'notYourTurn'", () => {
    const r = rig([1], 'online');
    r.pointer('pointerdown', r.ball.x, r.ball.y);
    expect(r.frame().miss).toBe('notYourTurn');
  });

  it('a press while the ball is flying is no miss', () => {
    const r = rig([0], 'solo', { phase: 'flying' });
    r.pointer('pointerdown', r.ball.x + 200, r.ball.y);
    expect(r.frame().miss).toBeNull();
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
