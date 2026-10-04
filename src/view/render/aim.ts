// OWNER: view
/**
 * Aim arc, landing marker, drag rubber band, protractor guide and the turn marker (ARCH.md §1.9,
 * VISUAL.md §10). Dots stop at the landing marker (plus 12 faded roll dots past it); drawn in
 * PLAYER_COLOURS[preview.playerId], globalAlpha 0.55 when preview.remote. The power bar lives in the
 * React HUD. Everything here except `drawDragOverlay` is drawn in WORLD space; marker/dot sizes divide
 * by `zoom` so they keep their screen size in overview.
 */
import type { Aim, PlayerId, Vec } from '../../sim/types';
import { BALL_RADIUS, DRAG_DEAD_ZONE_PX } from '../../sim/types';
import type { AimPreview, DragVisual, InputDevice, ViewState } from '../view';
import { missRingsProgress } from '../view';
import { circle, fillStroke, INK, inkLine, OUTLINE_DOT, OUTLINE_SMALL, OUTLINE_WIDTH, PALETTE, PLAYER_VIEW } from './palette';
import { COPY, drawSticker } from './text';

const MISS_RING_COUNT = 3;
const MISS_RING_R_START = BALL_RADIUS + 4;
const MISS_RING_R_END = 64;
const MISS_RING_STAGGER = 0.18;
const MISS_RING_ALPHA = 0.7;

const DOT_EVERY = 3;
const DOT_MAX = 40;
const DOT_R_START = 5;
const DOT_R_MIN = 2.5;
const DOT_R_STEP = 0.18;
const ROLL_DOTS = 12;
const ROLL_DOT_ALPHA = 0.35;
const REMOTE_ALPHA = 0.55;
const LANDING_ARM = 11;
const RING_R = 12;
/** CANCEL / AIM UPWARD: 12 px paper sticker 32 px above the ball (VISUAL.md §10). */
const DRAG_WORD_PX = 12;
const DRAG_WORD_ABOVE = 32;
const PROTRACTOR_R = 56;
const TURN_MARKER_H = 16;
const TURN_MARKER_HALF_W = 12;
const TURN_MARKER_ABOVE_FEET = 122;
const TURN_MARKER_BOB_PX = 4;
const TURN_MARKER_BOB_RATE = 6;

/**
 * Tick of the first ground contact. `predictShot` records the landing as the position of that tick
 * (2 dp exact), so the first point with the same coordinates is it; without a landing every point is
 * flight.
 */
function landingIndexOf(points: readonly Vec[], landing: Vec | null): number {
  if (landing === null) return points.length;
  const i = points.findIndex((p) => p.x === landing.x && p.y === landing.y);
  return i >= 0 ? i : points.length;
}

/** The preview points that get a dot: every 3rd flight tick up to the landing (max 40), then 12 faded roll dots. */
export function aimDotPoints(preview: Pick<AimPreview, 'points' | 'landing'>): { flight: Vec[]; roll: Vec[] } {
  const { points } = preview;
  const landingIndex = landingIndexOf(points, preview.landing);
  const flight: Vec[] = [];
  for (let i = DOT_EVERY - 1; i < landingIndex && flight.length < DOT_MAX; i += DOT_EVERY) {
    const p = points[i];
    if (p !== undefined) flight.push(p);
  }
  const roll: Vec[] = [];
  for (let i = landingIndex + DOT_EVERY - 1; i < points.length && roll.length < ROLL_DOTS; i += DOT_EVERY) {
    const p = points[i];
    if (p !== undefined) roll.push(p);
  }
  return { flight, roll };
}

function drawDots(ctx: CanvasRenderingContext2D, preview: AimPreview, col: string, inv: number): void {
  const { flight, roll } = aimDotPoints(preview);
  flight.forEach((p, i) => {
    circle(ctx, p.x, p.y, Math.max(DOT_R_MIN, DOT_R_START - i * DOT_R_STEP) * inv);
    fillStroke(ctx, col, OUTLINE_DOT * inv);
  });
  ctx.save();
  ctx.globalAlpha *= ROLL_DOT_ALPHA;
  for (const p of roll) {
    circle(ctx, p.x, p.y, DOT_R_MIN * inv);
    fillStroke(ctx, col, OUTLINE_DOT * inv);
  }
  ctx.restore();
}

/** Landing X: two 22 px strokes in the player colour over ink, centred on the contact point. */
function drawLandingMarker(ctx: CanvasRenderingContext2D, landing: Vec, col: string, inv: number): void {
  const lx = landing.x;
  const ly = landing.y + BALL_RADIUS;
  const a = LANDING_ARM * inv;
  inkLine(ctx, lx - a, ly - a, lx + a, ly + a, 3.5 * inv, col);
  inkLine(ctx, lx + a, ly - a, lx - a, ly + a, 3.5 * inv, col);
}

/** Faint 180 degree arc r 56 with a tick at the current angle (keyboard / gamepad only, UX §5.4). */
function drawProtractor(ctx: CanvasRenderingContext2D, ball: Vec, aim: Aim, inv: number): void {
  const r = PROTRACTOR_R * inv;
  ctx.save();
  ctx.globalAlpha *= 0.2;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r, Math.PI, 0);
  ctx.lineWidth = 3 * inv;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  const tx = ball.x + Math.cos(aim.angle) * r;
  const ty = ball.y + Math.sin(aim.angle) * r;
  inkLine(ctx, ball.x + Math.cos(aim.angle) * (r - 8 * inv), ball.y + Math.sin(aim.angle) * (r - 8 * inv), tx, ty, 3 * inv, PALETTE.white);
}

/** Dashed ink rubber band from the ball to the pointer (world space; the ring and words are screen space). */
function drawRubberBand(ctx: CanvasRenderingContext2D, ball: Vec, drag: DragVisual, inv: number): void {
  const dx = drag.pointer.x - ball.x;
  const dy = drag.pointer.y - ball.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len * (1 / inv) < DRAG_DEAD_ZONE_PX) return;
  ctx.setLineDash([6 * inv, 6 * inv]);
  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y);
  ctx.lineTo(drag.pointer.x, drag.pointer.y);
  ctx.lineWidth = OUTLINE_WIDTH * inv;
  ctx.strokeStyle = drag.cancel ? PALETTE.p1Sh : drag.clamped ? PALETTE.bump : INK;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Drag ring at the pointer (with the cancel cross) and the CANCEL / AIM UPWARD sticker 32 px above the
 * ball, in SCREEN space after the transform reset (VISUAL.md §3): every size is multiplied by
 * `labelScale` so the touch cancel feedback stays readable on phones. `words` false skips the sticker
 * until the display font is ready.
 */
export function drawDragOverlay(ctx: CanvasRenderingContext2D, ball: Vec, pointer: Vec, drag: DragVisual, labelScale: number, words: boolean): void {
  circle(ctx, pointer.x, pointer.y, RING_R * labelScale);
  fillStroke(ctx, PALETTE.whiteSoft, 3 * labelScale);
  if (drag.cancel) {
    const a = 5 * labelScale;
    ctx.lineWidth = 2 * labelScale;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pointer.x - a, pointer.y - a);
    ctx.lineTo(pointer.x + a, pointer.y + a);
    ctx.moveTo(pointer.x + a, pointer.y - a);
    ctx.lineTo(pointer.x - a, pointer.y + a);
    ctx.stroke();
  }
  const word = drag.cancel ? COPY.stickers.cancel : drag.clamped ? COPY.stickers.aimUp : null;
  if (word !== null && words) {
    drawSticker(ctx, ball.x, ball.y - DRAG_WORD_ABOVE * labelScale, word, { accent: '', sizePx: DRAG_WORD_PX * labelScale, rotationDeg: 0 });
  }
}

/**
 * Dots stop at the landing marker; player colour; 55 % alpha when remote. `ready` false (turn delay)
 * hides the arc and shows only the rubber band / protractor. `zoom` = camera zoom (sizes are divided by it).
 */
export function drawAim(
  ctx: CanvasRenderingContext2D,
  ball: Vec,
  aim: Aim,
  preview: AimPreview,
  device: InputDevice,
  ready: boolean,
  drag: DragVisual | null = null,
  zoom: number = 1,
): void {
  const inv = 1 / Math.max(0.05, zoom);
  const col = PLAYER_VIEW[preview.playerId].col;
  ctx.save();
  ctx.globalAlpha = preview.remote ? REMOTE_ALPHA : 1;
  if (!preview.remote && (device === 'keyboard' || device === 'gamepad')) drawProtractor(ctx, ball, aim, inv);
  if (drag !== null && !preview.remote) drawRubberBand(ctx, ball, drag, inv);
  if (ready && !(drag?.cancel ?? false)) {
    drawDots(ctx, preview, col, inv);
    if (preview.landing !== null) drawLandingMarker(ctx, preview.landing, col, inv);
  }
  ctx.restore();
}

/**
 * Miss feedback (UX.md §5.2): three ink rings expand from the active ball over 0.6 s, staggered and
 * fading; sizes keep screen scale in overview. Draws nothing once the pulse has ended.
 */
export function drawMissRings(ctx: CanvasRenderingContext2D, view: ViewState): void {
  const t = missRingsProgress(view);
  const rings = view.missRings;
  if (t === null || rings === null) return;
  const inv = 1 / Math.max(0.05, view.camera.zoom);
  ctx.save();
  ctx.lineWidth = OUTLINE_SMALL * inv;
  ctx.strokeStyle = INK;
  for (let i = 0; i < MISS_RING_COUNT; i += 1) {
    const k = Math.min(1, Math.max(0, (t - i * MISS_RING_STAGGER) / (1 - (MISS_RING_COUNT - 1) * MISS_RING_STAGGER)));
    if (k <= 0 || k >= 1) continue;
    ctx.globalAlpha = MISS_RING_ALPHA * (1 - k);
    circle(ctx, rings.pos.x, rings.pos.y, (MISS_RING_R_START + (MISS_RING_R_END - MISS_RING_R_START) * k) * inv);
    ctx.stroke();
  }
  ctx.restore();
}

/** 24x16 player-colour triangle pointing down, apex 122 px above the feet, bobbing +-4 px at 6 rad/s. */
export function drawTurnMarker(ctx: CanvasRenderingContext2D, feet: Vec, playerId: PlayerId, timeSec: number, zoom: number = 1): void {
  const inv = 1 / Math.max(0.05, zoom);
  const { col, sh } = PLAYER_VIEW[playerId];
  const y = feet.y - TURN_MARKER_ABOVE_FEET * inv + Math.sin(timeSec * TURN_MARKER_BOB_RATE) * TURN_MARKER_BOB_PX * inv;
  const h = TURN_MARKER_H * inv;
  const w = TURN_MARKER_HALF_W * inv;
  ctx.beginPath();
  ctx.moveTo(feet.x - w, y - h);
  ctx.lineTo(feet.x + w, y - h);
  ctx.lineTo(feet.x, y);
  ctx.closePath();
  fillStroke(ctx, col, OUTLINE_WIDTH * inv);
  ctx.beginPath();
  ctx.moveTo(feet.x + w * 0.2, y - h + 2 * inv);
  ctx.lineTo(feet.x + w - 2 * inv, y - h + 2 * inv);
  ctx.lineTo(feet.x + 1 * inv, y - 3 * inv);
  ctx.closePath();
  ctx.fillStyle = sh;
  ctx.fill();
}
