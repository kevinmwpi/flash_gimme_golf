// OWNER: view
/**
 * Render-local terrain queries (the sim's authoring queries are not for the view): the fairway under an x,
 * with or without the flat continuation past the level bounds. world.ts (terrain layer, shadows), devices.ts
 * (trap floors, cannon cradles) and view.ts (golfers standing beside a waiting ball) share them.
 */
import type { Level, TerrainPiece } from '../../sim/types';

export function pieceSurfaceY(piece: TerrainPiece, x: number): number | null {
  const s = piece.surface;
  const first = s[0];
  const last = s[s.length - 1];
  if (first === undefined || last === undefined || x < first.x || x > last.x) return null;
  for (let i = 0; i < s.length - 1; i += 1) {
    const a = s[i];
    const b = s[i + 1];
    if (a === undefined || b === undefined || x > b.x) continue;
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t;
  }
  return last.y;
}

/** LOWEST (largest y) piece surface at x: the fairway. null inside a gap or outside the level. */
export function fairwayYAt(level: Level, x: number): number | null {
  let best: number | null = null;
  for (const piece of level.terrain.pieces) {
    const y = pieceSurfaceY(piece, x);
    if (y !== null && (best === null || y > best)) best = y;
  }
  return best;
}

/** Fairway y at x, with flat continuation past the level bounds (for shadows near the edges). */
export function fairwayYExtended(level: Level, x: number): number | null {
  const clamped = Math.min(Math.max(x, 0), level.width);
  return fairwayYAt(level, clamped);
}
