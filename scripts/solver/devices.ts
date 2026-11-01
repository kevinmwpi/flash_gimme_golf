// OWNER: levels
/**
 * The device passes of scripts/solver.ts (worlds-2-3 LEVELS.md "Build-time verification", BUILD_DECISIONS D10.13):
 *
 * - `launchers`: every spring and cannon ride of the intended lines, dropped onto every pad / breech x at 0.5 px
 *   for 9 launch perturbations (each component at 97 / 100 / 103 %, on a spread copy of the level) with the
 *   plates the line holds at that moment FIXED; a cannon is also fired LOADED (resting on its breech as it
 *   lights). Every drop must rest holding the target plate after exactly one launch.
 * - `loops`: single-ball flights with fixed switches (all plates up, then all held) from every restable spot
 *   every 20 px plus the plate and device spots, both colours, a both-ways grid with the stall taps: none may
 *   still be flying when the 1,800-tick flight watchdog (D10.6) would end it.
 * - `traps`: seeded random games from the tees (src/sim/rng, fixed seeds) plus one-shot deviations from every
 *   turn of every intended line, on the full sim: the send-to-tee guard never runs, every scoped reset lands
 *   where its ball last stood free and costs exactly one stroke, safe spots are recorded only where a ball
 *   stood free, no flight reaches the watchdog; and from every distinct caught / loaded state reached (deduped
 *   by device, free-ball cell and held plates) the free ball reaches a release or FIRE plate, or the cup that
 *   holds one, within a short search.
 */
import { onCannonBreech, releaseIdsOf, waitingOf } from '../../src/sim/devices';
import { launchVelocity, stepBall, switchPresser, type StepBallOut } from '../../src/sim/physics';
import { rngInt, seedRng } from '../../src/sim/rng';
import { collidersFor, groundAt, groundSupports, inGap, placeOnSurface, solidColliders, surfaceSlopeAt } from '../../src/sim/terrain';
import type { BallState, CannonRect, Level, LevelRect, PlayerId, SimEvent, SimState, SpringRect, Vec } from '../../src/sim/types';
import { BALL_RADIUS, FLIGHT_WATCHDOG_TICKS, REST_MAX_SLOPE, REST_TICKS } from '../../src/sim/types';
import { accountedStrokes, aimOf, allOff, allOn, cellGrid, fmtShot, heldList, newGame, onLitBreech, range, shotsOf, takeShot, type Game, type Grid, type Shot } from './game';
import { replayScripted, scriptedLinesOf } from './lines';
import { STALL_TAPS } from './plates';
import { bucketKey, isBroken, stateKey } from './search';
import { canShootFrom } from './sweeps';

const RED: PlayerId = 0;
const BLUE: PlayerId = 1;
const SLOTS: readonly PlayerId[] = [RED, BLUE];

type Launcher = SpringRect | CannonRect;

function isLauncher(rect: LevelRect): rect is Launcher {
  return rect.kind === 'spring' || rect.kind === 'cannon';
}

export function launchersOf(level: Level): Launcher[] {
  return level.rects.filter(isLauncher);
}

/** Traps and cannons: the devices a ball can wait in (D10.4). */
export function waitingDevicesOf(level: Level): LevelRect[] {
  return level.rects.filter((r) => r.kind === 'trap' || r.kind === 'cannon');
}

// ---------------------------------------------------------------------------------------------
// launchers
// ---------------------------------------------------------------------------------------------

/** A launcher ride of an intended line: who rides it, the plates held meanwhile, the plate it must land on. */
export type LauncherCase = { readonly levelId: string; readonly rectId: string; readonly player: PlayerId; readonly held: readonly string[]; readonly target: string };

/** Every ride of every intended line, both colours where both ride (the held plates are the line's at that moment). */
export const LAUNCHER_CASES: readonly LauncherCase[] = [
  { levelId: 'w2-05-spring-step', rectId: 'spring', player: BLUE, held: ['door'], target: 'top' },
  { levelId: 'w2-05-spring-step', rectId: 'spring', player: RED, held: ['top'], target: 'top' },
  { levelId: 'w2-07-load-and-fire', rectId: 'cannon', player: RED, held: ['fire'], target: 'fire-far' },
  { levelId: 'w2-07-load-and-fire', rectId: 'cannon', player: BLUE, held: ['fire-far'], target: 'fire-far' },
  { levelId: 'w2-08-colour-lift', rectId: 'spring', player: BLUE, held: [], target: 'window' },
  { levelId: 'w2-08-colour-lift', rectId: 'spring', player: RED, held: ['window'], target: 'door' },
  { levelId: 'w3-09-bait', rectId: 'spring', player: BLUE, held: ['bait'], target: 'top' },
  { levelId: 'w3-09-bait', rectId: 'spring', player: RED, held: ['top'], target: 'top' },
  { levelId: 'w3-10-sky-bridge', rectId: 'spring', player: RED, held: [], target: 'a' },
  { levelId: 'w3-10-sky-bridge', rectId: 'spring', player: BLUE, held: [], target: 'a' },
  { levelId: 'w3-10-sky-bridge', rectId: 'cannon', player: BLUE, held: ['a'], target: 'b' },
  { levelId: 'w3-10-sky-bridge', rectId: 'cannon', player: RED, held: ['a'], target: 'b' },
  { levelId: 'w3-11-crossfire', rectId: 'cannon', player: RED, held: ['fire'], target: 'far' },
  { levelId: 'w3-11-crossfire', rectId: 'cannon', player: BLUE, held: ['far'], target: 'far' },
  { levelId: 'w3-12-grand-machine', rectId: 'cannon', player: RED, held: ['fire'], target: 'top' },
  { levelId: 'w3-12-grand-machine', rectId: 'cannon', player: BLUE, held: ['top'], target: 'top' },
  { levelId: 'w3-12-grand-machine', rectId: 'spring', player: BLUE, held: ['door'], target: 'top' },
  { levelId: 'w3-12-grand-machine', rectId: 'spring', player: RED, held: ['top'], target: 'top' },
];

export const LAUNCH_STEP_PX = 0.5;
export const LAUNCH_PERTURBATIONS: readonly number[] = [0.97, 1, 1.03];

export type DropMode = 'drop' | 'loaded';

export type LauncherRow = {
  readonly rectId: string;
  readonly kind: Launcher['kind'];
  readonly player: PlayerId;
  readonly held: readonly string[];
  readonly target: string;
  readonly mode: DropMode;
  readonly drops: number;
  /** Rested holding the target plate after exactly one launch. */
  readonly onTarget: number;
  readonly refires: number;
  readonly unfired: number;
  readonly restX: readonly [number, number] | null;
  readonly apexNominal: number;
  readonly apexWorst: number;
  readonly longestTicks: number;
  readonly misses: readonly string[];
};

export type LauncherReport = {
  readonly rows: readonly LauncherRow[];
  /** Launcher rects of the level no case rides. */
  readonly uncovered: readonly string[];
  /** Cases naming a rect or plate the level does not have. */
  readonly unknown: readonly string[];
};

export function launcherCasesOf(level: Level): readonly LauncherCase[] {
  return LAUNCHER_CASES.filter((c) => c.levelId === level.id);
}

/** A spread copy of the level with one launcher's launch scaled per component (never recompiled). */
function withLaunch(level: Level, rectId: string, kx: number, ky: number): Level {
  return { ...level, rects: level.rects.map((r) => (r.id === rectId && isLauncher(r) ? { ...r, launch: { x: r.launch.x * kx, y: r.launch.y * ky } } : r)) };
}

type Drop = { readonly rest: Vec | null; readonly onTarget: boolean; readonly launches: number; readonly apex: number; readonly ticks: number };

/** One ball onto a pad at x with the switches FIXED: 'drop' falls from 1 px above it, 'loaded' rests on it as it lights. */
function dropOnto(level: Level, switches: Readonly<Record<string, boolean>>, pad: Launcher, x: number, player: PlayerId, target: string, mode: DropMode): Drop {
  const pos: Vec = { x, y: pad.y - BALL_RADIUS - (mode === 'drop' ? 1 : 0) };
  const ball: BallState =
    mode === 'drop'
      ? { pos, vel: { x: 0, y: 0 }, asleep: false, sunk: false, grounded: false, restTicks: 0, lastRest: pos }
      : { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos };
  const ctx = { level, switches, playerId: player, colliders: collidersFor(solidColliders(level, switches), player) };
  const plate = level.switches.find((s) => s.id === target);
  const out: StepBallOut = { events: [] };
  let launches = 0;
  let apex = pos.y;
  for (let t = 1; t <= FLIGHT_WATCHDOG_TICKS; t += 1) {
    stepBall(ball, ctx, out);
    launches += out.events.filter((e) => e.type === 'spring' || e.type === 'cannonFire').length;
    apex = Math.min(apex, ball.pos.y);
    if (ball.sunk || out.events.some((e) => e.type === 'fellOffWorld')) return { rest: null, onTarget: false, launches, apex, ticks: t };
    if (ball.asleep) {
      const balls: Readonly<BallState>[] = player === RED ? [ball] : [{ ...ball, sunk: true }, ball];
      const onTarget = plate !== undefined && switchPresser(level, plate, switches, balls) === player;
      return { rest: ball.pos, onTarget, launches, apex, ticks: t };
    }
    out.events.length = 0;
  }
  return { rest: null, onTarget: false, launches, apex, ticks: FLIGHT_WATCHDOG_TICKS };
}

function launcherRow(level: Level, c: LauncherCase, pad: Launcher, mode: DropMode): LauncherRow {
  const switches: Record<string, boolean> = allOff(level);
  for (const id of c.held) switches[id] = true;
  let drops = 0;
  let onTarget = 0;
  let refires = 0;
  let unfired = 0;
  let restX: [number, number] | null = null;
  let apexNominal = Infinity;
  let apexWorst = Infinity;
  let longestTicks = 0;
  const misses: string[] = [];
  for (const kx of LAUNCH_PERTURBATIONS) {
    for (const ky of LAUNCH_PERTURBATIONS) {
      const perturbed = withLaunch(level, pad.id, kx, ky);
      for (const x of range(pad.x, pad.x + pad.w, LAUNCH_STEP_PX)) {
        const d = dropOnto(perturbed, switches, pad, x, c.player, c.target, mode);
        drops += 1;
        if (d.launches >= 2) refires += 1;
        if (d.launches === 0) unfired += 1;
        apexWorst = Math.min(apexWorst, d.apex);
        if (kx === 1 && ky === 1) apexNominal = Math.min(apexNominal, d.apex);
        longestTicks = Math.max(longestTicks, d.ticks);
        if (d.rest !== null) restX = restX === null ? [d.rest.x, d.rest.x] : [Math.min(restX[0], d.rest.x), Math.max(restX[1], d.rest.x)];
        if (d.onTarget && d.launches === 1) onTarget += 1;
        else if (misses.length < 4) misses.push(`x ${x} k(${kx},${ky}) -> ${d.rest === null ? 'no rest' : `rest ${Math.round(d.rest.x)},${Math.round(d.rest.y)}`}, ${d.launches} launches`);
      }
    }
  }
  return { rectId: pad.id, kind: pad.kind, player: c.player, held: c.held, target: c.target, mode, drops, onTarget, refires, unfired, restX, apexNominal: Math.round(apexNominal), apexWorst: Math.round(apexWorst), longestTicks, misses };
}

export function launcherCheck(level: Level): LauncherReport {
  const rows: LauncherRow[] = [];
  const unknown: string[] = [];
  for (const c of launcherCasesOf(level)) {
    const pad = launchersOf(level).find((r) => r.id === c.rectId);
    const plates = level.switches.map((s) => s.id);
    if (pad === undefined || !plates.includes(c.target) || c.held.some((id) => !plates.includes(id))) {
      unknown.push(`${c.rectId} -> ${c.target}`);
      continue;
    }
    for (const mode of pad.kind === 'cannon' ? (['drop', 'loaded'] as const) : (['drop'] as const)) rows.push(launcherRow(level, c, pad, mode));
  }
  const uncovered = launchersOf(level)
    .filter((r) => !launcherCasesOf(level).some((c) => c.rectId === r.id))
    .map((r) => r.id);
  return { rows, uncovered, unknown };
}

// ---------------------------------------------------------------------------------------------
// loops
// ---------------------------------------------------------------------------------------------

export const LOOP_STEP_PX = 20;
/** Both ways, 5-175 deg step 10 x power 20-100 step 20, plus the four stall taps: 94 shots per spot. */
export const LOOP_SHOTS: readonly Shot[] = [...shotsOf({ angles: range(5, 175, 10), powers: range(20, 100, 20) }), ...STALL_TAPS];

export type LoopRow = {
  readonly config: 'plates up' | 'plates held';
  readonly spots: number;
  readonly flights: number;
  readonly running: number;
  readonly longestTicks: number;
  readonly examples: readonly string[];
};

/** Spots every LOOP_STEP_PX plus every plate, trap and breech centre (deduped, in x order). */
function loopSpotXs(level: Level): number[] {
  const xs = new Set<number>();
  for (let x = LOOP_STEP_PX; x <= level.width - LOOP_STEP_PX; x += LOOP_STEP_PX) xs.add(x);
  for (const sw of level.switches) if (sw.onRectId === undefined) xs.add(sw.x + sw.w / 2);
  for (const rect of waitingDevicesOf(level)) xs.add(rect.x + rect.w / 2);
  return [...xs].sort((a, b) => a - b);
}

/** A single ball shot from `from` with the switches FIXED: the ticks until it rests, sinks or falls, or null if the watchdog would end it. */
function soloFlightTicks(level: Level, switches: Readonly<Record<string, boolean>>, player: PlayerId, from: Vec, shot: Shot): number | null {
  const ball: BallState = { pos: from, vel: launchVelocity(aimOf(shot)), asleep: false, sunk: false, grounded: false, restTicks: 0, lastRest: from };
  const ctx = { level, switches, playerId: player, colliders: collidersFor(solidColliders(level, switches), player) };
  const out: StepBallOut = { events: [] };
  for (let t = 1; t <= FLIGHT_WATCHDOG_TICKS; t += 1) {
    stepBall(ball, ctx, out);
    if (ball.sunk || ball.asleep || out.events.some((e) => e.type === 'fellOffWorld')) return t;
    out.events.length = 0;
  }
  return null;
}

/** 0 flights reach the watchdog from any spot a ball can shoot from (criterion), per switch configuration. */
export function loopSweep(level: Level): LoopRow[] {
  return (['plates up', 'plates held'] as const).map((config) => {
    const switches = config === 'plates up' ? allOff(level) : allOn(level);
    let spots = 0;
    let flights = 0;
    let running = 0;
    let longestTicks = 0;
    const examples: string[] = [];
    for (const x of loopSpotXs(level)) {
      if (inGap(level, x) || surfaceSlopeAt(level, x) >= REST_MAX_SLOPE) continue;
      const from = placeOnSurface(level, x);
      for (const player of SLOTS) {
        if (!canShootFrom(level, player, from, switches) || onLitBreech(level, switches, from)) continue;
        spots += 1;
        for (const shot of LOOP_SHOTS) {
          const ticks = soloFlightTicks(level, switches, player, from, shot);
          flights += 1;
          if (ticks === null) {
            running += 1;
            if (examples.length < 5) examples.push(`P${player + 1} x ${x} ${fmtShot(shot)}`);
          } else longestTicks = Math.max(longestTicks, ticks);
        }
      }
    }
    return { config, spots, flights, running, longestTicks, examples };
  });
}

// ---------------------------------------------------------------------------------------------
// traps
// ---------------------------------------------------------------------------------------------

export const TRAPS_SEED = 0x7a95;
export const TRAPS_GAMES = 400;
export const TRAPS_SHOTS_PER_GAME = 30;
/** Free-ball cell of the rescue dedupe (with the waiting device and the held plates). */
export const RESCUE_CELL_PX = 32;
export const RESCUE_DEPTH = 4;
export const RESCUE_BEAM = 6;
export const RESCUE_GRID: Grid = cellGrid(16, 8);

/** Where each ball last stood free (D10.5's safe spot, re-derived by the solver at every turn). */
type FreeSpots = readonly [Vec, Vec];

type Turn = { readonly game: Game; readonly free: FreeSpots };

type Waiter = { readonly slot: PlayerId; readonly rect: LevelRect };

export type RescueRow = {
  readonly key: string;
  readonly where: string;
  /** Where the waiting ball sits, and the plates held, at the start of the search. */
  readonly waitingAt: Vec;
  readonly held: readonly string[];
  readonly rescued: boolean;
  readonly shots: number;
  readonly depth: number | null;
};

export type TrapsReport = {
  readonly games: number;
  readonly finished: number;
  readonly shots: number;
  readonly deviations: number;
  readonly events: Readonly<Record<'trapCaught' | 'trapFreed' | 'trapReturn' | 'cannonLoad' | 'cannonFire' | 'turnSkipped', number>>;
  readonly resets: number;
  readonly maxResetsPerShot: number;
  readonly teeResets: number;
  readonly timeouts: number;
  readonly timedOut: number;
  readonly resetMisses: readonly string[];
  readonly safeSpotMisses: readonly string[];
  readonly strokeMisses: readonly string[];
  /** Every trap reached CAUGHT / cannon reached LOADED at some turn (rect ids). */
  readonly reached: readonly string[];
  readonly devices: readonly string[];
  readonly waitingTurns: number;
  readonly rescues: readonly RescueRow[];
  readonly seconds: number;
};

const COUNTED = ['trapCaught', 'trapFreed', 'trapReturn', 'cannonLoad', 'cannonFire', 'turnSkipped'] as const;

function samePos(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The solver's own reading of D10.5: an asleep ball that is free, on permanent supporting ground and off every breech stands on a safe spot. */
function standsFree(level: Level, state: SimState, slot: PlayerId): boolean {
  const ball = state.balls[slot];
  if (ball.sunk || !ball.asleep || waitingOf(level, state.switches, ball) !== null || onCannonBreech(level, ball.pos)) return false;
  const g = groundAt(level, state.switches, ball.pos, slot);
  return g !== null && g.permanent && groundSupports(g, ball.pos);
}

function nextFree(level: Level, state: SimState, free: FreeSpots): FreeSpots {
  return [standsFree(level, state, RED) ? state.balls[RED].pos : free[RED], standsFree(level, state, BLUE) ? state.balls[BLUE].pos : free[BLUE]];
}

function waitersOf(level: Level, state: SimState): Waiter[] {
  const out: Waiter[] = [];
  for (const slot of SLOTS) {
    const waiting = waitingOf(level, state.switches, state.balls[slot]);
    const rect = waiting === null ? undefined : level.rects.find((r) => r.id === waiting.rectId);
    if (rect !== undefined) out.push({ slot, rect });
  }
  return out;
}

class TrapsRun {
  readonly events: Record<(typeof COUNTED)[number], number> = { trapCaught: 0, trapFreed: 0, trapReturn: 0, cannonLoad: 0, cannonFire: 0, turnSkipped: 0 };
  shots = 0;
  resets = 0;
  maxResetsPerShot = 0;
  teeResets = 0;
  timeouts = 0;
  timedOut = 0;
  waitingTurns = 0;
  readonly resetMisses: string[] = [];
  readonly safeSpotMisses: string[] = [];
  readonly strokeMisses: string[] = [];
  readonly reached = new Set<string>();
  /** One waiting turn per rescue key (device, free-ball cell, held plates). */
  readonly waiting = new Map<string, { readonly game: Game; readonly waiter: Waiter; readonly where: string }>();

  constructor(private readonly level: Level) {}

  /** One shot from `turn`, every invariant checked; null when the sim refused the shot. */
  play(turn: Turn, shot: Shot, origin: string): Turn | null {
    const level = this.level;
    const before = turn.game.state;
    const r = takeShot(turn.game, shot);
    if (r === null) return null;
    this.shots += 1;
    const s = r.summary;
    for (const e of r.events) if ((COUNTED as readonly string[]).includes(e.type)) this.events[e.type as (typeof COUNTED)[number]] += 1;
    if (s.timedOut) this.timedOut += 1;
    this.timeouts += s.timeouts;
    this.teeResets += s.teeResets;
    this.resets += s.resets;
    this.maxResetsPerShot = Math.max(this.maxResetsPerShot, s.resets + s.teeResets);
    const where = `${origin} ${fmtShot(shot)} by P${s.shooter + 1} at tick ${before.tick}`;
    this.checkResets(r.events, turn.free, where);
    for (const slot of SLOTS) {
      const added = r.game.state.players[slot].strokes - before.players[slot].strokes;
      const accounted = accountedStrokes(r.events, slot);
      if (added !== accounted && this.strokeMisses.length < 5) this.strokeMisses.push(`${where}: P${slot + 1} +${added} strokes, events account for +${accounted}`);
    }
    const free = nextFree(level, r.game.state, turn.free);
    for (const slot of SLOTS) {
      const ball = r.game.state.balls[slot];
      if (!ball.sunk && !samePos(ball.lastRest, free[slot]) && this.safeSpotMisses.length < 5) {
        this.safeSpotMisses.push(`${where}: P${slot + 1} safe spot ${fmtPos(ball.lastRest)}, last stood free at ${fmtPos(free[slot])}`);
      }
    }
    this.noteWaiting(r.game, where);
    return { game: r.game, free };
  }

  private checkResets(events: readonly SimEvent[], free: FreeSpots, where: string): void {
    for (const e of events) {
      if (e.type !== 'trapReturn' || e.toTee) continue;
      if (!samePos(e.respawnPos, free[e.playerId]) && this.resetMisses.length < 5) {
        this.resetMisses.push(`${where}: P${e.playerId + 1} BACK +1 to ${fmtPos(e.respawnPos)}, last stood free at ${fmtPos(free[e.playerId])}`);
      }
    }
  }

  private noteWaiting(game: Game, where: string): void {
    if (game.state.phase !== 'aiming') return;
    const waiters = waitersOf(this.level, game.state);
    const waiter = waiters[0];
    if (waiter === undefined) return;
    this.waitingTurns += 1;
    for (const w of waiters) this.reached.add(w.rect.id);
    const shooter = game.state.balls[game.state.activePlayer];
    const cell = `${Math.round(shooter.pos.x / RESCUE_CELL_PX)},${Math.round(shooter.pos.y / RESCUE_CELL_PX)}`;
    const held = Object.keys(game.state.switches)
      .filter((id) => game.state.switches[id] === true)
      .sort()
      .join(',');
    const key = `${waiters.map((w) => `P${w.slot + 1}:${w.rect.id}`).join('+')}|${cell}|${held}`;
    if (!this.waiting.has(key)) this.waiting.set(key, { game, waiter, where });
  }
}

function fmtPos(p: Vec): string {
  return `(${Math.round(p.x)}, ${Math.round(p.y)})`;
}

function startTurn(level: Level): Turn {
  return { game: newGame(level), free: [level.starts[RED], level.starts[BLUE]] };
}

/** Seeded random games from the tees: uniform angle 2-178 deg and power 10-100, drawn from mulberry32. */
function randomGames(run: TrapsRun, level: Level, games: number): number {
  let rng = seedRng(TRAPS_SEED + level.order);
  let finished = 0;
  for (let g = 0; g < games; g += 1) {
    let turn: Turn | null = startTurn(level);
    for (let i = 0; i < TRAPS_SHOTS_PER_GAME && turn !== null && turn.game.state.phase === 'aiming'; i += 1) {
      const [r1, angle] = rngInt(rng, 177);
      const [r2, power] = rngInt(r1, 91);
      rng = r2;
      turn = run.play(turn, { deg: 2 + angle, power: 10 + power }, `game ${g}`);
    }
    if (turn !== null && turn.game.state.phase === 'levelResults') finished += 1;
  }
  return finished;
}

/** Every grid shot from every turn of every intended line (one shot off the line, the realistic mistakes). */
function lineDeviations(run: TrapsRun, level: Level, grid: Grid): number {
  let deviations = 0;
  for (const line of scriptedLinesOf(level)) {
    const replay = replayScripted(level, line, grid);
    let turn: Turn | null = startTurn(level);
    for (const beat of replay.beats) {
      if (turn === null || beat.shot === null) break;
      for (const shot of shotsOf(grid)) {
        run.play(turn, shot, `${line.name} beat "${beat.what}" deviation`);
        deviations += 1;
      }
      turn = run.play(turn, beat.shot, line.name);
    }
  }
  return deviations;
}

/** Distance from the free ball to the nearest release / FIRE plate (or the cup, when it holds one). */
function rescueDistance(level: Level, state: SimState, targets: readonly Vec[]): number {
  const ball = state.balls[state.activePlayer];
  return Math.min(...targets.map((t) => Math.abs(ball.pos.x - t.x) + 0.5 * Math.abs(ball.pos.y - t.y)));
}

/**
 * From a turn where `waiter` waits, a beam search over the free ball's shots (the WAITING rule gives it every
 * turn) for a shot after which one of the device's plates is held: a release / FIRE plate, or the cup.
 */
function rescueSearch(level: Level, start: Game, waiter: Waiter): { rescued: boolean; shots: number; depth: number | null } {
  const { switchIds, cup } = releaseIdsOf(level, waiter.rect);
  const targets: Vec[] = level.switches.filter((s) => switchIds.includes(s.id)).map((s) => ({ x: s.x + s.w / 2, y: s.surfaceY }));
  if (cup) targets.push({ x: level.hole.x, y: level.hole.rimY });
  const held = (state: SimState): boolean => switchIds.some((id) => state.switches[id] === true);
  const seen = new Set<string>([stateKey(level, start.state)]);
  let frontier: Game[] = [start];
  let shots = 0;
  for (let depth = 1; depth <= RESCUE_DEPTH && frontier.length > 0; depth += 1) {
    const buckets = new Map<string, Game[]>();
    for (const game of frontier) {
      for (const shot of shotsOf(RESCUE_GRID)) {
        const r = takeShot(game, shot);
        shots += 1;
        if (r === null || isBroken(r.summary)) continue;
        if (held(r.game.state)) return { rescued: true, shots, depth };
        if (r.game.state.phase !== 'aiming') continue;
        const key = stateKey(level, r.game.state);
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = bucketKey(level, r.game.state);
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), r.game]);
      }
    }
    frontier = [...buckets.values()].flatMap((list) => list.sort((a, b) => rescueDistance(level, a.state, targets) - rescueDistance(level, b.state, targets)).slice(0, RESCUE_BEAM));
  }
  return { rescued: false, shots, depth: null };
}

export function trapsCheck(level: Level, games: number, grid: Grid): TrapsReport {
  const t0 = performance.now();
  const run = new TrapsRun(level);
  const finished = randomGames(run, level, games);
  const deviations = lineDeviations(run, level, grid);
  const rescues: RescueRow[] = [...run.waiting.entries()].map(([key, w]) => ({
    key,
    where: w.where,
    waitingAt: w.game.state.balls[w.waiter.slot].pos,
    held: heldList(w.game.state.switches),
    ...rescueSearch(level, w.game, w.waiter),
  }));
  return {
    games,
    finished,
    shots: run.shots,
    deviations,
    events: run.events,
    resets: run.resets,
    maxResetsPerShot: run.maxResetsPerShot,
    teeResets: run.teeResets,
    timeouts: run.timeouts,
    timedOut: run.timedOut,
    resetMisses: run.resetMisses,
    safeSpotMisses: run.safeSpotMisses,
    strokeMisses: run.strokeMisses,
    reached: [...run.reached].sort(),
    devices: waitingDevicesOf(level).map((r) => r.id),
    waitingTurns: run.waitingTurns,
    rescues,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
}
