// OWNER: levels
/**
 * ARCH.md §4 levels-solver row (slow; `npm run test:levels`, about 12 minutes). Runs scripts/solver.ts
 * (built on stepSim / runReplay / predictShot / evaluateSwitches) once per level and asserts every
 * LEVELS.md pass criterion in its own `it`. Levels are addressed by campaign position; no level-id
 * literal lives here. Prescribed search: 16 angles x 8 powers, beam 6, depth >= 8, plus the wide run at
 * beam 60 whose minimum calibrates par.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FINE_GRID,
  HUMAN_GRID,
  LONE_DECK_ROLL_MAX_DEG,
  PASS_NAMES,
  PAR_SLACK,
  WIDE_BEAM,
  cellGrid,
  parSlackFor,
  replayMatches,
  solverMinimum,
  verifyLevel,
  wallColumns,
  type LevelReport,
  type RunOptions,
} from '../../../scripts/solver';
import { LEVELS } from '../levels/index';
import type { Level } from '../types';
import { BALL_RADIUS } from '../types';

const LEVEL_TIMEOUT_MS = 20 * 60_000;

function optionsFor(level: Level): RunOptions {
  return {
    depth: Math.max(8, level.par + 3),
    beam: 6,
    wideBeam: WIDE_BEAM,
    grid: cellGrid(16, 8),
    maxSeconds: 600,
    passes: PASS_NAMES,
  };
}

const isCoop = (level: Level): boolean => level.mechanicsPresent.includes('switch') || level.mechanicsPresent.includes('colourGate');
const hasWalls = (level: Level): boolean => wallColumns(level).length > 0;
const hasGaps = (level: Level): boolean => level.terrain.gaps.length > 0;
const hasDeck = (level: Level): boolean => level.switches.some((sw) => sw.onRectId !== undefined);
const hasPlates = (level: Level): boolean => level.switches.some((sw) => sw.onRectId === undefined);

const failing = (report: LevelReport): string[] => report.criteria.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);

describe('solver verification at SHOT_SPEED_PER_POWER (scripts/solver.ts)', () => {
  for (const level of LEVELS) {
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

      it.runIf(isCoop(level))('solo: with the partner parked on its tee neither ball sinks within depth 10 and 0 first-shot grid shots reach the cup', () => {
        for (const solo of report.solo!) {
          expect(solo.solved, `P${solo.player + 1}`).toBe(false);
          expect(solo.firstShotSinks).toBe(0);
          expect(solo.reachableX).toBeLessThan(level.hole.x);
        }
      });

      it.runIf(!isCoop(level))('solo: hole 1 is solvable by either ball alone (by design) with 0 first-shot sinks', () => {
        for (const solo of report.solo!) {
          expect(solo.solved, `P${solo.player + 1}`).toBe(true);
          expect(solo.firstShotSinks).toBe(0);
        }
      });

      it('aces: 0 one-shot sinks or gimmes from either tee across the full fine sweep and the human grid', () => {
        const fineShots = FINE_GRID.angles.length * FINE_GRID.powers.length;
        const humanShots = HUMAN_GRID.angles.length * HUMAN_GRID.powers.length;
        for (const ace of report.aces!) {
          expect(ace.shots).toBe(fineShots + humanShots);
          expect(ace.sinks, `P${ace.player + 1} e.g. ${ace.example ?? ''}`).toBe(0);
        }
      });

      it.runIf(hasWalls(level))('walls: with every switch off the blocked ball never passes a wall column at power 95-100 from any approach, and its centre never reaches the wall top', () => {
        const walls = report.walls!;
        expect(walls.length).toBeGreaterThan(0);
        expect(walls.reduce((n, w) => n + w.passes, 0)).toBe(0);
        const wallTop = Math.min(...wallColumns(level).map((c) => c.top));
        expect(Math.min(...walls.map((w) => w.highestY))).toBeGreaterThan(wallTop - BALL_RADIUS);
        for (const column of wallColumns(level)) expect(walls.some((w) => w.wallX === column.x1 && w.grid === 'human' && w.shots === 162)).toBe(true);
      });

      it.runIf(hasGaps(level))('gaps: with no plate held 0 shots cross the chasm, and a lone ball leaving plate A drops the bridge and never rests beyond the far lip', () => {
        const gaps = report.gaps!;
        expect(gaps.length).toBeGreaterThan(0);
        expect(gaps.reduce((n, g) => n + g.crossings, 0)).toBe(0);
        expect(gaps.reduce((n, g) => n + g.falls, 0)).toBeGreaterThan(0);
        const lone = report.lonePlate!;
        expect(lone.length).toBeGreaterThan(0);
        for (const l of lone) {
          expect(l.crossed).toBe(false);
          expect(l.fell).toBe(true);
          expect(l.bridgeDrops).toBeGreaterThanOrEqual(1);
        }
      });

      it('scripted: every LEVELS.md intended line replays beat by beat on the grid with both balls sunk within par + 2', () => {
        const scripted = report.scripted!;
        expect(scripted.length).toBeGreaterThan(0);
        for (const line of scripted) {
          expect(line.failedAt, line.name).toBeNull();
          expect(line.bothSunk, line.name).toBe(true);
          expect(line.total, line.name).toBeLessThanOrEqual(level.par + 2);
          expect(replayMatches(line.game), line.name).toBe(true);
        }
      });

      it.runIf(hasPlates(level))('stall: a holder tapping straight up (90/10, 90/15, 80/20, 100/15) lands back on its plate; a partner on a tee, a plate or the deck never falls', () => {
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
    });
  }
});
