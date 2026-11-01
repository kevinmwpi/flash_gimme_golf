# Flash Golf audio design v2 (Web Audio API only, zero asset files)

Companion: `audio-demo.html` in this folder auditions every recipe below. Everything between the `PORT BOUNDARY`
comments in that file is the implementation of `src/view/audio.ts`; the page only adds buttons. Verification this round
(scripts in `scratchpad/pw/`, section 4): 55 buttons clicked, every `data-sfx` button clicked twice and all five router
sequences run with real `SimEvent` shapes, zero page errors; every sound rendered through an `OfflineAudioContext` for the
levels in section 2; the AM voices probed for envelope leakage (section 3); the music scheduler probed for stalls and
hidden tabs (section 7); the section 1 surface compiled with the project's `tsc` 5.9.3 under `--strict --lib dom`.

Section 10 lists what changed since v1 and why, item by item against the critique. Section 11 adds Worlds 2-3
(BUILD_DECISIONS D10.11): the trap, cannon, reset and skip voices, one bed per world and the fan-stop fix; it amends
sections 2, 3, 7 and 8 where it says so.

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

## 11. Worlds 2-3: traps, cannons, skipped turns, one bed per world (BUILD_DECISIONS D10.4, D10.11)

What World 2 (Lift & Lock) and World 3 (Sky Machines) add, in the same rules as sections 0-3: each device gets its
own timbre family, no failure sound is punishing, nothing new loops (a LIT cannon and an ARMED trap stay visual
only), and every fixed pitch, beds included, stays on the white-key set so the C-major cues never clash. Code:
`src/view/audio.ts`; tests: `src/view/__tests__/audio.test.ts` (11.5); measurements: 11.6.

Surface additions: `SfxName` and `Sfx` gain `trapCaught`, `trapFreed`, `trapReturn`, `cannonLoad`, `cannonFire`,
`turnSkipped(playerId)` and `flightTimeout` (`play(name)` maps each by name; `turnSkipped` plays red's note);
`MusicBed` gains `setTrack(world: WorldId)` and `readonly track: WorldId`; audio.ts exports `MUSIC_TRACKS` and the
`MusicTrack` type. No new persistence key, no new App or GameCanvas call.

### 11.1 New SFX

Same columns as section 2; peak / loudest-50-ms RMS dBFS at volume 0.8 through the shipped chain, measured as 11.6
says (a warmed compressor, so compare them with each other and with the re-measured existing sounds quoted here, not
with section 2's column).

| Event -> sfx | Recipe | Jitter | Poly, key | Peak / RMS |
|---|---|---|---|---|
| **trapCaught** (rest in armed jaws, or the trap re-armed around a resting ball) | "SNAP!", soft: no buzz, no falling minor interval. Snap: noise bandpass 2.6 kHz Q1.4 A1 D18 -14 dB. Jaw thunk: sine 190 to 95 Hz over 40 ms D50 -13 dB. Clink at +30 ms: sine E6 1318.5 Hz D140 `TUNE.trapClink` = -16 dB with sine C7 2093 Hz D80 at -22 dB; settle tick: sine E6 at +110 ms D60 -24 dB. | +/-25 c | 2 / 250, player | -22.3 / -33.2 |
| **trapFreed** (a release held, or the cup started holding one) | "FREE!". At the event: latch noise highpass 2.2 kHz Q0.7 D10 -14 dB; jaws swinging open, noise bandpass 1.5 to 4 kHz over 120 ms Q2 A5 D120 -20 dB; ring sine C7 at +10 ms D60 -22 dB. Chime: triangle E5 at +140 ms D80 -14 dB, then A5 at +220 ms D160 -13 dB (LP 3 kHz): the release plate's E4-A4 confirm one octave up, after it. | none | 2 / 200, player | -22.3 / -33.2 |
| trapFreed `{chime: false}` (on a sink or gimme tick) | Latch, swing and ring only. | none | shared | -22.3 / -41.6 |
| **trapReturn** (scoped reset, BACK +1) | The reverse of fellOffWorld's falling whistle: triangle 260 to 1040 Hz over 240 ms, LP 2.5 kHz, A10 D220 S50 % hold 240 R40, -12 dB, multiplicative tremolo 14 Hz depth 0.3. Pop of the ball reappearing at +280 ms (`popVoice`): sine 660 to 330 Hz over 40 ms D60 -12 dB + noise highpass 3 kHz D12 -18 dB. | none | 2 / 400, player | -20.7 / -29.2 (fellOffWorld -17.7 / -26.0) |
| **cannonLoad** (rest on a cold breech) | "LOADED!". Iron tok: sine 220 to 110 Hz over 50 ms D80 -10 dB + square 165 Hz LP 900 Hz D50 -18 dB. Two ratchet clicks: noise highpass 3 kHz D8 at +90 ms (-15 dB) and +150 ms (-17 dB). | +/-20 c | 2 / 250, player | -18.0 / -30.8 |
| **cannonFire** (a lit breech fires, on entry or the tick a loaded ball's cannon lights) | "BOOM!", its own low thoom, never the spring boing (the sim emits `cannonFire` instead of `spring`). Thoom: sine 120 to 42 Hz over 220 ms, A2 D320, -3 dB. Punch: triangle 240 to 90 Hz over 80 ms LP 1.2 kHz D90 -10 dB. Blast: noise lowpass 1.4 kHz to 250 Hz over 350 ms Q0.7, playbackRate 0.7, A2 D180 S25 % hold 200 R250, -8 dB. Smoke hiss at +120 ms: noise bandpass 700 Hz Q0.6, A60 D350 S30 % hold 400 R400, -24 dB. Nothing above about 3 kHz. At the event tick, no fuse delay (the BOOM! puff and shake land with it). | +/-30 c | 2 / 300, player | -12.2 / -19.3 (spring -9.6 / -18.6) |
| **turnSkipped** `{playerId}` (the waiting ball) | The skipped ball's own note, muffled, a gentle "not you": triangle C5 (red) or G5 (blue), LP 900 Hz, A2 D70, `TUNE.turnSkipped` = -12 dB. The shooter's ding follows 120 ms later (11.2). | none | 1 / 300, name | -22.5 / -34.6; note + ding -16.2 / -26.7 against the ding alone -16.0 / -26.7: it adds nothing to the hand-off's level |
| **flightTimeout** (the 30 s watchdog put a moving ball back on its safe spot, no penalty) | A soft puff, noise bandpass 900 Hz Q0.8 A10 D100 -18 dB, and the reappearing pop (`popVoice`) at +40 ms, -16 dB. Deliberately not trapReturn's warble, which means +1. The solver's loops pass proves the watchdog never fires on the shipped holes. | none | 2 / 400, player | -23.8 / -38.8 |

### 11.2 Router rules (additions to section 2)

- `routeEvent` is exhaustive: its `default` branch assigns the event to `never`, so an event type the sim adds fails
  `npm run typecheck` until it is routed or listed as silent. Silent on purpose: `levelStart`, `playStart`, and
  `bridgeToggle` for kinds outside the whitelist below.
- **Skipped turn.** The sim emits `turnSkipped` (the waiting ball) in the same tick as, and just before, the `turnStart`
  it explains, and that `turnStart` has `sameAsBefore: true` (the free ball shoots again). The router plays the skipped
  ball's muffled note at the event time and forces the shooter's ding `TURN_SKIP_LEAD_SEC` = 120 ms later. A
  `sameAsBefore` hand-off without a skip keeps World 1's whoosh-only rule (partner sank). Every skip sounds, as every
  skip shows the banner (D10.10).
- **BACK +1 lead.** A skip note or turn ding within `TRAP_RETURN_LEAD_SEC` = 350 ms after a `trapReturn` waits for its
  warble and pop (`handOffAt`). The lead is kept on the audio clock (`lastReturnAt`), not by tick, because a reset that
  changes a switch defers its `turnStart` to a later tick (ARCH R5, D10.5), often in the next frame (Bait: the reset
  ball leaves the BAIT plate and the door closes).
- **trapFreed on a hole-out tick.** When the cup starting to hold a release frees a ball, the `sink` / `gimme` on that
  tick carries the moment: trapFreed drops its chime and keeps its latch (the batch pre-scan `batchOf` collects the
  hole-out ticks and the skip ticks).
- **bridgeToggle whitelist.** The wooden slide is voiced only for rects that appear or vanish: `bridge`, `blocker`
  (doors) and `fan` (`SLIDE_KINDS`). The sim never emits `bridgeToggle` for a trap or a cannon (D10.4); the guard stays
  so a device state change can never play the slide. Their moments are trapCaught / trapFreed / cannonFire plus the
  plate's own confirm.
- **cannonFire timing.** A loaded ball fires one tick after its FIRE plate's `switchOn` (plates press on the presser's
  `ballRest` tick), so the thoom overlaps the switch confirm by design. Neither is delayed: online audio is aligned to
  render time with `delaySec` = 0.
- **Waiting is silent.** CAUGHT and LOADED sound once, when they begin; the HUD chip carries them from then on.
- **The fan stops when a game is left** (NEXT_STEPS #6). GameCanvas's loop `dispose()` calls `setFan(false, …)` (the
  intensity is ignored when stopping), and `setFan`'s stop path no longer waits for `ready()` (only the start does), so
  the stop also works while the context is suspended or interrupted (iOS after a call). Worlds 2-3 have no fans
  (LEVELS.md decision 5); the engine and tests still do.

### 11.3 Mixing and the fatigue watch

- Levels sit inside section 3's bands: the trap and skip cues at confirmation level (about -22 dBFS, under switchOn's
  -16.5), cannonLoad with the switches (-18), cannonFire a hero hit under the spring, trapReturn under fellOffWorld,
  flightTimeout the quietest of the teleports.
- Two new `TUNE` literals join the watch list: `turnSkipped: -12` (every skipped turn; Bait can hand the climber turn
  after turn) and `trapClink: -16` (every catch; most of Booby Trap's short lobs end in the snare). Either can be pulled
  6 dB in one edit without losing the moment (the banner and the ding carry a skip, the SNAP! callout a catch). Playtest
  watch: whether either grates by hole 9.
- Busy ticks, measured with real event batches: seat catch (rollStop + trapCaught + switchOn + door) -15.3 / -27.4;
  release by a plate (rollStop + switchOn + trapFreed with chime) -14.9 / -31.5; release by the cup (sink + switchOn +
  trapFreed without chime) -10.9 / -21.9, against World 1's sink + cup switch at -11.7 / -21.9; BACK +1 tick
  (trapReturn + switchOff + door + skip note + ding) -16.2 / -26.7; L10's chain reaction (rollStop + switchOn + bridge
  + cannonFire one tick later) -10.6 / -19.0. That chain is the loudest moment in the game, 1.1 dB above the gold
  jingle and 1.3 dB under the same chain with a spring (-9.3). At volume 1.0 it measures -4.1 dBFS, as does the release
  by the cup (the gold jingle -4.6): no clipping. Section 3's policy stands: if playtests find these hot, lower
  `SFX_BUS_DB`, never the per-voice numbers.

### 11.4 One bed per world

| World | Centre | Progression (2 bars each, 16-bar cycle) | BPM | Pad LP | Plucks (`play` mode) | Pluck odds: bar downbeat / other beats / resting bars, per 8th [on, and] | Plucks/s expected | Measured peak / RMS (title and play) |
|---|---|---|---|---|---|---|---|---|
| 1 Teach | C major | Cmaj7 - Am7 - Fmaj7 - G6 (section 7, unchanged) | 84 | 900 Hz | triangle LP 2.4 kHz D320 -22 dB + sine octave D120 -32 dB | [0.5, 0.5] / [0.3, 0.3] / 0.08 | 0.79 | -27.6 / -36.5 |
| 2 Lift & Lock | D Dorian | Dm7 - Em7 - Fmaj7 - G6: the bass climbs D-E-F-G, the lift | 96 | 800 Hz | square LP 1.8 kHz D180 -24 dB + sine octave D80 -34 dB, leaning on the offbeat 8th like clockwork: the lock | [0.25, 0.45] / [0.15, 0.45] / 0.08 | 0.81 | -26.9 / -35.4 |
| 3 Sky Machines | F | Fmaj7 - G6 - Em7 - Am7 (IV-V-iii-vi that never lands on C, so it floats) | 76 | 1100 Hz | triangle LP 2.2 kHz D600 -24 dB + sine octave D250 -30 dB, sparse and long | [0.45, 0.2] / [0.25, 0.15] / 0.05 | 0.47 | -28.1 / -36.8 |

Chords (pad tones; bass; shimmer; pluck pool), World 2: Dm7 D4 F4 A4 C5; D3; A5; C5 D5 F5 G5 A5. Em7 E4 G4 B4 D5; E3;
B5; D5 E5 G5 A5 B5. Fmaj7 F4 A4 C5 E5; F3; C5; C5 E5 F5 G5 A5. G6 G4 B4 D5 E5; G3; D5; D5 E5 G5 A5 B5. World 3: Fmaj7
F4 A4 C5 E5; F3; G5; C5 E5 G5 A5 B5. G6 G4 B4 D5 E5; G3; A5; D5 E5 G5 A5 B5. Em7 E4 G4 B4 D5; E3; B5; B4 D5 E5 G5 A5.
Am7 A3 C4 E4 G4; A2; E5; C5 D5 E5 G5 A5. World 1 is section 7's table.

- **White keys only.** Every pad, shimmer and pluck pitch is a white key at or below B5 and every bass a white key at or
  below 220 Hz, with no dominant 7th anywhere. The fixed cues are white keys (player notes C5 / G5, the switch E4-A4
  confirm, the gimme and sink chimes, the C-major jingles), so a bed in another key (D major's C#) would sour each of
  them. Tested as data.
- **Same budget and section 7 checklist on every track.** One scheduler reads the track at schedule time: 4 chords of 4
  pad tones (8 detuned triangles + sub + shimmer per chord), bass on beats 1 and 3, at most two plucks a beat, every
  timbre lowpassed below 2.5 kHz (the pad cutoff tops out at 1.3 kHz with its drift), no percussion, nothing above B5,
  sub-0.5 Hz modulation, and at most about one pluck a second on average (the table's expected rates; tested), 12-18
  dB under the SFX.
- **Who picks the track (amends section 7's "who calls what").** Every `levelStart` (createSim, a level change, a
  restart, a `?state=` resume's synthetic one, an online client's first) selects the hole's world in `trackBed`, before
  the ready() gate. The id is resolved with `hasLevel` + `levelById` (an unknown id, such as the tests' `'x'`, keeps the
  current track; loop.test.ts's registry mock provides both). Within a world it is a no-op, so one bed runs unbroken
  across a world's holes and its intro and results cards; the router's in-game mode changes (play on playStart /
  turnStart / ballHit, title on level or campaign complete) go through an internal path that never moves the track.
  The shell's existing `music.setMode('title')` (App, on every screen outside a game: Title, Lobby, rejoin) also returns
  the bed to World 1, the game's theme, so the Title and the Lobby always play World 1, and World 1's bed still flows
  from the Title into hole 1 without a restart.
- **Track change.** `setTrack(world)` while playing: `halt(TRACK_XFADE_SEC = 0.8)` fades the old pad (one booked but not
  yet sounding is cancelled outright, section 7's invariant) and `start()` restarts the beat clock on the new track's
  first chord in the same mode, whose pad's 1.2 s attack overlaps the fade. Bass and plucks the old track already booked
  (at most 150 ms ahead in a visible tab) ring out on their own decay. Before unlock, or with music off, the world is
  only recorded. Measured (11.6) on switches W1 to W2, W2 to W3, W3 to W1, W1 to W3 and W3 to the Title, 10 s into a
  bed: the 100 ms peaks go from the old bed's -34..-44 dBFS just before, to -32..-37 at the switch (the new bass
  onset over the fading pad), then the new bed's -29..-38 as its pad comes in. The loudest moment in the 3 s after any
  switch, -28.4, is under every bed's own steady peak (-26.9..-28.1): no burst.

### 11.5 Tests (`src/view/__tests__/audio.test.ts`)

- Every `SfxName` is admitted on its own, one voice each (played back to back, the names after the 24th hit
  `GLOBAL_MAX_VOICES`, so the old loop never exercised them); the name list is checked against `SfxName` both ways.
- Each device event reaches its own voice at the event time, keyed per ball (both balls on one tick sound twice); a
  cannon never plays the spring; the trapFreed chime and its sink / gimme suppression; the skip note then the forced
  ding at +120 ms (and no ding for a plain partner-sank continuation); the BACK +1 lead on the same tick and on a
  deferred tick in the next frame; the bridgeToggle whitelist; L10's chain keeps all four cues.
- The fan stops while the context is suspended, and still starts only on a running one.
- Track data: every bed pitch on the white-key set at or below B5, basses at or below 220 Hz, section 7's budget on
  every track, World 1 unchanged.
- Track choice: the shipped campaigns open on their world's bed (real sim, before unlock); a world chosen before unlock
  starts on its first chord; the crossfade (fade end, new first chord, mode kept, no hold before a first automation
  event); a switch before the first chord sounds cancels it; same-world and unknown ids leave the bed alone; in-game
  title keeps the world, the shell's title returns to World 1; music off only records; per world, the bass walks every
  other beat at the track's tempo on the sounding chord's root, and every pluck has the track's timbre, lands on a beat
  or its "and" and comes from the sounding chord's pool.
- The shipped devices through the real sim (crafted drops on the holes that introduce them, fed to `handleEvents` one
  step at a time as GameCanvas does): Booby Trap's catch, a skipped turn (the waiting ball's note, then the shooter's
  ding 120 ms later, from the real same-tick batch) and the release with its chime; Load & Fire's load, then the thoom
  the tick after the partner lands on FIRE, with no spring and no bridgeToggle anywhere.
- Mutation check (scratch copy): each of 24 one-line regressions in audio.ts, reverting one rule of this section, fails
  at least one test.

### 11.6 How 11.1-11.4 were measured

The real `src/view/audio.ts`, bundled with esbuild (IIFE), rendered in headless Chromium through an
`OfflineAudioContext` behind a proxied `window.AudioContext` (state running, a fake clock, `setInterval` captured so the
music scheduler is driven by hand every 50 ms of the fake clock): 44.1 kHz mono, volume 0.8, the shipped chain. SFX
and event batches are scheduled at t = 0.6 s, after the compressor has settled; at render start Chrome reads transients
2-4.5 dB lower, which is why section 2's column (render start, an earlier build) runs quieter than the warmed
re-measures here (spring -9.6 / -18.6, switchOn -16.5 / -32.0, hazardBlock -13.1 / -25.9, turnStart ding -16.2 /
-27.0; the gold jingle reads -11.7 / -17.8 both ways). Beds: 48 s per track and mode. Volume 1.0 checks use
`setVolume(1)`. The harness is a scratch tool, not in the repo, like section 4's scripts.
