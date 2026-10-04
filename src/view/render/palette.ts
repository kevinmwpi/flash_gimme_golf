// OWNER: view
/**
 * Palette tokens (VISUAL.md §1) + the ARCH.md §1.9 `THEME` shape mapped from them. No hex may appear
 * outside this file; the HUD CSS custom properties in styles.css mirror these values. Also the
 * shared drawing primitives every render module uses (fill+outline, rounded rects, the screen-pixel
 * outline clamp of VISUAL.md §2.2).
 */

export const PALETTE = Object.freeze({
  ink: '#241b33',
  paper: '#fff8e7',
  paperSh: '#e9dcc0',
  sky1: '#3fb6ff',
  sky2: '#c9f1ff',
  sun: '#ffd93b',
  sunSh: '#e0a800',
  cloud: '#ffffff',
  cloudSh: '#d4e9f8',
  cloudInk: '#3f6f9c',
  hillFar: '#a9e3b7',
  hillMid: '#6fcb73',
  hillMidInk: '#2f7a4b',
  tree: '#3f9f4c',
  grass: '#6ad636',
  grassSh: '#45b02a',
  dirt: '#c97f3d',
  dirtSh: '#a3602a',
  pitTop: '#4a2d18',
  pitBot: '#1a0d05',
  rock: '#3b2516',
  sand: '#f5d98a',
  sandSh: '#d9b35c',
  sandLine: '#fff1b0',
  spring: '#ffd93b',
  springSh: '#e0a800',
  coil: '#d6dcea',
  bump: '#ff9f1c',
  bumpSh: '#e07a00',
  fan: '#8d93a8',
  fanSh: '#6a7088',
  /** "metal": switch base, bridge posts, club head (shared with the fan housing). */
  plate: '#8d93a8',
  plateSh: '#6a7088',
  wind: 'rgba(140,230,255,.40)',
  windLine: 'rgba(255,255,255,.9)',
  windAccent: '#7fe7ff',
  sw: '#b57bee',
  swSh: '#8f55cc',
  plank: '#d89a4b',
  plankSh: '#b97a33',
  mint: '#44d67a',
  mintSh: '#2aa85a',
  mintHalo: 'rgba(68,214,122,.35)',
  p1: '#ff5d73',
  p1Sh: '#d63d55',
  p2: '#50b7ff',
  p2Sh: '#2f8fd6',
  skin: '#ffcf9e',
  shorts: '#3f3a5a',
  shortsSh: '#2d2944',
  tongue: '#ff8aa8',
  cheek: 'rgba(255,93,115,.35)',
  gold: '#ffd93b',
  goldSh: '#e0a800',
  silver: '#e3eaf4',
  silverSh: '#9fb0c6',
  bronze: '#e0905a',
  bronzeSh: '#a5612a',
  shadow: 'rgba(36,27,51,.28)',
  inkGhost: 'rgba(36,27,51,.45)',
  white: '#ffffff',
  whiteSoft: 'rgba(255,255,255,.85)',
  whiteHalo: 'rgba(255,255,255,.28)',
  letterbox: '#10263d',
});

export type PaletteToken = keyof typeof PALETTE;

export type Theme = {
  sky: [string, string];
  hills: string[];
  grass: string;
  grassDark: string;
  dirt: string;
  dirtDark: string;
  outline: string;
  sand: string;
  spring: string;
  bumper: string;
  fan: string;
  bridge: string;
  blocker: string;
  cupDark: string;
  flag: string;
  red: string;
  blue: string;
};

/** ARCH.md §1.9 shape, mapped from the VISUAL tokens so both contracts hold. */
export const THEME: Theme = Object.freeze<Theme>({
  sky: [PALETTE.sky1, PALETTE.sky2],
  hills: [PALETTE.hillFar, PALETTE.hillMid],
  grass: PALETTE.grass,
  grassDark: PALETTE.grassSh,
  dirt: PALETTE.dirt,
  dirtDark: PALETTE.dirtSh,
  outline: PALETTE.ink,
  sand: PALETTE.sand,
  spring: PALETTE.spring,
  bumper: PALETTE.bump,
  fan: PALETTE.fan,
  bridge: PALETTE.plank,
  blocker: PALETTE.sun,
  cupDark: PALETTE.ink,
  flag: PALETTE.cloud,
  red: PALETTE.p1,
  blue: PALETTE.p2,
});

export const INK = PALETTE.ink;
/** 4 px ink outline on anything >= 20 px (BUILD_DECISIONS D1; VISUAL.md §2). */
export const OUTLINE_WIDTH = 4;
/** 3 px on small parts (shoes, collar, hands, flag, posts, badges). */
export const OUTLINE_SMALL = 3;
/** 2.5 px on dots <= 12 px. */
export const OUTLINE_DOT = 2.5;
/** On-object sticker text size (D1). */
export const STICKER_FONT_PX = 15;
/** Grass cap thickness and its inner shade band (VISUAL.md §4 terrain recipe). */
export const GRASS_BAND_PX = 24;
export const GRASS_SHADE_PX = 15;
export const DIRT_SHADE_PX = 12;

export const FONT_FAMILY = "Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

export function font(weight: 500 | 600 | 700, px: number): string {
  return `${weight} ${px}px ${FONT_FAMILY}`;
}

export type PlayerView = { col: string; sh: string; name: string };

export const PLAYER_VIEW: Readonly<Record<0 | 1, PlayerView>> = Object.freeze({
  0: { col: PALETTE.p1, sh: PALETTE.p1Sh, name: 'RED' },
  1: { col: PALETTE.p2, sh: PALETTE.p2Sh, name: 'BLUE' },
});

/**
 * Screen-pixel rule (VISUAL.md §2.2): `base` screen px at zoom 1, never below 2 screen px in
 * overview and never above `base`, expressed in world units for the current camera zoom.
 */
export function screenLineWidth(zoom: number, base: number = OUTLINE_WIDTH): number {
  const screenPx = Math.min(base, Math.max(2, base * zoom));
  return screenPx / zoom;
}

/** Fill the current path, then stroke it (outline straddles the geometry edge). lw 0 = no outline. */
export function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw: number = OUTLINE_WIDTH, stroke: string = INK): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

/** `CanvasRenderingContext2D.roundRect` throws on a negative radius, which would kill the frame loop. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, r));
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, lw: number, colour: string): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineWidth = lw;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** A coloured line over an ink line 5 px wider (ticks, club shaft, landing X). */
export function inkLine(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, lw: number, colour: string): void {
  line(ctx, ax, ay, bx, by, lw + 5, INK);
  line(ctx, ax, ay, bx, by, lw, colour);
}

export type Pt = readonly [number, number];

/** Append a polyline with r-rounded corners (quadratic curves) to the current path (VISUAL.md §2.7). */
export function roundedPolyline(ctx: CanvasRenderingContext2D, pts: readonly Pt[], r: number, move: boolean): void {
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === undefined || last === undefined) return;
  if (move) ctx.moveTo(first[0], first[1]);
  else ctx.lineTo(first[0], first[1]);
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1];
    const v = pts[i];
    const b = pts[i + 1];
    if (a === undefined || v === undefined || b === undefined) continue;
    const la = Math.sqrt((a[0] - v[0]) * (a[0] - v[0]) + (a[1] - v[1]) * (a[1] - v[1]));
    const lb = Math.sqrt((b[0] - v[0]) * (b[0] - v[0]) + (b[1] - v[1]) * (b[1] - v[1]));
    if (la === 0 || lb === 0) continue;
    const ra = Math.min(r, la / 2);
    const rb = Math.min(r, lb / 2);
    ctx.lineTo(v[0] + ((a[0] - v[0]) / la) * ra, v[1] + ((a[1] - v[1]) / la) * ra);
    ctx.quadraticCurveTo(v[0], v[1], v[0] + ((b[0] - v[0]) / lb) * rb, v[1] + ((b[1] - v[1]) / lb) * rb);
  }
  ctx.lineTo(last[0], last[1]);
}

/** Smooth-step easing for pops and slides. */
export function easeOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) * (1 - k);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
