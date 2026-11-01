// @vitest-environment jsdom
// OWNER: ui
// The first moments of a session, through the whole App (the real sim, snapshot codec and GameClient behind a fake
// WebSocket, the real GameCanvas loop on a fake animation-frame clock; only the canvas renderer is stubbed):
// - online, the server's own session-opening levelStart reaches the client late (the start sync carries no events;
//   it rides the first snapshot after it), so a Tee off pressed before it must not read as the partner's
//   ("Blue teed off" to the player who pressed it), on every new room, Play again and Continue to World N+1;
// - a player who reached the stage with the keyboard is coached with keys from the first intro card (UX.md §1.6),
//   not with the touch/pointer guess the stage starts from before it sees a key.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type BootRoute } from '../../App';
import { RECONNECT_STORAGE_KEY } from '../../net/GameClient';
import { CLIENT_RENDER_DELAY_MS, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../net/protocol';
import { WORLD_IDS } from '../../sim/levels/index';
import { encodeSnapshot } from '../../sim/serialize';
import { createSim, stepSim } from '../../sim/sim';
import type { PlayerId, SimEvent, SimState } from '../../sim/types';
import { createAudio } from '../../view/audio';
import { COPY } from '../copy';
import { CARD_INPUT_GRACE_MS } from '../Pause';

vi.mock('../../view/render/index', () => ({ renderFrame: () => {} }));

const CODE = 'KPQ27';
const TOKEN = 'c'.repeat(32);
const FRAME_MS = 16;

/** The slice of a browser WebSocket that GameClient's default socket factory touches. */
class FakeWebSocket {
  readyState = 0;
  readonly sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.readyState = 3;
  }
}

let sockets: FakeWebSocket[] = [];
let rafCallbacks: FrameRequestCallback[] = [];
let clock = 0;
let root: Root | null = null;

beforeEach(() => {
  sockets = [];
  rafCallbacks = [];
  clock = 10_000;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ setTransform() {} }) as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  const live = sockets.at(-1);
  if (live?.onmessage) receive(live, { type: 'roomClosed', reason: 'idle' });
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountApp(boot: BootRoute): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  act(() => r.render(React.createElement(App, { audio: createAudio(), boot, version: 'test' })));
}

/** One animation frame `ms` after the last one. */
function frame(ms = FRAME_MS): void {
  clock += ms;
  const pending = rafCallbacks;
  rafCallbacks = [];
  act(() => {
    for (const cb of pending) cb(clock);
  });
}

/** Frames until the render clock has passed everything the server sent so far. */
function settle(): void {
  frame();
  frame(CLIENT_RENDER_DELAY_MS);
  frame();
}

/** The player reads the card before pressing it: a card ignores presses for its first CARD_INPUT_GRACE_MS. */
function readCard(): void {
  clock += CARD_INPUT_GRACE_MS;
}

function receive(socket: FakeWebSocket, msg: ServerMessage): void {
  act(() => socket.onmessage?.({ data: JSON.stringify(msg) }));
}

function snapshot(state: SimState, events: readonly SimEvent[]): ServerMessage {
  return { type: 'snapshot', tick: state.tick, serverTime: clock, snap: encodeSnapshot(state), events: [...events], immediate: false };
}

/** A stored seat in a room whose session just opened: the room answers `joined` with its event-less sync. */
function joinOpenedSession(seat: PlayerId, state: SimState): FakeWebSocket {
  sessionStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({ code: CODE, token: TOKEN, seat }));
  mountApp({ room: null, state: null, rejoin: true });
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('no socket opened');
  act(() => {
    socket.readyState = 1;
    socket.onopen?.();
  });
  receive(socket, { type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: clock });
  const lobby = { levelId: state.config.levelIds[0] ?? '', players: [true, true] as [boolean, boolean], names: ['Red', 'Blue'] as [string, string] };
  const sync = { config: state.config, tick: state.tick, snap: encodeSnapshot(state), serverTime: clock };
  receive(socket, { type: 'joined', code: CODE, playerId: seat, reconnectToken: TOKEN, peerConnected: true, lobby, sync });
  return socket;
}

function click(label: string): void {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no "${label}" button`);
  act(() => button.click());
}

function toastTexts(): string[] {
  return [...document.querySelectorAll('.stage-layer .toast')].map((t) => t.textContent ?? '');
}

function sentContinue(socket: FakeWebSocket): boolean {
  return socket.sent.some((m) => m.type === 'command' && m.cmd.type === 'continue');
}

describe('online session start: the "teed off" toast names the partner only when the partner pressed', () => {
  const opened = createSim({ playerCount: 2, levelIds: WORLD_IDS[2], seed: 77, mode: 'online' });
  const continueBy = (state: SimState, by: PlayerId): ReturnType<typeof stepSim> => stepSim(state, [{ type: 'continue', playerId: by, levelIndex: 0, phase: 'intro' }]);

  it('Tee off pressed before the late start echo: one snapshot carries the echo and the tee-off, and nobody is toasted', () => {
    const socket = joinOpenedSession(0, opened.state);
    settle();
    readCard();
    click(COPY.intro.teeOff);
    expect(sentContinue(socket)).toBe(true);
    frame();
    const teed = continueBy(opened.state, 0);
    receive(socket, snapshot(teed.state, [...opened.events, ...teed.events]));
    settle();
    expect(document.querySelector('.intro-card')).toBeNull();
    expect(toastTexts()).not.toContain(COPY.toast.teedOff(1));
  });

  it('the echo alone first (the 1 Hz keepalive), then the tee-off: still nobody is toasted', () => {
    const socket = joinOpenedSession(1, opened.state);
    settle();
    readCard();
    click(COPY.intro.teeOff);
    frame();
    const idle = stepSim(opened.state, []);
    receive(socket, snapshot(idle.state, opened.events));
    settle();
    const teed = continueBy(idle.state, 1);
    receive(socket, snapshot(teed.state, teed.events));
    settle();
    expect(toastTexts()).not.toContain(COPY.toast.teedOff(0));
  });

  it('the partner pressed Tee off: the toast names the partner', () => {
    const socket = joinOpenedSession(0, opened.state);
    settle();
    frame();
    const teed = continueBy(opened.state, 1);
    receive(socket, snapshot(teed.state, [...opened.events, ...teed.events]));
    settle();
    expect(document.querySelector('.intro-card')).toBeNull();
    expect(toastTexts()).toContain(COPY.toast.teedOff(1));
  });
});

describe('the first intro card coaches the device the player reached the stage with', () => {
  function pointerDown(pointerType: 'mouse' | 'touch'): void {
    const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    act(() => {
      document.body.dispatchEvent(e);
    });
  }

  function introCaption(): string | null {
    return document.querySelector('.intro-card .caption')?.textContent ?? null;
  }

  it('keys on the title (Tab to Solo, Enter): "or press Space" and keycaps, before any key on the stage', () => {
    mountApp({ room: null, state: null, rejoin: false });
    pointerDown('mouse');
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    });
    click(document.querySelector('.mode-btn.solo')?.textContent ?? '');
    expect(introCaption()).toBe(COPY.intro.orSpace);
    expect(document.querySelectorAll('.intro-card kbd').length).toBeGreaterThan(0);
    frame();
    frame();
    expect(introCaption()).toBe(COPY.intro.orSpace);
  });

  it('a mouse or a finger on the title keeps the pointer / touch copy', () => {
    mountApp({ room: null, state: null, rejoin: false });
    pointerDown('touch');
    click(document.querySelector('.mode-btn.solo')?.textContent ?? '');
    frame();
    expect(introCaption()).toBe(COPY.intro.orTap);
    expect(document.querySelectorAll('.intro-card kbd')).toHaveLength(0);
    expect(document.querySelector('.intro-card .coach-text')?.textContent).toContain(COPY.coach.step1.touch);
  });
});
