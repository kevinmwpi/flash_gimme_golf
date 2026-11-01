// OWNER: levels
/**
 * ARCH.md §4 levels-solver row (slow; `npm run test:levels`), split per world (BUILD_DECISIONS D10.13): the shards
 * levels-solver-w1/-w2/-w3.test.ts each call `solverSuite(world)`, so `npm run test:levels` runs them in parallel
 * workers and CI runs them as a matrix (.github/workflows/levels.yml); `npm test` excludes all of them. Runs
 * scripts/solver.ts (stepSim / runReplay / predictShot / evaluateSwitches) once per level and asserts every pass
 * criterion in its own `it`. Levels come from the registry; the solver's tables (scripted lines, par slack,
 * launcher cases, opt-outs) are keyed by level id and checked here to name registered levels only. Prescribed
 * search: 16 angles x 8 powers, beam 6, depth >= 8, plus the wide run at beam 60 whose minimum calibrates par.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACE_GRIDS,
  GOLDEN_GRID,
  LAUNCHER_CASES,
  LAUNCH_PERTURBATIONS,
  LAUNCH_STEP_PX,
  LONE_DECK_ROLL_MAX_DEG,
  OPT_OUTS,
  PAR_SLACK,
  PAR_SLACK_BY_ID,
  PASS_NAMES,
  SCRIPTED_LINES,
  TRAPS_GAMES,
  WIDE_BEAM,
  bridgedGaps,
  cellGrid,
  checkedWallColumns,
  fmtRescue,
  goldenLineOf,
  hasBridgedGaps,
  hasDeck,
  hasGaps,
  hasLaunchers,
  hasStallPlates,
  hasWaitingDevices,
  hasWallColumns,
  isCoopLevel,
  launchersOf,
  optOutsOf,
  parSlackFor,
  recordGolden,
  replayMatches,
  solverMinimum,
  verifyLevel,
  waitingDevicesOf,
  wallColumns,
  type LevelReport,
  type RunOptions,
} from '../../../scripts/solver';
import { hasLevel, levelsOfWorld } from '../levels/index';
import type { Level, WorldId } from '../types';
import { BALL_RADIUS } from '../types';
import { GOLDEN_LINES } from './levels-golden';

const LEVEL_TIMEOUT_MS = 20 * 60_000;

function optionsFor(level: Level): RunOptions {
  return {
    depth: Math.max(8, level.par + 3),
    beam: 6,
    wideBeam: WIDE_BEAM,
    grid: cellGrid(16, 8),
    maxSeconds: 600,
    games: TRAPS_GAMES,
    passes: PASS_NAMES,
  };
}

const failing = (report: LevelReport): string[] => report.criteria.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);

export function solverSuite(world: WorldId): void {
  describe(`solver verification at SHOT_SPEED_PER_POWER, world ${world} (scripts/solver.ts)`, () => {
    it('every solver table is keyed by a registered level id (a misspelt key would be a silent skip)', () => {
      const keys = [...SCRIPTED_LINES.map((l) => l.levelId), ...Object.keys(PAR_SLACK_BY_ID), ...LAUNCHER_CASES.map((c) => c.levelId), ...OPT_OUTS.map((o) => o.levelId)];
      expect(keys.filter((id) => !hasLevel(id))).toEqual([]);
    });

    for (const level of levelsOfWorld(world)) {
      describe(`hole ${level.order}: ${level.name} (par ${level.par})`, () => {
        let report: LevelReport;

        beforeAll(() => {
          report = verifyLevel(level, optionsFor(level));
        }, LEVEL_TIMEOUT_MS);

        it('every solver criterion passes', () => {
          expect(failing(report)).toEqual([]);
        });

        it('coop: the beam-6 search holes both balls within par + 3 and the strokes add up', () => {
          const coop = report.coop!;
          expect(coop.solved).toBe(true);
          expect(coop.total).not.toBeNull();
          expect(coop.total!).toBeLessThanOrEqual(level.par + 3);
          expect(coop.strokes![0] + coop.strokes![1]).toBe(coop.total);
          expect(coop.line.filter((s) => s.sunk)).toHaveLength(2);
          expect(coop.line.some((s) => s.fell)).toBe(false);
        });

        it('replay: the solved line re-run through runReplay(config, log, finalTick) reproduces the incremental SimState exactly', () => {
          expect(report.replayDeterministic).toBe(true);
          expect(replayMatches(report.coop!.game!)).toBe(true);
        });

        // Both searches are heuristic upper bounds: a wider bucketed beam prunes differently and can miss a line the
        // narrow beam keeps (Two Doors: beam 6 finds 5, beam 60 finds 6), so neither is required to beat the other.
        // The hole's minimum is the better of the two (solverMinimum), and that is what the pars test checks.
        it(`wide: the beam-${WIDE_BEAM} search also solves the hole within its time budget and the same par + 3 stroke budget`, () => {
          const wide = report.wide!;
          expect(wide.solved).toBe(true);
          expect(wide.truncated).toBe(false);
          expect(wide.total!).toBeLessThanOrEqual(level.par + 3);
          expect(wide.line.filter((s) => s.sunk)).toHaveLength(2);
        });

        it(`pars: the solver minimum is at most par and par exceeds it by at most ${PAR_SLACK} (the documented Colour Keys slack aside, see parSlackFor)`, () => {
          const minimum = solverMinimum(report.wide, report.coop);
          expect(minimum).not.toBeNull();
          expect(minimum!).toBeLessThanOrEqual(level.par);
          expect(level.par - minimum!).toBeLessThanOrEqual(parSlackFor(level));
          expect(parSlackFor(level)).toBeLessThanOrEqual(PAR_SLACK + 1);
        });

        it.runIf(isCoopLevel(level))('solo: with the partner parked on its tee neither ball sinks within depth 10 and 0 first-shot grid shots reach the cup (a caught or loaded lone ball is a dead end)', () => {
          for (const solo of report.solo!) {
            expect(solo.solved, `P${solo.player + 1}`).toBe(false);
            expect(solo.firstShotSinks).toBe(0);
            expect(solo.reachableX).toBeLessThan(level.hole.x);
          }
        });

        it.runIf(!isCoopLevel(level))('solo: hole 1 is solvable by either ball alone (by design) with 0 first-shot sinks', () => {
          for (const solo of report.solo!) {
            expect(solo.solved, `P${solo.player + 1}`).toBe(true);
            expect(solo.firstShotSinks).toBe(0);
          }
        });

        it('aces: 0 one-shot sinks or gimmes from either tee across the full fine sweep and the human grid, both ways', () => {
          const shots = ACE_GRIDS.reduce((n, g) => n + g.angles.length * g.powers.length, 0);
          for (const ace of report.aces!) {
            expect(ace.shots).toBe(shots);
            expect(ace.sinks, `P${ace.player + 1} e.g. ${ace.example ?? ''}`).toBe(0);
          }
        });

        it.runIf(hasWallColumns(level))('walls: with every switch off the blocked ball never passes a wall column from its tee side, and its centre never reaches the wall top', () => {
          const walls = report.walls!;
          expect(walls.length).toBeGreaterThan(0);
          expect(walls.reduce((n, w) => n + w.passes, 0)).toBe(0);
          for (const column of checkedWallColumns(level)) {
            const rows = walls.filter((w) => w.wallX === column.x1);
            expect(rows.some((w) => w.grid === 'human' && w.shots === 162), `wall ${column.x1}`).toBe(true);
            const asserted = rows.filter((w) => !w.highestYExempt);
            expect(asserted.length, `wall ${column.x1}`).toBeGreaterThan(0);
            expect(Math.min(...asserted.map((w) => w.highestY)), `wall ${column.x1}`).toBeGreaterThan(column.top - BALL_RADIUS);
          }
        });

        it('opt-outs: every skip of the walls and gaps passes is a row of OPT_OUTS, and every row still describes this hole', () => {
          const rows = optOutsOf(level);
          expect(report.optOuts!.map((c) => c.optOut)).toEqual(rows);
          for (const check of report.optOuts!) expect(check.valid, check.detail).toBe(true);
          const skippedColumns = wallColumns(level).filter((c) => !checkedWallColumns(level).some((k) => k.x1 === c.x1 && k.x2 === c.x2));
          expect(skippedColumns.map((c) => c.x1)).toEqual(rows.flatMap((o) => (o.skip === 'column' ? (wallColumns(level).find((c) => c.rectIds.includes(o.rectId))?.x1 ?? []) : [])));
          const unbridged = level.terrain.gaps.filter((g) => !bridgedGaps(level).includes(g)).map((g) => g.x1);
          expect(unbridged).toEqual(rows.flatMap((o) => (o.skip === 'lonePlate' ? [o.gapX1] : [])));
          expect(report.walls!.filter((w) => w.highestYExempt).length > 0).toBe(rows.some((o) => o.skip === 'highestY'));
        });

        it.runIf(hasGaps(level))('gaps: with no plate held (bridges absent, cannons cold) 0 shots cross the chasm', () => {
          const gaps = report.gaps!;
          expect(gaps.length).toBeGreaterThan(0);
          expect(gaps.reduce((n, g) => n + g.crossings, 0)).toBe(0);
          expect(gaps.reduce((n, g) => n + g.falls, 0)).toBeGreaterThan(0);
        });

        it.runIf(hasBridgedGaps(level))('gaps: a lone ball leaving a bridge plate drops the bridge and never rests beyond the far lip', () => {
          const lone = report.lonePlate!;
          expect(lone.length).toBeGreaterThan(0);
          for (const l of lone) {
            expect(l.crossed).toBe(false);
            expect(l.fell).toBe(true);
            expect(l.bridgeDrops).toBeGreaterThanOrEqual(1);
          }
        });

        it('scripted: every intended line replays beat by beat on the grid with both balls sunk within par + 2, and the golden line records exactly the committed golden', () => {
          const scripted = report.scripted!;
          expect(scripted.length).toBeGreaterThan(0);
          for (const line of scripted) {
            expect(line.failedAt, line.name).toBeNull();
            expect(line.bothSunk, line.name).toBe(true);
            expect(line.total, line.name).toBeLessThanOrEqual(level.par + 2);
            expect(replayMatches(line.game), line.name).toBe(true);
          }
          expect(scripted.some((r) => r.name === goldenLineOf(level).name)).toBe(true);
          const committed = GOLDEN_LINES.find((g) => g.levelId === level.id);
          expect(committed).toBeDefined();
          expect({ ...recordGolden(level, GOLDEN_GRID), order: level.order }).toEqual(committed);
        });

        it.runIf(hasStallPlates(level))('stall: a holder tapping straight up (90/10, 90/15, 80/20, 100/15) lands back on its plate; a partner on a tee, a plate or the deck never falls', () => {
          const stall = report.stall!;
          expect(stall.length).toBeGreaterThan(0);
          for (const s of stall) {
            expect(s.heldBefore, `${s.switchId} partner@${s.partnerAt}`).toBe(true);
            expect(s.reHeld, `${s.switchId} ${s.tap.deg}/${s.tap.power} partner@${s.partnerAt}`).toBe(true);
            expect(s.partnerFell, `${s.switchId} ${s.tap.deg}/${s.tap.power} partner@${s.partnerAt}`).toBe(false);
          }
          if (hasDeck(level)) expect(stall.filter((s) => s.partnerAt === 'deck').length).toBeGreaterThan(0);
        });

        it.runIf(hasDeck(level))('deck: a ball resting 1-24 px outside either lip never presses DECK; a ball resting anywhere on the inset strip does', () => {
          const deck = report.deck!;
          expect(deck.length).toBeGreaterThan(0);
          for (const d of deck) {
            expect(d.lipSamples).toBe(48);
            expect(d.lipPresses).toBe(0);
            expect(d.deckSamples).toBeGreaterThan(0);
            expect(d.deckPresses).toBe(d.deckSamples);
          }
        });

        it.runIf(hasDeck(level))(`deck: a lone deck ball (partner on its tee) drops into the chasm on every roll of <= ${LONE_DECK_ROLL_MAX_DEG} deg and crosses only by a lob that carries to the far lip (the watchOut copy)`, () => {
          const lone = report.loneDeck!;
          const rolls = lone.filter((l) => l.shot.deg <= LONE_DECK_ROLL_MAX_DEG);
          const lobs = lone.filter((l) => l.shot.deg > LONE_DECK_ROLL_MAX_DEG);
          expect(rolls.length).toBeGreaterThanOrEqual(36);
          for (const l of rolls) {
            expect(l.crossed, `${l.fromX} ${l.shot.deg}/${l.shot.power}`).toBe(false);
            expect(l.fell, `${l.fromX} ${l.shot.deg}/${l.shot.power}`).toBe(true);
          }
          expect(lobs.some((l) => l.crossed)).toBe(true);
        });

        it.runIf(hasLaunchers(level))('launchers: every ride of the intended lines rests on its target plate from every pad x (0.5 px) and every 97/100/103 % launch, fired once (cannons also LOADED)', () => {
          const launchers = report.launchers!;
          expect(launchers.uncovered).toEqual([]);
          expect(launchers.unknown).toEqual([]);
          for (const pad of launchersOf(level)) expect(launchers.rows.some((r) => r.rectId === pad.id), pad.id).toBe(true);
          const perturbations = LAUNCH_PERTURBATIONS.length * LAUNCH_PERTURBATIONS.length;
          for (const row of launchers.rows) {
            const pad = launchersOf(level).find((r) => r.id === row.rectId)!;
            const name = `${row.rectId} P${row.player + 1} -> ${row.target} (${row.mode})`;
            expect(row.drops, name).toBe(perturbations * (pad.w / LAUNCH_STEP_PX + 1));
            expect(row.onTarget, `${name}: ${row.misses.join(' | ')}`).toBe(row.drops);
            expect(row.refires, name).toBe(0);
            expect(row.unfired, name).toBe(0);
          }
          for (const pad of launchersOf(level).filter((r) => r.kind === 'cannon')) expect(launchers.rows.some((r) => r.rectId === pad.id && r.mode === 'loaded'), pad.id).toBe(true);
        });

        it.runIf(hasLaunchers(level) || hasWaitingDevices(level))('loops: no flight from any restable spot (every 20 px plus the plates and devices, both ways, stall taps included) reaches the 1,800-tick watchdog', () => {
          const loops = report.loops!;
          expect(loops.map((l) => l.config)).toEqual(['plates up', 'plates held']);
          for (const row of loops) {
            expect(row.flights, row.config).toBeGreaterThan(0);
            expect(row.running, `${row.config}: ${row.examples.join('; ')}`).toBe(0);
          }
        });

        it.runIf(hasWaitingDevices(level))(`traps: ${TRAPS_GAMES} seeded games from the tees plus every one-shot deviation from the intended lines: the tee guard never runs, resets land where the ball last stood free, every waiting state is rescuable`, () => {
          const traps = report.traps!;
          expect(traps.games).toBe(TRAPS_GAMES);
          expect(traps.teeResets).toBe(0);
          expect(traps.resetMisses).toEqual([]);
          expect(traps.maxResetsPerShot).toBeLessThanOrEqual(2);
          expect(traps.safeSpotMisses).toEqual([]);
          expect(traps.strokeMisses).toEqual([]);
          expect(traps.timeouts).toBe(0);
          expect(traps.timedOut).toBe(0);
          expect(traps.devices).toEqual(waitingDevicesOf(level).map((r) => r.id));
          expect(traps.reached).toEqual([...traps.devices].sort());
          expect(traps.rescues.length).toBeGreaterThan(0);
          expect(traps.rescues.filter((r) => !r.rescued).map(fmtRescue)).toEqual([]);
        });
      });
    }
  });
}
