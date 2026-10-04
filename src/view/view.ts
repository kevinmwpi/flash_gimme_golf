// OWNER: view
/**
 * ViewState (ARCH.md §1.8): camera, particles, trails, shake, golfer anims, callouts — everything the
 * rules do not need, rebuilt from SimEvents (VISUAL.md §13 is the event -> juice table). View code
 * may use Math.random / performance.now; it never writes to SimState. Every field beyond the ARCH
 * contract is additive and only read by src/view.
 */
import type { Aim, BallState, Level, LevelRect, MutVec, PlayerId, PressureSwitch, SimEvent, SimState, Vec } from '../sim/types';
import { BALL_RADIUS, MAX_POWER, VIEWPORT_H, VIEWPORT_W } from '../sim/types';
import { isRectActive } from '../sim/terrain';
import { PALETTE, PLAYER_VIEW } from './render/palette';
import { COPY, gateWord, switchHeldCallout } from './render/text';

export type CameraMode = 'follow' | 'overview';
/** world->screen: (p - cam) * zoom */
export type Camera = { x: number; y: number; zoom: number };
export type InputDevice = 'keyboard' | 'pointer' | 'touch' | 'gamepad';
export type ParticleShape = 'disc' | 'square' | 'streak';
export type Particle = {
  pos: MutVec;
  vel: MutVec;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  gravity: number;
  shape: ParticleShape;
};
export type GolferFace = 'smile' | 'focus' | 'wow' | 'grin' | 'sad';
export type GolferMove = 'walk' | 'hop' | 'pop';
export type GolferAnim = {
  pos: MutVec;
  facing: 1 | -1;
  walkFrom: Vec;
  /** 0..1 progress of the current move (1 = arrived). */
  walkT: number;
  /** Seconds since the last ballHit (>= SWING_DURATION when idle). */
  swingT: number;
  /** Idle clock for breathing / bob. */
  bobT: number;
  walkTo: Vec;
  walkDur: number;
  move: GolferMove;
  /** Seconds since cheer / sad started (>= their duration when inactive). */
  cheerT: number;
  sadT: number;
  /** Live aim power 0..1 while aiming (drives the backswing and the tongue). */
  power: number;
  aiming: boolean;
  blinkT: number;
  nextBlink: number;
  fidgetT: number;
  nextFidget: number;
  fidgetKind: 0 | 1 | 2;
  /** x the golfer is watching (own ball in flight) or null. */
  watchX: number | null;
  /** Seconds since the golfer last finished a move (debounces facing flips). */
  idleSince: number;
};
export type CalloutKind =
  | 'gimme'
  | 'sink'
  | 'oob'
  | 'turn'
  | 'hazard'
  | 'nearCup'
  | 'switch'
  | 'spring'
  | 'bumper'
  | 'sand'
  | 'fan'
  | 'bridge';
export type Callout = {
  id: number;
  text: string;
  worldPos: Vec | null;
  colour: string;
  bornAt: number;
  ttl: number;
  kind: CalloutKind;
  sizePx: number;
  sub?: string;
  subColour?: string;
  stars?: boolean;
};
export type BallHop = { from: Vec; to: Vec; t: number };
export type RenderBall = {
  pos: MutVec;
  /** Squash along `squashAngle` (1 = round). */
  squash: number;
  /** 0..1 shrink into the hole after `sink`. */
  sinkT: number;
  visible: boolean;
  snapNextFrame: boolean;
  squashAngle: number;
  /** Pop-in scale (respawn / sink). */
  scale: number;
  /** Highlight orbit angle (rolling). */
  roll: number;
  hop: BallHop | null;
  inSand: boolean;
};
export type AimPreview = { points: Vec[]; landing: Vec | null; outcome: string; playerId: PlayerId; remote: boolean };
export type DragVisual = { pointer: Vec; cancel: boolean; clamped: boolean };
/** The follow camera held for one turn: valid while the same player aims from the same ball position. */
export type AimCamera = { player: PlayerId; ball: Vec; cam: Camera };
export type GateAnim = { kind: 'pass' | 'block'; t: number };
export type CupAnim = { kick: number; squash: number; pulse: number; wiggle: number };

export type ViewState = {
  level: Level;
  camera: Camera;
  cameraTarget: Camera;
  cameraMode: CameraMode;
  userCameraOverride: boolean;
  shake: { amp: number; t: number; dur: number };
  particles: Particle[];
  trails: [Vec[], Vec[]];
  golfers: [GolferAnim, GolferAnim];
  renderBalls: [RenderBall, RenderBall];
  /** rectId -> seconds since triggered (spring squash, bumper pulse, fan boost) */
  padAnims: Map<string, number>;
  /** switchId -> 0..1 pressed depth */
  switchAnims: Map<string, number>;
  /** bridge/blocker solidity 0..1 (slide-in) */
  rectAnims: Map<string, number>;
  callouts: Callout[];
  aimPreview: AimPreview | null;
  lastDevice: InputDevice;
  /** view clock for wobble/clouds (never fed to the sim) */
  timeSec: number;
  /** Pointer drag visuals (world coords), set by the loop while a slingshot drag is live. */
  drag: DragVisual | null;
  /** Follow target latched for the whole aiming phase of a turn, so the world never re-targets under a drag. */
  aimCamera: AimCamera | null;
  /** Miss feedback (UX.md §5.2): rings expanding from the active ball since `bornAt` (view seconds). */
  missRings: { pos: Vec; bornAt: number } | null;
  gateAnims: Map<string, GateAnim>;
  /** rectId / switchId -> seconds since its sticker pulsed */
  stickerPulse: Map<string, number>;
  cup: CupAnim;
  /** Remaining seconds of the ink screen flash. */
  flash: number;
  levelTime: number;
  pendingOverviewAt: number | null;
  reducedMotion: boolean;
  /** xorshift state for confetti colours/spread (never the sim rng). */
  rng: number;
  /** Ball x at the last ballHit per player (decides hop vs pop on a gap). */
  shotFromX: [number, number];
  gimmeSeen: boolean;
  nextCalloutId: number;
};

/** Follow camera keeps the active ball at this fraction of the viewport width (aiming right / left). */
const FOLLOW_FRACTION_RIGHT = 0.45;
const FOLLOW_FRACTION_LEFT = 0.55;
/** Overview camera puts the ground band at this fraction of the viewport height. */
const OVERVIEW_GROUND_FRACTION = 0.7;
const CAMERA_LERP_RATE = 8;
const MAX_PARTICLES = 40;
const MAX_CALLOUTS = 2;
const TRAIL_LENGTH = 6;
const TRAIL_EVERY_TICKS = 2;
export const SWING_DURATION = 0.47;
const SWING_CONTACT_AT = 0.09;
const WALK_DURATION = 0.35;
const POP_DURATION = 0.12;
const CHEER_DURATION = 0.8;
const SAD_DURATION = 0.6;
const GOLFER_STAND_BACK_PX = 42;
/** Tight address used when the usual stand point would put the golfer's shoes on the partner's ball. */
const GOLFER_STAND_CLOSE_PX = 26;
/** The waiting golfer keeps at least this far from the active one (bodies are 44 px wide, tees 50 px apart). */
const GOLFER_MIN_GAP_PX = 64;
/** A golfer's shoes (11 px behind, 17 px ahead of its x) clear a resting ball's centre by this much. */
const GOLFER_BALL_CLEAR_PX = 24;
/** Golfers stand at least this far inside the level edges (the follow camera never shows past them). */
const GOLFER_EDGE_PX = 26;
/** Ahead of the active ball, the aim arc crosses a standing golfer's body for about this far. */
const AIM_ARC_LOW_PX = 220;
/** Behind the active golfer, its backswing club (~60 px back) would meet the partner's club (30 px ahead of it) closer than this. */
const BACKSWING_CLEAR_PX = 92;
const FACING_FLIP_DEBOUNCE = 0.25;
const SWITCH_PRESS_RATE = 1 / 0.06;
const SWITCH_RELEASE_RATE = 1 / 0.09;
const BRIDGE_IN_RATE = 1 / 0.2;
const BRIDGE_OUT_RATE = 1 / 0.15;
const GIMME_HOP_DURATION = 0.4;
const SINK_SHRINK_DURATION = 0.25;
const RESPAWN_POP_DURATION = 0.2;
const LEVEL_COMPLETE_OVERVIEW_DELAY = 0.6;
const FLASH_DURATION = 0.034;
const CALLOUT_TTL = 1.1;
const CALLOUT_SIZE = 44;
const CALLOUT_SMALL = 28;
const CALLOUT_TINY = 20;

function golferFor(state: SimState, playerId: PlayerId, width: number): GolferAnim {
  const { pos: stand, facing } = standFor(state, playerId, width);
  const pos = { x: stand.x, y: stand.y };
  return {
    pos,
    facing,
    walkFrom: { ...pos },
    walkT: 1,
    swingT: SWING_DURATION,
    bobT: playerId * 0.7,
    walkTo: { ...pos },
    walkDur: WALK_DURATION,
    move: 'walk',
    cheerT: CHEER_DURATION,
    sadT: SAD_DURATION,
    power: 0,
    aiming: false,
    blinkT: 1,
    nextBlink: 3 + playerId,
    fidgetT: 1,
    nextFidget: 5 + playerId * 2,
    fidgetKind: 0,
    watchX: null,
    idleSince: 1,
  };
}

function renderBallFor(state: SimState, playerId: PlayerId): RenderBall {
  const ball = state.balls[playerId];
  return {
    pos: { x: ball.pos.x, y: ball.pos.y },
    squash: 1,
    sinkT: ball.sunk ? 1 : 0,
    visible: !ball.sunk,
    snapNextFrame: false,
    squashAngle: 0,
    scale: 1,
    roll: 0,
    hop: null,
    inSand: false,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createViewState(level: Level, state: SimState): ViewState {
  const mode: CameraMode = state.phase === 'intro' ? 'overview' : 'follow';
  const camera = cameraFor(level, state, mode);
  return {
    level,
    camera: { ...camera },
    cameraTarget: camera,
    cameraMode: mode,
    userCameraOverride: false,
    shake: { amp: 0, t: 0, dur: 1 },
    particles: [],
    trails: [[], []],
    golfers: [golferFor(state, 0, level.width), golferFor(state, 1, level.width)],
    renderBalls: [renderBallFor(state, 0), renderBallFor(state, 1)],
    padAnims: new Map(),
    switchAnims: new Map(),
    rectAnims: new Map(),
    callouts: [],
    aimPreview: null,
    lastDevice: 'keyboard',
    timeSec: 0,
    drag: null,
    aimCamera: null,
    missRings: null,
    gateAnims: new Map(),
    stickerPulse: new Map(),
    cup: { kick: 1, squash: 1, pulse: 1, wiggle: 1 },
    flash: 0,
    levelTime: 0,
    pendingOverviewAt: null,
    reducedMotion: prefersReducedMotion(),
    rng: (state.config.seed ^ 0x9e3779b9) >>> 0 || 1,
    shotFromX: [state.balls[0].pos.x, state.balls[1].pos.x],
    gimmeSeen: false,
    nextCalloutId: 1,
  };
}

// ---- small helpers -----------------------------------------------------------------------------

/** xorshift32 on the view's own state; returns [0, 1). */
function viewRandom(view: ViewState): number {
  let x = view.rng;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  view.rng = x === 0 ? 1 : x;
  return x / 4294967296;
}

function spawn(view: ViewState, p: Omit<Particle, 'life'>): void {
  if (view.particles.length >= MAX_PARTICLES) view.particles.shift();
  view.particles.push({ ...p, life: p.maxLife });
}

/** n puffs around `pos` with a mostly-upward spread (dust, sand, sparks). */
function spawnPuffs(view: ViewState, pos: Vec, n: number, colour: string, speed: number, size: [number, number], life: number, up = true): void {
  for (let i = 0; i < n; i += 1) {
    const a = up ? -Math.PI * (0.15 + 0.7 * viewRandom(view)) : Math.PI * 2 * viewRandom(view);
    const s = speed * (0.5 + viewRandom(view));
    const sz = size[0] + (size[1] - size[0]) * viewRandom(view);
    spawn(view, {
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(a) * s, y: Math.sin(a) * s },
      maxLife: life,
      size: sz,
      colour,
      gravity: 300,
      shape: 'disc',
    });
  }
}

function spawnConfetti(view: ViewState, pos: Vec, n: number, spread: number, life: number): void {
  const colours = [PALETTE.p1, PALETTE.p2, PALETTE.sun];
  for (let i = 0; i < n; i += 1) {
    const colour = colours[i % colours.length] ?? PALETTE.sun;
    spawn(view, {
      pos: { x: pos.x + (viewRandom(view) - 0.5) * spread, y: pos.y - viewRandom(view) * 20 },
      vel: { x: (viewRandom(view) - 0.5) * 320, y: -180 - viewRandom(view) * 260 },
      maxLife: life,
      size: 6,
      colour,
      gravity: 400,
      shape: 'square',
    });
  }
}

function shake(view: ViewState, amp: number, dur: number): void {
  if (view.reducedMotion) return;
  if (amp < view.shake.amp * (view.shake.t / view.shake.dur)) return;
  view.shake = { amp, t: dur, dur };
}

function pushCallout(view: ViewState, c: Omit<Callout, 'id' | 'bornAt' | 'ttl'> & { ttl?: number }): void {
  while (view.callouts.length >= MAX_CALLOUTS) view.callouts.shift();
  view.callouts.push({ ...c, id: view.nextCalloutId, bornAt: view.timeSec, ttl: c.ttl ?? CALLOUT_TTL });
  view.nextCalloutId += 1;
}

function squashBall(rb: RenderBall, amount: number, angle: number): void {
  rb.squash = amount;
  rb.squashAngle = angle;
}

function rectById(level: Level, id: string): LevelRect | undefined {
  return level.rects.find((r) => r.id === id);
}

function switchIndex(level: Level, id: string): number {
  return level.switches.findIndex((s) => s.id === id);
}

function switchById(level: Level, id: string): PressureSwitch | undefined {
  return level.switches.find((s) => s.id === id);
}

function facingForAim(aim: Aim): 1 | -1 {
  return Math.cos(aim.angle) >= 0 ? 1 : -1;
}

function standPoint(ball: Vec, facing: 1 | -1): Vec {
  return { x: ball.x - facing * GOLFER_STAND_BACK_PX, y: ball.y + BALL_RADIUS };
}

type Stand = { pos: Vec; facing: 1 | -1 };

/** Where a ball is addressed from: a sunk ball at the cup, otherwise its last rest (never a mid-flight position). */
function restingPos(ball: Readonly<BallState>): Vec {
  return ball.sunk ? ball.pos : ball.lastRest;
}

/** The active golfer addresses its ball from 42 px back, or from 26 px when 42 would stand on the partner's ball. */
function activeStand(ball: Vec, facing: 1 | -1, partnerBall: Vec | null): Stand {
  const usual = standPoint(ball, facing);
  if (partnerBall === null || Math.abs(usual.x - partnerBall.x) >= GOLFER_BALL_CLEAR_PX) return { pos: usual, facing };
  return { pos: { x: ball.x - facing * GOLFER_STAND_CLOSE_PX, y: usual.y }, facing };
}

type StandCandidate = Stand & { preference: number };

/** How badly a waiting golfer at x crowds the scene: the active golfer and its backswing, a ball, the active aim arc, the level edges. */
function crowding(x: number, ownBall: Vec, active: Stand, activeBall: Vec, width: number): number {
  let cost = 0;
  if (Math.abs(x - active.pos.x) < GOLFER_MIN_GAP_PX) cost += 100;
  if (x < GOLFER_EDGE_PX || x > width - GOLFER_EDGE_PX) cost += 100;
  if (Math.abs(x - activeBall.x) < GOLFER_BALL_CLEAR_PX) cost += 50;
  if (Math.abs(x - ownBall.x) < GOLFER_BALL_CLEAR_PX) cost += 50;
  const ahead = active.facing * (x - activeBall.x);
  if (ahead > 0 && ahead < AIM_ARC_LOW_PX) cost += 10 + 20 * Math.min(1, ahead / 100);
  const behindActive = -active.facing * (x - active.pos.x);
  if (behindActive > 0 && behindActive < BACKSWING_CLEAR_PX) cost += 40;
  return cost;
}

/**
 * The waiting golfer picks the least crowded of: behind its ball, a tight address behind it, in front of
 * it (facing back), or behind the active golfer (clear of its backswing) watching the shot. It never
 * stands on either ball, keeps GOLFER_MIN_GAP_PX from the active golfer when it can, and stays out of
 * the low part of the active arc (where the dots would cross its face) whenever a clear spot exists.
 */
function waitingStand(ball: Vec, facing: 1 | -1, active: Stand, activeBall: Vec, width: number): Stand {
  const flipped: 1 | -1 = facing === 1 ? -1 : 1;
  const y = ball.y + BALL_RADIUS;
  const candidates: StandCandidate[] = [
    { pos: standPoint(ball, facing), facing, preference: 0 },
    { pos: { x: ball.x - facing * GOLFER_STAND_CLOSE_PX, y }, facing, preference: 2 },
    { pos: standPoint(ball, flipped), facing: flipped, preference: 4 },
    { pos: { x: active.pos.x - active.facing * BACKSWING_CLEAR_PX, y: active.pos.y }, facing: active.facing, preference: 3 },
    { pos: { x: active.pos.x + active.facing * GOLFER_MIN_GAP_PX, y }, facing: active.facing === 1 ? -1 : 1, preference: 5 },
  ];
  let best: StandCandidate | null = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = c.preference + crowding(c.pos.x, ball, active, activeBall, width);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return best === null ? { pos: standPoint(ball, facing), facing } : { pos: best.pos, facing: best.facing };
}

/** Stand point + facing of player p: the active golfer addresses its ball facing the shot; the other keeps clear. */
function standFor(state: SimState, p: PlayerId, width: number): Stand {
  const a = state.activePlayer;
  const activeBallState = state.balls[a];
  const activeBall = restingPos(activeBallState);
  const partner = state.balls[a === 0 ? 1 : 0];
  const active = activeStand(activeBall, facingForAim(state.players[a].aim), partner.sunk ? null : restingPos(partner));
  if (p === a) return active;
  return waitingStand(restingPos(state.balls[p]), facingForAim(state.players[p].aim), active, activeBall, width);
}

/** A gap with no active bridge between x1 and x2? */
function openGapBetween(level: Level, switches: Readonly<Record<string, boolean>>, x1: number, x2: number): boolean {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (const g of level.terrain.gaps) {
    if (g.x2 <= lo || g.x1 >= hi) continue;
    const bridged = level.rects.some((r) => r.kind === 'bridge' && r.x <= g.x1 && r.x + r.w >= g.x2 && isRectActive(r, switches));
    if (!bridged) return true;
  }
  return false;
}

function startMove(g: GolferAnim, to: Vec, move: GolferMove, facing: 1 | -1): void {
  g.walkFrom = { x: g.pos.x, y: g.pos.y };
  g.walkTo = to;
  g.walkT = 0;
  g.walkDur = move === 'pop' ? POP_DURATION : WALK_DURATION;
  g.move = move;
  g.facing = facing;
}

/** Send a golfer to stand behind its ball (VISUAL.md §6 walk / hop / pop rules). */
function relocateGolfer(view: ViewState, state: SimState, p: PlayerId, allowWalk: boolean): void {
  const g = view.golfers[p];
  const ball = state.balls[p];
  const { pos: to, facing } = standFor(state, p, view.level.width);
  if (Math.abs(to.x - g.pos.x) < 1 && Math.abs(to.y - g.pos.y) < 1 && g.facing === facing) return;
  const crossesGap = openGapBetween(view.level, state.switches, g.pos.x, to.x);
  const ballCrossed = openGapBetween(view.level, state.switches, view.shotFromX[p], ball.lastRest.x);
  const far = Math.abs(to.x - g.pos.x) > VIEWPORT_W * 0.6;
  let move: GolferMove = 'walk';
  if (crossesGap) move = ballCrossed ? 'hop' : 'pop';
  else if (!allowWalk || far) move = 'pop';
  startMove(g, to, move, facing);
}

function resetAnims(view: ViewState): void {
  view.particles.length = 0;
  view.trails[0].length = 0;
  view.trails[1].length = 0;
  view.callouts.length = 0;
  view.padAnims.clear();
  view.gateAnims.clear();
  view.stickerPulse.clear();
  view.shake = { amp: 0, t: 0, dur: 1 };
  view.aimPreview = null;
  view.drag = null;
  view.aimCamera = null;
  view.missRings = null;
  view.pendingOverviewAt = null;
}

/** Miss feedback (UX.md §5.2): three rings expand from the active ball for MISS_RINGS_SEC. */
export const MISS_RINGS_SEC = 0.6;

export function pulseMissRings(view: ViewState, state: SimState): void {
  view.missRings = { pos: { ...state.balls[state.activePlayer].pos }, bornAt: view.timeSec };
}

/** 0..1 progress of the live miss rings, or null once they have faded. */
export function missRingsProgress(view: ViewState): number | null {
  if (view.missRings === null) return null;
  const t = (view.timeSec - view.missRings.bornAt) / MISS_RINGS_SEC;
  if (t >= 1) {
    view.missRings = null;
    return null;
  }
  return Math.max(0, t);
}

/**
 * Hard reset for levelStart / levelRestart: balls snap, golfers pop to their tees. The camera opens
 * in overview only for an intro; a restart or a resumed `?state=` link that is already in play follows.
 */
function resetForLevel(view: ViewState, state: SimState): void {
  resetAnims(view);
  view.switchAnims.clear();
  view.rectAnims.clear();
  for (const r of view.level.rects) view.rectAnims.set(r.id, isRectActive(r, state.switches) ? 1 : 0);
  view.levelTime = 0;
  view.shotFromX = [state.balls[0].pos.x, state.balls[1].pos.x];
  for (const p of [0, 1] as const) {
    view.renderBalls[p] = renderBallFor(state, p);
    view.renderBalls[p].snapNextFrame = true;
    view.golfers[p] = golferFor(state, p, view.level.width);
  }
  view.cameraMode = state.phase === 'intro' ? 'overview' : 'follow';
  view.userCameraOverride = false;
}

// ---- events -----------------------------------------------------------------------------------

const PUFF_COLOUR: Record<string, string> = {
  grass: PALETTE.white,
  dirtWall: PALETTE.dirtSh,
  levelEdge: PALETTE.dirtSh,
  ceiling: PALETTE.dirtSh,
  bridge: PALETTE.plankSh,
  blocker: PALETTE.sunSh,
};

function applyEvent(view: ViewState, e: SimEvent, state: SimState): void {
  const level = view.level;
  switch (e.type) {
    case 'levelStart':
    case 'levelRestart':
      if (e.type === 'levelRestart') view.flash = FLASH_DURATION * 2;
      resetForLevel(view, state);
      break;
    case 'playStart':
      view.cameraMode = 'follow';
      view.userCameraOverride = false;
      relocateGolfer(view, state, state.activePlayer, false);
      break;
    case 'turnStart':
      relocateGolfer(view, state, e.playerId, true);
      relocateGolfer(view, state, e.playerId === 0 ? 1 : 0, false);
      view.golfers[e.playerId].watchX = null;
      break;
    case 'ballHit': {
      const g = view.golfers[e.playerId];
      g.swingT = SWING_CONTACT_AT;
      g.aiming = false;
      g.watchX = e.pos.x;
      view.shotFromX[e.playerId] = e.pos.x;
      spawnPuffs(view, { x: e.pos.x, y: e.pos.y + BALL_RADIUS }, 8, PALETTE.white, 120, [4, 7], 0.3);
      squashBall(view.renderBalls[e.playerId], 1.15, e.angle);
      view.trails[e.playerId].length = 0;
      view.renderBalls[e.playerId].inSand = false;
      shake(view, (2 * e.power) / MAX_POWER, 0.08);
      break;
    }
    case 'bounce': {
      const n = 3 + Math.round(e.strength * 3);
      spawnPuffs(view, e.pos, n, PUFF_COLOUR[e.surface] ?? PALETTE.white, 90 + 120 * e.strength, [3, 6], 0.25);
      squashBall(view.renderBalls[e.playerId], 1.2, Math.atan2(e.normal.y, e.normal.x) + Math.PI / 2);
      if (e.strength > 0.6) shake(view, 3, 0.1);
      break;
    }
    case 'enterSand':
      spawnPuffs(view, e.pos, 6, PALETTE.sand, 110, [4, 7], 0.3);
      squashBall(view.renderBalls[e.playerId], 1.15, 0);
      view.renderBalls[e.playerId].inSand = true;
      view.stickerPulse.set(e.rectId, 0);
      pushCallout(view, { text: COPY.callouts.sand, worldPos: e.pos, colour: PALETTE.sand, kind: 'sand', sizePx: CALLOUT_SMALL });
      break;
    case 'spring':
      view.padAnims.set(e.rectId, 0);
      spawnPuffs(view, e.pos, 8, PALETTE.sun, 200, [5, 5], 0.4);
      shake(view, 3, 0.12);
      pushCallout(view, { text: COPY.callouts.spring, worldPos: e.pos, colour: PALETTE.sun, kind: 'spring', sizePx: CALLOUT_SIZE });
      break;
    case 'bumper':
      view.padAnims.set(e.rectId, 0);
      shake(view, 4, 0.1);
      pushCallout(view, { text: COPY.callouts.bumper, worldPos: e.pos, colour: PALETTE.bump, kind: 'bumper', sizePx: CALLOUT_SIZE });
      break;
    case 'fan':
      view.padAnims.set(e.rectId, 0);
      pushCallout(view, { text: COPY.callouts.fan, worldPos: e.pos, colour: PALETTE.windAccent, kind: 'fan', sizePx: CALLOUT_SMALL });
      break;
    case 'gatePass':
      view.gateAnims.set(e.rectId, { kind: 'pass', t: 0 });
      break;
    case 'hazardBlock': {
      const col = e.colour === 'red' ? PALETTE.p1 : PALETTE.p2;
      view.gateAnims.set(e.rectId, { kind: 'block', t: 0 });
      view.stickerPulse.set(e.rectId, 0);
      spawnPuffs(view, e.pos, 5, col, 160, [4, 6], 0.3, false);
      squashBall(view.renderBalls[e.playerId], 0.7, 0);
      view.golfers[e.playerId].sadT = 0;
      shake(view, 3, 0.12);
      pushCallout(view, {
        text: COPY.callouts.locked,
        worldPos: e.pos,
        colour: col,
        kind: 'hazard',
        sizePx: CALLOUT_SIZE,
        sub: `${e.colour.toUpperCase()} ONLY`,
        subColour: PALETTE.white,
      });
      break;
    }
    case 'switchOn': {
      const sw = switchById(level, e.switchId);
      view.stickerPulse.set(e.switchId, 0);
      for (let i = 0; i < 4; i += 1) {
        spawn(view, {
          pos: { x: e.pos.x + (i < 2 ? -30 : 30), y: e.pos.y - 6 - (i % 2) * 8 },
          vel: { x: (i < 2 ? -1 : 1) * 60, y: -40 },
          maxLife: 0.2,
          size: 3,
          colour: PALETTE.ink,
          gravity: 0,
          shape: 'streak',
        });
      }
      pushCallout(view, {
        text: switchHeldCallout(sw?.label, switchIndex(level, e.switchId)),
        worldPos: { x: e.pos.x, y: e.pos.y - 20 },
        colour: PALETTE.sw,
        kind: 'switch',
        sizePx: CALLOUT_TINY,
      });
      break;
    }
    case 'switchOff':
      break;
    case 'bridgeToggle': {
      const rect = rectById(level, e.rectId);
      if (rect === undefined) break;
      const centre = { x: rect.x + rect.w / 2, y: rect.y };
      if (rect.kind === 'bridge') {
        if (!e.active) spawnPuffs(view, centre, 4, PALETTE.plank, 120, [5, 7], 0.4, false);
        pushCallout(view, {
          text: e.active ? COPY.callouts.bridgeOn : COPY.callouts.bridgeOff,
          worldPos: centre,
          colour: e.active ? PALETTE.mint : PALETTE.bump,
          kind: 'bridge',
          sizePx: CALLOUT_SMALL,
        });
      } else if (rect.kind === 'blocker') {
        const word = gateWord(rect.label, switchIndex(level, e.switchId));
        pushCallout(view, {
          text: `${word} ${e.active ? COPY.callouts.gateShut : COPY.callouts.gateOpen}`,
          worldPos: { x: centre.x, y: rect.y + rect.h / 2 },
          colour: e.active ? PALETTE.bump : PALETTE.mint,
          kind: 'bridge',
          sizePx: CALLOUT_SMALL,
        });
      }
      break;
    }
    case 'fellOffWorld': {
      const rb = view.renderBalls[e.playerId];
      const col = PLAYER_VIEW[e.playerId].col;
      spawn(view, {
        pos: { x: e.pos.x, y: Math.min(e.pos.y, VIEWPORT_H + 40) },
        vel: { x: 0, y: 160 },
        maxLife: 0.3,
        size: BALL_RADIUS * 2,
        colour: col,
        gravity: 400,
        shape: 'disc',
      });
      rb.snapNextFrame = true;
      rb.scale = 0;
      rb.hop = null;
      view.trails[e.playerId].length = 0;
      view.golfers[e.playerId].sadT = 0;
      view.flash = FLASH_DURATION;
      shake(view, 6, 0.25);
      pushCallout(view, { text: COPY.callouts.oob, worldPos: e.respawnPos, colour: PALETTE.bump, kind: 'oob', sizePx: CALLOUT_SIZE });
      break;
    }
    case 'ballRest':
      view.trails[e.playerId].length = 0;
      view.renderBalls[e.playerId].inSand = false;
      break;
    case 'nearCup':
      view.cup.pulse = 0;
      pushCallout(view, { text: COPY.callouts.soClose, worldPos: e.pos, colour: PALETTE.white, kind: 'nearCup', sizePx: CALLOUT_SMALL });
      break;
    case 'lipOut':
      view.cup.squash = 0;
      pushCallout(view, { text: COPY.callouts.soClose, worldPos: e.pos, colour: PALETTE.white, kind: 'nearCup', sizePx: CALLOUT_SMALL });
      break;
    case 'gimme': {
      const rb = view.renderBalls[e.playerId];
      const to = { x: level.hole.x, y: level.hole.rimY - BALL_RADIUS };
      rb.hop = { from: { x: rb.pos.x, y: rb.pos.y }, to, t: 0 };
      view.cup.wiggle = 0;
      view.gimmeSeen = true;
      spawnConfetti(view, { x: level.hole.x, y: level.hole.rimY }, 10, 40, 0.7);
      view.golfers[0].cheerT = 0;
      view.golfers[1].cheerT = 0;
      pushCallout(view, { text: COPY.callouts.gimme, worldPos: to, colour: PALETTE.mint, kind: 'gimme', sizePx: CALLOUT_SIZE * 1.3, stars: true });
      break;
    }
    case 'sink': {
      const rb = view.renderBalls[e.playerId];
      if (rb.hop === null) {
        rb.snapNextFrame = true;
        rb.sinkT = 0.0001;
        view.cup.kick = 0;
        spawnConfetti(view, { x: level.hole.x, y: level.hole.rimY }, 12, 40, 0.7);
        view.golfers[0].cheerT = 0;
        view.golfers[1].cheerT = 0;
        shake(view, 3, 0.15);
        pushCallout(view, { text: COPY.callouts.sink, worldPos: e.pos, colour: PALETTE.mint, kind: 'sink', sizePx: CALLOUT_SIZE });
      }
      view.trails[e.playerId].length = 0;
      break;
    }
    case 'levelComplete':
      view.pendingOverviewAt = view.timeSec + LEVEL_COMPLETE_OVERVIEW_DELAY;
      break;
    case 'campaignComplete':
      spawnConfetti(view, { x: view.camera.x + VIEWPORT_W / 2, y: view.camera.y - 20 }, 30, VIEWPORT_W, 2);
      view.golfers[0].cheerT = 0;
      view.golfers[1].cheerT = 0;
      view.pendingOverviewAt = view.timeSec;
      break;
    case 'commandRejected':
      break;
  }
}

/** Apply a tick's events (particles, shake, callouts, trails, pad/switch/bridge anims, golfer walk). */
export function applySimEvents(view: ViewState, events: readonly SimEvent[], state: SimState): void {
  for (const e of events) applyEvent(view, e, state);
}

// ---- per-frame update -------------------------------------------------------------------------

function interpolateBall(view: ViewState, p: PlayerId, prev: SimState, next: SimState, alpha: number): void {
  const rb = view.renderBalls[p];
  const a = prev.balls[p];
  const b = next.balls[p];
  if (rb.hop !== null) return;
  if (rb.snapNextFrame || b.sunk) {
    rb.pos.x = b.pos.x;
    rb.pos.y = b.pos.y;
    rb.snapNextFrame = false;
    return;
  }
  const dx = b.pos.x - a.pos.x;
  rb.pos.x = a.pos.x + dx * alpha;
  rb.pos.y = a.pos.y + (b.pos.y - a.pos.y) * alpha;
  if (b.grounded) rb.roll += dx / BALL_RADIUS;
}

function updateBallAnims(view: ViewState, p: PlayerId, next: SimState, dt: number): void {
  const rb = view.renderBalls[p];
  const b = next.balls[p];
  if (rb.hop !== null) {
    rb.hop.t = Math.min(1, rb.hop.t + dt / GIMME_HOP_DURATION);
    const k = rb.hop.t;
    rb.pos.x = rb.hop.from.x + (rb.hop.to.x - rb.hop.from.x) * k;
    rb.pos.y = rb.hop.from.y + (rb.hop.to.y - rb.hop.from.y) * k - Math.sin(k * Math.PI) * 60;
    if (k >= 1) {
      rb.hop = null;
      rb.snapNextFrame = true;
      rb.sinkT = 0.0001;
      view.cup.kick = 0;
    }
  }
  if (rb.sinkT > 0 && rb.sinkT < 1) rb.sinkT = Math.min(1, rb.sinkT + dt / SINK_SHRINK_DURATION);
  rb.visible = rb.hop !== null || !b.sunk || rb.sinkT < 1;
  if (rb.scale < 1) rb.scale = Math.min(1, rb.scale + dt / RESPAWN_POP_DURATION);
  rb.squash += (1 - rb.squash) * Math.min(1, dt * 14);
  if (!b.asleep && !b.sunk && rb.hop === null) {
    const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
    if (!b.grounded && speed > 0) {
      rb.squash = Math.max(rb.squash, Math.min(1.15, 1 + speed / 2400));
      rb.squashAngle = Math.atan2(b.vel.y, b.vel.x);
    }
    if (next.tick % TRAIL_EVERY_TICKS === 0) {
      const trail = view.trails[p];
      const last = trail[trail.length - 1];
      if (last === undefined || last.x !== b.pos.x || last.y !== b.pos.y) {
        trail.push({ x: b.pos.x, y: b.pos.y });
        if (trail.length > TRAIL_LENGTH) trail.shift();
      }
    }
  }
}

function moveGolfer(g: GolferAnim, dt: number): void {
  if (g.walkT >= 1) {
    g.idleSince += dt;
    return;
  }
  g.walkT = Math.min(1, g.walkT + dt / g.walkDur);
  const k = g.move === 'pop' ? 1 : g.walkT;
  g.pos.x = g.walkFrom.x + (g.walkTo.x - g.walkFrom.x) * k;
  g.pos.y = g.walkFrom.y + (g.walkTo.y - g.walkFrom.y) * k;
  if (g.move === 'hop') g.pos.y -= Math.sin(g.walkT * Math.PI) * 24;
  if (g.walkT >= 1) g.idleSince = 0;
}

function tickGolferTimers(g: GolferAnim, dt: number): void {
  g.bobT += dt;
  g.swingT = Math.min(SWING_DURATION, g.swingT + dt);
  g.cheerT = Math.min(CHEER_DURATION, g.cheerT + dt);
  g.sadT = Math.min(SAD_DURATION, g.sadT + dt);
  g.blinkT += dt;
  if (g.blinkT >= g.nextBlink) {
    g.blinkT = 0;
    g.nextBlink = 3 + (g.bobT % 2);
  }
  g.fidgetT += dt;
  if (g.fidgetT >= g.nextFidget) {
    g.fidgetT = 0;
    g.nextFidget = 4 + (g.bobT % 3);
    g.fidgetKind = (Math.floor(g.bobT * 7) % 3) as 0 | 1 | 2;
  }
}

function updateGolfers(view: ViewState, next: SimState, dt: number): void {
  const active = next.activePlayer;
  const aim = next.players[active].aim;
  for (const p of [0, 1] as const) {
    const g = view.golfers[p];
    tickGolferTimers(g, dt);
    moveGolfer(g, dt);
    const isAiming = next.phase === 'aiming' && p === active && g.swingT >= SWING_DURATION;
    g.aiming = isAiming;
    g.power = isAiming ? aim.power / MAX_POWER : 0;
    if (isAiming && g.walkT >= 1 && g.idleSince > FACING_FLIP_DEBOUNCE && facingForAim(aim) !== g.facing) {
      relocateGolfer(view, next, p, true);
    }
    if (next.phase === 'flying' && !next.balls[p].asleep && !next.balls[p].sunk) g.watchX = next.balls[p].pos.x;
    else if (next.phase !== 'flying') g.watchX = null;
  }
}

function ageMapTimers(map: Map<string, number>, dt: number): void {
  for (const [k, v] of map) map.set(k, v + dt);
}

function tween(map: Map<string, number>, key: string, target: number, rate: number, dt: number): void {
  const v = map.get(key) ?? target;
  const step = rate * dt;
  map.set(key, v < target ? Math.min(target, v + step) : Math.max(target, v - step));
}

function updateMechanicAnims(view: ViewState, next: SimState, dt: number): void {
  ageMapTimers(view.padAnims, dt);
  ageMapTimers(view.stickerPulse, dt);
  for (const [k, g] of view.gateAnims) {
    g.t += dt;
    if (g.t > 1) view.gateAnims.delete(k);
  }
  for (const sw of view.level.switches) {
    const pressed = next.switches[sw.id] === true;
    tween(view.switchAnims, sw.id, pressed ? 1 : 0, pressed ? SWITCH_PRESS_RATE : SWITCH_RELEASE_RATE, dt);
  }
  for (const r of view.level.rects) {
    if (r.switchId === undefined && r.switchIds === undefined) continue;
    const active = isRectActive(r, next.switches);
    tween(view.rectAnims, r.id, active ? 1 : 0, active ? BRIDGE_IN_RATE : BRIDGE_OUT_RATE, dt);
  }
}

function updateParticles(view: ViewState, dt: number): void {
  const alive: Particle[] = [];
  for (const p of view.particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vel.y += p.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    alive.push(p);
  }
  view.particles = alive;
}

/** Fan streaks: one white streak per frame on every non-sunk ball inside an active fan (VISUAL.md §4). */
function spawnFanStreaks(view: ViewState, next: SimState): void {
  for (const r of view.level.rects) {
    if (r.kind !== 'fan' || !isRectActive(r, next.switches)) continue;
    for (const b of next.balls) {
      if (b.sunk || b.pos.x < r.x || b.pos.x > r.x + r.w || b.pos.y < r.y || b.pos.y > r.y + r.h) continue;
      spawn(view, {
        pos: { x: b.pos.x + (viewRandom(view) - 0.5) * 24, y: b.pos.y + BALL_RADIUS },
        vel: { x: 0, y: -260 },
        maxLife: 0.25,
        size: 3,
        colour: PALETTE.white,
        gravity: 0,
        shape: 'streak',
      });
    }
  }
}

function updateCallouts(view: ViewState): void {
  view.callouts = view.callouts.filter((c) => view.timeSec - c.bornAt < c.ttl);
}

/**
 * Follow target for this frame. During `aiming` it is computed once per turn from the stored aim and
 * held: a live drag re-aims every frame, and re-targeting (lead side) would slide the world
 * under the pointer the moment a pull crosses vertical. A new player, a moved ball or any other phase
 * re-evaluates.
 */
function followTarget(view: ViewState, next: SimState): Camera {
  if (next.phase !== 'aiming') {
    view.aimCamera = null;
    return cameraFor(view.level, next, 'follow');
  }
  const player = next.activePlayer;
  const ball = next.balls[player].pos;
  const held = view.aimCamera;
  if (held !== null && held.player === player && held.ball.x === ball.x && held.ball.y === ball.y) return held.cam;
  const cam = cameraFor(view.level, next, 'follow');
  view.aimCamera = { player, ball: { x: ball.x, y: ball.y }, cam };
  return cam;
}

function updateCamera(view: ViewState, next: SimState, dt: number): void {
  if (view.pendingOverviewAt !== null && view.timeSec >= view.pendingOverviewAt) {
    view.pendingOverviewAt = null;
    if (!view.userCameraOverride) view.cameraMode = 'overview';
  }
  if ((next.phase === 'intro' || next.phase === 'campaignResults') && !view.userCameraOverride) view.cameraMode = 'overview';
  view.cameraTarget = view.cameraMode === 'overview' ? cameraFor(view.level, next, 'overview') : followTarget(view, next);
  const k = 1 - Math.exp(-CAMERA_LERP_RATE * dt);
  view.camera.x += (view.cameraTarget.x - view.camera.x) * k;
  view.camera.y += (view.cameraTarget.y - view.camera.y) * k;
  view.camera.zoom += (view.cameraTarget.zoom - view.camera.zoom) * k;
}

/**
 * Per-frame: interpolate balls (prev->next by alpha) unless snapNextFrame (then copy next and clear
 * the flag), tween camera, age particles/callouts, advance golfer anims. Sunk balls are never interpolated.
 */
export function updateView(view: ViewState, prev: SimState, next: SimState, alpha: number, dt: number): void {
  view.timeSec += dt;
  view.levelTime += dt;
  for (const p of [0, 1] as const) {
    interpolateBall(view, p, prev, next, alpha);
    updateBallAnims(view, p, next, dt);
  }
  updateGolfers(view, next, dt);
  updateMechanicAnims(view, next, dt);
  spawnFanStreaks(view, next);
  updateParticles(view, dt);
  updateCallouts(view);
  view.cup.kick += dt;
  view.cup.squash += dt;
  view.cup.pulse += dt;
  view.cup.wiggle += dt;
  view.flash = Math.max(0, view.flash - dt);
  view.shake.t = Math.max(0, view.shake.t - dt);
  updateCamera(view, next, dt);
}

export function setCameraMode(view: ViewState, mode: CameraMode, user: boolean): void {
  view.cameraMode = mode;
  view.userCameraOverride = user;
}

/** Current screen-shake offset in logical px (linear decay, VISUAL.md §13). */
export function shakeOffset(view: ViewState): Vec {
  if (view.shake.t <= 0 || view.reducedMotion) return { x: 0, y: 0 };
  const k = (view.shake.amp * view.shake.t) / view.shake.dur;
  const t = view.timeSec * 90;
  return { x: Math.sin(t * 1.3) * k, y: Math.cos(t * 1.7) * k };
}

/** Logical 1280x720 space. */
export function worldToScreen(view: ViewState, p: Vec): Vec {
  return { x: (p.x - view.camera.x) * view.camera.zoom, y: (p.y - view.camera.y) * view.camera.zoom };
}

export function screenToWorld(view: ViewState, p: Vec): Vec {
  return { x: p.x / view.camera.zoom + view.camera.x, y: p.y / view.camera.zoom + view.camera.y };
}

function followCamera(level: Level, state: SimState): Camera {
  const ball = state.balls[state.activePlayer];
  const aim = state.players[state.activePlayer].aim;
  const aimingRight = facingForAim(aim) === 1;
  const aiming = state.phase === 'aiming';
  const fraction = aiming && !aimingRight ? FOLLOW_FRACTION_LEFT : FOLLOW_FRACTION_RIGHT;
  const wanted = ball.pos.x - VIEWPORT_W * fraction;
  const maxX = Math.max(0, level.width - VIEWPORT_W);
  return { x: Math.min(maxX, Math.max(0, wanted)), y: 0, zoom: 1 };
}

/**
 * follow: active ball at 45% width (55% when aiming left), y fixed 0, zoom 1, always clamped to the
 * level (no overscan, BUILD_DECISIONS D7: the pointer scales full power to the stage room instead);
 * overview: zoom = min(1280/width, 1), centred, ground at ~70%
 * height.
 */
export function cameraFor(level: Level, state: SimState, mode: CameraMode): Camera {
  if (mode === 'overview') {
    const zoom = Math.min(VIEWPORT_W / level.width, 1);
    const x = (level.width - VIEWPORT_W / zoom) / 2;
    const y = level.hole.rimY - (VIEWPORT_H * OVERVIEW_GROUND_FRACTION) / zoom;
    return { x, y, zoom };
  }
  return followCamera(level, state);
}
