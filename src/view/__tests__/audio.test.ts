// @vitest-environment jsdom
// OWNER: view
// ARCH.md §4 view row (audio debounce) + AUDIO.md §8 item 8 and §11 (Worlds 2-3), under a stubbed AudioContext.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitingOf } from '../../sim/devices';
import { campaignFrom, levelsOfWorld, WORLD1_IDS, WORLD_IDS } from '../../sim/levels';
import { level as twoDoors } from '../../sim/levels/w1-02-two-doors';
import { level as boobyTrap } from '../../sim/levels/w2-06-booby-trap';
import { level as skyBridge } from '../../sim/levels/w3-10-sky-bridge';
import { level as grandMachine } from '../../sim/levels/w3-12-grand-machine';
import { evaluateSwitches } from '../../sim/physics';
import { createSim, isShotReady, stepSim } from '../../sim/sim';
import { AIM_ANGLE_MAX, BALL_RADIUS, DT, REST_TICKS, quantize4 } from '../../sim/types';
import type { BallState, Level, LevelRectKind, PlayerId, SimConfig, SimEvent, SimEventType, SimState, Vec, WorldId } from '../../sim/types';
import { createAudio, MUSIC_TRACKS, type AudioSystem, type Sfx, type SfxName } from '../audio';

/** Every SfxName, checked by the compiler both ways: a name added to the union must be listed here. */
const SFX_SET = {
  hit: true, bounceSoft: true, bounceHard: true, sand: true, spring: true, bumper: true, fan: true, gateBlock: true,
  gatePass: true, switchOn: true, switchOff: true, bridge: true, fall: true, rest: true, nearCup: true, lipOut: true,
  gimme: true, sink: true, levelWin: true, campaignWin: true, turn: true, uiClick: true, uiBack: true, uiHover: true,
  uiInvalid: true, uiPause: true, uiResume: true, partnerJoined: true, partnerLeft: true, aimTick: true, trapCaught: true,
  trapFreed: true, trapReturn: true, cannonLoad: true, cannonFire: true, turnSkipped: true, flightTimeout: true,
} as const satisfies Record<SfxName, true>;
const SFX_NAMES = Object.keys(SFX_SET) as SfxName[];

/** The player notes (AUDIO.md §0): red owns C5, blue owns G5. */
const RED_NOTE = 523.25;
const BLUE_NOTE = 783.99;

/** Tracks event times (enough to catch a cancelAndHoldAtTime that lands before the param's first event) and the
 *  values set with setValueAtTime (an oscillator voice's first one is its pitch). */
class FakeParam {
  /** Holds at a time earlier than every scheduled event: the real param would fall back to its default value. */
  static holdsBeforeFirstEvent = 0;
  value = 0;
  readonly set: number[] = [];
  /** [value, time] of each linear ramp (a voice cut short ramps its output gain to 0). */
  readonly ramps: Array<[number, number]> = [];
  private times: number[] = [];
  setValueAtTime(v: number, t: number): void {
    this.set.push(v);
    this.times.push(t);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.ramps.push([v, t]);
    this.times.push(t);
  }
  exponentialRampToValueAtTime(_v: number, t: number): void {
    this.times.push(t);
  }
  setTargetAtTime(_v: number, t: number): void {
    this.times.push(t);
  }
  cancelScheduledValues(t: number): void {
    this.times = this.times.filter((x) => x < t);
  }
  cancelAndHoldAtTime(t: number): void {
    if (this.times.length > 0 && this.times.every((x) => x > t)) FakeParam.holdsBeforeFirstEvent += 1;
    this.times = [...this.times.filter((x) => x <= t), t];
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  offset = new FakeParam();
  playbackRate = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  stopped = false;
  startAt = 0;
  stopAt = Infinity;
  connect(): FakeNode {
    return this;
  }
  disconnect(): void {}
  start(t = 0): void {
    this.startAt = t;
  }
  stop(t = 0): void {
    this.stopped = true;
    this.stopAt = t;
  }
}

class FakeAudioContext {
  static oscillators = 0;
  static created: FakeNode[] = [];
  static gains: FakeNode[] = [];
  static sentinels: FakeNode[] = [];
  static noiseSamples: Float32Array[] = [];
  static last: FakeAudioContext | null = null;
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  constructor() {
    FakeAudioContext.last = this;
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain(): FakeNode {
    const node = new FakeNode();
    FakeAudioContext.gains.push(node);
    return node;
  }
  createOscillator(): FakeNode {
    FakeAudioContext.oscillators += 1;
    const node = new FakeNode();
    FakeAudioContext.created.push(node);
    return node;
  }
  createBufferSource(): FakeNode {
    return new FakeNode();
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }
  createConstantSource(): FakeNode {
    const node = new FakeNode();
    FakeAudioContext.sentinels.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length);
    if (length > 1) FakeAudioContext.noiseSamples.push(data);
    return { getChannelData: () => data };
  }
}

class ThrowingAudioContext {
  static attempts = 0;
  constructor() {
    ThrowingAudioContext.attempts += 1;
    throw new Error('NotSupportedError: too many AudioContexts');
  }
}

function installFakeContext(): void {
  FakeAudioContext.oscillators = 0;
  FakeAudioContext.created = [];
  FakeAudioContext.gains = [];
  FakeAudioContext.sentinels = [];
  FakeAudioContext.noiseSamples = [];
  FakeAudioContext.last = null;
  FakeParam.holdsBeforeFirstEvent = 0;
  Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true });
}

/** Every scheduled voice ends (its sentinel releases the slot) and the audio clock moves past every retrigger window. */
function settleVoices(): void {
  for (const s of FakeAudioContext.sentinels.splice(0)) s.onended?.();
  if (FakeAudioContext.last !== null) FakeAudioContext.last.currentTime += 10;
}

function removeContext(): void {
  Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true, writable: true });
}

function oscillatorsDuring(fn: () => void): number {
  const before = FakeAudioContext.oscillators;
  fn();
  return FakeAudioContext.oscillators - before;
}

/** SFX voices admitted while `fn` runs: each one opens exactly one slot sentinel. */
function voicesDuring(fn: () => void): number {
  const before = FakeAudioContext.sentinels.length;
  fn();
  return FakeAudioContext.sentinels.length - before;
}

/** The oscillators created while `fn` runs. */
function createdDuring(fn: () => void): FakeNode[] {
  const before = FakeAudioContext.created.length;
  fn();
  return FakeAudioContext.created.slice(before);
}

/** An SFX oscillator's pitch is its first setValueAtTime; a pad oscillator's is its plain value. */
const pitchOf = (o: FakeNode): number => o.frequency.set[0] ?? o.frequency.value;
const triangles = (nodes: readonly FakeNode[]): FakeNode[] => nodes.filter((o) => o.type === 'triangle');
/** [pitch, start in whole ms] of each SFX triangle (player notes, chimes; the bed's pad tones set a plain value). */
const melody = (nodes: readonly FakeNode[]): Array<[number, number]> =>
  triangles(nodes)
    .filter((o) => o.frequency.set.length > 0)
    .map((o) => [pitchOf(o), Math.round(o.startAt * 1000)]);
/** A pad chord is two detuned triangles per tone. */
const padPitches = (nodes: readonly FakeNode[]): number[] => triangles(nodes).map((o) => o.frequency.value).sort((a, b) => a - b);
const twice = (tones: readonly number[]): number[] => [...tones, ...tones].sort((a, b) => a - b);

function context(): FakeAudioContext {
  const c = FakeAudioContext.last;
  if (c === null) throw new Error('no context');
  return c;
}

/** Unlocked and running (onRunning has fired, so ready() follows the context state alone). */
async function runningAudio(): Promise<AudioSystem> {
  const audio = createAudio({ seed: 1 });
  audio.unlock();
  await Promise.resolve();
  return audio;
}

const P0 = { x: 0, y: 0 };
const switchOnAt = (tick: number): SimEvent => ({ type: 'switchOn', tick, switchId: 'a', byPlayer: 0, pos: { x: 0, y: 0 } });
const levelStartOf = (levelId: string, tick: number): SimEvent => ({ type: 'levelStart', tick, levelId, levelIndex: 0, firstPlayer: 0, restarted: false });
const trapReturnAt = (tick: number, playerId: PlayerId): SimEvent => ({ type: 'trapReturn', tick, playerId, pos: P0, respawnPos: P0, strokes: 3, toTee: false });
const trapFreedAt = (tick: number, playerId: PlayerId): SimEvent => ({ type: 'trapFreed', tick, playerId, pos: P0, rectId: 'snare' });
/** The WAITING rule's pair (D10.5): `skippedAt` passes over the waiting ball, `againAt` hands the shooter the turn again. */
const skippedAt = (tick: number, playerId: PlayerId): SimEvent => ({ type: 'turnSkipped', tick, playerId, reason: 'caught', rectId: 'snare', nextPlayer: playerId === 0 ? 1 : 0 });
const againAt = (tick: number, playerId: PlayerId): SimEvent => ({ type: 'turnStart', tick, playerId, readyInTicks: 27, sameAsBefore: true });
const cannonFireAt = (tick: number, playerId: PlayerId): SimEvent => ({ type: 'cannonFire', tick, playerId, pos: P0, rectId: 'cannon', launch: { x: 400, y: -700 } });
const bridgeToggleOf = (kind: LevelRectKind, tick = 1): SimEvent => ({ type: 'bridgeToggle', tick, rectId: `${kind}-1`, kind, active: true, switchId: 'a' });
/** Two Doors' DOOR (a blocker: active = shut) as the sim toggles it. */
const doorToggle = (tick: number, active: boolean): SimEvent => ({ type: 'bridgeToggle', tick, rectId: 'door-gate', kind: 'blocker', active, switchId: 'door' });

function plateOf(level: Level, id: string): Level['switches'][number] {
  const sw = level.switches.find((s) => s.id === id);
  if (sw === undefined) throw new Error(`${level.id} has no plate ${id}`);
  return sw;
}

/** Every ball-owned event a trap, a cannon or the watchdog adds (D10.4), built for one ball, and the voice it must reach. */
const DEVICE_VOICES: ReadonlyArray<{ readonly voice: keyof Sfx; readonly make: (playerId: PlayerId) => SimEvent }> = [
  { voice: 'trapCaught', make: (playerId) => ({ type: 'trapCaught', tick: 1, playerId, pos: P0, rectId: 'snare' }) },
  { voice: 'trapFreed', make: (playerId) => trapFreedAt(1, playerId) },
  { voice: 'trapReturn', make: (playerId) => trapReturnAt(1, playerId) },
  { voice: 'cannonLoad', make: (playerId) => ({ type: 'cannonLoad', tick: 1, playerId, pos: P0, rectId: 'cannon' }) },
  { voice: 'cannonFire', make: (playerId) => cannonFireAt(1, playerId) },
  { voice: 'flightTimeout', make: (playerId) => ({ type: 'flightTimeout', tick: 1, playerId, pos: P0, respawnPos: P0 }) },
];
const fellAt = (tick: number, playerId: 0 | 1): SimEvent => ({ type: 'fellOffWorld', tick, playerId, pos: { x: 0, y: 900 }, respawnPos: { x: 0, y: 0 }, strokes: 2 });
const turnStartAt = (tick: number, playerId: 0 | 1): SimEvent => ({ type: 'turnStart', tick, playerId, readyInTicks: 0, sameAsBefore: false });
const levelCompleteAt = (tick: number): SimEvent => ({
  type: 'levelComplete',
  tick,
  result: { levelId: 'x', par: 3, strokes: [2, 2], medal: 'silver' },
  teamStrokes: 4,
  isLastLevel: false,
});

const types = (events: readonly SimEvent[]): SimEventType[] => events.map((e) => e.type);
const onlyTurnStarts = (events: readonly SimEvent[]): SimEvent[] => events.filter((e) => e.type === 'turnStart');

// ---- real-sim driver: World 1, two local players, as the shipped game runs it ----
const WORLD1: SimConfig = { playerCount: 2, levelIds: WORLD1_IDS, seed: 7, mode: 'local' };
const SHORT_HOP = { angle: -1.4, power: 20 } as const;

/** Steps with no commands until a tick emits `type`; returns that tick's whole event batch. */
function stepUntilEvent(state: SimState, type: SimEventType): { state: SimState; batch: SimEvent[] } {
  let s = state;
  for (let i = 0; i < 3000; i += 1) {
    const r = stepSim(s, []);
    s = r.state;
    if (r.events.some((e) => e.type === type)) return { state: s, batch: [...r.events] };
  }
  throw new Error(`no ${type} within 3000 ticks`);
}

/** Active player hops the ball once the hand-off delay has passed; returns the tick that hands the turn over. */
function shootToHandOff(state: SimState): { state: SimState; batch: SimEvent[] } {
  let s = state;
  for (let i = 0; i < 200 && !isShotReady(s); i += 1) s = stepSim(s, []).state;
  const p = s.activePlayer;
  s = stepSim(s, [{ type: 'setAim', playerId: p, ...SHORT_HOP }, { type: 'shoot', playerId: p }]).state;
  return stepUntilEvent(s, 'turnStart');
}

/** Fresh World 1 sim with its intro card dismissed; the dismiss tick's events are returned for the audio. */
function dismissedIntro(): { state: SimState; batch: SimEvent[] } {
  const r = stepSim(createSim(WORLD1).state, [{ type: 'continue', playerId: 0 }]);
  return { state: r.state, batch: [...r.events] };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  removeContext();
  vi.restoreAllMocks();
});

describe('audio without an AudioContext', () => {
  it('constructs and no-ops: ready === false, every method returns without throwing', () => {
    removeContext();
    const audio = createAudio();
    expect(audio.ready).toBe(false);
    audio.unlock();
    expect(audio.ready).toBe(false);
    for (const name of SFX_NAMES) audio.play(name, 0.7);
    audio.handleEvents([switchOnAt(1)], 0);
    audio.handleEvents([...DEVICE_VOICES.map(({ make }) => make(1)), skippedAt(2, 0), againAt(2, 1)], 0);
    audio.music.setTrack(2);
    expect(audio.music.track).toBe(2);
    audio.setFan(true, 1);
    audio.setMuted(true);
    audio.setMusic(true);
    audio.setVolume(0.5);
    audio.attachUnlock(window);
    const off = audio.onReady(() => undefined);
    off();
    audio.dispose();
    expect(audio.settings).toEqual({ muted: true, music: true, volume: 0.5 });
  });

  it('a throwing AudioContext constructor leaves unlock a no-op and is attempted once', () => {
    ThrowingAudioContext.attempts = 0;
    Object.defineProperty(window, 'AudioContext', { value: ThrowingAudioContext, configurable: true, writable: true });
    const audio = createAudio();
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.unlock()).not.toThrow();
    expect(audio.ready).toBe(false);
    expect(ThrowingAudioContext.attempts).toBe(1);
    expect(() => audio.play('hit')).not.toThrow();
    expect(() => audio.setMuted(true)).not.toThrow();
    audio.dispose();
  });

  it('settings survive a throwing localStorage', () => {
    removeContext();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const audio = createAudio();
    expect(audio.settings).toEqual({ muted: false, music: true, volume: 0.8 });
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
  });
});

describe('audio with a stubbed AudioContext', () => {
  beforeEach(installFakeContext);

  it('events before unlock are dropped, never queued', () => {
    const audio = createAudio({ seed: 1 });
    const n = oscillatorsDuring(() => audio.handleEvents([switchOnAt(1)], 0));
    expect(n).toBe(0);
    expect(audio.ready).toBe(false);
  });

  it('unlock makes it ready and every SfxName plays without throwing', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    expect(audio.ready).toBe(true);
    const n = oscillatorsDuring(() => {
      for (const name of SFX_NAMES) audio.play(name);
    });
    expect(n).toBeGreaterThan(SFX_NAMES.length);
    audio.setFan(true, 1);
    expect(audio.fan.running).toBe(true);
    audio.setFan(false, 0);
    expect(audio.fan.running).toBe(false);
  });

  // Played back to back, the names after the 24th are refused by GLOBAL_MAX_VOICES, so each name gets a fresh slate.
  it('every SfxName is admitted on its own and opens exactly one voice', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    for (const name of SFX_NAMES) {
      settleVoices();
      expect(voicesDuring(() => audio.play(name)), name).toBe(1);
    }
  });

  it.each(DEVICE_VOICES)('routes the $voice event to its own voice at the event time, keyed by the ball', ({ voice, make }) => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const spy = vi.spyOn(audio.sfx, voice);
    let oscs = 0;
    const voices = voicesDuring(() => {
      oscs = oscillatorsDuring(() => audio.handleEvents([make(1)], 0));
    });
    expect(voices).toBe(1);
    expect(oscs).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ at: context().currentTime, playerId: 1 }));
  });

  it.each(DEVICE_VOICES)('$voice for both balls on one tick sounds twice (keyed per ball)', ({ make }) => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    expect(voicesDuring(() => audio.handleEvents([make(0), make(1)], 0))).toBe(2);
  });

  it('a cannon shot is the thoom, never the spring boing (the sim emits cannonFire instead of spring)', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const spring = vi.spyOn(audio.sfx, 'spring');
    const fire = vi.spyOn(audio.sfx, 'cannonFire');
    audio.handleEvents([cannonFireAt(1, 0)], 0);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(spring).not.toHaveBeenCalled();
  });

  it('trapFreed rises E5-A5 after its latch, but leaves the chime to a sink or gimme on the same tick', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const spy = vi.spyOn(audio.sfx, 'trapFreed');
    const alone = createdDuring(() => audio.handleEvents([trapFreedAt(10, 0)], 0));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ chime: true }));
    expect(melody(alone)).toEqual([
      [659.25, 140],
      [880, 220],
    ]);
    settleVoices();
    const sink: SimEvent = { type: 'sink', tick: 20, playerId: 1, pos: P0, strokes: 4, speed: 0 };
    audio.handleEvents([sink, trapFreedAt(20, 0)], 0);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ chime: false }));
    settleVoices();
    const gimme: SimEvent = { type: 'gimme', tick: 30, playerId: 1, pos: P0, strokes: 4 };
    audio.handleEvents([gimme, trapFreedAt(30, 0)], 0);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ chime: false }));
    settleVoices();
    // the latch voice keeps its ring oscillator; the chime adds the two notes
    const latchOnly = oscillatorsDuring(() => audio.sfx.trapFreed({ playerId: 0, chime: false }));
    const withChime = oscillatorsDuring(() => audio.sfx.trapFreed({ playerId: 1 }));
    expect([latchOnly, withChime]).toEqual([1, 3]);
  });

  it("a skipped turn plays the waiting ball's muffled note, then the shooter's ding 0.12 s later, though the same shooter continues", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    // red waits in the trap; blue shot last and shoots again (sameAsBefore), as the WAITING rule emits it
    const made = createdDuring(() => audio.handleEvents([skippedAt(10, 0), againAt(10, 1)], 0));
    expect(melody(made)).toEqual([
      [RED_NOTE, 0],
      [BLUE_NOTE, 120],
    ]);
    settleVoices();
    // the partner-sank continuation keeps World 1's rule: whoosh only, no ding
    expect(oscillatorsDuring(() => audio.handleEvents([againAt(500, 1)], 0))).toBe(0);
  });

  it('after a BACK +1 the hand-off cues wait for the warble, also when the turnStart comes on a later tick and frame', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const made = createdDuring(() => audio.handleEvents([trapReturnAt(10, 1), skippedAt(10, 0), againAt(10, 1)], 0));
    // the rising warble starts at once (260 Hz); the skip note and the ding follow its pop
    expect(melody(made)).toEqual([
      [260, 0],
      [RED_NOTE, 350],
      [BLUE_NOTE, 470],
    ]);
    settleVoices();
    // a reset that moved a switch defers its turnStart to a later tick (ARCH R5), here the next frame's
    audio.handleEvents([trapReturnAt(100, 1)], 0);
    const returnedAt = context().currentTime;
    context().currentTime += 1 / 60;
    const ding = createdDuring(() => audio.handleEvents([{ type: 'turnStart', tick: 101, playerId: 0, readyInTicks: 27, sameAsBefore: false }], 0));
    expect(melody(ding)).toEqual([[RED_NOTE, Math.round((returnedAt + 0.35) * 1000)]]);
  });

  it('D11: a door slides only when its change lasts: never for a ball passing over its plate, once when a ball settles there, back when it leaves', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');
    const press = vi.spyOn(audio.sfx, 'switchOn');
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    const door = plateOf(twoDoors, 'door');
    const top = { x: door.x + door.w / 2, y: door.surfaceY };
    audio.handleEvents([levelStartOf(twoDoors.id, 0)], 0);
    // a ball rolls across the DOOR plate: a click down, a bare tick up, and the door's flick is silent
    audio.handleEvents([{ type: 'switchOn', tick: 10, switchId: 'door', byPlayer: 0, pos: top }, doorToggle(10, false)], 0);
    audio.handleEvents([{ type: 'switchOff', tick: 20, switchId: 'door', pos: top }, doorToggle(20, true)], 0);
    expect(slide).not.toHaveBeenCalled();
    expect(press.mock.calls.map(([o]) => o)).toEqual([expect.objectContaining({ chime: false })]);
    expect(lift.mock.calls.map(([o]) => o)).toEqual([expect.objectContaining({ chime: false })]);
    // a ball lands on it: the click as it touches, then the HELD confirm and the door's slide when it rests
    audio.handleEvents([{ type: 'switchOn', tick: 100, switchId: 'door', byPlayer: 0, pos: top }, doorToggle(100, false)], 0);
    expect(slide).not.toHaveBeenCalled();
    audio.handleEvents([{ type: 'ballRest', tick: 130, playerId: 0, pos: { x: top.x, y: top.y - BALL_RADIUS }, onPermanentGround: true }], 0);
    expect(slide.mock.calls).toEqual([[false, expect.objectContaining({ playerId: 'door-gate' })]]);
    expect(press).toHaveBeenLastCalledWith(expect.objectContaining({ click: false, playerId: 'door' }));
    // it leaves: the falling confirm and the door's slide shut
    audio.handleEvents([{ type: 'switchOff', tick: 300, switchId: 'door', pos: top }, doorToggle(300, true)], 0);
    expect(slide).toHaveBeenLastCalledWith(true, expect.objectContaining({ playerId: 'door-gate' }));
    expect(lift.mock.lastCall?.[0]?.chime).toBeUndefined();
  });

  it("D11: a trap's or a cannon's state never slides, and an unknown rect is ignored", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');
    audio.handleEvents([levelStartOf(grandMachine.id, 0)], 0);
    const devices = grandMachine.rects.filter((r) => r.kind === 'trap' || r.kind === 'cannon');
    expect(devices.length).toBeGreaterThanOrEqual(2);
    for (const r of devices) audio.handleEvents([{ type: 'bridgeToggle', tick: 5, rectId: r.id, kind: r.kind, active: true, switchId: 'top' }], 0);
    for (const kind of ['bridge', 'blocker', 'fan', 'sand', 'spring', 'bumper', 'colourGate'] as const) audio.handleEvents([bridgeToggleOf(kind, 6)], 0);
    expect(slide).not.toHaveBeenCalled();
  });

  it("L10's chain under D11: red's touch on A clicks and BOOMs at once; A's confirm and the bridge's slide wait for its rest", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const a = plateOf(skyBridge, 'a');
    const top = { x: a.x + a.w / 2, y: a.surfaceY };
    audio.handleEvents([levelStartOf(skyBridge.id, 0)], 0);
    settleVoices();
    const touch: SimEvent[] = [
      { type: 'switchOn', tick: 40, switchId: 'a', byPlayer: 0, pos: top },
      { type: 'bridgeToggle', tick: 40, rectId: 'bridge', kind: 'bridge', active: true, switchId: 'a' },
      cannonFireAt(41, 1),
    ];
    // the plate's click and the cannon's thoom
    expect(voicesDuring(() => audio.handleEvents(touch, 0))).toBe(2);
    settleVoices();
    // the roll-stop, A's confirm and the bridge's slide
    expect(voicesDuring(() => audio.handleEvents([{ type: 'ballRest', tick: 70, playerId: 0, pos: { x: top.x, y: top.y - BALL_RADIUS }, onPermanentGround: true }], 0))).toBe(3);
  });

  it('D11 on the real sim: a ball rolling across the DOOR plate and rocking back onto it slides the door once and confirms once, when it settles', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');
    const press = vi.spyOn(audio.sfx, 'switchOn');
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    const start = createSim({ playerCount: 2, levelIds: [twoDoors.id], seed: 7, mode: 'local' });
    const intro = stepSim(start.state, [{ type: 'continue', playerId: 0 }]);
    audio.handleEvents([...start.events, ...intro.events], 0);
    // red rolls flat out from its tee (the plates.test.ts line): across the plate, off the shut door, back, settles on it
    let r = stepSim(intro.state, [
      { type: 'setAim', playerId: 0, angle: AIM_ANGLE_MAX, power: 100 },
      { type: 'shoot', playerId: 0 },
    ]);
    const events: SimEvent[] = [...r.events];
    audio.handleEvents(r.events, 0);
    for (let i = 0; i < 1200 && r.state.phase === 'flying'; i += 1) {
      context().currentTime += DT;
      r = stepSim(r.state, []);
      events.push(...r.events);
      audio.handleEvents(r.events, 0);
    }
    const presses = events.filter((e) => e.type === 'switchOn' && e.switchId === 'door').length;
    expect(presses).toBeGreaterThanOrEqual(2);
    expect(r.state.switches.door).toBe(true);
    expect(slide.mock.calls).toEqual([[false, expect.objectContaining({ playerId: 'door-gate' })]]);
    expect(press.mock.calls.filter(([o]) => o?.chime === false)).toHaveLength(presses);
    expect(press.mock.calls.filter(([o]) => o?.click === false)).toHaveLength(1);
    expect(lift.mock.calls.every(([o]) => o?.chime === false)).toBe(true);
    expect(lift).toHaveBeenCalledTimes(presses - 1);
  });

  /** Red settled on Two Doors' DOOR plate, red to shoot; the audio heard the hole start and red come to rest there. */
  function redHoldingDoor(audio: AudioSystem): SimState {
    const s = onHole(twoDoors, audio);
    const door = plateOf(twoDoors, 'door');
    const spot = { x: door.x + door.w / 2, y: door.surfaceY - BALL_RADIUS };
    const red: BallState = { ...s.balls[0], pos: spot, vel: { x: 0, y: 0 }, asleep: true, grounded: true, restTicks: REST_TICKS, lastRest: spot };
    const balls: [BallState, BallState] = [red, s.balls[1]];
    const switches = evaluateSwitches(twoDoors, evaluateSwitches(twoDoors, s.switches, balls), balls);
    expect(switches.door).toBe(true);
    const arrival: SimEvent[] = [
      { type: 'switchOn', tick: s.tick, switchId: 'door', byPlayer: 0, pos: { x: spot.x, y: door.surfaceY } },
      doorToggle(s.tick, false),
      { type: 'ballRest', tick: s.tick, playerId: 0, pos: spot, onPermanentGround: true },
    ];
    audio.handleEvents(arrival, 0);
    return { ...s, balls, switches, activePlayer: 0, turnDelayTicks: 0, phase: 'aiming' };
  }

  /** The active ball's shot `deg` degrees up from flat right at `power`, heard tick by tick as GameCanvas plays it (1/60 s apart). */
  function heardShot(audio: AudioSystem, start: SimState, deg: number, power: number): SimEvent[] {
    const p = start.activePlayer;
    let r = stepSim(start, [
      { type: 'setAim', playerId: p, angle: quantize4((-deg * Math.PI) / 180), power },
      { type: 'shoot', playerId: p },
    ]);
    const events = [...r.events];
    audio.handleEvents(r.events, 0);
    for (let i = 0; i < 2000 && (r.state.phase === 'flying' || r.state.turnDelayTicks > 0); i += 1) {
      context().currentTime += DT;
      r = stepSim(r.state, []);
      events.push(...r.events);
      audio.handleEvents(r.events, 0);
    }
    return events;
  }

  /** Each door / bridge slide as it is voiced: shut (active) or open, its voice's output gain, the audio time. */
  function recordSlides(audio: AudioSystem): Array<{ active: boolean; out: FakeNode | undefined; at: number }> {
    const slides: Array<{ active: boolean; out: FakeNode | undefined; at: number }> = [];
    const voice = audio.sfx.bridgeToggle;
    vi.spyOn(audio.sfx, 'bridgeToggle').mockImplementation((active, o) => {
      const before = FakeAudioContext.gains.length;
      voice(active, o);
      // a voice's first node is its output gain (voiceOut), the one a cut fades
      slides.push({ active: active === true, out: FakeAudioContext.gains[before], at: context().currentTime });
    });
    return slides;
  }

  it("D11: a hold that ends as its holder hops off and lands back on the plate: the door's closing slide is faded out the tick the door opens again", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const start = redHoldingDoor(audio);
    settleVoices();
    const slides = recordSlides(audio);
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    // an off-vertical tap: red leaves the plate's dish for three ticks and lands back on DOOR
    const events = heardShot(audio, start, 107, 40);
    const off = events.find((e) => e.type === 'switchOff' && e.switchId === 'door');
    const on = events.find((e) => e.type === 'switchOn' && e.switchId === 'door');
    const lifted = (on?.tick ?? 0) - (off?.tick ?? 0);
    expect(lifted).toBeGreaterThan(0);
    expect(lifted).toBeLessThan(10);
    // the hold ended: the falling confirm and the shut slide; red then settles on DOOR again: the opening slide
    expect(lift.mock.calls[0]?.[0]?.chime).toBeUndefined();
    expect(slides.map((s) => s.active)).toEqual([true, false]);
    const [shut, open] = slides;
    // the door opened again before the shut slide was over: it fades out from that tick
    const reopenedAt = (shut?.at ?? 0) + lifted * DT;
    const fade = shut?.out?.gain.ramps.at(-1);
    expect(fade?.[0]).toBe(0);
    expect(fade?.[1]).toBeGreaterThan(reopenedAt);
    expect(fade?.[1]).toBeLessThan(reopenedAt + 0.05);
    expect(open?.out?.gain.ramps).toEqual([]);
  });

  it('D11: a holder that leaves its plate for good keeps the falling confirm and the whole closing slide', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const start = redHoldingDoor(audio);
    settleVoices();
    const slides = recordSlides(audio);
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    const events = heardShot(audio, start, 150, 60);
    expect(events.filter((e) => e.type === 'switchOn' && e.switchId === 'door')).toEqual([]);
    expect(lift.mock.calls.map(([o]) => o?.chime)).toEqual([undefined]);
    expect(slides.map((s) => s.active)).toEqual([true]);
    expect(slides[0]?.out?.gain.ramps).toEqual([]);
  });

  /** Red waits in Booby Trap's snare, freed by blue resting on FREE; blue to shoot; the audio stands on that state. */
  function redFreedByBlue(audio: AudioSystem): SimState {
    const s = onHole(boobyTrap, audio);
    const snare = boobyTrap.rects.find((r) => r.id === 'snare');
    if (snare === undefined) throw new Error('Booby Trap has a snare');
    const free = plateOf(boobyTrap, 'free');
    const resting = (pos: Vec): BallState => ({ pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos });
    const balls: [BallState, BallState] = [resting({ x: snare.x + snare.w / 2, y: snare.y + snare.h - BALL_RADIUS }), resting({ x: free.x + free.w / 2, y: free.surfaceY - BALL_RADIUS })];
    const switches = evaluateSwitches(boobyTrap, evaluateSwitches(boobyTrap, s.switches, balls), balls);
    expect(switches.free).toBe(true);
    expect(waitingOf(boobyTrap, switches, balls[0])).toBeNull();
    audio.syncPlates(boobyTrap, switches, balls);
    return { ...s, balls, switches, activePlayer: 1, turnDelayTicks: 0, phase: 'aiming' };
  }

  /** Each catch of red's jaws as it is voiced: whether it clinks (a lasting SNAP!), its voice's output gain, the audio time. */
  function recordCatches(audio: AudioSystem): Array<{ clink: boolean; out: FakeNode | undefined; at: number }> {
    const catches: Array<{ clink: boolean; out: FakeNode | undefined; at: number }> = [];
    const voice = audio.sfx.trapCaught;
    vi.spyOn(audio.sfx, 'trapCaught').mockImplementation((o) => {
      const before = FakeAudioContext.gains.length;
      voice(o);
      catches.push({ clink: o?.chime !== false, out: FakeAudioContext.gains[before], at: context().currentTime });
    });
    return catches;
  }

  it("D11: blue hops off FREE and lands back on it three ticks later: the snap and clink of red's re-armed snare fade out the tick the jaws open again", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const start = redFreedByBlue(audio);
    settleVoices();
    const catches = recordCatches(audio);
    const events = heardShot(audio, start, 80, 45);
    const off = events.find((e) => e.type === 'switchOff' && e.switchId === 'free');
    const on = events.find((e) => e.type === 'switchOn' && e.switchId === 'free');
    const lifted = (on?.tick ?? 0) - (off?.tick ?? 0);
    expect(lifted).toBeGreaterThan(0);
    expect(lifted).toBeLessThan(10);
    expect(events.filter((e) => e.type === 'trapCaught').map((e) => e.tick)).toEqual([off?.tick]);
    expect(events.filter((e) => e.type === 'trapFreed').map((e) => e.tick)).toEqual([on?.tick]);
    // the hold ended and the snare re-armed around red: a lasting SNAP! (snap and clink); then blue's landing opens it
    expect(catches.map((c) => c.clink)).toEqual([true]);
    const [snap] = catches;
    const reopenedAt = (snap?.at ?? 0) + lifted * DT;
    const fade = snap?.out?.gain.ramps.at(-1);
    expect(fade?.[0]).toBe(0);
    expect(fade?.[1]).toBeGreaterThan(reopenedAt);
    expect(fade?.[1]).toBeLessThan(reopenedAt + 0.05);
  });

  it('D11: a holder that leaves FREE for good keeps the whole SNAP! of the snare re-arming around red', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const start = redFreedByBlue(audio);
    settleVoices();
    const catches = recordCatches(audio);
    const events = heardShot(audio, start, 75, 50);
    expect(events.filter((e) => e.type === 'switchOn' && e.switchId === 'free')).toEqual([]);
    expect(catches.map((c) => c.clink)).toEqual([true]);
    expect(catches[0]?.out?.gain.ramps).toEqual([]);
  });

  it("D11: a hidden tab's dropped events start no sound (catchUpPlates), and a take-back among them still fades the closing slide it names while it sounds", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const start = redHoldingDoor(audio);
    settleVoices();
    const slides = recordSlides(audio);
    // red's off-vertical tap (107/40): it leaves the plate's dish for a few ticks and lands back on DOOR
    let r = stepSim(start, [
      { type: 'setAim', playerId: 0, angle: quantize4((-107 * Math.PI) / 180), power: 40 },
      { type: 'shoot', playerId: 0 },
    ]);
    const ticks = [r];
    for (let i = 0; i < 2000 && (r.state.phase === 'flying' || r.state.turnDelayTicks > 0); i += 1) {
      r = stepSim(r.state, []);
      ticks.push(r);
    }
    const offAt = ticks.findIndex((t) => t.events.some((e) => e.type === 'switchOff' && e.switchId === 'door'));
    const onAt = ticks.findIndex((t, i) => i > offAt && t.events.some((e) => e.type === 'switchOn' && e.switchId === 'door'));
    expect(onAt - offAt).toBeGreaterThan(0);
    expect(onAt - offAt).toBeLessThan(10);
    // heard in time up to the hold's end: its closing slide
    for (const t of ticks.slice(0, offAt + 1)) {
      context().currentTime += DT;
      audio.handleEvents(t.events, 0);
    }
    expect(slides.map((s) => s.active)).toEqual([true]);
    // the tab hides: the ticks up to the landing are dropped and taken in at once, the slide still sounding
    context().currentTime += (onAt - offAt) * DT;
    const at = context().currentTime;
    const dropped = ticks.slice(offAt + 1, onAt + 1).flatMap((t) => t.events);
    let oscillators = -1;
    const voices = voicesDuring(() => {
      oscillators = oscillatorsDuring(() => audio.catchUpPlates(dropped));
    });
    expect({ voices, oscillators }).toEqual({ voices: 0, oscillators: 0 });
    const fade = slides[0]?.out?.gain.ramps.at(-1);
    expect(fade?.[0]).toBe(0);
    expect(fade?.[1]).toBeGreaterThanOrEqual(at);
    expect(fade?.[1]).toBeLessThan(at + 0.05);
    // red then settles on DOOR, heard in time: the opening slide, as for a page that heard it all
    for (const t of ticks.slice(onAt + 1)) {
      context().currentTime += DT;
      audio.handleEvents(t.events, 0);
    }
    expect(slides.map((s) => s.active)).toEqual([true, false]);
  });

  it('D11: a hold taken in silently (catchUpPlates: the lob onto DOOR and its rest) plays nothing, and its holder leaving later is heard as a hold ending', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    const s = onHole(twoDoors, audio);
    settleVoices();
    // red lobs onto DOOR and settles there (the plates-sync line, 42/80), every tick of it dropped by a hidden tab
    let r = stepSim(s, [
      { type: 'setAim', playerId: 0, angle: quantize4((-42 * Math.PI) / 180), power: 80 },
      { type: 'shoot', playerId: 0 },
    ]);
    const dropped = [...r.events];
    for (let i = 0; i < 2000 && r.state.phase === 'flying'; i += 1) {
      r = stepSim(r.state, []);
      dropped.push(...r.events);
    }
    expect(r.state.switches.door).toBe(true);
    expect(dropped.some((e) => e.type === 'ballRest' && e.playerId === 0)).toBe(true);
    const door = plateOf(twoDoors, 'door');
    const top = { x: door.x + door.w / 2, y: door.surfaceY };
    expect(voicesDuring(() => audio.catchUpPlates(dropped))).toBe(0);
    // red leaves DOOR for good, heard in time: the falling confirm and the closing slide, nothing else
    audio.handleEvents([{ type: 'switchOff', tick: r.state.tick + 300, switchId: 'door', pos: top }, doorToggle(r.state.tick + 300, true)], 0);
    expect(lift.mock.calls.map(([o]) => o?.chime)).toEqual([undefined]);
    expect(slide.mock.calls).toEqual([[true, expect.objectContaining({ playerId: 'door-gate' })]]);
  });

  it('syncPlates: a state resumed with red holding DOOR (one synthetic levelStart), then red leaves: the falling confirm and the closing slide', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');
    const lift = vi.spyOn(audio.sfx, 'switchOff');
    const door = plateOf(twoDoors, 'door');
    const top = { x: door.x + door.w / 2, y: door.surfaceY };
    const onDoor = { x: top.x, y: top.y - BALL_RADIUS };
    const resting = (pos: Vec): BallState => ({ pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos });
    audio.handleEvents([levelStartOf(twoDoors.id, 400)], 0);
    audio.syncPlates(twoDoors, { door: true, window: false }, [resting(onDoor), resting(twoDoors.starts[1])]);
    audio.handleEvents([{ type: 'switchOff', tick: 500, switchId: 'door', pos: top }, doorToggle(500, true)], 0);
    expect(lift.mock.calls.map(([o]) => o?.chime)).toEqual([undefined]);
    expect(slide.mock.calls).toEqual([[true, expect.objectContaining({ playerId: 'door-gate' })]]);
  });

  it('setFan(false) stops the loop even while the context is suspended (leaving a game, NEXT_STEPS #6)', async () => {
    const audio = await runningAudio();
    const fanOscs = createdDuring(() => audio.setFan(true, 1));
    expect(audio.fan.running).toBe(true);
    context().state = 'suspended';
    expect(audio.ready).toBe(false);
    audio.setFan(false, 0);
    expect(audio.fan.running).toBe(false);
    expect(fanOscs.length).toBe(2);
    expect(fanOscs.every((o) => o.stopped)).toBe(true);
    // starting still waits for a running context
    audio.setFan(true, 1);
    expect(audio.fan.running).toBe(false);
    context().state = 'running';
    audio.setFan(true, 1);
    expect(audio.fan.running).toBe(true);
    audio.dispose();
  });

  it('fan.stop stops every oscillator the fan started, including its AM LFO', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const before = FakeAudioContext.created.length;
    audio.setFan(true, 1);
    const fanOscs = FakeAudioContext.created.slice(before);
    expect(fanOscs.length).toBe(2);
    audio.setFan(false, 0);
    expect(fanOscs.every((o) => o.stopped)).toBe(true);
  });

  it('debounce: three switchOn within 100 ms => one voice', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const single = oscillatorsDuring(() => audio.handleEvents([switchOnAt(0)], 0));
    const fresh = createAudio({ seed: 1 });
    fresh.unlock();
    const triple = oscillatorsDuring(() => fresh.handleEvents([switchOnAt(100), switchOnAt(101), switchOnAt(102)], 0));
    expect(single).toBeGreaterThan(0);
    expect(triple).toBe(single);
  });

  it('two fellOffWorld on one tick are both admitted (keyed per player)', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const single = oscillatorsDuring(() => audio.handleEvents([fellAt(0, 0)], 0));
    const fresh = createAudio({ seed: 1 });
    fresh.unlock();
    const both = oscillatorsDuring(() => fresh.handleEvents([fellAt(0, 0), fellAt(0, 1)], 0));
    expect(both).toBe(single * 2);
  });

  it('sink after gimme within 600 ms skips its chime', () => {
    const lone = createAudio({ seed: 1 });
    lone.unlock();
    const sinkAlone = oscillatorsDuring(() => lone.handleEvents([{ type: 'sink', tick: 50, playerId: 0, pos: { x: 0, y: 0 }, strokes: 3, speed: 0 }], 0));
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    audio.handleEvents([{ type: 'gimme', tick: 40, playerId: 0, pos: { x: 0, y: 0 }, strokes: 3 }], 0);
    const sinkAfterGimme = oscillatorsDuring(() => audio.handleEvents([{ type: 'sink', tick: 61, playerId: 0, pos: { x: 0, y: 0 }, strokes: 3, speed: 0 }], 0));
    expect(sinkAfterGimme).toBeGreaterThan(0);
    expect(sinkAfterGimme).toBeLessThan(sinkAlone);
  });

  it('createAudio({ seed }) gives deterministic jitter (identical noise buffers)', () => {
    createAudio({ seed: 42 }).unlock();
    createAudio({ seed: 42 }).unlock();
    const [a, b] = FakeAudioContext.noiseSamples;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Array.from(a?.slice(0, 16) ?? [])).toEqual(Array.from(b?.slice(0, 16) ?? []));
    expect(a?.[0]).not.toBe(0);
  });

  it('mute persists in flashgolf.audio.muted and seeds the next createAudio()', () => {
    const audio = createAudio({ seed: 1 });
    audio.setMuted(true);
    audio.setVolume(0.25);
    expect(localStorage.getItem('flashgolf.audio.muted')).toBe('1');
    expect(localStorage.getItem('flashgolf.audio.volume')).toBe('0.25');
    const again = createAudio({ seed: 1 });
    expect(again.settings.muted).toBe(true);
    expect(again.settings.volume).toBe(0.25);
    expect(again.isMuted()).toBe(true);
  });

  it('music records wantedMode before unlock, starts after, switches modes with playStart and halts on dispose', async () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    expect(audio.music.playing).toBe(false);
    expect(audio.music.wantedMode).toBe('title');
    audio.unlock();
    await Promise.resolve();
    expect(audio.music.playing).toBe(true);
    audio.handleEvents([{ type: 'playStart', tick: 3, levelId: 'x' }], 0);
    expect(audio.music.mode).toBe('play');
    audio.setMusic(false);
    expect(audio.music.playing).toBe(false);
    expect(audio.music.wantedMode).toBe('play');
    audio.setMusic(true);
    expect(audio.music.playing).toBe(true);
    audio.dispose();
    expect(audio.music.playing).toBe(false);
  });

  it('music off before a booked pad chord starts cancels the chord instead of holding its gain before the envelope', async () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.unlock();
    await Promise.resolve();
    const pad = FakeAudioContext.created.filter((o) => o.type === 'triangle');
    expect(pad).toHaveLength(8);
    expect(pad.every((o) => o.startAt > 0)).toBe(true);
    audio.setMusic(false);
    expect(FakeParam.holdsBeforeFirstEvent).toBe(0);
    expect(pad.every((o) => o.stopAt <= o.startAt)).toBe(true);
    audio.setMusic(true);
    audio.setMusic(false);
    expect(FakeParam.holdsBeforeFirstEvent).toBe(0);
    audio.dispose();
  });

  it('music off after the pad chord has started fades it out from where it is', async () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.unlock();
    await Promise.resolve();
    const pad = FakeAudioContext.created.filter((o) => o.type === 'triangle');
    const context = FakeAudioContext.last;
    if (context === null) throw new Error('no context');
    context.currentTime = 0.5;
    audio.setMusic(false);
    expect(FakeParam.holdsBeforeFirstEvent).toBe(0);
    expect(pad.every((o) => o.stopAt > context.currentTime)).toBe(true);
    audio.dispose();
  });

  it('onReady fires once the context runs and the unsubscribe works', async () => {
    const audio = createAudio({ seed: 1 });
    const seen: number[] = [];
    audio.onReady(() => seen.push(1));
    const off = audio.onReady(() => seen.push(2));
    off();
    audio.unlock();
    await Promise.resolve();
    expect(seen).toEqual([1]);
    audio.onReady(() => seen.push(3));
    expect(seen).toEqual([1, 3]);
  });
});

const WORLDS: readonly WorldId[] = [1, 2, 3];
const B5 = 987.77;
/** C D E F G A B. */
const WHITE_KEYS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);

/** Within 2 cents of a white key (12-TET, A4 = 440 Hz). */
function isWhiteKey(hz: number): boolean {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const key = Math.round(midi);
  return Math.abs(midi - key) < 0.02 && WHITE_KEYS.has(((key % 12) + 12) % 12);
}

function firstHoleOf(world: WorldId): string {
  const id = WORLD_IDS[world][0];
  if (id === undefined) throw new Error(`world ${world} has no holes`);
  return id;
}

/** A bed wanted in `mode` from the start, then unlocked and running on its first chord. */
async function playingBed(mode: 'title' | 'play' = 'title'): Promise<AudioSystem> {
  const audio = createAudio({ seed: 1 });
  audio.music.start(mode);
  audio.unlock();
  await Promise.resolve();
  return audio;
}

describe('music tracks: one bed per world (D10.11)', () => {
  it('every pad, shimmer and pluck pitch is a white key at or below B5, every bass a white key at or below 220 Hz', () => {
    for (const world of WORLDS) {
      MUSIC_TRACKS[world].chords.forEach((chord, i) => {
        const where = `world ${world}, chord ${i + 1}`;
        for (const hz of [...chord.pad, chord.shimmer, ...chord.pool]) {
          expect(isWhiteKey(hz), `${where}: ${hz} Hz`).toBe(true);
          expect(hz, where).toBeLessThanOrEqual(B5);
        }
        expect(isWhiteKey(chord.bass), `${where}: bass ${chord.bass} Hz`).toBe(true);
        expect(chord.bass, where).toBeLessThanOrEqual(220);
      });
    }
  });

  it("every track keeps World 1's budget: four 4-tone chords, timbres under 2.5 kHz, at most one pluck a second on average", () => {
    for (const world of WORLDS) {
      const t = MUSIC_TRACKS[world];
      expect(t.chords.map((c) => c.pad.length), `world ${world}`).toEqual([4, 4, 4, 4]);
      expect(t.padLpHz + 200, `world ${world} pad cutoff at the top of its drift`).toBeLessThan(2500);
      expect(t.pluck.lpHz, `world ${world} pluck`).toBeLessThan(2500);
      // two 8ths a beat: 6 bars at the bar odds, then the resting bars 7-8 of each 8-bar phrase
      const perPhrase = 6 * (t.odds.beat1[0] + t.odds.beat1[1] + 3 * (t.odds.other[0] + t.odds.other[1])) + 2 * 4 * 2 * t.odds.rest;
      expect(perPhrase / ((32 * 60) / t.bpm), `world ${world} plucks/s`).toBeLessThanOrEqual(1);
    }
  });

  it('World 1 is the shipped bed (AUDIO.md §7): C major at 84 BPM, Cmaj7 - Am7 - Fmaj7 - G6', () => {
    const w1 = MUSIC_TRACKS[1];
    expect([w1.bpm, w1.padLpHz]).toEqual([84, 900]);
    expect(w1.chords.map((c) => c.pad)).toEqual([
      [261.63, 329.63, 392, 493.88],
      [220, 261.63, 329.63, 392],
      [349.23, 440, 523.25, 659.25],
      [392, 493.88, 587.33, 659.25],
    ]);
    expect(w1.chords.map((c) => c.shimmer)).toEqual([783.99, 659.25, 523.25, 587.33]);
    expect(w1.chords.map((c) => c.bass)).toEqual([261.63 / 2, 110, 349.23 / 2, 196]);
    expect(w1.pluck).toEqual({ type: 'triangle', lpHz: 2400, decay: 0.32, gainDb: -22, octaveDecay: 0.12, octaveDb: -32 });
    expect(w1.odds).toEqual({ beat1: [0.5, 0.5], other: [0.3, 0.3], rest: 0.08 });
  });
});

describe("the bed follows the hole's world", () => {
  beforeEach(installFakeContext);

  it("the shipped campaigns open on their own world's bed (real sim), before any unlock", () => {
    for (const world of WORLDS) {
      const audio = createAudio({ seed: 1 });
      audio.music.setTrack(world === 1 ? 3 : 1);
      const config: SimConfig = { playerCount: 2, levelIds: campaignFrom(firstHoleOf(world)), seed: 7, mode: 'local' };
      audio.handleEvents(createSim(config).events, 0);
      expect(audio.music.track).toBe(world);
    }
  });

  it('a world chosen before unlock is the one that starts, on its first chord', async () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.handleEvents([levelStartOf(firstHoleOf(3), 0)], 0);
    expect([audio.music.track, audio.music.playing]).toEqual([3, false]);
    audio.unlock();
    await Promise.resolve();
    expect(audio.music.playing).toBe(true);
    expect(padPitches(FakeAudioContext.created)).toEqual(twice(MUSIC_TRACKS[3].chords[0].pad));
    audio.dispose();
  });

  it('a hole in another world crossfades: the old pad fades over 0.8 s, the new bed starts on its first chord, mode kept', async () => {
    const audio = await playingBed();
    const oldPad = triangles(FakeAudioContext.created);
    expect(padPitches(oldPad)).toEqual(twice(MUSIC_TRACKS[1].chords[0].pad));
    context().currentTime = 2;
    const made = createdDuring(() => audio.handleEvents([levelStartOf(firstHoleOf(2), 0)], 0));
    expect([audio.music.track, audio.music.mode, audio.music.playing]).toEqual([2, 'title', true]);
    expect(FakeParam.holdsBeforeFirstEvent).toBe(0);
    expect(new Set(oldPad.map((o) => Math.round(o.stopAt * 1000)))).toEqual(new Set([2900]));
    expect(padPitches(made)).toEqual(twice(MUSIC_TRACKS[2].chords[0].pad));
    expect(new Set(triangles(made).map((o) => Math.round(o.startAt * 1000)))).toEqual(new Set([2050]));
    audio.dispose();
  });

  it('a switch before the booked first chord sounds cancels that chord outright (no full-level stab)', async () => {
    const audio = await playingBed();
    const booked = triangles(FakeAudioContext.created);
    audio.handleEvents([levelStartOf(firstHoleOf(2), 0)], 0);
    expect(FakeParam.holdsBeforeFirstEvent).toBe(0);
    expect(booked.every((o) => o.stopAt <= o.startAt)).toBe(true);
    audio.dispose();
  });

  it('every hole of one world (the next hole, a restart) and an unknown id leave the bed alone', async () => {
    const audio = await playingBed();
    audio.handleEvents([levelStartOf(firstHoleOf(2), 0)], 0);
    const again = WORLD_IDS[2].map((id, i) => levelStartOf(id, 100 + i));
    expect(oscillatorsDuring(() => audio.handleEvents([...again, levelStartOf('x', 200)], 0))).toBe(0);
    expect(audio.music.track).toBe(2);
    audio.dispose();
  });

  it("in-game title mode (a results card) keeps the world's bed; the shell's setMode('title') goes back to World 1", async () => {
    const audio = await playingBed();
    expect(oscillatorsDuring(() => audio.music.setMode('title'))).toBe(0);
    audio.handleEvents([levelStartOf(firstHoleOf(3), 0), { type: 'playStart', tick: 1, levelId: firstHoleOf(3) }], 0);
    expect([audio.music.track, audio.music.mode]).toEqual([3, 'play']);
    audio.handleEvents([levelCompleteAt(900)], 0);
    expect([audio.music.track, audio.music.mode]).toEqual([3, 'title']);
    const made = createdDuring(() => audio.music.setMode('title'));
    expect([audio.music.track, audio.music.mode, audio.music.playing]).toEqual([1, 'title', true]);
    expect(padPitches(made)).toEqual(twice(MUSIC_TRACKS[1].chords[0].pad));
    audio.dispose();
  });

  it('with music off a world change is only recorded; music on starts that world', async () => {
    const audio = await playingBed();
    audio.setMusic(false);
    expect(oscillatorsDuring(() => audio.handleEvents([levelStartOf(firstHoleOf(2), 0)], 0))).toBe(0);
    expect([audio.music.track, audio.music.playing]).toEqual([2, false]);
    const made = createdDuring(() => audio.setMusic(true));
    expect(padPitches(made)).toEqual(twice(MUSIC_TRACKS[2].chords[0].pad));
    audio.dispose();
  });

  it.each(WORLDS)("world %i's bed walks at its own tempo; play mode plucks its timbre from the sounding chord's pool", async (world) => {
    const audio = await playingBed('play');
    audio.handleEvents([levelStartOf(firstHoleOf(world), 0)], 0);
    const { bpm, pluck, chords } = MUSIC_TRACKS[world];
    const beat = 60 / bpm;
    // every bed here (re)started at currentTime 0, so beat 1 of its cycle is at 0.05 s; two bars per chord, 16 bars
    const chordAt = (t: number): (typeof chords)[number] => {
      const b = Math.floor((t - 0.05) / beat + 1e-6);
      return chords[Math.floor((Math.floor(b / 4) % 16) / 2) % 4] ?? chords[0];
    };
    const made: FakeNode[] = [];
    // a hidden tab books 2.5 s ahead per tick: 20 s of the bed, scheduled now
    for (let t = 0; t < 20; t += 2) {
      context().currentTime = t;
      made.push(...createdDuring(() => audio.music.setBackground(true)));
    }
    // the bed's own voices set a plain value; bass and plucks are SFX-style oscillators (pitch by automation)
    const voiced = made.filter((o) => o.frequency.set.length > 0);
    const basses = voiced.filter((o) => o.type === 'sine' && pitchOf(o) <= 220);
    expect(basses.length).toBeGreaterThan(5);
    for (const o of basses) {
      const beats = (o.startAt - 0.05) / beat;
      expect(Math.abs(beats / 2 - Math.round(beats / 2)), `bass at ${o.startAt} s`).toBeLessThan(1e-6);
      expect(pitchOf(o), `bass at ${o.startAt} s`).toBe(chordAt(o.startAt).bass);
    }
    const plucks = voiced.filter((o) => o.type === pluck.type);
    expect(plucks.length).toBeGreaterThan(0);
    for (const o of plucks) {
      const eighths = ((o.startAt - 0.05) / beat) * 2;
      expect(Math.abs(eighths - Math.round(eighths)), `pluck at ${o.startAt} s: on a beat or its "and"`).toBeLessThan(1e-6);
      expect(chordAt(o.startAt).pool, `pluck at ${o.startAt} s`).toContain(pitchOf(o));
    }
    audio.dispose();
  });
});

// The sim emits `playStart` only when the intro card is dismissed. A hole restart (results-card Retry, pause-menu
// Restart), a `?state=` resume and an online join mid-hole all begin with a `levelStart` that is never followed by
// `playStart`, so the audio must take `turnStart` / `ballHit` as proof that play is on (AUDIO.md §2 turnStart, §7).
describe('audio follows the real sim through a hole restart', () => {
  beforeEach(installFakeContext);

  it('turn dings keep playing after restartLevel, which emits no playStart', () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.unlock();
    const intro = dismissedIntro();
    expect(types(intro.batch)).toEqual(['playStart', 'turnStart']);
    expect(oscillatorsDuring(() => audio.handleEvents(intro.batch, 0))).toBeGreaterThan(0);

    settleVoices();
    const first = shootToHandOff(intro.state);
    const dingBefore = oscillatorsDuring(() => audio.handleEvents(onlyTurnStarts(first.batch), 0));
    expect(dingBefore).toBeGreaterThan(0);

    settleVoices();
    const restart = stepSim(first.state, [{ type: 'restartLevel', playerId: 0 }]);
    expect(types(restart.events)).toEqual(['levelRestart', 'levelStart', 'turnStart']);
    expect(restart.state.phase).toBe('aiming');
    audio.handleEvents(restart.events, 0);

    settleVoices();
    const after = shootToHandOff(restart.state);
    const handOff = onlyTurnStarts(after.batch);
    expect(handOff).toHaveLength(1);
    expect(handOff[0]).toMatchObject({ type: 'turnStart', sameAsBefore: false });
    expect(oscillatorsDuring(() => audio.handleEvents(handOff, 0))).toBe(dingBefore);
    expect(audio.music.mode).toBe('play');
  });

  it("results-card Retry: the bed returns to 'play' on the restart's turnStart after levelComplete set 'title'", () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.unlock();
    const intro = dismissedIntro();
    audio.handleEvents(intro.batch, 0);
    expect(audio.music.mode).toBe('play');
    audio.handleEvents([levelCompleteAt(intro.state.tick + 500)], 0);
    expect(audio.music.mode).toBe('title');
    const restart = stepSim(intro.state, [{ type: 'restartLevel', playerId: 0 }]);
    audio.handleEvents(restart.events, 0);
    expect(audio.music.mode).toBe('play');
  });

  it('a synthetic levelStart for a ?state= resume does not silence the turnStart that follows it', () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    audio.unlock();
    audio.handleEvents([{ type: 'levelStart', tick: 400, levelId: 'x', levelIndex: 0, firstPlayer: 0, restarted: false }], 0);
    expect(oscillatorsDuring(() => audio.handleEvents([turnStartAt(700, 1)], 0))).toBeGreaterThan(0);
    expect(audio.music.mode).toBe('play');
  });

  it('bed tracking runs before unlock: a turnStart heard while locked is wanted as play, with no sound', () => {
    const audio = createAudio({ seed: 1 });
    audio.music.start('title');
    expect(oscillatorsDuring(() => audio.handleEvents([turnStartAt(10, 0)], 0))).toBe(0);
    expect(audio.music.playing).toBe(false);
    expect(audio.music.wantedMode).toBe('play');
    expect(audio.music.mode).toBe('play');
  });
});

// ---- the shipped World 2 devices through the real sim: crafted drops onto the devices, no scripted shots ----

function introducing(mechanic: 'trap' | 'cannon'): Level {
  const level = levelsOfWorld(2).find((l) => l.mechanicsIntroduced[0] === mechanic);
  if (level === undefined) throw new Error(`no World 2 hole introduces the ${mechanic}`);
  return level;
}

/** The hole on its own, intro dismissed: red (slot 0) to play. Like GameCanvas, the audio hears the start (its levelStart included). */
function onHole(level: Level, audio?: AudioSystem): SimState {
  const config: SimConfig = { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' };
  const start = createSim(config);
  const intro = stepSim(start.state, [{ type: 'continue', playerId: 0 }]);
  audio?.handleEvents([...start.events, ...intro.events], 0);
  return intro.state;
}

/** A crafted flight: the shooter `slot` drops from `pos` at rest speed; the other ball stays where it is. */
function dropping(state: SimState, slot: PlayerId, pos: Vec): SimState {
  const drop: BallState = { ...state.balls[slot], pos, vel: { x: 0, y: 0 }, asleep: false, grounded: false, restTicks: 0 };
  const balls: [BallState, BallState] = slot === 0 ? [drop, { ...state.balls[1] }] : [{ ...state.balls[0] }, drop];
  return { ...state, phase: 'flying', activePlayer: slot, turnDelayTicks: 0, balls };
}

/** Plays the flight out tick by tick as GameCanvas does (one handleEvents per step, 1/60 s apart) until the hand-off;
 *  returns the state, every event, and the oscillators made by the hand-off tick's batch. */
function flyInto(audio: AudioSystem, state: SimState): { state: SimState; events: SimEvent[]; handOff: FakeNode[] } {
  let s = state;
  const events: SimEvent[] = [];
  let handOff: FakeNode[] = [];
  for (let i = 0; i < 2000 && s.phase === 'flying'; i += 1) {
    const r = stepSim(s, []);
    s = r.state;
    events.push(...r.events);
    context().currentTime += DT;
    handOff = createdDuring(() => audio.handleEvents(r.events, 0));
  }
  if (s.phase === 'flying') throw new Error('the flight never handed over');
  return { state: s, events, handOff };
}

const ofType = (events: readonly SimEvent[], type: SimEventType): SimEvent[] => events.filter((e) => e.type === type);

describe('the shipped World 2 devices reach their voices through the real sim', () => {
  beforeEach(installFakeContext);

  it("Booby Trap: SNAP!, then a skipped turn (red's muffled note, blue's ding), then FREE! with its chime once blue settles on FREE", () => {
    const level = introducing('trap');
    const trap = level.rects.find((r) => r.kind === 'trap');
    const release = level.switches.find((sw) => sw.id === trap?.switchIds?.[0]);
    if (trap === undefined || release === undefined) throw new Error('the trap hole has a trap and a release plate');
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const caught = vi.spyOn(audio.sfx, 'trapCaught');
    const freed = vi.spyOn(audio.sfx, 'trapFreed');

    // red drops into the armed jaws: caught (the whole snap and clink), so blue shoots next
    const snap = flyInto(audio, dropping(onHole(level, audio), 0, { x: trap.x + trap.w / 2, y: trap.y + BALL_RADIUS }));
    expect(ofType(snap.events, 'trapCaught')).toMatchObject([{ playerId: 0, rectId: trap.id }]);
    expect(caught.mock.calls).toEqual([[expect.objectContaining({ playerId: 0 })]]);
    expect(caught.mock.calls[0]?.[0]?.chime).toBeUndefined();
    expect(snap.state.activePlayer).toBe(1);

    // blue's flight ends anywhere free: red is passed over, blue shoots again, and still hears its ding
    // (a real turn takes the hand-off delay plus aim and flight, so the clock moves on between crafted drops)
    settleVoices();
    const tee = level.starts[1];
    const skip = flyInto(audio, dropping(snap.state, 1, { x: tee.x, y: tee.y - 4 }));
    expect(ofType(skip.events, 'turnSkipped')).toMatchObject([{ playerId: 0, nextPlayer: 1 }]);
    expect(ofType(skip.events, 'turnStart')).toMatchObject([{ playerId: 1, sameAsBefore: true }]);
    const at = Math.round(context().currentTime * 1000);
    expect(melody(skip.handOff)).toEqual([
      [RED_NOTE, at],
      [BLUE_NOTE, at + 120],
    ]);

    // blue lands on the release plate (D11): red's jaws spring open as blue touches it, a quiet latch, and the FREE
    // chime waits until blue settles there and holds it (the turn passes on the next tick, ARCH R5)
    settleVoices();
    const freeing = flyInto(audio, dropping(skip.state, 1, { x: release.x + release.w / 2, y: release.surfaceY - BALL_RADIUS - 4 }));
    const [touch] = ofType(freeing.events, 'trapFreed');
    const blueRest = freeing.events.find((e) => e.type === 'ballRest' && e.playerId === 1);
    expect(touch).toMatchObject({ playerId: 0, rectId: trap.id });
    expect((blueRest?.tick ?? 0) - (touch?.tick ?? 0)).toBeGreaterThan(0);
    expect(freed.mock.calls.map(([o]) => o)).toEqual([
      expect.objectContaining({ playerId: 0, chime: false }),
      expect.objectContaining({ playerId: 0, click: false }),
    ]);
    // the late chime really sounds: E5 then A5, 80 ms apart, with no latch under it
    const chime = FakeAudioContext.created.filter((o) => o.type === 'triangle' && (pitchOf(o) === 659.25 || pitchOf(o) === 880));
    expect(chime.map(pitchOf).slice(-2)).toEqual([659.25, 880]);
    expect(Math.round(((chime.at(-1)?.startAt ?? 0) - (chime.at(-2)?.startAt ?? 0)) * 1000)).toBe(80);
  });

  it('Load & Fire: LOADED! on the cold breech, then BOOM! the tick after the partner lands on FIRE, never the boing', () => {
    const level = introducing('cannon');
    const cannon = level.rects.find((r) => r.kind === 'cannon');
    const fire = level.switches.find((sw) => sw.id === cannon?.switchIds?.[0]);
    if (cannon === undefined || fire === undefined) throw new Error('the cannon hole has a cannon and a FIRE plate');
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const load = vi.spyOn(audio.sfx, 'cannonLoad');
    const boom = vi.spyOn(audio.sfx, 'cannonFire');
    const spring = vi.spyOn(audio.sfx, 'spring');
    const slide = vi.spyOn(audio.sfx, 'bridgeToggle');

    const loaded = flyInto(audio, dropping(onHole(level, audio), 0, { x: cannon.x + cannon.w / 2, y: cannon.y - BALL_RADIUS - 4 }));
    expect(ofType(loaded.events, 'cannonLoad')).toMatchObject([{ playerId: 0, rectId: cannon.id }]);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ playerId: 0 }));

    settleVoices();
    const fired = flyInto(audio, dropping(loaded.state, 1, { x: fire.x + fire.w / 2, y: fire.surfaceY - BALL_RADIUS - 4 }));
    const [on] = ofType(fired.events, 'switchOn');
    const [shot] = ofType(fired.events, 'cannonFire');
    expect(shot).toMatchObject({ playerId: 0, rectId: cannon.id });
    expect((shot?.tick ?? 0) - (on?.tick ?? 0)).toBe(1);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(boom).toHaveBeenCalledWith(expect.objectContaining({ playerId: 0 }));
    expect(ofType(fired.events, 'spring')).toEqual([]);
    expect(spring).not.toHaveBeenCalled();
    expect(slide).not.toHaveBeenCalled();
  });
});
