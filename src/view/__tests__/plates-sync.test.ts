// @vitest-environment jsdom
// OWNER: view
// BUILD_DECISIONS D11 through the real loop: both plate trackers (the view's and audio's) must stand on the hole and
// the plates the page renders, also when that state never came with its own levelStart: an online page that mounts
// mid-campaign (a reload's rejoin), a hidden tab whose levelStart batch was dropped as stale, and a `?state=` link
// resumed with a holder on its plate. Real sim, real GameCanvas loop, real GameClient over a fake socket, real audio
// under a stub AudioContext (its plate cues recorded, not synthesised); only renderFrame is replaced, to read the view.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_REPLAY_WINDOW_MS, GameClient, type SocketHandle } from '../../net/GameClient';
import { CLIENT_RENDER_DELAY_MS, PROTOCOL_VERSION, type ServerMessage } from '../../net/protocol';
import { GOLDEN_LINES } from '../../sim/__tests__/levels-golden';
import { WORLD1_IDS } from '../../sim/levels/index';
import { level as twoDoors } from '../../sim/levels/w1-02-two-doors';
import { decodeShareLink, encodeShareLink, encodeSnapshot } from '../../sim/serialize';
import { createSim, isShotReady, stepSim } from '../../sim/sim';
import type { PlayerCommand, SimConfig, SimEvent, SimState } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, DT, quantize4 } from '../../sim/types';
import { createAudio, type AudioSystem } from '../audio';
import GameCanvas, { type GameCanvasProps, type LocalSession, type OnlineSessionView } from '../GameCanvas';
import type { RenderScene } from '../render/index';

const seen = vi.hoisted(() => ({ scene: null as RenderScene | null }));
vi.mock('../render/index', () => ({
  renderFrame: (_ctx: unknown, scene: RenderScene) => {
    seen.scene = scene;
  },
}));

// ---- a stub Web Audio graph: enough for createAudio to unlock (the plate cues themselves are recorded below) ----
class StubParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
  cancelAndHoldAtTime(): void {}
}
class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  detune = new StubParam();
  Q = new StubParam();
  offset = new StubParam();
  playbackRate = new StubParam();
  threshold = new StubParam();
  knee = new StubParam();
  ratio = new StubParam();
  attack = new StubParam();
  release = new StubParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): StubNode {
    return this;
  }
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}
class StubAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new StubNode();
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createGain(): StubNode {
    return new StubNode();
  }
  createOscillator(): StubNode {
    return new StubNode();
  }
  createBufferSource(): StubNode {
    return new StubNode();
  }
  createBiquadFilter(): StubNode {
    return new StubNode();
  }
  createDynamicsCompressor(): StubNode {
    return new StubNode();
  }
  createConstantSource(): StubNode {
    return new StubNode();
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

/** The lasting plate cues (D11): HELD confirms and falling confirms by plate, door / bridge slides by rect. */
type Heard = { confirms: string[]; falls: string[]; slides: string[] };

function listeningAudio(): { audio: AudioSystem; heard: Heard } {
  const audio = createAudio({ seed: 1 });
  audio.unlock();
  const heard: Heard = { confirms: [], falls: [], slides: [] };
  vi.spyOn(audio.sfx, 'switchOn').mockImplementation((o) => {
    if (o?.click === false) heard.confirms.push(String(o.playerId));
  });
  vi.spyOn(audio.sfx, 'switchOff').mockImplementation((o) => {
    if (o?.chime !== false) heard.falls.push(String(o?.playerId));
  });
  vi.spyOn(audio.sfx, 'bridgeToggle').mockImplementation((active, o) => {
    heard.slides.push(`${String(o?.playerId)}:${active === true ? 'active' : 'inactive'}`);
  });
  return { audio, heard };
}

// ---- real-sim runs, every tick's state and events kept (what a server sends) ----
type Run = { readonly config: SimConfig; readonly states: SimState[]; readonly events: SimEvent[][] };

/** A shot `deg` degrees up from flat right (90 = straight up) at `power`, as a player can aim it. */
const aimOf = (deg: number, power: number): { angle: number; power: number } => ({
  angle: quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-deg * Math.PI) / 180))),
  power,
});

function recorder(config: SimConfig) {
  const first = createSim(config);
  const run: Run = { config, states: [first.state], events: [first.events] };
  let s = first.state;
  const step = (cmds: readonly PlayerCommand[] = []): void => {
    const r = stepSim(s, cmds);
    s = r.state;
    run.states[s.tick] = s;
    run.events[s.tick] = [...r.events];
  };
  const untilReady = (): void => {
    for (let i = 0; i < 3000 && !(s.phase === 'aiming' && isShotReady(s)); i += 1) step();
    if (!(s.phase === 'aiming' && isShotReady(s))) throw new Error(`never ready: ${s.phase}`);
  };
  /** The active player's shot, then every tick until the next shot can be taken. */
  const shoot = (deg: number, power: number): void => {
    const p = s.activePlayer;
    step([
      { type: 'setAim', playerId: p, ...aimOf(deg, power) },
      { type: 'shoot', playerId: p },
    ]);
    untilReady();
  };
  return { run, now: (): SimState => s, step, untilReady, shoot };
}

/**
 * Red's line on Two Doors: lobbed onto DOOR it rests there (HELD, OPEN); blue rolls short; red leaves DOOR (SHUT).
 * Returns the tick blue's turn starts, red holding DOOR.
 */
function playTwoDoors(rec: ReturnType<typeof recorder>): number {
  rec.shoot(42, 80);
  expect(rec.now()).toMatchObject({ levelId: twoDoors.id, activePlayer: 1, switches: { door: true } });
  const holding = rec.now().tick;
  rec.shoot(0, 15);
  expect(rec.now()).toMatchObject({ activePlayer: 0, switches: { door: true } });
  rec.shoot(150, 60);
  expect(rec.now().switches.door).toBe(false);
  return holding;
}

/** World 1 online from its first hole: First Fairway by its golden line, Next hole, then Two Doors (red first). */
function campaignToTwoDoors(): { run: Run; results1: number; levelStart2: number; teeOff2: number; holding2: number; end: number } {
  expect(WORLD1_IDS[1]).toBe(twoDoors.id);
  const rec = recorder({ playerCount: 2, levelIds: [...WORLD1_IDS], seed: 1, mode: 'online' });
  const line = GOLDEN_LINES.find((g) => g.levelId === WORLD1_IDS[0]);
  if (line === undefined) throw new Error('no golden line for the first hole');
  const byTick = new Map<number, PlayerCommand[]>();
  for (const e of line.log) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.cmd]);
  while (rec.now().tick < line.finalTick) rec.step(byTick.get(rec.now().tick) ?? []);
  expect(rec.now().phase).toBe('levelResults');
  const results1 = rec.now().tick;
  for (let i = 0; i < 30; i += 1) rec.step();
  rec.step([{ type: 'continue', playerId: 0 }]);
  const levelStart2 = rec.now().tick;
  expect(rec.run.events[levelStart2]).toContainEqual(expect.objectContaining({ type: 'levelStart', levelId: twoDoors.id }));
  // the intro card stays up 2.5 s before red tees off
  for (let i = 0; i < 150; i += 1) rec.step();
  rec.step([{ type: 'continue', playerId: 0 }]);
  rec.untilReady();
  const teeOff2 = rec.now().tick;
  expect(rec.now()).toMatchObject({ levelId: twoDoors.id, activePlayer: 0 });
  const holding2 = playTwoDoors(rec);
  return { run: rec.run, results1, levelStart2, teeOff2, holding2, end: rec.now().tick };
}

// ---- the page: GameCanvas mounted as App mounts it, a fake RAF and clock ----
let clock = 0;
let raf: FrameRequestCallback[] = [];

beforeEach(() => {
  clock = 1000;
  raf = [];
  seen.scene = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    raf.push(cb);
    return raf.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  HTMLCanvasElement.prototype.getContext = (() => ({ setTransform() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(window, 'AudioContext', { value: StubAudioContext, configurable: true, writable: true });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

type Page = {
  /** Every plate and way word the view said (HELD, OPEN, SHUT, GONE), once each, in order. */
  readonly words: string[];
  /** The levelStart events the page was handed. */
  readonly levelStarts: string[];
  readonly external: { current: PlayerCommand[] };
  state(): SimState | null;
  frame(now: number): void;
  unmount(): void;
};

function mount(session: LocalSession | OnlineSessionView, audio: AudioSystem): Page {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const words: string[] = [];
  const levelStarts: string[] = [];
  const said = new Set<number>();
  const external: { current: PlayerCommand[] } = { current: [] };
  const stateRef: { current: SimState | null } = { current: null };
  const props: GameCanvasProps = {
    session,
    paused: false,
    onUiAction: () => {},
    onFrame: () => {},
    onEvents: (events) => {
      for (const e of events) if (e.type === 'levelStart') levelStarts.push(e.levelId);
    },
    audio,
    externalCommands: external,
    hudRef: { current: document.createElement('div') },
    stateRef,
  };
  act(() => root.render(React.createElement(GameCanvas, props)));
  return {
    words,
    levelStarts,
    external,
    state: () => stateRef.current,
    frame(now) {
      clock = now;
      const pending = raf;
      raf = [];
      for (const cb of pending) cb(now);
      for (const c of seen.scene?.view.callouts ?? []) {
        if (said.has(c.id)) continue;
        said.add(c.id);
        if (/ (HELD|OPEN|SHUT|GONE)$/.test(c.text)) words.push(c.text);
      }
    },
    unmount: () => act(() => root.unmount()),
  };
}

// ---- online: the server's messages through a fake socket, one snapshot a tick ----
const TICK_MS = 1000 / 60;
const CODE = 'KPQ27';

class FakeSocket implements SocketHandle {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  receive(msg: ServerMessage): void {
    this.onmessage?.(JSON.stringify(msg));
  }
}

/**
 * Blue's page joins the running room at `from` (the `joined{sync}` a reload's rejoin gets: no events with it) and
 * mounts; the server then sends a snapshot every tick to `to`, with that tick's events. While `hidden(tick)` the tab
 * renders nothing (snapshots still arrive), as a background tab does.
 */
function onlinePage(run: Run, from: number, to: number, hidden: (tick: number) => boolean = () => false): Page & { heard: Heard } {
  const t0 = 50_000;
  clock = t0;
  let socket: FakeSocket | null = null;
  const client = new GameClient({
    url: 'ws://test/ws',
    now: () => clock,
    createSocket: () => (socket = new FakeSocket()),
    storage: null,
    inviteBase: '',
  });
  void client.joinRoom(CODE);
  const s = socket as unknown as FakeSocket;
  s.readyState = 1;
  s.onopen?.();
  s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: clock });
  const lobby = { levelId: run.config.levelIds[0] ?? '', players: [true, true] as [boolean, boolean], names: ['Red', 'Blue'] as [string, string] };
  const sync = { config: run.config, tick: from, snap: encodeSnapshot(run.states[from] as SimState), serverTime: clock };
  s.receive({ type: 'joined', code: CODE, playerId: 1, reconnectToken: 'b'.repeat(32), peerConnected: true, lobby, sync });
  const config = client.getConfig();
  if (config === null || client.getStatus().kind !== 'playing') throw new Error('the page did not join the running game');
  const { audio, heard } = listeningAudio();
  const page = mount({ kind: 'online', client, config, seat: 1 }, audio);
  // the render delay plus a margin, so the last events are drained
  const tail = Math.ceil(CLIENT_RENDER_DELAY_MS / TICK_MS) + 30;
  for (let t = from + 1; t <= to + tail; t += 1) {
    const now = t0 + (t - from) * TICK_MS;
    clock = now;
    if (t <= to) s.receive({ type: 'snapshot', tick: t, serverTime: now, snap: encodeSnapshot(run.states[t] as SimState), events: run.events[t] ?? [], immediate: false });
    if (!hidden(t)) page.frame(now);
  }
  page.unmount();
  client.leave();
  audio.dispose();
  return { ...page, heard };
}

/** Red settles on DOOR, then leaves it for good: what any page on Two Doors must say and play for that. */
const TWO_DOORS_WORDS = ['DOOR HELD', 'DOOR OPEN', 'DOOR SHUT'];
const TWO_DOORS_HEARD: Heard = { confirms: ['door'], falls: ['door'], slides: ['door-gate:inactive', 'door-gate:active'] };

describe('the plate trackers follow the hole an online page renders (D11)', () => {
  let built: ReturnType<typeof campaignToTwoDoors> | null = null;
  const twoDoorsRoom = (): ReturnType<typeof campaignToTwoDoors> => (built ??= campaignToTwoDoors());

  it("a page that joins mid-campaign (a reload's rejoin on Two Doors, the room's second hole) says and plays the lasting door moments", () => {
    const campaign = twoDoorsRoom();
    const page = onlinePage(campaign.run, campaign.teeOff2, campaign.end);
    // the loop opened on the room's first hole (createSim of the config); the rejoin sync carried no levelStart
    expect(page.levelStarts).toEqual([WORLD1_IDS[0]]);
    expect(page.words).toEqual(TWO_DOORS_WORDS);
    expect(page.heard).toEqual(TWO_DOORS_HEARD);
  });

  it('a page that rejoins mid-hole while red holds DOOR knows the hold from the sync: DOOR SHUT, the falling confirm and the closing slide as red leaves', () => {
    const campaign = twoDoorsRoom();
    const page = onlinePage(campaign.run, campaign.holding2, campaign.end);
    expect(page.levelStarts).toEqual([WORLD1_IDS[0]]);
    expect(page.words).toEqual(['DOOR SHUT']);
    expect(page.heard).toEqual({ confirms: [], falls: ['door'], slides: ['door-gate:active'] });
  });

  it.each([
    ['as it lands on the plate, before it rocks off it and back (no DOOR SHUT for a door nobody had opened)', 'landing'],
    ['as it rocks back onto the plate for the last time, before it settles (DOOR OPEN when it does)', 'settling'],
  ])("a page that rejoins while red's lob is still moving on DOOR, %s, says and plays what a page that saw it land does", (_case, when) => {
    const campaign = twoDoorsRoom();
    const states = campaign.run.states as SimState[];
    const door = twoDoors.switches.find((s) => s.id === 'door');
    if (door === undefined) throw new Error('Two Doors has a DOOR plate');
    const red = (t: number): SimState['balls'][number] => (states[t] as SimState).balls[0];
    const doorDown = (t: number): boolean => (states[t] as SimState).switches.door === true;
    let landing = campaign.teeOff2;
    while (!doorDown(landing)) landing += 1;
    let rest = landing;
    while (!red(rest).asleep) rest += 1;
    const at = when === 'landing' ? landing + 1 : rest - 1;
    // the plate is down under red, still moving; its last rest is off the plate (nothing lasting has happened yet)
    expect(doorDown(at)).toBe(true);
    expect(red(at).asleep).toBe(false);
    expect(red(at).lastRest.x < door.x || red(at).lastRest.x > door.x + door.w).toBe(true);
    // from the landing, red rocks off the plate (the door shuts) and back before it settles
    if (when === 'landing') expect(Array.from({ length: rest - at }, (_, i) => at + i).some((t) => !doorDown(t))).toBe(true);
    const page = onlinePage(campaign.run, at, campaign.end);
    expect(page.levelStarts).toEqual([WORLD1_IDS[0]]);
    expect(page.words).toEqual(TWO_DOORS_WORDS);
    expect(page.heard).toEqual(TWO_DOORS_HEARD);
  });

  it.each([8, 14, 24])(
    'a tab hidden for 70 ticks that comes back %i ticks after red settles on DOOR (its rest among the events the first frame drains) says DOOR HELD and DOOR OPEN',
    (after) => {
      const campaign = twoDoorsRoom();
      const states = campaign.run.states as SimState[];
      let rest = campaign.teeOff2;
      while (!((states[rest] as SimState).switches.door === true && (states[rest] as SimState).balls[0].asleep)) rest += 1;
      expect(campaign.run.events[rest]).toContainEqual(expect.objectContaining({ type: 'ballRest', playerId: 0 }));
      const back = rest + after;
      // the rest falls inside the replay window of the frame the tab comes back on, after the snapshot it renders from
      const window = Math.ceil(EVENT_REPLAY_WINDOW_MS / TICK_MS);
      const renderDelay = Math.ceil(CLIENT_RENDER_DELAY_MS / TICK_MS);
      expect(rest).toBeGreaterThan(back - renderDelay - window);
      expect(rest).toBeLessThanOrEqual(back - renderDelay);
      const page = onlinePage(campaign.run, campaign.results1, campaign.end, (t) => t >= back - 70 && t < back);
      expect(page.levelStarts).toEqual([WORLD1_IDS[0], twoDoors.id]);
      expect(page.words).toEqual(TWO_DOORS_WORDS);
      expect(page.heard).toEqual(TWO_DOORS_HEARD);
    },
  );

  it("a tab hidden while the partner moves on to the next hole drops that hole's levelStart, and still has its words and sounds there", () => {
    // the tab sits on First Fairway's results card; it goes to the background as the partner presses Next hole and
    // comes back on the intro card, long enough after for the levelStart's batch to be dropped as stale
    const campaign = twoDoorsRoom();
    const away = Math.ceil((EVENT_REPLAY_WINDOW_MS + CLIENT_RENDER_DELAY_MS) / TICK_MS) + 24;
    const hidden = (t: number): boolean => t >= campaign.levelStart2 - 6 && t <= campaign.levelStart2 + away;
    expect(campaign.levelStart2 + away).toBeLessThan(campaign.teeOff2);
    const page = onlinePage(campaign.run, campaign.results1, campaign.end, hidden);
    expect(page.levelStarts).toEqual([WORLD1_IDS[0]]);
    expect(page.words).toEqual(TWO_DOORS_WORDS);
    expect(page.heard).toEqual(TWO_DOORS_HEARD);
  });

  it('the control: a page that saw Two Doors start (its levelStart drained in time) says and plays the same', () => {
    const campaign = twoDoorsRoom();
    const page = onlinePage(campaign.run, campaign.results1, campaign.end);
    expect(page.levelStarts).toEqual([WORLD1_IDS[0], twoDoors.id]);
    expect(page.words).toEqual(TWO_DOORS_WORDS);
    expect(page.heard).toEqual(TWO_DOORS_HEARD);
  });
});

// ---- a `?state=` link, resumed locally ----

/** App.sharedSession for two players on one keyboard: the decoded state with one synthetic levelStart. */
function sharedSession(param: string): LocalSession {
  const shared = decodeShareLink(param);
  const config: SimConfig = { ...shared.config, playerCount: 2, mode: 'local' };
  const state: SimState = { ...shared.state, config };
  const events: SimEvent[] = [{ type: 'levelStart', levelId: state.levelId, levelIndex: state.levelIndex, firstPlayer: twoDoors.firstPlayer, restarted: false, tick: state.tick }];
  return { kind: 'local', config, initial: { state, events }, seats: [0, 1] };
}

/** One frame a tick, a hair over DT so every frame steps the sim exactly once. */
const FRAME_MS = DT * 1000 + 1e-4;

function frameUntilReady(page: Page): void {
  for (let i = 0; i < 3000; i += 1) {
    page.frame(clock + FRAME_MS);
    const s = page.state();
    if (i > 2 && s !== null && s.phase === 'aiming' && isShotReady(s)) return;
  }
  throw new Error('the shot never settled');
}

function shootOn(page: Page, deg: number, power: number): void {
  const s = page.state();
  if (s === null) throw new Error('no state rendered yet');
  page.external.current.push({ type: 'setAim', playerId: s.activePlayer, ...aimOf(deg, power) }, { type: 'shoot', playerId: s.activePlayer });
  frameUntilReady(page);
  for (let i = 0; i < 30; i += 1) page.frame(clock + FRAME_MS);
}

describe("a `?state=` link resumed with red holding DOOR: audio's tracker knows the hold (D11)", () => {
  const config: SimConfig = { playerCount: 2, levelIds: [twoDoors.id], seed: 7, mode: 'local' };

  it.each([
    ['red leaves DOOR for good (150/60)', 150, 60],
    ['red taps too hard and lands back on DOOR (90/50)', 90, 50],
  ])('%s: the same words and plate sounds as the game played from the tee', (_case, deg, power) => {
    // the link: red lobbed onto DOOR and rests there, blue rolled short, red to shoot (copied from the pause menu)
    const rec = recorder(config);
    rec.step([{ type: 'continue', playerId: 0 }]);
    rec.untilReady();
    rec.shoot(42, 80);
    rec.shoot(0, 15);
    expect(rec.now()).toMatchObject({ activePlayer: 0, switches: { door: true } });
    const link = encodeShareLink(rec.now());

    const resumed = listeningAudio();
    const page = mount(sharedSession(link), resumed.audio);
    for (let i = 0; i < 20; i += 1) page.frame(clock + FRAME_MS);
    shootOn(page, deg, power);
    page.unmount();

    // the control: the same game from the tee, both trackers there when red's hold began
    const fromTee = listeningAudio();
    const control = mount({ kind: 'local', config, initial: createSim(config), seats: [0, 1] }, fromTee.audio);
    control.external.current.push({ type: 'continue', playerId: 0 });
    frameUntilReady(control);
    shootOn(control, 42, 80);
    shootOn(control, 0, 15);
    expect(control.state()?.balls).toEqual(rec.now().balls);
    const words = control.words.length;
    const heard: Heard = { confirms: [...fromTee.heard.confirms], falls: [...fromTee.heard.falls], slides: [...fromTee.heard.slides] };
    shootOn(control, deg, power);
    control.unmount();
    const controlHeard: Heard = {
      confirms: fromTee.heard.confirms.slice(heard.confirms.length),
      falls: fromTee.heard.falls.slice(heard.falls.length),
      slides: fromTee.heard.slides.slice(heard.slides.length),
    };

    expect(page.words).toEqual(control.words.slice(words));
    expect(resumed.heard).toEqual(controlHeard);
    // and the lasting moments are there: the hold ended (falling confirm) and the door slid shut
    expect(resumed.heard.falls).toEqual(['door']);
    expect(resumed.heard.slides[0]).toBe('door-gate:active');
    resumed.audio.dispose();
    fromTee.audio.dispose();
  });
});
