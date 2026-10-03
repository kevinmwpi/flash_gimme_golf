# Flash Golf rebuild — architecture contracts (FINAL, revised after critique)

Companion files: `types.ts` (= `src/sim/types.ts`, verbatim), `protocol.ts` (= `src/net/protocol.ts`, verbatim),
`physics-notes.md`. Both `.ts` files type-check under `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
with `lib: ["ES2022"]` (no DOM), so they are importable from the server tsconfig unchanged and no tooling flag can
break them. The Decisions log (§10) lists every critique item and its resolution.

Every signature below is a contract. Build agents implement exactly these names; if a signature must change,
the owner of the file posts the change to the lead BEFORE depending on it, and the lead updates this document.

Numbers that matter everywhere: tick 60 Hz (`DT = 1/60`), viewport 1280x720, ball radius 12, gravity 620,
`SHOT_SPEED_PER_POWER = 6.8` (max range 746 px, max height 373 px), turn delay 27 ticks (0.45 s), gimme radius 34,
aim angle in `[-3.11, -0.03]` (4-dp exact), `DEFAULT_AIM = {angle: -0.7854, power: 55}`.

---

## 0. Dependency rule (enforced by ESLint `no-restricted-imports` + a vitest grep test)

```
sim/*            -> may import only from sim/*            (no DOM, no Date, no Math.random, no performance, no import.meta)
sim/levels/*     -> sim/types, sim/terrain, sim/levels/authoring
net/protocol.ts  -> sim/types only                       (no DOM, no node, no import.meta)
net/GameClient   -> net/protocol, net/wsUrl, sim/types, sim/serialize
view/*           -> sim/* (read-only), view/*
view/input/*     -> sim/types, sim/sim (allowedCommands, canControl, seatOf), view/view (screenToWorld)
ui/*             -> sim/types, sim/levels (LEVELS, WORLD1_IDS only — never level-id literals), view/audio (mute), net/GameClient types, ui/*
server/*         -> sim/*, net/protocol                   (never view/ui; never decodes a snapshot)
```
There is no `src/app/` directory. `storage.ts`, `url.ts`, `eventBus.ts` live under `src/ui/` (UI-owned).

---

## 1. Module APIs

### 1.1 `src/sim/types.ts`
See `types.ts`. Frozen. Exports the only rounding helpers (`quantize2`, `quantize4`, `quantize1`), `medalFor`,
`IMMEDIATE_SNAPSHOT_EVENTS`, `ReplayEntry`, and every constant. Shared constant objects are `Object.freeze`d.

### 1.2 `src/sim/rng.ts`
```ts
export function seedRng(seed: number): number;                 // normalises to uint32 (seed >>> 0)
export function rngNext(state: number): [next: number, value: number]; // mulberry32; value in [0,1)
export function rngInt(state: number, maxExclusive: number): [next: number, value: number];
```
Functional (no mutation) because `SimState.rng` is a plain number. Copy the current mulberry32 body verbatim.

### 1.3 `src/sim/terrain.ts` (pure geometry; constants only from types.ts)
```ts
export type Edge = { a: Vec; b: Vec; normal: Vec; kind: 'top' | 'side' | 'base' };
export type Collider =
  | { kind: 'terrain'; pieceIndex: number; edges: readonly Edge[]; piece: TerrainPiece }
  | { kind: 'rect'; rectIndex: number; rect: BridgeRect | BlockerRect | ColourGateRect };
export type Ground = {
  y: number; normal: Vec; slope: number; permanent: boolean;
  source: 'piece' | 'bridge' | 'blocker' | 'colourGate'; index: number;
};

export const vec: {
  add(a: Vec, b: Vec): Vec; sub(a: Vec, b: Vec): Vec; mul(a: Vec, s: number): Vec;
  dot(a: Vec, b: Vec): number; len(v: Vec): number /* Math.sqrt(x*x+y*y) — never Math.hypot */;
  normalize(v: Vec): Vec; dist(a: Vec, b: Vec): number;
};
export function clamp(v: number, lo: number, hi: number): number;

// ---- runtime queries (physics, sim) — ALL position-aware; see physics-notes §2 ----
/** Surface under the ball centre: smallest y among piece tops, ACTIVE bridge/blocker tops and wrong-colour gate
 *  tops whose x-range contains pos.x and whose y >= pos.y + BALL_RADIUS - GROUND_SEARCH_SLACK. null if none. */
export function groundAt(level: Level, switches: Readonly<Record<string, boolean>>, pos: Vec, playerId: PlayerId): Ground | null;
export function hasSupport(level: Level, switches: Readonly<Record<string, boolean>>, ball: Readonly<BallState>, playerId: PlayerId): boolean;
export function restsOnPermanentGround(level: Level, switches: Readonly<Record<string, boolean>>, pos: Vec, playerId: PlayerId): boolean;
export function inGap(level: Level, x: number): boolean;
/** Edges of a piece: top polyline (outward normals), right side, base, left side. Cached per piece object (WeakMap). */
export function pieceEdges(piece: TerrainPiece): readonly Edge[];
export function pointInPiece(piece: TerrainPiece, p: Vec): boolean;   // ray-cast point-in-polygon
export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec;
export function isRectActive(rect: LevelRect, switches: Readonly<Record<string, boolean>>): boolean; // no switchId => true
export function activeRects(level: Level, switches: Readonly<Record<string, boolean>>): readonly LevelRect[];
/** bit i = level.switches[i] pressed. */
export function switchMaskOf(level: Level, switches: Readonly<Record<string, boolean>>): number;
/** Solid colliders for a switch state: terrain pieces + active bridge/blocker/colourGate rects.
 *  Cached per (level object, switchMask) in a WeakMap<Level, Map<number, readonly Collider[]>>. */
export function solidColliders(level: Level, switches: Readonly<Record<string, boolean>>): readonly Collider[];
/** `solidColliders` minus the colour gate matching this player. */
export function collidersFor(colliders: readonly Collider[], playerId: PlayerId): readonly Collider[];
/** Distance from the ball's bottom point to the cup rim centre. */
export function distanceToCup(level: Level, pos: Vec): number;

// ---- authoring-only queries (compileLevel / validateLevel; never called by physics) ----
/** LOWEST (largest y) terrain-piece surface at x = the fairway. null inside a gap. */
export function surfaceYAt(level: Level, x: number): number | null;
export function surfaceYOnPiece(piece: TerrainPiece, x: number): number | null;
export function surfaceSlopeAt(level: Level, x: number): number;       // of the fairway piece, |dy/dx|
/** Ball centre on the fairway at x, quantize2'd. Throws if x is in a gap (levels are validated). */
export function placeOnSurface(level: Level, x: number): Vec;
```

### 1.4 `src/sim/physics.ts`
```ts
export type BallContext = {
  level: Level; switches: Readonly<Record<string, boolean>>; playerId: PlayerId;
  colliders: readonly Collider[];           // collidersFor(solidColliders(level, switches), playerId), computed once per tick by stepSim
};
export type StepBallOut = { events: SimEventBody[] };

/** Launch velocity for an aim. speed = power * SHOT_SPEED_PER_POWER. The ONLY place sin/cos are used in sim/. */
export function launchVelocity(aim: Aim): Vec;

/**
 * Advance ONE ball by one tick (DT). Mutates `ball` (callers pass a spread copy) and assigns NEW Vec objects to
 * pos/vel/lastRest. Pushes event bodies into `out.events`. See physics-notes §3 for the exact step order.
 * Returns the strokes to add to THIS BALL'S OWNER (0, FALL_PENALTY, or 1 for a gimme).
 */
export function stepBall(ball: BallState, ctx: BallContext, out: StepBallOut): number;

/** Pressed state for every switch from the balls' CURRENT contact (after all balls stepped); uses groundAt. */
export function evaluateSwitches(level: Level, previous: Readonly<Record<string, boolean>>, balls: readonly Readonly<BallState>[]): Record<string, boolean>;

/** true when the ball no longer needs stepping for turn purposes (asleep or sunk). */
export function isSettled(ball: Readonly<BallState>): boolean;

/**
 * Aim preview: runs the REAL stepBall on scratch copies of the shot ball AND the other balls, re-evaluating
 * switches every scratch tick exactly as stepSim does, for up to `maxTicks` (default 150) or until the shot ball
 * rests/sinks/falls. Returns one point per tick plus the first ground contact ("landing"). Never emits events.
 * Used by view/render/aim.ts, by the level solver and by levels-solver.test.ts.
 */
export function predictShot(
  level: Level, switches: Readonly<Record<string, boolean>>, ball: Readonly<BallState>, playerId: PlayerId, aim: Aim,
  otherBalls: readonly Readonly<BallState>[], maxTicks?: number,
): { points: Vec[]; landing: Vec | null; outcome: 'rest' | 'sink' | 'gimme' | 'fell' | 'running' };
```

### 1.5 `src/sim/sim.ts`
```ts
export function createSim(config: SimConfig): StepResult;     // phase 'intro', levelIndex 0, events [levelStart]; ball literal in physics-notes §6
export function stepSim(state: SimState, commands: readonly PlayerCommand[]): StepResult; // never mutates `state`
export function levelOf(state: SimState): Level;              // levelById(state.levelId)
export function activeBall(state: SimState): Readonly<BallState>;
export function teamStrokes(state: SimState): number;         // players[0].strokes + players[1].strokes
export function campaignPar(state: SimState): number;         // sum of par over config.levelIds (NOT named coursePar: that is levels/index.ts)
/** The human seat that owns a slot: solo => 0 for both slots; local/online => the slot itself. */
export function seatOf(config: SimConfig, playerId: PlayerId): PlayerId;
export function isHost(config: SimConfig, seat: PlayerId): boolean;        // seat === 0
export function canControl(config: SimConfig, seat: PlayerId, slot: PlayerId): boolean; // seatOf(config, slot) === seat
export function allowedCommands(state: SimState, seat: PlayerId): PlayerCommandType[];  // phase x role table below
export function isShotReady(state: SimState): boolean;        // phase==='aiming' && turnDelayTicks===0
export function nextLevelId(state: SimState): string | null;

/** Replay contract: commands applied at exactly entry.tick (array order within a tick); entries sorted by tick. */
export function runReplay(config: SimConfig, log: readonly ReplayEntry[], untilTick: number): { state: SimState; events: SimEvent[] };
```
`runReplay` = `createSim(config)` then `for t in 0..untilTick-1: stepSim(state, log.filter(e => e.tick === t).map(e => e.cmd))`
(implemented with a cursor, not a filter). It is what the replay tests, the server==local equivalence test and
`scripts/solver.ts` consume.

Rules implemented by `stepSim` (in this order each tick; `phaseAtStart = state.phase`, `switchesAtStart = state.switches`):
1. Apply commands in array order. For each `cmd`: `seat = seatOf(config, cmd.playerId)`; the command is accepted iff
   `allowedCommands(state, seat)` contains `cmd.type` AND (for `setAim`/`shoot`) `cmd.playerId === state.activePlayer`.
   Rejections emit `commandRejected` (local debug only; never on the wire) with reason `wrongPhase` /
   `notActivePlayer` / `turnDelay` / `notHost`.
   - `setAim`: `angle = quantize4(clamp(angle, AIM_ANGLE_MIN, AIM_ANGLE_MAX))`, `power = quantize1(clamp(power, MIN_POWER, MAX_POWER))`,
     stored on `players[activePlayer].aim` (no new object when unchanged).
   - `shoot`: requires `isShotReady`; `balls[p].vel = launchVelocity(aim)`, `asleep=false`, `restTicks=0`, `grounded=false`,
     `strokes += 1`, phase `flying`, emits `ballHit{angle, power, speed}`.
   - `continue`: intro -> aiming (`playStart`, `turnStart{readyInTicks: 0, sameAsBefore: false}`, `turnDelayTicks = 0`);
     levelResults -> next level's intro (`levelStart`) or `campaignResults` (+ `campaignComplete`). A second `continue`
     arriving in the new phase is a harmless `wrongPhase` rejection (idempotent "first wins").
   - `restartLevel`: allowed in intro/aiming/flying/levelResults; rebuilds the level state (balls at starts per
     physics-notes §6, switches all false, strokes 0, aims `DEFAULT_AIM`, `activePlayer = levelIndex % 2`), phase
     `aiming` with `turnDelayTicks = TURN_DELAY_TICKS`; emits `levelRestart` + `levelStart{restarted:true}` +
     `turnStart{readyInTicks: 27}`. `campaign` (completed levels) is kept.
2. If phase is `aiming` or `flying`: `colliders = solidColliders(level, switchesAtStart)`; step EVERY non-sunk ball
   (`stepBall` on a spread copy with `collidersFor(colliders, i)`), add each returned stroke delta to `players[i]`
   (the ball's owner), then `switches = evaluateSwitches(level, switchesAtStart, balls)` -> diff -> `switchOn/Off` +
   `bridgeToggle` for every rect whose `isRectActive` changed (permanent rects never toggle). Rect activation
   changes take effect next tick (deterministic one-tick latency). `switchesChanged = diff non-empty`.
3. Phase transitions: in `aiming`, if any ball is not settled (support vanished, fan woke it, respawn) -> `flying`.
   In `flying`, when every ball is settled AND `!switchesChanged`: if both sunk -> push `LevelResult`, phase
   `levelResults`, emit `levelComplete`; else next active = other slot if not sunk, else same slot;
   `turnDelayTicks = TURN_DELAY_TICKS`; phase `aiming`; emit `turnStart{readyInTicks: TURN_DELAY_TICKS, sameAsBefore}`.
4. `if (phaseAtStart === 'aiming') turnDelayTicks = max(0, turnDelayTicks - 1)`. The transition tick therefore
   leaves 27 observable; the first full aiming tick makes it 26. `tick += 1`.
5. Every number in the new state passes `Number.isFinite` (unconditional; throws otherwise).

Allowed-command table (`seat` = the human; host = seat 0 in every mode; in solo seat 0 owns both slots):

| phase            | setAim / shoot                                             | continue     | restartLevel |
|------------------|------------------------------------------------------------|--------------|--------------|
| intro            | –                                                          | either seat  | host         |
| aiming           | seat owning `activePlayer` (shoot needs turnDelayTicks = 0) | –            | host         |
| flying           | –                                                          | –            | host         |
| levelResults     | –                                                          | either seat  | host ("Retry hole") |
| campaignResults  | –                                                          | –            | –            |

Who goes first: `activePlayer = levelIndex % 2` at every level start (alternates red/blue).
There is NO `start` command: `createSim` begins in `intro`; starting is a UI action (local) / `start` protocol
message (online); "play again" is a fresh `createSim` (local) or `playAgain` (online).

### 1.6 `src/sim/serialize.ts`
```ts
export class SerializeError extends Error {}
export function encodeSnapshot(state: SimState): SimSnapshot;           // pos/vel via quantize2, angle quantize4, power quantize1 (all from types.ts)
export function decodeSnapshot(snap: unknown, config: SimConfig): SimState; // validates shape+ranges; throws SerializeError
export function isSimSnapshot(v: unknown): v is SimSnapshot;
export function encodeConfig(config: SimConfig): SimConfigSnap;
export function decodeConfig(v: unknown): SimConfig;                    // validates level ids exist in the registry
export function toBase64Url(json: string): string;                      // manual table; runs in Node 22 and browsers
export function fromBase64Url(s: string): string;
export function encodeShareLink(state: SimState): string;              // base64url(JSON ShareLinkPayload)
export function decodeShareLink(param: string): { config: SimConfig; state: SimState }; // throws SerializeError
export function buildShareUrl(base: string, state: SimState): string;   // `${base}?state=${encodeShareLink(state)}`
```
Invariants (tested): `encodeSnapshot(decodeSnapshot(encodeSnapshot(s), cfg))` deep-equals `encodeSnapshot(s)`; and
for any state in which both balls are settled, `decodeSnapshot(encodeSnapshot(s))` deep-equals `s`, because the sim
itself stores only `quantize2` positions at rest, `quantize4`/`quantize1` aims, `quantize2` tee/sunk positions,
and the aim bounds are 4-dp exact (`-3.11`, `-0.03`).

Size (measured, JSON, level 2 mid-flight): 145 bytes; worst case (4 campaign entries, 6 switches, 4-digit
coordinates, full-precision velocities) 211 bytes. Share link payload ≈ 261 bytes JSON ⇒ ≈ 348 chars base64url.

### 1.7 `src/sim/levels/authoring.ts` and `src/sim/levels/index.ts`
```ts
// authoring.ts — compile-time helpers (run at module load; pure)
export type PropDef =
  | { kind: 'sand'; id: string; x1: number; x2: number; label?: string }
  | { kind: 'spring'; id: string; centerX: number; w?: number; launch: Vec; label?: string }
  | { kind: 'bumper'; id: string; centerX: number; w?: number; label?: string }
  | { kind: 'fan'; id: string; x: number; y: number; w: number; h: number; force?: number; switchId?: string; activeWhen?: boolean }
  | { kind: 'colourGate'; id: string; centerX: number; w?: number; h: number; colour: GateColour }
  | { kind: 'bridge'; id: string; gap: Gap; switchId: string; thickness?: number }
  | { kind: 'blocker'; id: string; centerX: number; w?: number; h: number; switchId?: string; activeWhen?: boolean; label?: string };
export type SwitchDef = { id: string; centerX: number; w?: number; colour: string; label?: string };
export type LevelDef = Omit<Level, 'rects' | 'switches' | 'hole' | 'starts' | 'height' | 'mechanicsPresent'> & {
  props: PropDef[]; switches: SwitchDef[]; holeX: number; startXs: [number, number];
};  // includes id, name, world, order, par, hint, aha, watchOut, mechanicsIntroduced, width, wind, terrain
export function terrainPiece(points: [number, number][], baseY: number): TerrainPiece;
export function compileLevel(def: LevelDef): Level;   // resolves surface-relative y via surfaceYAt (fairway), quantize2 on switch.surfaceY / hole.rimY / starts / bridge y; height = 720; derives mechanicsPresent
export function validateLevel(level: Level): string[]; // [] when valid; messages otherwise (used by the test)

// index.ts
export const LEVELS: readonly Level[];                 // world 1 in order
export const WORLD1_IDS: readonly string[];
export function levelById(id: string): Level;         // throws on unknown id
export function hasLevel(id: string): boolean;
export function coursePar(levelIds: readonly string[]): number;
export function campaignFrom(levelId: string): readonly string[];   // WORLD1_IDS.slice(indexOf(levelId)); throws on unknown
export function worldTitle(world: WorldId): string;   // 'World 1 — Teach'
```
One file per level: `w1-01-*.ts` … `w1-04-*.ts`, each `export const level: Level = compileLevel({...})`. Level-id
literals exist ONLY in these files and `index.ts`; the UI and storage use `WORLD1_IDS` / `LEVELS` (grep-tested).

`validateLevel` rules (every one has a test row in §4):
- `height === 720`, `1280 <= width <= MAX_LEVEL_WIDTH`, `wind === 0` for world 1, `par >= 3`,
  non-empty `name`, `hint`, `aha`, `watchOut`; `mechanicsIntroduced.length === 1`; `mechanicsPresent` equals the set
  of kinds actually present (switches ⇒ 'switch'); every kind in `mechanicsIntroduced` is in `mechanicsPresent`.
- Each piece: `surface` strictly increasing x, length >= 2, `baseY > max surface y`.
- Pieces overlapping in x: for every x in the overlap either STACKED (`|upper.baseY - lowerSurfaceY(x)| <= STACK_SEAM_TOLERANCE`)
  or OVERHANG (`lowerSurfaceY(x) - upper.baseY >= OVERHANG_MIN_CLEARANCE` = 48); mixed/other ⇒ error.
- Gaps: no piece covers any x in `(g.x1, g.x2)`; some piece ends exactly at `g.x1` and some piece starts exactly at `g.x2`.
- Tees, plates, cup: on the fairway (lowest piece at x, which must not be a stacked upper piece), slope <= `RESTABLE_MAX_SLOPE`,
  not in a gap, not inside any fan AABB; tees >= `MIN_TEE_SEPARATION` apart.
- Every `switchId` on a rect resolves to a switch; a switch referenced by nothing is an error.
- Bridge: `x === gap.x1`, `w === gap.x2 - gap.x1`, top within `BRIDGE_LIP_TOLERANCE` of both lips.
- Blockers/colour gates: bottom within 2 px of the fairway, `h >= MIN_WALL_HEIGHT`.
- Spring: `launch` finite, `launch.y < 0`, `len(launch) <= MAX_BALL_SPEED`; warn (not fail) when `launch.x === 0`.
- Sand/spring/bumper x-ranges not in gaps and not overlapping each other.
- All rect ids unique; all switch ids unique; ids kebab-case.

### 1.8 `src/view/view.ts`
```ts
export type CameraMode = 'follow' | 'overview';
export type Camera = { x: number; y: number; zoom: number };              // world->screen: (p - cam) * zoom
export type InputDevice = 'keyboard' | 'pointer' | 'touch' | 'gamepad';
export type Particle = { pos: MutVec; vel: MutVec; life: number; maxLife: number; size: number; colour: string; gravity: number };
export type GolferAnim = { pos: MutVec; facing: 1 | -1; walkFrom: Vec; walkT: number; swingT: number; bobT: number };
export type Callout = { id: number; text: string; worldPos: Vec | null; colour: string; bornAt: number; ttl: number; kind: 'gimme'|'sink'|'oob'|'turn'|'hazard'|'nearCup'|'switch' };
export type RenderBall = { pos: MutVec; squash: number; sinkT: number; visible: boolean; snapNextFrame: boolean };
export type AimPreview = { points: Vec[]; landing: Vec | null; outcome: string; playerId: PlayerId; remote: boolean };
export type ViewState = {
  level: Level;
  camera: Camera; cameraTarget: Camera; cameraMode: CameraMode; userCameraOverride: boolean;
  shake: { amp: number; t: number };
  particles: Particle[];
  trails: [Vec[], Vec[]];
  golfers: [GolferAnim, GolferAnim];
  renderBalls: [RenderBall, RenderBall];
  padAnims: Map<string, number>;        // rectId -> seconds since triggered (spring squash, bumper pulse)
  switchAnims: Map<string, number>;     // switchId -> 0..1 pressed depth
  rectAnims: Map<string, number>;       // bridge/blocker slide-in 0..1
  callouts: Callout[];
  aimPreview: AimPreview | null;
  lastDevice: InputDevice;
  timeSec: number;                      // view clock for wobble/clouds (never fed to the sim)
};
export function createViewState(level: Level, state: SimState): ViewState;
/** Apply a tick's events (particles, shake, callouts, trails, pad/switch/bridge anims, golfer walk).
 *  Sets renderBalls[p].snapNextFrame on fellOffWorld / sink / gimme (after the hop) / levelStart / levelRestart. */
export function applySimEvents(view: ViewState, events: readonly SimEvent[], state: SimState): void;
/** Per-frame: interpolate balls (prev->next by alpha) unless snapNextFrame (then copy next and clear the flag),
 *  tween camera, age particles/callouts, advance golfer anims. Sunk balls are never interpolated. */
export function updateView(view: ViewState, prev: SimState, next: SimState, alpha: number, dt: number): void;
export function setCameraMode(view: ViewState, mode: CameraMode, user: boolean): void;
export function worldToScreen(view: ViewState, p: Vec): Vec;   // logical 1280x720 space
export function screenToWorld(view: ViewState, p: Vec): Vec;
export function cameraFor(level: Level, state: SimState, mode: CameraMode): Camera; // follow: active ball at 45% width, y fixed 0, zoom 1; overview: zoom = min(1280/width, 1), centred, y so the ground sits at ~70% height
```
View code may use `Math.random()`, `performance.now()` freely. It must never write to `SimState`.

### 1.9 `src/view/render/*`
```ts
// render/index.ts
export type RenderScene = { state: SimState; view: ViewState; seat: PlayerId | null; device: InputDevice; showAim: boolean /* ANY aim: local or partner's */ };
export function renderFrame(ctx: CanvasRenderingContext2D, scene: RenderScene): void; // assumes ctx transform = logical 1280x720
// render/palette.ts
export const THEME: { sky: [string, string]; hills: string[]; grass: string; grassDark: string; dirt: string; dirtDark: string; outline: string; sand: string; spring: string; bumper: string; fan: string; bridge: string; blocker: string; cupDark: string; flag: string; red: string; blue: string };
export const OUTLINE_WIDTH = 3;
// render/world.ts
export function drawSky(ctx: CanvasRenderingContext2D, view: ViewState): void;              // gradient + clouds + parallax hills, full viewport, BEFORE camera transform
export function drawTerrain(ctx: CanvasRenderingContext2D, level: Level): void;             // flat dirt fill, constant-thickness grass cap (14 px), outlines; overhang pieces get the cap too
export function drawCup(ctx: CanvasRenderingContext2D, level: Level, flagWobble: number): void;
// render/mechanics.ts
export function drawRect(ctx: CanvasRenderingContext2D, rect: LevelRect, active: boolean, anim: number, switchColour?: string): void; // inactive bridge/blocker = dashed ghost in switch colour; permanent blocker = dirt-wall style
export function drawSwitch(ctx: CanvasRenderingContext2D, sw: PressureSwitch, pressed01: number): void;
// render/entities.ts
export function drawBall(ctx: CanvasRenderingContext2D, playerId: PlayerId, ball: RenderBall): void;
export function drawGolfer(ctx: CanvasRenderingContext2D, playerId: PlayerId, anim: GolferAnim, isActive: boolean, isLocal: boolean): void;
export function drawTrail(ctx: CanvasRenderingContext2D, playerId: PlayerId, trail: readonly Vec[]): void;
// render/effects.ts
export function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void;
// render/aim.ts
/** Dots stop at the landing marker; drawn in PLAYER_COLOURS[preview.playerId], globalAlpha 0.55 when preview.remote. Power bar lives in the React HUD. */
export function drawAim(ctx: CanvasRenderingContext2D, ball: Vec, aim: Aim, preview: AimPreview, device: InputDevice, ready: boolean): void;
```
No HUD text on canvas. On-object labels (SAND, BOING, FAN, switch letters) are allowed and are drawn with
`fillText` + `strokeText` outline, 18 px display font.

### 1.10 `src/view/audio.ts`
```ts
export type SfxName = 'hit' | 'bounceSoft' | 'bounceHard' | 'sand' | 'spring' | 'bumper' | 'fan' | 'gateBlock' | 'gatePass' | 'switchOn' | 'switchOff' | 'bridge' | 'fall' | 'rest' | 'nearCup' | 'lipOut' | 'gimme' | 'sink' | 'levelWin' | 'campaignWin' | 'turn' | 'uiClick' | 'uiBack' | 'partnerJoined';
export type AudioSystem = {
  unlock(): void;                                  // call on first user gesture (title button)
  handleEvents(events: readonly SimEvent[], nowMs: number): void; // maps SimEvent -> SfxName (+ volume from strength); switchOn/Off/bridgeToggle debounced per switchId (>= 150 ms); bounce debounced 40 ms per ball
  play(name: SfxName, volume?: number): void;
  setMuted(muted: boolean): void; isMuted(): boolean;      // persisted in localStorage 'fg.muted'
  setMusic(on: boolean): void;                             // optional 8-bar loop at -18 dB; off by default when muted
  dispose(): void;
};
export function createAudio(): AudioSystem;      // safe without AudioContext (no-op) for tests/SSR
```
All sounds are synthesized (oscillator + envelope + optional noise buffer). No asset files.

### 1.11 `src/view/input/*`
```ts
// input/index.ts
export type UiAction = 'pause' | 'toggleCamera' | 'toggleMute' | 'confirm' | 'back';
export type InputContext = {
  state: SimState;
  seats: readonly PlayerId[];             // seats this browser controls: solo [0]; local [0,1]; online [seat]
  view: ViewState;                        // for screenToWorld
  canvasRect: DOMRect;                    // CSS box of the canvas for pointer->logical mapping
  dt: number;                             // seconds since last poll
  nowMs: number;
};
export type InputFrame = { commands: PlayerCommand[]; uiActions: UiAction[]; device: InputDevice; dragging: boolean };
export type InputSystem = {
  attach(canvas: HTMLCanvasElement): void; detach(): void;
  poll(ctx: InputContext): InputFrame;    // once per animation frame
  /** Live integrated local aim for the active slot when a local seat controls it (local echo); null otherwise. */
  localAim(): Aim | null;
  setEnabled(enabled: boolean): void;     // false while a React overlay has focus
};
export function createInputSystem(): InputSystem;
// input/keyboard.ts  — keys by `event.code` (layout independent): ArrowLeft/KeyA, ArrowRight/KeyD, ArrowUp/KeyW, ArrowDown/KeyS, Space/Enter shoot, Escape pause, Tab camera, KeyM mute
export function createKeyboard(): DeviceAdapter;
// input/pointer.ts — Pointer Events (mouse + touch unified), drag-to-aim slingshot
export function createPointer(): DeviceAdapter;
// input/gamepad.ts — navigator.getGamepads() polled each frame
export function createGamepad(): DeviceAdapter;
export type DeviceAdapter = {
  attach(canvas: HTMLCanvasElement): void; detach(): void;
  /** Produces aim/shoot/ui intents for the frame; `aim` is absolute (adapter integrates rates itself). */
  poll(ctx: InputContext, currentAim: Aim): { aim?: Aim; shoot?: boolean; ui: UiAction[]; active: boolean; dragging?: boolean };
};
```
`poll` composes adapters: the adapter that produced input most recently sets `device` (drives hint copy). Gameplay
commands are stamped with `playerId = state.activePlayer` only when `canControl(config, seat, state.activePlayer)`
for some seat in `ctx.seats`; otherwise no gameplay commands are produced (partner's turn). `setAim` is emitted
only when the quantised aim (`quantize4`/`quantize1`) changed since the last emitted one, at most once per frame,
and always BEFORE a `shoot` produced in the same frame.

### 1.12 `src/view/GameCanvas.tsx`
```tsx
export type LocalSession = { kind: 'local'; config: SimConfig; initial: StepResult; seats: readonly PlayerId[] };
export type OnlineSessionView = { kind: 'online'; client: GameClient; config: SimConfig; seat: PlayerId };
export type GameCanvasProps = {
  session: LocalSession | OnlineSessionView;
  paused: boolean;                          // local only: stops stepping (online ignores)
  onUiAction(action: UiAction): void;       // pause/mute/camera -> App
  onFrame(summary: FrameSummary): void;     // throttled (10 Hz) HUD data
  onEvents(events: readonly SimEvent[]): void; // for React callouts (ui/eventBus.ts)
  audio: AudioSystem;
  externalCommands: React.RefObject<PlayerCommand[]>; // commands from React overlays (continue, restartLevel), stamped playerId 0 locally; drained each frame
  hudRef: React.RefObject<HTMLElement>;     // GameCanvas writes CSS custom properties on it every frame (see below)
};
export default function GameCanvas(props: GameCanvasProps): JSX.Element;
export type FrameSummary = { phase: SimPhase; tick: number; activePlayer: PlayerId; turnReady: boolean; strokes: [number, number]; aim: Aim; device: InputDevice; cameraMode: CameraMode; levelId: string; seatIsActive: boolean; paused: boolean };
```
GameCanvas owns: canvas sizing/letterboxing (DPR, `matchMedia` for DPR changes, `ResizeObserver` on the parent),
the fixed-step loop (§2), the `ViewState`, the `InputSystem`, and the `renderFrame` call. React never re-renders per
frame; HUD updates arrive through `onFrame` (10 Hz) and `onEvents`. **Power meter at full frame rate**: while
`dragging || phase === 'aiming'`, GameCanvas sets `--power` (0..1 = `(power - MIN)/(MAX - MIN)`), `--angle-deg`
and `--aim-ready` ("0"/"1") as CSS custom properties on `hudRef.current.style` every frame; `Hud.tsx` renders the
bar with `width: calc(var(--power) * 100%)` so no React render is needed.

### 1.13 `src/ui/*` (React; DOM only; all text here)
```tsx
Title.tsx           props { bests: Record<string, LevelBest>; onSolo(levelId): void; onLocal(levelId): void; onOnline(): void; muted; onToggleMute }   // level strip from LEVELS; selected tile => campaign = campaignFrom(levelId)
Lobby.tsx           props { client: GameClient; status: ClientStatus; lobby: LobbyState | null; onBack(): void }  // create/join/invite; start-hole picker (host) via client.setLevel; auto-join once from ?room=
Hud.tsx             props { summary: FrameSummary; level: Level; seat: PlayerId | null; mode: SimMode; online?: { roomCode; peerConnected; rttMs }; muted; onPause; onToggleMute; onToggleCamera; device; hudRef }
Callouts.tsx        props { bus: EventBus }   // 'GIMME!', 'IN THE HOLE!', 'OUT OF BOUNDS +1', 'So close!', "Blue's turn", toasts "Blue teed off" / "Red restarted the hole"
Pause.tsx           props { isHost; mode; onResume; onRestart (confirm step inside); onQuit (confirm when online); muted; onToggleMute; device hints; watchOut: string (the "Stuck?" tip) }
LevelIntro.tsx      props { level; levelIndex; total; firstPlayer; onContinue; firstRun: boolean (onboarding hint); autoAdvanceMs: number | null }   // shown while FrameSummary.phase === 'intro'
LevelResults.tsx    props { result: LevelResult; next: Level | null; onContinue; onRetry (host only); canRetry; autoAdvanceMs: number | null }      // shown while phase === 'levelResults' (after the 1.2 s banner)
CampaignResults.tsx props { results: LevelResult[]; coursePar; total; medal; onPlayAgain; onTitle }   // shown while phase === 'campaignResults'
Settings.tsx        props { muted; onToggleMute; music; onToggleMusic; device hints toggle }
OnboardingHint.tsx  one-time (localStorage 'fg.onboarded') drag/keys hint on the first level
```
- Overlays are driven by `FrameSummary.phase` (and by `ClientStatus`/`joined{sync}` on reconnect), never by an event
  alone: the `levelComplete` event only starts the 1.2 s "IN THE HOLE!" banner that precedes the results card.
- `src/ui/eventBus.ts`: `export type EventBus = { push(events: readonly SimEvent[]): void; subscribe(fn: (e: SimEvent) => void): () => void }`,
  `createEventBus()`; `GameCanvas.onEvents` pushes into it; `Callouts` subscribes.
- `src/ui/storage.ts`: `loadBests(): Record<string, LevelBest>`, `saveBest(levelId, teamStrokes, medal)`,
  `LevelBest = { teamStrokes: number; medal: Medal; at: number }`, `loadMuted/saveMuted`, `loadOnboarded/saveOnboarded`
  — every call wrapped in try/catch; keys are validated against `hasLevel` on load (unknown ids dropped).
- `src/ui/url.ts`: `readRoomParam()`, `readStateParam()`, `clearParams(['room','state'])` via `history.replaceState`.
- `src/App.tsx`: screen state machine `title | lobby | game`, builds sessions, mounts `GameCanvas` + overlays.
  `onSolo/onLocal(levelId)` ⇒ `config.levelIds = campaignFrom(levelId)`.
- Brief §26 (UI-owned): `index.html` carries `<title>Flash Golf — co-op golf for two</title>`, `<meta name="description">`,
  Open Graph `og:title/og:description/og:image` (`public/og.png` 1200x630 placeholder), `<link rel="icon" href="/favicon.svg">`,
  `<meta name="theme-color" content="#50b7ff">`; `vercel.json` serves them for `?room=` links.
- No competitive copy anywhere ("opponent", "Scoreboard", "Winner" are grep-tested out of `src/ui`).

### 1.14 `src/net/GameClient.ts`
```ts
export type ClientStatus =
  | { kind: 'idle' }
  | { kind: 'connecting'; attempt: number }
  | { kind: 'waiting'; code: string; inviteUrl: string; peerConnected: boolean; lobby: LobbyState }     // host in lobby
  | { kind: 'joined'; code: string; peerConnected: boolean; lobby: LobbyState }                          // guest in lobby
  | { kind: 'playing'; code: string; seat: PlayerId; paused: boolean; peerConnected: boolean }
  | { kind: 'reconnecting'; code: string; attempt: number }
  | { kind: 'closed'; reason: RoomCloseReason | 'left' | 'serverUnreachable' | 'timeout'; message: string }
  | { kind: 'error'; code: ErrorCode | 'BAD_SNAPSHOT'; message: string; recoverable: boolean };
export type InterpolatedState = { state: SimState; prev: SimState; alpha: number; snap: boolean };
export class GameClient {
  constructor(opts: { url: string; name?: string; connectTimeoutMs?: number /* 8000 */; now?: () => number /* performance.now */ });
  subscribe(listener: (s: ClientStatus) => void): () => void;
  getStatus(): ClientStatus;
  createRoom(): Promise<void>;                      // idempotent: closes any previous socket first
  joinRoom(code: string): Promise<void>;
  tryReconnect(): Promise<boolean>;                 // uses sessionStorage 'fg.reconnect' = {code, token, seat}
  setLevel(levelId: string): void;                  // host, lobby
  start(levelIds?: string[]): void;                 // host
  playAgain(): void;
  /** setAim is held and coalesced to <= LIMITS.setAimPerSecond (latest wins). shoot/continue/restartLevel FIRST FLUSH
   *  the held setAim, then send immediately, so the server always sees aim-then-shoot in order. */
  sendCommand(cmd: PlayerCommand): void;
  leave(): void;                                    // sends leaveRoom, closes with intentional flag (no error surfaced)
  getConfig(): SimConfig | null;
  /** Render-delayed pair of decoded snapshots (see §2.2). `snap` = true when this frame is a discontinuity. */
  interpolated(nowMs: number): InterpolatedState | null;
  /** Events of every buffered snapshot whose serverTime <= renderTimeMs (release in order; each at most once). */
  drainEvents(renderTimeMs: number): SimEvent[];
  renderTime(nowMs: number): number;                // nowMs + clockOffset - CLIENT_RENDER_DELAY_MS
  rttMs(): number;                                  // EMA from ping/pong every 2 s
}
```
- A `SerializeError` from `decodeSnapshot` sets status `error{code:'BAD_SNAPSHOT', recoverable:false}` and stops
  the socket; it never throws into the RAF loop.
- `src/net/wsUrl.ts`: `getWsUrl(): string | null` — `import.meta.env.VITE_WS_URL` or same-origin `/ws` on localhost;
  `null` when online is unavailable (UI hides online buttons with an inline note).

### 1.15 `server/rooms.ts` and `server/index.ts`
```ts
// rooms.ts (no `ws` import of the class; sockets are an interface so tests can fake them)
export type SocketLike = { send(data: string): void; close(code?: number, reason?: string): void; terminate(): void; readyState: number; isAlive: boolean; ip: string; bufferedAmount: number };
export type Slot = { socket: SocketLike | null; token: string; name: string; disconnectedAt: number | null; sentEventIndex: number };
export type Room = {
  code: string; createdAt: number; lastInboundAt: number;
  slots: [Slot, Slot | null];
  lobby: LobbyState;
  sim: SimState | null; config: SimConfig | null;
  accUnits: number;            // integer, units of 1/60 ms (TICK_UNITS_PER_MS); one tick = TICK_UNITS_PER_TICK
  lastTickAt: number; paused: boolean;
  pending: PlayerCommand[];    // ONE ordered queue; an incoming setAim REPLACES the last unsent setAim from the same slot IN PLACE
  events: SimEvent[]; eventBase: number;   // events[k] has absolute index eventBase + k; trimmed past min(sentEventIndex)
  ticksSinceSnapshot: number; dirty: boolean; immediate: boolean;
  autoContinueAt: number | null;           // intro/levelResults auto-advance deadline (online only)
};
export class RoomManager {
  constructor(opts: { now?: () => number /* monotonic ms; performance.now */; random?: () => string /* token source */; log?: (msg: string) => void });
  handleOpen(socket: SocketLike): void;
  handleMessage(socket: SocketLike, raw: string): void;   // parseClientMessage -> dispatch; never throws
  handleClose(socket: SocketLike): void;                  // starts reconnect grace or closes the room
  tickAll(nowMs: number): void;                           // called every 8 ms by index.ts; per-room accumulator
  heartbeat(): void;                                      // every LIMITS.heartbeatMs: ping / terminate
  shutdown(): void;                                       // roomClosed{serverShutdown} to everyone
  stats(): { rooms: number; sockets: number; playing: number };
}
// index.ts
//   createServer: GET /  -> 200 "ok" (Fly health), GET /healthz -> JSON stats
//   WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayloadBytes, perMessageDeflate: false })
//   upgrade handler: path === '/ws' && originAllowed(req.headers.origin) else 403
//   ALLOWED_ORIGINS env (comma list; entries may contain `*`, e.g. https://flash-golf-*.vercel.app) default:
//     https://flash-golf.vercel.app, https://flash-golf-*.vercel.app, http://localhost:5173, http://127.0.0.1:5173
//   client ip: `fly-client-ip` header when present, else first X-Forwarded-For hop, else socket address
//   setInterval(() => rooms.tickAll(performance.now()), 8); setInterval(() => rooms.heartbeat(), LIMITS.heartbeatMs)
//   process.on('SIGTERM') -> rooms.shutdown(); server.close()
//   process.on('uncaughtException') -> log + continue (last resort; tick bodies are already try/caught per room)
//   PORT from env (8080 on Fly), HOST 0.0.0.0
```

---

## 2. Game loop

### 2.1 Local (solo / local 2P) — in `GameCanvas.tsx`
```
let sim: SimState, prev: SimState = sim, acc = 0, last = performance.now()
const pending: PlayerCommand[] = []                   // PERSISTS across frames (fixes dropped commands on 120/144 Hz displays)
frame(now):
  frameDt = min((now - last)/1000, 0.25); last = now
  if (!paused) acc += frameDt
  const frameIn = input.poll(ctx)                     // ONE poll per frame
  enqueue(pending, externalCommands.current.splice(0)); enqueue(pending, frameIn.commands)
      // enqueue: a setAim replaces the last pending setAim for the same slot IN PLACE (order vs shoot preserved)
  handleUi(frameIn.uiActions)
  let first = true
  while (acc >= DT):
    prev = sim
    const r = stepSim(sim, first ? pending : EMPTY); if (first) { pending.length = 0; first = false }
    sim = r.state
    view.applySimEvents(r.events, sim); audio.handleEvents(r.events, now); onEvents(r.events)
    acc -= DT
  const alpha = acc / DT                              // 0..1 for ball interpolation
  updateView(view, prev, sim, alpha, frameDt)
  view.aimPreview = aimPreviewFor(sim)                // see below
  renderFrame(ctx, { state: sim, view, seat, device, showAim: view.aimPreview !== null })
  writeHudVars(hudRef, localAim ?? sim.players[sim.activePlayer].aim, isShotReady(sim))   // every frame
  throttle(10 Hz) -> onFrame(summary)
```
- `aimPreviewFor(sim)`: when `sim.phase !== 'aiming'` ⇒ null. Otherwise `p = sim.activePlayer`; `aim = input.localAim()`
  if a local seat controls `p` (remote = false), else `sim.players[p].aim` (remote = true);
  `predictShot(level, sim.switches, sim.balls[p], p, aim, [sim.balls[1-p]])` memoised on
  `angle|power|switchMask|balls[0].x|y|balls[1].x|y`; result tagged `{ playerId: p, remote }`.
- Pause: `paused` freezes `acc` (no steps) but `pending` keeps accumulating (setAim coalesced) so a `continue` pressed
  on the overlay is applied on the first step after resume. The loop keeps rendering.
- Tab hidden: `visibilitychange` resets `last` so the 0.25 s clamp drops the gap instead of fast-forwarding.

### 2.2 Online — same loop body with substitutions
- Steps are replaced by `const interp = client.interpolated(now)`; `prev = interp.prev; sim = interp.state; alpha = interp.alpha`;
  when `interp.snap` every `renderBalls[i].snapNextFrame = true`.
- `input.poll` output: `commands` go to `client.sendCommand` (setAim coalesced to 30/s, flushed before shoot/continue/restart).
  Local echo: `localAim()` drives the preview and the HUD power bar immediately; the server's aim arrives later for the partner,
  whose client shows the arc from `sim.players[activePlayer].aim` (remote preview, 55 % alpha).
- `const events = client.drainEvents(client.renderTime(now))` → `applySimEvents/audio/onEvents` — events are released
  at the SAME render time as the ball positions of their snapshot (they are buffered per snapshot in the ring).
- Interpolation: ring of the last `SNAPSHOT_RING_SIZE` (8) decoded snapshots with their `serverTime`. Clock offset =
  EMA of `serverTime - (clientRecvTime - rtt/2)`. Render time `T = now + offset - CLIENT_RENDER_DELAY_MS`;
  find `a.serverTime <= T < b.serverTime`. **Discontinuity** when `b.serverTime - a.serverTime > SNAPSHOT_GAP_DISCONTINUITY_MS`
  (150 ms) OR `b.immediate` OR any `IMMEDIATE_SNAPSHOT_EVENTS` event in `b.events`: hold `a` (alpha 0) until `T >= b.serverTime`,
  then snap to `b` (`snap: true` on that frame). Otherwise `alpha = (T - a.serverTime)/(b.serverTime - a.serverTime)`.
  If no `b` (stall), extrapolate balls with `vel` for at most `MAX_EXTRAPOLATION_MS`, then hold. Only ball positions
  are interpolated; every other field comes from `b` (or `a` if `b` missing). Sunk balls snap.
- The ring and event buffer are CLEARED on every `start` and `joined{sync}`; `sync.serverTime` seeds the first entry.
- The pause overlay online does NOT pause the sim; it shows "Game continues — your turn still counts" copy.

### 2.3 Event flow
`stepSim` → events[] → (1) `view.applySimEvents` (particles, shake, callouts, trails, anims, snap flags),
(2) `audio.handleEvents` (debounced), (3) `GameCanvas.onEvents` → `ui/eventBus` → `Callouts`. Overlays
(`LevelIntro`, `LevelResults`, `CampaignResults`) are mounted from `FrameSummary.phase`; the `levelComplete` event
only starts the 1.2 s "IN THE HOLE!" banner that delays the results card. Online, events are buffered per snapshot
and released by `drainEvents(renderTime)` so SFX/particles never lead the visuals.

---

## 3. Determinism and floating-point rules (sim/)
1. `src/sim/**` imports only from `src/sim/**`. Test `sim-purity.test.ts` greps every file under `src/sim` for
   `Math.random`, `Date.`, `performance.`, `window`, `document`, `navigator`, `setTimeout`, `import.meta`,
   `Math.hypot`, `Math.pow`, `**`, `toFixed` and fails on any hit.
2. `stepSim` and `stepBall` depend only on their arguments. No module-level mutable state (WeakMap caches of
   derived geometry/colliders are allowed because they are pure functions of immutable level objects + switchMask).
3. Numbers only through the constants in `types.ts`; no literal physics numbers elsewhere (reviewed by grep).
   `SERVER_TICK_RATE` is a re-export of `TICK_RATE`.
4. Iteration order is always array order (`level.switches`, `level.rects`, `balls`). `Record<string, boolean>`
   switch state is only read by key, never iterated for rules (`switchMaskOf` iterates `level.switches`).
5. No `Array.prototype.sort` without an explicit comparator; no `Object.keys` driving rules.
6. Every number written into `SimState` passes `Number.isFinite` — unconditional, every tick (a failure throws).
7. Arithmetic hygiene: only `+ - * /`, `Math.sqrt`, `Math.round/floor/ceil/abs/min/max` in integration and collision;
   `vec.len` is `Math.sqrt(x*x + y*y)`; `Math.sin/cos/atan2` only inside `launchVelocity` (sim) and `view/input`;
   per-tick damping is a multiply, never a power. The ONLY rounding helpers are `quantize2/4/1` from `types.ts`.
8. Rest positions, aims and compiled level y-values are quantised with those helpers, so a settled state is
   lossless through `encodeSnapshot/decodeSnapshot`.
9. Online clients never run `stepSim` (floating point across engines); the server is the only sim instance and it
   never decodes a snapshot. Local mode and the server use the same `stepSim`; `runReplay` + the RoomManager
   equivalence test (§4) prove the two paths are the same.
10. The seed is injected via `SimConfig`; `rng` is only advanced by rules (currently none), never by cosmetics.
11. Node is pinned (`.nvmrc` 22, `engines`), and the committed golden lives in its own `it(...)` so an engine
    change is recognisable as such.

---

## 4. Test plan (vitest; `vite.config.ts` gets `test: { include: ['src/**/__tests__/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'], environment: 'node' }`)

SIM tests use hand-written `Level` literals from `src/sim/__tests__/fixtures.ts` (SIM-owned: `flatLevel`,
`cliffLevel`, `gapBridgeLevel` with two plates, `blockerLevel`, `overhangLevel`, `gateLevel`, `sandSpringBumperLevel`)
so SIM never depends on LEVELS' files; tests on the real levels belong to LEVELS.

| file | owner | asserts |
|---|---|---|
| `src/sim/__tests__/sim-purity.test.ts` | SIM | grep rule (§3.1 incl. hypot/pow/**/toFixed); `types.ts` exports every constant listed in this doc; no level-id literal outside `src/sim/levels/` |
| `src/sim/__tests__/contract.test.ts` | SIM (lead writes the stub) | imports every module in §1 and asserts `typeof export === 'function'` for every contracted name |
| `src/sim/__tests__/replay.test.ts` | SIM | `runReplay(cfg, log, 2000)` twice on fixtures ⇒ `JSON.stringify(encodeSnapshot(final))` identical; the same log split into two `runReplay` calls (0..1000 then continuing with `stepSim`) ⇒ identical; golden string for the fixture log in its own `it`; `continue` at tick 0 then `shoot` at tick 1 vs both at tick 1 produce DIFFERENT states (proves ticks matter) |
| `src/sim/__tests__/turns.test.ts` | SIM | createSim ⇒ intro, activePlayer 0, `turnDelayTicks` 0; `continue{playerId:1}` from seat 1 (local mode) accepted; in solo `continue{playerId:1}` maps to seat 0 and is accepted; `restartLevel{playerId:1}` in local ⇒ rejected `notHost`; `setAim{playerId:1}` while activePlayer 0 ⇒ `notActivePlayer` even in solo; shoot during turnDelay rejected `turnDelay`; after rest the OTHER slot becomes active and the FIRST observable state has `turnDelayTicks === 27`, the next tick 26; when one ball is sunk the same slot continues; both sunk ⇒ levelResults + `levelComplete`; `restartLevel` in levelResults (host) ⇒ aiming with strokes 0 and `campaign` kept; levelIndex 1 starts with activePlayer 1; last level ⇒ campaignResults + `campaignComplete`; a second `continue` after the phase changed ⇒ `wrongPhase` and no state change |
| `src/sim/__tests__/switches.test.ts` | SIM | ball resting on a plate ⇒ pressed next tick, `switchOn` once; rolling across a plate presses and releases (`switchOff` the tick it leaves); bridge appears exactly when `activeWhen` matches; a ball parked on a bridge FALLS the tick after the holder leaves and respawns at `lastRest` with +1 credited to the FALLING ball's owner; blocker with switchId vanishes while held; permanent blocker (no switchId) never emits `bridgeToggle`; a ball resting on TOP of a blocker/wrong-colour gate stays asleep for 600 ticks (no wake loop); a ball resting under an overhang stays asleep for 600 ticks; a switch-driven fan activating under a parked ball wakes it; the tick a switch changes never also emits `turnStart`; solo (seat 0) can hold with ball 0 and cross with ball 1 |
| `src/sim/__tests__/physics.test.ts` | SIM | no tunnelling: 28 phase offsets x speeds {600, 900, 1100} dropped on a 16 px bridge, on terrain and against an overhang base ⇒ never below/inside; energy bound: 600 ticks on bumper/spring ⇒ `len(vel) <= MAX_BALL_SPEED`, `y >= CEILING_Y`; 300 px/s roll on flat grass stops after 400–700 px; rest never on slope > 15°; 70° face starts rolling; cliff: never inside, `pointInPiece` false every tick; wrong colour bounces + `hazardBlock`, right colour passes + `gatePass`; sand: landing with vy 400 ⇒ vOut 0 (restitution decided before bounce), 300 px/s roll stops within 150 px; `predictShot` points equal a real shot's positions for 150 ticks exactly on `sandSpringBumperLevel` AND on `blockerLevel` where the shot lands on a plate that opens the blocker; `groundAt` under an overhang returns the fairway |
| `src/sim/__tests__/cup.test.ts` | SIM | crossing at 200 px/s sinks (+`sink`), at 400 px/s lips out (`lipOut`, vx × 0.8); rest 20 px from the cup ⇒ `gimme`, strokes +1 to that ball's owner; 60 px ⇒ `nearCup`, no stroke; `d = 34.0` ⇒ gimme (inclusive); 1100 px/s crossing is detected (swept) |
| `src/sim/__tests__/serialize.test.ts` | SIM | round-trip idempotence; `decodeSnapshot(encodeSnapshot(s))` deep-equals `s` for every settled state of the fixture replay, including one with the aim clamped to `AIM_ANGLE_MIN`; size ≤ 260 bytes; share link ≤ 600 chars; rejects wrong version, NaN, out-of-range phase, unknown level id, bad switch mask, non-tuple, angle outside `[-3.11, -0.03]`; legacy base64 GameState ⇒ `SerializeError` |
| `src/sim/__tests__/levels.test.ts` | LEVELS | for every real level: `validateLevel(level)` is `[]` (all rules in §1.7); ids unique, kebab-case, match filenames and `WORLD1_IDS` order; `mechanicsIntroduced` is exactly one of `IntroducedMechanic` and the four levels introduce four DIFFERENT ideas in the campaign order the level agent fixed; `watchOut/hint/aha` non-empty; `par >= 3`; `wind === 0`; golden replay of the level agent's solution logs on the real levels (SIM's `runReplay`) in its own `it` |
| `src/sim/__tests__/levels-solver.test.ts` (slow; `npm run test:levels`) | LEVELS | `scripts/solver.ts` (beam search over `runReplay`/`predictShot` with `otherBalls`) at `SHOT_SPEED_PER_POWER`: co-op solvable within `par + 3`; NOT solo-bypassable where the level introduces switch/colourGate: with the other ball parked at its tee, 0 of the 16x8 shot grid reach the cup; bridge level: 0 sinks with the switch unheld |
| `src/net/__tests__/protocol.test.ts` | NET | `parseClientMessage` accepts every documented shape, REBUILDS objects (extra `junk` key absent from the result), rejects: unknown type, `held: 123` on a known type's cmd is stripped, oversized frames, codes with O/0/I/1, angle 0.5, angle -3.1116, power 101, NaN, duplicate `levelIds`, 17 level ids, non-integer protocol; `parseServerMessage` rejects a snapshot whose `snap[0] !== SNAPSHOT_VERSION` |
| `server/__tests__/rooms.test.ts` (FakeSocket, `now` injected) | NET | `createRoom` before `hello` ⇒ `BAD_MESSAGE` (and 5 of them ⇒ closed 1008); create ⇒ `roomCreated` + token + lobby; second `createRoom` ⇒ `ALREADY_IN_ROOM`; join bad code ⇒ `ROOM_NOT_FOUND`; third join ⇒ `ROOM_FULL`; guest `setLevel`/`start` ⇒ `NOT_HOST`; `start` with an unknown/duplicate level id ⇒ `BAD_MESSAGE`; start without guest ⇒ `PEER_MISSING`; start ⇒ both get `start{sync}` with identical snapshots and `sync.serverTime`; `tickAll` with 50 ms elapsed ⇒ exactly 3 sim ticks (integer units: 3000/1000); 400 ms ⇒ capped at 15 ticks; guest `shoot` on host's turn ⇒ `NOT_YOUR_TURN`; guest `setAim` on host's turn ⇒ silently dropped (no frame sent); `setAim` then `shoot` from the active slot in one tick ⇒ the shot uses the NEW aim (`ballHit.angle`); valid shoot ⇒ a snapshot on the SAME tick with `immediate: true` and `ballHit`; snapshots every 3 ticks while flying, 1/s when idle; a socket with `bufferedAmount` 100 KB skips a snapshot and the next one it receives carries ALL missed events (cursor); guest close ⇒ host gets `peerLeft{graceMs:60000}` + `paused`; host close in LOBBY(2) ⇒ guest gets `peerLeft{disconnected}` WITHOUT `paused`, expiry ⇒ `roomClosed{peerTimeout}`; rejoin with token ⇒ `joined{sync}` + `peerReconnected` + unpaused and `lastTickAt` reset (a 60 s pause then resume produces 0 catch-up ticks); wrong token ⇒ `BAD_TOKEN`; 10 min idle ⇒ destroyed; non-JSON ⇒ `BAD_MESSAGE`; 41 messages in 1 s ⇒ `RATE_LIMITED`; room cap ⇒ `SERVER_FULL`; intro auto-continue after 4 s and results auto-continue after 12 s; `stats()` after everything ⇒ `{rooms:0, sockets:0, playing:0}` |
| `server/__tests__/equivalence.test.ts` | NET | the fixture replay log fed to a RoomManager (FakeSocket pair, `command` frames delivered at synthetic timestamps so each lands in its entry's tick, `tickAll` driven in 1000-unit steps) ⇒ final `snapshot.snap` deep-equals `encodeSnapshot(runReplay(config, log, N).state)` — the only test that proves server path == local path |
| `src/view/__tests__/input-pointer.test.ts` (jsdom) | INPUT+LOOP | drag math: press at ball, move 110 px to the lower-left ⇒ angle = -PI/4 (quantised -0.7854), power **55** (= 10 + 110/220·90); move 10 px ⇒ no command (dead zone); release inside cancel radius ⇒ no shoot; release outside ⇒ one `setAim` then one `shoot` in that order within the same frame |
| `src/view/__tests__/loop.test.ts` (jsdom, fake RAF) | INPUT+LOOP | a `shoot` produced on a frame with `acc < DT` is applied on the next frame that steps (persistent `pending`); two `setAim` in one frame collapse to the latest; `continue` queued while paused is applied after resume |
| `src/view/__tests__/view.test.ts` | VIEW | `applySimEvents(fellOffWorld)` sets `snapNextFrame`; `updateView` with the flag copies `next` without interpolation and clears it; sunk balls never interpolate; audio debounce: three `switchOn` within 100 ms ⇒ one `play` |

CI (`.github/workflows/ci.yml`): `npm ci` → `npm run typecheck` → `npm test` → `npm run build` (Node 22 via `.nvmrc`),
plus `npm audit --omit=dev --audit-level=high`. Deploy workflow runs only after CI success on `main` with a paths filter.

---

## 5. Serialization format

- Transport: JSON (no base64 on the socket). Share link: `base64url(JSON.stringify(ShareLinkPayload))`.
- `SimSnapshot` is a positional tuple (see `types.ts`), version first. Decoding validates every element's type and
  range and maps `levelIndex` back to `levelId` via `config.levelIds`; `par`/`medal` of campaign entries are
  recomputed from the level registry (never trusted from the wire).
- Precision: pos/vel `quantize2`; angle `quantize4`; power `quantize1`; `rng`, `tick`, `restTicks`, `strokes`
  integers. Flags bit-packed. Switch state bit-packed in `level.switches` order (`switchMaskOf`).
- Legacy `?state=` payloads (old base64 GameState) fail version validation and produce a visible toast
  "That link is from an older version" and a fresh title screen; never a frozen loop.
- Where it is produced: `LevelResults`/`Pause` "Copy share link" (only when both balls are settled, which is every
  `aiming`/`intro`/`levelResults` state) — local modes only.
- Where it is consumed: `App.tsx` on boot: `readStateParam()` → `decodeShareLink` → `LocalSession` with
  `initial = { state, events: [levelStart] }` and `mode` from the payload (online payloads are downgraded to `local`).
  The server never consumes one.

---

## 6. Server room lifecycle

```
socket open ──hello──▶ (version ok) ─createRoom─▶ WAITING(host) ─joinRoom─▶ LOBBY(2) ─start(host)─▶ PLAYING
     │ any other frame first → error{BAD_MESSAGE} (counts)   │ 15 min no guest → roomClosed{idle}     │
     └─ version mismatch → error + close                      │ guest leaves → back to WAITING          ├─ peer close → PAUSED(grace 60 s) ─rejoin(token)─▶ PLAYING
                                                              │ host drop → guest gets peerLeft         │                                 └─ expiry → roomClosed{peerTimeout}
                                                              │   {disconnected, graceMs} (no paused);  ├─ 10 min no inbound → roomClosed{idle}
                                                              │   host rejoin(token) → peerReconnected; ├─ campaignResults → playAgain → PLAYING (new seed)
                                                              │   expiry → roomClosed{peerTimeout}      └─ host leaveRoom → roomClosed{hostLeft}
```
- **Handshake**: the first frame must be a valid `hello` with `protocol === PROTOCOL_VERSION`; any other message
  before it ⇒ `error{BAD_MESSAGE}` and counts toward `LIMITS.badMessagesBeforeClose`.
- **One room per socket** (`Map<SocketLike, Room>`); `createRoom`/`joinRoom` while in a room ⇒ `ALREADY_IN_ROOM`.
- **Codes**: 5 chars from `ROOM_CODE_ALPHABET` via `crypto.randomInt`; retried on collision; ≤ `LIMITS.maxRooms` total,
  ≤ `maxRoomsPerIp` (ip from `fly-client-ip`, else first X-Forwarded-For hop, else socket address).
- **Lobby**: `setLevel` (host, lobby only) validated with `hasLevel` ⇒ `lobby.levelId`, broadcast `lobbyState`.
  `start{levelIds?}`: every id must pass `hasLevel` and be unique (else `BAD_MESSAGE`); default campaign =
  `campaignFrom(lobby.levelId)`. `config = { playerCount: 2, mode: 'online', seed: crypto.randomInt(2**32), levelIds }`.
- **Tokens**: `crypto.randomBytes(16).toString('hex')` per slot at create/join; client stores `{code, token, seat}`
  in `sessionStorage` and offers "Rejoin" on reload.
- **Tick** (integer math): `tickAll(now)` per room: if not PLAYING or `paused`: `lastTickAt = now; return`.
  Else `accUnits += Math.round((now - lastTickAt) * TICK_UNITS_PER_MS); lastTickAt = now;
  accUnits = Math.min(accUnits, MAX_CATCHUP_MS * TICK_UNITS_PER_MS /* 15000 */); while (accUnits >= TICK_UNITS_PER_TICK) { step(); accUnits -= TICK_UNITS_PER_TICK }`.
  50 ms ⇒ 3000 units ⇒ exactly 3 ticks; 400 ms ⇒ capped to 15. On unpause (`peerReconnected`) `lastTickAt = now`
  and `accUnits = 0`, so no burst.
  Each `step()`: `cmds = room.pending.splice(0)` (one ordered queue; see validation) → `stepSim` → append events
  (minus `commandRejected`) to `room.events`; `dirty ||= events.length > 0 || phase/aim/ball changed`;
  `immediate ||= events.some(e => IMMEDIATE_SNAPSHOT_EVENTS.includes(e.type))`; auto-continue: when the phase enters
  `intro`/`levelResults` set `autoContinueAt = now + INTRO/RESULTS_AUTO_CONTINUE_MS`; when `now >= autoContinueAt`
  push a synthetic `continue{playerId:0}` into `pending` (cleared on phase change).
  After the loop: broadcast when `immediate || (dirty && ticksSinceSnapshot >= SNAPSHOT_EVERY_TICKS) || ticksSinceSnapshot >= SNAPSHOT_KEEPALIVE_TICKS`:
  for each connected slot, if `socket.bufferedAmount > MAX_SOCKET_BACKLOG_BYTES` skip (its cursor is untouched), else
  send `snapshot{tick, serverTime: now, snap, events: room.events.slice(slot.sentEventIndex - eventBase), immediate}` and
  advance `slot.sentEventIndex`; then trim `room.events` past `min(sentEventIndex)` (a disconnected slot's cursor
  freezes until it reconnects or the grace expires; the buffer is capped at 2000 events — beyond that a reconnecting
  client is given `joined{sync}` and its cursor jumps to the end). Reset `dirty/immediate/ticksSinceSnapshot`.
  Tick bodies wrapped in try/catch: an exception logs, sends `error{INTERNAL}` + `roomClosed{internalError}` to both
  and destroys the room — never the process.
- **Validation per message**: `parseClientMessage` (shape+range, rebuilt objects) → room/phase/role checks → sim
  `allowedCommands`. `command.cmd.playerId` is overwritten with the socket's slot. Rate limit: token bucket 40/s
  (burst 60) ⇒ `RATE_LIMITED` then drop. `setAim`: if the slot is not `sim.activePlayer` ⇒ dropped silently; else
  it REPLACES the last unsent `setAim` from that slot in `room.pending` in place (or is appended), never erroring
  — relative order with a later `shoot` is preserved. `shoot`/`continue`/`restartLevel` are appended. Pre-checks:
  `shoot`/`setAim` from a non-active slot ⇒ `NOT_YOUR_TURN` (shoot only), `restartLevel` from slot 1 ⇒ `NOT_HOST`,
  wrong phase ⇒ `WRONG_PHASE`; everything else is decided by `stepSim` (rejections are silent on the wire).
  5 `BAD_MESSAGE` in 10 s ⇒ close 1008.
- **Disconnect**: `handleClose` marks the slot `disconnectedAt`; in PLAYING sends `peerLeft{disconnected, graceMs}` +
  `paused{true, peerDisconnected}` to the peer, keeps the room, stops ticking; in LOBBY(2) sends only `peerLeft`.
  A deliberate `leaveRoom` from the guest in lobby returns the host to WAITING with the same code (`lobbyState`);
  from the guest in PLAYING ⇒ `roomClosed{guestLeft}`; from the host anywhere ⇒ `roomClosed{hostLeft}`.
- **Heartbeat**: every 30 s `ping()`; sockets with `isAlive === false` are `terminate()`d (triggers handleClose).
- **Cleanup**: a room is deleted when both slots are gone, on `roomClosed`, on idle/lobby TTL, on shutdown. `stats()`
  must return zeros afterwards (tested).
- Drop-in deploy: HTTP 200 on `/`, WS on `/ws`, `PORT` env, single process, no DB. Dockerfile becomes multi-stage:
  `npm ci` → `npm run build:server` (esbuild bundle `server/index.ts` → `dist-server/index.mjs`, `--external:ws`) →
  `node:22-alpine`, `npm ci --omit=dev`, `USER node`, `CMD ["node","dist-server/index.mjs"]`. `ws` → 8.22.x.

---

## 7. Input device handling (`src/view/input`)

**Keyboard** (`event.code`): hold integrates `angle ± KEY_ANGLE_RATE*dt` (1.7 rad/s; after 0.6 s held ×1.6 for fast
sweeps) and `power ± KEY_POWER_RATE*dt` (54/s); the adapter keeps the raw float internally but every emitted
`setAim` carries `quantize4(angle)` / `quantize1(power)`. Space/Enter `shoot` on keydown (not repeat); Escape `pause`;
Tab `toggleCamera`; M `toggleMute`. `preventDefault` only when `document.activeElement` is body/canvas. All held keys
cleared on `blur`/`visibilitychange`. Modifier combos (Ctrl/Meta/Alt) ignored. A `shoot` pressed while
`turnDelayTicks > 0` is held as `pendingShoot` and emitted on the first frame `isShotReady` (max 0.6 s).

**Pointer** (Pointer Events; `touch-action: none` on the canvas): press within `DRAG_GRAB_RADIUS_PX` (56 logical px)
of the active ball's screen position — OR anywhere on the lower half of the canvas on touch devices when it is your
turn (big target) — starts a drag. Drag vector `d = press - current` (slingshot: pull back, shoot forward):
`angle = quantize4(clamp(atan2(d.y, d.x), AIM_ANGLE_MIN, AIM_ANGLE_MAX))`,
`power = quantize1(clamp(MIN_POWER + |d| / DRAG_FULL_POWER_PX * (MAX_POWER - MIN_POWER), MIN_POWER, MAX_POWER))`
(110 px ⇒ 55). Below `DRAG_DEAD_ZONE_PX` nothing is emitted; moving back within `DRAG_CANCEL_RADIUS_PX` of the press
point shows the "cancel" state and releasing there cancels. Release outside ⇒ final `setAim` then `shoot` (same
frame, that order). Pointer→logical mapping: `(clientX - rect.left) * 1280/rect.width`.

**Gamepad**: polled every frame via `navigator.getGamepads()`; left stick (dead zone 0.2) sets the angle ABSOLUTELY
(`atan2(-|y|, x)` so the stick direction is the shot direction), right trigger or right stick Y ramps power at
`KEY_POWER_RATE*2` while held, A (button 0) shoot, B back, Start pause, X camera, Y mute. Local 2P maps pad index to seat.
Prompts switch to button glyphs when a pad produced the last input.

Hint device = the adapter that most recently produced a non-empty frame; `Hud` and `OnboardingHint` read it.

---

## 8. tsconfig layout and scripts

```
tsconfig.json          base: strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess, ES2022 target, lib DOM + ES2022, jsx react-jsx, moduleResolution Bundler, noEmit, include ["src"], exclude ["src/**/__tests__"]
tsconfig.server.json   extends base; lib ["ES2022"]; types ["node"]; include ["server", "src/sim", "src/net/protocol.ts"]; exclude ["src/**/__tests__", "server/**/__tests__"]; noEmit
tsconfig.test.json     extends base; types ["node", "vitest/globals", "jsdom"]; include ["src/**/__tests__", "server/**/__tests__", "src", "server"]; noEmit
vite.config.ts         react plugin, /ws proxy to :3001, `test` block (node env; jsdom only via per-file `// @vitest-environment jsdom`)
package.json scripts   dev: "vite" | dev:lan: "vite --host" | server: "tsx server/index.ts" | dev:all | build: "npm run typecheck && vite build" |
                       build:server: "esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --external:ws --outfile=dist-server/index.mjs" |
                       typecheck: "tsc -p tsconfig.json && tsc -p tsconfig.server.json && tsc -p tsconfig.test.json" |
                       test: "vitest run --exclude '**/levels-solver*'" | test:levels: "vitest run src/sim/__tests__/levels-solver.test.ts" |
                       solve: "tsx scripts/solver.ts" | lint: "eslint ." | start: "node dist-server/index.mjs"
devDependencies add    esbuild (direct), @types/node 22.x (direct), eslint + typescript-eslint + eslint-plugin-react-hooks, jsdom; ws -> 8.22.x; engines { node: ">=22.12 <23" }; .nvmrc 22
```

---

## 9. File ownership map (parallel build agents never touch another agent's files)

| agent | owns (creates/edits) | reads only |
|---|---|---|
| **ARCH (lead), stub commit** | `src/sim/types.ts`, `src/net/protocol.ts`, this document; the stub tree; `src/sim/__tests__/contract.test.ts` (initial); DELETIONS: `src/game/**`, `src/Lobby.tsx`, `src/game/__tests__/determinism.test.ts`, old `src/net/*`, old `server/*` bodies | — |
| **SIM** | `src/sim/sim.ts`, `src/sim/physics.ts`, `src/sim/terrain.ts`, `src/sim/rng.ts`, `src/sim/serialize.ts`, `src/sim/__tests__/fixtures.ts`, `src/sim/__tests__/{sim-purity,contract,replay,turns,switches,physics,cup,serialize}.test.ts` | `types.ts` |
| **LEVELS** | `src/sim/levels/authoring.ts`, `src/sim/levels/index.ts`, `src/sim/levels/w1-0{1..4}-*.ts`, `src/sim/__tests__/{levels,levels-solver}.test.ts`, `scripts/solver.ts` | `types.ts`, `terrain.ts`, `physics.ts` (predictShot), `sim.ts` (runReplay) |
| **VIEW** | `src/view/view.ts`, `src/view/render/*`, `src/view/audio.ts`, `public/fonts/*` (if self-hosted), `src/view/__tests__/view.test.ts` | sim/* |
| **INPUT+LOOP** | `src/view/input/*`, `src/view/GameCanvas.tsx`, `src/view/__tests__/{input-*,loop}.test.ts` | sim/*, view/view.ts, net/GameClient.ts (types) |
| **UI** | `src/ui/*` (incl. `storage.ts`, `url.ts`, `eventBus.ts`), `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/vite-env.d.ts`, `index.html`, `public/{favicon.svg,favicon.ico,og.png,manifest.webmanifest}` | everything else |
| **NET** | `src/net/GameClient.ts`, `src/net/wsUrl.ts`, `src/net/__tests__/*`, `server/index.ts`, `server/rooms.ts`, `server/__tests__/{rooms,equivalence}.test.ts`, `tsconfig.server.json`, `Dockerfile`, `fly.toml` | `protocol.ts` (frozen), sim/* |
| **TOOLING+DOCS** | `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.test.json`, `vite.config.ts`, `eslint.config.js`, `.nvmrc`, `.github/**`, `vercel.json`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md` (status note only), `.gitignore`, `.claude/settings.json` | all |

Build order gate: SIM delivers `terrain.ts` + `physics.ts` + `sim.ts` (with `runReplay`, `predictShot`) FIRST
(day 1); LEVELS re-verifies every level with `scripts/solver.ts` against that physics before `levels-solver.test.ts`
is un-todo'd. There is no SIM→LEVELS test dependency: SIM tests use `fixtures.ts`; LEVELS tests use `runReplay`.

Dependency requests (a new npm package, a new export on a foreign module) go to the lead as a one-line note; the
TOOLING agent applies package changes within the same day so lockfiles never conflict.

### Stub strategy (lands BEFORE parallel work; `npm run typecheck && npm test` green on the stub commit)
The lead commits the full file tree with every contracted export present and the deletions above applied:
- `types.ts`, `protocol.ts` complete (this delivery).
- Pure functions throw `new Error('stub: <module>.<fn>')` **except** the ones the loop needs to render a static scene:
  `createSim` returns a valid intro state for `levelById(config.levelIds[0])` using the literal in physics-notes §6;
  `stepSim` returns `{ state: { ...state, tick: state.tick + 1 }, events: [] }`; `runReplay` loops `stepSim`;
  `encodeSnapshot/decodeSnapshot` implemented for real (small, SIM agent can refine); `levels/index.ts` exports ONE
  placeholder level (`w1-00-placeholder`: flat ground 1600 px, cup at 1400, no props, `watchOut: 'placeholder'`) that
  passes `validateLevel`; `renderFrame` fills sky + draws terrain + balls (no polish); `createInputSystem().poll`
  returns an empty frame; `createAudio()` returns the no-op system; `GameClient` methods set status
  `error{ SERVER_FULL, recoverable:false }`; `RoomManager` methods are no-ops that answer `error{BAD_MESSAGE}`;
  React screens render their headings and buttons.
- Each `__tests__` file exists with `it.todo(...)` per assertion listed in §4 so the suite is green and the
  checklist is visible; agents replace `it.todo` with real tests.
- `src/sim/__tests__/contract.test.ts` imports every module and asserts `typeof export === 'function'` for every
  name in §1 — this is the thing that fails the moment someone renames a contract.

---

## 10. Decisions log (critique → resolution)

| # | critique item | resolution |
|---|---|---|
| 1 | Terrain queries ambiguous under overhangs (soft-lock wake loop) | Replaced the x-only family with `groundAt(level, switches, pos, playerId): Ground \| null` (smallest y ≥ `pos.y + R - 4` among piece tops, active bridge/blocker tops and wrong-colour gate tops) used by `hasSupport`, the rest test, `evaluateSwitches`, `restsOnPermanentGround`. `surfaceYAt(level, x)` kept for authoring only and now returns the LOWEST piece (the fairway). Validity: overlapping pieces are either stacked (seam ≤ 1 px) or overhangs (clearance ≥ `OVERHANG_MIN_CLEARANCE` = 48 px); only the lowest piece carries tees/plates/cup. (§1.3, §1.7, physics-notes §2) |
| 2 | Ball resting on a blocker / wrong-colour gate top is "unsupported" | Same fix: those tops are in `groundAt`'s candidate set, which is exactly step 3's collider set. Test rows added (600 ticks asleep). |
| 3 | Local loop drops commands on frames without a step | Persistent `pending` queue, drained by the first step of a frame; keeps accumulating while paused; setAim coalesced per slot in place. `loop.test.ts` added. (§2.1) |
| 4 | Snapshot quantisation must use the encoder's expression | `quantize2/quantize4/quantize1` exported from `types.ts`; used by the rest step, the sunk/tee/rim values in `compileLevel`, and `encodeSnapshot`. `REST_QUANTUM` deleted. (§3.7–3.8, physics-notes §4.5) |
| 5 | Aim not quantised in the sim; bounds not 4-dp exact | `setAim` stores `quantize4(clamp(angle))`, `quantize1(clamp(power))`; `AIM_ANGLE_MIN = -3.11`, `AIM_ANGLE_MAX = -0.03`, `DEFAULT_AIM = {angle: -0.7854, power: 55}` (verified exact in node). (§1.5 rule 1, physics-notes §7) |
| 6 | `stepSim` cannot apply the allowed-command table without a seat | `seatOf(config, playerId)` added; host rules via `isHost(config, seatOf(...))`; `setAim/shoot` require `cmd.playerId === activePlayer`; stamping rules written into `types.ts` and §1.11/§1.12; turns.test rows added. |
| 7 | Online setAim/shoot ordering | `GameClient.sendCommand` flushes the held setAim before shoot/continue/restart; `rooms.ts` keeps ONE ordered `pending` queue with in-place setAim replacement; non-active setAim dropped silently (documented in protocol.ts). Test row "shot uses the NEW aim". (§1.14, §6) |
| 8 | Rooms test arithmetic / integer accumulator / pause fast-forward | Accumulator in integer units of 1/60 ms (`TICK_UNITS_PER_MS = 60`, `TICK_UNITS_PER_TICK = 1000`): 50 ms ⇒ 3000 ⇒ exactly 3 ticks, 400 ms ⇒ capped 15 (verified in node). While paused `lastTickAt = now`; on unpause `accUnits = 0`. (§6) |
| 9 | Snapshot discontinuity at the shot | `IMMEDIATE_SNAPSHOT_EVENTS` (types.ts) force a same-tick broadcast with `immediate: true`; client treats gaps > `SNAPSHOT_GAP_DISCONTINUITY_MS` (150), `immediate`, or any such event as a discontinuity (hold then snap); ring cleared on `start`/`joined{sync}`. (§2.2) |
| 10 | Replay log contract + server==local equivalence test | `ReplayEntry` in types.ts; `runReplay(config, log, untilTick)` in sim.ts; `server/__tests__/equivalence.test.ts`; `scripts/solver.ts` consumes `runReplay`. The meaningless "different batching" sentence replaced by a split-run test and a ticks-matter test. (§1.5, §4) |
| 11 | `turnDelayTicks` off-by-one | Decrement only when `phaseAtStart === 'aiming'`; the transition tick leaves 27 observable, next tick 26; turns.test pinned to this. (§1.5 rule 4) |
| 12 | Initial BallState / switch state unspecified; fan under parked ball | Literal in physics-notes §6 (`restTicks: REST_TICKS`, `grounded: true`, `lastRest = start`, switches all false); fans may carry `switchId` and an active fan wakes a sleeping ball (step 1). |
| 13 | Floating-point hygiene rules | §3.7: allowed operations list, `vec.len` via `Math.sqrt`, ban on `Math.hypot`/`Math.pow`/`**`/`toFixed`, sin/cos/atan2 only in `launchVelocity` + view/input; purity grep extended; Node pinned; golden in its own `it`. |
| 14 | Protocol hardening | `parsePlayerCommand` rebuilds `{type, playerId, angle, power}` / `{type, playerId}`; `start.levelIds` shape + duplicate check in protocol, `hasLevel` existence check in rooms.ts (protocol may only import sim/types); optional fields built conditionally — compiles under `exactOptionalPropertyTypes` (verified with tsc); `serverTime` is monotonic `performance.now()` (server) via the injected `now`. `PROTOCOL_VERSION` bumped to 3. |
| 15 | Freeze shared constant objects / readonly fields | `DEFAULT_AIM`, `PLAYER_*`, `PHASE_CODES`, `PHASES_BY_CODE`, `LIMITS`, `ERROR_COPY`, `IMMEDIATE_SNAPSHOT_EVENTS` are `Object.freeze`d and typed `Readonly`; `Vec`/`Aim` fields readonly; `SimState` fields readonly with `Readonly<PlayerState>`/`Readonly<BallState>` tuples; `MutVec` for physics/view scratch. |
| 16 | `Level` lacks `watchOut` | Added to `Level` and `LevelDef`; `validateLevel` requires non-empty `hint`, `aha`, `watchOut`; `Pause.tsx` shows it as the "Stuck?" tip. |
| 17 | No permanent solid wall; overlapping pieces forbidden | `BlockerRect.switchId` optional (absent ⇒ permanent; `bridgeToggle` never fires); overlap rule rewritten (stacked/overhang). |
| 18 | Sand restitution 0 cannot be applied in step 3 | The contact response looks up the sand rect at the contact x BEFORE applying restitution (physics-notes §3 step 3); stroke deltas go to the FALLING ball's owner (stated). |
| 19 | Online aim preview for the partner (brief §15) | `aimPreviewFor` computes `predictShot` for `activePlayer` using the local aim when a local seat owns it, else the snapshot aim; `AimPreview.remote` ⇒ 55 % alpha in the player's colour; `RenderScene.showAim` means "any aim". (§2.1) |
| 20 | Online event timing contradiction | Events buffered per snapshot; `drainEvents(renderTimeMs)` releases those with `serverTime <= T`. (§1.14, §2.2, §2.3) |
| 21 | Server broadcast loses events for a skipped socket; overlays driven by events | Per-slot `sentEventIndex` cursor with trimming past the minimum (capped at 2000, reconnect ⇒ sync); overlays driven by `FrameSummary.phase`/`ClientStatus`; `lastTickAt`/`accUnits` reset on unpause. (§1.13, §6) |
| 22 | `mechanicsIntroduced.length === 1` vs switch+bridge | `IntroducedMechanic` type (`'switch'` covers bridge/blocker effects); `Level.mechanicsIntroduced: readonly [IntroducedMechanic]` (length enforced by the type); `mechanicsPresent: readonly MechanicKind[]` derived by `compileLevel`. Level-id literals confined to `src/sim/levels/` (grep test); `campaignFrom(levelId)` for the title strip. |
| 23 | Pointer power 50 vs 55 | Formula `MIN + |d|/DRAG_FULL_POWER_PX*(MAX-MIN)` ⇒ 110 px = 55; test row fixed to 55. |
| 24 | `predictShot` holds switches constant | New signature with `otherBalls`; re-runs `evaluateSwitches` every scratch tick; parity test on a switch fixture. |
| 25 | Parallel-build blockers (test cycle, unowned deletions, tsconfig) | SIM tests use `src/sim/__tests__/fixtures.ts`; golden-on-real-levels moved to LEVELS' `levels.test.ts`; deletions assigned to the lead's stub commit; `contract.test.ts` → SIM, `view.test.ts` → VIEW, `vite-env.d.ts` → UI; `tsconfig.server.json` excludes `__tests__`; `tsconfig.test.json` added and included in `typecheck`. |
| 26 | Two `coursePar` exports; `SERVER_TICK_RATE` duplicate | sim.ts export renamed `campaignPar(state)`; `levels/index.ts` keeps `coursePar(levelIds)`; `SERVER_TICK_RATE` is `export { TICK_RATE as SERVER_TICK_RATE }`. |
| 27 | Dev-mode assert impossible in the sim | `Number.isFinite` check is unconditional every tick (throws); stated in §1.5 rule 5 and §3.6. |
| 28 | Server handshake / lobby cases unspecified | Pre-`hello` frames ⇒ `BAD_MESSAGE` (counted); `start.levelIds` ⇒ `hasLevel`; host drop in LOBBY(2) ⇒ `peerLeft{disconnected}` without `paused`, expiry ⇒ `roomClosed{peerTimeout}`. (§6) |
| 29 | HUD power meter at 10 Hz | `hudRef` CSS custom properties (`--power`, `--angle-deg`, `--aim-ready`) written every frame while dragging/aiming; `onFrame` stays 10 Hz. (§1.12) |
| 30 | `continue` ownership (host-only vs UX "either, first wins") | Either seat may `continue` in intro/levelResults (second one is an idempotent `wrongPhase` rejection); `restartLevel` is host-only and additionally allowed in `levelResults` ("Retry hole"); online the server auto-continues after `INTRO_AUTO_CONTINUE_MS` 4 s / `RESULTS_AUTO_CONTINUE_MS` 12 s; `playAgain` from either player. Table and turns.test updated. |
| R1 | Brief §4 lists a `start` command | Kept the deviation and made it explicit (§1.5): no `start` PlayerCommand; the lead records this in the brief. |
| R2 | `src/app/*` not in the layout | Removed; `storage.ts`, `url.ts`, `eventBus.ts` live under `src/ui/`. |
| R3/R4 | SFX lead visuals; teleports sweep across the map | Covered by #20 and `RenderBall.snapNextFrame` (set on fellOffWorld/sink/gimme/levelStart/levelRestart). |
| R5 | Switch latency ⇒ double `turnStart` | `flying` is left only when `allSettled && !switchesChanged` (§1.5 rule 3). |
| R6 | Snapshots fed back into a server sim | Stated: the server never decodes a snapshot (protocol.ts header, §5, §0). |
| R8 | KEY_*/DRAG_* constants in sim/types.ts | Kept there (single source of numbers; sim never reads them); no `view/constants.ts` re-export to avoid a second definition. |
| R9 | 20 Hz snapshots during long aims | Accepted (~4 KB/s); noted, no change. |
| R10 | `maxRoomsPerIp` spoofable via X-Forwarded-For | `fly-client-ip` preferred (§1.15, §6). |
| R11 | Golden depends on engine bit-identity | #13 + Node pin; golden in its own `it`. |
| R12 | ALLOWED_ORIGINS blocks Vercel previews | Glob entries supported; default includes `https://flash-golf-*.vercel.app`. |
| R13 | Switch SFX chatter | `audio.handleEvents` debounces switch/bridge SFX per switchId ≥ 150 ms, bounces 40 ms per ball. |
| R14 | `solidColliders` churn | Computed once per tick per switchMask (WeakMap cache), filtered per ball with `collidersFor`. |
| R15 | `parseServerMessage` trusts the rest | `decodeSnapshot` is the hard validation point; failures ⇒ `ClientStatus error{BAD_SNAPSHOT}`; `parseServerMessage` also rejects a snapshot with the wrong version tag. |
| R16 | `React.MutableRefObject` deprecated | `React.RefObject<PlayerCommand[]>`, `React.RefObject<HTMLElement>`. |
| R17 | `RenderBall` type, `ctx` types, `useSimEvents` undefined | `RenderBall` and `AimPreview` named; every render signature spells `ctx: CanvasRenderingContext2D`; `src/ui/eventBus.ts` specified. |
| R18 | Brief §26 unfurl forgotten | Explicit line in §1.13 (title, description, OG image placeholder, favicon, theme-color). |
| R19 | Lobby start-hole picker / auto-advance need protocol messages | Added `setLevel` (client), `lobbyState` + `LobbyState` (server), `INTRO/RESULTS_AUTO_CONTINUE_MS` constants before freezing protocol.ts. |
| R20 | Shot speed 6.8 vs 6.5 across level proposals | Constant stays 6.8 in exactly one place; whichever level set the lead picks must be re-verified by LEVELS with `scripts/solver.ts` at `SHOT_SPEED_PER_POWER` against the NEW physics before `levels-solver.test.ts` goes live (build-order gate in §9). |
