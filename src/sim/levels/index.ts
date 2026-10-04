// OWNER: levels
/**
 * Level registry (ARCH.md §1.7): World 1 "Teach" in campaign order. Level-id literals exist
 * only inside src/sim/levels/; everything else goes through LEVELS / WORLD1_IDS / campaignFrom.
 */
import type { Level, WorldId } from '../types';
import { level as firstFairway } from './w1-01-first-fairway';
import { level as twoDoors } from './w1-02-two-doors';
import { level as colourKeys } from './w1-03-colour-keys';
import { level as plateAndBridge } from './w1-04-plate-and-bridge';

export const LEVELS: readonly Level[] = Object.freeze([firstFairway, twoDoors, colourKeys, plateAndBridge]);

export const WORLD1_IDS: readonly string[] = Object.freeze(LEVELS.map((l) => l.id));

const BY_ID: ReadonlyMap<string, Level> = new Map(LEVELS.map((l) => [l.id, l] as const));

export function levelById(id: string): Level {
  const level = BY_ID.get(id);
  if (level === undefined) throw new Error(`unknown level id: ${id}`);
  return level;
}

export function hasLevel(id: string): boolean {
  return BY_ID.has(id);
}

export function coursePar(levelIds: readonly string[]): number {
  let total = 0;
  for (const id of levelIds) total += levelById(id).par;
  return total;
}

/** WORLD1_IDS from `levelId` to the end; throws on unknown id. */
export function campaignFrom(levelId: string): readonly string[] {
  const index = WORLD1_IDS.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level id: ${levelId}`);
  return WORLD1_IDS.slice(index);
}

export function worldTitle(world: WorldId): string {
  switch (world) {
    case 1:
      return 'World 1 — Teach';
  }
}
