// @vitest-environment jsdom
// OWNER: ui
// BUILD_DECISIONS D10.2 / ARCH.md §1.13: the world results card is the only way on to World N+1 inside an
// online room, so it must come from the SimState at campaignResults, never from the campaignComplete event
// alone. Online, GameClient drops event batches more than EVENT_REPLAY_WINDOW_MS behind render time (a tab
// that was hidden while the partner pressed the last Next) and a rejoin replays none. The whole App runs
// here: the real sim, snapshot codec and GameClient behind a fake WebSocket, the real GameCanvas loop on a
// fake requestAnimationFrame clock; only the canvas renderer is stubbed (jsdom has no 2D context).
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type BootRoute } from '../../App';
import { EVENT_REPLAY_WINDOW_MS, GameClient, RECONNECT_STORAGE_KEY } from '../../net/GameClient';
import { CLIENT_RENDER_DELAY_MS, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../net/protocol';
import { GOLDEN_LINES } from '../../sim/__tests__/levels-golden';
import { WORLDS, WORLD_IDS, levelById } from '../../sim/levels/index';
import { decodeSnapshot, encodeShareLink, encodeSnapshot } from '../../sim/serialize';
import { stepSim } from '../../sim/sim';
import { medalFor, type LevelResult, type PlayerId, type SimConfig, type SimEvent, type SimMode, type SimSnapshot, type SimState, type WorldId } from '../../sim/types';
import { createAudio } from '../../view/audio';
import { campaignTally } from '../CampaignResults';
import { COPY } from '../copy';
import { CARD_INPUT_GRACE_MS } from '../Pause';

vi.mock('../../view/render/index', () => ({ renderFrame: () => {} }));

const CODE = 'KPQ27';
const TOKEN = 'b'.repeat(32);
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
  // Close the room first so the client's ping timer stops, then unmount.
  const live = sockets.at(-1);
  if (live?.onmessage) receive(live, { type: 'roomClosed', reason: 'idle' });
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- the App, a frame clock and the fake server ---------------------------------------------------

function mountApp(boot: BootRoute): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  act(() => r.render(React.createElement(App, { audio: createAudio(), boot, version: 'test' })));
}

/** One requestAnimationFrame tick `ms` after the last one. */
function frame(ms = FRAME_MS): void {
  clock += ms;
  const pending = rafCallbacks;
  rafCallbacks = [];
  act(() => {
    for (const cb of pending) cb(clock);
  });
}

function receive(socket: FakeWebSocket, msg: ServerMessage): void {
  act(() => socket.onmessage?.({ data: JSON.stringify(msg) }));
}

/** A snapshot taken now on the server (the client clock offset stays zero). */
function snapshot(state: SimState, events: SimEvent[] = []): ServerMessage {
  return { type: 'snapshot', tick: state.tick, serverTime: clock, snap: encodeSnapshot(state), events, immediate: false };
}

/** Boot with a stored token and let the room answer `joined` with `state` (the rejoin path, ARCH.md §1.14). */
function rejoinAt(seat: PlayerId, state: SimState): FakeWebSocket {
  sessionStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({ code: CODE, token: TOKEN, seat }));
  mountApp({ room: null, state: null, rejoin: true });
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('no socket opened');
  act(() => {
    socket.readyState = 1;
    socket.onopen?.();
  });
  receive(socket, { type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: clock });
  expect(socket.sent.map((m) => m.type)).toEqual(['hello', 'joinRoom']);
  const lobby = { levelId: state.config.levelIds[0] ?? '', players: [true, true] as [boolean, boolean], names: ['Red', 'Blue'] as [string, string] };
  const sync = { config: state.config, tick: state.tick, snap: encodeSnapshot(state), serverTime: clock };
  receive(socket, { type: 'joined', code: CODE, playerId: seat, reconnectToken: TOKEN, peerConnected: true, lobby, sync });
  return socket;
}

// ---- states the sim produces ------------------------------------------------------------------------

function golden(levelId: string): (typeof GOLDEN_LINES)[number] {
  const line = GOLDEN_LINES.find((g) => g.levelId === levelId);
  if (line === undefined) throw new Error(`no golden line for ${levelId}`);
  return line;
}

/**
 * A world's last hole at its results card: that hole's golden line as the sim recorded it (balls sunk,
 * strokes counted), the earlier holes of the world played on their golden lines.
 */
function lastHoleResults(world: WorldId, mode: SimMode): SimState {
  const levelIds = WORLD_IDS[world];
  const lastId = levelIds[levelIds.length - 1] ?? '';
  const config: SimConfig = { playerCount: 2, levelIds, seed: 4242, mode };
  const recorded = decodeSnapshot(JSON.parse(golden(lastId).snapshot) as SimSnapshot, { ...config, levelIds: [lastId] });
  const earlier = levelIds.slice(0, -1).map((id): LevelResult => {
    const { strokes } = golden(id);
    const par = levelById(id).par;
    return { levelId: id, par, strokes: [strokes[0], strokes[1]], medal: medalFor(strokes[0] + strokes[1], par) };
  });
  return { ...recorded, config, levelIndex: levelIds.length - 1, campaign: [...earlier, ...recorded.campaign] };
}

/** "See results" on the last hole (either seat): the sim's campaignResults state and its events. */
function finishWorld(state: SimState, by: PlayerId): { state: SimState; events: SimEvent[]; done: Extract<SimEvent, { type: 'campaignComplete' }> } {
  const result = stepSim(state, [{ type: 'continue', playerId: by, levelIndex: state.levelIndex, phase: 'levelResults' }]);
  const done = result.events.find((e): e is Extract<SimEvent, { type: 'campaignComplete' }> => e.type === 'campaignComplete');
  if (result.state.phase !== 'campaignResults' || done === undefined) throw new Error('the world did not finish');
  return { state: result.state, events: [...result.events], done };
}

// ---- reading the page --------------------------------------------------------------------------------

function worldCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.campaign-card');
}

function buttonLabels(scope: ParentNode | null): string[] {
  return scope === null ? [] : [...scope.querySelectorAll('button')].map((b) => b.textContent ?? '');
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no "${label}" button`);
  return button;
}

function click(label: string): void {
  const button = buttonNamed(label);
  act(() => button.click());
}

/** The player reads the card before pressing it: a card ignores presses for its first CARD_INPUT_GRACE_MS. */
function readCard(): void {
  clock += CARD_INPUT_GRACE_MS;
}

/** One mouse press as the browser delivers it: pointerdown, then the click (`detail` counts the clicks in a row). */
function mousePress(target: Element, detail: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, detail }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  });
}

/** The types of every event GameClient handed the render loop, which pushes each one to the UI's event bus. */
function drainedTypes(spy: { mock: { results: Array<{ type: string; value: unknown }> } }): string[] {
  return spy.mock.results.flatMap((r) => (r.type === 'return' ? (r.value as SimEvent[]).map((e) => e.type) : []));
}

// ---- tests -------------------------------------------------------------------------------------------

describe('world results card (D10.2) comes from SimState, not from the campaignComplete event', () => {
  it('campaignTally reads exactly what campaignComplete reports, also from a decoded snapshot, and nothing before the round is over', () => {
    for (const world of WORLDS) {
      const lastHole = lastHoleResults(world, 'online');
      expect(campaignTally(lastHole)).toBeNull();
      const { state, done } = finishWorld(lastHole, 0);
      const tally = campaignTally(state);
      expect(tally).toEqual({
        rows: done.results.map((result) => ({ level: levelById(result.levelId), result })),
        coursePar: done.coursePar,
        total: done.totalStrokes,
        medal: done.medal,
      });
      expect(tally?.rows.map((r) => r.level.id)).toEqual(WORLD_IDS[world]);
      expect(campaignTally(decodeSnapshot(encodeSnapshot(state), state.config))).toEqual(tally);
    }
    expect(campaignTally(null)).toBeNull();
  });

  it.each([
    ['visible', 0, true],
    ['hidden past the event replay window', CLIENT_RENDER_DELAY_MS + EVENT_REPLAY_WINDOW_MS + 200, false],
  ] as const)('online host, tab %s while the partner presses the last Next: the card opens and Continue moves the room on', (_, hiddenMs, eventDrained) => {
    const drain = vi.spyOn(GameClient.prototype, 'drainEvents');
    const lastHole = lastHoleResults(2, 'online');
    const socket = rejoinAt(0, lastHole);
    frame();
    frame(CLIENT_RENDER_DELAY_MS);
    expect(buttonLabels(document).includes(COPY.results.seeResults)).toBe(true);
    expect(worldCard()).toBeNull();

    // The partner presses "See results"; the server's snapshot carries campaignComplete.
    const finished = finishWorld(lastHole, 1);
    receive(socket, snapshot(finished.state, finished.events));
    // A background tab runs no frame for `hiddenMs` while keepalive snapshots keep arriving.
    clock += hiddenMs;
    receive(socket, snapshot(finished.state));
    frame();
    frame(CLIENT_RENDER_DELAY_MS);

    expect(drainedTypes(drain).includes('campaignComplete')).toBe(eventDrained);
    const card = worldCard();
    expect(card?.querySelector('.eyebrow')?.textContent).toBe(COPY.campaign.title(2));
    expect(card?.querySelector('h2')?.textContent).toBe(COPY.campaign.team(finished.done.totalStrokes, finished.done.coursePar));
    expect(card?.querySelectorAll('tbody tr')).toHaveLength(WORLD_IDS[2].length + 1);
    expect(buttonLabels(card)).toEqual([COPY.campaign.nextWorld(3), COPY.campaign.playAgain, COPY.campaign.levelSelect, COPY.campaign.title2]);

    readCard();
    click(COPY.campaign.nextWorld(3));
    expect(socket.sent.at(-1)).toEqual({ type: 'playAgain', levelId: WORLD_IDS[3][0] });
  });

  it.each([0, 1] as const)('online seat %i: rejoining a room that already shows the world card shows it again', (seat) => {
    const drain = vi.spyOn(GameClient.prototype, 'drainEvents');
    const finished = finishWorld(lastHoleResults(1, 'online'), 1);
    const socket = rejoinAt(seat, finished.state);
    frame();
    frame(CLIENT_RENDER_DELAY_MS);

    expect(drainedTypes(drain)).not.toContain('campaignComplete');
    const card = worldCard();
    expect(card?.querySelector('.eyebrow')?.textContent).toBe(COPY.campaign.title(1));
    expect(card?.querySelector('h2')?.textContent).toBe(COPY.campaign.team(finished.done.totalStrokes, finished.done.coursePar));
    if (seat === 1) {
      expect(card?.textContent).toContain(COPY.toast.waitingNewRound(0));
      expect(buttonLabels(card)).toEqual([COPY.campaign.levelSelect, COPY.campaign.title2]);
      return;
    }
    expect(buttonLabels(card)).toEqual([COPY.campaign.nextWorld(2), COPY.campaign.playAgain, COPY.campaign.levelSelect, COPY.campaign.title2]);
    readCard();
    click(COPY.campaign.nextWorld(2));
    expect(socket.sent.at(-1)).toEqual({ type: 'playAgain', levelId: WORLD_IDS[2][0] });
  });

  it('local: "See results" on the last hole opens the card with the numbers campaignComplete reports', () => {
    const lastHole = lastHoleResults(1, 'local');
    mountApp({ room: null, state: encodeShareLink(lastHole), rejoin: false });
    click(COPY.shared.continueSolo);
    frame();
    expect(worldCard()).toBeNull();

    readCard();
    click(COPY.results.seeResults);
    frame();
    frame();

    const solo: SimState = { ...lastHole, config: { ...lastHole.config, playerCount: 1, mode: 'solo' } };
    const { done } = finishWorld(solo, 0);
    const card = worldCard();
    expect(card?.querySelector('.eyebrow')?.textContent).toBe(COPY.campaign.title(1));
    expect(card?.querySelector('h2')?.textContent).toBe(COPY.campaign.team(done.totalStrokes, done.coursePar));
    expect(card?.querySelectorAll('tbody tr')).toHaveLength(WORLD_IDS[1].length + 1);
    expect(buttonLabels(card)).toEqual([COPY.campaign.nextWorld(2), COPY.campaign.playAgain, COPY.campaign.levelSelect, COPY.campaign.title2]);
  });

  // The second half of a double-click on "Continue to World N+1" lands on the next world's first intro card: on its
  // scrim on a desktop (the button sits below where the shorter intro card ends), on Tee off on a phone. Either used
  // to tee off before anyone read the card that teaches the new world's first device.
  it('local: a double-click on "Continue to World 2" leaves the first World 2 intro card up until a press after its grace', () => {
    mountApp({ room: null, state: encodeShareLink(lastHoleResults(1, 'local')), rejoin: false });
    click(COPY.shared.continueSolo);
    frame();
    readCard();
    click(COPY.results.seeResults);
    frame();
    frame();
    readCard();

    mousePress(buttonNamed(COPY.campaign.nextWorld(2)), 1);
    const intro = document.querySelector('.intro-card');
    expect(intro?.querySelector('h2')?.textContent).toBe(levelById(WORLD_IDS[2][0] ?? '').name);
    clock += 150;
    const scrim = intro?.parentElement;
    if (scrim === null || scrim === undefined) throw new Error('no intro scrim');
    mousePress(scrim, 2);
    mousePress(buttonNamed(COPY.intro.teeOff), 2);
    frame();
    frame();
    expect(document.querySelector('.intro-card')).toBe(intro);

    readCard();
    click(COPY.intro.teeOff);
    frame();
    frame();
    expect(document.querySelector('.intro-card')).toBeNull();
  });
});
