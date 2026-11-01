// OWNER: view
// BUILD_DECISIONS D10.8 on the real holes 5-12: at every follow-camera position (every 40 px across the hole),
// with no plate held and with every plate held, every device, door / window, plate, spring and colour field
// on screen keeps its label under the 6-per-1280 px density cap, the labels stay inside the playfield band,
// funnel sand carries none, and a seat plate draws one combined label.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../sim/levels/index';
import { createSim } from '../../sim/sim';
import { isRectActive } from '../../sim/terrain';
import type { Level, SimState } from '../../sim/types';
import { VIEWPORT_W } from '../../sim/types';
import { seatOf } from '../render/devices';
import { layoutStickers, type StickerLayoutItem } from '../render/index';
import { switchGeometry } from '../render/mechanics';
import { createViewState } from '../view';

/** Same density cap and playfield band the renderer enforces (VISUAL §5.6, §11). */
const CAP = 6;
const PLAYFIELD_TOP_Y = 68;
const PLAYFIELD_BOTTOM_Y = 652;
const STEP_PX = 40;

/** Recording-free 2D context: text measures 8 px per character at any size; nothing is drawn. */
function measuringCtx(): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop in props) return props[prop];
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 8 });
        if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
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

function layoutAt(level: Level, state: SimState, camX: number): StickerLayoutItem[] {
  const view = createViewState(level, state);
  view.camera = { x: camX, y: 0, zoom: 1 };
  return layoutStickers(measuringCtx(), state, view).filter((s) => !s.key.startsWith('pit:'));
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
          const placed = layoutAt(level, state, camX);
          const where = `${held ? 'held' : 'free'} camX ${camX}`;
          for (const prop of labelled) {
            if (prop.x1 < camX || prop.x2 > camX + VIEWPORT_W) continue;
            expect(placed.map((p) => p.key), `${prop.key} ${where}`).toContain(prop.key);
          }
          const anchored = placed.filter((p) => p.anchorX >= camX && p.anchorX <= camX + VIEWPORT_W);
          expect(anchored.length, where).toBeLessThanOrEqual(CAP);
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
        const keys = layoutAt(level, playing(level, false), camX).map((p) => p.key);
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
          const placed = layoutAt(level, playing(level, held), camX);
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
