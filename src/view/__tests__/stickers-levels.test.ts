// OWNER: view
// BUILD_DECISIONS D10.8 on the real holes 5-12: at every follow-camera position (every 20 px across the hole),
// with no plate held and with every plate held, every device, door / window, plate, spring and colour field
// on screen keeps its label, no more than 6 labels are DRAWN on screen (VISUAL §5.6: a wide prop half off
// screen lends its label to its visible part, and that label counts too), the labels stay inside the
// playfield band, funnel sand carries none, and a seat plate draws one combined label. On a phone (every hole)
// the band shrinks with the HUD scale, at the bottom as at the top, pit stickers included (VISUAL §11); with
// Fredoka-sized labels no label covers a colour field's badge and every door / window label stays beside its
// door, never down in the dirt under it (L8 with blue on the WINDOW plate, red's window lob).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../../sim/levels/index';
import { level as colourLift } from '../../sim/levels/w2-08-colour-lift';
import { evaluateSwitches } from '../../sim/physics';
import { createSim } from '../../sim/sim';
import { isRectActive } from '../../sim/terrain';
import type { BallState, Level, PlayerId, SimState } from '../../sim/types';
import { BALL_RADIUS, REST_TICKS, VIEWPORT_H, VIEWPORT_W } from '../../sim/types';
import { seatOf } from '../render/devices';
import { layoutStickers, renderFrame, type StickerLayoutItem } from '../render/index';
import { isPermanentBlocker, switchGeometry } from '../render/mechanics';
import { fairwayYAt } from '../render/surface';
import { invalidateTextCache } from '../render/text';
import { cameraFor, createViewState, worldToScreen, type ViewState } from '../view';

/** Same density cap and playfield band the renderer enforces (VISUAL §5.6, §11). */
const CAP = 6;
const PLAYFIELD_TOP_Y = 68;
const PLAYFIELD_BOTTOM_Y = 652;
const STEP_PX = 20;
/** A phone: stage scale 0.5, so the HUD clusters scale by 1.7 and each HUD band is 12 + 48 x 1.7 + 8 px tall (UX §4.1). */
const PHONE_STAGE_SCALE = 0.5;
const PHONE_BAND = 12 + 48 * 1.7 + 8;

/** Recording-free 2D context at a stage scale: text measures 8 px per character at any size; nothing is drawn. */
function measuringCtx(stageScale = 1): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop in props) return props[prop];
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 8 });
        if (prop === 'getTransform') return () => ({ a: stageScale, b: 0, c: 0, d: stageScale, e: 0, f: 0 });
        return () => undefined;
      },
      set(_t, prop, value) {
        props[prop] = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

/** A prop that must keep its label, and the world x-range it occupies. */
type Labelled = { key: string; x1: number; x2: number };

/** Every device (a seat trap through its plate's combined label), switched door / window, spring, colour field and plate. */
function mustLabel(level: Level, state: SimState): Labelled[] {
  const out: Labelled[] = [];
  for (const r of level.rects) {
    const switched = r.switchId !== undefined || r.switchIds !== undefined;
    if (r.kind === 'trap') {
      const seat = seatOf(level, r);
      out.push({ key: seat === null ? `rect:${r.id}` : `switch:${seat.id}`, x1: r.x, x2: r.x + r.w });
    } else if (r.kind === 'cannon' || r.kind === 'spring' || r.kind === 'colourGate' || (r.kind === 'blocker' && switched)) {
      out.push({ key: `rect:${r.id}`, x1: r.x, x2: r.x + r.w });
    }
  }
  for (const sw of level.switches) {
    const deck = sw.onRectId === undefined ? null : level.rects.find((r) => r.id === sw.onRectId);
    if (deck !== null && (deck === undefined || !isRectActive(deck, state.switches))) continue;
    const { cx, baseW } = switchGeometry(sw);
    out.push({ key: `switch:${sw.id}`, x1: cx - baseW / 2, x2: cx + baseW / 2 });
  }
  return out;
}

function playing(level: Level, held: boolean): SimState {
  const state: SimState = { ...createSim({ playerCount: 2, levelIds: [level.id], seed: 1, mode: 'local' }).state, phase: 'aiming' };
  return held ? { ...state, switches: Object.fromEntries(level.switches.map((s) => [s.id, true])) } : state;
}

function layoutAt(level: Level, state: SimState, camX: number, stageScale = 1): StickerLayoutItem[] {
  const view = createViewState(level, state);
  view.camera = { x: camX, y: 0, zoom: 1 };
  return layoutStickers(measuringCtx(stageScale), state, view);
}

function labelsAt(level: Level, state: SimState, camX: number): StickerLayoutItem[] {
  return layoutAt(level, state, camX).filter((s) => !s.key.startsWith('pit:'));
}

// ---- Fredoka-sized labels, drawn badges ----------------------------------------------------------------

/** 844 x 390: the stage is 390 px tall, so labels scale 1.8x and the HUD bands 1.66x. */
const PHONE_844 = 390 / 720;
/** Fredoka 700's mean advance on these all-caps labels (the real layout measures 0.45-0.63 em per character). */
const FREDOKA_EM = 0.56;
/** A door / window label hangs beside the door's top post: its box stays this close to the door's box. */
const DOOR_LABEL_NEAR_PX = 60;
/** A colour field's badge paper is a 76 x 28 world px roundRect (VISUAL §4), its ink shadow the same 3 px lower. */
const BADGE_W = 76;
const BADGE_H = 28;

type Matrix = readonly [number, number, number, number, number, number];
type ScreenBox = { x1: number; y1: number; x2: number; y2: number };

function mul(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

/**
 * A context at a stage scale whose text measures like Fredoka 700 (FREDOKA_EM per character at the font's size),
 * recording where each colour-field badge roundRect (paper and shadow) lands on the stage under the transform in force.
 */
function fredokaCtx(stageScale: number): { ctx: CanvasRenderingContext2D; badges: ScreenBox[] } {
  const props: Record<string | symbol, unknown> = { font: '' };
  const badges: ScreenBox[] = [];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const at = (x: number, y: number): { x: number; y: number } => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const fontPx = (): number => Number(/([\d.]+)px/.exec(String(props.font))?.[1] ?? 0);
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop in props) return props[prop];
      switch (prop) {
        case 'measureText':
          return (text: string) => ({ width: text.length * FREDOKA_EM * fontPx() });
        case 'getTransform':
          return () => ({ a: stageScale, b: 0, c: 0, d: stageScale, e: 0, f: 0 });
        case 'createLinearGradient':
          return () => ({ addColorStop: () => undefined });
        case 'save':
          return () => void stack.push(m);
        case 'restore':
          return () => void (m = stack.pop() ?? m);
        case 'translate':
          return (x: number, y: number) => void (m = mul(m, [1, 0, 0, 1, x, y]));
        case 'scale':
          return (x: number, y: number) => void (m = mul(m, [x, 0, 0, y, 0, 0]));
        case 'rotate':
          return (a: number) => void (m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]));
        case 'roundRect':
          return (x: number, y: number, w: number, h: number) => {
            if (w !== BADGE_W || h !== BADGE_H) return;
            const a = at(x, y);
            const c = at(x + w, y + h);
            badges.push({ x1: a.x, y1: a.y, x2: c.x, y2: c.y });
          };
        default:
          return () => undefined;
      }
    },
    set(_t, prop, value) {
      props[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as CanvasRenderingContext2D, badges };
}

const boxOf = (p: StickerLayoutItem): ScreenBox => ({ x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 });
const overlaps = (a: ScreenBox, b: ScreenBox): boolean => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5;
const gapBetween = (a: ScreenBox, b: ScreenBox): number => Math.hypot(Math.max(0, b.x1 - a.x2, a.x1 - b.x2), Math.max(0, b.y1 - a.y2, a.y1 - b.y2));

/**
 * One frame with Fredoka-sized labels: no label covers a colour field's badge as the frame draws it, and every
 * door / window label stays within DOOR_LABEL_NEAR_PX of its door and never below its foot (or the ground it is
 * sunk into), where it would read as the label of the dirt or the plate under it. Returns the layout.
 */
function checkFrame(level: Level, state: SimState, view: ViewState, stageScale: number, where: string): StickerLayoutItem[] {
  const drawn = fredokaCtx(stageScale);
  renderFrame(drawn.ctx, { state, view, seat: null, device: 'touch', showAim: false });
  const placed = layoutStickers(fredokaCtx(stageScale).ctx, state, view).filter((p) => !p.key.startsWith('pit:'));
  expect(drawn.badges.length, `${where}: badges drawn`).toBe(2 * level.rects.filter((r) => r.kind === 'colourGate').length);
  for (const p of placed) {
    for (const badge of drawn.badges) expect(overlaps(boxOf(p), badge), `${where}: ${p.text} over a badge`).toBe(false);
  }
  for (const door of level.rects.filter((r) => r.kind === 'blocker' && !isPermanentBlocker(r))) {
    const label = placed.find((p) => p.key === `rect:${door.id}`);
    if (label === undefined) continue;
    const top = worldToScreen(view, { x: door.x, y: door.y });
    const foot = Math.min(door.y + door.h, fairwayYAt(level, door.x + door.w / 2) ?? door.y + door.h);
    const bottom = worldToScreen(view, { x: door.x + door.w, y: foot });
    const box = boxOf(label);
    expect(box.y2, `${where}: ${label.text} down in the dirt`).toBeLessThanOrEqual(bottom.y + 0.5);
    const doorBox = { x1: Math.max(0, top.x), y1: top.y, x2: Math.min(VIEWPORT_W, bottom.x), y2: bottom.y };
    expect(gapBetween(box, doorBox), `${where}: ${label.text} away from its door`).toBeLessThanOrEqual(DOOR_LABEL_NEAR_PX);
  }
  return placed;
}

const WORLDS_2_3 = LEVELS.filter((l) => l.world > 1);

describe('stickers on holes 5-12 (D10.8)', () => {
  it('covers the eight World 2-3 holes', () => {
    expect(WORLDS_2_3.map((l) => l.order)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  for (const level of WORLDS_2_3) {
    it(`${level.id}: every device, door, plate, spring and colour field on screen keeps its label at every follow position`, () => {
      for (const held of [false, true]) {
        const state = playing(level, held);
        const labelled = mustLabel(level, state);
        for (let camX = 0; camX <= level.width - VIEWPORT_W; camX += STEP_PX) {
          const placed = labelsAt(level, state, camX);
          const where = `${held ? 'held' : 'free'} camX ${camX}`;
          for (const prop of labelled) {
            if (prop.x1 < camX || prop.x2 > camX + VIEWPORT_W) continue;
            expect(placed.map((p) => p.key), `${prop.key} ${where}`).toContain(prop.key);
          }
          const drawn = placed.filter((p) => p.x + p.w / 2 > 0 && p.x - p.w / 2 < VIEWPORT_W);
          expect(drawn.length, `${where}: ${drawn.map((p) => p.text).join(' | ')}`).toBeLessThanOrEqual(CAP);
          for (const p of placed) {
            expect(p.y - p.h / 2, `${p.key} ${where}`).toBeGreaterThanOrEqual(PLAYFIELD_TOP_Y);
            expect(p.y + p.h / 2, `${p.key} ${where}`).toBeLessThanOrEqual(PLAYFIELD_BOTTOM_Y);
          }
        }
      }
    });
  }

  it('sand on either side of a cannon breech (its funnel) carries no SAND label', () => {
    const checked: string[] = [];
    for (const level of WORLDS_2_3) {
      for (const cannon of level.rects.filter((r) => r.kind === 'cannon')) {
        const funnel = level.rects.filter((r) => r.kind === 'sand' && r.x <= cannon.x + cannon.w + 2 && r.x + r.w >= cannon.x - 2);
        const camX = Math.min(level.width - VIEWPORT_W, Math.max(0, cannon.x - VIEWPORT_W / 2));
        const keys = labelsAt(level, playing(level, false), camX).map((p) => p.key);
        expect(keys, level.id).toContain(`rect:${cannon.id}`);
        for (const sand of funnel) {
          expect(keys, `${level.id} ${sand.id}`).not.toContain(`rect:${sand.id}`);
          checked.push(`${level.order}:${sand.id}`);
        }
      }
    }
    expect(checked).toEqual(['7:funnel-l', '7:funnel-r', '11:pit-l', '11:pit-r', '12:funnel-l', '12:funnel-r']);
  });

  it('a plate inside a trap draws one combined seat label (BAIT · TRAP, DOOR · TRAP) instead of a plate and a trap label', () => {
    const seats: string[] = [];
    for (const level of WORLDS_2_3) {
      for (const trap of level.rects.filter((r) => r.kind === 'trap')) {
        const seat = seatOf(level, trap);
        if (seat === null) continue;
        const camX = Math.min(level.width - VIEWPORT_W, Math.max(0, trap.x - VIEWPORT_W / 2));
        for (const held of [false, true]) {
          const placed = labelsAt(level, playing(level, held), camX);
          const seatLabel = placed.filter((p) => p.key === `switch:${seat.id}`);
          expect(seatLabel.map((p) => p.text)).toEqual([`${seat.label} · TRAP`]);
          expect(placed.some((p) => p.key === `rect:${trap.id}`)).toBe(false);
          if (!held) seats.push(seatLabel[0]?.text ?? '');
        }
      }
    }
    expect(seats).toEqual(['BAIT · TRAP', 'DOOR · TRAP']);
  });
});

describe('stickers on a phone (VISUAL §11, UX §4.1)', () => {
  it('every label, pit stickers included, stays between the HUD-scaled bands at every follow position of every hole', () => {
    for (const level of LEVELS) {
      for (const held of [false, true]) {
        const state = playing(level, held);
        for (let camX = 0; camX <= level.width - VIEWPORT_W; camX += STEP_PX) {
          for (const p of layoutAt(level, state, camX, PHONE_STAGE_SCALE)) {
            const where = `${level.id} ${p.key} ${held ? 'held' : 'free'} camX ${camX}`;
            expect(p.y - p.h / 2, where).toBeGreaterThanOrEqual(PHONE_BAND);
            expect(p.y + p.h / 2, where).toBeLessThanOrEqual(VIEWPORT_H - PHONE_BAND);
          }
        }
      }
    }
  });

  describe('with Fredoka-sized labels: badges stay clear, door labels stay beside their door', () => {
    beforeEach(() => invalidateTextCache());
    afterEach(() => invalidateTextCache());

    /** L8 with both balls resting where given (the sim presses the plates) and `active` to shoot. */
    const colourLiftAt = (redAt: number, blueAt: number, active: PlayerId): SimState => {
      const start = playing(colourLift, false);
      const ball = (x: number): BallState => {
        const pos = { x, y: (fairwayYAt(colourLift, x) ?? 0) - BALL_RADIUS };
        return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos };
      };
      const balls: [BallState, BallState] = [ball(redAt), ball(blueAt)];
      return { ...start, activePlayer: active, balls, switches: evaluateSwitches(colourLift, start.switches, balls) };
    };

    it('L8 with blue on the WINDOW plate: DOOR · SHUT stays by its door, never in the dirt, and nothing covers the red field badge (844 x 390, 0.5, 1280)', () => {
      const cases = [
        { redAt: 80, blueAt: 1100, active: 0, what: "red's window lob from the tee" },
        { redAt: 1138.89, blueAt: 1100, active: 0, what: 'red at the red field' },
        { redAt: 1312, blueAt: 1060, active: 1, what: 'red short of the DOOR bowl, blue to shoot' },
      ] as const;
      for (const c of cases) {
        const state = colourLiftAt(c.redAt, c.blueAt, c.active);
        expect(state.switches, c.what).toEqual({ window: true, door: false });
        for (const stageScale of [PHONE_844, PHONE_STAGE_SCALE, 1]) {
          const view = createViewState(colourLift, state);
          view.camera = { ...cameraFor(colourLift, state, 'follow') };
          const placed = checkFrame(colourLift, state, view, stageScale, `${c.what}, stage scale ${stageScale.toFixed(2)}`);
          expect(placed.map((p) => p.text)).toContain('DOOR · SHUT');
        }
      }
    });

    it('at every follow position of every hole, free and held (844 x 390)', () => {
      for (const level of LEVELS) {
        for (const held of [false, true]) {
          const state = playing(level, held);
          for (let camX = 0; camX <= level.width - VIEWPORT_W; camX += STEP_PX) {
            const view = createViewState(level, state);
            view.camera = { x: camX, y: 0, zoom: 1 };
            checkFrame(level, state, view, PHONE_844, `${level.id} ${held ? 'held' : 'free'} camX ${camX}`);
          }
        }
      }
    });
  });
});
