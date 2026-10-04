// OWNER: sim
/**
 * Pure geometry for the sim (ARCH.md §1.3, physics-notes §2). Constants come only from types.ts.
 * Every runtime query is position-aware (`groundAt`) so "supported" and "collides" can never disagree:
 * the candidate set of `groundAt` is exactly the collider set of `solidColliders`.
 */
import type {
  BallState,
  BlockerRect,
  BridgeRect,
  ColourGateRect,
  Level,
  LevelRect,
  PlayerId,
  TerrainPiece,
  Vec,
} from './types';
import { BALL_RADIUS, GROUND_SEARCH_SLACK, PLAYER_GATE_COLOUR, SUPPORT_TOLERANCE, quantize2 } from './types';

export type Edge = { a: Vec; b: Vec; normal: Vec; kind: 'top' | 'side' | 'base' };

export type Collider =
  | { kind: 'terrain'; pieceIndex: number; edges: readonly Edge[]; piece: TerrainPiece }
  | { kind: 'rect'; rectIndex: number; rect: BridgeRect | BlockerRect | ColourGateRect };

export type Ground = {
  y: number;
  normal: Vec;
  slope: number;
  permanent: boolean;
  source: 'piece' | 'bridge' | 'blocker' | 'colourGate';
  index: number;
};

/**
 * One circle-vs-collider overlap. `distance` is the signed distance from the ball centre to the
 * collider surface along `normal` (negative when the centre is inside the solid); the penetration
 * to resolve is `BALL_RADIUS - distance`.
 */
export type Contact = { normal: Vec; distance: number; collider: Collider };

/** Guard against zero-length segments in `closestPointOnSegment` (kept verbatim from the old build). */
const EPSILON = 0.0001;

const UP: Vec = Object.freeze({ x: 0, y: -1 });

export const vec = {
  add(a: Vec, b: Vec): Vec {
    return { x: a.x + b.x, y: a.y + b.y };
  },
  sub(a: Vec, b: Vec): Vec {
    return { x: a.x - b.x, y: a.y - b.y };
  },
  mul(a: Vec, s: number): Vec {
    return { x: a.x * s, y: a.y * s };
  },
  dot(a: Vec, b: Vec): number {
    return a.x * b.x + a.y * b.y;
  },
  /** Math.sqrt on purpose: Math.hypot differs between engines (ARCH.md §3.7). */
  len(v: Vec): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  },
  normalize(v: Vec): Vec {
    const length = Math.sqrt(v.x * v.x + v.y * v.y);
    return length < EPSILON ? UP : { x: v.x / length, y: v.y / length };
  },
  dist(a: Vec, b: Vec): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
};

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- pieces -----------------------------------------------------------------------------------

const EDGE_CACHE = new WeakMap<TerrainPiece, readonly Edge[]>();

/** Outward unit normal of a surface segment a -> b (y < 0: the dirt is below the polyline). */
function surfaceNormal(a: Vec, b: Vec): Vec {
  const n = vec.normalize({ x: -(b.y - a.y), y: b.x - a.x });
  return n.y > 0 ? { x: -n.x, y: -n.y } : n;
}

/** Edges of a piece: top polyline (outward normals), right side, base, left side. Cached per piece object. */
export function pieceEdges(piece: TerrainPiece): readonly Edge[] {
  const cached = EDGE_CACHE.get(piece);
  if (cached !== undefined) return cached;
  const pts = piece.surface;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const edges: Edge[] = [];
  if (first === undefined || last === undefined) return edges;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a !== undefined && b !== undefined) edges.push({ a, b, normal: surfaceNormal(a, b), kind: 'top' });
  }
  const rightBottom: Vec = { x: last.x, y: piece.baseY };
  const leftBottom: Vec = { x: first.x, y: piece.baseY };
  edges.push({ a: last, b: rightBottom, normal: { x: 1, y: 0 }, kind: 'side' });
  edges.push({ a: rightBottom, b: leftBottom, normal: { x: 0, y: 1 }, kind: 'base' });
  edges.push({ a: leftBottom, b: first, normal: { x: -1, y: 0 }, kind: 'side' });
  EDGE_CACHE.set(piece, edges);
  return edges;
}

/** Vertex i of the piece polygon: the surface points, then the right and left base corners (no allocation). */
function polygonVertex(piece: TerrainPiece, i: number, first: Vec, last: Vec): Vec {
  const n = piece.surface.length;
  if (i < n) return piece.surface[i] ?? first;
  return i === n ? { x: last.x, y: piece.baseY } : { x: first.x, y: piece.baseY };
}

/** Ray-cast (even-odd) point-in-polygon over surface + the two base corners. */
export function pointInPiece(piece: TerrainPiece, p: Vec): boolean {
  const pts = piece.surface;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === undefined || last === undefined) return false;
  if (p.x < first.x || p.x > last.x || p.y > piece.baseY) return false;
  const count = pts.length + 2;
  let inside = false;
  let b = polygonVertex(piece, count - 1, first, last);
  for (let i = 0; i < count; i += 1) {
    const a = polygonVertex(piece, i, first, last);
    const crosses = a.y > p.y !== b.y > p.y;
    if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    b = a;
  }
  return inside;
}

export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = vec.sub(b, a);
  const t = clamp(vec.dot(vec.sub(p, a), ab) / Math.max(vec.dot(ab, ab), EPSILON), 0, 1);
  return vec.add(a, vec.mul(ab, t));
}

/** The surface segment of a piece containing x (null outside the piece). */
function surfaceSegmentAt(piece: TerrainPiece, x: number): { a: Vec; b: Vec } | null {
  const pts = piece.surface;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a !== undefined && b !== undefined && x >= a.x && x <= b.x) return { a, b };
  }
  return null;
}

/** Linear interpolation between control points (kept verbatim: the `Math.max(b.x - a.x, 1)` guard). */
export function surfaceYOnPiece(piece: TerrainPiece, x: number): number | null {
  const pts = piece.surface;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === undefined || last === undefined || pts.length < 2) return null;
  if (x < first.x || x > last.x) return null;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a !== undefined && b !== undefined && x >= a.x && x <= b.x) {
      const t = (x - a.x) / Math.max(b.x - a.x, 1);
      return a.y + (b.y - a.y) * t;
    }
  }
  return null;
}

// ---- rects --------------------------------------------------------------------------------------

/** The switch ids that drive a rect ([] for a permanent rect). `switchIds` (OR) overrides `switchId`. */
export function rectSwitchIds(rect: LevelRect): readonly string[] {
  if (rect.switchIds !== undefined) return rect.switchIds;
  return rect.switchId !== undefined ? [rect.switchId] : [];
}

/** A rect with no driving switch always exists and never emits `bridgeToggle`. */
export function isPermanentRect(rect: LevelRect): boolean {
  return rectSwitchIds(rect).length === 0;
}

/** No switch => always active. `switchIds` (OR) overrides `switchId`. Default activeWhen: blocker false, else true. */
export function isRectActive(rect: LevelRect, switches: Readonly<Record<string, boolean>>): boolean {
  const ids = rectSwitchIds(rect);
  if (ids.length === 0) return true;
  let pressed = false;
  for (const id of ids) if (switches[id] === true) pressed = true;
  return pressed === (rect.activeWhen ?? rect.kind !== 'blocker');
}

export function activeRects(level: Level, switches: Readonly<Record<string, boolean>>): readonly LevelRect[] {
  return level.rects.filter((rect) => isRectActive(rect, switches));
}

/** bit i = level.switches[i] pressed. Iterates `level.switches` (array order), never the record. */
export function switchMaskOf(level: Level, switches: Readonly<Record<string, boolean>>): number {
  let mask = 0;
  for (let i = 0; i < level.switches.length; i += 1) {
    const sw = level.switches[i];
    if (sw !== undefined && switches[sw.id] === true) mask |= 1 << i;
  }
  return mask;
}

function isSolidRect(rect: LevelRect): rect is BridgeRect | BlockerRect | ColourGateRect {
  return rect.kind === 'bridge' || rect.kind === 'blocker' || rect.kind === 'colourGate';
}

function rectContainsX(rect: LevelRect, x: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w;
}

/** True when the AABB contains the point (edges inclusive). */
export function rectContains(rect: LevelRect, p: Vec): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

const COLLIDER_CACHE = new WeakMap<Level, Map<number, readonly Collider[]>>();

/** Terrain pieces + active bridge/blocker/colourGate rects. Cached per (level object, switchMask). */
export function solidColliders(level: Level, switches: Readonly<Record<string, boolean>>): readonly Collider[] {
  const mask = switchMaskOf(level, switches);
  let byMask = COLLIDER_CACHE.get(level);
  if (byMask === undefined) {
    byMask = new Map();
    COLLIDER_CACHE.set(level, byMask);
  }
  const cached = byMask.get(mask);
  if (cached !== undefined) return cached;
  const out: Collider[] = [];
  for (let i = 0; i < level.terrain.pieces.length; i += 1) {
    const piece = level.terrain.pieces[i];
    if (piece !== undefined) out.push({ kind: 'terrain', pieceIndex: i, edges: pieceEdges(piece), piece });
  }
  for (let i = 0; i < level.rects.length; i += 1) {
    const rect = level.rects[i];
    if (rect !== undefined && isSolidRect(rect) && isRectActive(rect, switches)) {
      out.push({ kind: 'rect', rectIndex: i, rect });
    }
  }
  byMask.set(mask, out);
  return out;
}

const PER_PLAYER_CACHE = new WeakMap<readonly Collider[], [readonly Collider[], readonly Collider[]]>();

/** `solidColliders` minus the colour gate matching this player (its ball passes through). Memoised per list. */
export function collidersFor(colliders: readonly Collider[], playerId: PlayerId): readonly Collider[] {
  let pair = PER_PLAYER_CACHE.get(colliders);
  if (pair === undefined) {
    const without = (mine: string): readonly Collider[] =>
      colliders.filter((c) => !(c.kind === 'rect' && c.rect.kind === 'colourGate' && c.rect.colour === mine));
    pair = [without(PLAYER_GATE_COLOUR[0]), without(PLAYER_GATE_COLOUR[1])];
    PER_PLAYER_CACHE.set(colliders, pair);
  }
  return pair[playerId];
}

// ---- contacts -------------------------------------------------------------------------------------

function insideAnyPiece(p: Vec, colliders: readonly Collider[]): boolean {
  for (const c of colliders) if (c.kind === 'terrain' && pointInPiece(c.piece, p)) return true;
  return false;
}

type Face = { normal: Vec; depth: number };

/**
 * Ejection for a centre INSIDE an AABB: the nearest face whose exit point is not inside terrain
 * (a door standing on the fairway closes on a parked ball: it must leave sideways, never through
 * the floor). Falls back to the nearest face.
 */
function rectEscape(rect: LevelRect, p: Vec, colliders: readonly Collider[]): Face {
  const faces: Face[] = [
    { normal: UP, depth: p.y - rect.y },
    { normal: { x: 0, y: 1 }, depth: rect.y + rect.h - p.y },
    { normal: { x: -1, y: 0 }, depth: p.x - rect.x },
    { normal: { x: 1, y: 0 }, depth: rect.x + rect.w - p.x },
  ];
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    const reach = face.depth + BALL_RADIUS;
    const exit: Vec = { x: p.x + face.normal.x * reach, y: p.y + face.normal.y * reach };
    if (!insideAnyPiece(exit, colliders)) return face;
  }
  return faces[0] ?? { normal: UP, depth: 0 };
}

function rectContact(collider: Collider & { kind: 'rect' }, p: Vec, colliders: readonly Collider[]): Contact | null {
  const rect = collider.rect;
  const qx = clamp(p.x, rect.x, rect.x + rect.w);
  const qy = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - qx;
  const dy = p.y - qy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= BALL_RADIUS) return null;
  if (dist < EPSILON) {
    const escape = rectEscape(rect, p, colliders);
    return { normal: escape.normal, distance: -escape.depth, collider };
  }
  return { normal: { x: dx / dist, y: dy / dist }, distance: dist, collider };
}

/** Closest edge of a piece to a point that is INSIDE it: the ejection route. */
function closestEdge(edges: readonly Edge[], p: Vec): { edge: Edge; dist: number } | null {
  let best: { edge: Edge; dist: number } | null = null;
  for (const edge of edges) {
    const dist = vec.dist(p, closestPointOnSegment(p, edge.a, edge.b));
    if (best === null || dist < best.dist) best = { edge, dist };
  }
  return best;
}

function terrainContact(collider: Collider & { kind: 'terrain' }, p: Vec): Contact | null {
  if (pointInPiece(collider.piece, p)) {
    const inside = closestEdge(collider.edges, p);
    return inside === null ? null : { normal: inside.edge.normal, distance: -inside.dist, collider };
  }
  let best: Contact | null = null;
  for (const edge of collider.edges) {
    const q = closestPointOnSegment(p, edge.a, edge.b);
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= BALL_RADIUS) continue;
    if (best !== null && dist >= best.distance) continue;
    const normal: Vec = dist < EPSILON ? edge.normal : { x: dx / dist, y: dy / dist };
    best = { normal, distance: dist, collider };
  }
  return best;
}

/** The deepest circle overlap among the colliders (null when the ball touches nothing). */
export function deepestContact(p: Vec, colliders: readonly Collider[]): Contact | null {
  let best: Contact | null = null;
  for (const collider of colliders) {
    const hit = collider.kind === 'terrain' ? terrainContact(collider, p) : rectContact(collider, p, colliders);
    if (hit !== null && (best === null || hit.distance < best.distance)) best = hit;
  }
  return best;
}

// ---- runtime queries (physics, sim) ---------------------------------------------------------

/**
 * The surface the ball at `pos` is (or would be) standing on: among every candidate whose x-range
 * contains pos.x (piece tops, ACTIVE bridge/blocker tops, wrong-colour gate tops) pick the SMALLEST
 * y that satisfies y >= pos.y + BALL_RADIUS - GROUND_SEARCH_SLACK. null when nothing is below.
 */
export function groundAt(
  level: Level,
  switches: Readonly<Record<string, boolean>>,
  pos: Vec,
  playerId: PlayerId,
): Ground | null {
  const minY = pos.y + BALL_RADIUS - GROUND_SEARCH_SLACK;
  let best: Ground | null = null;
  for (let i = 0; i < level.terrain.pieces.length; i += 1) {
    const piece = level.terrain.pieces[i];
    if (piece === undefined) continue;
    const seg = surfaceSegmentAt(piece, pos.x);
    const y = surfaceYOnPiece(piece, pos.x);
    if (seg === null || y === null || y < minY) continue;
    if (best !== null && y >= best.y) continue;
    const slope = Math.abs(seg.b.y - seg.a.y) / Math.max(seg.b.x - seg.a.x, 1);
    best = { y, normal: surfaceNormal(seg.a, seg.b), slope, permanent: true, source: 'piece', index: i };
  }
  const mine = PLAYER_GATE_COLOUR[playerId];
  for (let i = 0; i < level.rects.length; i += 1) {
    const rect = level.rects[i];
    if (rect === undefined || !isSolidRect(rect) || !isRectActive(rect, switches)) continue;
    if (rect.kind === 'colourGate' && rect.colour === mine) continue;
    if (!rectContainsX(rect, pos.x) || rect.y < minY) continue;
    if (best !== null && rect.y >= best.y) continue;
    best = { y: rect.y, normal: UP, slope: 0, permanent: isPermanentRect(rect), source: rect.kind, index: i };
  }
  return best;
}

export function hasSupport(
  level: Level,
  switches: Readonly<Record<string, boolean>>,
  ball: Readonly<BallState>,
  playerId: PlayerId,
): boolean {
  const g = groundAt(level, switches, ball.pos, playerId);
  return g !== null && groundSupports(g, ball.pos);
}

/** The ground under `pos` is touching the ball's bottom (within SUPPORT_TOLERANCE), not merely somewhere below it. */
export function groundSupports(g: Ground, pos: Vec): boolean {
  return Math.abs(g.y - (pos.y + BALL_RADIUS)) <= SUPPORT_TOLERANCE;
}

export function restsOnPermanentGround(
  level: Level,
  switches: Readonly<Record<string, boolean>>,
  pos: Vec,
  playerId: PlayerId,
): boolean {
  return groundAt(level, switches, pos, playerId)?.permanent === true;
}

export function inGap(level: Level, x: number): boolean {
  for (const gap of level.terrain.gaps) if (x > gap.x1 && x < gap.x2) return true;
  return false;
}

/** Distance from the ball's bottom point to the cup rim centre. */
export function distanceToCup(level: Level, pos: Vec): number {
  const dx = pos.x - level.hole.x;
  const dy = pos.y + BALL_RADIUS - level.hole.rimY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---- authoring-only queries (compileLevel / validateLevel; never called by physics) ------------

/** LOWEST (largest y) terrain-piece surface at x = "the fairway". null in a gap. */
export function surfaceYAt(level: Level, x: number): number | null {
  let best: number | null = null;
  for (const piece of level.terrain.pieces) {
    const y = surfaceYOnPiece(piece, x);
    if (y !== null && (best === null || y > best)) best = y;
  }
  return best;
}

/** |dy/dx| of the fairway piece at x (0 when nothing is there). */
export function surfaceSlopeAt(level: Level, x: number): number {
  let bestY: number | null = null;
  let slope = 0;
  for (const piece of level.terrain.pieces) {
    const seg = surfaceSegmentAt(piece, x);
    const y = surfaceYOnPiece(piece, x);
    if (seg === null || y === null || (bestY !== null && y <= bestY)) continue;
    bestY = y;
    slope = Math.abs(seg.b.y - seg.a.y) / Math.max(seg.b.x - seg.a.x, 1);
  }
  return slope;
}

/** Ball centre on the fairway at x, quantize2'd. Throws in a gap (levels are validated). */
export function placeOnSurface(level: Level, x: number): Vec {
  const y = surfaceYAt(level, x);
  if (y === null) throw new Error(`terrain: no surface at x=${x}`);
  return { x: quantize2(x), y: quantize2(y - BALL_RADIUS) };
}
