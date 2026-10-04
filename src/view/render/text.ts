// OWNER: view
/**
 * Canvas text: paper stickers on mechanics, world-anchored callouts and the YOU / BLUE AIMING tags
 * (VISUAL.md §5, §14; BUILD_DECISIONS D1/D3). Fredoka 700, `strokeText` under `fillText`, drawn in
 * SCREEN space after the camera transform is reset so the text keeps its size in overview. No HUD
 * text is ever drawn on the canvas. Also the single home of every world/callout string.
 */
import type { PlayerId } from '../../sim/types';
import { PLAYER_NAMES } from '../../sim/types';
import { circle, fillStroke, font, INK, OUTLINE_DOT, OUTLINE_SMALL, PALETTE, roundRect, STICKER_FONT_PX } from './palette';

export type StickerOptions = {
  accent: string;
  rotationDeg?: number;
  sizePx?: number;
  alpha?: number;
  fill?: string;
  colour?: string;
};

/** Sticker box: text + 18 px padding (+18 px for the accent dot); height = size + 12 (VISUAL.md §5.1). */
const STICKER_PAD_X = 18;
const STICKER_ACCENT_W = 18;
const STICKER_PAD_Y = 12;
const STICKER_RADIUS = 8;
const STICKER_SHADOW_Y = 3;
const STICKER_ACCENT_R = 6;

/** World/callout/sticker copy (UX §9.2 copy sheet words per BUILD_DECISIONS D3; stickers per D2). */
export const COPY = Object.freeze({
  stickers: Object.freeze({
    sand: 'SAND',
    spring: 'SPRING',
    bumper: 'BUMPER',
    fan: 'FAN',
    gateRed: 'RED ONLY',
    gateBlue: 'BLUE ONLY',
    bridge: 'BRIDGE',
    on: ' · ON',
    off: ' · OFF',
    open: ' · OPEN',
    shut: ' · SHUT',
    pit: 'OUT OF BOUNDS · +1',
    pitLine1: 'OUT OF BOUNDS',
    pitLine2: '+1',
    gimmeZone: 'GIMME ZONE',
    cancel: 'CANCEL',
    aimUp: 'AIM UPWARD',
    you: 'YOU',
  }),
  callouts: Object.freeze({
    gimme: 'GIMME! +1',
    sink: 'IN THE HOLE!',
    oob: 'OUT! +1',
    locked: 'LOCKED!',
    spring: 'BOING!',
    bumper: 'BONK!',
    sand: 'SAND…',
    fan: 'LIFT!',
    held: 'HELD',
    bridgeOn: 'BRIDGE OPEN',
    bridgeOff: 'BRIDGE GONE',
    gateOpen: 'OPEN',
    gateShut: 'SHUT',
    gateWord: 'GATE',
    soClose: 'SO CLOSE',
  }),
});

/** `SWITCH A`, `SWITCH B` … from the switch's index in level.switches (VISUAL.md §5.2). */
export function switchLetter(index: number): string {
  return String.fromCharCode(65 + Math.max(0, index));
}

/** Sticker base word for a switch: its label, else `SWITCH <letter>` (BUILD_DECISIONS D2). */
export function switchWord(label: string | undefined, index: number): string {
  return label !== undefined && label.length > 0 ? label.toUpperCase() : `SWITCH ${switchLetter(index)}`;
}

/** Callout for a held switch: `SWITCH A HELD` for single-letter labels, else `<LABEL> HELD`. */
export function switchHeldCallout(label: string | undefined, index: number): string {
  const word = switchWord(label, index);
  return word.length === 1 ? `SWITCH ${word} ${COPY.callouts.held}` : `${word} ${COPY.callouts.held}`;
}

/** Sticker base word for a switch-driven blocker (door/window): its label, else `GATE <letter>`. */
export function gateWord(label: string | undefined, switchIndex: number): string {
  return label !== undefined && label.length > 0 ? label.toUpperCase() : `${COPY.callouts.gateWord} ${switchLetter(switchIndex)}`;
}

export function partnerAimingTag(playerId: PlayerId): string {
  return `${PLAYER_NAMES[playerId].toUpperCase()} AIMING`;
}

export function gateOnlyWord(colour: 'red' | 'blue'): string {
  return colour === 'red' ? COPY.stickers.gateRed : COPY.stickers.gateBlue;
}

// ---- measurement cache (invalidated when the display font resolves; VISUAL.md §5.4) ----

const widthCache = new Map<string, number>();

export function invalidateTextCache(): void {
  widthCache.clear();
}

export function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, sizePx: number, weight: 600 | 700 = 700): number {
  const key = `${weight}|${sizePx}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  ctx.font = font(weight, sizePx);
  const w = ctx.measureText(text).width;
  widthCache.set(key, w);
  return w;
}

export type StickerBox = { w: number; h: number };

/** Box of a sticker before rotation (used by the collision layout). */
export function measureSticker(ctx: CanvasRenderingContext2D, text: string, sizePx: number = STICKER_FONT_PX, accent: boolean = true): StickerBox {
  const tw = measureTextWidth(ctx, text, sizePx) + (accent ? STICKER_ACCENT_W : 0);
  return { w: tw + STICKER_PAD_X, h: sizePx + STICKER_PAD_Y };
}

/** Draws one paper sticker centred at (x, y) in screen space and returns its width. */
export function drawSticker(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, options: StickerOptions): number {
  const size = options.sizePx ?? STICKER_FONT_PX;
  const hasAccent = options.accent.length > 0;
  const { w, h } = measureSticker(ctx, text, size, hasAccent);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((options.rotationDeg ?? -2) * Math.PI) / 180);
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.font = font(700, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  roundRect(ctx, -w / 2, -h / 2 + STICKER_SHADOW_Y, w, h, STICKER_RADIUS);
  ctx.fillStyle = INK;
  ctx.fill();
  roundRect(ctx, -w / 2, -h / 2, w, h, STICKER_RADIUS);
  fillStroke(ctx, options.fill ?? PALETTE.paper, OUTLINE_SMALL);
  if (hasAccent) {
    circle(ctx, -w / 2 + 12, 0, STICKER_ACCENT_R);
    fillStroke(ctx, options.accent, OUTLINE_DOT);
  }
  ctx.fillStyle = options.colour ?? INK;
  ctx.fillText(text, hasAccent ? STICKER_ACCENT_W / 2 : 0, 1);
  ctx.restore();
  return w;
}

export type OutlinedTextOptions = {
  /** Ink stroke width under the fill (default: size / 5.5, i.e. 8 px at 44 px). */
  strokePx?: number;
  /** Hard ink shadow offset (default: size / 7). */
  shadowPx?: number;
  rotationDeg?: number;
  scale?: number;
  alpha?: number;
  weight?: 600 | 700;
};

/** Outlined display text (callouts): strokeText at 2x the outline under fillText + a hard ink shadow. */
export function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizePx: number,
  fill: string,
  options: OutlinedTextOptions = {},
): void {
  const strokePx = options.strokePx ?? sizePx / 5.5;
  const shadowPx = options.shadowPx ?? sizePx / 7;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((options.rotationDeg ?? 0) * Math.PI) / 180);
  const s = options.scale ?? 1;
  ctx.scale(s, s);
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.font = font(options.weight ?? 700, sizePx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = strokePx * 2;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, 0, shadowPx);
  ctx.fillStyle = INK;
  ctx.fillText(text, 0, shadowPx);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** World tag: white 12-14 px text on a player-colour pill with a 3 px ink outline (YOU, BLUE AIMING). */
export function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, sizePx: number = 14): void {
  const tw = measureTextWidth(ctx, text, sizePx);
  const w = tw + 16;
  const h = sizePx + 10;
  ctx.save();
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  fillStroke(ctx, bg, OUTLINE_SMALL);
  ctx.font = font(700, sizePx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
