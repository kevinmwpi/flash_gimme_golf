/**
 * src/sim/types.ts — the single source of truth for every rule-relevant type and constant.
 *
 * RULES FOR THIS FILE
 * - Types, numeric constants and three tiny pure helpers (`medalFor`, `quantize*`). No imports,
 *   no DOM, no Date, no Math.random. Compiles under `strict` + `exactOptionalPropertyTypes` with
 *   `lib: ["ES2022"]` (no DOM) so the server tsconfig can import it unchanged.
 * - Everything in `SimState` is JSON-serializable and needed by the RULES. Camera, particles,
 *   trails, screen shake, golfer walk animation, banners and toasts live in `src/view/view.ts`
 *   (ViewState) and are rebuilt from `SimEvent`s.
 * - Shared constant OBJECTS are frozen and typed `Readonly` (stepSim shares sub-objects between
 *   states, so one in-place mutation anywhere would corrupt every state).
 * - Changing anything here is an architecture change: open a request to the lead; do not edit
 *   this file from a build-agent branch.
 *
 * COORDINATES
 * - World units are logical pixels. +x right, +y DOWN (canvas convention). A level is
 *   `width` x 720 px; the viewport is a 1280x720 window that scrolls horizontally.
 * - Angles are radians, 0 = +x (right), -PI/2 = straight up, -PI = left. A legal aim angle is
 *   in [AIM_ANGLE_MIN, AIM_ANGLE_MAX] (always pointing upward).
 *
 * FLOATING-POINT HYGIENE (see ARCH.md §3) — inside src/sim only `+ - * /`, `Math.sqrt`,
 * `Math.round/floor/ceil/abs/min/max` are used for integration and collision. `Math.sin/cos/atan2`
 * appear ONLY in `launchVelocity`. `Math.hypot`, `Math.pow`, `**` and `toFixed` are banned.
 */

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** 2-D vector / point in world pixels. Immutable: physics writes NEW Vec objects, never fields. */
export type Vec = { readonly x: number; readonly y: number };

/** Mutable scratch vector for the inside of physics loops (never stored in SimState). */
export type MutVec = { x: number; y: number };

/**
 * A ball/golfer slot. 0 = red (#ff5d73), 1 = blue (#50b7ff). There are ALWAYS two slots in a
 * sim. Which human ("seat") controls a slot is decided by `SimConfig.mode` (see `seatOf`,
 * `canControl` in sim.ts): solo => seat 0 controls both slots; local/online => seat i = slot i.
 */
export type PlayerId = 0 | 1;

/** Colour used by colour gates; identical to the player's slot colour. */
export type GateColour = 'red' | 'blue';

/** Every mechanic kind a level can contain (used for metadata + validity tests). */
export type MechanicKind =
  | 'sand'
  | 'spring'
  | 'bumper'
  | 'fan'
  | 'colourGate'
  | 'switch'
  | 'bridge'
  | 'blocker';

/**
 * The ONE idea a World-1 level introduces. 'switch' covers the plate AND whatever it drives
 * (bridge/blocker are its effects and are listed in `mechanicsPresent`, never introduced alone).
 */
export type IntroducedMechanic = 'sand' | 'spring' | 'bumper' | 'fan' | 'colourGate' | 'switch';

// ---------------------------------------------------------------------------------------------
// Level geometry (static, authored data; never serialized into state)
// ---------------------------------------------------------------------------------------------

/**
 * One solid ground mass. `surface` is a polyline with STRICTLY increasing x, extruded straight
 * down to `baseY`. The piece is SOLID: physics collides with the top polyline, both vertical side
 * faces (first point -> baseY, last point -> baseY), the base, and uses point-in-polygon to eject
 * a ball that somehow ends up inside. Steep risers are authored as 1 px steps, e.g.
 * `[958, 648], [959, 300]`.
 *
 * Pieces may overlap in x ONLY as (a) a STACKED piece (pillar/step: `upper.baseY` within 1 px of
 * the lower surface across the whole overlap) or (b) an OVERHANG/ceiling (`upper.baseY` at least
 * `OVERHANG_MIN_CLEARANCE` px ABOVE the lower surface across the whole overlap). Only the LOWEST
 * piece at an x may carry tees, plates or the cup (validity rule; see ARCH.md §1.7).
 */
export type TerrainPiece = {
  readonly surface: readonly Vec[];
  /** y of the flat bottom edge; must be > every surface y. */
  readonly baseY: number;
};

/** A world-x range with no ground at all. Balls fall here unless an active bridge spans it. */
export type Gap = { readonly x1: number; readonly x2: number };

export type Terrain = {
  readonly pieces: readonly TerrainPiece[];
  /** Declared gaps. A validity test asserts no piece covers any x inside a gap and that the
   *  pieces adjacent to the gap end at g.x1 and resume at g.x2 exactly. */
  readonly gaps: readonly Gap[];
};

/** Fields shared by every level rect. */
export type RectBase = {
  /** Unique within the level, e.g. "bridge-a". Referenced by events and view animations. */
  readonly id: string;
  /** Axis-aligned bounds in world px. For flush pads (sand/spring/bumper) `y`/`h` describe the
   *  drawn band under the surface; physics uses only the x-range + ground contact. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** If set, the rect exists only when the switch's pressed state equals `activeWhen`. */
  readonly switchId?: string;
  /** OR-linked switches: when present it overrides `switchId` and the rect is active iff
   *  (ANY listed switch is pressed) === (activeWhen ?? kind default). Used by a bridge held by
   *  several plates (e.g. near lip, far landing bowl, deck). Every id must resolve (validity). */
  readonly switchIds?: readonly string[];
  /** Default: bridge = true (appears while pressed), blocker = false (disappears while pressed),
   *  others = true. Ignored when `switchId` is absent (the rect is permanent). */
  readonly activeWhen?: boolean;
  /** Short on-object label drawn by the renderer (e.g. "SAND", "BOING"). Optional. */
  readonly label?: string;
};

/** Friction zone flush with the surface: rolling speed decays with SAND_ROLL_DAMP and the landing
 *  bounce is killed (restitution 0, decided at the contact BEFORE restitution is applied). No
 *  collision geometry. */
export type SandRect = RectBase & { readonly kind: 'sand' };

/** Launch pad flush with the surface. ANY ground contact inside [x, x+w] sets the ball's
 *  velocity to `launch` exactly (px/s, y negative = up). Fixed, bounded, cannot pogo forever
 *  when launch.x != 0 (validity test warns on launch.x === 0). */
export type SpringRect = RectBase & { readonly kind: 'spring'; readonly launch: Vec };

/** Bouncy pad flush with the surface. A landing with impact speed >= PAD_MIN_IMPACT sets the
 *  outgoing normal speed to BUMPER_SPEED and adds BUMPER_SIDE_KICK tangentially away from the
 *  pad centre; tangential speed is otherwise preserved. Slow rolls cross it untouched. */
export type BumperRect = RectBase & { readonly kind: 'bumper' };

/** Volume applying a constant upward acceleration `force` (px/s^2, default FAN_FORCE) while the
 *  ball centre is inside the AABB; upward speed is capped at FAN_MAX_LIFT. May carry `switchId`;
 *  a ball ASLEEP inside a fan that becomes active is woken (see physics-notes §2 step 1). */
export type FanRect = RectBase & { readonly kind: 'fan'; readonly force?: number };

/** Solid wall. The ball of the matching colour passes through; the other bounces off with
 *  GATE_RESTITUTION and emits `hazardBlock`. Its top is a support surface for the wrong-colour ball. */
export type ColourGateRect = RectBase & { readonly kind: 'colourGate'; readonly colour: GateColour };

/** Extra floor slab spanning a gap; solid on all four faces while active. Validity test: top
 *  within BRIDGE_LIP_TOLERANCE px of both lips, x-range equals the gap it spans, and it has
 *  `switchId` or a non-empty `switchIds`. */
export type BridgeRect = RectBase & { readonly kind: 'bridge' };

/** Solid wall standing on the ground. With `switchId` (default activeWhen=false) it disappears
 *  while its switch is held; WITHOUT `switchId` it is a PERMANENT wall (anti-lob wall, pillar)
 *  and `bridgeToggle` never fires for it. Bounces with WALL_RESTITUTION. Its top is a support
 *  surface. */
export type BlockerRect = RectBase & { readonly kind: 'blocker' };

export type LevelRect =
  | SandRect
  | SpringRect
  | BumperRect
  | FanRect
  | ColourGateRect
  | BridgeRect
  | BlockerRect;

export type LevelRectKind = LevelRect['kind'];

/**
 * Pressure plate. Pressed while ANY non-sunk ball is in ground contact with its centre x inside
 * [x, x+w] and its bottom within SWITCH_CONTACT_TOLERANCE px of `surfaceY`. Released the very
 * tick the presser leaves (no latching). Levels pair switches so the holder can also cross.
 */
export type PressureSwitch = {
  readonly id: string;
  readonly x: number;
  readonly w: number;
  /** Fairway y at the plate centre (resolved at compile time, quantised to 2 dp). */
  readonly surfaceY: number;
  /** Accent colour (hex) shared with every rect that references this switch. */
  readonly colour: string;
  readonly label?: string;
  /** A DECK plate: lives on top of the rect with this id (a bridge or blocker). Pressed only while
   *  that rect is active and the resting ball's ground source is that rect; `surfaceY` is the
   *  rect's top. Plates without `onRectId` require ground source 'piece'. */
  readonly onRectId?: string;
};

export type Hole = {
  /** Cup centre x. */
  readonly x: number;
  /** Fairway y at the cup (ball bottom touches this when sitting on the rim). 2 dp exact. */
  readonly rimY: number;
  /** Cup half-width; sink when |ball.x - x| <= radius - SINK_INSET and slow enough. */
  readonly radius: number;
};

/** Which "world" a level belongs to. Only world 1 exists in this build. */
export type WorldId = 1;

/** A fully compiled, static level. Authored via `levels/authoring.ts` helpers. */
export type Level = {
  /** Stable id used in SimConfig.levelIds, localStorage and share links. Literal ids appear ONLY
   *  inside src/sim/levels/ (everything else goes through WORLD1_IDS / LEVELS). */
  readonly id: string;
  readonly name: string;
  readonly world: WorldId;
  /** 1-based position inside its world. */
  readonly order: number;
  /** Team par (both balls combined). */
  readonly par: number;
  /** One-sentence hint shown on the intro card. Non-empty. */
  readonly hint: string;
  /** The intended insight, for docs/tests (not shown to players). Non-empty. */
  readonly aha: string;
  /** The watch-out failure mode (brief §12), for docs/tests and the pause-menu "Stuck?" tip. Non-empty. */
  readonly watchOut: string;
  /** The ONE idea this level introduces (World 1: exactly one, in the campaign order). */
  readonly mechanicsIntroduced: readonly [IntroducedMechanic];
  /** Slot that shoots first on this level (also after restartLevel). */
  readonly firstPlayer: PlayerId;
  /** Optional: while ANY ball is sunk, this switch counts as pressed (the first ball home keeps
   *  the partner's way open instead of stranding them). */
  readonly cupHoldsSwitch?: string;
  /** Every mechanic kind that appears in the level (superset of mechanicsIntroduced + effects). */
  readonly mechanicsPresent: readonly MechanicKind[];
  /** World width in px; >= VIEWPORT_W. */
  readonly width: number;
  /** Always VIEWPORT_H (720). Kept explicit so geometry math never hard-codes it. */
  readonly height: number;
  /** Horizontal acceleration px/s^2 applied to airborne balls. World 1: always 0. */
  readonly wind: number;
  readonly terrain: Terrain;
  readonly rects: readonly LevelRect[];
  readonly switches: readonly PressureSwitch[];
  readonly hole: Hole;
  /** Tee positions for slot 0 and slot 1 (ball centres, on the lowest permanent piece, 2 dp
   *  exact, >= 50 px apart). */
  readonly starts: readonly [Vec, Vec];
};

// ---------------------------------------------------------------------------------------------
// Sim configuration, state, commands, events
// ---------------------------------------------------------------------------------------------

/** 'solo' = one human controls both slots; 'local' = two humans, one keyboard; 'online' = each
 *  browser owns one slot and the server runs the sim. */
export type SimMode = 'solo' | 'local' | 'online';

/** Immutable for the life of a sim. Sent once per online game (`start` message). */
export type SimConfig = {
  readonly playerCount: 1 | 2;
  /** Ordered campaign, e.g. WORLD1_IDS or a suffix of it. Length >= 1, ids unique. */
  readonly levelIds: readonly string[];
  /** uint32 seed. Local: from crypto.getRandomValues in the shell; online: from the server. */
  readonly seed: number;
  readonly mode: SimMode;
};

/**
 * intro           — level intro card; waits for `continue` (either seat).
 * aiming          — active player may setAim / shoot (shoot only when turnDelayTicks === 0).
 * flying          — at least one ball is moving; no shots accepted.
 * levelResults    — both balls sunk; waits for `continue` (either seat) or `restartLevel` (host).
 * campaignResults — last level done; terminal (UI/server create a new sim to play again).
 */
export type SimPhase = 'intro' | 'aiming' | 'flying' | 'levelResults' | 'campaignResults';

export type Aim = {
  /** Radians, clamped to [AIM_ANGLE_MIN, AIM_ANGLE_MAX] and quantised with `quantize4` by the sim. */
  readonly angle: number;
  /** Clamped to [MIN_POWER, MAX_POWER] and quantised with `quantize1`. Launch speed = power * SHOT_SPEED_PER_POWER. */
  readonly power: number;
};

export type PlayerState = {
  /** Strokes on the CURRENT level (includes fall penalties and the gimme stroke). */
  readonly strokes: number;
  /** Persisted per player across turns (fixes audit #25). Reset per level to DEFAULT_AIM. */
  readonly aim: Aim;
};

/**
 * Mutable ball record. `stepBall` mutates a COPY of it (spread from the readonly state) and
 * replaces `pos`/`vel`/`lastRest` with new Vec objects (Vec fields are readonly).
 */
export type BallState = {
  pos: Vec;
  vel: Vec;
  /** True once at rest (REST_TICKS consecutive slow grounded ticks). Woken if support vanishes
   *  or an active fan contains the ball. */
  asleep: boolean;
  /** True once in the cup (sunk or gimme). pos is then {hole.x, hole.rimY + 10} and the ball is skipped. */
  sunk: boolean;
  /** Ground/rect-top contact during the last tick (drives switches + rest test). */
  grounded: boolean;
  /** Consecutive ticks that satisfied the rest test; asleep when it reaches REST_TICKS. */
  restTicks: number;
  /** Last resting position ON PERMANENT GROUND; the fell-off-world respawn point. */
  lastRest: Vec;
};

export type Medal = 'gold' | 'silver' | 'bronze' | 'none';

export type LevelResult = {
  readonly levelId: string;
  readonly par: number;
  /** Per-slot strokes. Team strokes = strokes[0] + strokes[1]. */
  readonly strokes: readonly [number, number];
  readonly medal: Medal;
};

/**
 * Everything the rules need and nothing else. IMMUTABLE: `stepSim` returns a new object
 * (sub-objects may be shared when unchanged). All numbers are finite (checked every tick).
 */
export type SimState = {
  readonly config: SimConfig;
  /** 60 Hz tick counter since createSim. */
  readonly tick: number;
  readonly phase: SimPhase;
  /** Index into config.levelIds. */
  readonly levelIndex: number;
  /** = config.levelIds[levelIndex]; duplicated for readability in logs/tests. */
  readonly levelId: string;
  readonly players: readonly [Readonly<PlayerState>, Readonly<PlayerState>];
  readonly balls: readonly [Readonly<BallState>, Readonly<BallState>];
  /** switchId -> pressed. Keys are exactly the level's switch ids. */
  readonly switches: Readonly<Record<string, boolean>>;
  readonly activePlayer: PlayerId;
  /** Ticks remaining before the active player may shoot (TURN_DELAY_TICKS after a hand-off). */
  readonly turnDelayTicks: number;
  /** mulberry32 state (uint32). Reserved for future gameplay draws; never used for cosmetics. */
  readonly rng: number;
  /** One entry per COMPLETED level, in campaign order. */
  readonly campaign: readonly LevelResult[];
};

/**
 * Commands are the ONLY way input reaches the sim. `playerId` is the SLOT being acted on.
 * Stamping: input stamps gameplay commands with `playerId = state.activePlayer`; React overlays
 * stamp `continue`/`restartLevel` with `playerId = 0` locally (seat 0 = host); the server
 * overwrites `playerId` with the sender's slot. The sim derives the SEAT with `seatOf(config, playerId)`.
 */
export type PlayerCommand =
  | { readonly type: 'setAim'; readonly playerId: PlayerId; readonly angle: number; readonly power: number }
  | { readonly type: 'shoot'; readonly playerId: PlayerId }
  /** intro -> aiming, levelResults -> next level's intro (or campaignResults). Either seat. */
  | { readonly type: 'continue'; readonly playerId: PlayerId }
  /** Resets the current level (balls, switches, strokes for this level). Host seat only. */
  | { readonly type: 'restartLevel'; readonly playerId: PlayerId };

export type PlayerCommandType = PlayerCommand['type'];

/** Surface kinds reported by `bounce` events (view picks SFX/particles by this). */
export type BounceSurface = 'grass' | 'dirtWall' | 'bridge' | 'blocker' | 'levelEdge' | 'ceiling';

/** Body of every event; `SimEvent` adds the tick. Payloads are complete: the view never has to
 *  re-derive positions from state to react to an event. */
export type SimEventBody =
  /** Emitted by createSim and on every level change (also after restartLevel). */
  | { type: 'levelStart'; levelId: string; levelIndex: number; firstPlayer: PlayerId; restarted: boolean }
  /** Intro dismissed; aiming begins. */
  | { type: 'playStart'; levelId: string }
  /** Active player changed or continues; shots accepted after `readyInTicks`. */
  | { type: 'turnStart'; playerId: PlayerId; readyInTicks: number; sameAsBefore: boolean }
  | { type: 'ballHit'; playerId: PlayerId; pos: Vec; angle: number; power: number; speed: number }
  /** Any solid contact with impact speed >= BOUNCE_EVENT_MIN_IMPACT. strength = impact/MAX_BALL_SPEED (0..1). */
  | { type: 'bounce'; playerId: PlayerId; pos: Vec; normal: Vec; strength: number; surface: BounceSurface }
  /** Ball started rolling/landing inside a sand rect (once per entry). */
  | { type: 'enterSand'; playerId: PlayerId; pos: Vec; rectId: string }
  | { type: 'spring'; playerId: PlayerId; pos: Vec; rectId: string; launch: Vec }
  | { type: 'bumper'; playerId: PlayerId; pos: Vec; rectId: string; outVel: Vec }
  /** Ball entered a fan volume (once per entry). */
  | { type: 'fan'; playerId: PlayerId; pos: Vec; rectId: string }
  /** Wrong-colour ball bounced off a colour gate. */
  | { type: 'hazardBlock'; playerId: PlayerId; pos: Vec; rectId: string; colour: GateColour }
  /** Matching ball passed through a colour gate (once per crossing). */
  | { type: 'gatePass'; playerId: PlayerId; pos: Vec; rectId: string; colour: GateColour }
  | { type: 'switchOn'; switchId: string; byPlayer: PlayerId; pos: Vec }
  | { type: 'switchOff'; switchId: string; pos: Vec }
  /** A switch-linked rect changed existence (never fires for permanent rects). */
  | { type: 'bridgeToggle'; rectId: string; kind: LevelRectKind; active: boolean; switchId: string }
  /** Ball fell below the kill line; respawned at lastRest with FALL_PENALTY strokes. View SNAPS the ball. */
  | { type: 'fellOffWorld'; playerId: PlayerId; pos: Vec; respawnPos: Vec; strokes: number }
  /** Ball came to rest (not sunk). */
  | { type: 'ballRest'; playerId: PlayerId; pos: Vec; onPermanentGround: boolean }
  /** Rested within NEAR_CUP_RADIUS of the cup but outside GIMME_RADIUS. */
  | { type: 'nearCup'; playerId: PlayerId; pos: Vec; distance: number }
  /** Crossed the cup too fast to drop (speed > SINK_MAX_SPEED); vel.x scaled by LIP_OUT_DAMP. */
  | { type: 'lipOut'; playerId: PlayerId; pos: Vec; speed: number }
  /** Conceded: rested within GIMME_RADIUS; strokes already include the +1. View animates the hop, then snaps. */
  | { type: 'gimme'; playerId: PlayerId; pos: Vec; strokes: number }
  /** Ball dropped in the cup; `strokes` is this player's level total. View SNAPS the ball. */
  | { type: 'sink'; playerId: PlayerId; pos: Vec; strokes: number; speed: number }
  | { type: 'levelComplete'; result: LevelResult; teamStrokes: number; isLastLevel: boolean }
  | { type: 'campaignComplete'; results: readonly LevelResult[]; totalStrokes: number; coursePar: number; medal: Medal }
  | { type: 'levelRestart'; levelId: string; byPlayer: PlayerId }
  /** A command was ignored (debug/UX only; never sent over the wire). */
  | { type: 'commandRejected'; command: PlayerCommandType; playerId: PlayerId; reason: CommandRejectReason };

export type CommandRejectReason = 'wrongPhase' | 'notActivePlayer' | 'turnDelay' | 'notHost' | 'outOfRange';

export type SimEventType = SimEventBody['type'];

export type SimEvent = SimEventBody & { tick: number };

export type StepResult = { state: SimState; events: SimEvent[] };

/**
 * Events that (a) make the server broadcast a snapshot on the SAME tick (bypassing the 3-tick
 * gate) and (b) make the client treat the next snapshot as a DISCONTINUITY (no interpolation
 * across them). Frozen list; see ARCH.md §2.2 and §6.
 */
export const IMMEDIATE_SNAPSHOT_EVENTS: readonly SimEventType[] = Object.freeze([
  'ballHit',
  'turnStart',
  'fellOffWorld',
  'sink',
  'gimme',
  'levelStart',
  'levelComplete',
  'campaignComplete',
  'levelRestart',
] as const);

// ---------------------------------------------------------------------------------------------
// Replay log (sim.ts runReplay; used by replay tests, the server==local equivalence test, solver)
// ---------------------------------------------------------------------------------------------

/** A command applied at exactly `tick` (array order within a tick). */
export type ReplayEntry = { readonly tick: number; readonly cmd: PlayerCommand };

// ---------------------------------------------------------------------------------------------
// Compact serialized form (?state= links and the network)
// ---------------------------------------------------------------------------------------------

/** 0 intro, 1 aiming, 2 flying, 3 levelResults, 4 campaignResults. */
export type PhaseCode = 0 | 1 | 2 | 3 | 4;

/** [strokes, angle (4 dp), power (1 dp)] — exactly the values stored in the sim (already quantised). */
export type PlayerSnap = [strokes: number, angle: number, power: number];

/** Ball flag bits. */
export const BALL_FLAG_ASLEEP = 1;
export const BALL_FLAG_SUNK = 2;
export const BALL_FLAG_GROUNDED = 4;

/** [x, y, vx, vy, flags, restTicks, lastRestX, lastRestY] — pos/vel passed through `quantize2`. */
export type BallSnap = [
  x: number,
  y: number,
  vx: number,
  vy: number,
  flags: number,
  restTicks: number,
  lastRestX: number,
  lastRestY: number,
];

/** [strokes0, strokes1] per completed level; par/medal are recomputed from the level registry. */
export type CampaignSnap = [number, number][];

/**
 * Dynamic fields only (no config, no geometry). JSON of this is ~145-211 bytes (measured).
 * `switchMask` bit i = level.switches[i] pressed. Decoding needs the SimConfig (level ids).
 */
export type SimSnapshot = [
  version: typeof SNAPSHOT_VERSION,
  tick: number,
  phase: PhaseCode,
  levelIndex: number,
  activePlayer: PlayerId,
  turnDelayTicks: number,
  players: [PlayerSnap, PlayerSnap],
  balls: [BallSnap, BallSnap],
  switchMask: number,
  rng: number,
  campaign: CampaignSnap,
];

/** Compact config for share links: [playerCount, modeCode, seed, levelIds]. modeCode 0 solo 1 local 2 online. */
export type SimConfigSnap = [playerCount: 1 | 2, modeCode: 0 | 1 | 2, seed: number, levelIds: string[]];

/** Payload of a `?state=` link: base64url(JSON.stringify(ShareLinkPayload)). */
export type ShareLinkPayload = { v: typeof SNAPSHOT_VERSION; c: SimConfigSnap; s: SimSnapshot };

export const SNAPSHOT_VERSION = 1 as const;

// ---------------------------------------------------------------------------------------------
// Constants (one place; nothing else may redefine these numbers)
// ---------------------------------------------------------------------------------------------

/** Fixed sim rate. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Logical viewport the renderer always draws; letterboxed into the window. */
export const VIEWPORT_W = 1280;
export const VIEWPORT_H = 720;

export const BALL_RADIUS = 12;
export const GRAVITY = 620; // px/s^2

export const MIN_POWER = 10;
export const MAX_POWER = 100;
/**
 * px/s of launch speed per power unit. DESIGN KNOB. 6.5 => max launch 650 px/s, flat-ground
 * max range 650^2/620 = 681 px, max height 650^2/(2*620) = 341 px. The old build used 8.8
 * (1,249 px range) which let every level be lobbed; World 1 is solver-verified at 6.5 (420 px
 * walls and the 720 px chasm keep >= 27 px of margin even without air drag) and must be
 * re-verified if this changes.
 */
export const SHOT_SPEED_PER_POWER = 6.5;

/** Aim bounds are 4-dp EXACT so clamped aims survive the snapshot round trip. */
export const AIM_ANGLE_MIN = -3.11; // almost straight left, upward (was -PI+0.03 = -3.11159…)
export const AIM_ANGLE_MAX = -0.03; // almost straight right, upward
/** 45 degrees up-right (= -PI/4 rounded to 4 dp), power 55. Frozen. */
export const DEFAULT_AIM: Readonly<Aim> = Object.freeze({ angle: -0.7854, power: 55 });

/** 0.45 s hand-off before the next shot is accepted. */
export const TURN_DELAY_TICKS = 27;

/** Gimme: a resting ball whose bottom is within this distance of the cup rim centre is conceded. */
export const GIMME_RADIUS = 40;
/** nearCup event radius (callout "So close!"). */
export const NEAR_CUP_RADIUS = 90;
/** Max speed at which a ball crossing the cup drops in. */
export const SINK_MAX_SPEED = 240;
/** Sink needs |x - hole.x| <= hole.radius - SINK_INSET (hole.radius is 16). */
export const SINK_INSET = 4;
/** vel.x multiplier on a lip-out. */
export const LIP_OUT_DAMP = 0.8;
export const HOLE_RADIUS = 16;
/** Sunk ball position = { hole.x, hole.rimY + SUNK_BALL_DROP } (2 dp exact because rimY is). */
export const SUNK_BALL_DROP = 10;

/** Strokes added when a ball falls off the world. */
export const FALL_PENALTY = 1;
/** Kill line: pos.y > level.height + KILL_MARGIN. */
export const KILL_MARGIN = 160;
/** Soft ceiling (world y): vertical velocity zeroed above it. */
export const CEILING_Y = -420;

/** Global speed cap applied at the end of every tick (px/s). 1100 => 18.3 px per tick. */
export const MAX_BALL_SPEED = 1100;
/** Integration is sub-stepped so no sub-step moves the centre more than this (px). */
export const SUBSTEP_MAX_MOVE = 8;
export const MAX_SUBSTEPS = 4;

export const GROUND_RESTITUTION = 0.35;
export const WALL_RESTITUTION = 0.45; // dirt side faces, blockers, level edges
export const GATE_RESTITUTION = 0.5; // wrong-colour gate
export const BRIDGE_RESTITUTION = 0.35;
/** Per-tick multiplier on rolling speed (grass). 0.992^60 ~ 0.62 per second. */
export const ROLL_DAMP = 0.992;
/** Per-tick multiplier on rolling speed in sand. */
export const SAND_ROLL_DAMP = 0.9;
/** Per-tick multiplier on airborne vx. */
export const AIR_DRAG = 0.998;
/** Fraction of gravity's tangential component applied while rolling. */
export const SLOPE_GRAVITY_SCALE = 0.85;

/** Rest test: grounded, speed < REST_SPEED, slope tan < REST_MAX_SLOPE for REST_TICKS ticks. */
export const REST_SPEED = 18;
export const REST_MAX_SLOPE = 0.27; // tan(15 deg)
export const REST_TICKS = 6;
/** Support test: a ball is supported when |groundAt(pos).y - (pos.y + BALL_RADIUS)| <= this. */
export const SUPPORT_TOLERANCE = 2;
/** groundAt only considers surfaces with y >= pos.y + BALL_RADIUS - GROUND_SEARCH_SLACK. */
export const GROUND_SEARCH_SLACK = 4;

/** Minimum impact speed (px/s) for a bumper to fire and for `bounce` events to be emitted. */
export const PAD_MIN_IMPACT = 30;
export const BOUNCE_EVENT_MIN_IMPACT = 60;
export const BUMPER_SPEED = 440;
export const BUMPER_SIDE_KICK = 90;
export const FAN_FORCE = 900; // px/s^2 upward (net 280 against gravity)
export const FAN_MAX_LIFT = 420; // px/s cap on upward speed inside a fan

export const SWITCH_CONTACT_TOLERANCE = 6; // px between ball bottom and plate surface
export const BRIDGE_LIP_TOLERANCE = 3; // px, validity test
/** Minimum vertical clearance between an overhang's base and the surface below it (2R + 24). */
export const OVERHANG_MIN_CLEARANCE = 2 * BALL_RADIUS + 24;
/** Stacked piece: |upper.baseY - lowerSurfaceY(x)| <= this across the overlap. */
export const STACK_SEAM_TOLERANCE = 1;
/** Walls (blockers, colour gates) must be at least this tall (validity). */
export const MIN_WALL_HEIGHT = 120;
export const MAX_LEVEL_WIDTH = 4096;
/** Tees, plates and the cup must sit on slope tan <= this. */
export const RESTABLE_MAX_SLOPE = 0.1;
export const MIN_TEE_SEPARATION = 50;

/** Client-side keyboard integration rates (view/input, shared here so hints can quote them). */
export const KEY_ANGLE_RATE = 1.7; // rad/s
export const KEY_POWER_RATE = 54; // power units/s
/** Pointer drag: full power at this drag length (logical px); below the dead zone nothing is emitted;
 *  releasing inside the cancel radius of the press point cancels the shot. */
export const DRAG_FULL_POWER_PX = 240;
export const DRAG_DEAD_ZONE_PX = 24;
export const DRAG_CANCEL_RADIUS_PX = 24;
/** Press-to-grab radius around the active ball (logical px) for mouse and for touch. */
export const DRAG_GRAB_RADIUS_PX = 48;
export const DRAG_GRAB_RADIUS_TOUCH_PX = 80;

// ---------------------------------------------------------------------------------------------
// Shared pure helpers (the ONLY rounding helpers; sim, serialize, protocol and view all use these)
// ---------------------------------------------------------------------------------------------

/** 2 dp: positions, velocities, compiled level y values. Idempotent: quantize2(quantize2(v)) === quantize2(v). */
export function quantize2(v: number): number {
  return Math.round(v * 100) / 100;
}
/** 4 dp: aim angles. */
export function quantize4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
/** 1 dp: aim power. */
export function quantize1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Medal thresholds relative to par (team strokes). */
export function medalFor(teamStrokes: number, par: number): Medal {
  if (teamStrokes < par) return 'gold';
  if (teamStrokes === par) return 'silver';
  if (teamStrokes <= par + 2) return 'bronze';
  return 'none';
}

/** Player palette (view + UI read these; the sim never does). Frozen. */
export const PLAYER_COLOURS: Readonly<Record<PlayerId, string>> = Object.freeze({ 0: '#ff5d73', 1: '#50b7ff' });
export const PLAYER_GATE_COLOUR: Readonly<Record<PlayerId, GateColour>> = Object.freeze({ 0: 'red', 1: 'blue' });
export const PLAYER_NAMES: Readonly<Record<PlayerId, string>> = Object.freeze({ 0: 'Red', 1: 'Blue' });

export const PHASE_CODES: Readonly<Record<SimPhase, PhaseCode>> = Object.freeze({
  intro: 0,
  aiming: 1,
  flying: 2,
  levelResults: 3,
  campaignResults: 4,
});
export const PHASES_BY_CODE: Readonly<Record<PhaseCode, SimPhase>> = Object.freeze([
  'intro',
  'aiming',
  'flying',
  'levelResults',
  'campaignResults',
] as const);
