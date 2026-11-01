// OWNER: view
/**
 * Mechanic silhouettes (ARCH.md §1.9, VISUAL.md §4): sand, spring, bumper, fan, colour gate, bridge,
 * blocker gate / stone wall and the pressure switch (traps and cannons: devices.ts). Every prop is flush
 * with the surface; one hard shade band per material; 4 px ink. Static parts
 * (`draw*Slot/Socket/Housing/Base/Posts/Wire`) are painted into the cached terrain layer by world.ts;
 * `drawRect`/`drawSwitch` draw the whole prop by default and only the animated parts when asked
 * (`parts: 'dynamic'`).
 */
import type { BlockerRect, BridgeRect, BumperRect, ColourGateRect, FanRect, Level, LevelRect, PressureSwitch, SpringRect } from '../../sim/types';
import { VIEWPORT_H } from '../../sim/types';
import type { GateAnim } from '../view';
import {
  cannonGeometry,
  drawCannonBarrel,
  drawCannonCradle,
  drawTrapBase,
  drawTrapJaws,
  flatTrapGeometry,
  recoilOf,
  trapGeometry,
  type WirePost,
} from './devices';
import { circle, clamp01, easeOut, fillStroke, INK, inkLine, line, OUTLINE_DOT, OUTLINE_SMALL, OUTLINE_WIDTH, PALETTE, PLAYER_VIEW, roundRect } from './palette';
import { bottomBand, lamp, letterTag, post, POST_H, switchGeometry } from './parts';
import { switchLetter } from './text';

export { switchGeometry, type SwitchGeometry } from './parts';

/** Fairway y at a world x (the layer passes the real polyline; standalone callers pass a flat line). */
export type SurfaceFn = (x: number) => number;
/** Fairway y at a world x for wire routing: null inside a gap (a wire hangs across a chasm, it never dives into it). */
export type WireSurface = (x: number) => number | null;

export type RectDrawOptions = {
  /** Switch letter shown on the letter tag (bridge left post / blocker top post). */
  letter?: string;
  /** 'dynamic' skips the parts the cached terrain layer already holds. */
  parts?: 'all' | 'dynamic';
  gate?: GateAnim | undefined;
  /**
   * World y a colour field's badge stays below: the top of the visible playfield under the HUD band and under
   * the field's own label when that label slid down into the playfield (D10.8). Default GATE_BADGE_TOP_Y.
   */
  badgeTop?: number;
};

const SAND_DEPTH = 16;
const SAND_SAMPLES = 8;
/** The plate is drawn at the pad's width (D10.8: L9's pad is 64 px), never narrower than its slot. */
const SPRING_PLATE_MIN_W = 40;
const SPRING_PLATE_H = 14;
const SPRING_SQUASH_T = 0.033;
const SPRING_OVERSHOOT_T = 0.1;
const SPRING_SETTLE_T = 0.3;
const BUMPER_R = 22;
const BUMPER_FLASH_T = 0.034;
const BUMPER_RING_T = 0.2;
const FAN_HOUSING_W = 56;
const FAN_HOUSING_H = 30;
const FAN_CHEVRON_PITCH = 34;
const FAN_SCROLL_PX_PER_S = 60;
const FAN_TURNS_PER_S = 2;
const GATE_FIELD_ALPHA = 0.42;
const GATE_PASS_T = 0.2;
const GATE_BLOCK_SOLID_T = 0.05;
const GATE_BLOCK_POP_T = 0.15;
/** A field that rises off the top of the screen (L8's red wall) keeps its badge in the visible playfield (D10.8). */
const GATE_BADGE_TOP_Y = 68;
/** The badge's centre stays this far above the field's bottom: its 14 px half-height over the bottom emitter's 14 px. */
const GATE_BADGE_FOOT = 28;
/** The both-outcome badge: a 76 x 28 paper over its ink shadow 3 px lower (VISUAL §4). */
export const GATE_BADGE_W = 76;
const GATE_BADGE_H = 28;
const GATE_BADGE_SHADOW = 3;
const SWITCH_CAP_UP = 14;
const SWITCH_CAP_DOWN = 6;
/** Drawn height above `surfaceY` of a raised plate (cap 14 + base 4 proud). */
const SWITCH_TOP = SWITCH_CAP_UP + 4;
/** A DECK plate is a thin strip lying on the planks (no metal base) so the bridge keeps its silhouette. */
const DECK_STRIP_UP = 8;
const DECK_STRIP_DOWN = 4;
const DECK_STRIP_R = 3;
const PLANK_SEAM = 26;
const WIRE_DROP = 46;
/** A wire's run never sinks below this many px above the frame bottom. */
const WIRE_FRAME_MARGIN = 10;
const STRIPE_PITCH = 10;
const BRICK_ROW = 40;

// ---- shared bits -------------------------------------------------------------------------------

function firstSwitchId(rect: LevelRect): string | undefined {
  return rect.switchIds !== undefined ? rect.switchIds[0] : rect.switchId;
}

/** Letter of a rect: the index of its first linked switch in level.switches ('A' when unlinked). */
export function rectLetter(level: Level, rect: LevelRect): string {
  const id = firstSwitchId(rect);
  const index = id === undefined ? -1 : level.switches.findIndex((s) => s.id === id);
  return switchLetter(Math.max(0, index));
}

export function isPermanentBlocker(rect: LevelRect): boolean {
  return rect.kind === 'blocker' && rect.switchId === undefined && rect.switchIds === undefined;
}

// ---- sand --------------------------------------------------------------------------------------

/** Sunken 16 px band following the surface polyline; replaces the grass cap there. */
export function drawSandBand(ctx: CanvasRenderingContext2D, x1: number, x2: number, surface: SurfaceFn): void {
  const top: Array<[number, number]> = [];
  for (let i = 0; i <= SAND_SAMPLES; i += 1) {
    const x = x1 + ((x2 - x1) * i) / SAND_SAMPLES;
    top.push([x, surface(x)]);
  }
  const path = (d0: number, d1: number): void => {
    ctx.beginPath();
    top.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1] + d0) : ctx.lineTo(p[0], p[1] + d0)));
    for (let i = top.length - 1; i >= 0; i -= 1) {
      const p = top[i];
      if (p !== undefined) ctx.lineTo(p[0], p[1] + d1);
    }
    ctx.closePath();
  };
  path(0, SAND_DEPTH);
  fillStroke(ctx, PALETTE.sand, OUTLINE_WIDTH);
  ctx.save();
  path(0, SAND_DEPTH);
  ctx.clip();
  path(10, SAND_DEPTH);
  ctx.fillStyle = PALETTE.sandSh;
  ctx.fill();
  ctx.beginPath();
  top.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1] + 4) : ctx.lineTo(p[0], p[1] + 4)));
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PALETTE.sandLine;
  ctx.stroke();
  ctx.fillStyle = PALETTE.sandSh;
  for (let x = x1 + 10, k = 0; x < x2 - 6; x += 12, k += 1) {
    circle(ctx, x, surface(x) + 8 + (k % 2 ? 3 : -1), 1.8);
    ctx.fill();
  }
  ctx.restore();
}

// ---- spring ------------------------------------------------------------------------------------

/** Ink slot cut into the dirt with the coil (static). */
export function drawSpringSlot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  roundRect(ctx, x - 20, y - 2, 40, 32, 6);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 24);
  for (let i = 0; i < 5; i += 1) ctx.lineTo(x + (i % 2 ? -12 : 12), y + 20 - i * 4.5);
  ctx.lineTo(x, y + 2);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = PALETTE.coil;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function springPlateHeight(t: number): number {
  if (t < SPRING_SQUASH_T) return 4;
  if (t < SPRING_OVERSHOOT_T) return 4 + (18 - 4) * ((t - SPRING_SQUASH_T) / (SPRING_OVERSHOOT_T - SPRING_SQUASH_T));
  if (t < SPRING_SETTLE_T) return 18 + (SPRING_PLATE_H - 18) * ((t - SPRING_OVERSHOOT_T) / (SPRING_SETTLE_T - SPRING_OVERSHOOT_T));
  return SPRING_PLATE_H;
}

function chevron(ctx: CanvasRenderingContext2D, x: number, cy: number, halfW: number, inkW: number, w: number, colour: string): void {
  ctx.beginPath();
  ctx.moveTo(x - halfW, cy + 6);
  ctx.lineTo(x, cy - 2);
  ctx.lineTo(x + halfW, cy + 6);
  ctx.lineWidth = inkW;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = colour;
  ctx.stroke();
}

/** Rotation that turns the plate's "up" into the launch direction (World 2-3 springs throw 10-26 degrees off vertical). */
export function chevronTilt(launch: { x: number; y: number }): number {
  return Math.atan2(launch.x, -launch.y);
}

/**
 * Plate (the pad's width x 14, 6 px proud, ink stripes) + two stacked white chevrons pointing along the
 * launch vector (D10.8); `t` = seconds since launch.
 */
function drawSpringPlate(ctx: CanvasRenderingContext2D, rect: SpringRect, t: number): void {
  const x = rect.x + rect.w / 2;
  const y = rect.y;
  const h = springPlateHeight(t);
  const top = y + 8 - h;
  const plateW = Math.max(SPRING_PLATE_MIN_W, rect.w);
  const half = plateW / 2;
  roundRect(ctx, x - half, top, plateW, h, 5);
  fillStroke(ctx, PALETTE.spring, OUTLINE_WIDTH);
  ctx.save();
  roundRect(ctx, x - half, top, plateW, h, 5);
  ctx.clip();
  ctx.fillStyle = INK;
  for (let sx = x - half - 36; sx < x + half; sx += 12) {
    ctx.beginPath();
    ctx.moveTo(sx, y + 8);
    ctx.lineTo(sx + 8, top);
    ctx.lineTo(sx + 14, top);
    ctx.lineTo(sx + 6, y + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = PALETTE.springSh;
  ctx.fillRect(x - half, y + 4, plateW, 4);
  ctx.restore();
  const flying = t < SPRING_SETTLE_T;
  const rise = flying ? 20 * (t / SPRING_SETTLE_T) : 0;
  ctx.save();
  ctx.globalAlpha = flying ? 1 - t / SPRING_SETTLE_T : 1;
  ctx.translate(x, y - 6);
  ctx.rotate(chevronTilt(rect.launch));
  for (const cy of [-10, -22]) chevron(ctx, 0, cy - rise, 9, 8, 3, PALETTE.white);
  ctx.restore();
}

// ---- bumper ------------------------------------------------------------------------------------

/** Socket ellipse embedded in the dirt (static). */
export function drawBumperSocket(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 27, 6, 0, 0, Math.PI * 2);
  fillStroke(ctx, PALETTE.dirtSh, OUTLINE_SMALL);
}

/** Half-dome r 22 centred on the surface line with the pinball ring and three spark ticks. */
function drawBumperDome(ctx: CanvasRenderingContext2D, rect: BumperRect, t: number): void {
  const x = rect.x + rect.w / 2;
  const y = rect.y;
  const dome = (): void => {
    ctx.beginPath();
    ctx.arc(x, y, BUMPER_R, Math.PI, 0);
    ctx.closePath();
  };
  dome();
  fillStroke(ctx, t < BUMPER_FLASH_T ? PALETTE.white : PALETTE.bump, OUTLINE_WIDTH);
  ctx.save();
  dome();
  ctx.clip();
  ctx.fillStyle = PALETTE.bumpSh;
  ctx.fillRect(x - BUMPER_R, y - 7, BUMPER_R * 2, 7);
  circle(ctx, x, y - 4, 10);
  ctx.lineWidth = 4;
  ctx.strokeStyle = PALETTE.white;
  ctx.stroke();
  circle(ctx, x, y - 4, 5.5);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  const pop = t < BUMPER_RING_T ? 6 * (1 - t / BUMPER_RING_T) : 0;
  for (const a of [-135, -90, -45]) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    inkLine(ctx, x + c * (27 + pop), y + s * (27 + pop), x + c * (35 + pop), y + s * (35 + pop), 3, PALETTE.white);
  }
  if (t < BUMPER_RING_T) {
    const k = t / BUMPER_RING_T;
    ctx.save();
    ctx.globalAlpha = 0.6 * (1 - k);
    circle(ctx, x, y - 4, 12 + 28 * k);
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.white;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- fan ---------------------------------------------------------------------------------------

/** Housing (sunk 8 px) with the ink propeller disc and grille bars (static). */
export function drawFanHousing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const half = FAN_HOUSING_W / 2;
  roundRect(ctx, x - half, y - 8, FAN_HOUSING_W, FAN_HOUSING_H, 8);
  fillStroke(ctx, PALETTE.fan, OUTLINE_WIDTH);
  bottomBand(ctx, x - half, y - 8, FAN_HOUSING_W, FAN_HOUSING_H, 14, 8, PALETTE.fanSh);
  circle(ctx, x, y + 7, 11);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x - 24, y - 2);
  ctx.lineTo(x - 15, y - 2);
  ctx.moveTo(x + 15, y - 2);
  ctx.lineTo(x + 24, y - 2);
  ctx.stroke();
}

/** Wind column with scrolling chevrons + spinning blades; `phase` in seconds (view clock + boost). */
function drawFanColumn(ctx: CanvasRenderingContext2D, rect: FanRect, phase: number, active: boolean): void {
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h;
  const top = rect.y;
  if (active) {
    roundRect(ctx, rect.x, top, rect.w, y - 8 - top, 14);
    ctx.fillStyle = PALETTE.wind;
    ctx.fill();
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PALETTE.windLine;
    ctx.stroke();
    ctx.setLineDash([]);
    const scroll = (phase * FAN_SCROLL_PX_PER_S) % FAN_CHEVRON_PITCH;
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.windLine;
    ctx.lineCap = 'round';
    for (let cy = y - 30 - scroll; cy > top + 16; cy -= FAN_CHEVRON_PITCH) {
      ctx.beginPath();
      ctx.moveTo(x - 11, cy + 8);
      ctx.lineTo(x, cy - 2);
      ctx.lineTo(x + 11, cy + 8);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = PALETTE.coil;
  ctx.lineWidth = 3;
  const spin = active ? phase * FAN_TURNS_PER_S * Math.PI * 2 : 0.5;
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2 + spin;
    ctx.beginPath();
    ctx.moveTo(x, y + 7);
    ctx.lineTo(x + Math.cos(a) * 9, y + 7 + Math.sin(a) * 9);
    ctx.stroke();
  }
  circle(ctx, x, y + 7, 2.5);
  ctx.fillStyle = PALETTE.coil;
  ctx.fill();
}

// ---- colour gate -------------------------------------------------------------------------------

function miniBall(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  circle(ctx, x, y, 7);
  fillStroke(ctx, colour, OUTLINE_DOT);
  ctx.beginPath();
  ctx.ellipse(x - 2.2, y - 2.5, 2.1, 1.4, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.whiteSoft;
  ctx.fill();
}

/** Centre y of a colour field's badge: mid-way down the field's visible part below `badgeTop`, clear of its bottom emitter. */
function gateBadgeY(rect: ColourGateRect, badgeTop: number): number {
  const bottom = rect.y + rect.h;
  const visibleTop = Math.max(rect.y, badgeTop);
  return Math.min(visibleTop + (bottom - visibleTop) / 2, bottom - GATE_BADGE_FOOT);
}

/** World box of a colour field's badge, paper and shadow: labels keep off it (D10.8). */
export function gateBadgeBox(rect: ColourGateRect, badgeTop: number): { x1: number; y1: number; x2: number; y2: number } {
  const x = rect.x + rect.w / 2;
  const by = gateBadgeY(rect, badgeTop);
  return { x1: x - GATE_BADGE_W / 2, y1: by - GATE_BADGE_H / 2, x2: x + GATE_BADGE_W / 2, y2: by + GATE_BADGE_H / 2 + GATE_BADGE_SHADOW };
}

/** Paper badge mid-field: [owner ball + mint check] [other ball + ink cross]. */
function drawGateBadge(ctx: CanvasRenderingContext2D, x: number, by: number, owner: 0 | 1, blockedPop: number): void {
  roundRect(ctx, x - GATE_BADGE_W / 2, by - GATE_BADGE_H / 2 + GATE_BADGE_SHADOW, GATE_BADGE_W, GATE_BADGE_H, 8);
  ctx.fillStyle = INK;
  ctx.fill();
  roundRect(ctx, x - GATE_BADGE_W / 2, by - GATE_BADGE_H / 2, GATE_BADGE_W, GATE_BADGE_H, 8);
  fillStroke(ctx, PALETTE.paper, OUTLINE_SMALL);
  miniBall(ctx, x - 24, by, PLAYER_VIEW[owner].col);
  ctx.beginPath();
  ctx.moveTo(x - 14, by);
  ctx.lineTo(x - 9, by + 5);
  ctx.lineTo(x - 2, by - 6);
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = PALETTE.mint;
  ctx.stroke();
  ctx.save();
  ctx.translate(x + 20, by);
  ctx.scale(blockedPop, blockedPop);
  miniBall(ctx, -10, 0, PLAYER_VIEW[owner === 0 ? 1 : 0].col);
  line(ctx, 1, -5, 11, 5, 3.5, INK);
  line(ctx, 11, -5, 1, 5, 3.5, INK);
  ctx.restore();
}

function gateFieldAlpha(gate: GateAnim | undefined): number {
  if (gate === undefined) return GATE_FIELD_ALPHA;
  if (gate.kind === 'block') return gate.t < GATE_BLOCK_SOLID_T ? 1 : GATE_FIELD_ALPHA;
  if (gate.t < GATE_PASS_T) return GATE_FIELD_ALPHA - (GATE_FIELD_ALPHA - 0.15) * Math.sin((gate.t / GATE_PASS_T) * Math.PI);
  return GATE_FIELD_ALPHA;
}

function gateBlockedPop(gate: GateAnim | undefined): number {
  if (gate === undefined || gate.kind !== 'block' || gate.t >= GATE_BLOCK_POP_T) return 1;
  return 1 + 0.6 * Math.sin((gate.t / GATE_BLOCK_POP_T) * Math.PI);
}

/**
 * Two emitters, a translucent field striped in its own colour, both-outcome badge centred in the field's
 * visible part below `badgeTop`.
 */
function drawColourGate(ctx: CanvasRenderingContext2D, rect: ColourGateRect, gate: GateAnim | undefined, badgeTop: number): void {
  const owner: 0 | 1 = rect.colour === 'red' ? 0 : 1;
  const col = PLAYER_VIEW[owner].col;
  const colSh = PLAYER_VIEW[owner].sh;
  const x = rect.x + rect.w / 2;
  const top = rect.y;
  const y = rect.y + rect.h;
  const halfW = Math.max(10, rect.w / 2);
  const scroll = gate !== undefined && gate.kind === 'pass' && gate.t < GATE_PASS_T ? gate.t * 180 : 0;
  ctx.save();
  roundRect(ctx, x - halfW, top + 6, halfW * 2, y - top - 12, 4);
  ctx.clip();
  ctx.fillStyle = col;
  ctx.globalAlpha = gateFieldAlpha(gate);
  ctx.fillRect(x - halfW, top, halfW * 2, y - top);
  ctx.globalAlpha = 1;
  // opaque stripes in the field's own colour: over the sky the translucent red fill alone reads switch-purple
  ctx.strokeStyle = col;
  ctx.lineWidth = 4;
  for (let sy = top - 10 - (scroll % 16); sy < y + 20; sy += 16) {
    ctx.beginPath();
    ctx.moveTo(x - halfW - 2, sy + halfW + 2);
    ctx.lineTo(x + halfW + 2, sy - halfW - 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - halfW, top + 8);
  ctx.lineTo(x - halfW, y - 8);
  ctx.moveTo(x + halfW, top + 8);
  ctx.lineTo(x + halfW, y - 8);
  ctx.stroke();
  for (const ey of [top - 6, y - 14]) {
    roundRect(ctx, x - 16, ey, 32, 20, 7);
    fillStroke(ctx, col, OUTLINE_WIDTH);
    bottomBand(ctx, x - 16, ey, 32, 20, 8, 7, colSh);
    roundRect(ctx, x - 6, ey + 5, 12, 6, 3);
    ctx.fillStyle = PALETTE.white;
    ctx.fill();
  }
  drawGateBadge(ctx, x, gateBadgeY(rect, badgeTop), owner, gateBlockedPop(gate));
}

// ---- bridge ------------------------------------------------------------------------------------

/** Metal posts with lamps on both lips; the letter tag sits on the left post. */
export function drawBridgePosts(ctx: CanvasRenderingContext2D, rect: BridgeRect, lit: boolean, letter?: string, lampsOnly = false): void {
  for (const px of [rect.x + 8, rect.x + rect.w - 8]) {
    if (!lampsOnly) post(ctx, px, rect.y - 24);
    lamp(ctx, px, rect.y - 28, lit);
  }
  if (!lampsOnly && letter !== undefined) letterTag(ctx, rect.x + 8, rect.y - 8, letter);
}

function drawPlankHalf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, leftRounded: boolean): void {
  if (w <= 0) return;
  const radii = leftRounded ? [4, 0, 0, 4] : [0, 4, 4, 0];
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radii);
  fillStroke(ctx, PALETTE.plank, OUTLINE_WIDTH);
  ctx.beginPath();
  ctx.roundRect(x, y + h - 6, w, 6, leftRounded ? [0, 0, 0, 4] : [0, 0, 4, 0]);
  ctx.fillStyle = PALETTE.plankSh;
  ctx.fill();
  ctx.fillStyle = INK;
  for (let px = Math.ceil((x + 4) / PLANK_SEAM) * PLANK_SEAM; px < x + w - 4; px += PLANK_SEAM) ctx.fillRect(px - 1.5, y, 3, h);
}

/** Planks slide in from both posts (`solidity` 0..1); fully out = dashed ghost in ink @ .45. */
function drawBridge(ctx: CanvasRenderingContext2D, rect: BridgeRect, active: boolean, solidity: number, opts: RectDrawOptions): void {
  const s = clamp01(solidity);
  if (s <= 0.01) {
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.inkGhost;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const half = (rect.w / 2) * easeOut(s);
    drawPlankHalf(ctx, rect.x, rect.y, half, rect.h, true);
    drawPlankHalf(ctx, rect.x + rect.w - half, rect.y, half, rect.h, false);
  }
  drawBridgePosts(ctx, rect, active, opts.letter, opts.parts === 'dynamic');
}

// ---- blocker: door / window gate and permanent stone wall ---------------------------------------

/** Permanent wall: grey stone blocks, right-hand shade, brick seams. */
export function drawStoneWall(ctx: CanvasRenderingContext2D, rect: BlockerRect): void {
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  fillStroke(ctx, PALETTE.plate, OUTLINE_WIDTH);
  ctx.beginPath();
  ctx.roundRect(rect.x + rect.w - 10, rect.y, 10, rect.h, [0, 6, 6, 0]);
  ctx.fillStyle = PALETTE.plateSh;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  let row = 0;
  for (let y = rect.y + BRICK_ROW; y < rect.y + rect.h - 8; y += BRICK_ROW, row += 1) {
    ctx.beginPath();
    ctx.moveTo(rect.x + 4, y);
    ctx.lineTo(rect.x + rect.w - 4, y);
    ctx.stroke();
    const sx = rect.x + (row % 2 === 0 ? rect.w * 0.35 : rect.w * 0.65);
    ctx.beginPath();
    ctx.moveTo(sx, y - BRICK_ROW + 6);
    ctx.lineTo(sx, y - 6);
    ctx.stroke();
  }
}

function drawGateStripes(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, h: number): void {
  if (h <= 0) return;
  roundRect(ctx, x, top, w, h, 4);
  fillStroke(ctx, PALETTE.sun, OUTLINE_WIDTH);
  ctx.save();
  roundRect(ctx, x, top, w, h, 4);
  ctx.clip();
  ctx.fillStyle = INK;
  for (let sy = top - w; sy < top + h + w; sy += STRIPE_PITCH * 2) {
    ctx.beginPath();
    ctx.moveTo(x, sy + w);
    ctx.lineTo(x + w, sy);
    ctx.lineTo(x + w, sy + STRIPE_PITCH);
    ctx.lineTo(x, sy + w + STRIPE_PITCH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = PALETTE.sunSh;
  ctx.fillRect(x + w - 6, top, 6, h);
  ctx.restore();
}

/** Switch-driven blocker: hazard stripes between two posts; retracts into the bottom post when held. */
function drawBlockerGate(ctx: CanvasRenderingContext2D, rect: BlockerRect, active: boolean, solidity: number, opts: RectDrawOptions): void {
  const s = clamp01(solidity);
  const cx = rect.x + rect.w / 2;
  const bottom = rect.y + rect.h;
  const barrierTop = rect.y + rect.h * (1 - easeOut(s));
  if (s <= 0.01) {
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.inkGhost;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    drawGateStripes(ctx, rect.x, barrierTop, rect.w, bottom - barrierTop);
  }
  post(ctx, cx, rect.y);
  post(ctx, cx, bottom - POST_H);
  const lit = !active;
  lamp(ctx, cx, rect.y + 13, lit);
  lamp(ctx, cx, bottom - 13, lit);
  if (opts.letter !== undefined) letterTag(ctx, cx, rect.y - 10, opts.letter);
}

// ---- switch ------------------------------------------------------------------------------------

/** How far above `surfaceY` a plate reaches when raised (its label sits above that). */
export function switchTop(sw: PressureSwitch): number {
  return sw.onRectId === undefined ? SWITCH_TOP : DECK_STRIP_UP;
}

/** Metal base (press-zone wide, min 64) x14, 4 px proud; letter tag at the left end, unlit lamp at the right (static). */
export function drawSwitchBase(ctx: CanvasRenderingContext2D, sw: PressureSwitch, letter: string): void {
  const { cx, baseW, tagX, lampX } = switchGeometry(sw);
  const y = sw.surfaceY;
  roundRect(ctx, cx - baseW / 2, y - 4, baseW, 14, 6);
  fillStroke(ctx, PALETTE.plate, OUTLINE_WIDTH);
  bottomBand(ctx, cx - baseW / 2, y - 4, baseW, 14, 8, 6, PALETTE.plateSh);
  letterTag(ctx, tagX, y + 3, letter);
  lamp(ctx, lampX, y + 3, false);
}

/** DECK plate: a purple strip (8 px up, 4 pressed) on the planks' top with the tag and lamp at its ends. */
function drawDeckStrip(ctx: CanvasRenderingContext2D, sw: PressureSwitch, pressed01: number, letter: string): void {
  const { cx, baseW, tagX, lampX } = switchGeometry(sw);
  const y = sw.surfaceY;
  const k = clamp01(pressed01);
  const h = DECK_STRIP_UP - (DECK_STRIP_UP - DECK_STRIP_DOWN) * k;
  roundRect(ctx, cx - baseW / 2, y - h, baseW, h + 2, DECK_STRIP_R);
  fillStroke(ctx, PALETTE.sw, OUTLINE_SMALL);
  bottomBand(ctx, cx - baseW / 2, y - h, baseW, h + 2, 3, DECK_STRIP_R, PALETTE.swSh);
  letterTag(ctx, tagX, y - DECK_STRIP_DOWN, letter);
  lamp(ctx, lampX, y - DECK_STRIP_DOWN, k > 0.5);
}

/** Purple cap (14 px up, 6 px pressed) with its shade skirt, lamp + halo while pressed, squish lines. */
function drawSwitchCap(ctx: CanvasRenderingContext2D, sw: PressureSwitch, pressed01: number): void {
  const { cx, baseW, capW, lampX } = switchGeometry(sw);
  const y = sw.surfaceY;
  const k = clamp01(pressed01);
  const capH = SWITCH_CAP_UP - (SWITCH_CAP_UP - SWITCH_CAP_DOWN) * k;
  const top = y - 4 - capH;
  const h = capH + 6;
  roundRect(ctx, cx - capW / 2, top, capW, h, 6);
  fillStroke(ctx, PALETTE.sw, OUTLINE_WIDTH);
  bottomBand(ctx, cx - capW / 2, top, capW, h, Math.min(8, h - 2), 6, PALETTE.swSh);
  lamp(ctx, lampX, y + 3, k > 0.5);
  if (k > 0.5 && k < 1) {
    const half = baseW / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + d * half, y - 14);
      ctx.lineTo(cx + d * (half + 5), y - 20);
      ctx.moveTo(cx + d * (half + 2), y - 7);
      ctx.lineTo(cx + d * (half + 9), y - 9);
      ctx.stroke();
    }
  }
}

/** Whole plate, or only the cap when the cached layer holds the base. A DECK plate ignores `parts` (it is never cached). */
export function drawSwitch(ctx: CanvasRenderingContext2D, sw: PressureSwitch, pressed01: number, letter: string, parts: 'all' | 'dynamic' = 'all'): void {
  if (sw.onRectId !== undefined) {
    drawDeckStrip(ctx, sw, pressed01, letter);
    return;
  }
  if (parts === 'all') drawSwitchBase(ctx, sw, letter);
  drawSwitchCap(ctx, sw, pressed01);
}

// ---- wire --------------------------------------------------------------------------------------

/** Where the wires of a switch-linked rect end: post lamps, a trap's hinges on its real floor, a cannon's fuse lamp. */
export function wirePosts(level: Level, rect: LevelRect): readonly WirePost[] {
  switch (rect.kind) {
    case 'bridge':
      return [
        { x: rect.x + 8, lampY: rect.y - 28 },
        { x: rect.x + rect.w - 8, lampY: rect.y - 28 },
      ];
    case 'blocker':
      return [{ x: rect.x + rect.w / 2, lampY: rect.y + rect.h - 13 }];
    case 'fan':
      return [{ x: rect.x + rect.w / 2, lampY: rect.y + rect.h + 7 }];
    case 'trap':
      return trapGeometry(level, rect).posts;
    case 'cannon':
      return cannonGeometry(rect).posts;
    case 'sand':
    case 'spring':
    case 'bumper':
    case 'colourGate':
      return [];
  }
}

/**
 * Depth of the horizontal wire run: 46 px under the LOWEST fairway point between the two ends (always in the
 * dirt). Gaps are skipped, so a wire to a plate across a chasm hangs over the pit inside the frame.
 */
function wireDepth(fromX: number, fromY: number, toX: number, surface: WireSurface | undefined): number {
  let lowest = fromY;
  if (surface !== undefined) {
    const lo = Math.min(fromX, toX);
    const hi = Math.max(fromX, toX);
    const consider = (x: number): void => {
      const y = surface(x);
      if (y !== null) lowest = Math.max(lowest, y);
    };
    for (let x = lo; x <= hi; x += 25) consider(x);
    consider(hi);
  }
  return Math.min(lowest + WIRE_DROP, VIEWPORT_H - WIRE_FRAME_MARGIN);
}

/** Dotted wire from the switch lamp down into the dirt, along it, then up to the nearest of `posts`. */
export function drawWire(ctx: CanvasRenderingContext2D, sw: PressureSwitch, posts: readonly WirePost[], lit: boolean, surface?: WireSurface): void {
  const first = posts[0];
  if (first === undefined) return;
  const fromX = switchGeometry(sw).lampX;
  const fromY = sw.surfaceY + 3;
  const target = posts.reduce((best, p) => (Math.abs(p.x - fromX) < Math.abs(best.x - fromX) ? p : best), first);
  const depth = wireDepth(fromX, fromY, target.x, surface);
  ctx.setLineDash([2, 7]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = lit ? PALETTE.sw : PALETTE.plateSh;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(fromX, depth);
  ctx.lineTo(target.x, depth);
  ctx.lineTo(target.x, target.lampY);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---- dispatch ----------------------------------------------------------------------------------

/**
 * Draws one mechanic. `anim`: bridge/blocker = solidity 0..1; trap = set 0..1 (1 armed); spring/bumper/
 * cannon = seconds since triggered / fired; fan = clock phase in seconds. `active` is the sim's rect
 * activity (a trap: armed; a cannon: lit). Inactive bridge/blocker = dashed ghost; permanent blocker
 * = stone wall. Without its level a trap stands on a flat floor at its zone's bottom (the renderer uses the
 * level's terrain, devices.ts). `switchColour` is accepted for the ARCH signature (World 1 switches are all `sw`).
 */
export function drawRect(
  ctx: CanvasRenderingContext2D,
  rect: LevelRect,
  active: boolean,
  anim: number,
  switchColour?: string,
  opts: RectDrawOptions = {},
): void {
  void switchColour;
  const all = opts.parts !== 'dynamic';
  const flat: SurfaceFn = () => rect.y;
  switch (rect.kind) {
    case 'sand':
      if (all) drawSandBand(ctx, rect.x, rect.x + rect.w, flat);
      break;
    case 'spring':
      if (all) drawSpringSlot(ctx, rect.x + rect.w / 2, rect.y);
      drawSpringPlate(ctx, rect, anim);
      break;
    case 'bumper':
      if (all) drawBumperSocket(ctx, rect.x + rect.w / 2, rect.y);
      drawBumperDome(ctx, rect, anim);
      break;
    case 'fan':
      if (all) drawFanHousing(ctx, rect.x + rect.w / 2, rect.y + rect.h);
      drawFanColumn(ctx, rect, anim, active);
      break;
    case 'colourGate':
      drawColourGate(ctx, rect, opts.gate, opts.badgeTop ?? GATE_BADGE_TOP_Y);
      break;
    case 'bridge':
      drawBridge(ctx, rect, active, anim, opts);
      break;
    case 'blocker':
      if (isPermanentBlocker(rect)) {
        if (all) drawStoneWall(ctx, rect);
      } else drawBlockerGate(ctx, rect, active, anim, opts);
      break;
    case 'trap': {
      const g = flatTrapGeometry(rect);
      if (all) drawTrapBase(ctx, g);
      drawTrapJaws(ctx, g, anim);
      break;
    }
    case 'cannon': {
      const g = cannonGeometry(rect);
      if (all) drawCannonCradle(ctx, g);
      drawCannonBarrel(ctx, g, active, recoilOf(anim));
      break;
    }
  }
}
