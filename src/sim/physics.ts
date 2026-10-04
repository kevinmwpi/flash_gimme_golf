// OWNER: sim
/**
 * Ball integration + collisions (ARCH.md §1.4, physics-notes §3-§5). One tick of one ball is
 * `stepBall`; the step order in physics-notes §3 is binding and each numbered step is one small
 * function below. Numbers come only from types.ts (two local tolerances quoted from the notes are
 * named at the top). `Math.sin/cos` appear ONLY in `launchVelocity`.
 */
import type { Collider, Contact } from './terrain';
import {
  collidersFor,
  deepestContact,
  distanceToCup,
  groundAt,
  groundSupports,
  hasSupport,
  isRectActive,
  pointInPiece,
  rectContains,
  solidColliders,
  vec,
  clamp,
} from './terrain';
import type {
  Aim,
  BallState,
  BounceSurface,
  BumperRect,
  FanRect,
  Hole,
  Level,
  LevelRect,
  PlayerId,
  PressureSwitch,
  SandRect,
  SimEventBody,
  SpringRect,
  Vec,
} from './types';
import {
  AIR_DRAG,
  BALL_RADIUS,
  BOUNCE_EVENT_MIN_IMPACT,
  BRIDGE_RESTITUTION,
  BUMPER_SIDE_KICK,
  BUMPER_SPEED,
  CEILING_Y,
  DT,
  FALL_PENALTY,
  FAN_FORCE,
  FAN_MAX_LIFT,
  GATE_RESTITUTION,
  GIMME_RADIUS,
  GRAVITY,
  GROUND_RESTITUTION,
  KILL_MARGIN,
  LIP_OUT_DAMP,
  MAX_BALL_SPEED,
  MAX_SUBSTEPS,
  NEAR_CUP_RADIUS,
  PAD_MIN_IMPACT,
  PLAYER_GATE_COLOUR,
  REST_MAX_SLOPE,
  REST_SPEED,
  REST_TICKS,
  ROLL_DAMP,
  ROLL_FRICTION,
  SAND_ROLL_DAMP,
  SHOT_SPEED_PER_POWER,
  SINK_INSET,
  SINK_MAX_SPEED,
  SLOPE_GRAVITY_SCALE,
  SUBSTEP_MAX_MOVE,
  SUNK_BALL_DROP,
  SWITCH_CONTACT_TOLERANCE,
  WALL_RESTITUTION,
  quantize2,
} from './types';

export type BallContext = {
  level: Level;
  switches: Readonly<Record<string, boolean>>;
  playerId: PlayerId;
  /** collidersFor(solidColliders(level, switches), playerId), computed once per tick by stepSim. */
  colliders: readonly Collider[];
  /** The owner's level strokes BEFORE this tick, so sink/gimme/fellOffWorld can report totals (default 0). */
  strokes?: number;
};

export type StepBallOut = { events: SimEventBody[] };

export type ShotOutcome = 'rest' | 'sink' | 'gimme' | 'fell' | 'running';

/** Skin left between a resolved ball and the surface (physics-notes §3 step 3: `R - distance + 0.05`). */
const CONTACT_SKIN = 0.05;
/** Height band around the rim in which a ball counts as "near" the cup (physics-notes §4.9). */
const CUP_RIM_TOLERANCE = 8;

const SLOTS: readonly PlayerId[] = [0, 1];

/** Mutable per-tick scratch; never stored in SimState. */
type Tick = {
  px: number;
  py: number;
  vx: number;
  vy: number;
  startX: number;
  startY: number;
  wasGrounded: boolean;
  contact: Contact | null;
  onSand: boolean;
  impact: number;
};

/** Launch velocity for an aim. speed = power * SHOT_SPEED_PER_POWER. The ONLY place sin/cos are used in sim/. */
export function launchVelocity(aim: Aim): Vec {
  const speed = aim.power * SHOT_SPEED_PER_POWER;
  return { x: Math.cos(aim.angle) * speed, y: Math.sin(aim.angle) * speed };
}

/**
 * Advance ONE ball by one tick (DT). Mutates `ball` (callers pass a spread copy) and assigns NEW Vec
 * objects to pos/vel/lastRest. Pushes event bodies into `out.events`. Returns the strokes to add to
 * THIS BALL'S OWNER (0, FALL_PENALTY, or 1 for a gimme).
 */
export function stepBall(ball: BallState, ctx: BallContext, out: StepBallOut): number {
  if (ball.sunk) return 0;
  if (ball.asleep && !wakeIfNeeded(ball, ctx, out)) return 0;
  const t: Tick = {
    px: ball.pos.x,
    py: ball.pos.y,
    vx: ball.vel.x,
    vy: ball.vel.y,
    startX: ball.pos.x,
    startY: ball.pos.y,
    wasGrounded: ball.grounded,
    contact: null,
    onSand: false,
    impact: 0,
  };
  applyForces(t, ctx);
  integrate(t, ctx, out);
  emitFanEntries(t, ctx, out);
  applyPads(t, ctx, out);
  emitGatePasses(t, ctx, out);
  applyBounds(t, ctx, out);
  if (t.py > ctx.level.height + KILL_MARGIN) return respawn(ball, t, ctx, out);
  applyRolling(t);
  capSpeed(t);
  ball.grounded = t.contact !== null;
  ball.pos = { x: t.px, y: t.py };
  ball.vel = { x: t.vx, y: t.vy };
  if (tryCup(ball, t, ctx, out)) return 0;
  return settle(ball, ctx, out);
}

// ---- step 1: sleeping balls -----------------------------------------------------------------------

function wake(ball: BallState): void {
  ball.asleep = false;
  ball.restTicks = 0;
}

/** Returns true when the sleeping ball must be stepped this tick. */
function wakeIfNeeded(ball: BallState, ctx: BallContext, out: StepBallOut): boolean {
  const fan = fanContaining(ctx.level, ctx.switches, ball.pos);
  if (fan !== null) {
    wake(ball);
    out.events.push({ type: 'fan', playerId: ctx.playerId, pos: ball.pos, rectId: fan.id });
    return true;
  }
  if (insideSolidRect(ball.pos, ctx.colliders)) {
    wake(ball);
    return true;
  }
  if (hasSupport(ctx.level, ctx.switches, ball, ctx.playerId)) return false;
  wake(ball);
  return true;
}

/** D2: a door that closed on a parked ball; the normal contact resolution ejects it through the nearest face. */
function insideSolidRect(pos: Vec, colliders: readonly Collider[]): boolean {
  for (const c of colliders) if (c.kind === 'rect' && rectContains(c.rect, pos)) return true;
  return false;
}

function fanContaining(level: Level, switches: Readonly<Record<string, boolean>>, p: Vec): FanRect | null {
  for (const rect of level.rects) {
    if (rect.kind === 'fan' && isRectActive(rect, switches) && rectContains(rect, p)) return rect;
  }
  return null;
}

// ---- step 2: forces ---------------------------------------------------------------------------------

function applyForces(t: Tick, ctx: BallContext): void {
  t.vy += GRAVITY * DT;
  t.vx += ctx.level.wind * DT;
  for (const rect of ctx.level.rects) {
    if (rect.kind !== 'fan' || !isRectActive(rect, ctx.switches) || !rectContains(rect, { x: t.px, y: t.py })) continue;
    t.vy -= (rect.force ?? FAN_FORCE) * DT;
    t.vy = Math.max(t.vy, -FAN_MAX_LIFT);
  }
}

/** `fan` fires once per entry: the AABB contains the end position but not the start position. */
function emitFanEntries(t: Tick, ctx: BallContext, out: StepBallOut): void {
  const start: Vec = { x: t.startX, y: t.startY };
  const end: Vec = { x: t.px, y: t.py };
  for (const rect of ctx.level.rects) {
    if (rect.kind !== 'fan' || !isRectActive(rect, ctx.switches)) continue;
    if (rectContains(rect, end) && !rectContains(rect, start)) {
      out.events.push({ type: 'fan', playerId: ctx.playerId, pos: end, rectId: rect.id });
    }
  }
}

// ---- step 3: sub-stepped integration + contact resolution ------------------------------------------

function integrate(t: Tick, ctx: BallContext, out: StepBallOut): void {
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
  const n = clamp(Math.ceil((speed * DT) / SUBSTEP_MAX_MOVE), 1, MAX_SUBSTEPS);
  const h = DT / n;
  for (let s = 0; s < n; s += 1) {
    t.px += t.vx * h;
    t.py += t.vy * h;
    for (let iter = 0; iter < 2; iter += 1) {
      const hit = deepestContact({ x: t.px, y: t.py }, ctx.colliders);
      if (hit === null) break;
      resolveContact(t, hit, ctx, out);
    }
    ejectFromPieces(t, ctx);
  }
}

type Response = { e: number; surface: BounceSurface | null; sand: boolean };

/** Contact response table (physics-notes §3). `surface` null = wrong-colour gate (hazardBlock instead of bounce). */
function responseFor(hit: Contact, top: boolean, x: number, ctx: BallContext): Response {
  const c = hit.collider;
  if (c.kind === 'terrain') {
    if (!top) return { e: WALL_RESTITUTION, surface: 'dirtWall', sand: false };
    const sand = sandAt(ctx.level, ctx.switches, x) !== null;
    return { e: sand ? 0 : GROUND_RESTITUTION, surface: 'grass', sand };
  }
  switch (c.rect.kind) {
    case 'bridge': {
      const sand = top && sandAt(ctx.level, ctx.switches, x) !== null;
      return { e: sand ? 0 : BRIDGE_RESTITUTION, surface: 'bridge', sand };
    }
    case 'blocker':
      return { e: WALL_RESTITUTION, surface: 'blocker', sand: false };
    case 'colourGate':
      return { e: GATE_RESTITUTION, surface: null, sand: false };
  }
}

function resolveContact(t: Tick, hit: Contact, ctx: BallContext, out: StepBallOut): void {
  const n = hit.normal;
  const push = BALL_RADIUS - hit.distance + CONTACT_SKIN;
  t.px += n.x * push;
  t.py += n.y * push;
  const top = n.y < -0.5;
  const vIn = t.vx * n.x + t.vy * n.y;
  if (vIn < 0) {
    const r = responseFor(hit, top, t.px, ctx);
    if (r.sand) t.onSand = true;
    t.vx -= n.x * (1 + r.e) * vIn;
    t.vy -= n.y * (1 + r.e) * vIn;
    const impact = -vIn;
    if (impact >= BOUNCE_EVENT_MIN_IMPACT) emitImpact(t, hit, r.surface, impact, ctx, out);
    if (top) t.impact = Math.max(t.impact, impact);
  }
  if (top) t.contact = hit;
}

function emitImpact(
  t: Tick,
  hit: Contact,
  surface: BounceSurface | null,
  impact: number,
  ctx: BallContext,
  out: StepBallOut,
): void {
  const pos: Vec = { x: t.px, y: t.py };
  if (surface === null) {
    if (hit.collider.kind === 'rect' && hit.collider.rect.kind === 'colourGate') {
      const gate = hit.collider.rect;
      out.events.push({ type: 'hazardBlock', playerId: ctx.playerId, pos, rectId: gate.id, colour: gate.colour });
    }
    return;
  }
  out.events.push({
    type: 'bounce',
    playerId: ctx.playerId,
    pos,
    normal: hit.normal,
    strength: Math.min(1, impact / MAX_BALL_SPEED),
    surface,
  });
}

/** Belt-and-braces: a centre inside a piece is moved to the closest edge and its inward velocity zeroed. */
function ejectFromPieces(t: Tick, ctx: BallContext): void {
  for (const c of ctx.colliders) {
    if (c.kind !== 'terrain' || !pointInPiece(c.piece, { x: t.px, y: t.py })) continue;
    const hit = deepestContact({ x: t.px, y: t.py }, [c]);
    if (hit === null) continue;
    const push = BALL_RADIUS - hit.distance + CONTACT_SKIN;
    t.px += hit.normal.x * push;
    t.py += hit.normal.y * push;
    const vIn = t.vx * hit.normal.x + t.vy * hit.normal.y;
    if (vIn < 0) {
      t.vx -= hit.normal.x * vIn;
      t.vy -= hit.normal.y * vIn;
    }
    if (hit.normal.y < -0.5 && t.contact === null) t.contact = hit;
  }
}

// ---- step 4: flush pads ---------------------------------------------------------------------------

type Pad = SandRect | SpringRect | BumperRect;

function isPad(rect: LevelRect): rect is Pad {
  return rect.kind === 'sand' || rect.kind === 'spring' || rect.kind === 'bumper';
}

function sandAt(level: Level, switches: Readonly<Record<string, boolean>>, x: number): SandRect | null {
  for (const rect of level.rects) {
    if (rect.kind === 'sand' && isRectActive(rect, switches) && x >= rect.x && x <= rect.x + rect.w) return rect;
  }
  return null;
}

/** First ACTIVE pad (level.rects order) whose x-range contains x. */
function padAt(level: Level, switches: Readonly<Record<string, boolean>>, x: number): Pad | null {
  for (const rect of level.rects) {
    if (isPad(rect) && isRectActive(rect, switches) && x >= rect.x && x <= rect.x + rect.w) return rect;
  }
  return null;
}

function contactIsPadSurface(contact: Contact): boolean {
  return contact.collider.kind === 'terrain' || contact.collider.rect.kind === 'bridge';
}

/** Tangent of a contact normal, oriented so tangent.x >= 0. */
function tangentOf(n: Vec): Vec {
  const tangent: Vec = { x: -n.y, y: n.x };
  return tangent.x < 0 ? { x: -tangent.x, y: -tangent.y } : tangent;
}

function applyPads(t: Tick, ctx: BallContext, out: StepBallOut): void {
  const contact = t.contact;
  if (contact === null || !contactIsPadSurface(contact)) return;
  const pad = padAt(ctx.level, ctx.switches, t.px);
  if (pad === null) return;
  const pos: Vec = { x: t.px, y: t.py };
  switch (pad.kind) {
    case 'sand': {
      t.onSand = true;
      const rolledIn = t.startX < pad.x || t.startX > pad.x + pad.w;
      if (!t.wasGrounded || rolledIn) out.events.push({ type: 'enterSand', playerId: ctx.playerId, pos, rectId: pad.id });
      return;
    }
    case 'spring':
      t.vx = pad.launch.x;
      t.vy = pad.launch.y;
      t.contact = null;
      out.events.push({ type: 'spring', playerId: ctx.playerId, pos, rectId: pad.id, launch: pad.launch });
      return;
    case 'bumper': {
      if (t.impact < PAD_MIN_IMPACT) return;
      const n = contact.normal;
      const tangent = tangentOf(n);
      const vt = t.vx * tangent.x + t.vy * tangent.y;
      const side = t.px >= pad.x + pad.w / 2 ? 1 : -1;
      const along = vt + side * BUMPER_SIDE_KICK;
      t.vx = n.x * BUMPER_SPEED + tangent.x * along;
      t.vy = n.y * BUMPER_SPEED + tangent.y * along;
      t.contact = null;
      out.events.push({ type: 'bumper', playerId: ctx.playerId, pos, rectId: pad.id, outVel: { x: t.vx, y: t.vy } });
      return;
    }
  }
}

// ---- step 5: colour gates of the ball's own colour -------------------------------------------------

function emitGatePasses(t: Tick, ctx: BallContext, out: StepBallOut): void {
  const mine = PLAYER_GATE_COLOUR[ctx.playerId];
  for (const rect of ctx.level.rects) {
    if (rect.kind !== 'colourGate' || rect.colour !== mine || !isRectActive(rect, ctx.switches)) continue;
    const cx = rect.x + rect.w / 2;
    const crossed = (t.startX - cx) * (t.px - cx) < 0;
    const within = t.py >= rect.y - BALL_RADIUS && t.py <= rect.y + rect.h + BALL_RADIUS;
    if (crossed && within) {
      out.events.push({ type: 'gatePass', playerId: ctx.playerId, pos: { x: t.px, y: t.py }, rectId: rect.id, colour: rect.colour });
    }
  }
}

// ---- step 6: level edges + ceiling ---------------------------------------------------------------

function edgeBounce(t: Tick, normal: Vec, impact: number, surface: BounceSurface, ctx: BallContext, out: StepBallOut): void {
  if (impact < BOUNCE_EVENT_MIN_IMPACT) return;
  out.events.push({
    type: 'bounce',
    playerId: ctx.playerId,
    pos: { x: t.px, y: t.py },
    normal,
    strength: Math.min(1, impact / MAX_BALL_SPEED),
    surface,
  });
}

function applyBounds(t: Tick, ctx: BallContext, out: StepBallOut): void {
  const right = ctx.level.width - BALL_RADIUS;
  if (t.px < BALL_RADIUS) {
    t.px = BALL_RADIUS;
    if (t.vx < 0) {
      const impact = -t.vx;
      t.vx = -t.vx * WALL_RESTITUTION;
      edgeBounce(t, { x: 1, y: 0 }, impact, 'levelEdge', ctx, out);
    }
  } else if (t.px > right) {
    t.px = right;
    if (t.vx > 0) {
      const impact = t.vx;
      t.vx = -t.vx * WALL_RESTITUTION;
      edgeBounce(t, { x: -1, y: 0 }, impact, 'levelEdge', ctx, out);
    }
  }
  if (t.py < CEILING_Y) {
    t.py = CEILING_Y;
    if (t.vy < 0) {
      const impact = -t.vy;
      t.vy = 0;
      edgeBounce(t, { x: 0, y: 1 }, impact, 'ceiling', ctx, out);
    }
  }
}

// ---- step 7: kill line ----------------------------------------------------------------------------

function respawn(ball: BallState, t: Tick, ctx: BallContext, out: StepBallOut): number {
  const respawnPos = ball.lastRest;
  out.events.push({
    type: 'fellOffWorld',
    playerId: ctx.playerId,
    pos: { x: t.px, y: t.py },
    respawnPos,
    strokes: (ctx.strokes ?? 0) + FALL_PENALTY,
  });
  ball.pos = respawnPos;
  ball.vel = { x: 0, y: 0 };
  ball.asleep = true;
  ball.restTicks = REST_TICKS;
  ball.grounded = true;
  return FALL_PENALTY;
}

// ---- steps 8-9: rolling friction / air drag, speed cap ---------------------------------------------

function applyRolling(t: Tick): void {
  if (t.contact === null) {
    t.vx *= AIR_DRAG;
    return;
  }
  const tangent = tangentOf(t.contact.normal);
  const gTan = GRAVITY * tangent.y * SLOPE_GRAVITY_SCALE;
  t.vx += tangent.x * gTan * DT;
  t.vy += tangent.y * gTan * DT;
  const damp = t.onSand ? SAND_ROLL_DAMP : ROLL_DAMP;
  t.vx *= damp;
  t.vy *= damp;
  applyRollFriction(t);
}

/** Static-friction floor: a constant speed loss of ROLL_FRICTION * DT per tick that stops a roll instead of reversing it. */
function applyRollFriction(t: Tick): void {
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
  const loss = ROLL_FRICTION * DT;
  if (speed <= loss) {
    t.vx = 0;
    t.vy = 0;
    return;
  }
  const k = (speed - loss) / speed;
  t.vx *= k;
  t.vy *= k;
}

function capSpeed(t: Tick): void {
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
  if (speed > MAX_BALL_SPEED) {
    const k = MAX_BALL_SPEED / speed;
    t.vx *= k;
    t.vy *= k;
  }
}

// ---- step 11: swept cup test ----------------------------------------------------------------------

function cupPosition(level: Level): Vec {
  return { x: level.hole.x, y: level.hole.rimY + SUNK_BALL_DROP };
}

function sinkBall(ball: BallState, ctx: BallContext): void {
  ball.sunk = true;
  ball.asleep = true;
  ball.pos = cupPosition(ctx.level);
  ball.vel = { x: 0, y: 0 };
}

/** True when x is inside the sink window: |x - hole.x| <= hole.radius - SINK_INSET (12 px). */
function overCup(hole: Hole, x: number): boolean {
  return Math.abs(x - hole.x) <= hole.radius - SINK_INSET;
}

/** A ball at rim height counts; an airborne one only within CUP_RIM_TOLERANCE of the ground beneath it. */
function atRimHeight(ball: BallState, ctx: BallContext): boolean {
  if (ball.grounded) return true;
  const g = groundAt(ctx.level, ctx.switches, ball.pos, ctx.playerId);
  return g !== null && g.y - (ball.pos.y + BALL_RADIUS) <= CUP_RIM_TOLERANCE;
}

/**
 * Swept cup test (physics-notes §4.9). Returns true when the ball dropped in (the tick ends there: no
 * rest test). A slow ball over the window, or sweeping through it, sinks. Every crossing that does not
 * sink lips out exactly once, on the tick the ball LEAVES the window (or jumps it whole in one tick) -
 * never while still over it: damping it over the cup would bring the speed under SINK_MAX_SPEED one
 * tick later with the ball still in the window, and one crossing would report both a lipOut and a sink.
 * The ball can only have been over the cup without dropping because it was too fast there, so the
 * lip-out needs no second speed test on the way out.
 */
function tryCup(ball: BallState, t: Tick, ctx: BallContext, out: StepBallOut): boolean {
  const hole = ctx.level.hole;
  if (Math.abs(ball.pos.y + BALL_RADIUS - hole.rimY) > CUP_RIM_TOLERANCE) return false;
  const over = overCup(hole, ball.pos.x);
  const wasOver = overCup(hole, t.startX);
  const crossed = (t.startX - hole.x) * (ball.pos.x - hole.x) <= 0;
  if (!over && !wasOver && !crossed) return false;
  if (!atRimHeight(ball, ctx)) return false;
  const speed = vec.len(ball.vel);
  const pos = ball.pos;
  if (speed <= SINK_MAX_SPEED && (over || crossed)) {
    sinkBall(ball, ctx);
    out.events.push({ type: 'sink', playerId: ctx.playerId, pos, strokes: ctx.strokes ?? 0, speed });
    return true;
  }
  if (over) return false;
  ball.vel = { x: ball.vel.x * LIP_OUT_DAMP, y: ball.vel.y };
  out.events.push({ type: 'lipOut', playerId: ctx.playerId, pos, speed });
  return false;
}

// ---- step 12: rest test + gimme -------------------------------------------------------------------

function settle(ball: BallState, ctx: BallContext, out: StepBallOut): number {
  const g = groundAt(ctx.level, ctx.switches, ball.pos, ctx.playerId);
  const slow = vec.len(ball.vel) < REST_SPEED;
  // Same support rule as wakeIfNeeded: a ball creeping off a corner (centre past the edge, ground far
  // below) is not at rest, so it never sleeps, records a mid-air lastRest or hands the turn off there.
  const candidate = ball.grounded && slow && g !== null && g.slope < REST_MAX_SLOPE && groundSupports(g, ball.pos);
  ball.restTicks = candidate ? ball.restTicks + 1 : 0;
  if (!candidate || g === null || ball.restTicks < REST_TICKS) return 0;
  ball.vel = { x: 0, y: 0 };
  ball.asleep = true;
  ball.pos = { x: quantize2(ball.pos.x), y: quantize2(ball.pos.y) };
  if (g.permanent) ball.lastRest = ball.pos;
  const restPos = ball.pos;
  const d = distanceToCup(ctx.level, restPos);
  if (d <= GIMME_RADIUS) {
    sinkBall(ball, ctx);
    out.events.push({ type: 'gimme', playerId: ctx.playerId, pos: restPos, strokes: (ctx.strokes ?? 0) + 1 });
    return 1;
  }
  out.events.push({ type: 'ballRest', playerId: ctx.playerId, pos: restPos, onPermanentGround: g.permanent });
  if (d <= NEAR_CUP_RADIUS) out.events.push({ type: 'nearCup', playerId: ctx.playerId, pos: restPos, distance: d });
  return 0;
}

// ---- switches -----------------------------------------------------------------------------------------

/**
 * The slot whose ball holds `sw` right now: a RESTING (asleep) ball with its centre x inside the plate's
 * x-range and its bottom within SWITCH_CONTACT_TOLERANCE of surfaceY, standing over a piece — or over the
 * plate's own rect for a deck plate (LEVELS.md plate rule, BUILD_DECISIONS D2). A plate is held, not
 * pressed: a ball rolling or bouncing across it never presses, so a landing presses exactly once, on its
 * `ballRest` tick, however hard it hits (a grounded-or-height test chattered the door through every
 * bounce hop). Release is immediate the tick the holder starts moving: `shoot` and every wake clear
 * `asleep` before the switches are evaluated.
 */
export function switchPresser(
  level: Level,
  sw: PressureSwitch,
  switches: Readonly<Record<string, boolean>>,
  balls: readonly Readonly<BallState>[],
): PlayerId | null {
  for (const i of SLOTS) {
    const ball = balls[i];
    if (ball === undefined || ball.sunk || !ball.asleep) continue;
    if (ball.pos.x < sw.x || ball.pos.x > sw.x + sw.w) continue;
    if (Math.abs(ball.pos.y + BALL_RADIUS - sw.surfaceY) > SWITCH_CONTACT_TOLERANCE) continue;
    const g = groundAt(level, switches, ball.pos, i);
    if (g === null) continue;
    if (sw.onRectId === undefined) {
      if (g.source === 'piece') return i;
      continue;
    }
    if (g.source !== 'piece' && level.rects[g.index]?.id === sw.onRectId) return i;
  }
  return null;
}

/** Pressed state for every switch from the balls' CURRENT contact (after all balls stepped). */
export function evaluateSwitches(
  level: Level,
  previous: Readonly<Record<string, boolean>>,
  balls: readonly Readonly<BallState>[],
): Record<string, boolean> {
  const anySunk = balls.some((b) => b.sunk);
  const result: Record<string, boolean> = {};
  for (const sw of level.switches) {
    const heldFromCup = anySunk && level.cupHoldsSwitch === sw.id;
    result[sw.id] = heldFromCup || switchPresser(level, sw, previous, balls) !== null;
  }
  return result;
}

/** true when the ball no longer needs stepping for turn purposes (asleep or sunk). */
export function isSettled(ball: Readonly<BallState>): boolean {
  return ball.sunk || ball.asleep;
}

// ---- aim preview ------------------------------------------------------------------------------------

/**
 * Aim preview: runs the REAL stepBall on scratch copies of the shot ball AND the other balls,
 * re-evaluating switches every scratch tick exactly as stepSim does. Never emits events.
 */
export function predictShot(
  level: Level,
  switches: Readonly<Record<string, boolean>>,
  ball: Readonly<BallState>,
  playerId: PlayerId,
  aim: Aim,
  otherBalls: readonly Readonly<BallState>[],
  maxTicks = 150,
): { points: Vec[]; landing: Vec | null; outcome: ShotOutcome } {
  const scratch: BallState = { ...ball, vel: launchVelocity(aim), asleep: false, restTicks: 0, grounded: false };
  const others: BallState[] = otherBalls.map((b) => ({ ...b }));
  const otherSlot = (j: number): PlayerId => (j < playerId ? j : j + 1) as PlayerId;
  const slots: BallState[] = [];
  slots[playerId] = scratch;
  others.forEach((b, j) => {
    slots[otherSlot(j)] = b;
  });
  let sw: Record<string, boolean> = { ...switches };
  const out: StepBallOut = { events: [] };
  const points: Vec[] = [];
  let landing: Vec | null = null;
  let outcome: ShotOutcome = 'running';
  for (let i = 0; i < maxTicks; i += 1) {
    const colliders = solidColliders(level, sw);
    stepBall(scratch, { level, switches: sw, playerId, colliders: collidersFor(colliders, playerId) }, out);
    for (let j = 0; j < others.length; j += 1) {
      const other = others[j];
      const slot = otherSlot(j);
      if (other !== undefined) stepBall(other, { level, switches: sw, playerId: slot, colliders: collidersFor(colliders, slot) }, out);
    }
    sw = evaluateSwitches(level, sw, slots);
    points.push(scratch.pos);
    if (landing === null && scratch.grounded) landing = scratch.pos;
    if (scratch.sunk) {
      outcome = out.events.some((e) => e.type === 'gimme') ? 'gimme' : 'sink';
      break;
    }
    if (out.events.some((e) => e.type === 'fellOffWorld' && e.playerId === playerId)) {
      outcome = 'fell';
      break;
    }
    if (scratch.asleep) {
      outcome = 'rest';
      break;
    }
    out.events.length = 0;
  }
  return { points, landing, outcome };
}
