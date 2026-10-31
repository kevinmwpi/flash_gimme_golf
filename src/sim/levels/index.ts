// OWNER: levels
/**
 * Level registry (ARCH.md §1.7, BUILD_DECISIONS D10.1/D10.2): the twelve holes in campaign order, three
 * worlds of four. `Level.order` is the hole number over the whole game (1-12). A campaign never crosses
 * a world: `campaignFrom` runs from a hole to the last hole of ITS world, and `nextWorld` names the
 * world a finished campaign can continue into. Level-id literals exist only inside src/sim/levels/;
 * everything else goes through LEVELS / WORLD_IDS / levelsOfWorld / campaignFrom.
 */
import type { Level, WorldId } from '../types';
import { level as firstFairway } from './w1-01-first-fairway';
import { level as twoDoors } from './w1-02-two-doors';
import { level as colourKeys } from './w1-03-colour-keys';
import { level as plateAndBridge } from './w1-04-plate-and-bridge';
import { level as springStep } from './w2-05-spring-step';
import { level as boobyTrap } from './w2-06-booby-trap';
import { level as loadAndFire } from './w2-07-load-and-fire';
import { level as colourLift } from './w2-08-colour-lift';
import { level as bait } from './w3-09-bait';
import { level as skyBridge } from './w3-10-sky-bridge';
import { level as crossfire } from './w3-11-crossfire';
import { level as grandMachine } from './w3-12-grand-machine';

export const LEVELS: readonly Level[] = Object.freeze([
  firstFairway,
  twoDoors,
  colourKeys,
  plateAndBridge,
  springStep,
  boobyTrap,
  loadAndFire,
  colourLift,
  bait,
  skyBridge,
  crossfire,
  grandMachine,
]);

/** Every world, in play order. */
export const WORLDS: readonly WorldId[] = Object.freeze([1, 2, 3] as const);

function levelsIn(world: WorldId): readonly Level[] {
  return Object.freeze(LEVELS.filter((l) => l.world === world));
}

const LEVELS_BY_WORLD: Readonly<Record<WorldId, readonly Level[]>> = Object.freeze({ 1: levelsIn(1), 2: levelsIn(2), 3: levelsIn(3) });

/** Each world's hole ids in campaign order. */
export const WORLD_IDS: Readonly<Record<WorldId, readonly string[]>> = Object.freeze({
  1: Object.freeze(LEVELS_BY_WORLD[1].map((l) => l.id)),
  2: Object.freeze(LEVELS_BY_WORLD[2].map((l) => l.id)),
  3: Object.freeze(LEVELS_BY_WORLD[3].map((l) => l.id)),
});

/** World 1's hole ids (the lobby's default campaign starts at its first hole). */
export const WORLD1_IDS: readonly string[] = WORLD_IDS[1];

const BY_ID: ReadonlyMap<string, Level> = new Map(LEVELS.map((l) => [l.id, l] as const));

export function levelById(id: string): Level {
  const level = BY_ID.get(id);
  if (level === undefined) throw new Error(`unknown level id: ${id}`);
  return level;
}

export function hasLevel(id: string): boolean {
  return BY_ID.has(id);
}

/** The world a hole belongs to; throws on unknown id. */
export function worldOf(levelId: string): WorldId {
  return levelById(levelId).world;
}

/** A world's holes in campaign order. */
export function levelsOfWorld(world: WorldId): readonly Level[] {
  return LEVELS_BY_WORLD[world];
}

/** The world after `world`, or null after the last one. */
export function nextWorld(world: WorldId): WorldId | null {
  return WORLDS[WORLDS.indexOf(world) + 1] ?? null;
}

export function coursePar(levelIds: readonly string[]): number {
  let total = 0;
  for (const id of levelIds) total += levelById(id).par;
  return total;
}

/** From `levelId` to the last hole of its world (D10.2: one world per session); throws on unknown id. */
export function campaignFrom(levelId: string): readonly string[] {
  const ids = WORLD_IDS[worldOf(levelId)];
  return ids.slice(ids.indexOf(levelId));
}

export function worldTitle(world: WorldId): string {
  switch (world) {
    case 1:
      return 'World 1 — Teach';
    case 2:
      return 'World 2 — Lift & Lock';
    case 3:
      return 'World 3 — Sky Machines';
  }
}
