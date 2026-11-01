// OWNER: view
/**
 * TRAP and CANNON art (worlds-2-3 LEVELS.md "Look and label", BUILD_DECISIONS D10.4; VISUAL.md §1-§2 rules).
 * The trap is steel jaws that read by silhouette: SET with the teeth up while armed, FOLDED FLAT while open,
 * CLOSED around a caught ball (drawn after the balls). The cannon is an iron barrel along its launch vector
 * on a wooden cradle, with a fuse lamp (mint LIT / grey COLD) and the dotted arc of its real flight.
 * A trap's geometry is derived once per level from the terrain (its jaws stand on the trap's floor, beside the
 * plate of a seat); a cannon's comes from its breech alone (the cradle spans it). Device STATE is never derived
 * here: callers pass what sim/devices.ts says (armed, lit, caught).
 */
import { isCannonLit } from '../../sim/devices';
import { predictLaunch } from '../../sim/physics';
import { rectSwitchIds, switchMaskOf } from '../../sim/terrain';
import type { CannonRect, Level, LevelRect, PlayerId, PressureSwitch, TrapRect, Vec } from '../../sim/types';
import { BALL_RADIUS } from '../../sim/types';
import { lamp, switchGeometry } from './parts';
import { circle, clamp01, easeOut, fillStroke, INK, OUTLINE_DOT, OUTLINE_SMALL, OUTLINE_WIDTH, PALETTE, roundRect } from './palette';
import { fairwayYAt } from './surface';

/** Where a release / FIRE wire ends: it rises out of the dirt at x up to the hinge or lamp at lampY. */
export type WirePost = { readonly x: number; readonly lampY: number };

type Surface = (x: number) => number | null;

// ---- trap -------------------------------------------------------------------------------------------

/** Jaw band thickness, shortest and longest jaw, tooth height. */
const JAW_T = 6;
const JAW_MIN = 10;
const JAW_MAX = 20;
const TOOTH_H = 7;
const HINGE_R = 3.5;
/** Hinge pins sit this far inside the ends of the trap's floor, this high above it. */
const HINGE_INSET = 3;
const HINGE_LIFT = 5;
/** A seat's hinges stand clear of its plate's base. */
const SEAT_HINGE_GAP = 4;
const FLOOR_TOLERANCE = 1.5;
/** A set jaw leans this far outward from vertical (radians), so the pair gapes like a mouth, teeth up. */
const SET_LEAN = 0.6;
/** Closed jaws: arcs of this radius around the caught ball's centre, hinged beside its bottom (~145 deg -> ~268 deg). */
const CLOSED_R = 17;
const CLOSED_FROM = 2.53;
const CLOSED_TO = 4.68;
/** Teeth along each closed jaw (fractions of its arc), biting into the ball: height, half-width (radians). */
const CLOSED_TEETH = [0.16, 0.4, 0.64, 0.88] as const;
const CLOSED_TOOTH_H = 7;
const CLOSED_TOOTH_HALF = 0.12;
/** How far a closed jaw swings open about its hinge while it snaps shut or springs open (radians). */
const JAW_SWING = 1.2;
/** Snap shut (trapCaught) with an 8 % squeeze, spring open (trapFreed) past wide open then shrink away. */
export const SNAP_SEC = 0.16;
export const FREE_SEC = 0.3;
const SNAP_SQUEEZE = 0.08;
const FREE_SWING = 1.15;

export type TrapGeometry = {
  /** The floor the jaws stand on (the fairway at the zone centre, kept inside the zone). */
  readonly floorY: number;
  /** Left and right hinge pins. */
  readonly hinges: readonly [Vec, Vec];
  readonly jawLen: number;
  /** World angle of each jaw folded flat: inward over the base, or outward along the ground beside a seat plate. */
  readonly flatAngles: readonly [number, number];
  /** The steel base between the hinges (null for a seat: its plate is the pan). */
  readonly base: { readonly x1: number; readonly x2: number } | null;
  /** The plate lying inside the trap (L9 BAIT, L12 DOOR), else null. */
  readonly seat: PressureSwitch | null;
  readonly posts: readonly WirePost[];
};

/** The plate lying wholly inside a trap: a "seat" (one combined sticker, D10.8), else null. */
export function seatOf(level: Level, rect: TrapRect): PressureSwitch | null {
  const inside = (sw: PressureSwitch): boolean =>
    sw.onRectId === undefined && sw.x >= rect.x && sw.x + sw.w <= rect.x + rect.w && sw.surfaceY >= rect.y && sw.surfaceY <= rect.y + rect.h;
  return level.switches.find(inside) ?? null;
}

function hingePosts(hinges: readonly [Vec, Vec]): WirePost[] {
  return hinges.map((h) => ({ x: h.x, lampY: h.y }));
}

function buildTrap(rect: TrapRect, surface: Surface, seat: PressureSwitch | null): TrapGeometry {
  const cx = rect.x + rect.w / 2;
  const bottom = rect.y + rect.h;
  const atCentre = surface(cx);
  const floorY = atCentre !== null && atCentre >= rect.y && atCentre <= bottom ? atCentre : bottom;
  if (seat !== null) {
    const { cx: px, baseW } = switchGeometry(seat);
    const y = seat.surfaceY - HINGE_LIFT;
    const hinges: [Vec, Vec] = [
      { x: px - baseW / 2 - SEAT_HINGE_GAP, y },
      { x: px + baseW / 2 + SEAT_HINGE_GAP, y },
    ];
    const flatOut = (h: Vec, dir: 1 | -1): number => {
      const tipX = h.x + dir * JAW_MAX;
      const tipY = (surface(tipX) ?? seat.surfaceY) - HINGE_LIFT;
      return Math.atan2(tipY - h.y, tipX - h.x);
    };
    return { floorY: seat.surfaceY, hinges, jawLen: JAW_MAX, flatAngles: [flatOut(hinges[0], -1), flatOut(hinges[1], 1)], base: null, seat, posts: hingePosts(hinges) };
  }
  const onFloor = (x: number): boolean => {
    const s = surface(x);
    return s !== null && Math.abs(s - floorY) <= FLOOR_TOLERANCE;
  };
  let x1 = rect.x;
  let x2 = rect.x + rect.w;
  if (onFloor(cx)) {
    x1 = cx;
    x2 = cx;
    while (x1 - 1 >= rect.x && onFloor(x1 - 1)) x1 -= 1;
    while (x2 + 1 <= rect.x + rect.w && onFloor(x2 + 1)) x2 += 1;
  }
  const jawLen = Math.min(JAW_MAX, Math.max(JAW_MIN, (x2 - x1) / 2));
  const hinges: [Vec, Vec] = [
    { x: x1 + HINGE_INSET, y: floorY - HINGE_LIFT },
    { x: x2 - HINGE_INSET, y: floorY - HINGE_LIFT },
  ];
  return { floorY, hinges, jawLen, flatAngles: [0, Math.PI], base: { x1, x2 }, seat: null, posts: hingePosts(hinges) };
}

// ---- cannon -----------------------------------------------------------------------------------------

/** Barrel along the launch from the loaded ball's centre: body, reinforcing band, muzzle ring, half-widths. */
const BARREL_FROM = 2;
const BARREL_LEN = 58;
const BARREL_R = 13;
const MUZZLE_LEN = 13;
const MUZZLE_R = 16.5;
const BAND_AT = 24;
const BAND_LEN = 7;
const BAND_R = 15;
/**
 * The wooden cradle: a trough across the breech (the loaded ball sits in it) with a low back lip and a front
 * post that rises to the barrel's underside; the fuse lamp hangs on the post.
 */
const CRADLE_LIP_W = 7;
const CRADLE_LIP_H = 12;
const CRADLE_POST_W = 9;
const CRADLE_SINK = 6;
const CRADLE_SHADE = 5;
const LAMP_DOWN_POST = 9;
const RECOIL_PX = 7;
export const RECOIL_SEC = 0.3;
const ARC_DOT_EVERY = 5;
const ARC_DOT_R = 3.5;
const ARC_RING_R = 12;
const ARC_LIT_ALPHA = 0.9;
const ARC_COLD_ALPHA = 0.5;

export type CannonGeometry = {
  /** A loaded ball's centre: the barrel's axis starts here. */
  readonly seatPos: Vec;
  /** Unit launch vector and the unit normal toward the barrel's ground side. */
  readonly dir: Vec;
  readonly under: Vec;
  /** The wooden cradle (static): a trough across the breech with a front post under the barrel. */
  readonly cradle: readonly Vec[];
  /** The cradle's bottom plank (its one shade band). */
  readonly cradleBase: { readonly x1: number; readonly x2: number; readonly y: number };
  /** Fuse lamp on the front post. */
  readonly lampPos: Vec;
  readonly muzzle: Vec;
  readonly posts: readonly WirePost[];
};

function buildCannon(rect: CannonRect): CannonGeometry {
  const floor = rect.y;
  const seatPos = { x: rect.x + rect.w / 2, y: floor - BALL_RADIUS };
  const len = Math.sqrt(rect.launch.x * rect.launch.x + rect.launch.y * rect.launch.y) || 1;
  const dir = { x: rect.launch.x / len, y: rect.launch.y / len };
  const s = dir.x >= 0 ? 1 : -1;
  const under = s > 0 ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
  /** The barrel's underside line, at a world x (the front post's top follows it). */
  const undersideY = (x: number): number => {
    const ux = seatPos.x + under.x * BARREL_R;
    const uy = seatPos.y + under.y * BARREL_R;
    return Math.min(floor - CRADLE_LIP_H, uy + ((x - ux) / dir.x) * dir.y + 1);
  };
  const back = s > 0 ? rect.x : rect.x + rect.w;
  const front = s > 0 ? rect.x + rect.w : rect.x;
  const lipX = back - s * CRADLE_LIP_W;
  const postX = front + s * CRADLE_POST_W;
  const bottom = floor + CRADLE_SINK;
  const cradle: Vec[] = [
    { x: lipX, y: floor - CRADLE_LIP_H },
    { x: back, y: floor - CRADLE_LIP_H },
    { x: back, y: floor },
    { x: front, y: floor },
    { x: front, y: undersideY(front) },
    { x: postX, y: undersideY(postX) },
    { x: postX, y: bottom },
    { x: lipX, y: bottom },
  ];
  const lampPos = { x: (front + postX) / 2, y: undersideY((front + postX) / 2) + LAMP_DOWN_POST };
  return {
    seatPos,
    dir,
    under,
    cradle,
    cradleBase: { x1: Math.min(lipX, postX), x2: Math.max(lipX, postX), y: bottom },
    lampPos,
    muzzle: { x: seatPos.x + dir.x * BARREL_LEN, y: seatPos.y + dir.y * BARREL_LEN },
    posts: [{ x: lampPos.x, lampY: lampPos.y }],
  };
}

// ---- geometry caches (per compiled level; flat fallbacks for standalone drawRect callers) ------------

const trapCache = new WeakMap<Level, Map<string, TrapGeometry>>();
const flatTraps = new WeakMap<TrapRect, TrapGeometry>();
const cannons = new WeakMap<CannonRect, CannonGeometry>();

function cached<K extends object, V>(cache: WeakMap<K, Map<string, V>>, owner: K, id: string, build: () => V): V {
  let byId = cache.get(owner);
  if (byId === undefined) {
    byId = new Map();
    cache.set(owner, byId);
  }
  const hit = byId.get(id);
  if (hit !== undefined) return hit;
  const made = build();
  byId.set(id, made);
  return made;
}

export function trapGeometry(level: Level, rect: TrapRect): TrapGeometry {
  return cached(trapCache, level, rect.id, () => buildTrap(rect, (x) => fairwayYAt(level, x), seatOf(level, rect)));
}

/** Sand within this many px of a cannon breech is its funnel. */
const FUNNEL_TOUCH_PX = 2;

function touchesBreech(sand: LevelRect, cannon: CannonRect): boolean {
  return sand.kind === 'sand' && sand.x <= cannon.x + cannon.w + FUNNEL_TOUCH_PX && sand.x + sand.w >= cannon.x - FUNNEL_TOUCH_PX;
}

/** Funnel sand either side of a cannon breech is part of the device (D10.8): it carries no SAND label. */
export function isFunnelSand(level: Level, r: LevelRect): boolean {
  return level.rects.some((c) => c.kind === 'cannon' && touchesBreech(r, c));
}

/** The world x-span a cannon occupies on the ground: its cradle and its funnel sand. */
export function cannonSpan(level: Level, rect: CannonRect): { x1: number; x2: number } {
  let { x1, x2 } = cannonGeometry(rect).cradleBase;
  for (const r of level.rects) {
    if (!touchesBreech(r, rect)) continue;
    x1 = Math.min(x1, r.x);
    x2 = Math.max(x2, r.x + r.w);
  }
  return { x1, x2 };
}

/** A cannon's hardware stands on its breech (the cradle spans it), so it needs nothing but the rect. */
export function cannonGeometry(rect: CannonRect): CannonGeometry {
  let g = cannons.get(rect);
  if (g === undefined) {
    g = buildCannon(rect);
    cannons.set(rect, g);
  }
  return g;
}

/** A trap on a flat floor at its zone's bottom (drawRect without a level). */
export function flatTrapGeometry(rect: TrapRect): TrapGeometry {
  let g = flatTraps.get(rect);
  if (g === undefined) {
    g = buildTrap(rect, () => rect.y + rect.h, null);
    flatTraps.set(rect, g);
  }
  return g;
}

// ---- trap drawing -------------------------------------------------------------------------------------

/** World angle of jaw i between folded flat (set01 0) and set (1), turning the short way round. */
function jawAngle(g: TrapGeometry, i: 0 | 1, set01: number): number {
  const flat = g.flatAngles[i];
  let set = i === 0 ? -Math.PI / 2 - SET_LEAN : -Math.PI / 2 + SET_LEAN;
  while (set - flat > Math.PI) set -= Math.PI * 2;
  while (set - flat < -Math.PI) set += Math.PI * 2;
  return flat + (set - flat) * easeOut(set01);
}

/** One steel jaw from its hinge along `angle`; teeth on its `side` (local y sign), retracted when flat. */
function drawJaw(ctx: CanvasRenderingContext2D, hinge: Vec, angle: number, len: number, side: 1 | -1, teeth01: number): void {
  ctx.save();
  ctx.translate(hinge.x, hinge.y);
  ctx.rotate(angle);
  const h = TOOTH_H * clamp01(teeth01);
  if (h > 0.5) {
    const n = Math.max(2, Math.round(len / 6));
    const step = (len - 2) / n;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const a = 2 + i * step;
      ctx.moveTo(a, (side * JAW_T) / 2);
      ctx.lineTo(a + step / 2, side * (JAW_T / 2 + h));
      ctx.lineTo(a + step, (side * JAW_T) / 2);
      ctx.closePath();
    }
    fillStroke(ctx, PALETTE.coil, OUTLINE_DOT);
  }
  roundRect(ctx, -JAW_T / 2, -JAW_T / 2, len + JAW_T / 2, JAW_T, JAW_T / 2);
  fillStroke(ctx, PALETTE.plate, OUTLINE_SMALL);
  ctx.restore();
}

function hingePin(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  circle(ctx, x, y, HINGE_R);
  fillStroke(ctx, PALETTE.plateSh, OUTLINE_DOT);
}

/** Static part (cached terrain layer): the steel base bar with its trigger pan. A seat has none (its plate is the pan). */
export function drawTrapBase(ctx: CanvasRenderingContext2D, g: TrapGeometry): void {
  if (g.base === null) return;
  const { x1, x2 } = g.base;
  roundRect(ctx, x1, g.floorY - 5, x2 - x1, 8, 3);
  fillStroke(ctx, PALETTE.plateSh, OUTLINE_SMALL);
  const cx = (x1 + x2) / 2;
  roundRect(ctx, cx - 7, g.floorY - 9, 14, 5, 2);
  fillStroke(ctx, PALETTE.plate, OUTLINE_DOT);
}

/** The free jaws on their hinges: `set01` 1 = SET (armed: gaping, teeth up), 0 = FOLDED FLAT (open). */
export function drawTrapJaws(ctx: CanvasRenderingContext2D, g: TrapGeometry, set01: number): void {
  const k = clamp01(set01);
  drawJaw(ctx, g.hinges[0], jawAngle(g, 0, k), g.jawLen, 1, k);
  drawJaw(ctx, g.hinges[1], jawAngle(g, 1, k), g.jawLen, -1, k);
  for (const h of g.hinges) hingePin(ctx, h.x, h.y);
}

/** Closure of jaws snapping shut `t` s after trapCaught: 0 wide open -> 1 shut, with a short squeeze past shut. */
export function snapClose(t: number): number {
  if (t >= SNAP_SEC) return 1;
  const k = Math.max(0, t) / SNAP_SEC;
  return k < 0.45 ? easeOut(k / 0.45) * (1 + SNAP_SQUEEZE) : 1 + SNAP_SQUEEZE * (1 - (k - 0.45) / 0.55);
}

/** Jaws springing open `t` s after trapFreed: they swing past wide open, then shrink away by FREE_SEC. */
export function freeOpen(t: number): { close: number; scale: number } {
  const k = clamp01(t / FREE_SEC);
  return { close: 1 - FREE_SWING * easeOut(Math.min(1, k / 0.55)), scale: k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4 };
}

/**
 * Jaws CLOSED around a ball (drawn after the balls, so a seat plate never hides them): two toothed arcs
 * hinged beside the ball's bottom meeting over its top. `close` 1 = shut; less swings each jaw open about its
 * hinge. `scale` shrinks the pair about the ball (spring-open exit).
 */
export function drawClosedJaws(ctx: CanvasRenderingContext2D, ball: Vec, close: number, scale: number): void {
  if (scale <= 0.01) return;
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.scale(scale, scale);
  for (const side of [-1, 1] as const) {
    const from = side < 0 ? CLOSED_FROM : Math.PI - CLOSED_FROM;
    const to = side < 0 ? CLOSED_TO : Math.PI - CLOSED_TO;
    const hx = Math.cos(from) * CLOSED_R;
    const hy = Math.sin(from) * CLOSED_R;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(side * (1 - close) * JAW_SWING);
    ctx.translate(-hx, -hy);
    const inner = CLOSED_R - JAW_T / 2;
    ctx.beginPath();
    for (const k of CLOSED_TEETH) {
      const a = from + (to - from) * k;
      ctx.moveTo(Math.cos(a - CLOSED_TOOTH_HALF) * inner, Math.sin(a - CLOSED_TOOTH_HALF) * inner);
      ctx.lineTo(Math.cos(a) * (inner - CLOSED_TOOTH_H), Math.sin(a) * (inner - CLOSED_TOOTH_H));
      ctx.lineTo(Math.cos(a + CLOSED_TOOTH_HALF) * inner, Math.sin(a + CLOSED_TOOTH_HALF) * inner);
      ctx.closePath();
    }
    fillStroke(ctx, PALETTE.coil, OUTLINE_DOT);
    ctx.beginPath();
    ctx.arc(0, 0, CLOSED_R, from, to, side > 0);
    ctx.lineCap = 'round';
    ctx.lineWidth = JAW_T + OUTLINE_SMALL * 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = JAW_T;
    ctx.strokeStyle = PALETTE.plate;
    ctx.stroke();
    hingePin(ctx, hx, hy);
    ctx.restore();
  }
  ctx.restore();
}

// ---- cannon drawing -----------------------------------------------------------------------------------

/** Static part (cached terrain layer): the wooden cradle (trough + front post), its bottom shade band, two rivets. */
export function drawCannonCradle(ctx: CanvasRenderingContext2D, g: CannonGeometry): void {
  const outline = (): void => {
    ctx.beginPath();
    g.cradle.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = PALETTE.plank;
  ctx.fill();
  const { x1, x2, y } = g.cradleBase;
  ctx.fillStyle = PALETTE.plankSh;
  ctx.fillRect(x1, y - CRADLE_SHADE, x2 - x1, CRADLE_SHADE);
  outline();
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const dy of [-LAMP_DOWN_POST, LAMP_DOWN_POST + 4]) {
    circle(ctx, g.lampPos.x, g.lampPos.y + dy, 1.8);
    ctx.fill();
  }
}

/** World box around the barrel (breech to muzzle ring): labels keep off it. */
export function barrelBounds(g: CannonGeometry): { x1: number; y1: number; x2: number; y2: number } {
  const xs = [g.seatPos.x, g.muzzle.x];
  const ys = [g.seatPos.y, g.muzzle.y];
  return { x1: Math.min(...xs) - MUZZLE_R, y1: Math.min(...ys) - MUZZLE_R, x2: Math.max(...xs) + MUZZLE_R, y2: Math.max(...ys) + MUZZLE_R };
}

/** Recoil 1 at the shot easing to 0 over RECOIL_SEC; `sinceFire` = seconds since cannonFire. */
export function recoilOf(sinceFire: number | undefined): number {
  if (sinceFire === undefined || sinceFire >= RECOIL_SEC) return 0;
  return 1 - easeOut(sinceFire / RECOIL_SEC);
}

/** The iron barrel along its launch (recoiling `recoil01`) and the fuse lamp on its cradle post: mint LIT, grey COLD. */
export function drawCannonBarrel(ctx: CanvasRenderingContext2D, g: CannonGeometry, lit: boolean, recoil01: number): void {
  const back = RECOIL_PX * clamp01(recoil01);
  const shade = g.dir.x >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(g.seatPos.x - g.dir.x * back, g.seatPos.y - g.dir.y * back);
  ctx.rotate(Math.atan2(g.dir.y, g.dir.x));
  const ring = (x: number, len: number, r: number, radius: number): void => {
    roundRect(ctx, x, -r, len, r * 2, radius);
    ctx.fillStyle = PALETTE.iron;
    ctx.fill();
    ctx.beginPath();
    ctx.rect(x + 1, shade > 0 ? r - 5 : -r, len - 2, 5);
    ctx.fillStyle = PALETTE.ironSh;
    ctx.fill();
    roundRect(ctx, x, -r, len, r * 2, radius);
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  ring(BARREL_FROM, BARREL_LEN - BARREL_FROM - MUZZLE_LEN + 4, BARREL_R, 8);
  ring(BAND_AT, BAND_LEN, BAND_R, 2);
  ring(BARREL_LEN - MUZZLE_LEN, MUZZLE_LEN, MUZZLE_R, 4);
  roundRect(ctx, BARREL_LEN - 4, -BARREL_R + 3, 4, BARREL_R * 2 - 6, 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  lamp(ctx, g.lampPos.x, g.lampPos.y, lit);
}

// ---- the dotted arc of a cannon's real flight ---------------------------------------------------------

/** A cannon's flight as the sim will fly it: the ball centre every tick, and whether it comes to rest. */
export type LaunchArc = { readonly points: readonly Vec[]; readonly rests: boolean };

type Switches = Readonly<Record<string, boolean>>;

const arcCache = new WeakMap<Level, Map<string, LaunchArc>>();

/**
 * The switches a cannon fires under: the current ones while it is LIT; while it is COLD, the current ones with
 * its first FIRE plate held (the partner-reachable plate the LOADED chip names, D10.10), because a loaded ball
 * fires the tick that plate is held. On Sky Bridge that same plate raises the bridge the flight crosses.
 */
export function firingSwitches(rect: CannonRect, switches: Switches): Switches {
  const first = rectSwitchIds(rect)[0];
  return isCannonLit(rect, switches) || first === undefined ? switches : { ...switches, [first]: true };
}

/**
 * The real flight from the breech as the cannon will fire it (physics.predictLaunch with its firing switches
 * fixed), memoised by level, cannon, firing switch mask and ball.
 */
export function launchArc(level: Level, rect: CannonRect, switches: Switches, playerId: PlayerId): LaunchArc {
  const firing = firingSwitches(rect, switches);
  const key = `${rect.id}|${switchMaskOf(level, firing)}|${playerId}`;
  return cached(arcCache, level, key, () => {
    const flight = predictLaunch(level, firing, { x: rect.x + rect.w / 2, y: rect.y - BALL_RADIUS }, rect.launch, playerId);
    return { points: flight.points, rests: flight.outcome === 'rest' };
  });
}

/**
 * Neutral dots every ARC_DOT_EVERY ticks once the ball is clear of the barrel, and a dashed ring where it comes
 * to rest; full strength while LIT, faint while only LOADED. Sizes keep their screen size at any zoom.
 */
export function drawLaunchArc(ctx: CanvasRenderingContext2D, g: CannonGeometry, arc: LaunchArc, lit: boolean, zoom: number): void {
  const inv = 1 / Math.max(0.05, zoom);
  const clear = BARREL_LEN + ARC_DOT_R;
  const { points } = arc;
  ctx.save();
  ctx.globalAlpha = lit ? ARC_LIT_ALPHA : ARC_COLD_ALPHA;
  ctx.beginPath();
  for (let i = ARC_DOT_EVERY - 1; i < points.length; i += ARC_DOT_EVERY) {
    const p = points[i];
    if (p === undefined) continue;
    const dx = p.x - g.seatPos.x;
    const dy = p.y - g.seatPos.y;
    if (dx * dx + dy * dy < clear * clear) continue;
    ctx.moveTo(p.x + ARC_DOT_R * inv, p.y);
    ctx.arc(p.x, p.y, ARC_DOT_R * inv, 0, Math.PI * 2);
  }
  fillStroke(ctx, PALETTE.white, OUTLINE_DOT * inv);
  const end = points[points.length - 1];
  if (arc.rests && end !== undefined) {
    ctx.setLineDash([4 * inv, 4 * inv]);
    circle(ctx, end.x, end.y, ARC_RING_R * inv);
    ctx.lineWidth = 3 * inv;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
