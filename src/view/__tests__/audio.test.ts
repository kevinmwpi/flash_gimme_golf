// @vitest-environment jsdom
// OWNER: view
// ARCH.md §4 view row (audio debounce) + AUDIO.md §8 item 8, under a stubbed AudioContext.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD1_IDS } from '../../sim/levels';
import { createSim, isShotReady, stepSim } from '../../sim/sim';
import type { SimConfig, SimEvent, SimEventType, SimState } from '../../sim/types';
import { createAudio, type SfxName } from '../audio';

const SFX_NAMES: readonly SfxName[] = [
  'hit', 'bounceSoft', 'bounceHard', 'sand', 'spring', 'bumper', 'fan', 'gateBlock', 'gatePass', 'switchOn', 'switchOff',
  'bridge', 'fall', 'rest', 'nearCup', 'lipOut', 'gimme', 'sink', 'levelWin', 'campaignWin', 'turn', 'uiClick', 'uiBack',
  'uiHover', 'uiInvalid', 'uiPause', 'uiResume', 'partnerJoined', 'partnerLeft', 'aimTick',
];

/** Tracks only event times: enough to catch a cancelAndHoldAtTime that lands before the param's first event. */
class FakeParam {
  /** Holds at a time earlier than every scheduled event: the real param would fall back to its default value. */
  static holdsBeforeFirstEvent = 0;
  value = 0;
  private times: number[] = [];
  setValueAtTime(_v: number, t: number): void {
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

const switchOnAt = (tick: number): SimEvent => ({ type: 'switchOn', tick, switchId: 'a', byPlayer: 0, pos: { x: 0, y: 0 } });
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
