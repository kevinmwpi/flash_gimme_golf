// OWNER: levels
/**
 * Compile-time level helpers (ARCH.md §1.7, BUILD_DECISIONS D2). Pure; runs once at module load.
 *
 * A level file describes geometry in the designer's vocabulary (surface polylines, flush pads,
 * walls by centre + height, plates by centre + width, a bridge by the gap it spans) and
 * `compileLevel` resolves every surface-relative value against the FAIRWAY (the lowest terrain
 * piece at an x), quantising compiled y values with `quantize2` so tee, rim and plate numbers
 * survive a snapshot round trip. `validateLevel` enforces every rule in ARCH.md §1.7 plus the D2
 * additions (bridge `switchIds`, deck plates with `onRectId`, `cupHoldsSwitch`, `firstPlayer`).
 *
 * The fairway lookup is built on `terrain.surfaceYOnPiece` (lowest piece wins) so that compiling
 * a level depends only on pure geometry; see `fairwayAt`.
 */
import type {
  BlockerRect,
  ColourGateRect,
  Gap,
  GateColour,
  Level,
  LevelRect,
  MechanicKind,
  PressureSwitch,
  Terrain,
  TerrainPiece,
  Vec,
} from '../types';
import {
  BALL_RADIUS,
  BRIDGE_LIP_TOLERANCE,
  HOLE_RADIUS,
  MAX_BALL_SPEED,
  MAX_LEVEL_WIDTH,
  MIN_TEE_SEPARATION,
  MIN_WALL_HEIGHT,
  OVERHANG_MIN_CLEARANCE,
  RESTABLE_MAX_SLOPE,
  STACK_SEAM_TOLERANCE,
  SWITCH_CONTACT_TOLERANCE,
  VIEWPORT_H,
  VIEWPORT_W,
  quantize2,
} from '../types';
import { surfaceYOnPiece, vec } from '../terrain';

// ---------------------------------------------------------------------------------------------
// Authoring vocabulary
// ---------------------------------------------------------------------------------------------

/** Accent colour of every World 1 pressure plate (VISUAL.md §1 `sw`); plates differ by label, not hue. */
export const SWITCH_COLOUR = '#b57bee';

/** Height of the drawn band of a flush pad (sand/spring/bumper). Physics uses only the x-range. */
export const PAD_BAND_PX = 16;
/** Plank thickness of a bridge slab (VISUAL.md §4). The top y is what physics cares about. */
export const BRIDGE_THICKNESS_PX = 18;
/**
 * How far a wall-foot rect (door, field, wall) sinks into the dirt below the fairway. A door that
 * closes on a resting ball ejects it through its NEAREST face (D2); with the ball centre
 * BALL_RADIUS above the fairway and the foot 20 px below it, the side faces are always nearer
 * than the bottom face, so the ball is pushed sideways and never down into the ground.
 */
export const WALL_EMBED_PX = 20;
/** A wall foot may float at most this far above the fairway (ARCH.md §1.7 "within 2 px"). */
export const WALL_FOOT_TOLERANCE = 2;

const DEFAULT_WALL_W = 40;
const DEFAULT_PAD_W = 56;
const DEFAULT_PLATE_W = 64;
/** Sampling step (px) for the piece-overlap classification. */
const OVERLAP_SAMPLE_PX = 4;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MECHANIC_ORDER: readonly MechanicKind[] = ['sand', 'spring', 'bumper', 'fan', 'colourGate', 'switch', 'bridge', 'blocker'];

export type PropDef =
  | { kind: 'sand'; id: string; x1: number; x2: number; label?: string }
  | { kind: 'spring'; id: string; centerX: number; w?: number; launch: Vec; label?: string }
  | { kind: 'bumper'; id: string; centerX: number; w?: number; label?: string }
  | { kind: 'fan'; id: string; x: number; y: number; w: number; h: number; force?: number; switchId?: string; activeWhen?: boolean; label?: string }
  /** `bottom` is the absolute y of the foot; default = fairway at centerX + WALL_EMBED_PX. */
  | { kind: 'colourGate'; id: string; centerX: number; w?: number; h: number; bottom?: number; colour: GateColour; label?: string }
  /** Spans `gap` exactly; needs `switchId` or a non-empty `switchIds` (OR semantics). */
  | { kind: 'bridge'; id: string; gap: Gap; switchId?: string; switchIds?: readonly string[]; activeWhen?: boolean; thickness?: number; label?: string }
  /** No switch => permanent wall. With a switch the default `activeWhen` is false (door). */
  | { kind: 'blocker'; id: string; centerX: number; w?: number; h: number; bottom?: number; switchId?: string; switchIds?: readonly string[]; activeWhen?: boolean; label?: string };

/** A plate. With `onRectId` it is a DECK plate living on top of that bridge/blocker (D2). */
export type SwitchDef = { id: string; centerX: number; w?: number; colour: string; label?: string; onRectId?: string };

export type LevelDef = Omit<Level, 'rects' | 'switches' | 'hole' | 'starts' | 'height' | 'mechanicsPresent'> & {
  props: PropDef[];
  switches: SwitchDef[];
  holeX: number;
  startXs: [number, number];
};

export function terrainPiece(points: [number, number][], baseY: number): TerrainPiece {
  return { surface: points.map(([x, y]) => ({ x, y })), baseY };
}

// ---------------------------------------------------------------------------------------------
// Fairway queries (authoring only)
// ---------------------------------------------------------------------------------------------

type Fairway = { y: number; pieceIndex: number };

/** LOWEST (largest y) terrain-piece surface at x. null in a gap or outside every piece. */
function fairwayAt(terrain: Terrain, x: number): Fairway | null {
  let best: Fairway | null = null;
  for (let pieceIndex = 0; pieceIndex < terrain.pieces.length; pieceIndex += 1) {
    const piece = terrain.pieces[pieceIndex];
    if (piece === undefined) continue;
    const y = surfaceYOnPiece(piece, x);
    if (y !== null && (best === null || y > best.y)) best = { y, pieceIndex };
  }
  return best;
}

function fairwayYOrThrow(terrain: Terrain, x: number, what: string): number {
  const fairway = fairwayAt(terrain, x);
  if (fairway === null) throw new Error(`compileLevel: ${what} at x=${x} has no ground under it`);
  return fairway.y;
}

function inDeclaredGap(terrain: Terrain, x: number): boolean {
  return terrain.gaps.some((gap) => x > gap.x1 && x < gap.x2);
}

/** Max |dy/dx| of the piece segments touching [x1, x2] (a point when x1 === x2: both adjacent segments). */
function maxSlopeOver(piece: TerrainPiece, x1: number, x2: number): number {
  let worst = 0;
  const pts = piece.surface;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const touches = x1 === x2 ? a.x <= x1 && x1 <= b.x : a.x < x2 && b.x > x1;
    if (!touches) continue;
    worst = Math.max(worst, Math.abs((b.y - a.y) / Math.max(b.x - a.x, 1)));
  }
  return worst;
}

function pieceCovers(piece: TerrainPiece, x: number): boolean {
  const first = piece.surface[0];
  const last = piece.surface[piece.surface.length - 1];
  return first !== undefined && last !== undefined && x >= first.x && x <= last.x;
}

// ---------------------------------------------------------------------------------------------
// compileLevel
// ---------------------------------------------------------------------------------------------

function compilePad(def: Extract<PropDef, { kind: 'sand' | 'spring' | 'bumper' }>, terrain: Terrain): LevelRect {
  const x1 = def.kind === 'sand' ? def.x1 : def.centerX - (def.w ?? DEFAULT_PAD_W) / 2;
  const w = def.kind === 'sand' ? def.x2 - def.x1 : (def.w ?? DEFAULT_PAD_W);
  const y = quantize2(fairwayYOrThrow(terrain, x1 + w / 2, `${def.kind} "${def.id}"`));
  const base = { id: def.id, x: x1, y, w, h: PAD_BAND_PX, ...(def.label !== undefined ? { label: def.label } : {}) };
  switch (def.kind) {
    case 'sand':
      return { ...base, kind: 'sand' };
    case 'spring':
      return { ...base, kind: 'spring', launch: def.launch };
    case 'bumper':
      return { ...base, kind: 'bumper' };
  }
}

function compileWall(def: Extract<PropDef, { kind: 'colourGate' | 'blocker' }>, terrain: Terrain): ColourGateRect | BlockerRect {
  const w = def.w ?? DEFAULT_WALL_W;
  const bottom = def.bottom ?? quantize2(fairwayYOrThrow(terrain, def.centerX, `${def.kind} "${def.id}"`) + WALL_EMBED_PX);
  const base = {
    id: def.id,
    x: def.centerX - w / 2,
    y: bottom - def.h,
    w,
    h: def.h,
    ...(def.label !== undefined ? { label: def.label } : {}),
  };
  if (def.kind === 'colourGate') return { ...base, kind: 'colourGate', colour: def.colour };
  return {
    ...base,
    kind: 'blocker',
    ...(def.switchId !== undefined ? { switchId: def.switchId } : {}),
    ...(def.switchIds !== undefined ? { switchIds: def.switchIds } : {}),
    ...(def.activeWhen !== undefined ? { activeWhen: def.activeWhen } : {}),
  };
}

function compileBridge(def: Extract<PropDef, { kind: 'bridge' }>, terrain: Terrain): LevelRect {
  const nearLip = fairwayYOrThrow(terrain, def.gap.x1, `bridge "${def.id}" near lip`);
  const farLip = fairwayYOrThrow(terrain, def.gap.x2, `bridge "${def.id}" far lip`);
  return {
    kind: 'bridge',
    id: def.id,
    x: def.gap.x1,
    y: quantize2((nearLip + farLip) / 2),
    w: def.gap.x2 - def.gap.x1,
    h: def.thickness ?? BRIDGE_THICKNESS_PX,
    ...(def.switchId !== undefined ? { switchId: def.switchId } : {}),
    ...(def.switchIds !== undefined ? { switchIds: def.switchIds } : {}),
    ...(def.activeWhen !== undefined ? { activeWhen: def.activeWhen } : {}),
    ...(def.label !== undefined ? { label: def.label } : {}),
  };
}

function compileRect(def: PropDef, terrain: Terrain): LevelRect {
  switch (def.kind) {
    case 'sand':
    case 'spring':
    case 'bumper':
      return compilePad(def, terrain);
    case 'fan':
      return {
        kind: 'fan',
        id: def.id,
        x: def.x,
        y: def.y,
        w: def.w,
        h: def.h,
        ...(def.force !== undefined ? { force: def.force } : {}),
        ...(def.switchId !== undefined ? { switchId: def.switchId } : {}),
        ...(def.activeWhen !== undefined ? { activeWhen: def.activeWhen } : {}),
        ...(def.label !== undefined ? { label: def.label } : {}),
      };
    case 'colourGate':
    case 'blocker':
      return compileWall(def, terrain);
    case 'bridge':
      return compileBridge(def, terrain);
  }
}

function compileSwitch(def: SwitchDef, terrain: Terrain, rects: readonly LevelRect[]): PressureSwitch {
  const w = def.w ?? DEFAULT_PLATE_W;
  const deck = def.onRectId !== undefined ? rects.find((r) => r.id === def.onRectId) : undefined;
  if (def.onRectId !== undefined && deck === undefined) {
    throw new Error(`compileLevel: switch "${def.id}" sits on unknown rect "${def.onRectId}"`);
  }
  const surfaceY = deck !== undefined ? deck.y : quantize2(fairwayYOrThrow(terrain, def.centerX, `switch "${def.id}"`));
  return {
    id: def.id,
    x: def.centerX - w / 2,
    w,
    surfaceY,
    colour: def.colour,
    ...(def.label !== undefined ? { label: def.label } : {}),
    ...(def.onRectId !== undefined ? { onRectId: def.onRectId } : {}),
  };
}

function placeOnFairway(terrain: Terrain, x: number, what: string): Vec {
  return { x: quantize2(x), y: quantize2(fairwayYOrThrow(terrain, x, what) - BALL_RADIUS) };
}

function derivePresent(rects: readonly LevelRect[], switches: readonly PressureSwitch[]): MechanicKind[] {
  const present = new Set<MechanicKind>(rects.map((r) => r.kind));
  if (switches.length > 0) present.add('switch');
  return MECHANIC_ORDER.filter((kind) => present.has(kind));
}

/**
 * Resolves every surface-relative value against the fairway, quantises compiled y values, sets
 * `height = 720`, derives `mechanicsPresent` and runs `validateLevel`; throws on the first
 * compile-time impossibility or with every validity message joined.
 */
export function compileLevel(def: LevelDef): Level {
  const { props, switches: switchDefs, holeX, startXs, ...meta } = def;
  const rects = props.map((prop) => compileRect(prop, meta.terrain));
  const switches = switchDefs.map((sw) => compileSwitch(sw, meta.terrain, rects));
  const level: Level = {
    ...meta,
    height: VIEWPORT_H,
    mechanicsPresent: derivePresent(rects, switches),
    rects,
    switches,
    hole: { x: holeX, rimY: quantize2(fairwayYOrThrow(meta.terrain, holeX, 'cup')), radius: HOLE_RADIUS },
    starts: [placeOnFairway(meta.terrain, startXs[0], 'tee 0'), placeOnFairway(meta.terrain, startXs[1], 'tee 1')],
  };
  const errors = validateLevel(level);
  if (errors.length > 0) throw new Error(`compileLevel(${def.id}): ${errors.join('; ')}`);
  return level;
}

// ---------------------------------------------------------------------------------------------
// validateLevel — every rule in ARCH.md §1.7 (+ D2). Each helper appends plain messages.
// ---------------------------------------------------------------------------------------------

type Errors = string[];

function validateMeta(level: Level, errors: Errors): void {
  if (!KEBAB.test(level.id)) errors.push(`id "${level.id}" is not kebab-case`);
  if (level.height !== VIEWPORT_H) errors.push(`height must be ${VIEWPORT_H}`);
  if (level.width < VIEWPORT_W || level.width > MAX_LEVEL_WIDTH) errors.push(`width ${level.width} out of range`);
  if (level.world === 1 && level.wind !== 0) errors.push('world 1 wind must be 0');
  if (level.par < 3) errors.push('par must be >= 3');
  if (level.order < 1) errors.push('order must be >= 1');
  if (level.firstPlayer !== 0 && level.firstPlayer !== 1) errors.push('firstPlayer must be 0 or 1');
  for (const key of ['name', 'hint', 'aha', 'watchOut'] as const) {
    if (level[key].trim() === '') errors.push(`${key} must be non-empty`);
  }
  if (level.mechanicsIntroduced.length !== 1) errors.push('exactly one mechanic must be introduced');
  const derived = derivePresent(level.rects, level.switches);
  const present = [...level.mechanicsPresent];
  if (new Set(present).size !== present.length) errors.push('mechanicsPresent has duplicates');
  if (derived.length !== present.length || derived.some((kind) => !present.includes(kind))) {
    errors.push(`mechanicsPresent [${present.join(',')}] must equal the kinds present [${derived.join(',')}]`);
  }
  for (const kind of level.mechanicsIntroduced) {
    if (!present.includes(kind)) errors.push(`introduced mechanic "${kind}" is not present`);
  }
  if (level.cupHoldsSwitch !== undefined && !level.switches.some((sw) => sw.id === level.cupHoldsSwitch)) {
    errors.push(`cupHoldsSwitch "${level.cupHoldsSwitch}" is not a switch`);
  }
}

function validatePieceShape(piece: TerrainPiece, index: number, errors: Errors): void {
  if (piece.surface.length < 2) errors.push(`piece ${index}: surface needs >= 2 points`);
  for (let i = 1; i < piece.surface.length; i += 1) {
    const a = piece.surface[i - 1];
    const b = piece.surface[i];
    if (a !== undefined && b !== undefined && b.x <= a.x) errors.push(`piece ${index}: surface x must be strictly increasing`);
  }
  if (piece.surface.some((p) => p.y >= piece.baseY)) errors.push(`piece ${index}: baseY must be below every surface point`);
}

/** Pieces overlapping in x must be consistently STACKED or an OVERHANG across the whole overlap. */
function validatePieceOverlap(pieces: readonly TerrainPiece[], i: number, j: number, errors: Errors): void {
  const a = pieces[i];
  const b = pieces[j];
  if (a === undefined || b === undefined) return;
  const aFirst = a.surface[0];
  const aLast = a.surface[a.surface.length - 1];
  const bFirst = b.surface[0];
  const bLast = b.surface[b.surface.length - 1];
  if (aFirst === undefined || aLast === undefined || bFirst === undefined || bLast === undefined) return;
  const lo = Math.max(aFirst.x, bFirst.x);
  const hi = Math.min(aLast.x, bLast.x);
  if (lo >= hi) return; // disjoint, or touching at a single x (adjacent pieces)
  if (a.baseY === b.baseY) {
    errors.push(`pieces ${i} and ${j} overlap in x ${lo}-${hi} with the same baseY`);
    return;
  }
  const upper = a.baseY < b.baseY ? a : b;
  const lower = upper === a ? b : a;
  const xs = new Set<number>([lo, hi]);
  for (let x = lo; x < hi; x += OVERLAP_SAMPLE_PX) xs.add(x);
  for (const p of [...upper.surface, ...lower.surface]) if (p.x > lo && p.x < hi) xs.add(p.x);
  let stacked = 0;
  let overhang = 0;
  for (const x of xs) {
    const lowerY = surfaceYOnPiece(lower, x);
    if (lowerY === null) continue;
    if (Math.abs(upper.baseY - lowerY) <= STACK_SEAM_TOLERANCE) stacked += 1;
    else if (lowerY - upper.baseY >= OVERHANG_MIN_CLEARANCE) overhang += 1;
  }
  if (stacked + overhang !== xs.size || (stacked > 0 && overhang > 0)) {
    errors.push(`pieces ${i} and ${j} overlap in x ${lo}-${hi} but are neither cleanly stacked nor an overhang`);
  }
}

function validateTerrain(level: Level, errors: Errors): void {
  const pieces = level.terrain.pieces;
  if (pieces.length === 0) errors.push('a level needs at least one terrain piece');
  pieces.forEach((piece, index) => validatePieceShape(piece, index, errors));
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) validatePieceOverlap(pieces, i, j, errors);
  }
  for (const gap of level.terrain.gaps) {
    if (gap.x1 >= gap.x2 || gap.x1 < 0 || gap.x2 > level.width) errors.push(`gap ${gap.x1}-${gap.x2} is malformed`);
    const covered = pieces.some((piece) => {
      const first = piece.surface[0];
      const last = piece.surface[piece.surface.length - 1];
      return first !== undefined && last !== undefined && first.x < gap.x2 && last.x > gap.x1;
    });
    if (covered) errors.push(`a piece covers the inside of gap ${gap.x1}-${gap.x2}`);
    if (!pieces.some((piece) => piece.surface[piece.surface.length - 1]?.x === gap.x1)) {
      errors.push(`no piece ends exactly at gap x1=${gap.x1}`);
    }
    if (!pieces.some((piece) => piece.surface[0]?.x === gap.x2)) errors.push(`no piece starts exactly at gap x2=${gap.x2}`);
  }
}

function insideFan(level: Level, x: number, y: number): boolean {
  return level.rects.some((r) => r.kind === 'fan' && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

/** Tees, plates and the cup sit on the fairway: lowest piece, not under a stacked piece, gentle slope, outside gaps and fans. */
function validateAnchor(level: Level, what: string, x1: number, x2: number, expectedY: number | null, errors: Errors): void {
  const terrain = level.terrain;
  for (const x of [x1, (x1 + x2) / 2, x2]) {
    if (inDeclaredGap(terrain, x)) {
      errors.push(`${what} at x=${x} is inside a gap`);
      return;
    }
    const fairway = fairwayAt(terrain, x);
    if (fairway === null) {
      errors.push(`${what} at x=${x} has no ground`);
      return;
    }
    const piece = terrain.pieces[fairway.pieceIndex];
    if (piece === undefined) return;
    if (maxSlopeOver(piece, x1, x2) > RESTABLE_MAX_SLOPE) errors.push(`${what} sits on a slope steeper than ${RESTABLE_MAX_SLOPE}`);
    const underStack = terrain.pieces.some(
      (other, index) => index !== fairway.pieceIndex && pieceCovers(other, x) && Math.abs(other.baseY - fairway.y) <= STACK_SEAM_TOLERANCE,
    );
    if (underStack) errors.push(`${what} at x=${x} is under a stacked piece`);
    if (expectedY !== null && Math.abs(fairway.y - expectedY) > SWITCH_CONTACT_TOLERANCE) {
      errors.push(`${what} surface y ${expectedY} does not match the fairway (${fairway.y}) at x=${x}`);
    }
    if (insideFan(level, x, fairway.y - BALL_RADIUS)) errors.push(`${what} at x=${x} is inside a fan`);
  }
}

function validateAnchors(level: Level, errors: Errors): void {
  level.starts.forEach((start, i) => {
    validateAnchor(level, `tee ${i}`, start.x, start.x, start.y + BALL_RADIUS, errors);
    if (start.x < BALL_RADIUS || start.x > level.width - BALL_RADIUS) errors.push(`tee ${i} is outside the level`);
  });
  if (Math.abs(level.starts[0].x - level.starts[1].x) < MIN_TEE_SEPARATION) errors.push('tees too close');
  if (level.hole.x < 0 || level.hole.x > level.width) errors.push('cup outside the level');
  if (level.hole.radius !== HOLE_RADIUS) errors.push(`cup radius must be ${HOLE_RADIUS}`);
  validateAnchor(level, 'cup', level.hole.x, level.hole.x, level.hole.rimY, errors);
  for (const sw of level.switches) {
    if (sw.onRectId === undefined) validateAnchor(level, `switch "${sw.id}"`, sw.x, sw.x + sw.w, sw.surfaceY, errors);
    if (sw.w <= 0) errors.push(`switch "${sw.id}" has no width`);
  }
}

function switchRefsOf(rect: LevelRect): readonly string[] {
  return rect.switchIds ?? (rect.switchId !== undefined ? [rect.switchId] : []);
}

function validateSwitches(level: Level, errors: Errors): void {
  const switchIds = new Set(level.switches.map((sw) => sw.id));
  const referenced = new Set<string>();
  for (const rect of level.rects) {
    if (rect.switchIds !== undefined && rect.switchIds.length === 0) errors.push(`rect "${rect.id}" has an empty switchIds list`);
    for (const id of switchRefsOf(rect)) {
      referenced.add(id);
      if (!switchIds.has(id)) errors.push(`rect "${rect.id}" references unknown switch "${id}"`);
    }
  }
  if (level.cupHoldsSwitch !== undefined) referenced.add(level.cupHoldsSwitch);
  for (const sw of level.switches) {
    if (!referenced.has(sw.id)) errors.push(`switch "${sw.id}" is referenced by nothing`);
    if (sw.onRectId !== undefined) validateDeckPlate(level, sw, sw.onRectId, errors);
  }
}

/** A deck plate lives on top of a bridge/blocker: inside its x-range, surfaceY = the rect's top. */
function validateDeckPlate(level: Level, sw: PressureSwitch, rectId: string, errors: Errors): void {
  const rect = level.rects.find((r) => r.id === rectId);
  if (rect === undefined || (rect.kind !== 'bridge' && rect.kind !== 'blocker')) {
    errors.push(`switch "${sw.id}" onRectId "${rectId}" is not a bridge or blocker`);
    return;
  }
  if (sw.x < rect.x || sw.x + sw.w > rect.x + rect.w) errors.push(`deck plate "${sw.id}" sticks out of rect "${rectId}"`);
  if (sw.surfaceY !== rect.y) errors.push(`deck plate "${sw.id}" surfaceY ${sw.surfaceY} must equal the top of "${rectId}" (${rect.y})`);
}

function validateBridge(level: Level, rect: LevelRect, errors: Errors): void {
  const gap = level.terrain.gaps.find((g) => g.x1 === rect.x);
  if (gap === undefined) {
    errors.push(`bridge "${rect.id}" x=${rect.x} does not start at a gap`);
    return;
  }
  if (rect.w !== gap.x2 - gap.x1) errors.push(`bridge "${rect.id}" width ${rect.w} must equal the gap width ${gap.x2 - gap.x1}`);
  for (const lipX of [gap.x1, gap.x2]) {
    const lip = fairwayAt(level.terrain, lipX);
    if (lip === null || Math.abs(lip.y - rect.y) > BRIDGE_LIP_TOLERANCE) {
      errors.push(`bridge "${rect.id}" top ${rect.y} is not within ${BRIDGE_LIP_TOLERANCE} px of the lip at x=${lipX}`);
    }
  }
  if (switchRefsOf(rect).length === 0) errors.push(`bridge "${rect.id}" needs switchId or a non-empty switchIds`);
}

function isWall(rect: LevelRect): rect is BlockerRect | ColourGateRect {
  return rect.kind === 'blocker' || rect.kind === 'colourGate';
}

/** The foot stands on the fairway (embedded up to WALL_EMBED_PX) at both ends and the centre. */
function wallIsGrounded(level: Level, rect: BlockerRect | ColourGateRect): boolean {
  const bottom = rect.y + rect.h;
  return [rect.x, rect.x + rect.w / 2, rect.x + rect.w].every((x) => {
    const fairway = fairwayAt(level.terrain, x);
    return fairway !== null && bottom >= fairway.y - WALL_FOOT_TOLERANCE && bottom <= fairway.y + WALL_EMBED_PX;
  });
}

/** Follows the stack down (field on door on dirt) until a grounded wall is found. */
function wallIsSupported(level: Level, rect: BlockerRect | ColourGateRect): boolean {
  const walls = level.rects.filter(isWall);
  let current: BlockerRect | ColourGateRect | undefined = rect;
  for (let depth = 0; current !== undefined && depth <= walls.length; depth += 1) {
    if (wallIsGrounded(level, current)) return true;
    const bottom: number = current.y + current.h;
    const left: number = current.x;
    const right: number = current.x + current.w;
    current = walls.find((below) => below !== current && Math.abs(below.y - bottom) <= STACK_SEAM_TOLERANCE && below.x <= left && below.x + below.w >= right);
  }
  return false;
}

function validateWall(level: Level, rect: BlockerRect | ColourGateRect, errors: Errors): void {
  if (rect.h < MIN_WALL_HEIGHT) errors.push(`${rect.kind} "${rect.id}" is shorter than ${MIN_WALL_HEIGHT} px`);
  if (!wallIsSupported(level, rect)) errors.push(`${rect.kind} "${rect.id}" neither stands on the fairway nor on another wall`);
}

function validatePads(level: Level, errors: Errors): void {
  const pads = level.rects.filter((r) => r.kind === 'sand' || r.kind === 'spring' || r.kind === 'bumper');
  for (let i = 0; i < pads.length; i += 1) {
    const pad = pads[i];
    if (pad === undefined) continue;
    for (const x of [pad.x, pad.x + pad.w]) {
      if (inDeclaredGap(level.terrain, x) || fairwayAt(level.terrain, x) === null) errors.push(`${pad.kind} "${pad.id}" reaches into a gap`);
    }
    for (let j = i + 1; j < pads.length; j += 1) {
      const other = pads[j];
      if (other !== undefined && pad.x < other.x + other.w && other.x < pad.x + pad.w) {
        errors.push(`${pad.kind} "${pad.id}" overlaps ${other.kind} "${other.id}"`);
      }
    }
    if (pad.kind === 'spring') {
      const { launch } = pad;
      if (!Number.isFinite(launch.x) || !Number.isFinite(launch.y)) errors.push(`spring "${pad.id}" launch is not finite`);
      if (launch.y >= 0) errors.push(`spring "${pad.id}" must launch upward (launch.y < 0)`);
      if (vec.len(launch) > MAX_BALL_SPEED) errors.push(`spring "${pad.id}" launch exceeds MAX_BALL_SPEED`);
    }
  }
}

function validateRects(level: Level, errors: Errors): void {
  for (const rect of level.rects) {
    if (rect.w <= 0 || rect.h <= 0) errors.push(`rect "${rect.id}" has a non-positive size`);
    if (rect.kind === 'bridge') validateBridge(level, rect, errors);
    if (isWall(rect)) validateWall(level, rect, errors);
  }
  validatePads(level, errors);
}

function validateIds(level: Level, errors: Errors): void {
  const seenRects = new Set<string>();
  for (const rect of level.rects) {
    if (!KEBAB.test(rect.id)) errors.push(`rect id "${rect.id}" is not kebab-case`);
    if (seenRects.has(rect.id)) errors.push(`duplicate rect id ${rect.id}`);
    seenRects.add(rect.id);
  }
  const seenSwitches = new Set<string>();
  for (const sw of level.switches) {
    if (!KEBAB.test(sw.id)) errors.push(`switch id "${sw.id}" is not kebab-case`);
    if (seenSwitches.has(sw.id)) errors.push(`duplicate switch id ${sw.id}`);
    seenSwitches.add(sw.id);
  }
}

/** [] when valid; one message per broken rule otherwise. */
export function validateLevel(level: Level): string[] {
  const errors: Errors = [];
  validateMeta(level, errors);
  validateTerrain(level, errors);
  validateIds(level, errors);
  validateAnchors(level, errors);
  validateSwitches(level, errors);
  validateRects(level, errors);
  return errors;
}

/** Non-fatal authoring advice (ARCH.md §1.7 "warn, not fail"). */
export function levelWarnings(level: Level): string[] {
  const warnings: string[] = [];
  for (const rect of level.rects) {
    if (rect.kind === 'spring' && rect.launch.x === 0) warnings.push(`spring "${rect.id}" launches straight up and may pogo in place`);
  }
  return warnings;
}
