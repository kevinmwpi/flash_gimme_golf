// OWNER: levels
/**
 * Level solver and verification passes (ARCH.md §4 "levels-solver" row, BUILD_DECISIONS D4 and D10.13), built
 * on the real sim only; the modules live in scripts/solver/:
 * - game.ts: shots, grids and the game driver (`createSim` / `stepSim`, one shot settled to the next turn);
 * - search.ts: the co-op beam search (keys carry the caught / loaded flags), its `runReplay` proof and the
 *   solo-bypass chains (`predictShot`, partner parked; a caught or loaded lone ball is a dead end);
 * - sweeps.ts: aces, wall passes and gap crossings on `predictShot`, the lone-plate rule, and OPT_OUTS, the
 *   one table of exceptions to the generic passes;
 * - lines.ts: the intended lines (keyed by level id) and the golden recording;
 * - plates.ts: stall taps, the deck lip and the lone deck ball;
 * - devices.ts: the launchers, loops and traps passes;
 * - verify.ts: the criteria and `verifyLevel`.
 *
 *   npm run solve -- <levelId|w1|w2|w3|all> [--pass coop,wide,solo,aces,walls,gaps,scripted,stall,deck,launchers,loops,traps]
 *                   [--depth N] [--beam N] [--wideBeam N] [--angles N] [--powers N] [--maxSeconds S] [--games N] [--json out.json]
 *   npm run solve -- <levelId|w1|w2|w3|all> --write-goldens
 *
 * `coop` is the prescribed beam-6 search, `wide` the same search at `--wideBeam` (default 60) whose minimum
 * calibrates par (par - PAR_SLACK <= minimum <= par, see parCriteria). Exit code 0 when every applicable
 * criterion passes, 1 when one fails, 2 on bad arguments. `--write-goldens` re-records the golden line of every
 * selected hole (replayScripted on the 16 x 8 grid) into src/sim/__tests__/levels-golden.ts, keeping the
 * other holes' entries, and runs no pass. Level ids and the tables keyed by them (SCRIPTED_LINES,
 * PAR_SLACK_BY_ID, LAUNCHER_CASES, OPT_OUTS) live here and in scripts/solver/, outside src/sim.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GOLDEN_LINES, type RecordedGolden } from '../src/sim/__tests__/levels-golden';
import { LEVELS, WORLDS, hasLevel, levelById, levelsOfWorld } from '../src/sim/levels/index';
import type { Level } from '../src/sim/types';
import { cellGrid } from './solver/game';
import { recordGolden, withGoldenBlock } from './solver/lines';
import { DEFAULT_GAMES, PASS_NAMES, WIDE_BEAM, formatReport, verifyLevel, type LevelReport, type PassName, type RunOptions } from './solver/verify';

export * from './solver/game';
export * from './solver/search';
export * from './solver/sweeps';
export * from './solver/lines';
export * from './solver/plates';
export * from './solver/devices';
export * from './solver/verify';

/** The grid every golden line is recorded on (levels-golden.ts). */
export const GOLDEN_GRID = cellGrid(16, 8);

const GOLDEN_FILE = fileURLToPath(new URL('../src/sim/__tests__/levels-golden.ts', import.meta.url));

type CliArgs = { readonly levels: readonly Level[]; readonly options: RunOptions; readonly jsonOut: string | null; readonly writeGoldens: boolean };

const USAGE =
  'usage: npm run solve -- <levelId|w1|w2|w3|all> [--pass coop,wide,solo,aces,walls,gaps,scripted,stall,deck,launchers,loops,traps] [--depth N] [--beam N] [--wideBeam N] [--angles N] [--powers N] [--maxSeconds S] [--games N] [--json out.json]\n' +
  '       npm run solve -- <levelId|w1|w2|w3|all> --write-goldens\n';

function usage(message: string): never {
  process.stderr.write(`${message}\n${USAGE}`);
  process.stderr.write(`levels: ${LEVELS.map((l) => l.id).join(', ')}\n`);
  process.exit(2);
}

function levelsFor(target: string): readonly Level[] {
  if (target === 'all') return LEVELS;
  const world = WORLDS.find((w) => target === `w${w}`);
  if (world !== undefined) return levelsOfWorld(world);
  return hasLevel(target) ? [levelById(target)] : usage(`unknown level id or world "${target}"`);
}

function parseArgs(argv: readonly string[]): CliArgs {
  const [target, ...rest] = argv;
  if (target === undefined) usage('missing level id');
  const levels = levelsFor(target);
  const opt = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = opt(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : usage(`--${name} needs a positive number`);
  };
  const passRaw = opt('pass');
  const passes = passRaw === undefined ? PASS_NAMES : passRaw.split(',').map((p) => (PASS_NAMES.includes(p as PassName) ? (p as PassName) : usage(`unknown pass "${p}"`)));
  const maxPar = Math.max(...levels.map((l) => l.par));
  return {
    levels,
    options: {
      depth: num('depth', maxPar + 3),
      beam: num('beam', 6),
      wideBeam: num('wideBeam', WIDE_BEAM),
      grid: cellGrid(num('angles', 16), num('powers', 8)),
      maxSeconds: num('maxSeconds', 900),
      games: num('games', DEFAULT_GAMES),
      passes,
    },
    jsonOut: opt('json') ?? null,
    writeGoldens: rest.includes('--write-goldens'),
  };
}

/** Re-records the selected holes' goldens and rewrites the generated block of levels-golden.ts. */
function writeGoldens(levels: readonly Level[]): number {
  const fresh = levels.map((level) => recordGolden(level, GOLDEN_GRID));
  const kept: RecordedGolden[] = GOLDEN_LINES.filter((g) => !fresh.some((f) => f.levelId === g.levelId)).map(({ order: _order, ...g }) => g);
  const source = fs.readFileSync(GOLDEN_FILE, 'utf8');
  fs.writeFileSync(GOLDEN_FILE, withGoldenBlock(source, [...kept, ...fresh]));
  for (const g of fresh) process.stdout.write(`${g.levelId}: ${g.strokes[0] + g.strokes[1]} strokes (${g.strokes.join('+')}), final tick ${g.finalTick}\n`);
  process.stdout.write(`wrote ${path.relative(process.cwd(), GOLDEN_FILE)}\n`);
  return 0;
}

function main(argv: readonly string[]): number {
  const { levels, options, jsonOut, writeGoldens: goldens } = parseArgs(argv);
  if (goldens) return writeGoldens(levels);
  const reports: LevelReport[] = [];
  for (const level of levels) {
    const report = verifyLevel(level, options);
    reports.push(report);
    process.stdout.write(formatReport(report));
  }
  if (jsonOut !== null) fs.writeFileSync(jsonOut, JSON.stringify(reports, (_key, value: unknown) => (value instanceof Object && 'config' in value && 'state' in value ? undefined : value), 2));
  const failed = reports.flatMap((r) => r.criteria.filter((c) => !c.pass).map((c) => `${r.levelId}: ${c.name}`));
  process.stdout.write(failed.length === 0 ? 'all criteria passed\n' : `FAILED: ${failed.join('; ')}\n`);
  return failed.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`solver: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
