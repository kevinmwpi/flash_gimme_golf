// OWNER: view
/**
 * Small hardware shared by every switch-linked prop (VISUAL.md §4): the lamp (mint + flat 35 % halo while
 * lit, `plateSh` while unlit), the metal post, the switch letter tag and the bottom shade band of a rounded
 * rect. mechanics.ts (World 1 props) and devices.ts (traps and cannons) both draw with them, so a lamp means
 * the same thing on a door, a bridge, a trap and a cannon: lit while a linked plate is held.
 */
import type { PressureSwitch } from '../../sim/types';
import { circle, fillStroke, font, OUTLINE_DOT, OUTLINE_SMALL, PALETTE, roundRect } from './palette';

export const LAMP_R = 6;
const LAMP_HALO_R = 11;
export const POST_W = 10;
export const POST_H = 26;
const TAG_R = 8;
const TAG_FONT_PX = 11;
/** Narrowest drawn plate; wider press zones draw wider so the plate IS the zone (LEVELS.md). */
const SWITCH_MIN_BASE_W = 64;
/** Cap inset from each end of the base (64 base -> 52 cap, VISUAL.md §4). */
const SWITCH_CAP_INSET = 6;
/** Letter tag / lamp centre inset from the base ends. */
const SWITCH_END_INSET = 6;

export type SwitchGeometry = {
  /** Plate centre x. */
  cx: number;
  /** Drawn base width == max(64, press zone width), so cause and effect line up on screen. */
  baseW: number;
  capW: number;
  tagX: number;
  lampX: number;
};

/** Where the plate, cap, letter tag and lamp of a switch sit (shared by the base, cap, wire and a trap seat). */
export function switchGeometry(sw: PressureSwitch): SwitchGeometry {
  const cx = sw.x + sw.w / 2;
  const baseW = Math.max(SWITCH_MIN_BASE_W, sw.w);
  return { cx, baseW, capW: baseW - 2 * SWITCH_CAP_INSET, tagX: cx - baseW / 2 + SWITCH_END_INSET, lampX: cx + baseW / 2 - SWITCH_END_INSET };
}

export function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean): void {
  if (lit) {
    circle(ctx, x, y, LAMP_HALO_R);
    ctx.fillStyle = PALETTE.mintHalo;
    ctx.fill();
  }
  circle(ctx, x, y, LAMP_R);
  fillStroke(ctx, lit ? PALETTE.mint : PALETTE.plateSh, OUTLINE_DOT);
}

export function letterTag(ctx: CanvasRenderingContext2D, x: number, y: number, letter: string): void {
  circle(ctx, x, y, TAG_R);
  fillStroke(ctx, PALETTE.sw, OUTLINE_DOT);
  ctx.fillStyle = PALETTE.white;
  ctx.font = font(700, TAG_FONT_PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y + 0.5);
}

/** Bottom shade band of a rounded rect drawn as its own rounded path (no clip). */
export function bottomBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, band: number, r: number, colour: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y + h - band, w, band, [0, 0, r, r]);
  ctx.fillStyle = colour;
  ctx.fill();
}

export function post(ctx: CanvasRenderingContext2D, x: number, top: number): void {
  roundRect(ctx, x - POST_W / 2, top, POST_W, POST_H, 3);
  fillStroke(ctx, PALETTE.plate, OUTLINE_SMALL);
}
