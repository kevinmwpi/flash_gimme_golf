// @vitest-environment jsdom
// OWNER: input-loop
// ARCH.md §7 keyboard rules (adapter directly for the integration maths; the InputSystem for stamping,
// quantisation and the pending shot).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Aim, BallState, Level, SimConfig, SimState, Vec } from '../../sim/types';
import { KEY_ANGLE_RATE, KEY_POWER_RATE, REST_TICKS } from '../../sim/types';
import { createInputSystem, PENDING_SHOOT_MS, type InputContext } from '../input/index';
import { createKeyboard, FAST_SWEEP_AFTER_MS, FAST_SWEEP_FACTOR } from '../input/keyboard';
import { createViewState } from '../view';

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
  terrain: { pieces: [{ surface: [{ x: 0, y: 600 }, { x: 1600, y: 600 }], baseY: 720 }], gaps: [] },
  rects: [],
  switches: [],
  hole: { x: 1400, rimY: 600, radius: 16 },
  starts: [{ x: 420, y: 588 }, { x: 520, y: 588 }],
};

const AIM: Aim = { angle: -1, power: 40 };
const RECT = { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

function restingBall(pos: Vec): BallState {
  return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos };
}

function stateWith(turnDelayTicks: number): SimState {
  const config: SimConfig = { playerCount: 1, levelIds: [level.id], seed: 1, mode: 'solo' };
  return {
    config,
    tick: 0,
    phase: 'aiming',
    levelIndex: 0,
    levelId: level.id,
    players: [{ strokes: 0, aim: AIM }, { strokes: 0, aim: AIM }],
    balls: [restingBall(level.starts[0]), restingBall(level.starts[1])],
    switches: {},
    activePlayer: 0,
    turnDelayTicks,
    rng: 0,
    campaign: [],
  };
}

function ctxAt(nowMs: number, dt: number, state: SimState = stateWith(0)): InputContext {
  return { state, seats: [0], view: createViewState(level, state), canvasRect: RECT, dt, nowMs };
}

function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

let canvas: HTMLCanvasElement;
let clock = 0;

beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.appendChild(canvas);
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('keyboard adapter', () => {
  it('keys are read by event.code (ArrowLeft/KeyA etc.), modifier combos ignored', () => {
    const kb = createKeyboard();
    kb.attach(canvas);
    key('keydown', 'KeyA', { key: 'q' });
    let r = kb.poll(ctxAt(100, 0.1), AIM);
    expect(r.aim?.angle).toBeCloseTo(AIM.angle - KEY_ANGLE_RATE * 0.1, 6);
    key('keyup', 'KeyA');
    key('keydown', 'ArrowRight', { ctrlKey: true });
    r = kb.poll(ctxAt(200, 0.1), AIM);
    expect(r.aim).toBeUndefined();
    expect(r.active).toBe(false);
    kb.detach();
  });

  it('holding a key integrates angle at KEY_ANGLE_RATE and x1.6 after 0.6 s; emitted aims are quantised', () => {
    const kb = createKeyboard();
    kb.attach(canvas);
    key('keydown', 'ArrowRight');
    const slow = kb.poll(ctxAt(100, 0.1), AIM);
    expect(slow.aim?.angle).toBeCloseTo(AIM.angle + KEY_ANGLE_RATE * 0.1, 6);
    clock = FAST_SWEEP_AFTER_MS;
    const fast = kb.poll(ctxAt(FAST_SWEEP_AFTER_MS, 0.1), AIM);
    expect(fast.aim?.angle).toBeCloseTo(AIM.angle + KEY_ANGLE_RATE * 0.1 * (1 + FAST_SWEEP_FACTOR), 6);
    key('keyup', 'ArrowRight');
    expect(kb.poll(ctxAt(650, 0.05), AIM).aim).toBeUndefined();
    key('keydown', 'ArrowUp');
    const up = kb.poll(ctxAt(700, 0.05), AIM);
    expect(up.aim?.power).toBeCloseTo(AIM.power + KEY_POWER_RATE * 0.05, 6);
    expect(up.aim?.angle).toBe(AIM.angle);
    kb.detach();

    const input = createInputSystem();
    input.attach(canvas);
    key('keydown', 'ArrowLeft');
    const [cmd] = input.poll(ctxAt(16, 0.0123)).commands;
    if (cmd?.type !== 'setAim') throw new Error('expected setAim');
    expect(cmd.playerId).toBe(0);
    expect(cmd.angle).toBe(Math.round(cmd.angle * 10000) / 10000);
    expect(cmd.power).toBe(Math.round(cmd.power * 10) / 10);
    expect(cmd.angle).toBeLessThan(AIM.angle);
    input.detach();
  });

  it('Space/Enter shoot on keydown, not on repeat, and only while the stage has focus', () => {
    const kb = createKeyboard();
    kb.attach(canvas);
    const e = key('keydown', 'Space');
    expect(e.defaultPrevented).toBe(true);
    expect(kb.poll(ctxAt(16, 0.016), AIM).shoot).toBe(true);
    key('keydown', 'Space', { repeat: true });
    expect(kb.poll(ctxAt(32, 0.016), AIM).shoot).toBeUndefined();
    key('keydown', 'Enter');
    expect(kb.poll(ctxAt(48, 0.016), AIM).shoot).toBe(true);

    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    const onButton = key('keydown', 'Space');
    expect(onButton.defaultPrevented).toBe(false);
    expect(kb.poll(ctxAt(64, 0.016), AIM).shoot).toBeUndefined();
    kb.detach();
  });

  it('held keys are cleared on blur / visibilitychange', () => {
    const kb = createKeyboard();
    kb.attach(canvas);
    key('keydown', 'ArrowUp');
    expect(kb.poll(ctxAt(16, 0.016), AIM).aim).toBeDefined();
    window.dispatchEvent(new Event('blur'));
    expect(kb.poll(ctxAt(32, 0.016), AIM).aim).toBeUndefined();

    key('keydown', 'ArrowUp');
    expect(kb.poll(ctxAt(48, 0.016), AIM).aim).toBeDefined();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(kb.poll(ctxAt(64, 0.016), AIM).aim).toBeUndefined();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    kb.detach();
  });

  it('Escape / C / M produce UI actions; Tab is left to native focus navigation even on the canvas', () => {
    const kb = createKeyboard();
    kb.attach(canvas);
    key('keydown', 'Escape');
    key('keydown', 'KeyC');
    key('keydown', 'KeyM');
    expect(kb.poll(ctxAt(16, 0.016), AIM).ui).toEqual(['pause', 'toggleCamera', 'toggleMute']);
    canvas.focus();
    const tab = key('keydown', 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    const shiftTab = key('keydown', 'Tab', { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(false);
    expect(kb.poll(ctxAt(32, 0.016), AIM).ui).toEqual([]);
    kb.detach();
  });

  it('a shoot pressed during turnDelay is held as pendingShoot for up to 0.6 s', () => {
    const input = createInputSystem();
    input.attach(canvas);
    const delayed = stateWith(10);
    key('keydown', 'Space');
    expect(input.poll(ctxAt(0, 0.016, delayed)).commands).toEqual([]);
    expect(input.poll(ctxAt(200, 0.016, delayed)).commands).toEqual([]);
    expect(input.poll(ctxAt(400, 0.016, stateWith(0))).commands).toEqual([{ type: 'shoot', playerId: 0 }]);
    expect(input.poll(ctxAt(416, 0.016, stateWith(0))).commands).toEqual([]);

    key('keydown', 'Space');
    expect(input.poll(ctxAt(1000, 0.016, delayed)).commands).toEqual([]);
    expect(input.poll(ctxAt(1000 + PENDING_SHOOT_MS + 1, 0.016, stateWith(0))).commands).toEqual([]);
    input.detach();
  });

  it('setAim comes before shoot in the same frame', () => {
    const input = createInputSystem();
    input.attach(canvas);
    key('keydown', 'ArrowUp');
    key('keydown', 'Space');
    const cmds = input.poll(ctxAt(16, 0.05)).commands;
    expect(cmds.map((c) => c.type)).toEqual(['setAim', 'shoot']);
    input.detach();
  });
});
