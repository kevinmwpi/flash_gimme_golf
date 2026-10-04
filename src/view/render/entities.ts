// OWNER: view
/**
 * Balls, golfers, trails (ARCH.md §1.9, VISUAL.md §6-§7). The golfer is a 98 px chibi drawn bottom-up
 * with 4 px ink (3 px small parts); poses (idle / aim / swing / walk / hop / cheer / sad / watch) and
 * faces (smile / focus / wow / grin / sad) come from the GolferAnim timers that view.ts advances.
 */
import type { PlayerId, Vec } from '../../sim/types';
import { BALL_RADIUS } from '../../sim/types';
import { SWING_DURATION, type GolferAnim, type GolferFace, type RenderBall } from '../view';
import { circle, fillStroke, INK, line, OUTLINE_DOT, OUTLINE_SMALL, OUTLINE_WIDTH, PALETTE, PLAYER_VIEW, roundRect } from './palette';

const SWING_CONTACT_T = 0.09;
const SWING_FOLLOW_T = 0.22;
const WOW_FACE_UNTIL = 0.24;
const CHEER_DURATION = 0.8;
const SAD_DURATION = 0.6;
const BLINK_DURATION = 0.08;
const FIDGET_DURATION = 0.6;
const WATCH_FAR_PX = 500;
const HEAD_R = 19;
const HEAD_Y = -76;
const TRAIL_MAX_R = 10;
const TRAIL_MIN_R = 4;

// ---- ball ---------------------------------------------------------------------------------------

/** Contact shadow under a ball: 0.9 r x 0.32 r, fading as the ball rises. */
export function drawBallShadow(ctx: CanvasRenderingContext2D, x: number, groundY: number, height: number, r: number = BALL_RADIUS): void {
  const alpha = Math.max(0.15, 1 - height / 320);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.shadow;
  ctx.fill();
  ctx.restore();
}

export function drawBall(ctx: CanvasRenderingContext2D, playerId: PlayerId, ball: RenderBall): void {
  if (!ball.visible) return;
  const r = BALL_RADIUS;
  const { col } = PLAYER_VIEW[playerId];
  const scale = ball.scale * (1 - ball.sinkT);
  if (scale <= 0.01) return;
  ctx.save();
  ctx.translate(ball.pos.x, ball.pos.y);
  ctx.scale(scale, scale);
  ctx.rotate(ball.squashAngle);
  ctx.scale(ball.squash, 1 / ball.squash);
  ctx.rotate(-ball.squashAngle);
  circle(ctx, 0, 0, r);
  fillStroke(ctx, col, OUTLINE_WIDTH);
  const a = -2.3 + ball.roll;
  ctx.beginPath();
  ctx.ellipse(Math.cos(a) * 0.48 * r, Math.sin(a) * 0.48 * r, 0.3 * r, 0.2 * r, a + Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.whiteSoft;
  ctx.fill();
  ctx.restore();
}

/** 6 ghost discs, oldest first: r 10 -> 4, alpha .35 -> .05 (VISUAL.md §7). */
export function drawTrail(ctx: CanvasRenderingContext2D, playerId: PlayerId, trail: readonly Vec[], colour?: string): void {
  const n = trail.length;
  if (n === 0) return;
  const fill = colour ?? PLAYER_VIEW[playerId].col;
  ctx.save();
  trail.forEach((p, i) => {
    const k = n === 1 ? 1 : i / (n - 1);
    ctx.globalAlpha = 0.05 + 0.3 * k;
    circle(ctx, p.x, p.y, TRAIL_MIN_R + (TRAIL_MAX_R - TRAIL_MIN_R) * k);
    ctx.fillStyle = fill;
    ctx.fill();
  });
  ctx.restore();
}

// ---- golfer -------------------------------------------------------------------------------------

/**
 * Pose in facing-local coordinates (x forward, feet at 0). `armsUp` hides the club; `hand2` raises the
 * back arm (from the back shoulder) to that point.
 */
type Pose = { hand: Vec; club: Vec; lean: number; armsUp: boolean; hand2?: Vec };

const SHOULDER: Vec = { x: 12, y: -52 };
const BACK_SHOULDER: Vec = { x: -12, y: -52 };
const IDLE: Pose = { hand: { x: 18, y: -30 }, club: { x: 30, y: -1 }, lean: 0, armsUp: false };
const AIM_FULL: Pose = { hand: { x: -18, y: -66 }, club: { x: -34, y: -114 }, lean: 0, armsUp: false };
const CONTACT_LEAN = 8;
const CONTACT: Pose = { ...IDLE, lean: CONTACT_LEAN };
const FOLLOW: Pose = { hand: { x: 26, y: -34 }, club: { x: 44, y: -72 }, lean: 0, armsUp: false };
/** Arms splayed into a V so both pass beside the head and the grin stays visible. */
const CHEER: Pose = { hand: { x: 42, y: -98 }, hand2: { x: -42, y: -98 }, club: { x: 24, y: -126 }, lean: 0, armsUp: true };
const SAD: Pose = { hand: { x: 10, y: -20 }, club: { x: 22, y: -2 }, lean: 0, armsUp: false };
/** Scratch-head fidget: the BACK hand rubs the back of the cap, clear of the eyes and mouth. */
const SCRATCH_HAND: Vec = { x: -20, y: -98 };
/** Shading the eyes: the hand sits at the front of the brim; the arm is drawn behind the head. */
const WATCH_HAND: Vec = { x: 26, y: -90 };

function mix(a: Pose, b: Pose, k: number): Pose {
  return {
    hand: { x: a.hand.x + (b.hand.x - a.hand.x) * k, y: a.hand.y + (b.hand.y - a.hand.y) * k },
    club: { x: a.club.x + (b.club.x - a.club.x) * k, y: a.club.y + (b.club.y - a.club.y) * k },
    lean: a.lean + (b.lean - a.lean) * k,
    armsUp: k > 0.5 ? b.armsUp : a.armsUp,
  };
}

/** Point k of the way from `from` to `to` around `origin`, sweeping down and BACK (through 90 and 180 degrees). */
function arcPoint(origin: Vec, from: Vec, to: Vec, k: number): Vec {
  const a0 = Math.atan2(from.y - origin.y, from.x - origin.x);
  let a1 = Math.atan2(to.y - origin.y, to.x - origin.x);
  while (a1 < a0) a1 += Math.PI * 2;
  const r0 = Math.hypot(from.x - origin.x, from.y - origin.y);
  const r1 = Math.hypot(to.x - origin.x, to.y - origin.y);
  const a = a0 + (a1 - a0) * k;
  const r = r0 + (r1 - r0) * k;
  return { x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r };
}

/**
 * Backswing from IDLE (k 0) to AIM_FULL (k 1) along an arc: the hand swings around the shoulder and the
 * club turns around the hand, so the club travels low and behind the body and never crosses the face
 * (a straight-line mix put the club head on the mouth at the default power 55). The club head never
 * dips below the turf.
 */
function backswing(k: number): Pose {
  const hand = arcPoint(SHOULDER, IDLE.hand, AIM_FULL.hand, k);
  const shaft = arcPoint(
    { x: 0, y: 0 },
    { x: IDLE.club.x - IDLE.hand.x, y: IDLE.club.y - IDLE.hand.y },
    { x: AIM_FULL.club.x - AIM_FULL.hand.x, y: AIM_FULL.club.y - AIM_FULL.hand.y },
    k,
  );
  const club = { x: hand.x + shaft.x, y: Math.min(IDLE.club.y, hand.y + shaft.y) };
  return { hand, club, lean: 0, armsUp: false };
}

function poseOf(anim: GolferAnim): Pose {
  if (anim.cheerT < CHEER_DURATION) return CHEER;
  if (anim.sadT < SAD_DURATION) return SAD;
  const t = anim.swingT;
  if (t < SWING_DURATION) {
    if (t < SWING_CONTACT_T) {
      const k = t / SWING_CONTACT_T;
      return { ...backswing(1 - k), lean: CONTACT_LEAN * k };
    }
    if (t < SWING_FOLLOW_T) return mix(CONTACT, FOLLOW, (t - SWING_CONTACT_T) / (SWING_FOLLOW_T - SWING_CONTACT_T));
    return mix(FOLLOW, IDLE, (t - SWING_FOLLOW_T) / (SWING_DURATION - SWING_FOLLOW_T));
  }
  if (anim.aiming) return backswing(anim.power);
  return IDLE;
}

function faceOf(anim: GolferAnim): GolferFace {
  if (anim.cheerT < CHEER_DURATION) return 'grin';
  if (anim.sadT < SAD_DURATION) return 'sad';
  if (anim.swingT < WOW_FACE_UNTIL) return 'wow';
  if (anim.aiming) return 'focus';
  return 'smile';
}

function drawLegs(ctx: CanvasRenderingContext2D, x: number, gy: number, walking: boolean, phase: number): void {
  const legs: Array<[number, number]> = [
    [x - 9, walking ? 1.2 - 0.4 * phase : 1],
    [x + 3, walking ? 0.8 + 0.4 * phase : 1],
  ];
  for (const [lx, sy] of legs) {
    roundRect(ctx, lx, gy - 2 - 18 * sy, 10, 18 * sy, 4);
    fillStroke(ctx, PALETTE.skin, OUTLINE_SMALL);
  }
  for (const sx of [x - 11, x + 1]) {
    roundRect(ctx, sx, gy - 8, 16, 9, 4);
    fillStroke(ctx, PALETTE.white, OUTLINE_SMALL);
  }
}

function drawTorso(ctx: CanvasRenderingContext2D, x: number, gy: number, f: 1 | -1, col: string, sh: string): void {
  roundRect(ctx, x - 16, gy - 32, 32, 16, 6);
  fillStroke(ctx, PALETTE.shorts, OUTLINE_WIDTH);
  ctx.beginPath();
  ctx.roundRect(x - 16, gy - 24, 32, 8, [0, 0, 6, 6]);
  ctx.fillStyle = PALETTE.shortsSh;
  ctx.fill();
  roundRect(ctx, x - 19, gy - 58, 38, 30, 10);
  fillStroke(ctx, col, OUTLINE_WIDTH);
  ctx.beginPath();
  ctx.roundRect(x - 19 + (f > 0 ? 28 : 0), gy - 58, 10, 30, f > 0 ? [0, 10, 10, 0] : [10, 0, 0, 10]);
  ctx.fillStyle = sh;
  ctx.fill();
  roundRect(ctx, x - 8, gy - 60, 16, 8, 3);
  fillStroke(ctx, PALETTE.white, OUTLINE_SMALL);
}

function drawEyes(ctx: CanvasRenderingContext2D, x: number, hy: number, f: 1 | -1, dx: number, r: number, blink: boolean): void {
  for (const ex of [5, 13]) {
    const cx = x + f * ex + dx;
    if (blink) line(ctx, cx - 2.5, hy + 3, cx + 2.5, hy + 3, 2.5, INK);
    else {
      circle(ctx, cx, hy + 3, r);
      ctx.fillStyle = INK;
      ctx.fill();
    }
  }
}

function smileArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawFace(ctx: CanvasRenderingContext2D, x: number, hy: number, f: 1 | -1, face: GolferFace, power: number, eyeDx: number, blink: boolean): void {
  ctx.fillStyle = INK;
  switch (face) {
    case 'focus':
      circle(ctx, x + f * 5 + eyeDx, hy + 3, 2.8);
      ctx.fill();
      line(ctx, x + f * 10, hy + 3, x + f * 16, hy + 3, 3, INK);
      line(ctx, x + f * 9, hy - 4, x + f * 17, hy - 6, 2.5, INK);
      smileArc(ctx, x + f * 9, hy + 8, 4);
      if (power > 0.6) {
        roundRect(ctx, x + f * 10 - 4, hy + 9, 8, 9, 4);
        fillStroke(ctx, PALETTE.tongue, OUTLINE_DOT);
      }
      break;
    case 'wow':
      drawEyes(ctx, x, hy - 1, f, eyeDx, 3.2, false);
      circle(ctx, x + f * 9, hy + 9, 4);
      ctx.fillStyle = INK;
      ctx.fill();
      break;
    case 'grin':
      drawEyes(ctx, x, hy, f, eyeDx, 2.8, blink);
      ctx.beginPath();
      ctx.arc(x + f * 9, hy + 7, 6, 0, Math.PI);
      ctx.closePath();
      fillStroke(ctx, PALETTE.white, OUTLINE_DOT);
      break;
    case 'sad':
      drawEyes(ctx, x, hy, f, eyeDx, 2.8, false);
      ctx.beginPath();
      ctx.arc(x + f * 9, hy + 12, 4.5, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + f * 15, hy + 9, 2, 3, 0, 0, Math.PI * 2);
      fillStroke(ctx, PALETTE.p2, 1.5);
      break;
    case 'smile':
      drawEyes(ctx, x, hy, f, eyeDx, 2.8, blink);
      smileArc(ctx, x + f * 9, hy + 8, 4.5);
      break;
  }
  circle(ctx, x - f * 6, hy + 8, 4);
  ctx.fillStyle = PALETTE.cheek;
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, x: number, hy: number, f: 1 | -1, col: string, sh: string, capPop: number): void {
  circle(ctx, x, hy, HEAD_R);
  fillStroke(ctx, PALETTE.skin, OUTLINE_WIDTH);
  const cy = hy - 2 - capPop;
  ctx.beginPath();
  ctx.arc(x, cy, HEAD_R, Math.PI, 0);
  ctx.closePath();
  fillStroke(ctx, col, OUTLINE_WIDTH);
  roundRect(ctx, x + (f > 0 ? 6 : -32), cy - 6, 26, 9, 4);
  fillStroke(ctx, col, OUTLINE_SMALL);
  capShade(ctx, x, cy, f > 0 ? x + 8 : x - 20, sh);
  circle(ctx, x, cy - HEAD_R + 1, 4.5);
  fillStroke(ctx, col, OUTLINE_SMALL);
}

/** 12 px vertical shade strip intersected with the upper half-disc of the cap (no clip). */
function capShade(ctx: CanvasRenderingContext2D, x: number, cy: number, stripX: number, colour: string): void {
  const inner = HEAD_R - 1;
  const x0 = Math.max(x - inner, stripX);
  const x1 = Math.min(x + inner, stripX + 12);
  if (x1 <= x0) return;
  const h0 = Math.sqrt(inner * inner - (x0 - x) * (x0 - x));
  const h1 = Math.sqrt(inner * inner - (x1 - x) * (x1 - x));
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x0, cy - h0);
  ctx.arc(x, cy, inner, Math.atan2(-h0, x0 - x), Math.atan2(-h1, x1 - x), false);
  ctx.lineTo(x1, cy);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Facing-local pose point to world. */
function at(x: number, gy: number, f: 1 | -1, p: Vec): Vec {
  return { x: x + f * p.x, y: gy + p.y };
}

/** 14 px ink capsule with an 8 px sleeve and a white glove. */
function drawArm(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, col: string): void {
  line(ctx, from.x, from.y, to.x, to.y, 14, INK);
  line(ctx, from.x, from.y, to.x, to.y, 8, col);
  circle(ctx, to.x, to.y, 6.5);
  fillStroke(ctx, PALETTE.white, OUTLINE_SMALL);
}

function drawClub(ctx: CanvasRenderingContext2D, hand: Vec, club: Vec): void {
  line(ctx, hand.x, hand.y, club.x, club.y, 7, INK);
  line(ctx, hand.x, hand.y, club.x, club.y, 3, PALETTE.coil);
  roundRect(ctx, club.x - 8, club.y - 5, 16, 10, 4);
  fillStroke(ctx, PALETTE.plate, OUTLINE_SMALL);
}

/** A club on the back side (backswing) is drawn behind the torso and head, like a club held behind the body. */
function clubBehind(pose: Pose): boolean {
  return !pose.armsUp && pose.club.x < 0;
}

function drawArms(ctx: CanvasRenderingContext2D, x: number, gy: number, f: 1 | -1, pose: Pose, col: string): void {
  if (!pose.armsUp && !clubBehind(pose)) drawClub(ctx, at(x, gy, f, pose.hand), at(x, gy, f, pose.club));
  drawArm(ctx, at(x, gy, f, SHOULDER), at(x, gy, f, pose.hand), col);
  if (pose.hand2 !== undefined) drawArm(ctx, at(x, gy, f, BACK_SHOULDER), at(x, gy, f, pose.hand2), col);
}

function bodyOffsets(anim: GolferAnim): { bob: number; scale: number; walkPhase: number; walking: boolean } {
  const moving = anim.walkT < 1;
  if (moving && anim.move === 'pop') {
    const k = anim.walkT;
    return { bob: 0, scale: k < 0.6 ? (k / 0.6) * 1.1 : 1.1 - ((k - 0.6) / 0.4) * 0.1, walkPhase: 0, walking: false };
  }
  if (moving) {
    const phase = (Math.sin(anim.walkT * 0.35 * 8 * Math.PI * 2) + 1) / 2;
    return { bob: -3 * phase, scale: 1, walkPhase: phase, walking: true };
  }
  if (anim.cheerT < CHEER_DURATION) {
    const hop = Math.abs(Math.sin((anim.cheerT / CHEER_DURATION) * Math.PI * 3)) * 14;
    return { bob: -hop, scale: 1, walkPhase: 0, walking: false };
  }
  const breathe = 1 + 0.015 * (1 + Math.sin((anim.bobT / 1.2) * Math.PI * 2));
  return { bob: 0, scale: breathe, walkPhase: 0, walking: false };
}

function fidgetHand(anim: GolferAnim, pose: Pose): Pose {
  if (anim.fidgetT >= FIDGET_DURATION || pose !== IDLE) return pose;
  if (anim.fidgetKind === 0) return { ...pose, hand2: SCRATCH_HAND };
  if (anim.fidgetKind === 1) {
    const bob = Math.abs(Math.sin((anim.fidgetT / FIDGET_DURATION) * Math.PI * 2)) * 6;
    return { ...pose, club: { x: pose.club.x, y: pose.club.y - bob } };
  }
  return pose;
}

/** Full golfer at anim.pos (feet). `isLocal` / `isActive` only affect the tags drawn by renderFrame. */
export function drawGolfer(ctx: CanvasRenderingContext2D, playerId: PlayerId, anim: GolferAnim, isActive: boolean, isLocal: boolean): void {
  void isActive;
  void isLocal;
  const { col, sh } = PLAYER_VIEW[playerId];
  const f = anim.facing;
  const x = anim.pos.x;
  const gy = anim.pos.y;
  const { bob, scale, walkPhase, walking } = bodyOffsets(anim);
  if (scale <= 0.01) return;
  const pose = fidgetHand(anim, poseOf(anim));
  const face = faceOf(anim);
  const hy = HEAD_Y;
  const sad = anim.sadT < SAD_DURATION;
  const capPop = anim.cheerT < 0.27 ? 6 * Math.sin((anim.cheerT / 0.27) * Math.PI) : 0;
  const blink = anim.blinkT < BLINK_DURATION;
  let eyeDx = 0;
  if (anim.watchX !== null) eyeDx = Math.sign(anim.watchX - x) * 2;
  else if (anim.fidgetT < FIDGET_DURATION && anim.fidgetKind === 2) eyeDx = -f * 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, gy + 2, 22, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.shadow;
  ctx.fill();
  ctx.translate(x, gy);
  ctx.scale(scale, scale);
  ctx.rotate((((pose.lean * f) + (sad ? 12 * f : 0)) * Math.PI) / 180);
  ctx.translate(-x, -gy - bob);
  drawLegs(ctx, x, gy, walking, walkPhase);
  if (clubBehind(pose)) drawClub(ctx, at(x, gy, f, pose.hand), at(x, gy, f, pose.club));
  drawTorso(ctx, x, gy, f, col, sh);
  if (anim.watchX !== null && Math.abs(anim.watchX - x) > WATCH_FAR_PX) drawArm(ctx, at(x, gy, f, SHOULDER), at(x, gy, f, WATCH_HAND), col);
  drawHead(ctx, x, gy + hy, f, col, sh, capPop);
  drawFace(ctx, x, gy + hy, f, face, anim.power, eyeDx, blink);
  drawArms(ctx, x, gy, f, pose, col);
  ctx.restore();
}

// ---- faded golfer (waiting golfer under the active aim arc) --------------------------------------

/** World box around the feet that holds every pose (raised club, cheer V, hop, pop overshoot, shadow). */
const FADE_HALF_W = 64;
const FADE_ABOVE = 150;
const FADE_BELOW = 12;

let fadeLayer: HTMLCanvasElement | null = null;

function fadeLayerFor(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (fadeLayer === null) fadeLayer = document.createElement('canvas');
  if (fadeLayer.width < w) fadeLayer.width = w;
  if (fadeLayer.height < h) fadeLayer.height = h;
  return fadeLayer.getContext('2d');
}

/**
 * The golfer flattened into one sprite and blitted at `alpha`, so the overlapping parts do not show
 * through each other. Used for the waiting golfer while the active aim preview crosses it (VISUAL §10:
 * the arc stays readable).
 */
export function drawGolferFaded(ctx: CanvasRenderingContext2D, playerId: PlayerId, anim: GolferAnim, alpha: number): void {
  const m = ctx.getTransform();
  const scale = Math.max(0.05, Math.hypot(m.a, m.b));
  const x0 = anim.pos.x - FADE_HALF_W;
  const y0 = anim.pos.y - FADE_ABOVE;
  const sw = Math.ceil(FADE_HALF_W * 2 * scale);
  const sh = Math.ceil((FADE_ABOVE + FADE_BELOW) * scale);
  const layer = fadeLayerFor(sw, sh);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (layer === null) drawGolfer(ctx, playerId, anim, false, false);
  else {
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, sw, sh);
    layer.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    drawGolfer(layer, playerId, anim, false, false);
    ctx.drawImage(layer.canvas, 0, 0, sw, sh, x0, y0, sw / scale, sh / scale);
  }
  ctx.restore();
}
