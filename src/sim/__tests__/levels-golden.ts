// OWNER: levels
/**
 * Golden replays of every hole's golden intended line (ARCH.md §4 levels row): the line marked `golden` in
 * scripts/solver/lines.ts SCRIPTED_LINES, replayed by `recordGolden` (replayScripted on the 16 x 8 grid, the
 * first grid shot per beat) against the real sim. Entries are keyed by level id (BUILD_DECISIONS D10.1); the
 * hole number `order` is read from the registry, never stored. A differing snapshot means the physics, the
 * level geometry or the engine changed: re-record with `npm run solve -- all --write-goldens` (it rewrites the
 * generated block below and nothing else), and the slow suite (`npm run test:levels`) checks every entry is
 * exactly what the recipe records.
 *
 * World 1 was recorded with ROLL_DAMP 0.996 + ROLL_FRICTION 60 after the round-2 fixes: a plate is held only by
 * a RESTING ball (one switchOn per landing, on its ballRest tick), a lip-out fires once on the tick the ball
 * leaves the 12 px window (never followed by a sink), the L1 shelf 580-810 + bunker 800-1010 and the back
 * bunkers behind every cup (levels README "Deviations from LEVELS.md numbers"). Snapshot version 2 (worlds 2-3)
 * appended flightTicks; every tick of the World 1 lines was proved identical to the version-1 sim before their
 * strings were re-recorded.
 */
import { levelById } from '../levels/index';
import type { ReplayEntry, SimConfig } from '../types';

/** One golden line as the solver records it. */
export type RecordedGolden = {
  readonly levelId: string;
  readonly name: string;
  /** Strokes per player at levelResults. */
  readonly strokes: readonly [number, number];
  /** The tick the incremental game reached levelResults (runReplay(config, log, finalTick)). */
  readonly finalTick: number;
  /** JSON.stringify(encodeSnapshot(state)) of the final state. */
  readonly snapshot: string;
  readonly log: readonly ReplayEntry[];
};

/** A golden line with its hole number (`Level.order`, from the registry). */
export type GoldenLine = RecordedGolden & { readonly order: number };

/** The solver's game config for a single-level campaign (seed 1, local). */
export function goldenConfig(levelId: string): SimConfig {
  return { playerCount: 2, levelIds: [levelId], seed: 1, mode: 'local' };
}

// @generated-begin: npm run solve -- all --write-goldens (scripts/solver.ts); never edit by hand
const RECORDED: readonly RecordedGolden[] = [
  {
    levelId: 'w1-01-first-fairway',
    name: 'First Fairway',
    strokes: [2, 2],
    finalTick: 624,
    snapshot: '[2,624,3,0,1,0,[[2,-0.3187,94.4],[2,-0.1262,94.4]],[[1190,572,0,0,3,0,859.93,577.95],[1190,572,0,0,3,0,771.64,543.95]],0,1,[[2,2]],0]',
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
    levelId: 'w1-02-two-doors',
    name: 'Two Doors',
    strokes: [4, 2],
    finalTick: 1264,
    snapshot: '[2,1264,3,0,0,0,[[4,-0.1262,71.9],[2,-0.1262,71.9]],[[1680,610,0,0,7,6,1648.31,587.95],[1680,610,0,0,7,0,1177.76,627.92]],2,1,[[4,2]],0]',
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
    levelId: 'w1-03-colour-keys',
    name: 'Colour Keys',
    strokes: [3, 4],
    finalTick: 1566,
    snapshot: '[2,1566,3,0,1,0,[[3,-0.1262,71.9],[4,-0.1262,60.6]],[[1740,606,0,0,7,0,1271.66,627.68],[1740,606,0,0,7,0,1496.19,627.95]],2,1,[[3,4]],0]',
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
    levelId: 'w1-04-plate-and-bridge',
    name: 'Plate & Bridge',
    strokes: [4, 3],
    finalTick: 1450,
    snapshot: '[2,1450,3,0,0,0,[[4,-0.1262,71.9],[3,-0.1262,71.9]],[[1860,594,0,0,7,0,1364.14,615.95],[1860,594,0,0,7,0,1380.07,615.95]],2,1,[[4,3]],0]',
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
  {
    levelId: 'w2-05-spring-step',
    name: 'Spring Step',
    strokes: [3, 2],
    finalTick: 1546,
    snapshot: '[2,1546,3,0,0,0,[[3,-0.1262,49.4],[2,-0.1262,49.4]],[[1690,450,0,0,7,0,1296.16,251.95],[1690,450,0,0,7,0,1294.66,251.95]],2,1,[[3,2]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 49.4 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 289, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 289, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 780, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 780, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1202, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 49.4 } },
      { tick: 1202, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1395, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 49.4 } },
      { tick: 1395, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
  {
    levelId: 'w2-06-booby-trap',
    name: 'Booby Trap',
    strokes: [3, 2],
    finalTick: 1200,
    snapshot: '[2,1200,3,0,0,0,[[3,-0.1262,71.9],[2,-0.1262,71.9]],[[1600,610,0,0,7,0,1191.94,627.95],[1600,610,0,0,3,0,1209.67,627.95]],4,1,[[3,2]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -1.8587, power: 94.4 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 234, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 49.4 } },
      { tick: 234, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 602, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 94.4 } },
      { tick: 602, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 995, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 995, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1107, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 71.9 } },
      { tick: 1107, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
  {
    levelId: 'w2-07-load-and-fire',
    name: 'Load & Fire',
    strokes: [3, 5],
    finalTick: 1413,
    snapshot: '[2,1413,3,0,1,0,[[3,-0.1262,71.9],[5,-0.1262,60.6]],[[1870,410,0,0,7,0,1642.59,397.95],[1870,410,0,0,7,6,1832.88,387.95]],2,1,[[3,5]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 83.1 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 231, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 38.1 } },
      { tick: 231, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 544, cmd: { type: 'setAim', playerId: 0, angle: -0.8962, power: 60.6 } },
      { tick: 544, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 824, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 60.6 } },
      { tick: 824, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 990, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 71.9 } },
      { tick: 990, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1079, cmd: { type: 'setAim', playerId: 1, angle: -1.0887, power: 60.6 } },
      { tick: 1079, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1309, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 60.6 } },
      { tick: 1309, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
  {
    levelId: 'w2-08-colour-lift',
    name: 'Colour Lift',
    strokes: [3, 4],
    finalTick: 1396,
    snapshot: '[2,1396,3,0,1,0,[[3,-0.1262,15.6],[4,-0.1262,71.9]],[[1840,470,0,0,7,0,1774.75,447.95],[1840,470,0,0,7,0,1923.24,447.95]],2,1,[[3,4]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 1, angle: -0.7037, power: 71.9 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 272, cmd: { type: 'setAim', playerId: 0, angle: -1.2812, power: 83.1 } },
      { tick: 272, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 664, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 664, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 822, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 822, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1045, cmd: { type: 'setAim', playerId: 1, angle: -0.3187, power: 83.1 } },
      { tick: 1045, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1257, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 15.6 } },
      { tick: 1257, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1329, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 1329, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
  {
    levelId: 'w3-09-bait',
    name: 'Bait',
    strokes: [4, 3],
    finalTick: 1293,
    snapshot: '[2,1293,3,0,0,0,[[4,-0.1262,83.1],[3,-0.1262,83.1]],[[1840,450,0,0,7,0,1373.56,267.95],[1840,450,0,0,7,0,1384.96,267.95]],2,1,[[4,3]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 206, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 71.9 } },
      { tick: 206, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 379, cmd: { type: 'setAim', playerId: 1, angle: -1.0887, power: 60.6 } },
      { tick: 379, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 599, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 49.4 } },
      { tick: 599, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 709, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 83.1 } },
      { tick: 709, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 874, cmd: { type: 'setAim', playerId: 0, angle: -0.7037, power: 60.6 } },
      { tick: 874, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 1098, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 83.1 } },
      { tick: 1098, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
  {
    levelId: 'w3-10-sky-bridge',
    name: 'Sky Bridge',
    strokes: [3, 2],
    finalTick: 1024,
    snapshot: '[2,1024,3,0,0,0,[[3,-0.1262,83.1],[2,-0.1262,83.1]],[[1875,400,0,0,7,0,1672.64,403.95],[1875,400,0,0,3,0,1691.01,403.95]],2,1,[[3,2]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 1, angle: -2.0512, power: 60.6 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 148, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 26.9 } },
      { tick: 148, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 686, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 83.1 } },
      { tick: 686, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 762, cmd: { type: 'setAim', playerId: 0, angle: -0.3187, power: 83.1 } },
      { tick: 762, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 971, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 83.1 } },
      { tick: 971, cmd: { type: 'shoot', playerId: 0 } },
    ],
  },
  {
    levelId: 'w3-11-crossfire',
    name: 'Crossfire',
    strokes: [4, 4],
    finalTick: 1378,
    snapshot: '[2,1378,3,0,1,0,[[4,-0.1262,60.6],[4,-0.1262,83.1]],[[1860,410,0,0,7,6,1842.97,387.95],[1860,410,0,0,3,0,1597.32,399.95]],2,1,[[4,4]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 26.9 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 150, cmd: { type: 'setAim', playerId: 1, angle: -2.0512, power: 94.4 } },
      { tick: 150, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 414, cmd: { type: 'setAim', playerId: 0, angle: -1.0887, power: 71.9 } },
      { tick: 414, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 701, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 26.9 } },
      { tick: 701, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 856, cmd: { type: 'setAim', playerId: 0, angle: -0.1262, power: 60.6 } },
      { tick: 856, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 999, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 49.4 } },
      { tick: 999, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 1329, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 83.1 } },
      { tick: 1329, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
  {
    levelId: 'w3-12-grand-machine',
    name: 'Grand Machine',
    strokes: [2, 3],
    finalTick: 1078,
    snapshot: '[2,1078,3,0,1,0,[[2,-0.5112,71.9],[3,-0.8962,60.6]],[[1850,410,0,0,3,0,1467.22,321.95],[1850,410,0,0,7,0,1503.83,321.95]],4,1,[[2,3]],0]',
    log: [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick: 1, cmd: { type: 'setAim', playerId: 0, angle: -1.8587, power: 60.6 } },
      { tick: 1, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 194, cmd: { type: 'setAim', playerId: 1, angle: -0.1262, power: 26.9 } },
      { tick: 194, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 569, cmd: { type: 'setAim', playerId: 0, angle: -0.5112, power: 71.9 } },
      { tick: 569, cmd: { type: 'shoot', playerId: 0 } },
      { tick: 708, cmd: { type: 'setAim', playerId: 1, angle: -2.0512, power: 83.1 } },
      { tick: 708, cmd: { type: 'shoot', playerId: 1 } },
      { tick: 985, cmd: { type: 'setAim', playerId: 1, angle: -0.8962, power: 60.6 } },
      { tick: 985, cmd: { type: 'shoot', playerId: 1 } },
    ],
  },
];
// @generated-end

/** Every hole's golden line in campaign order (World 1 hole 1 first); `order` is the registry's hole number. */
export const GOLDEN_LINES: readonly GoldenLine[] = RECORDED.map((g) => ({ ...g, order: levelById(g.levelId).order }));
