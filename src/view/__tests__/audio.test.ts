// @vitest-environment jsdom
// OWNER: view
// ARCH.md §4 view row (audio debounce) + AUDIO.md §8 item 8 and §11 (Worlds 2-3), under a stubbed AudioContext.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { campaignFrom, levelsOfWorld, WORLD1_IDS, WORLD_IDS } from '../../sim/levels';
import { createSim, isShotReady, stepSim } from '../../sim/sim';
import { BALL_RADIUS, DT } from '../../sim/types';
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
  private times: number[] = [];
  setValueAtTime(v: number, t: number): void {
    this.set.push(v);
    this.times.push(t);
  }
  linearRampToValueAtTime(_v: number, t: number): void {
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
    return new FakeNode();
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

  it('bridgeToggle slides only for rects that appear or vanish (bridge, door, fan), never for a trap or a cannon', () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    for (const kind of ['bridge', 'blocker', 'fan'] as const) {
      settleVoices();
      expect(voicesDuring(() => audio.handleEvents([bridgeToggleOf(kind)], 0)), kind).toBe(1);
    }
    for (const kind of ['trap', 'cannon', 'sand', 'spring', 'bumper', 'colourGate'] as const) {
      settleVoices();
      expect(voicesDuring(() => audio.handleEvents([bridgeToggleOf(kind)], 0)), kind).toBe(0);
    }
  });

  it("L10's chain reaction keeps every cue: plate, bridge and the cannon fired one tick later", () => {
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const chain: SimEvent[] = [
      { type: 'ballRest', tick: 40, playerId: 0, pos: P0, onPermanentGround: true },
      { type: 'switchOn', tick: 40, switchId: 'a', byPlayer: 0, pos: P0 },
      bridgeToggleOf('bridge', 40),
      cannonFireAt(41, 1),
    ];
    expect(voicesDuring(() => audio.handleEvents(chain, 0))).toBe(4);
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

/** The hole on its own, intro dismissed: red (slot 0) to play. */
function onHole(level: Level): SimState {
  const config: SimConfig = { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' };
  return stepSim(createSim(config).state, [{ type: 'continue', playerId: 0 }]).state;
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

  it("Booby Trap: SNAP!, then a skipped turn (red's muffled note, blue's ding), then FREE! with its chime", () => {
    const level = introducing('trap');
    const trap = level.rects.find((r) => r.kind === 'trap');
    const release = level.switches.find((sw) => sw.id === trap?.switchIds?.[0]);
    if (trap === undefined || release === undefined) throw new Error('the trap hole has a trap and a release plate');
    const audio = createAudio({ seed: 1 });
    audio.unlock();
    const caught = vi.spyOn(audio.sfx, 'trapCaught');
    const freed = vi.spyOn(audio.sfx, 'trapFreed');

    // red drops into the armed jaws: caught, so blue shoots next
    const snap = flyInto(audio, dropping(onHole(level), 0, { x: trap.x + trap.w / 2, y: trap.y + BALL_RADIUS }));
    expect(ofType(snap.events, 'trapCaught')).toMatchObject([{ playerId: 0, rectId: trap.id }]);
    expect(caught).toHaveBeenCalledWith(expect.objectContaining({ playerId: 0 }));
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

    // blue lands on the release plate: red is freed where it sits (the turn passes on the next tick, ARCH R5)
    settleVoices();
    flyInto(audio, dropping(skip.state, 1, { x: release.x + release.w / 2, y: release.surfaceY - BALL_RADIUS - 4 }));
    expect(freed).toHaveBeenCalledTimes(1);
    expect(freed).toHaveBeenCalledWith(expect.objectContaining({ playerId: 0, chime: true }));
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

    const loaded = flyInto(audio, dropping(onHole(level), 0, { x: cannon.x + cannon.w / 2, y: cannon.y - BALL_RADIUS - 4 }));
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
