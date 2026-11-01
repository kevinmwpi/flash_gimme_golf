// OWNER: levels
/**
 * The solver's game driver (scripts/solver.ts): shots and grids in designer units, crafted balls, and full
 * two-ball games on the real sim (`createSim` / `stepSim`), one shot at a time. Every shot is settled up to
 * the next turn (WAITING rule, partner-fired cannons, scoped resets and the flight watchdog included) and
 * summarised for the passes: where the shooter came to rest, what it holds, which device moments it caused.
 */
import { breechAt, isCannonLit, onCannonBreech, waitingOf, type WaitReason } from '../../src/sim/devices';
import { levelById } from '../../src/sim/levels/index';
import { evaluateSwitches } from '../../src/sim/physics';
import { createSim, stepSim } from '../../src/sim/sim';
import { groundAt, groundSupports, placeOnSurface, rectContains } from '../../src/sim/terrain';
import type { Aim, BallState, GateColour, Level, PlayerCommand, PlayerId, ReplayEntry, SimConfig, SimEvent, SimState, Vec } from '../../src/sim/types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  BACK_PENALTY,
  FALL_PENALTY,
  FLIGHT_WATCHDOG_TICKS,
  MAX_POWER,
  MIN_POWER,
  REST_TICKS,
  TURN_DELAY_TICKS,
  quantize1,
  quantize4,
} from '../../src/sim/types';

// ---------------------------------------------------------------------------------------------
// Shots and grids
// ---------------------------------------------------------------------------------------------

/** A shot in designer units: degrees above the horizontal (0 = right, 90 = up, 180 = left) and power. */
export type Shot = { readonly deg: number; readonly power: number };
export type Grid = { readonly angles: readonly number[]; readonly powers: readonly number[] };

/**
 * Ticks one shot may take before the solver calls it `timedOut`: the flight watchdog ends any flight on its
 * FLIGHT_WATCHDOG_TICKS-th tick, a scoped reset that wakes a ball can start one more, then the hand-off
 * delay. A watchdog therefore always shows up as `timeouts` (flightTimeout events), never as `timedOut`;
 * `timedOut` means the sim never handed the turn on.
 */
export const MAX_SHOT_TICKS = 2 * FLIGHT_WATCHDOG_TICKS + TURN_DELAY_TICKS;
/** predictShot horizon of the single-shot sweeps (a flight the watchdog would end reports 'running'). */
export const MAX_PREDICT_TICKS = FLIGHT_WATCHDOG_TICKS;
/** Dedupe cell of the searches (a ball centre rounded to 8 px). */
export const DEDUPE_CELL_PX = 8;

export function aimOf(shot: Shot): Aim {
  const angle = quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-shot.deg * Math.PI) / 180)));
  const power = quantize1(Math.min(MAX_POWER, Math.max(MIN_POWER, shot.power)));
  return { angle, power };
}

export function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Cell centres across the legal aim range and the power range (ARCH: "16 x 8 shot grid"). */
export function cellGrid(angleCells: number, powerCells: number): Grid {
  const minDeg = (-AIM_ANGLE_MAX * 180) / Math.PI;
  const maxDeg = (-AIM_ANGLE_MIN * 180) / Math.PI;
  const angles: number[] = [];
  const powers: number[] = [];
  for (let i = 0; i < angleCells; i += 1) angles.push(minDeg + ((maxDeg - minDeg) * (i + 0.5)) / angleCells);
  for (let i = 0; i < powerCells; i += 1) powers.push(MIN_POWER + ((MAX_POWER - MIN_POWER) * (i + 0.5)) / powerCells);
  return { angles, powers };
}

/** LEVELS.md human-range sweep: 5-90 deg step 5 x power 20-100 step 10 = 162 shots. */
export const HUMAN_GRID: Grid = { angles: range(5, 90, 5), powers: range(20, 100, 10) };
/** Continuous-aim wall/gap/ace check: the full forward sweep 1-89 deg step 1 x power 95/97/100 = 267 shots. */
export const FINE_GRID: Grid = { angles: range(1, 89, 1), powers: [95, 97, 100] };

/** The same grid aimed leftward (deg -> 180 - deg): "mirrored for leftward shots" (worlds-2-3 LEVELS.md). */
export function mirrored(grid: Grid): Grid {
  return { angles: grid.angles.map((deg) => 180 - deg), powers: grid.powers };
}

export function shotsOf(grid: Grid): Shot[] {
  const out: Shot[] = [];
  for (const deg of grid.angles) for (const power of grid.powers) out.push({ deg, power });
  return out;
}

export const fmtShot = (s: Shot): string => `${Math.round(s.deg)}°/${Math.round(s.power)}`;

// ---------------------------------------------------------------------------------------------
// Balls and switches
// ---------------------------------------------------------------------------------------------

export function restingBall(pos: Vec, lastRest: Vec = pos): BallState {
  return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest };
}

/**
 * True where the sim could record a ball's safe spot (D10.5): permanent supporting ground, outside every trap
 * zone and off every cannon breech. A crafted ball anywhere else gets its tee as its safe spot, so a fall or a
 * scoped reset in a crafted check never returns it into a device or onto a bridge.
 */
export function isSafeSpot(level: Level, pos: Vec, player: PlayerId): boolean {
  if (onCannonBreech(level, pos) || level.rects.some((r) => r.kind === 'trap' && rectContains(r, pos))) return false;
  const g = groundAt(level, {}, pos, player);
  return g !== null && g.permanent && groundSupports(g, pos);
}

/** A crafted ball of `player` resting at `pos`, with a safe spot the sim could have recorded. */
export function craftedBall(level: Level, player: PlayerId, pos: Vec): BallState {
  return restingBall(pos, isSafeSpot(level, pos, player) ? pos : level.starts[player]);
}

export function otherOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function inSlotOrder(player: PlayerId, mine: BallState, partner: BallState): [BallState, BallState] {
  return player === 0 ? [mine, partner] : [partner, mine];
}

export function allOff(level: Level): Record<string, boolean> {
  const switches: Record<string, boolean> = {};
  for (const sw of level.switches) switches[sw.id] = false;
  return switches;
}

/** Every plate held: doors open, bridges up, traps released, cannons lit. */
export function allOn(level: Level): Record<string, boolean> {
  const switches: Record<string, boolean> = {};
  for (const sw of level.switches) switches[sw.id] = true;
  return switches;
}

/** Switch state implied by RESTING balls: two passes so a deck plate on a rect the first pass activated resolves. */
export function settledSwitches(level: Level, balls: readonly BallState[]): Record<string, boolean> {
  const switches = evaluateSwitches(level, allOff(level), balls);
  return evaluateSwitches(level, switches, balls);
}

export function heldList(switches: Readonly<Record<string, boolean>>): string[] {
  return Object.keys(switches)
    .filter((id) => switches[id] === true)
    .sort();
}

export function onFairway(level: Level, x: number): Vec {
  return placeOnSurface(level, x);
}

/** True when `pos` sits on the breech of a LIT cannon (a ball resting there fires at once, so it never shoots from it). */
export function onLitBreech(level: Level, switches: Readonly<Record<string, boolean>>, pos: Vec): boolean {
  const cannon = breechAt(level, pos);
  return cannon !== null && isCannonLit(cannon, switches);
}

// ---------------------------------------------------------------------------------------------
// Game driver (full sim: turn order, the WAITING rule, held plates, cupHoldsSwitch, falls, resets)
// ---------------------------------------------------------------------------------------------

export type Game = { readonly config: SimConfig; readonly state: SimState; readonly log: readonly ReplayEntry[] };

export type ShotSummary = {
  readonly shooter: PlayerId;
  readonly shot: Shot;
  readonly restX: number;
  readonly restY: number;
  readonly sunk: boolean;
  readonly fell: boolean;
  readonly partnerFell: boolean;
  readonly partnerSunk: boolean;
  /** The sim never handed the turn on within MAX_SHOT_TICKS. */
  readonly timedOut: boolean;
  readonly switches: Readonly<Record<string, boolean>>;
  readonly sand: boolean;
  readonly gatePass: readonly GateColour[];
  readonly hazardBlock: readonly GateColour[];
  readonly bridgeTouched: boolean;
  readonly bridgeDrops: number;
  /** The shooter after the hand-off: caught in a trap or loaded in a cold cannon (D10.4), else null. */
  readonly waiting: WaitReason | null;
  readonly partnerWaiting: WaitReason | null;
  /** The shooter left a lit breech (`cannonFire`). */
  readonly fired: boolean;
  /** The partner's LOADED ball fired during this shot (the shooter's landing lit its cannon). */
  readonly partnerFired: boolean;
  /** The partner's trap opened during this shot (`trapFreed`). */
  readonly partnerFreed: boolean;
  /** Scoped resets (`trapReturn`, BACK +1), either ball. */
  readonly resets: number;
  /** Send-to-tee guards (`trapReturn` with `toTee`), either ball: a valid level never runs one. */
  readonly teeResets: number;
  /** Flight-watchdog endings (`flightTimeout`), either ball: a valid level never reaches one. */
  readonly timeouts: number;
  /** Turns the WAITING rule skipped at the hand-off (`turnSkipped`). */
  readonly skips: number;
};

export type ShotOutcome = { readonly game: Game; readonly summary: ShotSummary; readonly events: readonly SimEvent[] };

export function configFor(level: Level): SimConfig {
  return { playerCount: 2, levelIds: [level.id], seed: 1, mode: 'local' };
}

/** Steps until the next shot can be taken (or the level ends); `timedOut` after MAX_SHOT_TICKS. */
function settle(state: SimState, events: SimEvent[]): { state: SimState; timedOut: boolean } {
  let current = state;
  for (let ticks = 0; current.phase === 'flying' || (current.phase === 'aiming' && current.turnDelayTicks > 0); ticks += 1) {
    if (ticks >= MAX_SHOT_TICKS) return { state: current, timedOut: true };
    const r = stepSim(current, []);
    current = r.state;
    events.push(...r.events);
  }
  return { state: current, timedOut: false };
}

/** A fresh game on `level`, past the intro card, ready for the first shot. */
export function newGame(level: Level): Game {
  const config = configFor(level);
  const start = createSim(config);
  const cont: PlayerCommand = { type: 'continue', playerId: 0 };
  const events: SimEvent[] = [];
  const stepped = stepSim(start.state, [cont]);
  events.push(...stepped.events);
  const { state } = settle(stepped.state, events);
  if (state.phase !== 'aiming') {
    throw new Error(`solver: the sim did not reach "aiming" after continue (phase "${state.phase}"); is stepSim still a stub?`);
  }
  return { config, state, log: [{ tick: start.state.tick, cmd: cont }] };
}

/**
 * The same game with the balls (and the switch state they imply) replaced; the replay log no longer applies.
 * The sim's `shoot` does not check WAITING (the hand-off guarantees a free shooter), so a crafted state that
 * makes a caught or loaded ball active would test a state the game never produces: refused.
 */
export function withBalls(game: Game, balls: [BallState, BallState], active: PlayerId): Game {
  const level = levelById(game.state.levelId);
  const switches = settledSwitches(level, balls);
  if (waitingOf(level, switches, balls[active]) !== null) throw new Error(`solver: crafted state makes the waiting P${active + 1} ball active on ${level.id}`);
  const state: SimState = { ...game.state, balls, switches, activePlayer: active, turnDelayTicks: 0, phase: 'aiming', flightTicks: 0 };
  return { config: game.config, state, log: [] };
}

function count(events: readonly SimEvent[], test: (e: SimEvent) => boolean): number {
  return events.filter(test).length;
}

function summarise(level: Level, shooter: PlayerId, shot: Shot, state: SimState, events: readonly SimEvent[], timedOut: boolean): ShotSummary {
  const ball = state.balls[shooter];
  const partner = otherOf(shooter);
  const mine = events.filter((e) => 'playerId' in e && e.playerId === shooter);
  const theirs = events.filter((e) => 'playerId' in e && e.playerId === partner);
  return {
    shooter,
    shot,
    restX: ball.pos.x,
    restY: ball.pos.y,
    sunk: ball.sunk,
    fell: mine.some((e) => e.type === 'fellOffWorld'),
    partnerFell: theirs.some((e) => e.type === 'fellOffWorld'),
    partnerSunk: state.balls[partner].sunk,
    timedOut,
    switches: state.switches,
    sand: mine.some((e) => e.type === 'enterSand'),
    gatePass: mine.flatMap((e) => (e.type === 'gatePass' ? [e.colour] : [])),
    hazardBlock: mine.flatMap((e) => (e.type === 'hazardBlock' ? [e.colour] : [])),
    bridgeTouched: mine.some((e) => (e.type === 'bounce' && e.surface === 'bridge') || (e.type === 'ballRest' && !e.onPermanentGround)),
    bridgeDrops: count(events, (e) => e.type === 'bridgeToggle' && e.kind === 'bridge' && !e.active),
    waiting: waitingOf(level, state.switches, ball)?.reason ?? null,
    partnerWaiting: waitingOf(level, state.switches, state.balls[partner])?.reason ?? null,
    fired: mine.some((e) => e.type === 'cannonFire'),
    partnerFired: theirs.some((e) => e.type === 'cannonFire'),
    partnerFreed: theirs.some((e) => e.type === 'trapFreed'),
    resets: count(events, (e) => e.type === 'trapReturn' && !e.toTee),
    teeResets: count(events, (e) => e.type === 'trapReturn' && e.toTee),
    timeouts: count(events, (e) => e.type === 'flightTimeout'),
    skips: count(events, (e) => e.type === 'turnSkipped'),
  };
}

/** Aims and shoots for the active player, then settles. null when the sim rejected the shot. */
export function takeShot(game: Game, shot: Shot): ShotOutcome | null {
  const shooter = game.state.activePlayer;
  const level = levelById(game.state.levelId);
  const aim = aimOf(shot);
  const setAim: PlayerCommand = { type: 'setAim', playerId: shooter, angle: aim.angle, power: aim.power };
  const shoot: PlayerCommand = { type: 'shoot', playerId: shooter };
  const tick = game.state.tick;
  const events: SimEvent[] = [];
  const first = stepSim(game.state, [setAim, shoot]);
  events.push(...first.events);
  if (first.state.phase !== 'flying') return null;
  const { state, timedOut } = settle(first.state, events);
  const log = [...game.log, { tick, cmd: setAim }, { tick, cmd: shoot }];
  return { game: { config: game.config, state, log }, summary: summarise(level, shooter, shot, state, events, timedOut), events };
}

/** Strokes the events of one shot add to `player`: its hits, gimmes, falls (+1 each) and scoped resets (+1 each). */
export function accountedStrokes(events: readonly SimEvent[], player: PlayerId): number {
  let strokes = 0;
  for (const e of events) {
    if (!('playerId' in e) || e.playerId !== player) continue;
    if (e.type === 'ballHit' || e.type === 'gimme') strokes += 1;
    else if (e.type === 'fellOffWorld') strokes += FALL_PENALTY;
    else if (e.type === 'trapReturn') strokes += BACK_PENALTY;
  }
  return strokes;
}
