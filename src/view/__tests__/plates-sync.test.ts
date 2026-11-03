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
import { waitingOf } from '../../sim/devices';
import { WORLD1_IDS } from '../../sim/levels/index';
import { level as twoDoors } from '../../sim/levels/w1-02-two-doors';
import { level as plateAndBridge } from '../../sim/levels/w1-04-plate-and-bridge';
import { level as boobyTrap } from '../../sim/levels/w2-06-booby-trap';
import { evaluateSwitches } from '../../sim/physics';
import { decodeShareLink, encodeShareLink, encodeSnapshot } from '../../sim/serialize';
import { createSim, isShotReady, stepSim } from '../../sim/sim';
import type { BallState, Level, PlayerCommand, PlayerId, SimConfig, SimEvent, SimState, Vec } from '../../sim/types';
import { AIM_ANGLE_MAX, AIM_ANGLE_MIN, BALL_RADIUS, DT, REST_TICKS, quantize4 } from '../../sim/types';
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

/**
 * Every plate cue audio voices (clicks, ticks, confirms, slides, snaps, latches, chimes), as `<tick>:<cue>:<key>`, the
 * tick being the frame's (`at.tick`, set by the page loop).
 */
type Cues = { readonly list: string[]; readonly at: { tick: number } };

function listeningAudio(): { audio: AudioSystem; heard: Heard; cues: Cues } {
  const audio = createAudio({ seed: 1 });
  audio.unlock();
  const heard: Heard = { confirms: [], falls: [], slides: [] };
  const cues: Cues = { list: [], at: { tick: -1 } };
  const cue = (what: string, key: unknown): void => void cues.list.push(`${cues.at.tick}:${what}:${String(key)}`);
  vi.spyOn(audio.sfx, 'switchOn').mockImplementation((o) => {
    if (o?.click === false) heard.confirms.push(String(o.playerId));
    cue(o?.click === false ? 'confirm' : o?.volume !== undefined ? 'soft-click' : 'click', o?.playerId);
  });
  vi.spyOn(audio.sfx, 'switchOff').mockImplementation((o) => {
    if (o?.chime !== false) heard.falls.push(String(o?.playerId));
    cue(o?.chime === false ? 'tick' : 'falling-confirm', o?.playerId);
  });
  vi.spyOn(audio.sfx, 'bridgeToggle').mockImplementation((active, o) => {
    heard.slides.push(`${String(o?.playerId)}:${active === true ? 'active' : 'inactive'}`);
    cue(`slide-${active === true ? 'active' : 'inactive'}`, o?.playerId);
  });
  vi.spyOn(audio.sfx, 'trapCaught').mockImplementation((o) => cue(o?.chime === false ? 'quiet-snap' : 'snap', o?.playerId));
  vi.spyOn(audio.sfx, 'trapFreed').mockImplementation((o) => cue(o?.chime === false ? 'quiet-latch' : o?.click === false ? 'free-chime' : 'free', o?.playerId));
  return { audio, heard, cues };
}

// ---- real-sim runs, every tick's state and events kept (what a server sends) ----
type Run = { readonly config: SimConfig; readonly states: SimState[]; readonly events: SimEvent[][] };

/** A shot `deg` degrees up from flat right (90 = straight up) at `power`, as a player can aim it. */
const aimOf = (deg: number, power: number): { angle: number; power: number } => ({
  angle: quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-deg * Math.PI) / 180))),
  power,
});

/** From createSim, or from `from` (a state set up by hand, as the room's state a page joins). */
function recorder(config: SimConfig, from?: SimState) {
  const first = from === undefined ? createSim(config) : { state: from, events: [] };
  const run: Run = { config, states: [], events: [] };
  run.states[first.state.tick] = first.state;
  run.events[first.state.tick] = [...first.events];
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
  /** Every plate word the view said, jaws words too (SNAP!, FREE!), as `<tick>:<word>` with the tick of its frame. */
  readonly timeline: string[];
  /** The levelStart events the page was handed. */
  readonly levelStarts: string[];
  readonly external: { current: PlayerCommand[] };
  state(): SimState | null;
  /** The callouts on screen in the frame just rendered. */
  alive(): string[];
  frame(now: number, tick?: number): void;
  unmount(): void;
};

/** A plate word: a plate's HELD, a door's or bridge's OPEN / SHUT / GONE, a trap's SNAP! / FREE!. */
const PLATE_WORD = / (HELD|OPEN|SHUT|GONE)$|^(SNAP|FREE)!$/;

function mount(session: LocalSession | OnlineSessionView, audio: AudioSystem): Page {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const words: string[] = [];
  const timeline: string[] = [];
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
    timeline,
    levelStarts,
    external,
    state: () => stateRef.current,
    alive: () => (seen.scene?.view.callouts ?? []).map((c) => c.text),
    frame(now, tick = -1) {
      clock = now;
      const pending = raf;
      raf = [];
      for (const cb of pending) cb(now);
      for (const c of seen.scene?.view.callouts ?? []) {
        if (said.has(c.id)) continue;
        said.add(c.id);
        if (/ (HELD|OPEN|SHUT|GONE)$/.test(c.text)) words.push(c.text);
        if (PLATE_WORD.test(c.text)) timeline.push(`${tick}:${c.text}`);
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
 * Blue's page (or `seat`'s) joins the running room at `from` (the `joined{sync}` a reload's rejoin gets: no events with
 * it) and mounts; the server then sends a snapshot every tick to `to`, with that tick's events. While `hidden(tick)` the
 * tab renders nothing (snapshots still arrive), as a background tab does, and the browser tells the page when it is
 * visible again (`visibilitychange`). `cues` and `alive` (the callouts on screen at each rendered tick) are kept by tick.
 */
function onlinePage(
  run: Run,
  from: number,
  to: number,
  hidden: (tick: number) => boolean = () => false,
  seat: PlayerId = 1,
  beforeMount: (client: GameClient) => void = () => {},
): Page & { heard: Heard; cues: string[]; aliveAt: Map<number, string[]> } {
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
  s.receive({ type: 'joined', code: CODE, playerId: seat, reconnectToken: 'b'.repeat(32), peerConnected: true, lobby, sync });
  const config = client.getConfig();
  if (config === null || client.getStatus().kind !== 'playing') throw new Error('the page did not join the running game');
  const { audio, heard, cues } = listeningAudio();
  beforeMount(client);
  const page = mount({ kind: 'online', client, config, seat }, audio);
  const aliveAt = new Map<number, string[]>();
  // the render delay plus a margin, so the last events are drained
  const tail = Math.ceil(CLIENT_RENDER_DELAY_MS / TICK_MS) + 30;
  let away = false;
  for (let t = from + 1; t <= to + tail; t += 1) {
    const now = t0 + (t - from) * TICK_MS;
    clock = now;
    if (t <= to) s.receive({ type: 'snapshot', tick: t, serverTime: now, snap: encodeSnapshot(run.states[t] as SimState), events: run.events[t] ?? [], immediate: false });
    if (hidden(t)) {
      away = true;
      continue;
    }
    if (away) document.dispatchEvent(new Event('visibilitychange'));
    away = false;
    cues.at.tick = t;
    page.frame(now, t);
    aliveAt.set(t, page.alive());
  }
  page.unmount();
  client.leave();
  audio.dispose();
  return { ...page, heard, cues: cues.list, aliveAt };
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

  it("a loop that finds the sync already taken (by a loop before it) re-bases on the state it draws, and is as right: DOOR SHUT and its sounds as red leaves", () => {
    const campaign = twoDoorsRoom();
    const page = onlinePage(campaign.run, campaign.holding2, campaign.end, () => false, 1, (client) => {
      expect(client.takeStreamBreak().synced).not.toBeNull();
    });
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

// ---- a hidden tab: the batches it dropped as stale reach both trackers in order, without being shown or played ----

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;
/** How far behind a frame its render time is, and how far behind that its replay window reaches (one snapshot a tick). */
const RENDER_DELAY_TICKS = Math.ceil(CLIENT_RENDER_DELAY_MS / TICK_MS);
const REPLAY_TICKS = Math.ceil(EVENT_REPLAY_WINDOW_MS / TICK_MS);
const tickOf = (entry: string): number => Number(entry.split(':')[0]);
const resting = (pos: Vec): BallState => ({ pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos });

function plateSpot(level: Level, id: string): Vec {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`${level.id} has no plate ${id}`);
  return { x: sw.x + sw.w / 2, y: sw.surfaceY - BALL_RADIUS };
}

type HolderShot = { run: Run; from: number; hit: number; rest: number; end: number; holder: PlayerId; partner: PlayerId };

/**
 * An online room on `level` past its intro card: the holder rests on `plate` (red; or blue, when red waits in `trap`
 * let go by blue's press), the partner on its tee (or in the trap). 20 ticks in, the holder shoots; the run ends a
 * second after the next shot could be taken. `from` is the tick a page joins at (the room's state as set up).
 */
function holderShot(level: Level, plate: string, trap: string | undefined, deg: number, power: number): HolderShot {
  const config: SimConfig = { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'online' };
  const intro = stepSim(createSim(config).state, [{ type: 'continue', playerId: RED }]).state;
  const rect = trap === undefined ? undefined : level.rects.find((r) => r.id === trap);
  const seat = rect === undefined ? undefined : { x: rect.x + rect.w / 2, y: rect.y + rect.h - BALL_RADIUS };
  const holder = seat === undefined ? RED : BLUE;
  const balls: [BallState, BallState] = seat === undefined ? [resting(plateSpot(level, plate)), resting(level.starts[1])] : [resting(seat), resting(plateSpot(level, plate))];
  const up = Object.fromEntries(level.switches.map((s) => [s.id, false]));
  const switches = evaluateSwitches(level, evaluateSwitches(level, up, balls), balls);
  const s0: SimState = { ...intro, balls, switches, activePlayer: holder, turnDelayTicks: 0, phase: 'aiming' };
  expect(s0.switches[plate]).toBe(true);
  if (seat !== undefined) expect(waitingOf(level, s0.switches, s0.balls[RED])).toBeNull();
  const rec = recorder(config, s0);
  for (let i = 0; i < 20; i += 1) rec.step();
  rec.shoot(deg, power);
  for (let i = 0; i < 60; i += 1) rec.step();
  const all = rec.run.events.flatMap((evs) => evs ?? []);
  const hit = all.find((e) => e.type === 'ballHit' && e.playerId === holder)?.tick ?? -1;
  const rest = all.find((e) => e.type === 'ballRest' && e.playerId === holder && e.tick > hit)?.tick ?? -1;
  expect(hit).toBeGreaterThan(s0.tick);
  expect(rest).toBeGreaterThan(hit);
  return { run: rec.run, from: s0.tick, hit, rest, end: rec.now().tick, holder, partner: holder === RED ? BLUE : RED };
}

describe("a hidden tab takes in the batches it dropped without showing or playing them, and keeps every later word right (D11)", () => {
  const STALLS: Array<[string, Level, string, string | undefined, number, number]> = [
    ['L2, red resting on DOOR, stall tap 90/15', twoDoors, 'door', undefined, 90, 15],
    ['L2, red resting on DOOR, stall tap 90/46', twoDoors, 'door', undefined, 90, 46],
    ['L4, red resting on A, stall tap 90/15', plateAndBridge, 'near', undefined, 90, 15],
    ['L6, blue resting on FREE with red let go in the snare, tap 80/20', boobyTrap, 'free', 'snare', 80, 20],
  ];

  it.each(STALLS)("%s: the partner's page, hidden across the tap and back before, as or after the holder settles, repeats no word and no sound", (_case, level, plate, trap, deg, power) => {
    const shot = holderShot(level, plate, trap, deg, power);
    // the tap never lets the plate up, so nothing lasting happens: a page that sees all of it says and plays nothing
    expect(shot.run.events.flatMap((evs) => evs ?? []).filter((e) => (e.type === 'switchOn' || e.type === 'switchOff') && e.switchId === plate)).toEqual([]);
    const control = onlinePage(shot.run, shot.from, shot.end, () => false, shot.partner);
    expect({ words: control.timeline, cues: control.cues }).toEqual({ words: [], cues: [] });
    // back before the rest is drained, with the rest among the events of the return frame, and after its batch is stale
    const backs = [shot.rest - 4, shot.rest + 4, shot.rest + 10, shot.rest + 20, shot.rest + 30, shot.rest + 44];
    const drainedOnReturn = (back: number): boolean => shot.rest >= back - RENDER_DELAY_TICKS - REPLAY_TICKS && shot.rest <= back - RENDER_DELAY_TICKS;
    expect(backs.filter(drainedOnReturn)).toHaveLength(3);
    for (const back of backs) {
      const page = onlinePage(shot.run, shot.from, shot.end, (t) => t > shot.hit - 5 && t < back, shot.partner);
      expect({ back, words: page.timeline, cues: page.cues }).toEqual({ back, words: [], cues: [] });
    }
  });

  /** Two Doors online, red's line (TWO_DOORS_WORDS): the ticks of red's rest on DOOR, red's leaving shot and DOOR's release. */
  let room: { campaign: ReturnType<typeof campaignToTwoDoors>; landed: number; leaveHit: number; off: number } | null = null;
  const twoDoorsLeave = (): NonNullable<typeof room> => {
    if (room !== null) return room;
    const campaign = campaignToTwoDoors();
    const evs = campaign.run.events.map((list, tick) => ({ tick, list: list ?? [] }));
    const landed = evs.find((t) => t.tick > campaign.teeOff2 && t.list.some((e) => e.type === 'ballRest' && e.playerId === RED))?.tick ?? -1;
    const leaveHit = [...evs].reverse().find((t) => t.list.some((e) => e.type === 'ballHit' && e.playerId === RED))?.tick ?? -1;
    const off = evs.find((t) => t.tick > leaveHit && t.list.some((e) => e.type === 'switchOff' && e.switchId === 'door'))?.tick ?? -1;
    expect(campaign.holding2).toBeGreaterThan(landed);
    expect(off).toBeGreaterThan(leaveHit);
    room = { campaign, landed, leaveHit, off };
    return room;
  };

  it('a holder leaving for good while the tab is hidden, the batch with its release and DOOR SHUT dropped as stale: no SHUT on return, and nothing played', () => {
    const { campaign, leaveHit, off } = twoDoorsLeave();
    const hideFrom = leaveHit - 5;
    const back = off + RENDER_DELAY_TICKS + REPLAY_TICKS + 10;
    // the release is older than the replay window of the frame the tab comes back on
    expect(off).toBeLessThan(back - RENDER_DELAY_TICKS - REPLAY_TICKS);
    const page = onlinePage(campaign.run, campaign.results1, campaign.end, (t) => t >= hideFrom && t < back);
    // red's landing was seen and heard; nothing of its leaving is, on return or after
    expect(page.words).toEqual(['DOOR HELD', 'DOOR OPEN']);
    expect(page.heard).toEqual({ confirms: ['door'], falls: [], slides: ['door-gate:inactive'] });
    expect(page.cues.filter((c) => tickOf(c) >= hideFrom)).toEqual([]);
    for (const [tick, alive] of page.aliveAt) if (tick >= back) expect(alive.filter((w) => w.startsWith('DOOR')), `t${tick}`).toEqual([]);
  });

  it('a tab hidden just after DOOR HELD and DOOR OPEN, across blue\'s turn and red leaving DOOR for good: those words are gone on return, and no SHUT comes', () => {
    const { campaign, off } = twoDoorsLeave();
    const control = onlinePage(campaign.run, campaign.results1, campaign.end);
    const shownAt = tickOf(control.timeline.find((w) => w.endsWith(':DOOR OPEN')) ?? '');
    const hideFrom = shownAt + 2;
    const back = off + RENDER_DELAY_TICKS + REPLAY_TICKS + 10;
    const page = onlinePage(campaign.run, campaign.results1, campaign.end, (t) => t >= hideFrom && t < back);
    // the words were still on screen as the tab hid (the view's clock stops while it is hidden)
    expect(page.aliveAt.get(hideFrom - 1)).toEqual(expect.arrayContaining(['DOOR HELD', 'DOOR OPEN']));
    // on return the door is shut and red is gone: neither word stands any more, and no word or sound comes for it
    for (const [tick, alive] of page.aliveAt) if (tick >= back) expect(alive.filter((w) => w.startsWith('DOOR')), `t${tick}`).toEqual([]);
    expect(page.words).toEqual(['DOOR HELD', 'DOOR OPEN']);
    expect(page.cues.filter((c) => tickOf(c) >= hideFrom)).toEqual([]);
  });

  it.each([
    ['L2: red hops off DOOR (DOOR SHUT as it rises) and lands back on it', twoDoors, 'door', undefined, 'DOOR SHUT'],
    ['L6: blue hops off FREE (SNAP! as the snare re-arms around red) and lands back on it', boobyTrap, 'free', 'snare', 'SNAP!'],
  ] as Array<[string, Level, string, string | undefined, string]>)(
    '%s while the tab is hidden: the word on screen as it hid, taken back by the dropped landing, is gone on return',
    (_case, level, plate, trap, word) => {
      const shot = holderShot(level, plate, trap, 90, 50);
      const all = shot.run.events.flatMap((evs) => evs ?? []);
      const off = all.find((e) => e.type === 'switchOff' && e.switchId === plate)?.tick ?? -1;
      const on = all.find((e) => e.type === 'switchOn' && e.switchId === plate && e.tick > off)?.tick ?? -1;
      // a long hop: the holder is off the plate for over half a second, and settles on it later
      expect(on - off).toBeGreaterThan(30);
      expect(shot.rest).toBeGreaterThan(on);
      const control = onlinePage(shot.run, shot.from, shot.end, () => false, shot.partner);
      const shownAt = tickOf(control.timeline.find((w) => w.endsWith(`:${word}`)) ?? '');
      // hidden from the frame after the word appears; back once the landing's batch is just past the replay window, and
      // before the holder's rest is drained
      const hideFrom = shownAt + 1;
      const back = on + RENDER_DELAY_TICKS + REPLAY_TICKS + 2;
      expect(on).toBeLessThan(back - RENDER_DELAY_TICKS - REPLAY_TICKS);
      expect(shot.rest).toBeGreaterThan(back - RENDER_DELAY_TICKS);
      const page = onlinePage(shot.run, shot.from, shot.end, (t) => t >= hideFrom && t < back, shot.partner);
      expect(page.aliveAt.get(hideFrom - 1)).toContain(word);
      expect(page.aliveAt.get(back)).not.toContain(word);
      // the holder then settles: every word and sound as the page that saw it all (the rest's HELD, OPEN / FREE!)
      expect(page.timeline).toEqual(control.timeline);
      expect(page.heard).toEqual(control.heard);
    },
  );
});
