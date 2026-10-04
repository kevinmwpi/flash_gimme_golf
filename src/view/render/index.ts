// OWNER: view
/**
 * Frame composition (ARCH.md §1.9; VISUAL.md §19 draw order): sky -> [camera + shake] terrain layer ->
 * lit wires -> props -> switches -> cup -> golfers (inactive first, faded under the active arc) ->
 * trails/balls -> aim -> particles -> turn marker -> [reset] stickers -> callouts -> tags -> drag ring
 * and CANCEL / AIM UPWARD -> flash. Assumes `ctx` transform = logical
 * 1280x720 (DPR-only). Stickers and callouts wait for the display font (BUILD_DECISIONS D4).
 */
import type { Level, LevelRect, PlayerId, PressureSwitch, SimState, Vec } from '../../sim/types';
import { BALL_RADIUS, GIMME_RADIUS, VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import { isRectActive } from '../../sim/terrain';
import { isShotReady } from '../../sim/sim';
import { shakeOffset, worldToScreen, type InputDevice, type ViewState } from '../view';
import { aimDotPoints, drawAim, drawDragOverlay, drawMissRings, drawTurnMarker } from './aim';
import { drawCallouts, drawFlash, drawParticles } from './effects';
import { drawBall, drawBallShadow, drawGolfer, drawGolferFaded, drawTrail } from './entities';
import { drawRect, drawSwitch, drawWire, isPermanentBlocker, rectLetter, switchGeometry, switchTop } from './mechanics';
import { PALETTE, STICKER_FONT_PX } from './palette';
import { COPY, drawSticker, drawTag, gateOnlyWord, gateWord, invalidateTextCache, measureSticker, partnerAimingTag, switchLetter, switchWord } from './text';
import { drawCup, drawSky, drawTerrain, fairwayYExtended, groundYBelow } from './world';

export type RenderScene = {
  state: SimState;
  view: ViewState;
  seat: PlayerId | null;
  device: InputDevice;
  /** ANY aim: local or partner's. */
  showAim: boolean;
};

const FLAG_WOBBLE_RATE = 2;
const FONT_TIMEOUT_MS = 1500;
const FONT_PROBE = '700 20px Fredoka';
const FAN_BOOST_SEC = 0.3;
const YOU_TAG_SECONDS = 6;
const GOLFER_HEIGHT = 98;
/** The waiting golfer fades to this while the active aim preview crosses its body (half-width 22 + dot r 4). */
const WAITING_FADE_ALPHA = 0.55;
const AIM_FADE_HALF_W = 26;
const AIM_FADE_MARGIN = 6;
const STICKER_ABOVE = 30;
/** Stacked labels clear each other by their own height plus this gap (so labelScale 1.8 still clears). */
const STICKER_STACK_GAP = 2;
const STICKER_STACK_TRIES = 6;
/** Clear gap a dodging label keeps from the golfer / cup / label it steps around. */
const STICKER_DODGE_GAP = 8;
const STICKER_WINDOW_CAP = 6;
const STICKER_DIM_ALPHA = 0.35;
const PIT_STICKER_Y = 626;
const PIT_STICKER_PX = 13;
const PIT_STICKER_ALPHA = 0.92;
/** FAN label centre below the housing top (VISUAL §4). */
const FAN_STICKER_BELOW_TOP = 42;
/** Colour-gate badge half-width (76 px paper badge, VISUAL §4). */
const GATE_BADGE_HALF_W = 38;
/** Gate labels hang this far off the barrier, level with the top post's lamp (y + 13). */
const GATE_STICKER_GAP = 12;
const GATE_LAMP_DY = 13;
const STICKER_EDGE_MARGIN = 8;
/** A label is dropped when less than this much of its prop (or less than half of a narrower prop) is on screen. */
const STICKER_MIN_VISIBLE_PX = 24;
/** No world label may extend into the persistent HUD bands (VISUAL §11: playfield y 68-652). */
const PLAYFIELD_TOP_Y = 68;
const PLAYFIELD_BOTTOM_Y = 652;
/**
 * Golfer keep-out box for labels: body 44 px plus the raised club behind the head (34 px), from the
 * feet up past the turn marker and the YOU tag (122 / 120 px above the feet).
 */
const GOLFER_BOX_HALF_W = 36;
const GOLFER_BOX_ABOVE_FEET = 136;
/** Cup keep-out box: the gimme ring (rx GIMME_RADIUS, ry 8), the hole, the 78 px pole and the flag. */
const CUP_BOX_ABOVE_RIM = 84;
const CUP_BOX_BELOW_RIM = 10;
const GIMME_ZONE_PX = 13;
/** GIMME ZONE hangs this far under the rim: below the ring's lower edge (ry 8) plus a 4 px gap. */
const GIMME_ZONE_BELOW_RIM = 12;
const PULSE_SAND = { dur: 0.2, scale: 1.2 };
const PULSE_GATE = { dur: 0.4, scale: 1.3 };

// ---- fonts (D4): wait for Fredoka with a 1.5 s timeout, then draw text and re-measure ------------

let fontRequested = false;
let fontReady = false;

function requestFonts(): void {
  if (fontRequested) return;
  fontRequested = true;
  if (typeof document === 'undefined' || typeof document.fonts === 'undefined') {
    fontReady = true;
    return;
  }
  const settle = (): void => {
    fontReady = true;
    invalidateTextCache();
  };
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  Promise.race([document.fonts.load(FONT_PROBE).then(() => undefined), timeout]).then(settle, settle);
  document.fonts.ready.then(() => invalidateTextCache(), () => undefined);
}

/** True once the display font resolved or the 1.5 s timeout passed (text layers draw from then on). */
export function isTextReady(): boolean {
  return fontReady;
}

// ---- world layers ---------------------------------------------------------------------------------

function drawLitWires(ctx: CanvasRenderingContext2D, level: Level, state: SimState): void {
  const surface = (x: number): number => fairwayYExtended(level, x) ?? level.hole.rimY;
  for (const sw of level.switches) {
    if (sw.onRectId !== undefined || state.switches[sw.id] !== true) continue;
    for (const r of level.rects) {
      const linked = r.switchIds !== undefined ? r.switchIds.includes(sw.id) : r.switchId === sw.id;
      if (linked) drawWire(ctx, sw, r, true, surface);
    }
  }
}

function drawProp(ctx: CanvasRenderingContext2D, level: Level, state: SimState, view: ViewState, r: LevelRect): void {
  const active = isRectActive(r, state.switches);
  switch (r.kind) {
    case 'sand':
      break;
    case 'spring':
    case 'bumper':
      drawRect(ctx, r, active, view.padAnims.get(r.id) ?? 1, undefined, { parts: 'dynamic' });
      break;
    case 'fan': {
      const boost = Math.min(FAN_BOOST_SEC, view.padAnims.get(r.id) ?? FAN_BOOST_SEC);
      drawRect(ctx, r, active, view.timeSec + boost, undefined, { parts: 'dynamic' });
      break;
    }
    case 'colourGate':
      drawRect(ctx, r, active, 1, undefined, { gate: view.gateAnims.get(r.id) });
      break;
    case 'bridge':
      drawRect(ctx, r, active, view.rectAnims.get(r.id) ?? (active ? 1 : 0), undefined, { parts: 'dynamic', letter: rectLetter(level, r) });
      break;
    case 'blocker':
      if (!isPermanentBlocker(r)) drawRect(ctx, r, active, view.rectAnims.get(r.id) ?? (active ? 1 : 0), undefined, { letter: rectLetter(level, r) });
      break;
  }
}

function deckVisible(level: Level, state: SimState, sw: PressureSwitch): boolean {
  if (sw.onRectId === undefined) return true;
  const rect = level.rects.find((r) => r.id === sw.onRectId);
  return rect !== undefined && isRectActive(rect, state.switches);
}

function drawSwitches(ctx: CanvasRenderingContext2D, level: Level, state: SimState, view: ViewState): void {
  level.switches.forEach((sw, i) => {
    if (!deckVisible(level, state, sw)) return;
    drawSwitch(ctx, sw, view.switchAnims.get(sw.id) ?? 0, switchLetter(i), 'dynamic');
  });
}

/** Do the aim dots / landing X being drawn this frame cross golfer p's body? */
function aimCrossesGolfer(scene: RenderScene, p: PlayerId): boolean {
  const { state, view } = scene;
  const preview = view.aimPreview;
  if (!scene.showAim || preview === null || state.phase !== 'aiming' || preview.playerId === p) return false;
  if (!isShotReady(state) || (!preview.remote && view.drag?.cancel === true)) return false;
  const feet = view.golfers[p].pos;
  const hits = (q: Vec): boolean => Math.abs(q.x - feet.x) < AIM_FADE_HALF_W && q.y > feet.y - GOLFER_HEIGHT - AIM_FADE_MARGIN && q.y < feet.y + AIM_FADE_MARGIN;
  const { flight, roll } = aimDotPoints(preview);
  return flight.some(hits) || roll.some(hits) || (preview.landing !== null && hits(preview.landing));
}

/** Inactive golfer first; it steps back (faded) while the active aim arc runs across it. */
function drawGolfers(ctx: CanvasRenderingContext2D, scene: RenderScene): void {
  const { state, view, seat } = scene;
  const active = state.activePlayer;
  const order: PlayerId[] = active === 0 ? [1, 0] : [0, 1];
  for (const p of order) {
    if (p !== active && aimCrossesGolfer(scene, p)) drawGolferFaded(ctx, p, view.golfers[p], WAITING_FADE_ALPHA);
    else drawGolfer(ctx, p, view.golfers[p], p === active, seat === p);
  }
}

function drawBalls(ctx: CanvasRenderingContext2D, level: Level, state: SimState, view: ViewState): void {
  const order: PlayerId[] = state.activePlayer === 0 ? [1, 0] : [0, 1];
  for (const p of order) {
    const rb = view.renderBalls[p];
    if (!rb.visible) continue;
    if (rb.sinkT === 0) {
      const groundY = groundYBelow(level, state.switches, rb.pos.x, rb.pos.y);
      if (groundY !== null) drawBallShadow(ctx, rb.pos.x, groundY, groundY - (rb.pos.y + BALL_RADIUS));
    }
    drawTrail(ctx, p, view.trails[p], rb.inSand ? PALETTE.sandSh : undefined);
    drawBall(ctx, p, rb);
  }
}

function previewAngle(preview: { points: Vec[] }, ball: Vec, fallback: number): number {
  const first = preview.points[0];
  if (first === undefined) return fallback;
  return Math.atan2(first.y - ball.y, first.x - ball.x);
}

function drawAimLayer(ctx: CanvasRenderingContext2D, scene: RenderScene): void {
  const { state, view } = scene;
  const preview = view.aimPreview;
  if (!scene.showAim || preview === null || state.phase !== 'aiming') return;
  const p = preview.playerId;
  const ball = view.renderBalls[p].pos;
  const aim = state.players[p].aim;
  const angle = previewAngle(preview, ball, aim.angle);
  drawAim(ctx, ball, { angle, power: aim.power }, preview, scene.device, isShotReady(state), preview.remote ? null : view.drag, view.camera.zoom);
}

function drawWorld(ctx: CanvasRenderingContext2D, scene: RenderScene): void {
  const { state, view } = scene;
  const level = view.level;
  const shake = shakeOffset(view);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  ctx.scale(view.camera.zoom, view.camera.zoom);
  ctx.translate(-view.camera.x, -view.camera.y);
  drawTerrain(ctx, level, view.camera.zoom);
  drawLitWires(ctx, level, state);
  for (const r of level.rects) drawProp(ctx, level, state, view, r);
  drawSwitches(ctx, level, state, view);
  drawCup(ctx, level, view.timeSec * FLAG_WOBBLE_RATE, view.cup);
  drawGolfers(ctx, scene);
  drawBalls(ctx, level, state, view);
  drawAimLayer(ctx, scene);
  drawMissRings(ctx, view);
  drawParticles(ctx, view.particles);
  if (state.phase === 'aiming') {
    const g = view.golfers[state.activePlayer];
    drawTurnMarker(ctx, { x: g.pos.x, y: g.pos.y }, state.activePlayer, view.timeSec, view.camera.zoom);
  }
  ctx.restore();
}

// ---- stickers (VISUAL.md §5; BUILD_DECISIONS D2 words) --------------------------------------------

/** Density-cap priority: switch-driven things and gates must never lose their label to decoration. */
type StickerPriority = 0 | 1 | 2;

type Sticker = {
  key: string;
  text: string;
  /** Prop centre (box centre unless `side` is set). */
  world: Vec;
  /** World half-width of the labelled prop; a label is dropped once its prop is off screen. */
  spanHalf: number;
  /** -1: the box hangs to the LEFT of the prop with a 12 px gap (gate labels sit beside the top post, off the stripes). */
  side?: -1 | 1;
  /** The anchor is the box's TOP edge (GIMME ZONE hangs under the ring at any labelScale). */
  hangBelow?: boolean;
  accent: string;
  sizePx: number;
  alpha: number;
  pit: boolean;
  priority: StickerPriority;
  secondLine?: string;
};

type StickerBody = Pick<Sticker, 'key' | 'text' | 'world' | 'spanHalf' | 'accent' | 'priority'> & Partial<Pick<Sticker, 'side'>>;

function propSticker(body: StickerBody): Sticker {
  return { ...body, sizePx: STICKER_FONT_PX, alpha: 1, pit: false };
}

/**
 * One label per prop. BRIDGE sits ABOVE the beam (VISUAL §5.3 says 32 px below it, but World 1 beams
 * are at y 620 so that spot is the pit sticker's and the HUD band's); door/window labels hang beside the
 * top post so the stripes and letter tag stay visible.
 */
function stickerForRect(level: Level, state: SimState, r: LevelRect, surfaceY: (x: number) => number): Sticker | null {
  const cx = r.x + r.w / 2;
  const half = r.w / 2;
  const active = isRectActive(r, state.switches);
  switch (r.kind) {
    case 'sand':
      return propSticker({ key: r.id, text: r.label ?? COPY.stickers.sand, world: { x: cx, y: surfaceY(cx) - STICKER_ABOVE }, spanHalf: half, accent: PALETTE.sandSh, priority: 1 });
    case 'spring':
      return propSticker({ key: r.id, text: r.label ?? COPY.stickers.spring, world: { x: cx, y: r.y - 16 - STICKER_ABOVE }, spanHalf: half, accent: PALETTE.spring, priority: 1 });
    case 'bumper':
      return propSticker({ key: r.id, text: r.label ?? COPY.stickers.bumper, world: { x: cx, y: r.y - 22 - STICKER_ABOVE }, spanHalf: half, accent: PALETTE.bump, priority: 1 });
    case 'fan':
      return propSticker({ key: r.id, text: r.label ?? COPY.stickers.fan, world: { x: cx, y: r.y + r.h + FAN_STICKER_BELOW_TOP }, spanHalf: half, accent: PALETTE.windAccent, priority: 1 });
    case 'colourGate':
      return propSticker({ key: r.id, text: gateOnlyWord(r.colour), world: { x: cx, y: r.y - 6 - STICKER_ABOVE }, spanHalf: Math.max(half, GATE_BADGE_HALF_W), accent: r.colour === 'red' ? PALETTE.p1 : PALETTE.p2, priority: 0 });
    case 'bridge':
      return propSticker({ key: r.id, text: `${r.label ?? COPY.stickers.bridge}${active ? COPY.stickers.on : COPY.stickers.off}`, world: { x: cx, y: r.y - STICKER_ABOVE }, spanHalf: half, accent: PALETTE.sw, priority: 0 });
    case 'blocker': {
      if (isPermanentBlocker(r)) return null;
      const id = r.switchIds !== undefined ? r.switchIds[0] : r.switchId;
      const index = id === undefined ? 0 : level.switches.findIndex((s) => s.id === id);
      const text = `${gateWord(r.label, index)}${active ? COPY.stickers.shut : COPY.stickers.open}`;
      return propSticker({ key: r.id, text, world: { x: cx, y: r.y + GATE_LAMP_DY }, spanHalf: half, side: -1, accent: PALETTE.sw, priority: 0 });
    }
  }
}

function stickerForSwitch(level: Level, state: SimState, sw: PressureSwitch, index: number): Sticker | null {
  if (!deckVisible(level, state, sw)) return null;
  const pressed = state.switches[sw.id] === true;
  const text = `${switchWord(sw.label, index)}${pressed ? COPY.stickers.on : COPY.stickers.off}`;
  const { cx, baseW } = switchGeometry(sw);
  return propSticker({ key: sw.id, text, world: { x: cx, y: sw.surfaceY - switchTop(sw) - STICKER_ABOVE }, spanHalf: baseW / 2, accent: PALETTE.sw, priority: 0 });
}

function gapBridged(level: Level, state: SimState, g: { x1: number; x2: number }): boolean {
  return level.rects.some((r) => r.kind === 'bridge' && r.x <= g.x1 && r.x + r.w >= g.x2 && isRectActive(r, state.switches));
}

/**
 * OUT OF BOUNDS · +1 centred in each gap at y 626 (two lines when the gap is narrower than the text + 24).
 * Not shown while a solid bridge spans the gap: the planks are the floor then and the label would be
 * painted through them.
 */
function pitStickers(ctx: CanvasRenderingContext2D, level: Level, state: SimState): Sticker[] {
  const w = measureSticker(ctx, COPY.stickers.pit, PIT_STICKER_PX).w;
  const list: Sticker[] = [];
  level.terrain.gaps.forEach((g, i) => {
    if (gapBridged(level, state, g)) return;
    const narrow = g.x2 - g.x1 < w + 24;
    list.push({
      key: `pit-${i}`,
      text: narrow ? COPY.stickers.pitLine1 : COPY.stickers.pit,
      world: { x: (g.x1 + g.x2) / 2, y: PIT_STICKER_Y },
      spanHalf: (g.x2 - g.x1) / 2,
      accent: PALETTE.bump,
      sizePx: PIT_STICKER_PX,
      alpha: PIT_STICKER_ALPHA,
      pit: true,
      priority: 0,
      ...(narrow ? { secondLine: COPY.stickers.pitLine2 } : {}),
    });
  });
  return list;
}

function collectStickers(ctx: CanvasRenderingContext2D, level: Level, state: SimState, view: ViewState): Sticker[] {
  const surfaceY = (x: number): number => fairwayYExtended(level, x) ?? level.hole.rimY;
  const list: Sticker[] = [];
  for (const r of level.rects) {
    const s = stickerForRect(level, state, r, surfaceY);
    if (s !== null) list.push(s);
  }
  level.switches.forEach((sw, i) => {
    const s = stickerForSwitch(level, state, sw, i);
    if (s !== null) list.push(s);
  });
  if (level.order === 1 && !view.gimmeSeen) {
    const world = { x: level.hole.x, y: level.hole.rimY + GIMME_ZONE_BELOW_RIM };
    list.push({ key: 'gimme-zone', text: COPY.stickers.gimmeZone, world, spanHalf: GIMME_RADIUS, hangBelow: true, accent: PALETTE.mint, sizePx: GIMME_ZONE_PX, alpha: 1, pit: false, priority: 2 });
  }
  return [...applyWindowCap(list), ...pitStickers(ctx, level, state)];
}

/** Would adding `x` put more than the cap into some 1280 px window of `kept` x positions? */
function exceedsWindow(kept: readonly number[], x: number): boolean {
  const xs = [...kept.filter((k) => Math.abs(k - x) < VIEWPORT_W), x].sort((a, b) => a - b);
  for (const start of xs) {
    const count = xs.filter((k) => k >= start && k <= start + VIEWPORT_W).length;
    if (count > STICKER_WINDOW_CAP) return true;
  }
  return false;
}

/** At most 6 stickers in any 1280 px window (pit stickers are exempt); low-priority labels drop first, then by x. */
function applyWindowCap(list: Sticker[]): Sticker[] {
  const byPriority = [...list].sort((a, b) => a.priority - b.priority || a.world.x - b.world.x);
  const kept: Sticker[] = [];
  for (const s of byPriority) {
    if (!exceedsWindow(kept.map((k) => k.world.x), s.world.x)) kept.push(s);
  }
  return kept.sort((a, b) => a.world.x - b.world.x);
}

/** Screen box, centre-based. */
type Box = { x: number; y: number; w: number; h: number };
type Placed = Box & { sticker: Sticker; rot: number; scale: number };

function overlapArea(a: Box, b: Box): number {
  const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
  const oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function pulseScale(view: ViewState, key: string, kind: 'sand' | 'gate'): number {
  const t = view.stickerPulse.get(key);
  const spec = kind === 'gate' ? PULSE_GATE : PULSE_SAND;
  if (t === undefined || t >= spec.dur) return 1;
  return 1 + (spec.scale - 1) * Math.sin((t / spec.dur) * Math.PI);
}

function labelScaleOf(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  const pixelScale = Math.sqrt(m.a * m.a + m.b * m.b);
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const stageScale = pixelScale / dpr;
  return stageScale < 0.6 ? Math.min(1.8, Math.max(1, 1 / stageScale)) : 1;
}

/** Centre x that keeps a box of width `w` fully on screen (with the edge margin). */
function clampToScreen(x: number, w: number): number {
  return Math.min(VIEWPORT_W - w / 2 - STICKER_EDGE_MARGIN, Math.max(w / 2 + STICKER_EDGE_MARGIN, x));
}

/** Centred labels stay over the VISIBLE part of their prop (a wide plate half off screen keeps its label on the visible half). */
function overVisibleSpan(x: number, w: number, visibleLeft: number, visibleRight: number): number {
  const lo = Math.max(w / 2 + STICKER_EDGE_MARGIN, visibleLeft);
  const hi = Math.min(VIEWPORT_W - w / 2 - STICKER_EDGE_MARGIN, visibleRight);
  return lo <= hi ? Math.min(hi, Math.max(lo, x)) : clampToScreen(x, w);
}

/** Golfers (with the raised club, turn marker and YOU tag) and the cup + flag + gimme ring: labels never cover them. */
function keepOutBoxes(view: ViewState, toScreen: (p: Vec) => Vec): Box[] {
  const zoom = view.camera.zoom;
  const boxes: Box[] = view.golfers.map((g) => {
    const feet = toScreen(g.pos);
    const h = GOLFER_BOX_ABOVE_FEET * zoom;
    return { x: feet.x, y: feet.y - h / 2, w: GOLFER_BOX_HALF_W * 2 * zoom, h };
  });
  const rim = toScreen({ x: view.level.hole.x, y: view.level.hole.rimY });
  const top = rim.y - CUP_BOX_ABOVE_RIM * zoom;
  const bottom = rim.y + CUP_BOX_BELOW_RIM * zoom;
  boxes.push({ x: rim.x, y: (top + bottom) / 2, w: GIMME_RADIUS * 2 * zoom, h: bottom - top });
  return boxes;
}

type Spot = { x: number; y: number; cost: number };

/**
 * Candidate centres for a label: rows stepped by its own height (+gap, so labelScale 1.8 still clears;
 * upward first, VISUAL §5.3), and on each row the label's own x plus the spots just clear of every box
 * it would hit there (the real overlap, not a fixed nudge). All inside the screen and the playfield band,
 * cheapest displacement first.
 */
function dodgeSpots(item: Box, blockers: readonly Box[]): Spot[] {
  const step = item.h + STICKER_STACK_GAP;
  const spots: Spot[] = [];
  for (let n = 0; n <= STICKER_STACK_TRIES; n += 1) {
    for (const dir of n === 0 ? [0] : [-1, 1]) {
      const y = item.y + dir * n * step;
      if (y - item.h / 2 < PLAYFIELD_TOP_Y || y + item.h / 2 > PLAYFIELD_BOTTOM_Y) continue;
      const xs = [item.x];
      for (const b of blockers) {
        if (Math.abs(b.y - y) >= (b.h + item.h) / 2) continue;
        const reach = (b.w + item.w) / 2 + STICKER_DODGE_GAP;
        xs.push(clampToScreen(b.x - reach, item.w), clampToScreen(b.x + reach, item.w));
      }
      for (const x of xs) spots.push({ x, y, cost: Math.abs(x - item.x) + Math.abs(y - item.y) });
    }
  }
  return spots.sort((a, b) => a.cost - b.cost);
}

/**
 * Moves a label to the nearest spot that clears every label placed before it, both golfers and the
 * cup; when nothing is free it takes the spot with the least overlap.
 */
function resolveLabel(item: Placed, blockers: readonly Box[]): void {
  let best: { x: number; y: number; overlap: number } | null = null;
  for (const spot of dodgeSpots(item, blockers)) {
    const box: Box = { x: spot.x, y: spot.y, w: item.w, h: item.h };
    const overlap = blockers.reduce((sum, b) => sum + overlapArea(box, b), 0);
    if (best === null || overlap < best.overlap) best = { x: spot.x, y: spot.y, overlap };
    if (overlap === 0) break;
  }
  if (best === null) return;
  item.x = best.x;
  item.y = best.y;
}

/**
 * Screen placement: cull labels whose prop is off screen, clamp the rest over the visible prop / inside
 * the viewport and above the HUD band, then move each one to the nearest spot clear of the labels placed
 * before it, the golfers and the cup. Pit stickers own their chasm: they are placed first and never move.
 */
function placeStickers(ctx: CanvasRenderingContext2D, stickers: Sticker[], view: ViewState, toScreen: (p: Vec) => Vec, labelScale: number): Placed[] {
  const placed: Placed[] = [];
  const keepOut = keepOutBoxes(view, toScreen);
  const zoom = view.camera.zoom;
  const order = stickers.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.pit) - Number(a.s.pit));
  for (const { s, i } of order) {
    const scale = pulseScale(view, s.key, s.key.startsWith('gate') || s.text.endsWith('ONLY') ? 'gate' : 'sand') * labelScale;
    const box = measureSticker(ctx, s.text, s.sizePx * scale, true);
    const p = toScreen(s.world);
    const spanHalf = s.spanHalf * zoom;
    const visibleLeft = Math.max(0, p.x - spanHalf);
    const visibleRight = Math.min(VIEWPORT_W, p.x + spanHalf);
    if (visibleRight - visibleLeft < Math.min(STICKER_MIN_VISIBLE_PX, spanHalf) || p.y < -box.h || p.y > VIEWPORT_H + box.h) continue;
    const rot = s.pit ? 4 : (i % 2 === 0 ? -1 : 1) * (2 + (i % 3));
    const h = box.h * (s.secondLine !== undefined ? 2 : 1);
    const x = s.side === undefined ? overVisibleSpan(p.x, box.w, visibleLeft, visibleRight) : clampToScreen(p.x + s.side * (spanHalf + GATE_STICKER_GAP + box.w / 2), box.w);
    const anchorY = s.hangBelow === true ? p.y + h / 2 : p.y;
    const item: Placed = { sticker: s, x, y: Math.min(anchorY, PLAYFIELD_BOTTOM_Y - h / 2), w: box.w, h, rot, scale };
    if (!s.pit) resolveLabel(item, [...placed, ...keepOut]);
    placed.push(item);
  }
  return placed;
}

function ballDims(item: Placed, view: ViewState, toScreen: (p: Vec) => Vec): boolean {
  if ((view.stickerPulse.get(item.sticker.key) ?? 1) < 0.4) return false;
  const r = BALL_RADIUS * view.camera.zoom;
  return view.renderBalls.some((rb) => {
    if (!rb.visible) return false;
    const b = toScreen(rb.pos);
    return Math.abs(b.x - item.x) < item.w / 2 + r && Math.abs(b.y - item.y) < item.h / 2 + r;
  });
}

function drawStickers(ctx: CanvasRenderingContext2D, scene: RenderScene, toScreen: (p: Vec) => Vec): void {
  const { state, view } = scene;
  const labelScale = labelScaleOf(ctx);
  const placed = placeStickers(ctx, collectStickers(ctx, view.level, state, view), view, toScreen, labelScale);
  for (const item of placed) {
    const alpha = ballDims(item, view, toScreen) ? STICKER_DIM_ALPHA : item.sticker.alpha;
    const size = item.sticker.sizePx * item.scale;
    const opts = { accent: item.sticker.accent, rotationDeg: item.rot, sizePx: size, alpha };
    if (item.sticker.secondLine === undefined) drawSticker(ctx, item.x, item.y, item.sticker.text, opts);
    else {
      const h = size + 12;
      drawSticker(ctx, item.x, item.y - h / 2 - 1, item.sticker.text, opts);
      drawSticker(ctx, item.x, item.y + h / 2 + 1, item.sticker.secondLine, opts);
    }
  }
}

// ---- tags ------------------------------------------------------------------------------------------

function drawTags(ctx: CanvasRenderingContext2D, scene: RenderScene, toScreen: (p: Vec) => Vec): void {
  const { state, view, seat } = scene;
  if (seat !== null) {
    const myTurn = state.phase === 'aiming' && state.activePlayer === seat;
    if (view.levelTime < YOU_TAG_SECONDS || myTurn) {
      const g = view.golfers[seat];
      const p = toScreen({ x: g.pos.x, y: g.pos.y - GOLFER_HEIGHT - 22 });
      drawTag(ctx, p.x, p.y, COPY.stickers.you, PALETTE[seat === 0 ? 'p1' : 'p2'], 12);
    }
  }
  const preview = view.aimPreview;
  if (preview !== null && preview.remote && state.phase === 'aiming') {
    const b = toScreen(view.renderBalls[preview.playerId].pos);
    drawTag(ctx, b.x, b.y - 40, partnerAimingTag(preview.playerId), PALETTE[preview.playerId === 0 ? 'p1' : 'p2'], 14);
  }
}

// ---- drag ring + CANCEL / AIM UPWARD (screen space, labelScale) ---------------------------------------

function drawDragLayer(ctx: CanvasRenderingContext2D, scene: RenderScene, toScreen: (p: Vec) => Vec): void {
  const { state, view } = scene;
  const preview = view.aimPreview;
  const drag = view.drag;
  if (!scene.showAim || preview === null || preview.remote || drag === null || state.phase !== 'aiming') return;
  const ball = toScreen(view.renderBalls[preview.playerId].pos);
  drawDragOverlay(ctx, ball, toScreen(drag.pointer), drag, labelScaleOf(ctx), fontReady);
}

// ---- frame -----------------------------------------------------------------------------------------

export function renderFrame(ctx: CanvasRenderingContext2D, scene: RenderScene): void {
  requestFonts();
  const { view } = scene;
  drawSky(ctx, view);
  drawWorld(ctx, scene);
  const shake = shakeOffset(view);
  const toScreen = (p: Vec): Vec => {
    const s = worldToScreen(view, p);
    return { x: s.x + shake.x, y: s.y + shake.y };
  };
  if (fontReady) {
    drawStickers(ctx, scene, toScreen);
    drawCallouts(ctx, view, toScreen);
    drawTags(ctx, scene, toScreen);
  }
  drawDragLayer(ctx, scene, toScreen);
  drawFlash(ctx, view.flash);
}
