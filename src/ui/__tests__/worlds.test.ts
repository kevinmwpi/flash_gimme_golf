// OWNER: ui
// BUILD_DECISIONS D10.1/D10.2: the hole pickers show one world at a time with global hole numbers, arrow keys walk
// every hole of the game, the default selection is still the first hole without a best, and a finished world
// continues into the next one. No locks: every hole is pickable whatever the bests say.
import { describe, expect, it } from 'vitest';
import { LEVELS, WORLDS, levelsOfWorld } from '../../sim/levels/index';
import type { Level, WorldId } from '../../sim/types';
import type { BestTable } from '../storage';
import { continueTarget, defaultHole, firstHoleOf, stepHole, worldOfHole, worldStartHole } from '../worlds';

function holes(world: WorldId): readonly Level[] {
  return levelsOfWorld(world);
}

function idOf(level: Level | undefined): string {
  if (level === undefined) throw new Error('missing hole');
  return level.id;
}

/** A best on every hole of `levels`. */
function played(levels: readonly Level[]): BestTable {
  return Object.fromEntries(levels.map((l) => [l.id, { teamStrokes: l.par, medal: 'silver', at: 1 }]));
}

describe('world grouping (tray and lobby pickers)', () => {
  it('three worlds of four holes, numbered 1-12 across the game', () => {
    expect(WORLDS).toEqual([1, 2, 3]);
    for (const w of WORLDS) expect(holes(w).map((l) => l.order)).toEqual([1, 2, 3, 4].map((i) => (w - 1) * 4 + i));
  });

  it('defaultHole is the first hole without a best in the whole game, else hole 1 (unchanged)', () => {
    expect(defaultHole({})).toBe(idOf(LEVELS[0]));
    // A pair that finished World 1 opens on hole 5, so the tray shows World 2.
    expect(defaultHole(played(holes(1)))).toBe(idOf(holes(2)[0]));
    // A skipped hole comes first, wherever it is.
    expect(defaultHole(played(LEVELS.filter((l) => l.order !== 3)))).toBe(idOf(LEVELS[2]));
    expect(defaultHole(played(LEVELS))).toBe(idOf(LEVELS[0]));
  });

  it("worldStartHole selects a world's first hole without a best, else its first hole", () => {
    expect(worldStartHole(3, {})).toBe(idOf(holes(3)[0]));
    expect(worldStartHole(2, played(holes(2).slice(0, 2)))).toBe(idOf(holes(2)[2]));
    expect(worldStartHole(2, played(holes(2)))).toBe(idOf(holes(2)[0]));
    // Bests elsewhere never move it.
    expect(worldStartHole(3, played(holes(1)))).toBe(idOf(holes(3)[0]));
  });

  it("stepHole walks every hole of the game and wraps: past a world's last hole is the next world's first", () => {
    expect(stepHole(idOf(holes(1)[3]), 1)).toBe(idOf(holes(2)[0]));
    expect(stepHole(idOf(holes(2)[0]), -1)).toBe(idOf(holes(1)[3]));
    expect(stepHole(idOf(holes(3)[3]), 1)).toBe(idOf(holes(1)[0]));
    expect(stepHole(idOf(holes(1)[0]), -1)).toBe(idOf(holes(3)[3]));
    let id = idOf(LEVELS[0]);
    const seen: number[] = [];
    for (let i = 0; i < LEVELS.length; i += 1) {
      seen.push(LEVELS.findIndex((l) => l.id === id) + 1);
      id = stepHole(id, 1);
    }
    expect(seen).toEqual(LEVELS.map((l) => l.order));
    expect(id).toBe(idOf(LEVELS[0]));
  });

  it('worldOfHole follows the selection and reads World 1 for an id this build does not know', () => {
    for (const level of LEVELS) expect(worldOfHole(level.id)).toBe(level.world);
    expect(worldOfHole('')).toBe(1);
    expect(worldOfHole('no-such-hole')).toBe(1);
  });

  it("firstHoleOf is a world's first hole (lobby world pick, Continue)", () => {
    for (const w of WORLDS) expect(firstHoleOf(w)).toBe(idOf(holes(w)[0]));
  });

  it('continueTarget: World 1 continues at hole 5, World 2 at hole 9, World 3 is the last', () => {
    expect(continueTarget(1)).toEqual({ world: 2, levelId: idOf(holes(2)[0]) });
    expect(continueTarget(2)).toEqual({ world: 3, levelId: idOf(holes(3)[0]) });
    expect(continueTarget(3)).toBeNull();
  });
});
