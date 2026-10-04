// OWNER: view
/**
 * Web Audio SFX + generative music bed (ARCH.md §1.10 + BUILD_DECISIONS D3 additions; AUDIO.md is the
 * recipe book and design/FINAL/audio/audio-demo.html the reference implementation this ports). Every
 * sound is synthesized (oscillators, one shared noise buffer, ADSR envelopes); no asset files.
 * audio.ts owns the persistence of `flashgolf.audio.*` (D4) and is a safe no-op without AudioContext.
 */
import type { BounceSurface, Medal, PlayerId, SimEvent } from '../sim/types';
import { DT, MAX_POWER } from '../sim/types';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export type SfxName =
  | 'hit'
  | 'bounceSoft'
  | 'bounceHard'
  | 'sand'
  | 'spring'
  | 'bumper'
  | 'fan'
  | 'gateBlock'
  | 'gatePass'
  | 'switchOn'
  | 'switchOff'
  | 'bridge'
  | 'fall'
  | 'rest'
  | 'nearCup'
  | 'lipOut'
  | 'gimme'
  | 'sink'
  | 'levelWin'
  | 'campaignWin'
  | 'turn'
  | 'uiClick'
  | 'uiBack'
  | 'uiHover'
  | 'uiInvalid'
  | 'uiPause'
  | 'uiResume'
  | 'partnerJoined'
  | 'partnerLeft'
  | 'aimTick';

export type MusicMode = 'title' | 'play';
export type AudioSettings = { readonly muted: boolean; readonly music: boolean; readonly volume: number };

/** Trailing option bag every sfx.* function accepts. */
export interface SfxOpts {
  at?: number;
  playerId?: PlayerId | string;
  volume?: number;
  chime?: boolean;
  sameAsBefore?: boolean;
}
export interface FilterOpts {
  type?: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  sweep?: number;
  q?: number;
}
export interface LfoOpts {
  rate: number;
  depth: number;
  target: 'freq' | 'gain';
}
export interface OscOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  glide?: number;
  detune?: number;
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  dur?: number;
  gain?: number;
  filter?: FilterOpts;
  lfo?: LfoOpts;
  at?: number;
}
export interface NoiseOpts {
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  dur?: number;
  gain?: number;
  rate?: number;
  filter?: FilterOpts;
  at?: number;
}
export interface NoteOpts {
  type?: OscillatorType;
  vib?: boolean;
  r?: number;
  lp?: number;
  sub?: boolean;
}

export interface Sfx {
  ballHit(power01?: number, o?: SfxOpts): void;
  bounce(strength01?: number, surface?: BounceSurface, o?: SfxOpts): void;
  enterSand(o?: SfxOpts): void;
  rollStop(o?: SfxOpts): void;
  spring(o?: SfxOpts): void;
  bumper(o?: SfxOpts): void;
  hazardBlock(o?: SfxOpts): void;
  gatePass(o?: SfxOpts): void;
  switchOn(o?: SfxOpts): void;
  switchOff(o?: SfxOpts): void;
  bridgeToggle(active?: boolean, o?: SfxOpts): void;
  fanEnter(o?: SfxOpts): void;
  fellOffWorld(o?: SfxOpts): void;
  nearCup(o?: SfxOpts): void;
  lipOut(o?: SfxOpts): void;
  gimme(o?: SfxOpts): void;
  sink(o?: SfxOpts): void;
  turnStart(playerId?: PlayerId, o?: SfxOpts): void;
  levelComplete(medal?: Medal, o?: SfxOpts): void;
  campaignComplete(o?: SfxOpts): void;
  uiClick(o?: SfxOpts): void;
  uiBack(o?: SfxOpts): void;
  uiHover(o?: SfxOpts): void;
  uiInvalid(o?: SfxOpts): void;
  uiPause(o?: SfxOpts): void;
  uiResume(o?: SfxOpts): void;
  partnerJoined(o?: SfxOpts): void;
  partnerLeft(o?: SfxOpts): void;
  aimTick(power01?: number, o?: SfxOpts): void;
}
export interface FanLoop {
  start(): void;
  stop(): void;
  setIntensity(k: number): void;
  readonly running: boolean;
}
export interface MusicBed {
  /** ALWAYS records wantedMode; starts when running + enabled; unlock() retries it. */
  start(mode?: MusicMode): void;
  /** Clears wantedMode (explicit "no music now"). */
  stop(): void;
  /** Stops the scheduler, keeps wantedMode (setMusic(false) / dispose). */
  halt(fadeSec: number): void;
  /** No restart: the bed is continuous from Title into the first hole. */
  setMode(mode: MusicMode): void;
  /** Hidden tab: 2.5 s lookahead on a 1 s interval. */
  setBackground(hidden: boolean): void;
  readonly playing: boolean;
  readonly mode: MusicMode;
  readonly wantedMode: MusicMode | null;
  readonly hidden: boolean;
}

export type AudioSystem = {
  /** Call synchronously inside the first user gesture (title button). Idempotent. */
  unlock(): void;
  /** Maps SimEvent -> sfx (+ volume from strength); switch/bridge SFX debounced per key (>= 100-150 ms),
   *  bounces 45 ms per ball. `delaySec` defers scheduling (0 in both modes, D3). */
  handleEvents(events: readonly SimEvent[], nowMs: number, delaySec?: number): void;
  /** volume = power01 for 'hit', strength01 for bounce*, else a 0..1 multiplier. */
  play(name: SfxName, volume?: number): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setMusic(on: boolean): void;
  /** Clears the music interval, stops the fan, removes listeners, disconnects master; never close()s the context. */
  dispose(): void;
  /** Once, in main.tsx: capture-phase pointerdown/keydown/touchend unlock + visibility/focus resume. */
  attachUnlock(target?: EventTarget): void;
  /** Fires once when the context is running (immediately if it already is); returns an unsubscribe. */
  onReady(cb: () => void): () => void;
  setVolume(v: number): void;
  /** Once per frame from GameCanvas: any non-sunk ball inside an active fan AABB. */
  setFan(active: boolean, intensity01: number): void;
  readonly settings: AudioSettings;
  readonly ready: boolean;
  readonly sfx: Sfx;
  readonly fan: FanLoop;
  readonly music: MusicBed;
  /** Debug / mixing sessions only, not in Settings. */
  setBusDb(sfxDb?: number, musicDb?: number): void;
};

export type CreateAudioOptions = { seed?: number; compressor?: boolean };

// ---- constants ----------------------------------------------------------------------------------

const STORAGE = Object.freeze({ muted: 'flashgolf.audio.muted', music: 'flashgolf.audio.music', volume: 'flashgolf.audio.volume' });
const DEFAULT_SETTINGS: AudioSettings = Object.freeze({ muted: false, music: true, volume: 0.8 });
/** Bus defaults (dB). Settings never exposes these; setBusDb() is for mixing sessions. */
const SFX_BUS_DB = -6;
const MUSIC_BUS_DB = -15;
/** Fatigue watch-list: one literal each (dB) so any of them can be pulled 6 dB in one edit. */
const TUNE = Object.freeze({ turnDing: -6, nearCup: -7, aimTick: -22, uiHover: -24, rollStop: -20 });
const GLOBAL_MAX_VOICES = 24;
const UNLOCK_PENDING_MS = 1000;
const MULTI_TICK_CAP_SEC = 0.25;
const JINGLE_DELAY_SEC = 0.35;
const GIMME_SINK_WINDOW_SEC = 0.6;
const DUCK_DB = 4;

type Poly = { max: number; minMs: number };
type PolyName =
  | 'ballHit'
  | 'bounce'
  | 'enterSand'
  | 'rollStop'
  | 'spring'
  | 'bumper'
  | 'hazardBlock'
  | 'gatePass'
  | 'switchOn'
  | 'switchOff'
  | 'bridgeToggle'
  | 'fellOffWorld'
  | 'fanEnter'
  | 'nearCup'
  | 'lipOut'
  | 'gimme'
  | 'sink'
  | 'turnStart'
  | 'levelComplete'
  | 'campaignComplete'
  | 'uiClick'
  | 'uiBack'
  | 'uiHover'
  | 'uiInvalid'
  | 'uiPause'
  | 'uiResume'
  | 'partnerJoined'
  | 'partnerLeft'
  | 'aimTick';

/** Per-SFX polyphony: max simultaneous voices (per name) and minimum retrigger interval (ms, per key). */
const POLY: Readonly<Record<PolyName, Poly>> = Object.freeze({
  ballHit: { max: 1, minMs: 60 },
  bounce: { max: 4, minMs: 45 },
  enterSand: { max: 2, minMs: 250 },
  rollStop: { max: 2, minMs: 200 },
  spring: { max: 2, minMs: 80 },
  bumper: { max: 3, minMs: 40 },
  hazardBlock: { max: 2, minMs: 120 },
  gatePass: { max: 2, minMs: 100 },
  switchOn: { max: 2, minMs: 100 },
  switchOff: { max: 2, minMs: 100 },
  bridgeToggle: { max: 2, minMs: 150 },
  fellOffWorld: { max: 2, minMs: 400 },
  fanEnter: { max: 2, minMs: 300 },
  nearCup: { max: 1, minMs: 500 },
  lipOut: { max: 2, minMs: 300 },
  gimme: { max: 2, minMs: 500 },
  sink: { max: 2, minMs: 200 },
  turnStart: { max: 1, minMs: 300 },
  levelComplete: { max: 1, minMs: 1000 },
  campaignComplete: { max: 1, minMs: 2000 },
  uiClick: { max: 3, minMs: 30 },
  uiBack: { max: 2, minMs: 60 },
  uiHover: { max: 2, minMs: 60 },
  uiInvalid: { max: 1, minMs: 200 },
  uiPause: { max: 1, minMs: 200 },
  uiResume: { max: 1, minMs: 200 },
  partnerJoined: { max: 1, minMs: 500 },
  partnerLeft: { max: 1, minMs: 500 },
  aimTick: { max: 2, minMs: 35 },
});

const C4 = 261.63;
const E4 = 329.63;
const F4 = 349.23;
const G4 = 392.0;
const A4 = 440.0;
const B4 = 493.88;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const F5 = 698.46;
const G5 = 783.99;
const A5 = 880.0;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.5;
const G6 = 1568.0;

// ---- pure helpers -------------------------------------------------------------------------------

const dB = (x: number): number => Math.pow(10, x / 20);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** View-side RNG: mulberry32. Never the sim's rng. */
function makeAudioRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function loadSettings(): { muted: boolean; music: boolean; volume: number } {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const store = storage();
    if (store === null) return s;
    const m = store.getItem(STORAGE.muted);
    if (m !== null) s.muted = m === '1';
    const mu = store.getItem(STORAGE.music);
    if (mu !== null) s.music = mu === '1';
    const v = store.getItem(STORAGE.volume);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n)) s.volume = clamp01(n);
    }
  } catch {
    /* private mode / blocked storage: keep defaults */
  }
  return s;
}

function saveSetting(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** 0..1 slider -> gain: -40 dB at 0.01, 0 dB at 1 (perceptual), hard 0 at 0. */
function volumeToGain(v: number): number {
  return v <= 0 ? 0 : dB(-40 * (1 - v));
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function audioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

type Listener = { target: EventTarget; type: string; fn: EventListener; capture: boolean };
type Voice = { at: number; out: GainNode };
type NoteSeq = ReadonlyArray<readonly [number, number]>;

// ---- the system ---------------------------------------------------------------------------------

export function createAudio(opts: CreateAudioOptions = {}): AudioSystem {
  const settings = loadSettings();
  let ctx: AudioContext | null = null;
  let contextFailed = false;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let sfxBusDb = SFX_BUS_DB;
  let musicBusDb = MUSIC_BUS_DB;
  let activeVoices = 0;
  const voiceCount = new Map<string, number>();
  const lastAt = new Map<string, number>();
  const rng = makeAudioRng(opts.seed !== undefined ? opts.seed : (Date.now() ^ (nowMs() * 1000)) >>> 0);
  const rand = (lo: number, hi: number): number => lo + (hi - lo) * rng();
  const jitterCents = (cents: number): number => Math.pow(2, rand(-cents, cents) / 1200);
  let suppressUntil = 0;
  let pendingUntil = 0;
  const lastGimmeAt: [number, number] = [-Infinity, -Infinity];
  const readyCbs: Array<() => void> = [];
  const listeners: Listener[] = [];
  let gestureHandlers: Listener[] | null = null;

  // ---------- context / unlock ----------
  function graph(): { ctx: AudioContext; sfxBus: GainNode; musicBus: GainNode; noiseBuf: AudioBuffer } | null {
    if (ctx === null || sfxBus === null || musicBus === null || noiseBuf === null) return null;
    return { ctx, sfxBus, musicBus, noiseBuf };
  }

  function ensureContext(): AudioContext | null {
    if (ctx !== null) return ctx;
    if (contextFailed) return null;
    const AC = audioContextClass();
    if (AC === null) return null;
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      // NotSupportedError (per-page context limit), hardware or permission failures: stay a silent no-op
      // and stop retrying on every gesture.
      contextFailed = true;
      return null;
    }
    ctx = c;
    master = c.createGain();
    sfxBus = c.createGain();
    musicBus = c.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    if (opts.compressor !== false) {
      // Load-bearing (AUDIO.md §3): ~10 dB off transients and ~4 dB makeup on sustained content.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 6;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      master.connect(comp);
      comp.connect(c.destination);
    } else master.connect(c.destination);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = rng() * 2 - 1;
    applyGains(true);
    return c;
  }

  function applyGains(immediate: boolean): void {
    if (ctx === null || master === null || sfxBus === null || musicBus === null) return;
    const t = ctx.currentTime;
    const k = immediate ? 0.001 : 0.05;
    master.gain.setTargetAtTime(settings.muted ? 0 : volumeToGain(settings.volume), t, k);
    sfxBus.gain.setTargetAtTime(dB(sfxBusDb), t, k);
    musicBus.gain.setTargetAtTime(settings.music ? dB(musicBusDb) : 0, t, k);
  }

  const ready = (): boolean => ctx !== null && (ctx.state === 'running' || nowMs() < pendingUntil);

  function onRunning(): void {
    if (ctx === null || ctx.state !== 'running') return;
    pendingUntil = 0;
    detachGesture();
    if (settings.music && music.wantedMode !== null && !music.playing) music.start(music.wantedMode);
    while (readyCbs.length > 0) {
      const cb = readyCbs.shift();
      try {
        cb?.();
      } catch {
        /* a listener must never break the unlock */
      }
    }
  }

  function unlock(): void {
    const c = ensureContext();
    if (c === null) return;
    if (c.state !== 'running') {
      pendingUntil = nowMs() + UNLOCK_PENDING_MS;
      c.resume().then(onRunning, () => undefined);
      try {
        // iOS Safari: a one-sample silent buffer started inside the gesture is what opens the audio route.
        const b = c.createBuffer(1, 1, c.sampleRate);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
      } catch {
        /* older WebKit */
      }
    } else onRunning();
  }

  function resumeIfNeeded(): void {
    if (ctx !== null && ctx.state !== 'running') ctx.resume().then(onRunning, () => undefined);
  }

  function detachGesture(): void {
    if (gestureHandlers === null) return;
    for (const l of gestureHandlers) l.target.removeEventListener(l.type, l.fn, l.capture);
    gestureHandlers = null;
  }

  function listen(target: EventTarget, type: string, fn: EventListener, capture: boolean): void {
    target.addEventListener(type, fn, capture);
    listeners.push({ target, type, fn, capture });
  }

  function attachUnlock(target?: EventTarget): void {
    if (typeof window === 'undefined') return;
    const tgt = target ?? window;
    const handler: EventListener = () => unlock();
    gestureHandlers = ['pointerdown', 'keydown', 'touchend'].map((type) => {
      tgt.addEventListener(type, handler, true);
      return { target: tgt, type, fn: handler, capture: true };
    });
    listen(
      document,
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          resumeIfNeeded();
          music.setBackground(false);
        } else music.setBackground(true);
      },
      false,
    );
    listen(window, 'focus', resumeIfNeeded, false);
  }

  function onReady(cb: () => void): () => void {
    if (ctx !== null && ctx.state === 'running') {
      cb();
      return () => undefined;
    }
    readyCbs.push(cb);
    return () => {
      const i = readyCbs.indexOf(cb);
      if (i >= 0) readyCbs.splice(i, 1);
    };
  }

  // ---------- voice bookkeeping ----------
  /** key = name or name:playerId; `at` = scheduled ctx time (spacing is checked against it). */
  function admit(name: PolyName, key: string, at: number): boolean {
    if (!ready()) return false;
    const pol = POLY[name];
    const atMs = at * 1000;
    if (atMs - (lastAt.get(key) ?? -Infinity) < pol.minMs) return false;
    if ((voiceCount.get(name) ?? 0) >= pol.max) return false;
    if (activeVoices >= GLOBAL_MAX_VOICES) return false;
    lastAt.set(key, atMs);
    voiceCount.set(name, (voiceCount.get(name) ?? 0) + 1);
    activeVoices += 1;
    return true;
  }

  function release(name: PolyName): void {
    voiceCount.set(name, Math.max(0, (voiceCount.get(name) ?? 0) - 1));
    activeVoices = Math.max(0, activeVoices - 1);
  }

  /** GainNode routed to the bus; the voice slot is released by a silent sentinel on the audio clock. */
  function voiceOut(name: PolyName, at: number, len: number, volume: number | undefined, bus: GainNode): GainNode {
    const g = graph();
    if (g === null) throw new Error('audio: voice without a context');
    const out = g.ctx.createGain();
    out.gain.value = volume === undefined ? 1 : clamp01(volume);
    out.connect(bus);
    const done = (): void => {
      release(name);
      try {
        out.disconnect();
      } catch {
        /* already gone */
      }
    };
    if (typeof g.ctx.createConstantSource === 'function') {
      const s = g.ctx.createConstantSource();
      s.offset.value = 0;
      s.connect(out);
      s.onended = done;
      s.start(at);
      s.stop(at + len + 0.05);
    } else setTimeout(done, (at - g.ctx.currentTime + len + 0.05) * 1000);
    return out;
  }

  /** Common prologue of every sfx: admit under the player key, open the voice. */
  function begin(name: PolyName, o: SfxOpts, len: number): Voice | null {
    const g = graph();
    if (g === null || !ready()) return null;
    const at = o.at ?? g.ctx.currentTime;
    const key = o.playerId !== undefined ? `${name}:${o.playerId}` : name;
    if (!admit(name, key, at)) return null;
    return { at, out: voiceOut(name, at, len, o.volume, g.sfxBus) };
  }

  // ---------- synthesis primitives ----------
  /** Freeze an AudioParam's automation at `at` without reading param.value (Firefox fallback). */
  function holdAt(param: AudioParam, at: number, knownValue: number): void {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
    else {
      param.cancelScheduledValues(at);
      param.setValueAtTime(Math.max(0.0001, knownValue), at);
    }
  }

  type AmStage = { mod: GainNode; lfo: OscillatorNode };

  /**
   * Multiplicative AM stage in SERIES before the envelope: level swings between 1-2*depth and 1.
   * The LFO is scheduled to stop at t1; callers that end a voice earlier stop `lfo` with it.
   */
  function amStage(c: AudioContext, rate: number, depth: number, t0: number, t1: number): AmStage {
    const dpt = clamp01(depth);
    const mod = c.createGain();
    mod.gain.value = 1 - dpt;
    const l = c.createOscillator();
    l.frequency.value = rate;
    const lg = c.createGain();
    lg.gain.value = dpt;
    l.connect(lg);
    lg.connect(mod.gain);
    l.start(t0);
    l.stop(t1);
    return { mod, lfo: l };
  }

  function envelope(param: AudioParam, t0: number, a: number, d: number, s: number, dur: number, r: number, peak: number): void {
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    param.exponentialRampToValueAtTime(Math.max(0.0001, peak * (s > 0 ? s : 0.001)), t0 + a + d);
    if (s > 0) param.setValueAtTime(peak * s, t0 + dur);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur + r);
  }

  function biquad(c: AudioContext, f: FilterOpts, t0: number, dur: number, defaultType: BiquadFilterType, defaultQ: number): BiquadFilterNode {
    const node = c.createBiquadFilter();
    node.type = f.type ?? defaultType;
    node.Q.value = f.q ?? defaultQ;
    node.frequency.setValueAtTime(f.freq, t0);
    if (f.freqEnd !== undefined) node.frequency.exponentialRampToValueAtTime(f.freqEnd, t0 + (f.sweep ?? dur));
    return node;
  }

  /** Oscillator voice with ADSR (seconds), optional pitch glide, biquad filter and LFO. */
  function osc(out: AudioNode, o: OscOpts): void {
    const g = graph();
    if (g === null) return;
    const c = g.ctx;
    const t0 = o.at ?? c.currentTime;
    const a = o.a ?? 0.002;
    const d = o.d ?? 0.08;
    const s = o.s ?? 0;
    const r = o.r ?? 0.03;
    const dur = o.dur ?? a + d;
    const tEnd = t0 + dur + r + 0.05;
    const node = c.createOscillator();
    node.type = o.type ?? 'sine';
    node.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd !== undefined) node.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + (o.glide ?? dur));
    if (o.detune !== undefined) node.detune.value = o.detune;
    const env = c.createGain();
    envelope(env.gain, t0, a, d, s, dur, r, o.gain ?? 0.5);
    let last: AudioNode = node;
    if (o.filter !== undefined) {
      const f = biquad(c, o.filter, t0, dur, 'lowpass', 0.8);
      node.connect(f);
      last = f;
    }
    if (o.lfo !== undefined && o.lfo.target === 'gain') {
      const { mod } = amStage(c, o.lfo.rate, o.lfo.depth, t0, tEnd);
      last.connect(mod);
      last = mod;
    } else if (o.lfo !== undefined) {
      const l = c.createOscillator();
      l.frequency.value = o.lfo.rate;
      const lg = c.createGain();
      lg.gain.value = o.lfo.depth;
      l.connect(lg);
      lg.connect(node.frequency);
      l.start(t0);
      l.stop(tEnd);
    }
    last.connect(env);
    env.connect(out);
    node.start(t0);
    node.stop(tEnd);
  }

  /** Filtered white-noise burst from the shared 2 s buffer. */
  function noise(out: AudioNode, n: NoiseOpts): void {
    const g = graph();
    if (g === null) return;
    const c = g.ctx;
    const t0 = n.at ?? c.currentTime;
    const a = n.a ?? 0.001;
    const d = n.d ?? 0.05;
    const s = n.s ?? 0;
    const r = n.r ?? 0.02;
    const dur = n.dur ?? a + d;
    const src = c.createBufferSource();
    src.buffer = g.noiseBuf;
    src.loop = true;
    src.playbackRate.value = n.rate ?? 1;
    const f = biquad(c, n.filter ?? { freq: 1000 }, t0, dur, 'bandpass', 1);
    const env = c.createGain();
    envelope(env.gain, t0, a, d, s, dur, r, n.gain ?? 0.3);
    src.connect(f);
    f.connect(env);
    env.connect(out);
    src.start(t0, rng() * 1.5);
    src.stop(t0 + dur + r + 0.05);
  }

  /** Melodic note: triangle (LP 3 kHz) + quiet square an octave down (LP 1.2 kHz, 18 %). */
  function note(out: AudioNode, freq: number, at: number, len: number, gain: number, o: NoteOpts = {}): void {
    osc(out, {
      type: o.type ?? 'triangle',
      freq,
      at,
      a: 0.004,
      d: len * 0.6,
      s: 0.5,
      dur: len,
      r: o.r ?? 0.12,
      gain,
      filter: { type: 'lowpass', freq: o.lp ?? 3000 },
      ...(o.vib === true ? { lfo: { rate: 6, depth: freq * 0.012, target: 'freq' as const } } : {}),
    });
    if (o.sub !== false) {
      osc(out, { type: 'square', freq: freq / 2, at, a: 0.004, d: len * 0.5, s: 0.3, dur: len, r: o.r ?? 0.1, gain: gain * 0.18, filter: { type: 'lowpass', freq: 1200 } });
    }
  }

  // ---------- SFX catalogue ----------
  function bounceVoice(out: GainNode, at: number, s: number, surface: BounceSurface, j: number): void {
    if (surface === 'bridge') {
      const lvl = dB(-12 + 8 * s);
      osc(out, { type: 'square', freq: 520 * j, freqEnd: 380 * j, glide: 0.04, at, a: 0.001, d: 0.045, gain: lvl * 0.5, filter: { type: 'lowpass', freq: 2200 } });
      osc(out, { type: 'sine', freq: 900 * j, at, a: 0.001, d: 0.025, gain: lvl * 0.3 });
      noise(out, { at, d: 0.015, gain: lvl * 0.25, filter: { type: 'bandpass', freq: 2500, q: 1.5 } });
    } else if (surface === 'blocker') {
      const lvl = dB(-13 + 9 * s);
      osc(out, { type: 'square', freq: 330 * j, freqEnd: 260 * j, glide: 0.05, at, a: 0.001, d: 0.05, gain: lvl * 0.6, filter: { type: 'lowpass', freq: 2800 } });
      osc(out, { type: 'sine', freq: 1320 * j, at, a: 0.001, d: 0.04, gain: lvl * 0.4 });
      noise(out, { at, d: 0.015, gain: lvl * 0.35, filter: { type: 'bandpass', freq: 3200, q: 1.2 } });
    } else if (surface === 'dirtWall' || surface === 'levelEdge' || surface === 'ceiling') {
      const lvl = dB(-14 + 10 * s);
      osc(out, { type: 'triangle', freq: 240 * j, freqEnd: 120 * j, glide: 0.06, at, a: 0.001, d: 0.06, gain: lvl * 0.8 });
      noise(out, { at, d: 0.03, gain: lvl * 0.45, filter: { type: 'bandpass', freq: 1800, q: 1.0 } });
    } else {
      const lvl = dB(-18 + 12 * s);
      osc(out, { type: 'sine', freq: 160 * j, freqEnd: 70 * j, glide: 0.05, at, a: 0.001, d: 0.05 + 0.03 * s, gain: lvl });
      noise(out, { at, d: 0.025, gain: lvl * 0.5, filter: { type: 'lowpass', freq: 600, q: 0.7 } });
    }
  }

  const JINGLES: Readonly<Record<Medal, NoteSeq>> = Object.freeze({
    gold: [
      [C5, 0],
      [E5, 0.1],
      [G5, 0.2],
      [C6, 0.3],
      [E6, 0.45],
    ],
    silver: [
      [C5, 0],
      [E5, 0.11],
      [G5, 0.22],
      [C6, 0.33],
    ],
    bronze: [
      [C5, 0],
      [E5, 0.12],
      [G5, 0.24],
    ],
    none: [
      [G4, 0],
      [C5, 0.15],
    ],
  });

  const sfx: Sfx = {
    ballHit(power01 = 0.5, o = {}) {
      const v = begin('ballHit', o, 0.25);
      if (v === null) return;
      const { at, out } = v;
      const p = clamp01(power01);
      const j = jitterCents(40);
      const lvl = dB(-8 + 7 * p);
      osc(out, { type: 'sine', freq: (170 + 60 * p) * j, freqEnd: 70 * j, glide: 0.07, at, a: 0.001, d: 0.06 + 0.06 * p, gain: lvl * 0.9 });
      noise(out, { at, a: 0.001, d: 0.03 + 0.04 * p, gain: lvl * (0.35 + 0.35 * p), filter: { type: 'bandpass', freq: 900 + 1400 * p, q: 1.2 } });
      osc(out, { type: 'triangle', freq: (900 + 500 * p) * j, freqEnd: 400, glide: 0.03, at, a: 0.001, d: 0.025, gain: lvl * 0.25 * p });
    },
    bounce(strength01 = 0.5, surface = 'grass', o = {}) {
      const s = clamp01(strength01);
      const g = graph();
      if (s < 0.08 || g === null || !ready()) return;
      if ((o.at ?? g.ctx.currentTime) < suppressUntil) return;
      const v = begin('bounce', o, 0.2);
      if (v === null) return;
      bounceVoice(v.out, v.at, s, surface, jitterCents(60));
    },
    enterSand(o = {}) {
      const v = begin('enterSand', o, 0.35);
      if (v === null) return;
      const { at, out } = v;
      noise(out, { at, a: 0.005, d: 0.12, s: 0.35, dur: 0.14, r: 0.18, gain: dB(-10), rate: 0.9, filter: { type: 'lowpass', freq: 3000, freqEnd: 500, sweep: 0.3, q: 0.7 } });
      noise(out, { at, a: 0.002, d: 0.04, gain: dB(-16), filter: { type: 'bandpass', freq: 1200, q: 0.7 } });
    },
    rollStop(o = {}) {
      const v = begin('rollStop', o, 0.1);
      if (v === null) return;
      osc(v.out, { type: 'sine', freq: 320 * jitterCents(50), freqEnd: 200, glide: 0.05, at: v.at, a: 0.001, d: 0.05, gain: dB(TUNE.rollStop) });
    },
    spring(o = {}) {
      const v = begin('spring', o, 0.5);
      if (v === null) return;
      const { at, out } = v;
      const j = jitterCents(50);
      osc(out, { type: 'square', freq: 110 * j, at, a: 0.001, d: 0.04, gain: dB(-10), filter: { type: 'lowpass', freq: 800 } });
      osc(out, { type: 'sine', freq: 220 * j, freqEnd: 880 * j, glide: 0.09, at, a: 0.002, d: 0.3, gain: dB(-2), lfo: { rate: 18, depth: 30, target: 'freq' } });
      osc(out, { type: 'triangle', freq: 660 * j, freqEnd: 440 * j, glide: 0.2, at: at + 0.09, a: 0.001, d: 0.2, gain: dB(-14) });
    },
    bumper(o = {}) {
      const v = begin('bumper', o, 0.25);
      if (v === null) return;
      const { at, out } = v;
      const j = jitterCents(30);
      noise(out, { at, d: 0.008, gain: dB(-12), filter: { type: 'highpass', freq: 3000, q: 0.7 } });
      osc(out, { type: 'square', freq: 880 * j, at, a: 0.001, d: 0.03, gain: dB(-9), filter: { type: 'lowpass', freq: 4000 } });
      osc(out, { type: 'sine', freq: 1760 * j, at, a: 0.001, d: 0.09, gain: dB(-5) });
      osc(out, { type: 'sine', freq: 2640 * j, at, a: 0.001, d: 0.05, gain: dB(-16) });
    },
    hazardBlock(o = {}) {
      const v = begin('hazardBlock', o, 0.25);
      if (v === null) return;
      const { at, out } = v;
      osc(out, { type: 'sawtooth', freq: 110, at, a: 0.002, d: 0.1, s: 0.5, dur: 0.12, r: 0.03, gain: dB(-7), filter: { type: 'lowpass', freq: 1200, q: 2 }, lfo: { rate: 50, depth: 0.5, target: 'gain' } });
      osc(out, { type: 'square', freq: 220, freqEnd: 140, glide: 0.14, at, a: 0.002, d: 0.12, gain: dB(-13), filter: { type: 'lowpass', freq: 1500 } });
      noise(out, { at, d: 0.02, gain: dB(-14), filter: { type: 'bandpass', freq: 2800, q: 2 } });
    },
    gatePass(o = {}) {
      const v = begin('gatePass', o, 0.15);
      if (v === null) return;
      osc(v.out, { type: 'square', freq: 440, freqEnd: 880, glide: 0.06, at: v.at, a: 0.002, d: 0.06, gain: dB(-16), filter: { type: 'lowpass', freq: 2500 } });
    },
    switchOn(o = {}) {
      const v = begin('switchOn', o, 0.25);
      if (v === null) return;
      const { at, out } = v;
      noise(out, { at, d: 0.012, gain: dB(-10), filter: { type: 'highpass', freq: 2000, q: 0.7 } });
      osc(out, { type: 'sine', freq: 140, freqEnd: 70, glide: 0.04, at, a: 0.001, d: 0.05, gain: dB(-12) });
      osc(out, { type: 'square', freq: E4, at: at + 0.03, a: 0.002, d: 0.05, gain: dB(-14), filter: { type: 'lowpass', freq: 2500 } });
      osc(out, { type: 'square', freq: A4, at: at + 0.085, a: 0.002, d: 0.08, gain: dB(-12), filter: { type: 'lowpass', freq: 2500 } });
    },
    switchOff(o = {}) {
      const v = begin('switchOff', o, 0.25);
      if (v === null) return;
      const { at, out } = v;
      noise(out, { at, d: 0.01, gain: dB(-13), filter: { type: 'highpass', freq: 1500, q: 0.7 } });
      osc(out, { type: 'square', freq: A4, at: at + 0.02, a: 0.002, d: 0.05, gain: dB(-17), filter: { type: 'lowpass', freq: 2200 } });
      osc(out, { type: 'square', freq: E4, at: at + 0.075, a: 0.002, d: 0.08, gain: dB(-15), filter: { type: 'lowpass', freq: 2200 } });
    },
    bridgeToggle(active = true, o = {}) {
      const v = begin('bridgeToggle', o, 0.35);
      if (v === null) return;
      const { at, out } = v;
      if (active) {
        osc(out, { type: 'triangle', freq: 200, freqEnd: 400, glide: 0.18, at, a: 0.005, d: 0.18, gain: dB(-12) });
        [500, 600, 700].forEach((f, i) => osc(out, { type: 'square', freq: f, freqEnd: f * 0.8, glide: 0.03, at: at + i * 0.06, a: 0.001, d: 0.03, gain: dB(-12), filter: { type: 'lowpass', freq: 2200 } }));
      } else {
        osc(out, { type: 'triangle', freq: 400, freqEnd: 150, glide: 0.22, at, a: 0.005, d: 0.22, gain: dB(-12) });
        osc(out, { type: 'sine', freq: 90, freqEnd: 50, glide: 0.08, at: at + 0.2, a: 0.001, d: 0.08, gain: dB(-8) });
        noise(out, { at: at + 0.2, d: 0.03, gain: dB(-16), filter: { type: 'lowpass', freq: 700 } });
      }
    },
    fanEnter(o = {}) {
      const v = begin('fanEnter', o, 0.3);
      if (v === null) return;
      noise(v.out, { at: v.at, a: 0.02, d: 0.1, s: 0.3, dur: 0.16, r: 0.08, gain: dB(-14), filter: { type: 'lowpass', freq: 400, freqEnd: 1600, sweep: 0.12, q: 0.8 } });
    },
    fellOffWorld(o = {}) {
      const v = begin('fellOffWorld', o, 0.85);
      if (v === null) return;
      const { at, out } = v;
      osc(out, { type: 'sine', freq: 900, freqEnd: 200, glide: 0.6, at, a: 0.01, d: 0.5, s: 0.6, dur: 0.58, r: 0.04, gain: dB(-12), lfo: { rate: 9, depth: 0.35, target: 'gain' } });
      osc(out, { type: 'sine', freq: 150, freqEnd: 60, glide: 0.08, at: at + 0.66, a: 0.001, d: 0.09, gain: dB(-9) });
      noise(out, { at: at + 0.66, d: 0.05, gain: dB(-14), filter: { type: 'lowpass', freq: 800 } });
    },
    nearCup(o = {}) {
      const v = begin('nearCup', o, 0.25);
      if (v === null) return;
      osc(v.out, { type: 'triangle', freq: 500, freqEnd: 700, glide: 0.12, at: v.at, a: 0.01, d: 0.12, gain: dB(TUNE.nearCup), filter: { type: 'lowpass', freq: 2500 } });
    },
    lipOut(o = {}) {
      const v = begin('lipOut', o, 0.2);
      if (v === null) return;
      const { at, out } = v;
      const j = jitterCents(30);
      osc(out, { type: 'sine', freq: 600 * j, freqEnd: 300 * j, glide: 0.06, at, a: 0.001, d: 0.07, gain: dB(-10) });
      noise(out, { at, d: 0.015, gain: dB(-16), filter: { type: 'bandpass', freq: 2000, q: 1 } });
      osc(out, { type: 'sine', freq: 400 * j, freqEnd: 250 * j, glide: 0.04, at: at + 0.05, a: 0.001, d: 0.04, gain: dB(-14) });
    },
    gimme(o = {}) {
      const v = begin('gimme', o, 0.45);
      if (v === null) return;
      const { at, out } = v;
      [C5, E5, G5].forEach((f, i) => osc(out, { type: 'square', freq: f, at: at + i * 0.07, a: 0.002, d: 0.06, s: 0.4, dur: 0.07, r: 0.08, gain: dB(-9), filter: { type: 'lowpass', freq: 3000 } }));
    },
    sink(o = {}) {
      const chime = o.chime !== false;
      const v = begin('sink', o, chime ? 0.6 : 0.2);
      if (v === null) return;
      const { at, out } = v;
      osc(out, { type: 'sine', freq: 420, freqEnd: 180, glide: 0.09, at, a: 0.001, d: 0.09, gain: dB(-5) });
      noise(out, { at, d: 0.02, gain: dB(-12), filter: { type: 'lowpass', freq: 1500 } });
      [0, 0.045, 0.08].forEach((dt, i) => osc(out, { type: 'square', freq: 1400 - i * 200, at: at + 0.03 + dt, a: 0.001, d: 0.012, gain: dB(-16 - i * 3), filter: { type: 'lowpass', freq: 3000 } }));
      if (chime) {
        note(out, G5, at + 0.16, 0.09, dB(-9));
        note(out, C6, at + 0.26, 0.2, dB(-7), { r: 0.25 });
      }
    },
    turnStart(playerId = 0, o = {}) {
      const v = begin('turnStart', o, 0.3);
      if (v === null) return;
      const { at, out } = v;
      if (o.sameAsBefore !== true) osc(out, { type: 'triangle', freq: playerId === 0 ? C5 : G5, at, a: 0.002, d: 0.14, gain: dB(TUNE.turnDing), filter: { type: 'lowpass', freq: 2500 } });
      noise(out, { at, a: 0.03, d: 0.08, s: 0.3, dur: 0.12, r: 0.1, gain: dB(-26), filter: { type: 'lowpass', freq: 1200, freqEnd: 400, sweep: 0.2 } });
    },
    levelComplete(medal = 'bronze', o = {}) {
      const v = begin('levelComplete', o, 1.4);
      if (v === null) return;
      const { at, out } = v;
      const seq = JINGLES[medal];
      const lvl = dB(medal === 'none' ? -8 : -4);
      seq.forEach(([f, dt], i) => {
        const last = i === seq.length - 1;
        note(out, f, at + dt, last ? (medal === 'gold' ? 0.6 : 0.45) : 0.09, lvl, { vib: last, r: last ? 0.35 : 0.1 });
      });
      if (medal === 'gold') noise(out, { at: at + 0.45, a: 0.02, d: 0.3, gain: dB(-22), filter: { type: 'highpass', freq: 6000, q: 0.7 } });
      duck(at, 1.3);
      suppressUntil = at + 1.0;
    },
    campaignComplete(o = {}) {
      const v = begin('campaignComplete', o, 2.4);
      if (v === null) return;
      const { at, out } = v;
      const chords: ReadonlyArray<readonly number[]> = [
        [C4, E4, G4],
        [F4, A4, C5],
        [G4, B4, D5],
        [C4, E4, G4],
      ];
      chords.forEach((ch, i) => ch.forEach((f) => note(out, f, at + i * 0.22, 0.18, dB(-14), { sub: false })));
      const melody: NoteSeq = [
        [E5, 0.9],
        [G5, 1.02],
        [C6, 1.14],
        [G6, 1.3],
      ];
      melody.forEach(([f, dt], i) => note(out, f, at + dt, i === 3 ? 0.7 : 0.1, dB(-5), { vib: i === 3, r: i === 3 ? 0.4 : 0.1 }));
      noise(out, { at: at + 1.3, a: 0.02, d: 0.4, gain: dB(-20), filter: { type: 'highpass', freq: 6000, q: 0.7 } });
      duck(at, 2.4);
      suppressUntil = at + 1.8;
    },
    uiClick(o = {}) {
      const v = begin('uiClick', o, 0.08);
      if (v === null) return;
      osc(v.out, { type: 'square', freq: 1100, at: v.at, a: 0.001, d: 0.018, gain: dB(-14), filter: { type: 'lowpass', freq: 4000 } });
      osc(v.out, { type: 'sine', freq: 2200, at: v.at, a: 0.001, d: 0.008, gain: dB(-18) });
    },
    uiBack(o = {}) {
      const v = begin('uiBack', o, 0.1);
      if (v === null) return;
      osc(v.out, { type: 'square', freq: 900, freqEnd: 650, glide: 0.05, at: v.at, a: 0.001, d: 0.04, gain: dB(-14), filter: { type: 'lowpass', freq: 3000 } });
      osc(v.out, { type: 'sine', freq: 1300, at: v.at, a: 0.001, d: 0.008, gain: dB(-20) });
    },
    uiHover(o = {}) {
      const v = begin('uiHover', o, 0.06);
      if (v === null) return;
      osc(v.out, { type: 'sine', freq: 1500, at: v.at, a: 0.001, d: 0.012, gain: dB(TUNE.uiHover) });
    },
    uiInvalid(o = {}) {
      const v = begin('uiInvalid', o, 0.3);
      if (v === null) return;
      osc(v.out, { type: 'square', freq: 180, freqEnd: 140, glide: 0.08, at: v.at, a: 0.002, d: 0.08, gain: dB(-10), filter: { type: 'lowpass', freq: 1200 } });
      osc(v.out, { type: 'square', freq: 160, freqEnd: 120, glide: 0.08, at: v.at + 0.12, a: 0.002, d: 0.08, gain: dB(-10), filter: { type: 'lowpass', freq: 1200 } });
    },
    uiPause(o = {}) {
      const v = begin('uiPause', o, 0.25);
      if (v === null) return;
      osc(v.out, { type: 'square', freq: G5, at: v.at, a: 0.002, d: 0.06, gain: dB(-14), filter: { type: 'lowpass', freq: 3000 } });
      osc(v.out, { type: 'square', freq: E5, at: v.at + 0.08, a: 0.002, d: 0.1, gain: dB(-14), filter: { type: 'lowpass', freq: 3000 } });
    },
    uiResume(o = {}) {
      const v = begin('uiResume', o, 0.2);
      if (v === null) return;
      noise(v.out, { at: v.at, d: 0.02, gain: dB(-16), filter: { type: 'highpass', freq: 2500, q: 0.7 } });
      osc(v.out, { type: 'square', freq: C5, at: v.at, a: 0.002, d: 0.12, gain: dB(-14), filter: { type: 'lowpass', freq: 3000 } });
    },
    partnerJoined(o = {}) {
      const v = begin('partnerJoined', o, 0.5);
      if (v === null) return;
      note(v.out, E5, v.at, 0.1, dB(-10));
      note(v.out, G5, v.at + 0.14, 0.22, dB(-9), { r: 0.2 });
    },
    partnerLeft(o = {}) {
      const v = begin('partnerLeft', o, 0.5);
      if (v === null) return;
      note(v.out, G5, v.at, 0.1, dB(-12));
      note(v.out, E5, v.at + 0.14, 0.22, dB(-11), { r: 0.2 });
    },
    aimTick(power01 = 0.5, o = {}) {
      const v = begin('aimTick', o, 0.05);
      if (v === null) return;
      osc(v.out, { type: 'triangle', freq: 600 + 900 * clamp01(power01), at: v.at, a: 0.001, d: 0.012, gain: dB(TUNE.aimTick) });
    },
  };

  const PLAY: Readonly<Record<SfxName, (v: number | undefined) => void>> = {
    hit: (v) => sfx.ballHit(v ?? 0.5),
    bounceSoft: (v) => sfx.bounce(v ?? 0.3, 'grass'),
    bounceHard: (v) => sfx.bounce(v ?? 0.7, 'dirtWall'),
    sand: (v) => sfx.enterSand(vol(v)),
    spring: (v) => sfx.spring(vol(v)),
    bumper: (v) => sfx.bumper(vol(v)),
    fan: (v) => sfx.fanEnter(vol(v)),
    gateBlock: (v) => sfx.hazardBlock(vol(v)),
    gatePass: (v) => sfx.gatePass(vol(v)),
    switchOn: (v) => sfx.switchOn(vol(v)),
    switchOff: (v) => sfx.switchOff(vol(v)),
    bridge: (v) => sfx.bridgeToggle(true, vol(v)),
    fall: (v) => sfx.fellOffWorld(vol(v)),
    rest: (v) => sfx.rollStop(vol(v)),
    nearCup: (v) => sfx.nearCup(vol(v)),
    lipOut: (v) => sfx.lipOut(vol(v)),
    gimme: (v) => sfx.gimme(vol(v)),
    sink: (v) => sfx.sink(vol(v)),
    levelWin: (v) => sfx.levelComplete('gold', vol(v)),
    campaignWin: (v) => sfx.campaignComplete(vol(v)),
    turn: (v) => sfx.turnStart(0, vol(v)),
    uiClick: (v) => sfx.uiClick(vol(v)),
    uiBack: (v) => sfx.uiBack(vol(v)),
    uiHover: (v) => sfx.uiHover(vol(v)),
    uiInvalid: (v) => sfx.uiInvalid(vol(v)),
    uiPause: (v) => sfx.uiPause(vol(v)),
    uiResume: (v) => sfx.uiResume(vol(v)),
    partnerJoined: (v) => sfx.partnerJoined(vol(v)),
    partnerLeft: (v) => sfx.partnerLeft(vol(v)),
    aimTick: (v) => sfx.aimTick(v ?? 0.5),
  };

  function vol(v: number | undefined): SfxOpts {
    return v === undefined ? {} : { volume: v };
  }

  function play(name: SfxName, volume?: number): void {
    PLAY[name](volume);
  }

  // ---------- fan loop (single instance, state-driven via setFan) ----------
  type FanNodes = { src: AudioBufferSourceNode; hum: OscillatorNode; lfo: OscillatorNode; lp: BiquadFilterNode; fade: GainNode };
  let fanNodes: FanNodes | null = null;
  let fanLevel = dB(-18);

  const fan: FanLoop = {
    start() {
      const g = graph();
      if (g === null || !ready() || fanNodes !== null) return;
      const c = g.ctx;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = g.noiseBuf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 350;
      lp.Q.value = 0.8;
      const hum = c.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 55;
      const humG = c.createGain();
      humG.gain.value = 0.35;
      const { mod, lfo } = amStage(c, 0.7, 0.12, t, t + 3600);
      const fade = c.createGain();
      fanLevel = dB(-18);
      fade.gain.setValueAtTime(0.0001, t);
      fade.gain.exponentialRampToValueAtTime(fanLevel, t + 0.15);
      src.connect(lp);
      lp.connect(mod);
      hum.connect(humG);
      humG.connect(mod);
      mod.connect(fade);
      fade.connect(g.sfxBus);
      src.start(t);
      hum.start(t);
      fanNodes = { src, hum, lfo, lp, fade };
    },
    stop() {
      const n = fanNodes;
      if (n === null || ctx === null) return;
      fanNodes = null;
      const t = ctx.currentTime;
      holdAt(n.fade.gain, t, fanLevel);
      n.fade.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      n.src.stop(t + 0.35);
      n.hum.stop(t + 0.35);
      n.lfo.stop(t + 0.35);
      n.src.onended = () => {
        try {
          n.fade.disconnect();
        } catch {
          /* already gone */
        }
      };
    },
    setIntensity(k) {
      if (fanNodes === null || ctx === null) return;
      const t = ctx.currentTime;
      const v = clamp01(k);
      fanNodes.lp.frequency.setTargetAtTime(350 + 900 * v, t, 0.08);
      fanLevel = dB(-21 + 6 * v);
      fanNodes.fade.gain.setTargetAtTime(fanLevel, t, 0.08);
    },
    get running() {
      return fanNodes !== null;
    },
  };

  function setFan(active: boolean, intensity01: number): void {
    if (!ready()) return;
    if (active) {
      if (!fan.running) fan.start();
      fan.setIntensity(intensity01);
    } else if (fan.running) fan.stop();
  }

  // ---------- music: generative bed ----------
  function duck(at: number, seconds: number): void {
    if (musicBus === null || !settings.music) return;
    holdAt(musicBus.gain, at, dB(musicBusDb));
    musicBus.gain.linearRampToValueAtTime(dB(musicBusDb - DUCK_DB), at + 0.06);
    musicBus.gain.linearRampToValueAtTime(dB(musicBusDb), at + seconds + 0.8);
  }

  const music = createMusicBed();

  function createMusicBed(): MusicBed {
    const BPM = 84;
    const BEAT = 60 / BPM;
    const BARS = 16;
    const PAD_GAIN = dB(-26);
    const LOOK_FG = 0.15;
    const LOOK_BG = 2.5;
    const INT_FG = 50;
    const INT_BG = 1000;
    type Chord = { pad: readonly number[]; bass: number; shimmer: number; pool: readonly number[] };
    const CH: readonly Chord[] = [
      { pad: [C4, E4, G4, B4], bass: C4 / 2, shimmer: G5, pool: [C5, D5, E5, G5, A5] },
      { pad: [A4 / 2, C4, E4, G4], bass: A4 / 4, shimmer: E5, pool: [C5, D5, E5, G5, A5] },
      { pad: [F4, A4, C5, E5], bass: F4 / 2, shimmer: C5, pool: [C5, D5, E5, F5, A5] },
      { pad: [G4, B4, D5, E5], bass: G4 / 2, shimmer: D5, pool: [D5, E5, G5, A5, B5] },
    ];
    type PadVoice = { g: GainNode; oscs: OscillatorNode[]; start: number };
    let timer: ReturnType<typeof setInterval> | null = null;
    let nextBeat = 0;
    let beatIndex = 0;
    let mode: MusicMode = 'title';
    let wantedMode: MusicMode | null = null;
    let lastPluck = 0;
    let padVoices: PadVoice[] = [];
    let padChordIdx = -1;
    let look = LOOK_FG;
    let intervalMs = INT_FG;
    let hidden = false;
    const chordAt = (b: number): number => Math.floor((Math.floor(b / 4) % BARS) / 2) % CH.length;
    const chord = (i: number): Chord => CH[i] ?? CH[0]!;

    /**
     * A voice booked ahead but not yet sounding is cancelled outright: holding its gain before the first
     * automation event would drop the envelope and fall back to the 1.0 default (a full-level chord stab).
     */
    function fadeOutPads(at: number, fadeSec: number): void {
      for (const v of padVoices) {
        if (at < v.start) {
          v.g.gain.cancelScheduledValues(0);
          v.g.gain.setValueAtTime(0.0001, at);
          for (const o of v.oscs) o.stop(v.start);
          continue;
        }
        holdAt(v.g.gain, at, PAD_GAIN);
        v.g.gain.linearRampToValueAtTime(0.0001, at + fadeSec);
        for (const o of v.oscs) o.stop(at + fadeSec + 0.1);
      }
      padVoices = [];
    }

    function padChord(i: number, at: number): void {
      const g = graph();
      if (g === null) return;
      const c = g.ctx;
      fadeOutPads(at, 1.5);
      padChordIdx = i;
      const ch = chord(i);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(PAD_GAIN, at + 1.2);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.7;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoG = c.createGain();
      lfoG.gain.value = 200;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lfo.start(at);
      const oscs: OscillatorNode[] = [lfo];
      for (const f of ch.pad) {
        for (const cents of [-7, 7]) {
          const o = c.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(at);
          oscs.push(o);
        }
      }
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = (ch.pad[0] ?? C4) / 2;
      const sg = c.createGain();
      sg.gain.value = 0.5;
      sub.connect(sg);
      sg.connect(lp);
      sub.start(at);
      oscs.push(sub);
      const sh = c.createOscillator();
      sh.type = 'sine';
      sh.frequency.value = ch.shimmer;
      const shg = c.createGain();
      shg.gain.value = dB(-14);
      const trem = amStage(c, 0.3, 0.4, at, at + 60);
      sh.connect(shg);
      shg.connect(trem.mod);
      trem.mod.connect(lp);
      sh.start(at);
      sh.stop(at + 60);
      oscs.push(sh, trem.lfo);
      lp.connect(gain);
      gain.connect(g.musicBus);
      padVoices.push({ g: gain, oscs, start: at });
    }

    function bass(i: number, at: number): void {
      const g = graph();
      if (g !== null) osc(g.musicBus, { type: 'sine', freq: chord(i).bass, at, a: 0.02, d: 1.6, gain: dB(-20) });
    }

    function pluck(f: number, at: number): void {
      const g = graph();
      if (g === null) return;
      osc(g.musicBus, { type: 'triangle', freq: f, at, a: 0.003, d: 0.32, gain: dB(-22), filter: { type: 'lowpass', freq: 2400 } });
      osc(g.musicBus, { type: 'sine', freq: f * 2, at, a: 0.003, d: 0.12, gain: dB(-32) });
    }

    function schedulePlucks(bar: number, beat: number, pool: readonly number[], at: number): void {
      const resting = bar % 8 >= 6;
      for (let e = 0; e < 2; e += 1) {
        const p = resting ? 0.08 : beat === 0 ? 0.5 : 0.3;
        if (rng() >= p) continue;
        let f = pool[Math.floor(rng() * pool.length)] ?? C5;
        if (f === lastPluck) f = pool[(pool.indexOf(f) + 1) % pool.length] ?? f;
        lastPluck = f;
        pluck(f, at + (e * BEAT) / 2);
      }
    }

    function scheduleBeat(b: number, at: number): void {
      const bar = Math.floor(b / 4) % BARS;
      const beat = b % 4;
      const ci = chordAt(b);
      if (bar % 2 === 0 && beat === 0) padChord(ci, at);
      if (beat === 0 || beat === 2) bass(ci, at);
      if (mode === 'play') schedulePlucks(bar, beat, chord(ci).pool, at);
    }

    function tick(): void {
      if (ctx === null) return;
      const now = ctx.currentTime;
      if (nextBeat < now - 0.25) {
        // catch-up clamp: skip missed beats instead of stacking them
        const skipped = Math.ceil((now - nextBeat) / BEAT);
        beatIndex += skipped;
        nextBeat += skipped * BEAT;
        if (chordAt(beatIndex) !== padChordIdx) padChord(chordAt(beatIndex), now);
      }
      while (nextBeat < now + look) {
        scheduleBeat(beatIndex, nextBeat);
        beatIndex += 1;
        nextBeat += BEAT;
      }
    }

    function startTimer(): void {
      if (timer !== null) clearInterval(timer);
      timer = setInterval(tick, intervalMs);
    }

    function start(m?: MusicMode): void {
      if (m !== undefined) mode = m;
      wantedMode = mode;
      if (ctx === null || !ready() || !settings.music || timer !== null) return;
      nextBeat = ctx.currentTime + 0.05;
      beatIndex = 0;
      padChordIdx = -1;
      startTimer();
      tick();
    }

    function halt(fadeSec: number): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      if (ctx !== null) fadeOutPads(ctx.currentTime, fadeSec);
      padChordIdx = -1;
    }

    return {
      start,
      stop() {
        wantedMode = null;
        halt(1.0);
      },
      halt,
      setMode(m) {
        mode = m;
        if (wantedMode !== null) wantedMode = m;
        else start(m);
      },
      setBackground(h) {
        hidden = h;
        look = hidden ? LOOK_BG : LOOK_FG;
        intervalMs = hidden ? INT_BG : INT_FG;
        if (timer !== null) {
          startTimer();
          tick();
        }
      },
      get playing() {
        return timer !== null;
      },
      get mode() {
        return mode;
      },
      get wantedMode() {
        return wantedMode;
      },
      get hidden() {
        return hidden;
      },
    };
  }

  // ---------- settings (audio.ts owns persistence) ----------
  function setMuted(b: boolean): void {
    settings.muted = b;
    saveSetting(STORAGE.muted, b ? '1' : '0');
    applyGains(false);
  }
  function setMusic(b: boolean): void {
    settings.music = b;
    saveSetting(STORAGE.music, b ? '1' : '0');
    applyGains(false);
    if (b) music.start();
    else music.halt(0.6);
  }
  function setVolume(v: number): void {
    settings.volume = clamp01(v);
    saveSetting(STORAGE.volume, String(settings.volume));
    applyGains(false);
  }
  function setBusDb(sfxDb?: number, musDb?: number): void {
    if (sfxDb !== undefined) sfxBusDb = sfxDb;
    if (musDb !== undefined) musicBusDb = musDb;
    applyGains(false);
  }

  // ---------- sim event router ----------
  /**
   * Music bed follows the hole, not the intro card: `playStart` opens play, but so does any `turnStart` or
   * `ballHit`, because the sim never emits `playStart` after `restartLevel` (results-card Retry, pause-menu
   * Restart), a `?state=` resume or an online join mid-hole. Runs before the ready() gate so the mode is right
   * when sound is unlocked.
   */
  function trackBed(ev: SimEvent): void {
    switch (ev.type) {
      case 'playStart':
      case 'turnStart':
      case 'ballHit':
        if (music.mode !== 'play') music.setMode('play');
        break;
      case 'levelComplete':
      case 'campaignComplete':
        if (music.mode !== 'title') music.setMode('title');
        break;
      default:
        break;
    }
  }

  function routeEvent(ev: SimEvent, at: number, completeTicks: ReadonlySet<number>, campaignTick: number): void {
    switch (ev.type) {
      case 'ballHit':
        sfx.ballHit(ev.power / MAX_POWER, { at, playerId: ev.playerId });
        break;
      case 'bounce':
        sfx.bounce(ev.strength, ev.surface, { at, playerId: ev.playerId });
        break;
      case 'enterSand':
        sfx.enterSand({ at, playerId: ev.playerId });
        break;
      case 'ballRest':
        sfx.rollStop({ at, playerId: ev.playerId });
        break;
      case 'spring':
        sfx.spring({ at, playerId: ev.playerId });
        break;
      case 'bumper':
        sfx.bumper({ at, playerId: ev.playerId });
        break;
      case 'fan':
        sfx.fanEnter({ at, playerId: ev.playerId });
        break;
      case 'hazardBlock':
        sfx.hazardBlock({ at, playerId: ev.playerId });
        break;
      case 'gatePass':
        sfx.gatePass({ at, playerId: ev.playerId });
        break;
      case 'switchOn':
        sfx.switchOn({ at, playerId: ev.switchId });
        break;
      case 'switchOff':
        sfx.switchOff({ at, playerId: ev.switchId });
        break;
      case 'bridgeToggle':
        sfx.bridgeToggle(ev.active, { at, playerId: ev.rectId });
        break;
      case 'fellOffWorld':
        sfx.fellOffWorld({ at, playerId: ev.playerId });
        break;
      case 'nearCup':
        sfx.nearCup({ at, playerId: ev.playerId });
        break;
      case 'lipOut':
        sfx.lipOut({ at, playerId: ev.playerId });
        break;
      case 'gimme':
        lastGimmeAt[ev.playerId] = at;
        sfx.gimme({ at, playerId: ev.playerId });
        break;
      case 'sink': {
        const afterGimme = at - lastGimmeAt[ev.playerId] < GIMME_SINK_WINDOW_SEC;
        const withJingle = completeTicks.has(ev.tick) || campaignTick === ev.tick;
        sfx.sink({ at, playerId: ev.playerId, chime: !afterGimme && !withJingle });
        break;
      }
      case 'turnStart':
        sfx.turnStart(ev.playerId, { at, sameAsBefore: ev.sameAsBefore });
        break;
      case 'levelComplete':
        if (campaignTick !== ev.tick) sfx.levelComplete(ev.result.medal, { at: at + JINGLE_DELAY_SEC });
        break;
      case 'campaignComplete':
        sfx.campaignComplete({ at: at + JINGLE_DELAY_SEC });
        break;
      case 'levelRestart':
        sfx.uiBack({ at });
        break;
      case 'commandRejected':
        if (ev.reason !== 'turnDelay') sfx.uiInvalid({ at });
        break;
      case 'levelStart':
      case 'playStart':
        break;
    }
  }

  /**
   * Events from a multi-tick frame are scheduled at base + (tick - firstTick) * DT (capped at 250 ms)
   * so two balls acting on different ticks keep their spacing. `nowMs` is the frame clock (unused by
   * the audio clock, which schedules on ctx.currentTime); `delaySec` aligns online sounds with the
   * render delay.
   */
  function handleEvents(events: readonly SimEvent[], nowMsArg: number, delaySec = 0): void {
    void nowMsArg;
    if (events.length === 0) return;
    for (const ev of events) trackBed(ev);
    if (ctx === null || !ready()) return;
    const first = events[0];
    if (first === undefined) return;
    const base = ctx.currentTime + delaySec;
    const completeTicks = new Set<number>();
    let campaignTick = -1;
    for (const ev of events) {
      if (ev.type === 'levelComplete') completeTicks.add(ev.tick);
      if (ev.type === 'campaignComplete') campaignTick = ev.tick;
    }
    for (const ev of events) routeEvent(ev, base + Math.min(MULTI_TICK_CAP_SEC, (ev.tick - first.tick) * DT), completeTicks, campaignTick);
  }

  function dispose(): void {
    music.halt(0.2);
    if (fan.running) fan.stop();
    detachGesture();
    for (const l of listeners.splice(0)) l.target.removeEventListener(l.type, l.fn, l.capture);
    readyCbs.length = 0;
    if (master !== null) {
      try {
        master.disconnect();
      } catch {
        /* already gone */
      }
    }
  }

  return {
    unlock,
    handleEvents,
    play,
    setMuted,
    isMuted: () => settings.muted,
    setMusic,
    dispose,
    attachUnlock,
    onReady,
    setVolume,
    setFan,
    get settings(): AudioSettings {
      return { muted: settings.muted, music: settings.music, volume: settings.volume };
    },
    get ready() {
      return ready();
    },
    sfx,
    fan,
    music,
    setBusDb,
  };
}
