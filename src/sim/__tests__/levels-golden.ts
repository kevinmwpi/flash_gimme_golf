// OWNER: levels
/**
 * Golden replays of the LEVELS.md intended line of every World 1 hole (ARCH.md §4 levels row), recorded by
 * scripts/solver.ts (replayScripted, 16 x 8 grid, first grid shot per beat) against the real sim. Each
 * entry is keyed by campaign order, never by level id. A differing snapshot means the physics, the level
 * geometry or the engine changed; re-record with the solver (README "Verification recipe").
 *
 * Recorded with ROLL_DAMP 0.996 + ROLL_FRICTION 60 after the round-2 fixes: a plate is held only by a RESTING ball
 * (one switchOn per landing, on its ballRest tick), a lip-out fires once on the tick the ball leaves the 12 px
 * window (never followed by a sink), the L1 shelf 580-810 + bunker 800-1010 and the back bunkers behind every
 * cup (levels README "Deviations from LEVELS.md numbers").
 */
import type { ReplayEntry, SimConfig } from '../types';

export type GoldenLine = {
  readonly order: number;
  readonly name: string;
  /** Strokes per player at levelResults. */
  readonly strokes: readonly [number, number];
  /** The tick the incremental game reached levelResults (runReplay(config, log, finalTick)). */
  readonly finalTick: number;
  /** JSON.stringify(encodeSnapshot(state)) of the final state. */
  readonly snapshot: string;
  readonly log: readonly ReplayEntry[];
};

/** The solver's game config for a single-level campaign (seed 1, local). */
export function goldenConfig(levelId: string): SimConfig {
  return { playerCount: 2, levelIds: [levelId], seed: 1, mode: 'local' };
}

export const GOLDEN_LINES: readonly GoldenLine[] = [
  {
    order: 1,
    name: 'First Fairway',
    strokes: [2, 2],
    finalTick: 624,
    snapshot: '[1,624,3,0,1,0,[[2,-0.3187,94.4],[2,-0.1262,94.4]],[[1190,572,0,0,3,0,859.93,577.95],[1190,572,0,0,3,0,771.64,543.95]],0,1,[[2,2]]]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 83.1 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 196, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 196, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 447, cmd: { type: 'setAim', playerId: 0, angle: -0.3187, power: 94.4 } },
      { tick: 447, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 541, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 94.4 } },
      { tick: 541, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
  {
    order: 2,
    name: 'Two Doors',
    strokes: [4, 2],
    finalTick: 1264,
    snapshot: '[1,1264,3,0,0,0,[[4,-0.1262,71.9],[2,-0.1262,71.9]],[[1680,610,0,0,7,6,1648.31,587.95],[1680,610,0,0,7,0,1177.76,627.92]],2,1,[[4,2]]]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 349, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 349, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 702, cmd: { type: 'setAim', playerId: 0, angle: -0.8962, power: 83.1 } },
      { tick: 702, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 969, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 969, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1099, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 71.9 } },
      { tick: 1099, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
  {
    order: 3,
    name: 'Colour Keys',
    strokes: [3, 4],
    finalTick: 1566,
    snapshot: '[1,1566,3,0,1,0,[[3,-0.1262,71.9],[4,-0.1262,60.6]],[[1740,606,0,0,7,0,1271.66,627.68],[1740,606,0,0,7,0,1496.19,627.95]],2,1,[[3,4]]]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 1, angle: -0.8962, power: 83.1 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 357, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 357, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 665, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 49.4 } },
      { tick: 665, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 806, cmd: { type: 'setAim', playerId: 0, angle: -0.7037, power: 94.4 } },
      { tick: 806, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1176, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 26.9 } },
      { tick: 1176, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1396, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 71.9 } },
      { tick: 1396, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1511, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 60.6 } },
      { tick: 1511, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
  {
    order: 4,
    name: 'Plate & Bridge',
    strokes: [4, 3],
    finalTick: 1450,
    snapshot: '[1,1450,3,0,0,0,[[4,-0.1262,71.9],[3,-0.1262,71.9]],[[1860,594,0,0,7,0,1364.14,615.95],[1860,594,0,0,7,0,1380.07,615.95]],2,1,[[4,3]]]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 38.1 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 226, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 49.4 } },
      { tick: 226, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 391, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 49.4 } },
      { tick: 391, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 589, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 60.6 } },
      { tick: 589, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 904, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 49.4 } },
      { tick: 904, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1192, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 1192, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1329, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 71.9 } },
      { tick: 1329, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
];
