import type { Level, Rect, Terrain, TerrainPiece, Vec } from './types';

type PropDef = Omit<Rect, 'x' | 'y'> & { centerX: number };

/** Build one connected terrain piece from [x,y] control points (sorted by x). */
export function terrainPiece(points: [number, number][], baseY: number): TerrainPiece {
  return {
    surface: points.map(([x, y]) => ({ x, y })),
    baseY,
  };
}

export function inGap(terrain: Terrain, x: number) {
  return terrain.gaps?.some((g) => x >= g.x1 && x <= g.x2) ?? false;
}

/** Interpolate surface height at x across all terrain pieces. */
export function surfaceYAt(level: Level, x: number): number | null {
  if (inGap(level.terrain, x)) return null;
  let best: number | null = null;
  for (const piece of level.terrain.pieces) {
    const y = surfaceYOnPiece(piece, x);
    if (y !== null && (best === null || y < best)) best = y;
  }
  for (const seg of level.segments) {
    if (seg.kind !== 'platform') continue;
    const minX = Math.min(seg.a.x, seg.b.x);
    const maxX = Math.max(seg.a.x, seg.b.x);
    if (x < minX || x > maxX) continue;
    const t = (x - seg.a.x) / Math.max(maxX - minX, 1);
    const y = seg.a.y + (seg.b.y - seg.a.y) * t;
    if (best === null || y < best) best = y;
  }
  return best;
}

function surfaceYOnPiece(piece: TerrainPiece, x: number): number | null {
  const pts = piece.surface;
  if (pts.length < 2) return null;
  if (x < pts[0].x || x > pts[pts.length - 1].x) return null;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / Math.max(b.x - a.x, 1);
      return a.y + (b.y - a.y) * t;
    }
  }
  return null;
}

export function surfaceNormalAt(level: Level, x: number): Vec {
  const eps = 10;
  const y0 = surfaceYAt(level, x - eps);
  const y1 = surfaceYAt(level, x + eps);
  if (y0 === null || y1 === null) return { x: 0, y: -1 };
  const tangent = { x: eps * 2, y: y1 - y0 };
  const l = Math.hypot(tangent.x, tangent.y) || 1;
  tangent.x /= l;
  tangent.y /= l;
  return { x: -tangent.y, y: tangent.x };
}

export function terrainSurfaceSegments(level: Level): { a: Vec; b: Vec }[] {
  const segs: { a: Vec; b: Vec }[] = [];
  for (const piece of level.terrain.pieces) {
    for (let i = 0; i < piece.surface.length - 1; i += 1) {
      segs.push({ a: piece.surface[i], b: piece.surface[i + 1] });
    }
  }
  return segs;
}

export function snapToSurface(level: Level, x: number, radius: number): Vec | null {
  const y = surfaceYAt(level, x);
  if (y === null) return null;
  return { x, y: y - radius };
}

export function placeBallOnSurface(level: Level, x: number, radius: number): Vec {
  return snapToSurface(level, x, radius) ?? { x, y: 520 };
}

export function placeGolferBesideBall(ballPos: Vec, facing = 1): Vec {
  return { x: ballPos.x - 26 * facing, y: ballPos.y };
}

export function alignGolferToGround(level: Level, golfer: Vec, ballRadius: number): Vec {
  const surface = surfaceYAt(level, golfer.x);
  if (surface === null) return golfer;
  return { x: golfer.x, y: surface - ballRadius - 20 };
}

export function isOverHole(level: Level, pos: Vec, radius: number) {
  const { hole } = level;
  return Math.abs(pos.x - hole.x) < hole.radius * 0.85 && pos.y + radius >= hole.rimY - 4;
}

/** Place rect/switch so it sits on top of the walkable surface. */
export function rectOnSurface(level: Level, centerX: number, w: number, h: number): { x: number; y: number } {
  const y = surfaceYAt(level, centerX);
  const top = y ?? 560;
  return { x: centerX - w / 2, y: top - h };
}

/** Height for a bridge/gate spanning a gap between two ground lips. */
export function bridgeSurfaceY(level: Level, gapX1: number, gapX2: number): number {
  const left = surfaceYAt(level, gapX1 - 4);
  const right = surfaceYAt(level, gapX2 + 4);
  if (left !== null && right !== null) return (left + right) / 2;
  return left ?? right ?? 600;
}

export function switchOnSurface(level: Level, centerX: number, w: number, h: number) {
  const { x, y } = rectOnSurface(level, centerX, w, h);
  return { x, y: y + h - 2 };
}

export function applyPropsOnSurface(level: Level, props: PropDef[]): Rect[] {
  return props.map((p) => {
    const { centerX, ...rest } = p;
    const { x, y } = rectOnSurface(level, centerX, rest.w, rest.h);
    return { ...rest, x, y };
  });
}

export function applySwitchesOnSurface(
  level: Level,
  defs: { id: string; centerX: number; w: number; h: number; label: string }[],
) {
  return defs.map((d) => {
    const { x, y } = switchOnSurface(level, d.centerX, d.w, d.h);
    return { id: d.id, x, y, w: d.w, h: d.h, pressed: false, label: d.label };
  });
}

export function holeAt(level: Level, x: number, radius = 16) {
  const rimY = surfaceYAt(level, x) ?? 500;
  return { x, y: rimY + radius * 0.35, radius, rimY, depth: radius * 1.8 };
}

export function drawTerrain(ctx: CanvasRenderingContext2D, terrain: Terrain) {
  for (const piece of terrain.pieces) drawTerrainPiece(ctx, piece);
}

function drawTerrainPiece(ctx: CanvasRenderingContext2D, piece: TerrainPiece) {
  const { surface, baseY } = piece;
  if (surface.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i += 1) ctx.lineTo(surface[i].x, surface[i].y);
  ctx.lineTo(surface[surface.length - 1].x, baseY);
  ctx.lineTo(surface[0].x, baseY);
  ctx.closePath();

  const minY = Math.min(...surface.map((p) => p.y));
  const grad = ctx.createLinearGradient(0, minY, 0, baseY);
  grad.addColorStop(0, '#7ee85a');
  grad.addColorStop(0.06, '#5cb838');
  grad.addColorStop(0.12, '#8b5528');
  grad.addColorStop(1, '#5a3418');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = '#3d6620';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(surface[0].x, surface[0].y);
  for (let i = 1; i < surface.length; i += 1) ctx.lineTo(surface[i].x, surface[i].y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  for (let row = minY + 24; row < baseY; row += 22) {
    ctx.beginPath();
    ctx.moveTo(surface[0].x, row);
    ctx.lineTo(surface[surface.length - 1].x, row);
    ctx.stroke();
  }
}
