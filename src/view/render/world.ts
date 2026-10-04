// OWNER: view
/**
 * Sky, parallax background, terrain and cup (ARCH.md §1.9; VISUAL.md §4 terrain, §8 cup, §9 layers,
 * §18 performance). The static terrain layer (pits, dirt, grass, stones, tufts, sand bands, spring
 * slots, bumper sockets, fan housings, switch bases, unlit wires, posts, stone walls) is rendered once
 * per level per pixel scale into offscreen tiles (<= 4096 px wide) and blitted every frame.
 */
import type { Gap, Level, PressureSwitch, TerrainPiece } from '../../sim/types';
import { BALL_RADIUS, GIMME_RADIUS, VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import { isRectActive } from '../../sim/terrain';
import type { CupAnim, ViewState } from '../view';
import {
  drawBridgePosts,
  drawBumperSocket,
  drawFanHousing,
  drawSandBand,
  drawSpringSlot,
  drawStoneWall,
  drawSwitchBase,
  drawWire,
  type SurfaceFn,
} from './mechanics';
import { switchLetter } from './text';
import {
  circle,
  DIRT_SHADE_PX,
  fillStroke,
  GRASS_BAND_PX,
  GRASS_SHADE_PX,
  INK,
  line,
  OUTLINE_SMALL,
  OUTLINE_WIDTH,
  PALETTE,
  type Pt,
  roundedPolyline,
  roundRect,
  screenLineWidth,
} from './palette';

/** Sky gradient ends at this logical y (VISUAL.md §1). */
const SKY_GRADIENT_END_Y = 560;
const SUN = { x: 868, y: 128, r: 44, haloR: 62, shadeY: 154 };
const CLOUD_TILE = 1600;
const CLOUD_PARALLAX = 0.15;
const CLOUD_DRIFT = 6;
const HILL_TILE = VIEWPORT_W;
const FAR_PARALLAX = 0.25;
const MID_PARALLAX = 0.45;
const CLOUDS: ReadonlyArray<{ x: number; y: number; s: number }> = [
  { x: 200, y: 118, s: 1.15 },
  { x: 560, y: 92, s: 0.8 },
  { x: 1090, y: 176, s: 0.9 },
];
const CLOUD_BLOBS: readonly Pt[] = [
  [0, 0],
  [28, -10],
  [52, 2],
  [-26, 6],
  [14, 10],
];
const CLOUD_RADII = [30, 24, 22, 20, 22];
const FAR_HILLS: readonly Pt[] = [
  [0, 470],
  [120, 420],
  [260, 450],
  [420, 400],
  [560, 440],
  [700, 395],
  [860, 430],
  [1000, 380],
  [1140, 420],
  [1280, 470],
];
const MID_HILLS: readonly Pt[] = [
  [0, 520],
  [90, 480],
  [200, 505],
  [330, 470],
  [470, 500],
  [600, 462],
  [760, 498],
  [900, 455],
  [1060, 492],
  [1200, 462],
  [1280, 520],
];
const TREES: ReadonlyArray<[number, number, number]> = [
  [150, 486, 14],
  [612, 468, 12],
  [905, 459, 15],
  [1210, 466, 12],
  [560, 480, 9],
];
/** Horizontal flat continuation of the first/last piece beyond the level bounds (D3 CD-5). */
const TERRAIN_OVERSCAN_PX = 400;
/** Dirt painted below the level bottom so the overview never shows sky under the ground. */
const UNDER_DEPTH_PX = 300;
const LAYER_TOP_MARGIN = 60;
const MAX_TILE_DEVICE_PX = 4096;
const CORNER_RADIUS = 18;
const STONE_COUNT = 11;
const TUFT_SPACING = 74;
const PIT_LIP_DROP = 20;
const PIT_MARGIN = 6;
const FLAG_POLE_H = 78;
const FLAG_W = 34;
const FLAG_H = 24;
const FLAG_COLS = 4;
const FLAG_ROWS = 3;

// ---- surface queries (render-local: the sim's authoring queries are not for the view) ----------

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

/** First surface below a point: piece tops and active rect tops (ball shadows). */
export function groundYBelow(level: Level, switches: Readonly<Record<string, boolean>>, x: number, y: number): number | null {
  const minY = y - BALL_RADIUS;
  let best: number | null = null;
  const consider = (sy: number | null): void => {
    if (sy !== null && sy >= minY && (best === null || sy < best)) best = sy;
  };
  for (const piece of level.terrain.pieces) consider(pieceSurfaceY(piece, x));
  for (const r of level.rects) {
    if (r.kind !== 'bridge' && r.kind !== 'blocker' && r.kind !== 'colourGate') continue;
    if (x >= r.x && x <= r.x + r.w && isRectActive(r, switches)) consider(r.y);
  }
  return best ?? fairwayYExtended(level, x);
}

// ---- sky and parallax (screen space, before the camera transform) -----------------------------

/** Fill the circular segment of (cx, cy, r) that lies below the horizontal line `chordY` (no clip). */
function fillBelowChord(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, chordY: number, colour: string): void {
  if (chordY >= cy + r) return;
  ctx.beginPath();
  if (chordY <= cy - r) ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else {
    const theta = Math.asin((chordY - cy) / r);
    ctx.arc(cx, cy, r, theta, Math.PI - theta);
    ctx.closePath();
  }
  ctx.fillStyle = colour;
  ctx.fill();
}

function drawSun(ctx: CanvasRenderingContext2D): void {
  circle(ctx, SUN.x, SUN.y, SUN.haloR);
  ctx.fillStyle = PALETTE.whiteHalo;
  ctx.fill();
  circle(ctx, SUN.x, SUN.y, SUN.r);
  fillStroke(ctx, PALETTE.sun, OUTLINE_WIDTH);
  fillBelowChord(ctx, SUN.x, SUN.y, SUN.r - OUTLINE_WIDTH / 2, SUN.shadeY, PALETTE.sunSh);
  ctx.beginPath();
  ctx.ellipse(SUN.x - 0.32 * SUN.r, SUN.y - 0.36 * SUN.r, 0.3 * SUN.r, 0.2 * SUN.r, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.whiteSoft;
  ctx.fill();
}

function cloudPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  CLOUD_BLOBS.forEach((b, i) => {
    const r = (CLOUD_RADII[i] ?? 20) * s;
    ctx.moveTo(x + b[0] * s + r, y + b[1] * s);
    ctx.arc(x + b[0] * s, y + b[1] * s, r, 0, Math.PI * 2);
  });
}

/** Union outline (thick stroke, then fill) and a flat underside shade built from circular segments. */
function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  cloudPath(ctx, x, y, s);
  ctx.lineWidth = 7;
  ctx.strokeStyle = PALETTE.cloudInk;
  ctx.stroke();
  cloudPath(ctx, x, y, s);
  ctx.fillStyle = PALETTE.cloud;
  ctx.fill();
  CLOUD_BLOBS.forEach((b, i) => {
    const r = (CLOUD_RADII[i] ?? 20) * s;
    fillBelowChord(ctx, x + b[0] * s, y + b[1] * s, r, y + 11 * s, PALETTE.cloudSh);
  });
}

function drawClouds(ctx: CanvasRenderingContext2D, camX: number, timeSec: number): void {
  const shift = -camX * CLOUD_PARALLAX + timeSec * CLOUD_DRIFT;
  for (const c of CLOUDS) {
    let x = (((c.x + shift) % CLOUD_TILE) + CLOUD_TILE) % CLOUD_TILE;
    if (x > VIEWPORT_W + 120) x -= CLOUD_TILE;
    drawCloud(ctx, x, c.y, c.s);
  }
}

/** The band's top edge over three periodic tiles (the polylines end on their start y) so there are no seams. */
function hillRidge(pts: readonly Pt[], shift: number): Pt[] {
  const joined: Pt[] = [];
  for (let k = -1; k <= 1; k += 1) {
    const ox = shift + k * HILL_TILE;
    pts.forEach((p, i) => {
      if (i === 0 && joined.length > 0) return;
      joined.push([p[0] + ox, p[1]]);
    });
  }
  return joined;
}

/**
 * Fills one band from its ridge down to the viewport bottom (the terrain covers the lower part, so the
 * hills meet the grass at any fairway height), then inks only the open ridge line when `ink` is set.
 */
function fillHillBand(ctx: CanvasRenderingContext2D, pts: readonly Pt[], shift: number, r: number, fill: string, ink?: string): void {
  const ridge = hillRidge(pts, shift);
  const first = ridge[0];
  const last = ridge[ridge.length - 1];
  if (first === undefined || last === undefined) return;
  ctx.beginPath();
  ctx.moveTo(first[0], VIEWPORT_H);
  roundedPolyline(ctx, ridge, r, false);
  ctx.lineTo(last[0], VIEWPORT_H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (ink === undefined) return;
  ctx.beginPath();
  roundedPolyline(ctx, ridge, r, true);
  ctx.lineWidth = OUTLINE_SMALL;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawHills(ctx: CanvasRenderingContext2D, camX: number): void {
  const farShift = -((camX * FAR_PARALLAX) % HILL_TILE);
  const midShift = -((camX * MID_PARALLAX) % HILL_TILE);
  fillHillBand(ctx, FAR_HILLS, farShift, 70, PALETTE.hillFar);
  fillHillBand(ctx, MID_HILLS, midShift, 60, PALETTE.hillMid, PALETTE.hillMidInk);
  for (let k = -1; k <= 1; k += 1) {
    const ox = midShift + k * HILL_TILE;
    if (ox > VIEWPORT_W || ox + HILL_TILE < 0) continue;
    for (const [tx, ty, r] of TREES) {
      line(ctx, tx + ox, ty + r, tx + ox, ty + r + 14, 4, PALETTE.hillMidInk);
      circle(ctx, tx + ox, ty, r);
      fillStroke(ctx, PALETTE.tree, OUTLINE_SMALL, PALETTE.hillMidInk);
    }
  }
}

/** Gradient + sun + clouds + parallax hills, full viewport, BEFORE the camera transform. */
export function drawSky(ctx: CanvasRenderingContext2D, view: ViewState): void {
  const g = ctx.createLinearGradient(0, 0, 0, SKY_GRADIENT_END_Y);
  g.addColorStop(0, PALETTE.sky1);
  g.addColorStop(1, PALETTE.sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
  drawSun(ctx);
  const camX = view.camera.x * view.camera.zoom;
  drawClouds(ctx, camX, view.timeSec);
  drawHills(ctx, camX);
}

// ---- terrain pieces ---------------------------------------------------------------------------

type PieceSpan = { pts: Pt[]; x0: number; x1: number; piece: TerrainPiece };

function orderedPieces(level: Level): { first: TerrainPiece | null; last: TerrainPiece | null } {
  let first: TerrainPiece | null = null;
  let last: TerrainPiece | null = null;
  for (const p of level.terrain.pieces) {
    const a = p.surface[0];
    const b = p.surface[p.surface.length - 1];
    if (a === undefined || b === undefined) continue;
    if (first === null || a.x < (first.surface[0]?.x ?? Infinity)) first = p;
    if (last === null || b.x > (last.surface[last.surface.length - 1]?.x ?? -Infinity)) last = p;
  }
  return { first, last };
}

/** Surface polyline with the D3 flat continuation past the level edges on the outer pieces. */
function pieceSpan(level: Level, piece: TerrainPiece, outer: { first: TerrainPiece | null; last: TerrainPiece | null }): PieceSpan | null {
  const s = piece.surface;
  const a = s[0];
  const b = s[s.length - 1];
  if (a === undefined || b === undefined) return null;
  const pts: Pt[] = s.map((p): Pt => [p.x, p.y]);
  let x0 = a.x;
  let x1 = b.x;
  if (piece === outer.first && a.x <= 0) {
    x0 = a.x - TERRAIN_OVERSCAN_PX;
    pts.unshift([x0, a.y]);
  }
  if (piece === outer.last && b.x >= level.width) {
    x1 = b.x + TERRAIN_OVERSCAN_PX;
    pts.push([x1, b.y]);
  }
  return { pts, x0, x1, piece };
}

function spanSurfaceY(span: PieceSpan, x: number): number {
  const first = span.pts[0];
  const last = span.pts[span.pts.length - 1];
  if (first !== undefined && x <= first[0]) return first[1];
  if (last !== undefined && x >= last[0]) return last[1];
  return pieceSurfaceY(span.piece, x) ?? span.piece.baseY;
}

function bodyPath(ctx: CanvasRenderingContext2D, span: PieceSpan, bottom: number): void {
  ctx.beginPath();
  roundedPolyline(ctx, span.pts, CORNER_RADIUS, true);
  ctx.lineTo(span.x1, bottom);
  ctx.lineTo(span.x0, bottom);
  ctx.closePath();
}

/** Band between the surface offset by d0 and by d1 (both rounded), clipped to the body by geometry. */
function bandPath(ctx: CanvasRenderingContext2D, span: PieceSpan, d0: number, d1: number): void {
  const upper = span.pts.map((p): Pt => [p[0], p[1] + d0]);
  const lower = span.pts.map((p): Pt => [p[0], p[1] + d1]).reverse();
  ctx.beginPath();
  roundedPolyline(ctx, upper, CORNER_RADIUS, true);
  roundedPolyline(ctx, lower, CORNER_RADIUS, false);
  ctx.closePath();
}

function drawStones(ctx: CanvasRenderingContext2D, span: PieceSpan): void {
  let seed = Math.abs(Math.floor(span.x0)) + 7;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const width = span.x1 - span.x0;
  if (width < 80) return;
  ctx.fillStyle = PALETTE.dirtSh;
  for (let i = 0; i < STONE_COUNT; i += 1) {
    const rx = span.x0 + 20 + rnd() * (width - 40);
    const rw = 16 + rnd() * 18;
    const ry = spanSurfaceY(span, rx) + 70 + rnd() * 100;
    if (ry + rw * 0.72 > span.piece.baseY - 6) continue;
    roundRect(ctx, rx, ry, rw, rw * 0.72, rw * 0.36);
    ctx.fill();
  }
}

function drawTufts(ctx: CanvasRenderingContext2D, span: PieceSpan): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = PALETTE.grassSh;
  ctx.lineCap = 'round';
  for (let tx = span.x0 + 34; tx < span.x1 - 20; tx += TUFT_SPACING) {
    const ty = spanSurfaceY(span, tx);
    ctx.beginPath();
    ctx.moveTo(tx, ty + 8);
    ctx.lineTo(tx - 4, ty + 1);
    ctx.moveTo(tx + 1, ty + 9);
    ctx.lineTo(tx + 2, ty);
    ctx.moveTo(tx + 3, ty + 8);
    ctx.lineTo(tx + 8, ty + 2);
    ctx.stroke();
  }
}

/** Flat dirt body, 12 px dirt shade band, stones, 24 px grass band with its 15 px shade, tufts, outline. */
function drawPiece(ctx: CanvasRenderingContext2D, span: PieceSpan, bottom: number, lw: number): void {
  bodyPath(ctx, span, bottom);
  fillStroke(ctx, PALETTE.dirt, lw);
  bandPath(ctx, span, GRASS_BAND_PX, GRASS_BAND_PX + DIRT_SHADE_PX);
  ctx.fillStyle = PALETTE.dirtSh;
  ctx.fill();
  drawStones(ctx, span);
  bandPath(ctx, span, 0, GRASS_BAND_PX);
  fillStroke(ctx, PALETTE.grass, lw);
  bandPath(ctx, span, GRASS_SHADE_PX, GRASS_BAND_PX);
  ctx.fillStyle = PALETTE.grassSh;
  ctx.fill();
  drawTufts(ctx, span);
  bodyPath(ctx, span, bottom);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Dark pit under a gap: gradient from 20 px below the lips, jagged rock floor, flat below the level. */
function drawPit(ctx: CanvasRenderingContext2D, level: Level, g: Gap, bottom: number): void {
  const lipL = fairwayYAt(level, g.x1 - 1) ?? VIEWPORT_H;
  const lipR = fairwayYAt(level, g.x2 + 1) ?? VIEWPORT_H;
  const top = Math.max(lipL, lipR) + PIT_LIP_DROP;
  const x0 = g.x1 - PIT_MARGIN;
  const w = g.x2 - g.x1 + PIT_MARGIN * 2;
  const grad = ctx.createLinearGradient(0, top, 0, VIEWPORT_H);
  grad.addColorStop(0, PALETTE.pitTop);
  grad.addColorStop(1, PALETTE.pitBot);
  ctx.fillStyle = grad;
  ctx.fillRect(x0, top, w, VIEWPORT_H - top);
  ctx.fillStyle = PALETTE.pitBot;
  ctx.fillRect(x0, VIEWPORT_H - 1, w, bottom - VIEWPORT_H + 1);
  ctx.beginPath();
  ctx.moveTo(x0, VIEWPORT_H);
  let x = x0;
  let up = true;
  while (x < x0 + w) {
    x += 18 + ((Math.floor(x) * 7) % 11);
    ctx.lineTo(Math.min(x, x0 + w), up ? VIEWPORT_H - 30 - ((Math.floor(x) * 3) % 14) : VIEWPORT_H - 8);
    up = !up;
  }
  ctx.lineTo(x0 + w, VIEWPORT_H);
  ctx.closePath();
  ctx.fillStyle = PALETTE.rock;
  ctx.fill();
}

// ---- static props that live in the cached layer -----------------------------------------------

function switchHasWire(sw: PressureSwitch): boolean {
  return sw.onRectId === undefined;
}

function drawStaticProps(ctx: CanvasRenderingContext2D, level: Level, surface: SurfaceFn): void {
  for (const r of level.rects) {
    switch (r.kind) {
      case 'sand':
        drawSandBand(ctx, r.x, r.x + r.w, surface);
        break;
      case 'spring':
        drawSpringSlot(ctx, r.x + r.w / 2, surface(r.x + r.w / 2));
        break;
      case 'bumper':
        drawBumperSocket(ctx, r.x + r.w / 2, surface(r.x + r.w / 2));
        break;
      case 'fan':
        drawFanHousing(ctx, r.x + r.w / 2, surface(r.x + r.w / 2));
        break;
      case 'bridge':
        drawBridgePosts(ctx, r, false);
        break;
      case 'blocker':
        if (r.switchId === undefined && r.switchIds === undefined) drawStoneWall(ctx, r);
        break;
      case 'colourGate':
        break;
    }
  }
  level.switches.forEach((sw, i) => {
    if (!switchHasWire(sw)) return;
    drawSwitchBase(ctx, sw, switchLetter(i));
    for (const r of level.rects) {
      const linked = r.switchIds !== undefined ? r.switchIds.includes(sw.id) : r.switchId === sw.id;
      if (linked) drawWire(ctx, sw, r, false, surface);
    }
  });
}

// ---- cached layer -----------------------------------------------------------------------------

type LayerTile = { canvas: HTMLCanvasElement; x0: number; x1: number };
type TerrainLayer = { generation: number; tiles: LayerTile[]; top: number; bottom: number; failed: boolean };

const layerCache = new WeakMap<Level, Map<number, TerrainLayer>>();
let layerGeneration = 0;

/** Drop every cached terrain layer (DPR change, fonts resolved). */
export function invalidateTerrainLayers(): void {
  layerGeneration += 1;
}

function layerBounds(level: Level): { top: number; bottom: number } {
  let top = VIEWPORT_H;
  for (const p of level.terrain.pieces) for (const v of p.surface) top = Math.min(top, v.y);
  for (const r of level.rects) if (r.kind === 'blocker' || r.kind === 'colourGate') top = Math.min(top, r.y);
  return { top: Math.min(0, top - LAYER_TOP_MARGIN), bottom: VIEWPORT_H + UNDER_DEPTH_PX };
}

/** Everything static, drawn in world coordinates into whatever ctx (tile or live). */
function paintTerrain(ctx: CanvasRenderingContext2D, level: Level, zoom: number, bottom: number): void {
  const outer = orderedPieces(level);
  const lw = screenLineWidth(zoom);
  for (const g of level.terrain.gaps) drawPit(ctx, level, g, bottom);
  for (const piece of level.terrain.pieces) {
    const span = pieceSpan(level, piece, outer);
    if (span !== null) drawPiece(ctx, span, Math.max(bottom, piece.baseY), lw);
  }
  const surface: SurfaceFn = (x) => fairwayYExtended(level, x) ?? VIEWPORT_H;
  drawStaticProps(ctx, level, surface);
}

function buildTile(level: Level, pixelScale: number, zoom: number, x0: number, x1: number, top: number, bottom: number): LayerTile | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((x1 - x0) * pixelScale);
  canvas.height = Math.ceil((bottom - top) * pixelScale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(pixelScale, 0, 0, pixelScale, -x0 * pixelScale, -top * pixelScale);
  paintTerrain(ctx, level, zoom, bottom);
  return { canvas, x0, x1 };
}

function buildLayer(level: Level, pixelScale: number, zoom: number): TerrainLayer {
  const { top, bottom } = layerBounds(level);
  const worldX0 = -TERRAIN_OVERSCAN_PX;
  const worldX1 = level.width + TERRAIN_OVERSCAN_PX;
  const tileWorldW = Math.max(256, Math.floor(MAX_TILE_DEVICE_PX / pixelScale));
  const tiles: LayerTile[] = [];
  let failed = false;
  if (typeof document === 'undefined') failed = true;
  for (let x = worldX0; x < worldX1 && !failed; x += tileWorldW) {
    const tile = buildTile(level, pixelScale, zoom, x, Math.min(worldX1, x + tileWorldW), top, bottom);
    if (tile === null) failed = true;
    else tiles.push(tile);
  }
  return { generation: layerGeneration, tiles, top, bottom, failed };
}

function layerFor(level: Level, pixelScale: number, zoom: number): TerrainLayer {
  let byScale = layerCache.get(level);
  if (byScale === undefined) {
    byScale = new Map();
    layerCache.set(level, byScale);
  }
  const key = Math.round(pixelScale * 100) / 100;
  const cached = byScale.get(key);
  if (cached !== undefined && cached.generation === layerGeneration) return cached;
  const layer = buildLayer(level, pixelScale, zoom);
  byScale.set(key, layer);
  return layer;
}

/** Device pixels per world unit of the current ctx transform. */
function pixelScaleOf(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.max(0.05, Math.sqrt(m.a * m.a + m.b * m.b));
}

/**
 * Blits the cached static layer at the current world transform (ARCH: flat dirt fill, constant
 * grass cap, outlines; overhang pieces get the cap too). `zoom` scales the outline clamp (default 1).
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, level: Level, zoom: number = 1): void {
  const layer = layerFor(level, pixelScaleOf(ctx), zoom);
  if (layer.failed) {
    paintTerrain(ctx, level, zoom, layer.bottom);
    return;
  }
  const h = layer.bottom - layer.top;
  for (const tile of layer.tiles) {
    ctx.drawImage(tile.canvas, tile.x0, layer.top, tile.x1 - tile.x0, h);
  }
}

// ---- cup --------------------------------------------------------------------------------------

function drawGimmeRing(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number): void {
  const k = pulse < 1 ? 1 + 0.15 * Math.abs(Math.sin(pulse * Math.PI * 3)) : 1;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, GIMME_RADIUS * k, 8 * k, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.whiteHalo;
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PALETTE.windLine;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, flip: boolean): void {
  const fx = x + 3;
  const fy = y - FLAG_POLE_H - 2;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.transform(1, 0, Math.tan(((flip ? 6 : -6) * Math.PI) / 180) * 0.5, 1, 0, 0);
  roundRect(ctx, 0, 0, FLAG_W, FLAG_H, 4);
  fillStroke(ctx, PALETTE.white, OUTLINE_SMALL);
  const cw = FLAG_W / FLAG_COLS;
  const ch = FLAG_H / FLAG_ROWS;
  ctx.fillStyle = INK;
  for (let i = 0; i < FLAG_COLS; i += 1) {
    for (let j = 0; j < FLAG_ROWS; j += 1) {
      if ((i + j) % 2 !== 0) continue;
      const cx = i * cw;
      const cy = j * ch;
      const inset = i === 0 || i === FLAG_COLS - 1 || j === 0 || j === FLAG_ROWS - 1 ? 1.5 : 0;
      ctx.fillRect(cx + inset, cy + inset, cw - inset * 2, ch - inset * 2);
    }
  }
  roundRect(ctx, 0, 0, FLAG_W, FLAG_H, 4);
  ctx.lineWidth = OUTLINE_SMALL;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** Gimme ring (rx = GIMME_RADIUS), hole, pole and the chequered flag (2-frame flip at 2 Hz). */
export function drawCup(ctx: CanvasRenderingContext2D, level: Level, flagWobble: number, anim?: CupAnim): void {
  const { x, rimY } = level.hole;
  const kick = anim !== undefined && anim.kick < 0.3 ? -10 * Math.sin((anim.kick / 0.3) * Math.PI) : 0;
  const wiggle = anim !== undefined && anim.wiggle < 0.5 ? Math.sin(anim.wiggle * 40) * 3 : 0;
  const squash = anim !== undefined && anim.squash < 0.034 ? 1.1 : 1;
  drawGimmeRing(ctx, x, rimY, anim?.pulse ?? 1);
  ctx.beginPath();
  ctx.ellipse(x, rimY, 17 * squash, 6 / squash, 0, 0, Math.PI * 2);
  fillStroke(ctx, INK, OUTLINE_SMALL);
  const poleTop = rimY - FLAG_POLE_H + kick;
  roundRect(ctx, x - 3 + wiggle, poleTop + 2, 6, FLAG_POLE_H - 2, 3);
  fillStroke(ctx, PALETTE.white, OUTLINE_SMALL);
  drawFlag(ctx, x + wiggle, rimY + kick, Math.floor(flagWobble) % 2 === 0);
}
