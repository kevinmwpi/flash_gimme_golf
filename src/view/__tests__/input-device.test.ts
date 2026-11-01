// @vitest-environment jsdom
// OWNER: ui
// UX.md §1.6 across screens (input/index.ts `watchPageDevice`, installed by App from boot): a key or a press
// anywhere on the page sets the device a new input system starts from, so a player who reached the stage with
// Tab / arrows / Enter is coached with keys from the first intro card, and a running system adopts every later
// page observation at its next poll, Space on a focused card button included (the stage keyboard adapter leaves
// that key to the button). The stage adapters still win with what only they see (the gamepad).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Aim, BallState, Level, SimConfig, SimState, Vec } from '../../sim/types';
import { REST_TICKS } from '../../sim/types';
import type * as InputModule from '../input/index';
import type { InputContext } from '../input/index';
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

function aiming(): SimState {
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
    turnDelayTicks: 0,
    rng: 0,
    campaign: [],
    flightTicks: 0,
  };
}

let clock = 0;
function ctx(): InputContext {
  clock += 16;
  const state = aiming();
  return { state, seats: [0], view: createViewState(level, state), canvasRect: RECT, dt: 0.016, nowMs: clock };
}

/** The input module afresh: its page memory starts empty, as on a page load. */
async function inputModule(): Promise<typeof InputModule> {
  vi.resetModules();
  return import('../input/index');
}

function key(target: EventTarget, code: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true, ...init }));
}

function press(target: EventTarget, pointerType: 'mouse' | 'touch'): void {
  const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

let canvas: HTMLCanvasElement;
let stops: Array<() => void> = [];

beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.appendChild(canvas);
  clock = 0;
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'getGamepads');
});

describe("the page's last input device (UX.md §1.6)", () => {
  it('with nothing seen yet a new input system starts from the touch / pointer guess', async () => {
    const { createInputSystem, lastInputDevice } = await inputModule();
    expect(lastInputDevice()).toBe('pointer');
    const input = createInputSystem();
    input.attach(canvas);
    expect(input.poll(ctx()).device).toBe('pointer');
    input.detach();
  });

  it('keys on the title make the next game start on the keyboard, before any key on the stage', async () => {
    const { createInputSystem, lastInputDevice, subscribeInputDevice, watchPageDevice } = await inputModule();
    stops.push(watchPageDevice(window));
    const seen = vi.fn();
    stops.push(subscribeInputDevice(seen));
    key(document.body, 'Tab');
    key(document.body, 'ArrowRight');
    expect(lastInputDevice()).toBe('keyboard');
    expect(seen).toHaveBeenCalledTimes(1);
    const input = createInputSystem();
    input.attach(canvas);
    const frame = input.poll(ctx());
    expect(frame.device).toBe('keyboard');
    expect(frame.commands).toEqual([]);
    input.detach();
  });

  it('Space on a focused card button counts as the keyboard, though the stage keyboard leaves it to the button', async () => {
    const { createInputSystem, watchPageDevice } = await inputModule();
    stops.push(watchPageDevice(window));
    press(document.body, 'mouse');
    const input = createInputSystem();
    input.attach(canvas);
    expect(input.poll(ctx()).device).toBe('pointer');
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    key(button, 'Space');
    const frame = input.poll(ctx());
    expect(frame.device).toBe('keyboard');
    expect(frame.commands.some((c) => c.type === 'shoot')).toBe(false);
    input.detach();
  });

  it('a touch press counts as touch; typing in a text field or a Ctrl/Meta/Alt shortcut is no keyboard play', async () => {
    const { lastInputDevice, watchPageDevice } = await inputModule();
    stops.push(watchPageDevice(window));
    press(document.body, 'touch');
    expect(lastInputDevice()).toBe('touch');
    const field = document.createElement('input');
    document.body.appendChild(field);
    key(field, 'KeyK');
    key(document.body, 'KeyR', { ctrlKey: true });
    key(document.body, 'KeyC', { metaKey: true });
    expect(lastInputDevice()).toBe('touch');
  });

  it('the gamepad, which only the stage sees, wins until the page sees a key again, even the same keyboard as before', async () => {
    const { createInputSystem, watchPageDevice } = await inputModule();
    stops.push(watchPageDevice(window));
    key(document.body, 'Enter');
    const input = createInputSystem();
    input.attach(canvas);
    expect(input.poll(ctx()).device).toBe('keyboard');
    const pad = { index: 0, connected: true, axes: [0.8, -0.6, 0, 0], buttons: [] };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
    expect(input.poll(ctx()).device).toBe('gamepad');
    pad.axes = [0, 0, 0, 0];
    expect(input.poll(ctx()).device).toBe('gamepad');
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    key(button, 'Enter');
    expect(input.poll(ctx()).device).toBe('keyboard');
    input.detach();
  });

  it('the watcher stops with its disposer', async () => {
    const { lastInputDevice, watchPageDevice } = await inputModule();
    const stop = watchPageDevice(window);
    press(document.body, 'touch');
    stop();
    key(document.body, 'Tab');
    expect(lastInputDevice()).toBe('touch');
  });
});
