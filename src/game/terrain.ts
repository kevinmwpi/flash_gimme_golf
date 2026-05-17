import type { GroundBlock, Level, Vec } from './types';

const TILE = 40;

/** Build stacked Mario-style ground from a row of surface heights. */
export function blocksFromHeights(
  segments: { x: number; w: number; surfaceY: number; thickness?: number }[],
): GroundBlock[] {
  return segments.map((s) => ({
    x: s.x,
    y: s.surfaceY,
    w: s.w,
    h: s.thickness ?? 120,
    kind: 'solid' as const,
  }));
}

export function blocksFromRow(x: number, count: number, surfaceY: number, thickness = 120): GroundBlock[] {
  const out: GroundBlock[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ x: x + i * TILE, y: surfaceY, w: TILE, h: thickness, kind: 'solid' });
  }
  return out;
}

/** Top ground surface Y at world X (smallest y = highest point). */
export function surfaceYAt(level: Level, x: number): number | null {
  let best: number | null = null;
  for (const block of level.blocks) {
    if (x < block.x || x > block.x + block.w) continue;
    if (best === null || block.y < best) best = block.y;
  }
  for (const seg of level.segments) {
    if (seg.kind !== 'ramp') continue;
    const minX = Math.min(seg.a.x, seg.b.x);
    const maxX = Math.max(seg.a.x, seg.b.x);
    if (x < minX || x > maxX) continue;
    const t = (x - seg.a.x) / Math.max(maxX - minX, 1);
    const y = seg.a.y + (seg.b.y - seg.a.y) * t;
    if (best === null || y < best) best = y;
  }
  return best;
}

export function surfaceNormalAt(level: Level, x: number): Vec {
  const eps = 8;
  const y0 = surfaceYAt(level, x - eps);
  const y1 = surfaceYAt(level, x + eps);
  if (y0 === null || y1 === null) return { x: 0, y: -1 };
  const dx = eps * 2;
  const dy = y1 - y0;
  const tangent = { x: dx, y: dy };
  const len = Math.hypot(tangent.x, tangent.y) || 1;
  tangent.x /= len;
  tangent.y /= len;
  return { x: -tangent.y, y: tangent.x };
}

export function snapToSurface(level: Level, x: number, radius: number): Vec | null {
  const y = surfaceYAt(level, x);
  if (y === null) return null;
  return { x, y: y - radius };
}

export function placeBallOnSurface(level: Level, x: number, radius: number): Vec {
  return snapToSurface(level, x, radius) ?? { x, y: level.starts[0]?.y ?? 500 };
}

export function placeGolferBesideBall(ballPos: Vec, facing = 1): Vec {
  return { x: ballPos.x - 26 * facing, y: ballPos.y };
}

export function alignGolferToGround(level: Level, golfer: Vec, ballRadius: number): Vec {
  const surface = surfaceYAt(level, golfer.x);
  if (surface === null) return golfer;
  return { x: golfer.x, y: surface - ballRadius - 20 };
}

/** Left/right world bounds from blocks. */
export function levelBounds(level: Level) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const b of level.blocks) {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x + b.w);
  }
  return { minX: minX === Infinity ? 0 : minX, maxX: maxX === -Infinity ? level.width : maxX };
}

export function isOverHole(level: Level, pos: Vec, radius: number) {
  const { hole } = level;
  const dx = pos.x - hole.x;
  return Math.abs(dx) < hole.radius * 0.85 && pos.y + radius >= hole.rimY - 4;
}

export function drawMarioBlock(ctx: CanvasRenderingContext2D, block: GroundBlock) {
  const { x, y, w, h } = block;
  ctx.fillStyle = '#6b3f1f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#8b5528';
  for (let row = 0; row < h; row += TILE / 2) {
    for (let col = 0; col < w; col += TILE) {
      const ox = (col / TILE) % 2 === 0 ? 0 : TILE / 2;
      ctx.fillRect(x + col + ox, y + row, TILE / 2 - 2, TILE / 2 - 2);
    }
  }
  ctx.fillStyle = '#5cb838';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = '#7ee85a';
  ctx.fillRect(x, y, w, 4);
  ctx.strokeStyle = '#3d6620';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}
