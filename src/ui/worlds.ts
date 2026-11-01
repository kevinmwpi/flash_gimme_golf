// OWNER: ui
/**
 * World grouping for the hole pickers and the world results card (BUILD_DECISIONS D10.1, D10.2). The Title
 * tray and the lobby's START AT picker show one world's four holes behind a World 1/2/3 picker; hole
 * numbers stay global (Level.order); arrow keys walk every hole of the game, so stepping past a world's
 * last hole opens the next world; a finished world offers the next one. Pure functions over the level
 * registry, so the pickers, the card and the tests share one rule. Nothing is locked, nothing new is
 * stored and no URL parameter is read (D10.2).
 */
import { LEVELS, hasLevel, levelById, levelsOfWorld, nextWorld } from '../sim/levels/index';
import type { Level, WorldId } from '../sim/types';
import type { BestTable } from './storage';

/** The first of `levels` without a best (the tray's START HERE rule), else the first of them. */
function firstUnplayed(levels: readonly Level[], bests: BestTable): Level | undefined {
  return levels.find((l) => bests[l.id] === undefined) ?? levels[0];
}

/** The Title tray's default selection: the first hole with no best in the whole game, else hole 1. */
export function defaultHole(bests: BestTable): string {
  return firstUnplayed(LEVELS, bests)?.id ?? '';
}

/** Where picking world `world` lands the selection: its first hole without a best, else its first hole. */
export function worldStartHole(world: WorldId, bests: BestTable): string {
  return firstUnplayed(levelsOfWorld(world), bests)?.id ?? defaultHole(bests);
}

/** The hole `delta` steps from `levelId` over every hole of the game, wrapping at both ends (tray arrow keys). */
export function stepHole(levelId: string, delta: number): string {
  const index = LEVELS.findIndex((l) => l.id === levelId);
  const next = LEVELS[(((index + delta) % LEVELS.length) + LEVELS.length) % LEVELS.length];
  return next?.id ?? levelId;
}

/** The world a picker shows for a selected hole id; World 1 for an id this build does not know. */
export function worldOfHole(levelId: string): WorldId {
  return hasLevel(levelId) ? levelById(levelId).world : 1;
}

/** A world's first hole: where a lobby world pick and "Continue to World N" start. */
export function firstHoleOf(world: WorldId): string | null {
  return levelsOfWorld(world)[0]?.id ?? null;
}

/** "Continue to World N+1": the next world and the hole its campaign starts at, or null after the last world. */
export function continueTarget(world: WorldId): { world: WorldId; levelId: string } | null {
  const next = nextWorld(world);
  const levelId = next === null ? null : firstHoleOf(next);
  return next === null || levelId === null ? null : { world: next, levelId };
}
