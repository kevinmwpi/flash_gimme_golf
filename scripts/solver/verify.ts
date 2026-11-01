// OWNER: levels
/**
 * The solver's criteria (scripts/solver.ts): `verifyLevel` runs every requested pass on one level and turns its
 * results into named criteria (exit code 1 in the CLI, one `it` each in the slow suite). A pass only produces
 * criteria where its subject exists (no wall column, gap, plate, deck, launcher or waiting device means no
 * rows); the skips the generic passes take are the rows of OPT_OUTS, each reported as its own criterion.
 */
import type { Level } from '../../src/sim/types';
import { BALL_RADIUS, SHOT_SPEED_PER_POWER } from '../../src/sim/types';
import {
  TRAPS_GAMES,
  launcherCasesOf,
  launcherCheck,
  launchersOf,
  loopSweep,
  trapsCheck,
  waitingDevicesOf,
  type LauncherReport,
  type LoopRow,
  type RescueRow,
  type TrapsReport,
} from './devices';
import { fmtShot } from './game';
import { replayScripted, scriptedLinesOf, type ScriptedResult } from './lines';
import { deckLipCheck, fmtLoneDeck, loneDeckCheck, stallPlates, stallTapCheck, LONE_DECK_ROLL_MAX_DEG, type DeckLipResult, type LoneDeckResult, type StallResult } from './plates';
import { replayMatches, searchCoop, searchSolo, secondsSince, type CoopResult, type LineStep, type SearchOptions, type SoloResult } from './search';
import {
  aceSweep,
  bridgedGaps,
  checkOptOuts,
  checkedWallColumns,
  describeOptOut,
  gapCrossSweep,
  lonePlateCheck,
  wallPassSweep,
  type AceResult,
  type GapCrossResult,
  type LonePlateResult,
  type OptOutCheck,
  type WallPassResult,
} from './sweeps';

export type PassName = 'coop' | 'wide' | 'solo' | 'aces' | 'walls' | 'gaps' | 'scripted' | 'stall' | 'deck' | 'launchers' | 'loops' | 'traps';
export const PASS_NAMES: readonly PassName[] = ['coop', 'wide', 'solo', 'aces', 'walls', 'gaps', 'scripted', 'stall', 'deck', 'launchers', 'loops', 'traps'];

/** The wide co-op run (beam >= 60 per bucket) whose minimum calibrates par. */
export const WIDE_BEAM = 60;
export const WIDE_MIN_DEPTH = 8;

export type Criterion = { readonly name: string; readonly pass: boolean; readonly detail: string };

export type LevelReport = {
  readonly levelId: string;
  readonly name: string;
  readonly par: number;
  readonly shotSpeed: number;
  readonly seconds: number;
  readonly coop?: CoopResult;
  readonly wide?: CoopResult;
  readonly replayDeterministic?: boolean;
  readonly solo?: readonly SoloResult[];
  readonly aces?: readonly AceResult[];
  readonly walls?: readonly WallPassResult[];
  readonly gaps?: readonly GapCrossResult[];
  readonly lonePlate?: readonly LonePlateResult[];
  readonly optOuts?: readonly OptOutCheck[];
  readonly scripted?: readonly ScriptedResult[];
  readonly stall?: readonly StallResult[];
  readonly deck?: readonly DeckLipResult[];
  readonly loneDeck?: readonly LoneDeckResult[];
  readonly launchers?: LauncherReport;
  readonly loops?: readonly LoopRow[];
  readonly traps?: TrapsReport;
  readonly criteria: readonly Criterion[];
};

export type RunOptions = SearchOptions & {
  readonly passes: readonly PassName[];
  readonly wideBeam: number;
  /** Seeded random games of the traps pass. */
  readonly games: number;
};

export const DEFAULT_GAMES = TRAPS_GAMES;

/** The wide search: at least WIDE_BEAM per bucket and WIDE_MIN_DEPTH deep, same grid and time budget. */
export function wideOptions(opts: RunOptions): SearchOptions {
  return { ...opts, beam: Math.max(opts.wideBeam, WIDE_BEAM), depth: Math.max(opts.depth, WIDE_MIN_DEPTH) };
}

/** The best stroke count any run found (null when nothing solved). */
export function solverMinimum(...runs: readonly (CoopResult | undefined)[]): number | null {
  let best: number | null = null;
  for (const run of runs) {
    if (run !== undefined && run.total !== null && (best === null || run.total < best)) best = run.total;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Level predicates (shared with the slow suite: which criteria apply to a level)
// ---------------------------------------------------------------------------------------------

/** A hole the partner is needed on: a plate, a colour field or a device that waits for one (D10.13). */
export function isCoopLevel(level: Level): boolean {
  return level.mechanicsPresent.some((k) => k === 'switch' || k === 'colourGate' || k === 'trap' || k === 'cannon');
}
export const hasWallColumns = (level: Level): boolean => checkedWallColumns(level).length > 0;
export const hasGaps = (level: Level): boolean => level.terrain.gaps.length > 0;
export const hasBridgedGaps = (level: Level): boolean => bridgedGaps(level).length > 0;
export const hasStallPlates = (level: Level): boolean => stallPlates(level).length > 0;
export const hasDeck = (level: Level): boolean => level.switches.some((sw) => sw.onRectId !== undefined);
export const hasLaunchers = (level: Level): boolean => launchersOf(level).length > 0;
export const hasWaitingDevices = (level: Level): boolean => waitingDevicesOf(level).length > 0;

// ---------------------------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------------------------

export const fmtLine = (line: readonly LineStep[]): string =>
  line
    .map((s) => {
      const flags = [s.fired ? ' BOOM' : '', s.partnerFired ? ' (fires partner)' : '', s.waiting === 'caught' ? ' CAUGHT' : s.waiting === 'loaded' ? ' LOADED' : '', s.resets > 0 ? ` BACK +${s.resets}` : ''].join('');
      return `P${s.player + 1} ${fmtShot(s.shot)} → ${s.restX}${s.sunk ? ' SINK' : ''}${s.fell ? ' (fell)' : ''}${flags}${s.held.length > 0 ? ` [${s.held.join(',')}]` : ''}`;
    })
    .join(' · ');

function coopCriteria(level: Level, coop: CoopResult, replayOk: boolean | undefined): Criterion[] {
  const budget = level.par + 3;
  const criteria: Criterion[] = [
    {
      name: 'coop-solvable',
      pass: coop.solved && coop.total !== null && coop.total <= budget,
      detail: coop.solved ? `${coop.total} strokes (${coop.strokes?.join('+')}) within par+3=${budget} after ${coop.expanded} shots in ${coop.seconds}s: ${fmtLine(coop.line)}` : `not solved (${coop.expanded} shots, ${coop.seconds}s${coop.truncated ? ', time budget hit' : ''})`,
    },
  ];
  if (replayOk !== undefined) criteria.push({ name: 'replay-deterministic', pass: replayOk, detail: replayOk ? 'runReplay reproduces the solved line exactly' : 'runReplay DIVERGES from the incremental state' });
  return criteria;
}

/**
 * LEVELS.md par rule: par is at most solver minimum + PAR_SLACK and never below the minimum (worlds-2-3
 * LEVELS.md decision 7, D9 / D10.13). Colour Keys is the one documented exception: its structural minimum is 5
 * (blue: lob onto the DOOR 1 plate, a forced shot while DOOR 2 is shut, a roll-in; red: roll through DOOR 1,
 * lob the red field and hole out, which holds DOOR 2 from the cup) and BUILD_DECISIONS D2 caps the par change
 * at +-1 from LEVELS.md's 9, so it ships at par 8 = minimum + 3 (levels/README.md "Pars", D9). Keyed by level
 * id, never by hole number (D10.1).
 */
export const PAR_SLACK = 2;
export const PAR_SLACK_BY_ID: Readonly<Record<string, number>> = { 'w1-03-colour-keys': 3 };

export function parSlackFor(level: Level): number {
  return PAR_SLACK_BY_ID[level.id] ?? PAR_SLACK;
}

function parCriteria(level: Level, wide: CoopResult, coop: CoopResult | undefined): Criterion[] {
  const minimum = solverMinimum(wide, coop);
  const floor = level.par - parSlackFor(level);
  const detail = wide.solved
    ? `wide minimum ${wide.total} (${wide.strokes?.join('+')}) after ${wide.expanded} shots in ${wide.seconds}s: ${fmtLine(wide.line)}`
    : `wide search not solved (${wide.expanded} shots, ${wide.seconds}s${wide.truncated ? ', time budget hit' : ''})`;
  return [
    { name: 'coop-wide-solvable', pass: wide.solved && wide.total !== null && wide.total <= level.par + 3, detail },
    {
      name: 'par-calibrated',
      pass: minimum !== null && minimum >= floor && minimum <= level.par,
      detail: minimum === null ? 'no solver minimum' : `solver minimum ${minimum} vs par ${level.par} (allowed ${floor}..${level.par}${parSlackFor(level) !== PAR_SLACK ? ', documented slack' : ''})`,
    },
  ];
}

function soloCriteria(level: Level, solo: readonly SoloResult[]): Criterion[] {
  const detail = solo
    .map((s) => `P${s.player + 1}: ${s.solved ? `SOLVED in ${s.strokes}` : 'no'}, reachableX ${s.reachableX}, first-shot sinks ${s.firstShotSinks}, dead ends (caught / loaded) ${s.deadEnds}${s.line.length > 0 ? ` (${fmtLine(s.line)})` : ''}`)
    .join(' | ');
  if (!isCoopLevel(level)) return [{ name: 'solo-reference', pass: true, detail: `no co-op mechanic on this hole; ${detail}` }];
  return [
    { name: 'solo-not-bypassable', pass: solo.every((s) => !s.solved), detail },
    { name: 'solo-first-shot-zero', pass: solo.every((s) => s.firstShotSinks === 0), detail: solo.map((s) => `P${s.player + 1} ${s.firstShotSinks}`).join(', ') },
  ];
}

function aceCriteria(aces: readonly AceResult[]): Criterion[] {
  return [{ name: 'no-aces', pass: aces.every((a) => a.sinks === 0), detail: aces.map((a) => `P${a.player + 1} ${a.sinks}/${a.shots}${a.example !== null ? ` (e.g. ${a.example})` : ''}`).join(', ') }];
}

function wallCriteria(level: Level, walls: readonly WallPassResult[]): Criterion[] {
  if (walls.length === 0) return [];
  const passes = walls.reduce((n, w) => n + w.passes, 0);
  const shots = walls.reduce((n, w) => n + w.shots, 0);
  const offenders = walls.filter((w) => w.passes > 0).map((w) => `wall ${w.wallX} P${w.player + 1} from ${w.fromX} (${w.grid}, ${w.side}) ${w.passes}`);
  const tops = checkedWallColumns(level).map((column) => {
    const rows = walls.filter((w) => w.wallX === column.x1 && !w.highestYExempt);
    const highest = rows.length > 0 ? Math.min(...rows.map((w) => w.highestY)) : null;
    return { column, rows: rows.length, highest, clear: highest === null || highest > column.top - BALL_RADIUS };
  });
  return [
    { name: 'wall-pass-zero', pass: passes === 0, detail: `${passes}/${shots} passes${offenders.length > 0 ? `: ${offenders.join('; ')}` : ''}` },
    {
      name: 'wall-top-clear',
      pass: tops.every((t) => t.clear),
      detail: tops.map((t) => `wall ${t.column.x1} top ${t.column.top}: highest ball centre y ${t.highest ?? '-'} over ${t.rows} rows (needs > ${t.column.top - BALL_RADIUS})`).join('; '),
    },
  ];
}

function gapCriteria(gaps: readonly GapCrossResult[], lone: readonly LonePlateResult[]): Criterion[] {
  if (gaps.length === 0) return [];
  const crossings = gaps.reduce((n, g) => n + g.crossings, 0);
  const shots = gaps.reduce((n, g) => n + g.shots, 0);
  const falls = gaps.reduce((n, g) => n + g.falls, 0);
  const criteria: Criterion[] = [{ name: 'gap-crossing-zero', pass: crossings === 0, detail: `${crossings}/${shots} crossings with no plate held (${falls} falls)` }];
  if (lone.length > 0) {
    criteria.push({
      name: 'lone-plate-never-crosses',
      pass: lone.every((l) => !l.crossed),
      detail: lone.map((l) => `${l.switchId} ${fmtShot(l.shot)} → ${l.restX}${l.fell ? ' fell' : ''}${l.crossed ? ' CROSSED' : ''} (bridge drops ${l.bridgeDrops})`).join('; '),
    });
  }
  return criteria;
}

function optOutCriteria(checks: readonly OptOutCheck[]): Criterion[] {
  return checks.map((c) => ({ name: `opt-out: ${c.optOut.pass} ${c.optOut.skip}`, pass: c.valid, detail: `${describeOptOut(c.optOut)}; ${c.detail}` }));
}

function scriptedCriteria(level: Level, scripted: readonly ScriptedResult[]): Criterion[] {
  return scripted.map((line) => ({
    name: `scripted: ${line.name}`,
    pass: line.bothSunk && line.total <= level.par + 2,
    detail: line.bothSunk
      ? `${line.total} strokes (${line.strokes.join('+')}) vs par ${level.par}: ${line.beats.map((b) => `P${b.who + 1} ${b.shot !== null ? fmtShot(b.shot) : '?'} → ${b.restX ?? '?'}${b.sunk ? ' SINK' : ''} (${b.candidates}/grid)`).join(' · ')}`
      : `INCOMPLETE at "${line.failedAt ?? 'unknown'}" after ${line.beats.length} beats`,
  }));
}

function stallCriteria(stall: readonly StallResult[]): Criterion[] {
  if (stall.length === 0) return [];
  const bad = stall.filter((s) => !s.heldBefore || !s.reHeld || s.partnerFell);
  return [
    {
      name: 'stall-taps-safe',
      pass: bad.length === 0,
      detail:
        bad.length === 0
          ? `${stall.length} taps re-held their plate, 0 partner falls, ${stall.filter((s) => s.partnerAt === 'deck').length} with a partner on the deck`
          : bad.map((s) => `${s.switchId} ${fmtShot(s.tap)} partner@${s.partnerAt}: held before ${s.heldBefore}, re-held ${s.reHeld}, partner fell ${s.partnerFell}, rest x ${s.holderRestX}`).join('; '),
    },
  ];
}

function deckCriteria(deck: readonly DeckLipResult[]): Criterion[] {
  return deck.map((d) => ({
    name: `deck-lip: ${d.deckId}`,
    pass: d.lipPresses === 0 && d.deckPresses === d.deckSamples && d.deckSamples > 0,
    detail: `${d.lipPresses}/${d.lipSamples} lip rests press the deck, ${d.deckPresses}/${d.deckSamples} on-deck rests press it`,
  }));
}

function loneDeckCriteria(lone: readonly LoneDeckResult[]): Criterion[] {
  if (lone.length === 0) return [];
  const rolls = lone.filter((l) => l.shot.deg <= LONE_DECK_ROLL_MAX_DEG);
  const lobs = lone.filter((l) => l.shot.deg > LONE_DECK_ROLL_MAX_DEG);
  const badRolls = rolls.filter((l) => l.crossed || !l.fell);
  const lobsAcross = lobs.filter((l) => l.crossed);
  return [
    {
      name: 'deck-lone-roll-falls',
      pass: badRolls.length === 0 && rolls.length > 0,
      detail: badRolls.length === 0 ? `${rolls.length} rolls (≤ ${LONE_DECK_ROLL_MAX_DEG}°) by a lone deck ball all dropped into the chasm` : badRolls.map(fmtLoneDeck).join('; '),
    },
    {
      name: 'deck-lone-lob-crosses',
      pass: lobsAcross.length > 0,
      detail: `${lobsAcross.length}/${lobs.length} lobs by a lone deck ball reached the far side${lobsAcross.length > 0 ? ` (e.g. ${fmtLoneDeck(lobsAcross[0]!)})` : ''}`,
    },
  ];
}

function launcherCriteria(report: LauncherReport): Criterion[] {
  if (report.rows.length === 0 && report.uncovered.length === 0 && report.unknown.length === 0) return [];
  const drops = report.rows.reduce((n, r) => n + r.drops, 0);
  const rowText = (r: LauncherReport['rows'][number]): string =>
    `${r.rectId} P${r.player + 1} [${r.held.join(',')}] -> ${r.target} (${r.mode}): ${r.onTarget}/${r.drops}, rest x ${r.restX === null ? '-' : `${Math.round(r.restX[0])}-${Math.round(r.restX[1])}`}, apex y ${r.apexNominal} (worst ${r.apexWorst})${r.misses.length > 0 ? `; e.g. ${r.misses.join(' | ')}` : ''}`;
  return [
    {
      name: 'launchers-cover-every-launcher',
      pass: report.uncovered.length === 0 && report.unknown.length === 0 && report.rows.length > 0,
      detail: `${report.rows.length} rows${report.uncovered.length > 0 ? `; no case rides ${report.uncovered.join(', ')}` : ''}${report.unknown.length > 0 ? `; unknown cases ${report.unknown.join(', ')}` : ''}`,
    },
    { name: 'launchers-land-on-target', pass: report.rows.every((r) => r.onTarget === r.drops), detail: `${report.rows.reduce((n, r) => n + r.onTarget, 0)}/${drops} drops rest on their plate: ${report.rows.map(rowText).join('; ')}` },
    {
      name: 'launchers-fire-once',
      pass: report.rows.every((r) => r.refires === 0 && r.unfired === 0),
      detail: `${report.rows.reduce((n, r) => n + r.refires, 0)} re-fires, ${report.rows.reduce((n, r) => n + r.unfired, 0)} drops that never launched, longest flight ${Math.max(...report.rows.map((r) => r.longestTicks))} ticks`,
    },
  ];
}

function loopCriteria(loops: readonly LoopRow[]): Criterion[] {
  const flights = loops.reduce((n, l) => n + l.flights, 0);
  const running = loops.reduce((n, l) => n + l.running, 0);
  return [
    {
      name: 'loops-zero',
      pass: running === 0 && flights > 0,
      detail: loops.map((l) => `${l.config}: ${l.running}/${l.flights} flights reach the watchdog from ${l.spots} spots, longest settled ${l.longestTicks} ticks${l.examples.length > 0 ? ` (e.g. ${l.examples.join('; ')})` : ''}`).join(' | '),
    },
  ];
}

export const fmtRescue = (r: RescueRow): string => `${r.key.split('|')[0] ?? ''} waiting at (${Math.round(r.waitingAt.x * 10) / 10}, ${Math.round(r.waitingAt.y)}) holding [${r.held.join(',')}] (${r.where})`;

function trapsCriteria(t: TrapsReport): Criterion[] {
  const unrescued = t.rescues.filter((r) => !r.rescued);
  const missing = t.devices.filter((id) => !t.reached.includes(id));
  const depths = t.rescues.flatMap((r) => (r.depth === null ? [] : [r.depth]));
  const play = `${t.games} seeded games (${t.finished} finished) + ${t.deviations} line deviations = ${t.shots} shots in ${t.seconds}s`;
  const events = Object.entries(t.events)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return [
    { name: 'traps-tee-guard-never-runs', pass: t.teeResets === 0, detail: `${t.teeResets} send-to-tee guards in ${play}; ${events}` },
    {
      name: 'traps-reset-to-safe-spot',
      pass: t.resetMisses.length === 0 && t.maxResetsPerShot <= 2,
      detail: `${t.resets} scoped resets (BACK +1), at most ${t.maxResetsPerShot} per hand-off, ${t.resetMisses.length === 0 ? 'every one onto the spot its ball last stood free' : t.resetMisses.join('; ')}`,
    },
    { name: 'traps-safe-spots-free', pass: t.safeSpotMisses.length === 0, detail: t.safeSpotMisses.length === 0 ? `at every one of ${t.shots} turns each ball's safe spot is where it last stood free` : t.safeSpotMisses.join('; ') },
    { name: 'traps-strokes-accounted', pass: t.strokeMisses.length === 0, detail: t.strokeMisses.length === 0 ? 'every stroke is a hit, a gimme, a fall (+1) or a BACK +1' : t.strokeMisses.join('; ') },
    { name: 'traps-no-watchdog', pass: t.timeouts === 0 && t.timedOut === 0, detail: `${t.timeouts} watchdog endings, ${t.timedOut} stalled hand-offs` },
    {
      name: 'traps-every-device-reached',
      pass: missing.length === 0,
      detail: `${t.waitingTurns} turns with a waiting ball; reached ${t.reached.join(', ') || 'none'}${missing.length > 0 ? `; NEVER reached ${missing.join(', ')}` : ''}`,
    },
    {
      name: 'traps-rescuable',
      pass: unrescued.length === 0 && t.rescues.length > 0,
      detail: `${t.rescues.length - unrescued.length}/${t.rescues.length} distinct waiting states rescued (depth ${depths.length > 0 ? `${Math.min(...depths)}-${Math.max(...depths)}` : '-'}, ${t.rescues.reduce((n, r) => n + r.shots, 0)} search shots)${
        unrescued.length > 0 ? `; NOT: ${unrescued.slice(0, 5).map(fmtRescue).join('; ')}` : ''
      }`,
    },
  ];
}

export function verifyLevel(level: Level, opts: RunOptions): LevelReport {
  const t0 = performance.now();
  const want = (p: PassName): boolean => opts.passes.includes(p);
  const criteria: Criterion[] = [];
  const report: { -readonly [K in keyof LevelReport]?: LevelReport[K] } = {};
  if (want('coop')) {
    report.coop = searchCoop(level, opts);
    if (report.coop.game !== null) report.replayDeterministic = replayMatches(report.coop.game);
    criteria.push(...coopCriteria(level, report.coop, report.replayDeterministic));
  }
  if (want('wide')) {
    report.wide = searchCoop(level, wideOptions(opts));
    criteria.push(...parCriteria(level, report.wide, report.coop));
  }
  if (want('solo')) {
    report.solo = ([0, 1] as const).map((p) => searchSolo(level, p, { ...opts, depth: Math.max(opts.depth, 10), beam: Math.max(opts.beam, 40) }));
    criteria.push(...soloCriteria(level, report.solo));
  }
  if (want('aces')) {
    report.aces = aceSweep(level);
    criteria.push(...aceCriteria(report.aces));
  }
  if (want('walls')) {
    report.walls = wallPassSweep(level);
    criteria.push(...wallCriteria(level, report.walls));
  }
  if (want('gaps')) {
    report.gaps = gapCrossSweep(level);
    report.lonePlate = lonePlateCheck(level);
    criteria.push(...gapCriteria(report.gaps, report.lonePlate));
  }
  if (want('walls') || want('gaps')) {
    report.optOuts = checkOptOuts(level, report.walls ?? []).filter((c) => want(c.optOut.pass));
    criteria.push(...optOutCriteria(report.optOuts));
  }
  if (want('scripted')) {
    report.scripted = scriptedLinesOf(level).map((l) => replayScripted(level, l, opts.grid));
    criteria.push(...scriptedCriteria(level, report.scripted));
  }
  if (want('stall')) {
    report.stall = stallTapCheck(level);
    criteria.push(...stallCriteria(report.stall));
  }
  if (want('deck')) {
    report.deck = deckLipCheck(level);
    report.loneDeck = loneDeckCheck(level);
    criteria.push(...deckCriteria(report.deck), ...loneDeckCriteria(report.loneDeck));
  }
  if (want('launchers') && (hasLaunchers(level) || launcherCasesOf(level).length > 0)) {
    report.launchers = launcherCheck(level);
    criteria.push(...launcherCriteria(report.launchers));
  }
  if (want('loops') && (hasLaunchers(level) || hasWaitingDevices(level))) {
    report.loops = loopSweep(level);
    criteria.push(...loopCriteria(report.loops));
  }
  if (want('traps') && hasWaitingDevices(level)) {
    report.traps = trapsCheck(level, opts.games, opts.grid);
    criteria.push(...trapsCriteria(report.traps));
  }
  return { ...report, levelId: level.id, name: level.name, par: level.par, shotSpeed: SHOT_SPEED_PER_POWER, seconds: secondsSince(t0), criteria };
}

export function formatReport(report: LevelReport): string {
  const lines = [`== ${report.name} (${report.levelId}) par ${report.par}, shot speed ${report.shotSpeed}, ${report.seconds}s`];
  for (const c of report.criteria) lines.push(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  return `${lines.join('\n')}\n`;
}
