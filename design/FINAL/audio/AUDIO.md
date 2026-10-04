# Flash Golf audio design v2 (Web Audio API only, zero asset files)

Companion: `audio-demo.html` in this folder auditions every recipe below. Everything between the `PORT BOUNDARY`
comments in that file is the implementation of `src/view/audio.ts`; the page only adds buttons. Verification this round
(scripts in `scratchpad/pw/`, section 4): 55 buttons clicked, every `data-sfx` button clicked twice and all five router
sequences run with real `SimEvent` shapes, zero page errors; every sound rendered through an `OfflineAudioContext` for the
levels in section 2; the AM voices probed for envelope leakage (section 3); the music scheduler probed for stalls and
hidden tabs (section 7); the section 1 surface compiled with the project's `tsc` 5.9.3 under `--strict --lib dom`.

Section 10 lists what changed since v1 and why, item by item against the critique.

## 0. Direction in one paragraph

Bright, chunky, late-Flash cartoon: short percussive hits built from sine/triangle bodies plus filtered white-noise
transients, warmed up so nothing is harsh: every square or saw is lowpassed at 1.2-4 kHz, no sound exceeds 2.4 s, jingles
share one C-major motif. Each mechanic has its own timbre family so a first-time player can tell them apart blind:
spring = boing, bumper = pinball ding, sand = shuffle, fan = air loop with a "whff" on entry, colour gate = electric bzzt
when it blocks and an upward "zwip" when it lets you through (so "mine passes, yours bounces" is audible, brief decision 9),
switch = mechanical click + two-note confirm, bridge = wooden slide, blocker wall = metallic clang. Players own a note
(red P1 = C5 523 Hz, blue P2 = G5 784 Hz). Co-op framing: no failure sound is punishing; even the "no medal" result is a
two-note "done" rather than a sad trombone.

## 1. Architecture (`src/view/audio.ts`)

The exported surface is ARCH.md 1.10 `AudioSystem` verbatim, plus additions that GameCanvas / App / UI need (listed
as contract requests in section 9). `GameCanvasProps.audio: AudioSystem` and the loop's `audio.handleEvents(r.events)`
compile unchanged.

```ts
import type { SimEvent, PlayerId, Medal, BounceSurface } from '../sim/types';
import { DT, MAX_POWER } from '../sim/types';

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }   // TS2551 under strict DOM lib otherwise

export type SfxName =
  | 'hit' | 'bounceSoft' | 'bounceHard' | 'sand' | 'spring' | 'bumper' | 'fan' | 'gateBlock' | 'gatePass' | 'switchOn' | 'switchOff'
  | 'bridge' | 'fall' | 'rest' | 'nearCup' | 'lipOut' | 'gimme' | 'sink' | 'levelWin' | 'campaignWin' | 'turn' | 'uiClick' | 'uiBack'
  | 'uiHover' | 'uiInvalid' | 'uiPause' | 'uiResume' | 'partnerJoined' | 'partnerLeft' | 'aimTick';   // last 7 are additions to ARCH's list
export type MusicMode = 'title' | 'play';
export interface AudioSettings { readonly muted: boolean; readonly music: boolean; readonly volume: number /* 0..1 */ }
/** Trailing option bag every sfx.* function accepts. */
export interface SfxOpts { at?: number; playerId?: PlayerId | string; volume?: number; chime?: boolean; sameAsBefore?: boolean }
export interface FilterOpts { type?: BiquadFilterType; freq: number; freqEnd?: number; sweep?: number; q?: number }
export interface LfoOpts { rate: number; depth: number; target: 'freq' | 'gain' }   // 'gain' = multiplicative tremolo, depth 0..1
export interface OscOpts { type?: OscillatorType; freq: number; freqEnd?: number; glide?: number; detune?: number; a?: number; d?: number; s?: number; r?: number; dur?: number; gain?: number; filter?: FilterOpts; lfo?: LfoOpts; at?: number }
export interface NoiseOpts { a?: number; d?: number; s?: number; r?: number; dur?: number; gain?: number; rate?: number; filter?: FilterOpts; at?: number }
export interface NoteOpts { type?: OscillatorType; vib?: boolean; r?: number; lp?: number; sub?: boolean }

export interface Sfx {
  ballHit(power01?: number, o?: SfxOpts): void; bounce(strength01?: number, surface?: BounceSurface, o?: SfxOpts): void;
  enterSand(o?: SfxOpts): void; rollStop(o?: SfxOpts): void; spring(o?: SfxOpts): void; bumper(o?: SfxOpts): void;
  hazardBlock(o?: SfxOpts): void; gatePass(o?: SfxOpts): void; switchOn(o?: SfxOpts): void; switchOff(o?: SfxOpts): void;
  bridgeToggle(active?: boolean, o?: SfxOpts): void; fanEnter(o?: SfxOpts): void; fellOffWorld(o?: SfxOpts): void;
  nearCup(o?: SfxOpts): void; lipOut(o?: SfxOpts): void; gimme(o?: SfxOpts): void; sink(o?: SfxOpts): void;
  turnStart(playerId?: PlayerId, o?: SfxOpts): void; levelComplete(medal?: Medal, o?: SfxOpts): void; campaignComplete(o?: SfxOpts): void;
  uiClick(o?: SfxOpts): void; uiBack(o?: SfxOpts): void; uiHover(o?: SfxOpts): void; uiInvalid(o?: SfxOpts): void;
  uiPause(o?: SfxOpts): void; uiResume(o?: SfxOpts): void; partnerJoined(o?: SfxOpts): void; partnerLeft(o?: SfxOpts): void;
  aimTick(power01?: number, o?: SfxOpts): void;
}
export interface FanLoop { start(): void; stop(): void; setIntensity(k: number): void; readonly running: boolean }
export interface MusicBed {
  start(mode?: MusicMode): void;            // ALWAYS records wantedMode; starts when running + enabled; unlock() retries it
  stop(): void;                             // clears wantedMode (explicit "no music now")
  halt(fadeSec: number): void;              // stops the scheduler, keeps wantedMode (used by setMusic(false) / dispose)
  setMode(mode: MusicMode): void;           // no restart; the bed is continuous from Title into the first hole
  setBackground(hidden: boolean): void;     // hidden tab: 2.5 s lookahead on a 1 s interval
  readonly playing: boolean; readonly mode: MusicMode; readonly wantedMode: MusicMode | null; readonly hidden: boolean;
}
export type AudioSystem = {
  // ARCH.md 1.10, verbatim
  unlock(): void;                                   // call synchronously inside a pointerdown/keydown/touchend/click handler; idempotent
  handleEvents(events: readonly SimEvent[], delaySec?: number): void;   // delaySec: GameClient passes CLIENT_RENDER_DELAY_MS/1000
  play(name: SfxName, volume?: number): void;       // volume = power01 for 'hit', strength01 for bounce*, else a 0..1 multiplier
  setMuted(muted: boolean): void; isMuted(): boolean;
  setMusic(on: boolean): void;
  dispose(): void;                                  // clears the music interval, stops the fan, removes listeners, disconnects master; never close()s the context
  // additions (section 9)
  attachUnlock(target?: EventTarget): void;        // once, in main.tsx
  onReady(cb: () => void): () => void;              // fires once when the context is running (HUD flips "Tap for sound" -> speaker)
  setVolume(v: number): void;
  setFan(active: boolean, intensity01: number): void;   // once per frame from GameCanvas (section 2, fan row)
  readonly settings: AudioSettings;                 // audio.ts owns persistence; App seeds `muted` from this
  readonly ready: boolean;
  readonly sfx: Sfx; readonly fan: FanLoop; readonly music: MusicBed;
  setBusDb(sfxDb?: number, musicDb?: number): void; // debug / mixing sessions only, not in Settings
};
export function createAudio(opts?: { seed?: number; compressor?: boolean }): AudioSystem;   // seed: deterministic jitter for tests
```

Graph: `voice GainNode (x volume) -> sfxBus (-6 dB) | musicBus (-15 dB) -> master (volume slider) -> DynamicsCompressor
(threshold -12 dB, knee 6, ratio 4:1, attack 3 ms, release 150 ms) -> destination`. What the compressor really does is
measured in section 3.

Rules the module obeys:

- Never touches the sim's RNG. It owns a mulberry32 (`makeAudioRng`) seeded from `Date.now() ^ performance.now()` or
  `opts.seed`, used for pitch jitter, the noise buffer and the music's note choices.
- No sound before `ready()`. `ready() = ctx.state === 'running' || performance.now() < pendingUntil`; `pendingUntil` is
  set to now + 1000 ms by `unlock()` while `resume()` is pending, because Web Audio accepts scheduling on a suspended
  context (nodes start when it resumes) and Safari only flips `state` when `resume()` resolves. Events before unlock
  are dropped, never queued. Music-bed tracking (`trackBed`: `playStart`/`turnStart`/`ballHit` -> play,
  `levelComplete`/`campaignComplete` -> title) runs even before unlock, so the bed opens in the right mode.
- One shared 2 s white-noise `AudioBuffer`; every noise voice is a looping `AudioBufferSource` with a random offset.
- Every voice is a fresh node graph (`osc()` / `noise()` / `note()`) that stops itself. Nothing is pooled.
- Polyphony in `admit(name, key, at)`: per-name `max` simultaneous voices, per-key `minMs` retrigger spacing where
  `key = name + ':' + playerId` for ball-owned sounds (and `':' + rectId` for `bridgeToggle`), global cap 24 voices.
  The spacing is checked against the SCHEDULED time `at`, not `currentTime`. Rejected calls return silently.
- Voice slots are released by a silent `ConstantSourceNode` sentinel (offset 0, `start(at)`, `stop(at + len + 0.05)`,
  `onended -> release`), i.e. on the audio clock. `setTimeout` is only the fallback when `createConstantSource` is
  missing, because timers are throttled to >= 1 s in hidden tabs and `activeVoices` would sit at the cap after a
  return. Jingle delays use `at: base + 0.35`, never `setTimeout`.
- While a jingle plays, `suppressUntil` silences bounces (1.0 s after `levelComplete`, 1.8 s after `campaignComplete`)
  and the music bus ducks 4 dB (60 ms in, back over `len + 0.8 s`).
- `holdAt(param, at, known)` freezes automation (`cancelAndHoldAtTime`, Firefox fallback `cancelScheduledValues` +
  the known value) before every re-ramp. Never read `param.value` for a future ramp: before the first automation event
  it reports the default (1.0) and produced a +28 dB burst at every chord change in the v1 offline test.
- Amplitude modulation is MULTIPLICATIVE (`amStage(rate, depth)`): a series GainNode with `gain = 1 - depth` whose
  `gain` AudioParam receives `lfo -> GainNode(depth)`, inserted BEFORE the envelope. The level swings between
  `1 - 2*depth` and 1 and the ADSR still gates the voice. v1 connected the LFO additively to `env.gain`, which defeated
  the envelope (section 3, "AM leakage").

Primitives (seconds in code, ms in the tables):

- `osc(out, OscOpts)`: ADSR = linear attack to `gain`, exponential decay to `gain*s` (or to silence when `s = 0`), hold to
  `dur`, exponential release `r`; `freqEnd` is an exponential pitch glide over `glide`; `lfo.target 'freq'` adds
  +/- depth Hz (vibrato), `'gain'` is `amStage`.
- `noise(out, NoiseOpts)`: same envelope on the shared noise buffer through one biquad (default bandpass).
- `note(out, freq, at, len, gain, NoteOpts)`: triangle through LP 3 kHz + quiet square one octave below (LP 1.2 kHz,
  18 %); `vib` = 6 Hz vibrato at 1.2 % depth. All jingles use it.

## 2. SFX catalogue mapped to the real `SimEventBody`

Payloads are the ones in `scratchpad/design/architecture/types.ts` (no longer proposals). Columns: recipe (oscillator,
Hz, A/D/S/R ms, filter, noise); jitter; polyphony `max / minMs` and the key; measured peak / loudest-50-ms-RMS dBFS at
volume 0.8 through the full chain (section 4).

| Event -> sfx | Recipe | Jitter | Poly, key | Peak / RMS |
|---|---|---|---|---|
| **ballHit** `{power}` -> `ballHit(power / MAX_POWER)` | Level `-8 + 7p` dB. Body: sine `170+60p` Hz gliding to 70 Hz over 70 ms, A1 D`60+60p`. Click: noise bandpass `900+1400p` Hz Q1.2, A1 D`30+40p`, 35-70 %. Snap: triangle `900+500p` gliding to 400 Hz in 30 ms, A1 D25, `25%*p`. | +/-40 c | 1 / 60, player | -24.9 / -40.1 (p=0.15), -21.4 / -36.6 (0.5), -16.9 / -31.8 (1.0) |
| **bounce** `{strength, surface:'grass'}` | Ignored when `strength < 0.08` and while `suppressUntil`. Level `-18 + 12s` dB. Sine 160 to 70 Hz over 50 ms, A1 D`50+30s`; noise lowpass 600 Hz Q0.7 D25 at 50 %. Thud. | +/-60 c | 4 / 45, player | -34.1 / -48.8 (s=0.2), -28.1 / -42.0 (0.7) |
| bounce `surface: 'dirtWall' / 'levelEdge' / 'ceiling'` | Level `-14 + 10s` dB. Triangle 240 to 120 Hz over 60 ms, A1 D60, 80 %; noise bandpass 1.8 kHz Q1 D30, 45 %. Woody. | +/-60 c | shared | -26.4 / -44.3 (0.6) |
| bounce `surface: 'bridge'` | Level `-12 + 8s` dB. Square 520 to 380 Hz over 40 ms, LP 2.2 kHz, A1 D45, 50 %; sine 900 Hz D25, 30 %; noise bandpass 2.5 kHz Q1.5 D15, 25 %. Hollow "tok". | +/-60 c | shared | -30.8 / -46.1 (0.6) |
| bounce `surface: 'blocker'` | Level `-13 + 9s` dB. Square 330 to 260 Hz over 50 ms, LP 2.8 kHz, A1 D50, 60 %; sine 1320 Hz D40, 40 %; noise bandpass 3.2 kHz Q1.2 D15, 35 %. Metallic clang (blocker gate wall). | +/-60 c | shared | -25.0 / -43.5 (0.6) |
| **enterSand** | Noise lowpass sweeping 3 kHz to 500 Hz over 300 ms, playbackRate 0.9, A5 D120 S35 % hold 140 R180, -10 dB; plus noise bandpass 1.2 kHz Q0.7 A2 D40, -16 dB. "shhfft". | none | 2 / 250, player | -29.4 / -38.9 |
| **ballRest** -> `rollStop` | Sine 320 to 200 Hz over 50 ms, A1 D50, `TUNE.rollStop` = -20 dB. Settle tick. | +/-50 c | 2 / 200, player | -37.7 / -53.6 |
| **spring** | Thunk: square 110 Hz LP 800 Hz A1 D40 -10 dB. Boing: sine 220 to 880 Hz over 90 ms, A2 D300, -2 dB, 18 Hz vibrato +/-30 Hz. Tail at +90 ms: triangle 660 to 440 Hz over 200 ms, D200, -14 dB. | +/-50 c | 2 / 80, player | -20.4 / -27.1 |
| **bumper** | Click: noise highpass 3 kHz D8 -12 dB. Square 880 Hz LP 4 kHz A1 D30 -9 dB; sine 1760 Hz A1 D90 -5 dB; sine 2640 Hz D50 -16 dB. Pinball ding. | +/-30 c | 3 / 40, player | -15.7 / -35.3 |
| **hazardBlock** `{colour}` (wrong-colour ball) | Saw 110 Hz, LP 1.2 kHz Q2, multiplicative AM 50 Hz depth 0.5 (true ring-mod buzz), A2 D100 S50 % hold 120 R30, -7 dB. Square 220 to 140 Hz over 140 ms, LP 1.5 kHz, A2 D120, -13 dB. Noise bandpass 2.8 kHz Q2 D20 -14 dB. | none | 2 / 120, player | -21.5 / -32.6 |
| **gatePass** (matching ball crosses) | Square 440 to 880 Hz over 60 ms, LP 2.5 kHz, A2 D60, -16 dB. Upward "zwip". | none | 2 / 100, player | -36.5 / -48.3 |
| **switchOn** `{switchId, byPlayer}` | Click: noise highpass 2 kHz D12 -10 dB; thunk sine 140 to 70 Hz over 40 ms D50 -12 dB. Confirm: square E4 329.6 Hz at +30 ms A2 D50 -14 dB, square A4 440 Hz at +85 ms A2 D80 -12 dB (LP 2.5 kHz). | none | 2 / 100, name | -21.6 / -32.9 |
| **switchOff** | Clack: noise highpass 1.5 kHz D10 -13 dB. Square A4 at +20 ms D50 -17 dB, square E4 at +75 ms D80 -15 dB (LP 2.2 kHz). Mirror, 3 dB quieter. | none | 2 / 100, name | -25.5 / -36.2 |
| **bridgeToggle** `{active:true}` (bridge appears / blocker opens) | Triangle 200 to 400 Hz over 180 ms, A5 D180, -12 dB; three toks: square 500/600/700 Hz each gliding -20 % over 30 ms, LP 2.2 kHz, at 0/60/120 ms, A1 D30 -12 dB. | none | 2 / 150, rectId | -21.1 / -36.3 |
| bridgeToggle `{active:false}` (bridge vanishes / blocker closes) | Triangle 400 to 150 Hz over 220 ms, A5 D220, -12 dB; clunk at +200 ms: sine 90 to 50 Hz over 80 ms D80 -8 dB + noise lowpass 700 Hz D30 -16 dB. | none | shared | -18.4 / -29.6 |
| **fan** (once per entry) -> `fanEnter` | Noise lowpass sweeping 400 to 1600 Hz over 120 ms, Q0.8, A20 D100 S30 % hold 160 R80, -14 dB. "whff". The loop is NOT driven by this event (next row). | none | 2 / 300, player | -36.6 / -46.8 |
| fan loop (state, `setFan(active, k)` once per frame) | Single instance. Looping noise through lowpass `350 + 900k` Hz Q0.8 + sine hum 55 Hz at 35 %, through a multiplicative 0.7 Hz AM stage depth 0.12 (+/-1.1 dB wobble), into a fade gain: in 150 ms to -18 dB, steady `-21 + 6k` dB with 80 ms smoothing, out 300 ms then nodes stop at +350 ms. GameCanvas: `active = some non-sunk ball centre inside a FanRect AABB`, `k = clamp01(1 - (ball.y - rect.y) / rect.h)`. | none | 1 | -28.3 / -37.5 (k=1) |
| **fellOffWorld** `{respawnPos, strokes}` | Slide whistle: sine 900 to 200 Hz over 600 ms, A10 D500 S60 % hold 580 R40, -12 dB, multiplicative tremolo 9 Hz depth 0.35. Plop at +660 ms: sine 150 to 60 Hz over 80 ms D90 -9 dB + noise lowpass 800 Hz D50 -14 dB. | none | 2 / 400, player | -19.1 (plop) / -26.9 (whistle) |
| **nearCup** `{distance}` | Triangle 500 to 700 Hz over 120 ms, LP 2.5 kHz, A10 D120, `TUNE.nearCup` = -7 dB. Questioning "whoop?". | none | 1 / 500, player | -28.4 / -36.8 |
| **lipOut** `{speed}` | Sine 600 to 300 Hz over 60 ms, A1 D70, -10 dB; noise bandpass 2 kHz Q1 D15 -16 dB; rim tick at +50 ms: sine 400 to 250 Hz over 40 ms D40 -14 dB. Falling "skip", the opposite contour of nearCup. | +/-30 c | 2 / 300, player | -27.1 / -41.4 |
| **gimme** `{strokes}` | Square arpeggio C5 523 / E5 659 / G5 784 Hz at 0/70/140 ms, each A2 D60 S40 % hold 70 R80, LP 3 kHz, -9 dB. | none | 2 / 500, player | -15.0 / -22.8 |
| **sink** `{strokes, speed}`, rolled in | Plonk: sine 420 to 180 Hz over 90 ms D90 -5 dB; noise lowpass 1.5 kHz D20 -12 dB; rattle: square 1400/1200/1000 Hz at +30/+75/+110 ms D12 at -16/-19/-22 dB (LP 3 kHz). Chime: `note` G5 at +160 ms len 90 -9 dB, `note` C6 at +260 ms len 200 R250 -7 dB. | none | 2 / 200, player | -15.4 / -21.9 |
| sink after a gimme or on a levelComplete tick (`chime: false`) | Plonk + rattle only. | none | shared | -24.1 / -36.5 |
| **turnStart** `{playerId, sameAsBefore:false}` | Triangle C5 (P1) or G5 (P2), LP 2.5 kHz, A2 D140, `TUNE.turnDing` = -6 dB; walk whoosh: noise lowpass 1.2 kHz sweeping to 400 Hz over 200 ms, A30 D80 S30 % hold 120 R100, -26 dB. Never gated: the sim emits no `turnStart` while the intro card is up, and the first one after a restart / resume / join is the only hand-off cue. | none | 1 / 300, name | -27.8 / -37.1 |
| turnStart `{sameAsBefore:true}` (same player continues) | Whoosh only. | none | shared | -48.2 / -57.4 |
| **levelComplete** `{result.medal}` | All `note` at -4 dB (none: -8 dB), scheduled at event + 350 ms. gold: C5 E5 G5 C6 E6 at 0/100/200/300/450 ms, last note 600 ms with vibrato + sparkle noise highpass 6 kHz A20 D300 -22 dB at +450 ms. silver: C5 E5 G5 C6 at 0/110/220/330, last 450 ms. bronze: C5 E5 G5 at 0/120/240, last 450 ms. none: G4 392 Hz then C5 at 0/150, last 450 ms. Ducks music 4 dB for 1.3 s; suppresses bounces 1 s; `music.setMode('title')`. Skipped when `campaignComplete` is on the same tick. | none | 1 / 1000 | -11.7 / -17.8 gold, -12.3 / -18.2 silver, -12.7 / -18.5 bronze, -16.4 / -22.6 none |
| **campaignComplete** `{medal, totalStrokes}` | Chord stabs (triangle `note`, no sub, -14 dB, len 180 ms) at 0/220/440/660 ms: C4 E4 G4; F4 A4 C5; G4 B4 D5; C4 E4 G4. Melody `note` -5 dB: E5 at 900, G5 1020, C6 1140, G6 1568 Hz at 1300 ms held 700 ms with vibrato; sparkle noise highpass 6 kHz at 1300 ms D400 -20 dB. 2.4 s voice (last release ends 2.4 s). At event + 350 ms. Ducks music 2.4 s. | none | 1 / 2000 | -12.3 / -18.4 |
| **levelRestart** -> `uiBack` | Square 900 to 650 Hz over 50 ms, LP 3 kHz, A1 D40, -14 dB + sine 1300 Hz D8 -20 dB. Descending cousin of uiClick (also Back / cancel buttons). | none | 2 / 60 | -29.6 / -47.4 |
| **commandRejected** `{reason}` -> `uiInvalid` only when `reason !== 'turnDelay'` | Square 180 to 140 Hz over 80 ms, LP 1.2 kHz, D80 -10 dB; second bonk 160 to 120 Hz at +120 ms. Also for UI-side rejections (shoot on partner's turn online, bad room code). | none | 1 / 200 | -19.1 / -30.1 |
| uiClick (buttons) | Square 1100 Hz LP 4 kHz A1 D18 -14 dB + sine 2200 Hz D8 -18 dB. | none | 3 / 30 | -26.3 / -47.7 |
| uiHover (mouse enter, `:focus-visible` focus) | Sine 1500 Hz A1 D12 `TUNE.uiHover` = -24 dB. Never on touch. | none | 2 / 60 | -41.7 / -60.9 |
| uiPause | Square G5 then E5 at 0/80 ms, LP 3 kHz, D60/D100, -14 dB. | none | 1 / 200 | -23.5 / -34.1 |
| uiResume | Single square C5, LP 3 kHz, A2 D120 -14 dB + noise highpass 2.5 kHz D20 -16 dB click. Deliberately NOT the E5-G5 pair (that is partnerJoined's). | none | 1 / 200 | -30.5 / -42.5 |
| partnerJoined / partnerLeft (online) | `note` E5 len 100 then G5 len 220 R200 at -10/-9 dB (joined); G5 then E5 at -12/-11 dB (left). | none | 1 / 500 | -17.7 / -24.1, -19.9 / -26.2 |
| aimTick (power meter crosses a 10 % notch) | Triangle `600 + 900*power01` Hz A1 D12 `TUNE.aimTick` = -22 dB. | none | 2 / 35 | -40.6 / -60.8 |

`play(name, volume)` map (ARCH 1.10): hit -> ballHit(volume as power01, default 0.5); bounceSoft -> bounce(volume, 'grass',
default 0.3); bounceHard -> bounce(volume, 'dirtWall', default 0.7); sand -> enterSand; fan -> fanEnter; gateBlock ->
hazardBlock; bridge -> bridgeToggle(true); fall -> fellOffWorld; rest -> rollStop; levelWin -> levelComplete('gold');
campaignWin -> campaignComplete; turn -> turnStart(0); the rest map by name. For every sound except hit/bounce*, `volume`
is a 0..1 multiplier on the voice output.

Router rules (`handleEvents(events, delaySec = 0)`, 50 lines in the demo):

- `base = ctx.currentTime + delaySec`; each event is scheduled at `base + min(0.25, (ev.tick - events[0].tick) * DT)`.
  Two balls acting on different ticks of one frame keep their spacing; two on the same tick are both admitted because
  the retrigger key includes `playerId` (demo button "both balls fellOffWorld": two whistles).
- Bed mode is derived from what the sim actually emits, not from an intro flag: `playStart`, `turnStart` and
  `ballHit` all switch the bed to `play` (idempotent); `levelComplete` / `campaignComplete` switch it to `title`.
  `playStart` is emitted only when the intro card is dismissed - `restartLevel` (results-card Retry, pause-menu
  Restart) emits `levelRestart, levelStart{restarted:true}, turnStart` and goes straight to `aiming`, and a `?state=`
  resume or an online join mid-hole starts from a synthetic `levelStart` - so the first `turnStart`/`ballHit` after any
  of those must reopen play on its own. `levelStart` itself is silent. `turnStart` always dings (no `turnStart` is ever
  emitted while the intro card is up; its dismiss button has its own uiClick) and plays the whoosh only when
  `sameAsBefore` (partner sank, same player continues). Regression: `audio.test.ts` "audio follows the real sim
  through a hole restart".
- Hole-out de-duplication: `gimme` records `lastGimmeAt[playerId]`; a `sink` for the same player within 600 ms plays
  plonk + rattle only; a `sink` on the same tick as `levelComplete` or `campaignComplete` also skips its chime (the
  jingle resolves it). The full plonk + chime is reserved for a genuine rolled-in sink. `levelComplete` is skipped when
  `campaignComplete` is on the same tick.
- `levelComplete` / `campaignComplete` are scheduled at `at + 0.35` so the plonk finishes first, and switch the bed to
  `title` mode.
- `commandRejected` with `reason === 'turnDelay'` is silent (an eager Space during the 0.45 s hand-off is expected).
- `fan` is a one-shot entry sound; the loop is state-driven through `setFan()` from GameCanvas.

## 3. Mixing plan

| Stage | Default | Notes |
|---|---|---|
| master | volume 0.8 -> -8 dB | slider 0..1 -> `-40*(1-v)` dB, hard 0 at v=0; 1.0 = 0 dB |
| sfxBus | -6 dB | `SFX_BUS_DB` literal; `setBusDb()` is debug-only |
| musicBus | -15 dB | `MUSIC_BUS_DB` literal; 0 when music is off; ducks 4 dB under jingles |
| compressor | thr -12 dB, knee 6, ratio 4:1, 3 ms / 150 ms | load-bearing, see below |

Per-voice targets relative to the sfx bus (the `dB(x)` literals in the recipes): jingles -4, hero mechanic hits
(spring, bumper, sink, gimme) -2 to -5, shot -8..-1 by power, feedback (hazardBlock -7 under 50 % AM, fellOffWorld
whistle -12 under 35 % tremolo, uiInvalid -10) landing at -19..-22 dBFS peak, confirmations (switch, bridge, turnStart,
nearCup) -6..-12, bounces -18..-4 by strength, UI -14, hover / aim ticks -22..-24, fan loop -21..-15 by intensity.

**The compressor is not safety-only, and the numbers above are measured through it.** `createAudio({ compressor: false })`
renders the raw graph: uiClick -16.8 dBFS raw vs -26.3 through the chain (-9.5 dB), full-power ballHit -7.2 raw vs
-16.9 (-9.7 dB), gold jingle -15.7 raw vs -11.7 (+4.0 dB). Chrome/WebKit's `DynamicsCompressor` squashes short transients
by ~10 dB (3 ms attack on a peak detector with a 6 ms lookahead; that is the 6 ms latency the probes report) and applies
automatic makeup gain (~+4 dB on sustained content). Consequences: (1) it stays; without it the full-power shot is
-7.2 dBFS at volume 0.8 and +0.8 dBFS at volume 1.0, i.e. clipping; (2) anyone who replaces it must re-run
`audio_peaks2.mjs` and expect transients to rise ~10 dB and jingles to fall 4 dB; (3) at knee 6, gain reduction starts
at -15 dBFS so quiet sounds (< -20 dBFS) pass through only the makeup gain.

Measured balance at volume 0.8: loudest sound = gold jingle -11.7 dBFS peak / -17.8 RMS; full shot -16.9 / -31.8;
hero hits -15..-20; grass bounces -28..-34; music bed -29.3 peak / -37.2 RMS (12.4 dB under the shot peak, 17.6 dB under
the jingle); fan loop -28.3 at k=1. At volume 1.0 add 8 dB: worst case jingle -3.7 dBFS, no clipping. Sum-of-voices
worst case (jingle + music + two bounces) is about -8 dBFS at volume 1.0 and the compressor absorbs the rest.

**AM leakage probe** (`audio_lfo2.mjs`, latency-compensated, peak between release-end and oscillator stop; a gated
voice measures < -70 dBFS): hazardBlock -85.0 dBFS (v1: -17.4), fellOffWorld whistle -96.1 (v1: -19), fan loop after
`setFan(false)` -94.4, uiInvalid control -87.7. Steps at the hard stop are -89..-180 dB, i.e. no clicks.

Headroom policy: if a later level stacks more mechanics, lower `SFX_BUS_DB`, never the per-voice numbers. The four
fatigue-watch sounds (turnStart ding, nearCup, aimTick, uiHover, plus rollStop) are single literals in `TUNE` so each can
be pulled 6 dB in one edit.

## 4. How the levels were measured

All scripts live in `scratchpad/pw/` and run from there with the demo path as argument
(`node <script> ../design/FINAL/audio/audio-demo.html`):

- `audio_peaks2.mjs`: swaps `window.AudioContext` for a proxy over an `OfflineAudioContext` (44.1 kHz mono, `state`
  reported running, `currentTime` from a controllable fake clock), calls each `sfx.*` / `setFan(true, 1)` /
  `music.start(mode)`, renders and prints peak dBFS, loudest 50 ms RMS and audible length. Music cases step the fake
  clock 0.1 s every 55 ms so the catch-up clamp never fires. `NOCOMP` cases use `{ compressor: false }`. Re-run after
  any gain change; the table in section 2 is its output.
- `audio_check2.mjs`: default demo load, first gesture on the HUD mute button (asserts `locked -> on` with
  `isMuted() === false`, then a real toggle), clicks all 55 buttons, every `data-sfx` button twice, every router
  sequence, asserts zero page errors and that fan/music stop cleanly.
- `audio_lfo2.mjs`: the AM leakage probe above.
- `audio_music_dbg2.mjs`: per-second music peaks for title/play plus the `stall` and `hidden` scenarios (section 7).
- `audio_firstclick2.mjs`: DEFAULT autoplay policy (no flag). Result: the first trusted click's uiClick saw
  `state: 'running', ready: true`; `music.start('title')` issued before any gesture did not start (`playing: false`)
  and was running 300 ms after the gesture (`playing: true, mode: 'title'`), which is the App.tsx flow.
- `audio_types_probe.ts`: the section 1 surface + `declare global` + the `'interrupted'` comparison + usage lines;
  `tsc --noEmit --strict --lib dom,dom.iterable,es2020` (TypeScript 5.9.3, the project's) exits 0.

## 5. Autoplay / unlock strategy

- The `AudioContext` is created lazily in `unlock()`, called synchronously from capture-phase `pointerdown`, `keydown`
  and `touchend` listeners on `window` (installed once by `attachUnlock()` in `main.tsx`) and directly from the Title
  "Solo / Local 2P / Online" buttons, the Lobby "Start" button and the HUD mute button. `{ latencyHint: 'interactive' }`,
  `webkitAudioContext` fallback.
- `unlock()`: if `state !== 'running'`, set `pendingUntil = performance.now() + 1000`, call `resume().then(onRunning)`
  and, on the same call stack, start a 1-sample silent `AudioBufferSource` into `destination` (on iOS Safari the silent
  buffer is what opens the route; `resume()` alone is not enough on iOS 15/16 and neither works behind an `await`).
  `onRunning()` clears `pendingUntil`, detaches the gesture listeners, starts the bed if `settings.music && wantedMode`,
  and fires the `onReady` callbacks. The gesture listeners stay attached until the context actually reports running
  (the first touch can be a `touchstart` Safari does not honour).
- `visibilitychange -> visible` and `window 'focus'`: `resume()` if not running (iOS sets `'interrupted'` after a call,
  Siri or backgrounding; Chrome on Android suspends on tab switch), then `onRunning` restarts the bed if it was wanted.
  `visibilitychange -> hidden`: `music.setBackground(true)`; visible: `setBackground(false)`.
- Never `close()` the context; create it once per page. `dispose()` only clears timers, loops, listeners and master.
- HUD mute button has THREE states and the click acts on the state the player SAW, not on `audio.ready` at click time
  (the capture-phase unlock listener has already flipped `ready` by the time `click` fires):

  | state | when | glyph | `aria-label` / tooltip | click |
  |---|---|---|---|---|
  | `locked` | `!audio.ready` | speaker with a small spark/tap mark (NOT a crossed speaker) + text "Tap for sound" | "Enable sound" / "Tap for sound" | `audio.unlock()` + `uiClick`; no mute toggle |
  | `on` | ready, not muted | speaker with two waves | "Mute" / "Mute (M)" | `setMuted(true)` |
  | `muted` | ready, muted | speaker with an X | "Unmute" / "Unmute (M)" | `setMuted(false)` |

  In React: `const [locked, setLocked] = useState(!audio.ready); useEffect(() => audio.onReady(() => setLocked(false)), [])`;
  `onClick = locked ? () => { audio.unlock(); setLocked(false); } : onToggleMute`. The demo's `#hudMute` implements
  exactly this and `audio_check2.mjs` asserts it.
- iOS ringer (silent) switch mutes Web Audio in Safari (ambient category); cannot be bypassed. Settings shows one line
  on iOS only: "No sound? Check the ringer switch."
- Not yet exercised on a physical iOS device (nothing in this session can run Safari). First device run checklist:
  (1) first tap on Title produces the click AND starts the bed; (2) background + return resumes the bed without a burst
  (the catch-up clamp); (3) ringer note shows only on iOS.

## 6. Persistence: audio.ts is the single owner

`localStorage` keys, every read/write wrapped in try/catch (private mode, blocked storage, itch/Newgrounds iframes):

| Key | Values | Default |
|---|---|---|
| `flashgolf.audio.muted` | `'1'` / `'0'` | `'0'` |
| `flashgolf.audio.music` | `'1'` / `'0'` | `'1'` |
| `flashgolf.audio.volume` | `'0'..'1'` decimal string | `'0.8'` |

`audio.settings` is the readonly snapshot and `isMuted()` the accessor. `App.tsx` seeds its `muted` state from
`audio.settings.muted` and calls `audio.setMuted()` from `onToggleMute`; it never touches storage for audio. ARCH's
`loadMuted/saveMuted` under `fg.muted` in `src/app/storage.ts` must be dropped (section 9) so there is one key and one
reader; otherwise the HUD icon and the master gain disagree on first load.

Mute is a master-gain ramp to 0 over 50 ms (the context keeps running, so unmuting is instant and iOS does not drop the
route). HUD: one mute button (M key too). Settings: mute, music on/off, one volume slider. Nothing else user-facing;
`setBusDb()` is for mixing sessions. Online, each browser's settings are its own; nothing audio-related is on the wire.

## 7. Music: generative bed, default ON at -15 dB

Recommendation: ship the bed on by default, with the persisted toggle. Reasoning unchanged from v1 (a silent canvas with
blips reads as a tech demo; a Flash-era game is remembered by its idle hum) but the level is up 3 dB from v1 because the
measured v1 bed (-34 dBFS peak) was below what laptop speakers reproduce in a room. At -15 dB bus it measures -29.3 dBFS
peak / -37.2 dBFS 50 ms RMS at volume 0.8, 12.4 dB under the full shot's peak and 17.6 dB under the jingles. If the lead
prefers SFX-only by default (brief decision 11 allows it; ARCH's comment "off by default when muted" hints at it), the
flip is `music: false` in `loadSettings()` defaults; the toggle, ducking and scheduler are unaffected.

Specification (`music` object in the demo):

- Key C major, 84 BPM, 4/4. Progression Cmaj7 - Am7 - Fmaj7 - G6, two bars per chord, 16-bar cycle = 45.7 s, then it
  continues; there is no audible loop point because nothing is sampled and the melody is re-rolled.
- Scheduler: lookahead pattern on absolute `ctx.currentTime`. Foreground: `setInterval` 50 ms scheduling 0.15 s ahead.
  Hidden tab (`setBackground(true)`): 1000 ms interval, 2.5 s lookahead, so Chrome's >= 1 s timer throttling leaves no
  gaps while the partner alt-tabs; after 5 minutes hidden Chrome drops to one timer per minute and the bed will gap,
  which is acceptable (the player is away). Catch-up clamp at the top of `tick()`: if `nextBeat < currentTime - 0.25`,
  skip `ceil((currentTime - nextBeat) / BEAT)` beats and, if that crossed a chord boundary, start the new pad chord now.
  Missed beats are never stacked.
- Pad: for each chord tone (C4 E4 G4 B4 / A3 C4 E4 G4 / F4 A4 C5 E5 / G4 B4 D5 E5) two triangle oscillators detuned
  -7/+7 cents, plus a sine one octave below the root at 50 %, plus a shimmer sine on the chord's 5th in octave 5
  (G5 / E5 / C5 / D5, nothing above B5) at -14 dB relative to the chord tones with a multiplicative 0.3 Hz tremolo of
  depth 0.4. All through one lowpass 900 Hz Q0.7 whose cutoff drifts +/-200 Hz at 0.08 Hz. Voice gain -26 dB, attack
  1.2 s, release 1.5 s crossfaded into the next chord (via `holdAt`, never `gain.value`).
- Bass: sine at the chord root (C3 130.8, A2 110, F3 174.6, G3 196 Hz) on beats 1 and 3, A20 D1600, -20 dB.
- Plucks (`play` mode only): on every 8th note, probability 0.5 on beat 1 and 0.3 elsewhere, one note from the chord's
  pentatonic pool (Cmaj7: C5 D5 E5 G5 A5; Am7: C5 D5 E5 G5 A5; Fmaj7: C5 D5 E5 F5 A5; G6: D5 E5 G5 A5 B5), never the
  same note twice in a row, chosen with the audio RNG. Triangle through LP 2.4 kHz, A3 D320 -22 dB, plus a sine one
  octave up A3 D120 -32 dB. Bars 7-8 of every 8-bar phrase drop the probability to 0.08.
- Modes: `title` = pad + bass (Title, lobby, results); `play` adds plucks. Switching does not restart the scheduler.
- Non-fatiguing checklist: no percussion; about 1 pluck/s with rests; all timbres lowpassed below 2.5 kHz; no note
  above B5 (shimmer included now); 12-18 dB under SFX; G6 instead of G7 so the cycle never demands resolution; pad
  cutoff and tremolo are sub-0.5 Hz.
- Ducking: jingles pull the bus down 4 dB. Pause keeps the bed running (it is the pause menu's mood).
- Measured (`audio_music_dbg2.mjs`, per-second peaks dBFS): title -33.7 -29.5 -30.9 -32.0 -34.3 -36.5 -31.3 -29.3
  -30.0 -32.4 -33.6 -36.0; play -33.7 -29.5 -30.2 -32.3 -34.3 -33.3 -31.3 -29.3 -30.0 -32.4 -33.6 -36.0. `stall` (clock
  jumps 3 s at t = 5): -33.3 -35.2 -35.7 -40.2 -31.4 -30.7 around the jump, overall peak unchanged at -29.3, i.e. no
  burst. `hidden` (background mode, clock stepped 1 s per ~1 s): every second between -29.5 and -34.3, no gaps.

Who calls what: `App.tsx` calls `audio.music.start('title')` on mount and whenever it shows Title, Lobby, LevelResults
or CampaignResults; `handleEvents` switches to `play` on `playStart`, `turnStart` or `ballHit` (the sim emits no
`playStart` after a restart, `?state=` resume or online join) and back to `title` on `levelComplete` /
`campaignComplete`; `setMusic(false)` halts (0.6 s fade) but keeps `wantedMode` so `setMusic(true)` resumes in the right
mode; `unlock()` / visibility resume start the bed if it is wanted and not playing. Nothing else needs to call `music.*`.

Alternative if the owner prefers SFX-only: delete the `music` object, `duck()` and `musicBus` (about 100 lines);
`setMusic()` becomes a no-op and the Settings toggle hides.

## 8. Porting notes and who calls what

1. `src/view/audio.ts`: copy the `PORT BOUNDARY` block, add `export`, the section 1 types, the `declare global`, and
   `import { DT, MAX_POWER } from '../sim/types'` in place of the two local constants. Keep every gain a `dB()` literal.
2. `main.tsx`: `const audio = createAudio(); audio.attachUnlock(window);` once; pass it down as `GameCanvasProps.audio`.
3. `App.tsx`: seed `muted` from `audio.settings.muted`; `onToggleMute -> audio.setMuted(!audio.isMuted())`;
   `audio.music.start('title')` on mount and on every return to Title / results; `audio.onReady(...)` to flip the HUD
   from `locked`; `audio.dispose()` only on full unmount (tests), never between screens.
4. `GameCanvas.tsx`: per step `audio.handleEvents(r.events)` (local) or `audio.handleEvents(events,
   CLIENT_RENDER_DELAY_MS / 1000)` (online, so a bounce is heard when it is seen); once per frame
   `audio.setFan(active, k)` with `active = balls.some(b => !b.sunk && insideFanAABB(b.pos))` and
   `k = clamp01(1 - (ball.y - rect.y) / rect.h)` of the deepest such ball.
5. `ui/*`: `onClick -> audio.sfx.uiClick()` (Back / cancel -> `uiBack()`); `onPointerEnter={(e) => { if
   (e.pointerType === 'mouse') audio.sfx.uiHover(); }}`; `onFocus={(e) => { if (e.target.matches(':focus-visible'))
   audio.sfx.uiHover(); }}`; invalid actions -> `uiInvalid()`; Pause/Resume -> `uiPause()` / `uiResume()`; HUD mute
   button per section 5; Settings = mute + music + volume (`setVolume`).
6. `input/*`: `audio.sfx.aimTick(power01)` when `Math.floor(power01 * 10)` changes.
7. `net/GameClient.ts`: `partnerJoined()` / `partnerLeft()` on peer status changes; pass the render delay to
   `handleEvents` (item 4).
8. Vitest: `createAudio()` constructs and no-ops without `window.AudioContext` (jsdom): `ready === false`, every
   `sfx.*`, `play()`, `setFan()`, `handleEvents()` return without throwing; `loadSettings()` survives a throwing
   `localStorage`; `createAudio({ seed: 1 })` gives deterministic jitter; `handleEvents` with two `fellOffWorld` on one
   tick admits both (spy on `sfx.fellOffWorld` keyed calls); `sink` after `gimme` within 600 ms passes `chime: false`.

## 9. Contract requests to the lead (one line each)

1. `SfxName`: add `'uiHover' | 'uiInvalid' | 'uiPause' | 'uiResume' | 'partnerJoined' | 'partnerLeft' | 'aimTick'`.
2. `AudioSystem`: add `attachUnlock(target?)`, `onReady(cb): () => void`, `setVolume(v)`, `setFan(active, intensity01)`,
   `readonly settings`, `readonly ready`, `readonly sfx / fan / music` (ARCH's members are unchanged;
   `handleEvents` gains an optional `delaySec`).
3. `src/app/storage.ts`: drop `loadMuted/saveMuted` (`fg.muted`); audio.ts owns `flashgolf.audio.*`; Title/Hud/Pause/
   Settings keep their `muted` prop, seeded from `audio.settings.muted`.
4. `GameCanvas`: call `audio.setFan(...)` once per frame (item 4 above); `GameClient`: release events with the
   interpolation clock or pass `CLIENT_RENDER_DELAY_MS / 1000` as `delaySec`.
5. Settings.tsx: add one volume slider next to the mute + music toggles (no bus sliders).

## 10. Changes since v1 (against the critique)

| Required change | Done | Evidence |
|---|---|---|
| Adopt ARCH `AudioSystem` surface | `unlock/handleEvents/play/setMuted/isMuted/setMusic/dispose` exported verbatim; `onSimEvents` + `EventInfo` removed; the demo's `introVisible` gate dropped (it silenced every hand-off after a restart, resume or join - the sim emits no `playStart` there), bed mode derived from `playStart`/`turnStart`/`ballHit`; power normalised by `MAX_POWER` | `audio_types_probe.ts` compiles; `audio_check2.mjs` |
| Align router with real `SimEventBody` | `ev.result.medal`; `BounceSurface` mapping (dirtWall/levelEdge/ceiling woody, blocker clang, bridge tok); `fan` = one-shot `fanEnter`, loop via `setFan(active, k)`; `lipOut`, `gatePass`, `commandRejected` (not `turnDelay`), `sameAsBefore` whoosh-only, `levelRestart -> uiBack` | section 2; demo sequences |
| Fix the additive AM | `amStage()` multiplicative, in series before the envelope; fan loop uses it with a separate fade gain; hazardBlock/fellOffWorld/fan re-tuned (-7 / -12 / -21..-15) | leakage -85 / -96 / -94 dBFS (v1 -17 / -19) |
| Music never started in the app flow | `start()` always records `wantedMode`; `unlock()` -> `resume().then(onRunning)` starts it; same on visibility/focus; `pendingUntil` 1 s window; `focus` listener added; section 7 "who calls what" | `audio_firstclick2.mjs`: playing false before gesture, true after |
| Scheduler robustness | catch-up clamp (+ chord re-sync); hidden-tab mode 2.5 s / 1000 ms via `visibilitychange`, exposed as `setBackground()` | `audio_music_dbg2.mjs` stall / hidden rows |
| Single owner of mute | audio.ts owns the keys, exposes `settings` + `isMuted()`; request to drop `loadMuted/saveMuted`; three-state HUD button, locked click = unlock only | `audio_check2.mjs`: `locked -> on`, `isMuted() === false` after first click |
| Touch hover | `pointerType === 'mouse'` gate; focus variant only on `:focus-visible` | demo wiring, section 8 item 5 |
| Hole-out repetition | sink after gimme (600 ms, per player) and sink on a jingle tick = plonk only; `levelComplete` skipped on a `campaignComplete` tick; `uiResume` = single C5 + click | section 2 router rules; peaks row `sink[{chime:false}]` |
| Polyphony keyed by player; multi-tick scheduling | `admit(name, key, at)` with `name:playerId` keys; `at = base + tickOffset * DT` (cap 250 ms); sentinel-based slot release; jingles use `at + 0.35` | demo "both balls fellOffWorld" / "ticks 0 and 2" |
| Typecheck | `declare global` for `webkitAudioContext`; `OscOpts/NoiseOpts/NoteOpts/SfxOpts/FilterOpts/LfoOpts`; `createAudio({ seed, compressor })` | `tsc` exit 0 |
| Risks | music bus -15 dB (re-measured); compressor knee 6 + measured transient/makeup effect documented; `setTimeout` removed from voice bookkeeping and jingle delays; `delaySec` for online; shimmer octave/level and campaignComplete length fixed; Settings reduced to mute + music + volume; iOS checklist kept explicit; `TUNE` literals for the fatigue list | sections 3, 5, 7 |
