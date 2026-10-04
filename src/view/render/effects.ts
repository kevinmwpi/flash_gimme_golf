// OWNER: view
/**
 * Particles, world-anchored callouts and the ink screen flash (ARCH.md §1.9, VISUAL.md §13-§14).
 * Particles are flat discs / squares / streaks with a 3 px ink outline when >= 6 px and vanish without
 * alpha fade (Flash style). Callouts are screen-space display text at the anchor, 60 px up, with the
 * scale-pop / hold / rise-and-fade timeline; `prefers-reduced-motion` fades only.
 */
import type { Vec } from '../../sim/types';
import { VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import type { Callout, Particle, ViewState } from '../view';
import { circle, fillStroke, INK, OUTLINE_SMALL, PALETTE } from './palette';
import { drawOutlinedText } from './text';

const OUTLINED_MIN_SIZE = 6;
const CALLOUT_RISE_PX = 60;
const CALLOUT_LANDING_DODGE_PX = 40;
const CALLOUT_POP_IN = 0.09;
const CALLOUT_SETTLE = 0.08;
const CALLOUT_FADE = 0.25;
const CALLOUT_ROTATION_DEG = -4;
const HUD_BAND_PX = 68;
const STAR_OFFSETS: ReadonlyArray<[number, number, number]> = [
  [-70, -22, 7],
  [64, -30, 6],
  [40, 26, 5],
];

export function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  for (const p of particles) {
    const outlined = p.size >= OUTLINED_MIN_SIZE;
    if (p.shape === 'streak') {
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(p.pos.x - p.vel.x * 0.05, p.pos.y - p.vel.y * 0.05);
      ctx.lineWidth = p.size;
      ctx.strokeStyle = p.colour;
      ctx.lineCap = 'round';
      ctx.stroke();
      continue;
    }
    if (p.shape === 'square') {
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.life * 9);
      ctx.beginPath();
      ctx.rect(-p.size / 2, -p.size / 2, p.size, p.size);
      fillStroke(ctx, p.colour, outlined ? OUTLINE_SMALL : 0);
      ctx.restore();
      continue;
    }
    circle(ctx, p.pos.x, p.pos.y, p.size / 2);
    fillStroke(ctx, p.colour, outlined ? OUTLINE_SMALL : 0);
  }
}

type CalloutPhase = { scale: number; alpha: number; rise: number };

function calloutPhase(age: number, ttl: number, reducedMotion: boolean): CalloutPhase {
  const fadeStart = ttl - CALLOUT_FADE;
  if (reducedMotion) {
    const alpha = age < 0.1 ? age / 0.1 : age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / CALLOUT_FADE) : 1;
    return { scale: 1, alpha, rise: 0 };
  }
  if (age < CALLOUT_POP_IN) return { scale: 0.4 + 0.75 * (age / CALLOUT_POP_IN), alpha: 1, rise: 0 };
  if (age < CALLOUT_POP_IN + CALLOUT_SETTLE) return { scale: 1.15 - 0.15 * ((age - CALLOUT_POP_IN) / CALLOUT_SETTLE), alpha: 1, rise: 0 };
  if (age > fadeStart) {
    const k = Math.min(1, (age - fadeStart) / CALLOUT_FADE);
    return { scale: 1, alpha: 1 - k, rise: 24 * k };
  }
  return { scale: 1, alpha: 1, rise: 0 };
}

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, r: number): boolean {
  return Math.abs(ax - bx) < aw / 2 + r && Math.abs(ay - by) < ah / 2 + r;
}

/** Anchor clamped inside the stage and outside the HUD bands (UX §4.5). */
function clampAnchor(x: number, y: number, halfW: number): Vec {
  return {
    x: Math.min(VIEWPORT_W - halfW - 8, Math.max(halfW + 8, x)),
    y: Math.min(VIEWPORT_H - HUD_BAND_PX - 24, Math.max(HUD_BAND_PX + 30, y)),
  };
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  for (const [dx, dy, r] of STAR_OFFSETS) {
    ctx.save();
    ctx.translate(x + dx * scale, y + dy * scale);
    ctx.rotate(0.3);
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    fillStroke(ctx, PALETTE.sun, 2.5);
    ctx.restore();
  }
}

function drawCallout(ctx: CanvasRenderingContext2D, c: Callout, view: ViewState, toScreen: (p: Vec) => Vec, landing: Vec | null): void {
  if (c.worldPos === null) return;
  const age = view.timeSec - c.bornAt;
  const phase = calloutPhase(age, c.ttl, view.reducedMotion);
  if (phase.alpha <= 0) return;
  const anchor = toScreen(c.worldPos);
  const approxHalfW = (c.text.length * c.sizePx * 0.62) / 2;
  let y = anchor.y - CALLOUT_RISE_PX - phase.rise;
  if (landing !== null) {
    const l = toScreen(landing);
    if (overlaps(anchor.x, y, approxHalfW * 2, c.sizePx * 1.4, l.x, l.y, 22)) y -= CALLOUT_LANDING_DODGE_PX;
  }
  const p = clampAnchor(anchor.x, y, approxHalfW);
  ctx.save();
  ctx.globalAlpha = phase.alpha;
  if (c.stars === true) drawStars(ctx, p.x, p.y, phase.scale);
  drawOutlinedText(ctx, c.text, p.x, p.y, c.sizePx, c.colour, { rotationDeg: CALLOUT_ROTATION_DEG, scale: phase.scale });
  if (c.sub !== undefined) {
    drawOutlinedText(ctx, c.sub, p.x, p.y + c.sizePx * 0.8, c.sizePx * 0.45, c.subColour ?? PALETTE.white, {
      rotationDeg: CALLOUT_ROTATION_DEG,
      scale: phase.scale,
    });
  }
  ctx.restore();
}

/** Screen-space callouts (ctx transform must be the DPR-only transform). */
export function drawCallouts(ctx: CanvasRenderingContext2D, view: ViewState, toScreen: (p: Vec) => Vec): void {
  const landing = view.aimPreview?.landing ?? null;
  for (const c of view.callouts) drawCallout(ctx, c, view, toScreen, landing);
}

/** Ink flash over the whole stage (fellOffWorld edges, levelRestart). */
export function drawFlash(ctx: CanvasRenderingContext2D, remaining: number): void {
  if (remaining <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
  ctx.restore();
}
