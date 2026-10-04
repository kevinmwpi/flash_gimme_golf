// OWNER: levels
/**
 * World 1 level solver and verification passes (ARCH.md §4 "levels-solver" row, BUILD_DECISIONS D4).
 *
 * Built on the NEW sim only:
 * - `createSim` / `stepSim` / `runReplay` drive full two-ball games (turn order, held plates,
 *   `cupHoldsSwitch`, partners falling off a vanished bridge) for the co-op beam search, the
 *   scripted-line replays and the stall-tap checks;
 * - `predictShot` (with the partner passed as `otherBalls`) runs the single-shot sweeps (aces, wall
 *   passes, gap crossings) and the solo-bypass chains;
 * - `evaluateSwitches` answers "who presses what" for the deck-lip check; the lone-deck check then
 *   shoots a parked deck ball through the full sim (a roll always drops the bridge under it, a lob
 *   that carries to the far lip crosses: the rule the L4 copy teaches).
 *
 *   npm run solve -- <levelId|all> [--pass coop,wide,solo,aces,walls,gaps,scripted,stall,deck]
 *                   [--depth N] [--beam N] [--wideBeam N] [--angles N] [--powers N] [--maxSeconds S] [--json out.json]
 *
 * `coop` is the prescribed beam-6 search, `wide` the same search at `--wideBeam` (default 60) whose
 * minimum calibrates par (par - PAR_SLACK <= minimum <= par, see parCriteria). Exit code 0 when every applicable criterion
 * passes, 1 when one fails, 2 on bad arguments. Levels are parameterised by id; the scripted lines
 * are keyed by campaign order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LEVELS, hasLevel, levelById } from '../src/sim/levels/index';
import { evaluateSwitches, predictShot } from '../src/sim/physics';
import { createSim, runReplay, stepSim } from '../src/sim/sim';
import { placeOnSurface } from '../src/sim/terrain';
import type {
  Aim,
  BallState,
  BlockerRect,
  BridgeRect,
  ColourGateRect,
  GateColour,
  Level,
  LevelRect,
  PlayerCommand,
  PlayerId,
  PressureSwitch,
  ReplayEntry,
  SimConfig,
  SimEvent,
  SimState,
  Vec,
} from '../src/sim/types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  BALL_RADIUS,
  MAX_POWER,
  MIN_POWER,
  PLAYER_GATE_COLOUR,
  REST_TICKS,
  SHOT_SPEED_PER_POWER,
  quantize1,
  quantize4,
} from '../src/sim/types';

// ---------------------------------------------------------------------------------------------
// Shots and grids
// ---------------------------------------------------------------------------------------------

/** A shot in designer units: degrees above the horizontal (0 = right, 90 = up, 180 = left) and power. */
export type Shot = { readonly deg: number; readonly power: number };
export type Grid = { readonly angles: readonly number[]; readonly powers: readonly number[] };

const MAX_SHOT_TICKS = 1800;
const MAX_PREDICT_TICKS = 1800;
const DEDUPE_CELL_PX = 8;

export function aimOf(shot: Shot): Aim {
  const angle = quantize4(Math.min(AIM_ANGLE_MAX, Math.max(AIM_ANGLE_MIN, (-shot.deg * Math.PI) / 180)));
  const power = quantize1(Math.min(MAX_POWER, Math.max(MIN_POWER, shot.power)));
  return { angle, power };
}

function range(from: number, to: number, step: number): number[] {
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
/** The wide co-op run (beam >= 60 per bucket) whose minimum calibrates par. */
export const WIDE_BEAM = 60;
export const WIDE_MIN_DEPTH = 8;

function shotsOf(grid: Grid): Shot[] {
  const out: Shot[] = [];
  for (const deg of grid.angles) for (const power of grid.powers) out.push({ deg, power });
  return out;
}

const fmtShot = (s: Shot): string => `${Math.round(s.deg)}°/${Math.round(s.power)}`;

// ---------------------------------------------------------------------------------------------
// Ball and switch helpers
// ---------------------------------------------------------------------------------------------

export function restingBall(pos: Vec): BallState {
  return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: pos };
}

function otherOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function inSlotOrder(player: PlayerId, mine: BallState, partner: BallState): [BallState, BallState] {
  return player === 0 ? [mine, partner] : [partner, mine];
}

/** Switch state implied by RESTING balls: two passes so a deck plate on a rect the first pass activated resolves. */
export function settledSwitches(level: Level, balls: readonly BallState[]): Record<string, boolean> {
  let switches: Record<string, boolean> = {};
  for (const sw of level.switches) switches[sw.id] = false;
  switches = evaluateSwitches(level, switches, balls);
  return evaluateSwitches(level, switches, balls);
}

function heldList(switches: Readonly<Record<string, boolean>>): string[] {
  return Object.keys(switches)
    .filter((id) => switches[id] === true)
    .sort();
}

function isWall(rect: LevelRect): rect is BlockerRect | ColourGateRect {
  return rect.kind === 'blocker' || rect.kind === 'colourGate';
}

function bridgesOf(level: Level): BridgeRect[] {
  return level.rects.filter((r): r is BridgeRect => r.kind === 'bridge');
}

function onFairway(level: Level, x: number): Vec {
  return placeOnSurface(level, x);
}

// ---------------------------------------------------------------------------------------------
// Game driver (full sim: turn order, held plates, cupHoldsSwitch, falling partners)
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
  readonly timedOut: boolean;
  readonly switches: Readonly<Record<string, boolean>>;
  readonly sand: boolean;
  readonly gatePass: readonly GateColour[];
  readonly hazardBlock: readonly GateColour[];
  readonly bridgeTouched: boolean;
  readonly bridgeDrops: number;
};

export type ShotOutcome = { readonly game: Game; readonly summary: ShotSummary };

function configFor(level: Level): SimConfig {
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

/** The same game with the balls (and the switch state they imply) replaced; the replay log no longer applies. */
export function withBalls(game: Game, balls: [BallState, BallState], active: PlayerId): Game {
  const level = levelById(game.state.levelId);
  const state: SimState = { ...game.state, balls, switches: settledSwitches(level, balls), activePlayer: active, turnDelayTicks: 0, phase: 'aiming' };
  return { config: game.config, state, log: [] };
}

function summarise(shooter: PlayerId, shot: Shot, state: SimState, events: readonly SimEvent[], timedOut: boolean): ShotSummary {
  const ball = state.balls[shooter];
  const mine = events.filter((e) => 'playerId' in e && e.playerId === shooter);
  return {
    shooter,
    shot,
    restX: ball.pos.x,
    restY: ball.pos.y,
    sunk: ball.sunk,
    fell: mine.some((e) => e.type === 'fellOffWorld'),
    partnerFell: events.some((e) => e.type === 'fellOffWorld' && e.playerId !== shooter),
    timedOut,
    switches: state.switches,
    sand: mine.some((e) => e.type === 'enterSand'),
    gatePass: mine.flatMap((e) => (e.type === 'gatePass' ? [e.colour] : [])),
    hazardBlock: mine.flatMap((e) => (e.type === 'hazardBlock' ? [e.colour] : [])),
    bridgeTouched: mine.some((e) => (e.type === 'bounce' && e.surface === 'bridge') || (e.type === 'ballRest' && !e.onPermanentGround)),
    bridgeDrops: events.filter((e) => e.type === 'bridgeToggle' && e.kind === 'bridge' && !e.active).length,
  };
}

/** Aims and shoots for the active player, then settles. null when the sim rejected the shot. */
export function takeShot(game: Game, shot: Shot): ShotOutcome | null {
  const shooter = game.state.activePlayer;
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
  return { game: { config: game.config, state, log }, summary: summarise(shooter, shot, state, events, timedOut) };
}

// ---------------------------------------------------------------------------------------------
// Co-op beam search (bucketed by sunk flags x held switches x active player)
// ---------------------------------------------------------------------------------------------

export type LineStep = {
  readonly player: PlayerId;
  readonly shot: Shot;
  readonly restX: number;
  readonly restY: number;
  readonly sunk: boolean;
  readonly fell: boolean;
  readonly held: readonly string[];
};

export type SearchOptions = { readonly depth: number; readonly beam: number; readonly grid: Grid; readonly maxSeconds: number };

export type CoopResult = {
  readonly solved: boolean;
  readonly strokes: readonly [number, number] | null;
  readonly total: number | null;
  readonly line: readonly LineStep[];
  readonly game: Game | null;
  readonly expanded: number;
  readonly seconds: number;
  readonly truncated: boolean;
};

type Node = { readonly game: Game; readonly line: readonly LineStep[] };

function stepOf(summary: ShotSummary): LineStep {
  return {
    player: summary.shooter,
    shot: summary.shot,
    restX: Math.round(summary.restX),
    restY: Math.round(summary.restY),
    sunk: summary.sunk,
    fell: summary.fell,
    held: heldList(summary.switches),
  };
}

function stateKey(state: SimState): string {
  const balls = state.balls
    .map((b) => (b.sunk ? 'S' : `${Math.round(b.pos.x / DEDUPE_CELL_PX)},${Math.round(b.pos.y / DEDUPE_CELL_PX)}`))
    .join('|');
  return `${balls}#${state.activePlayer}#${heldList(state.switches).join(',')}`;
}

function bucketKey(state: SimState): string {
  return `${state.balls.map((b) => (b.sunk ? 1 : 0)).join('')}|${heldList(state.switches).join(',')}|${state.activePlayer}`;
}

function distanceToCup(level: Level, state: SimState): number {
  let total = 0;
  for (const ball of state.balls) {
    if (ball.sunk) continue;
    total += Math.abs(ball.pos.x - level.hole.x) + 0.5 * Math.abs(ball.pos.y - level.hole.rimY);
  }
  return total;
}

function secondsSince(t0: number): number {
  return Math.round((performance.now() - t0) / 100) / 10;
}

export function searchCoop(level: Level, opts: SearchOptions): CoopResult {
  const t0 = performance.now();
  const start = newGame(level);
  const shots = shotsOf(opts.grid);
  const seen = new Set<string>([stateKey(start.state)]);
  let frontier: Node[] = [{ game: start, line: [] }];
  let expanded = 0;
  let truncated = false;
  for (let depth = 0; depth < opts.depth && frontier.length > 0 && !truncated; depth += 1) {
    const buckets = new Map<string, Node[]>();
    for (const node of frontier) {
      for (const shot of shots) {
        if (performance.now() - t0 > opts.maxSeconds * 1000) {
          truncated = true;
          break;
        }
        const out = takeShot(node.game, shot);
        expanded += 1;
        if (out === null || out.summary.timedOut) continue;
        const child: Node = { game: out.game, line: [...node.line, stepOf(out.summary)] };
        if (out.game.state.phase === 'levelResults') {
          const strokes = out.game.state.players.map((p) => p.strokes) as [number, number];
          return { solved: true, strokes, total: strokes[0] + strokes[1], line: child.line, game: out.game, expanded, seconds: secondsSince(t0), truncated: false };
        }
        const key = stateKey(out.game.state);
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = bucketKey(out.game.state);
        const list = buckets.get(bucket) ?? [];
        list.push(child);
        buckets.set(bucket, list);
      }
      if (truncated) break;
    }
    frontier = [];
    for (const list of buckets.values()) {
      list.sort((a, b) => distanceToCup(level, a.game.state) - distanceToCup(level, b.game.state));
      frontier.push(...list.slice(0, opts.beam));
    }
  }
  return { solved: false, strokes: null, total: null, line: [], game: null, expanded, seconds: secondsSince(t0), truncated };
}

/** Re-runs a solved line's command log through `runReplay`; true when it reproduces the state exactly. */
export function replayMatches(game: Game): boolean {
  const replayed = runReplay(game.config, game.log, game.state.tick);
  return JSON.stringify(replayed.state) === JSON.stringify(game.state);
}

// ---------------------------------------------------------------------------------------------
// Solo-bypass chains (predictShot with the partner parked on its tee)
// ---------------------------------------------------------------------------------------------

export type SoloResult = {
  readonly player: PlayerId;
  readonly solved: boolean;
  readonly strokes: number | null;
  readonly reachableX: number;
  readonly firstShotSinks: number;
  readonly line: readonly LineStep[];
  readonly expanded: number;
};

type SoloNode = { readonly ball: BallState; readonly line: readonly LineStep[] };

export function searchSolo(level: Level, player: PlayerId, opts: SearchOptions): SoloResult {
  const parked = restingBall(level.starts[otherOf(player)]);
  const shots = shotsOf(opts.grid);
  const seen = new Set<string>();
  let frontier: SoloNode[] = [{ ball: restingBall(level.starts[player]), line: [] }];
  let reachableX = level.starts[player].x;
  let firstShotSinks = 0;
  let expanded = 0;
  for (let depth = 0; depth < opts.depth && frontier.length > 0; depth += 1) {
    const next: SoloNode[] = [];
    for (const node of frontier) {
      const switches = settledSwitches(level, inSlotOrder(player, node.ball, parked));
      for (const shot of shots) {
        const r = predictShot(level, switches, node.ball, player, aimOf(shot), [parked], MAX_PREDICT_TICKS);
        expanded += 1;
        const last = r.points[r.points.length - 1];
        if (last === undefined || r.outcome === 'running') continue;
        const step: LineStep = { player, shot, restX: Math.round(last.x), restY: Math.round(last.y), sunk: r.outcome === 'sink' || r.outcome === 'gimme', fell: r.outcome === 'fell', held: [] };
        if (step.sunk) {
          if (depth === 0) firstShotSinks += 1;
          return { player, solved: true, strokes: depth + 1 + (r.outcome === 'gimme' ? 1 : 0), reachableX: level.hole.x, firstShotSinks, line: [...node.line, step], expanded };
        }
        reachableX = Math.max(reachableX, last.x);
        const key = `${Math.round(last.x / DEDUPE_CELL_PX)},${Math.round(last.y / DEDUPE_CELL_PX)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ ball: restingBall(last), line: [...node.line, step] });
      }
    }
    next.sort((a, b) => Math.abs(a.ball.pos.x - level.hole.x) - Math.abs(b.ball.pos.x - level.hole.x));
    frontier = next.slice(0, opts.beam);
  }
  return { player, solved: false, strokes: null, reachableX: Math.round(reachableX), firstShotSinks, line: [], expanded };
}

// ---------------------------------------------------------------------------------------------
// Single-shot sweeps (predictShot)
// ---------------------------------------------------------------------------------------------

export type SweepShot = {
  readonly shot: Shot;
  readonly outcome: 'rest' | 'sink' | 'gimme' | 'fell' | 'running';
  readonly maxX: number;
  readonly minY: number;
  readonly restX: number;
};

export function sweep(level: Level, player: PlayerId, from: Vec, switches: Readonly<Record<string, boolean>>, others: readonly BallState[], grid: Grid): SweepShot[] {
  return shotsOf(grid).map((shot) => {
    const r = predictShot(level, switches, restingBall(from), player, aimOf(shot), others, MAX_PREDICT_TICKS);
    let maxX = from.x;
    let minY = from.y;
    for (const p of r.points) {
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
    }
    const last = r.points[r.points.length - 1] ?? from;
    return { shot, outcome: r.outcome, maxX, minY, restX: last.x };
  });
}

function allOff(level: Level): Record<string, boolean> {
  const switches: Record<string, boolean> = {};
  for (const sw of level.switches) switches[sw.id] = false;
  return switches;
}

export type AceResult = { readonly player: PlayerId; readonly shots: number; readonly sinks: number; readonly example: string | null };

/** One-shot sinks from the tee with the partner parked (criterion: 0 on every hole). */
export function aceSweep(level: Level): AceResult[] {
  return ([0, 1] as const).map((player) => {
    const parked = restingBall(level.starts[otherOf(player)]);
    const results = [...sweep(level, player, level.starts[player], allOff(level), [parked], FINE_GRID), ...sweep(level, player, level.starts[player], allOff(level), [parked], HUMAN_GRID)];
    const sinks = results.filter((r) => r.outcome === 'sink' || r.outcome === 'gimme');
    return { player, shots: results.length, sinks: sinks.length, example: sinks[0] !== undefined ? fmtShot(sinks[0].shot) : null };
  });
}

export type WallColumn = { readonly x1: number; readonly x2: number; readonly top: number; readonly blocks: readonly PlayerId[] };

/** Wall rects sharing an x-range form a column; a column blocks a player when every rect in it is solid for them (all switches off). */
export function wallColumns(level: Level): WallColumn[] {
  const byX = new Map<string, (BlockerRect | ColourGateRect)[]>();
  for (const rect of level.rects.filter(isWall)) {
    const key = `${rect.x}:${rect.w}`;
    byX.set(key, [...(byX.get(key) ?? []), rect]);
  }
  return [...byX.values()].map((rects) => {
    const first = rects[0]!;
    const blocks = ([0, 1] as const).filter((p) => rects.every((r) => r.kind === 'blocker' || r.colour !== PLAYER_GATE_COLOUR[p]));
    return { x1: first.x, x2: first.x + first.w, top: Math.min(...rects.map((r) => r.y)), blocks };
  });
}

export type WallPassResult = {
  readonly wallX: number;
  readonly player: PlayerId;
  readonly fromX: number;
  readonly grid: 'fine' | 'human';
  readonly shots: number;
  readonly passes: number;
  readonly highestY: number;
};

const APPROACH_OFFSETS = [600, 400, 250, 120, 60];

function approachXs(level: Level, targetX: number): number[] {
  const xs = new Set<number>();
  for (const start of level.starts) if (start.x < targetX) xs.add(start.x);
  for (const d of APPROACH_OFFSETS) {
    const x = targetX - d;
    if (x > BALL_RADIUS && !level.terrain.gaps.some((g) => x > g.x1 && x < g.x2)) xs.add(x);
  }
  return [...xs].sort((a, b) => a - b);
}

/** With every switch off, the blocked ball never gets past a wall column (criterion: 0 passes). */
export function wallPassSweep(level: Level): WallPassResult[] {
  const out: WallPassResult[] = [];
  for (const column of wallColumns(level)) {
    for (const player of column.blocks) {
      const parked = restingBall(level.starts[otherOf(player)]);
      for (const fromX of approachXs(level, column.x1)) {
        for (const [name, grid] of [['fine', FINE_GRID], ['human', HUMAN_GRID]] as const) {
          const results = sweep(level, player, onFairway(level, fromX), allOff(level), [parked], grid);
          const passes = results.filter((r) => r.restX > column.x2 || r.maxX > column.x2 + BALL_RADIUS).length;
          out.push({ wallX: column.x1, player, fromX, grid: name, shots: results.length, passes, highestY: Math.round(Math.min(...results.map((r) => r.minY))) });
        }
      }
    }
  }
  return out;
}

export type GapCrossResult = {
  readonly gapX1: number;
  readonly player: PlayerId;
  readonly fromX: number;
  readonly grid: 'fine' | 'human';
  readonly shots: number;
  readonly crossings: number;
  readonly falls: number;
};

const GAP_APPROACH_OFFSETS = [300, 200, 100, 40];

/** With no plate held (bridge absent) nothing crosses a gap (criterion: 0 crossings). */
export function gapCrossSweep(level: Level): GapCrossResult[] {
  const out: GapCrossResult[] = [];
  for (const gap of level.terrain.gaps) {
    for (const player of [0, 1] as const) {
      const parked = restingBall(level.starts[otherOf(player)]);
      const xs = new Set<number>([level.starts[player].x, ...GAP_APPROACH_OFFSETS.map((d) => gap.x1 - d).filter((x) => x > BALL_RADIUS)]);
      for (const fromX of [...xs].sort((a, b) => a - b)) {
        for (const [name, grid] of [['fine', FINE_GRID], ['human', HUMAN_GRID]] as const) {
          const results = sweep(level, player, onFairway(level, fromX), allOff(level), [parked], grid);
          // A ball that drops into the pit keeps drifting under the far piece until the kill line, so only a
          // ball that ENDS past the far lip (rest, sink or gimme) counts as a crossing.
          const crossings = results.filter((r) => r.outcome !== 'fell' && r.outcome !== 'running' && r.restX > gap.x2).length;
          out.push({ gapX1: gap.x1, player, fromX, grid: name, shots: results.length, crossings, falls: results.filter((r) => r.outcome === 'fell').length });
        }
      }
    }
  }
  return out;
}

export type LonePlateResult = { readonly switchId: string; readonly shot: Shot; readonly restX: number; readonly fell: boolean; readonly crossed: boolean; readonly bridgeDrops: number };

const LONE_PLATE_SHOTS: Shot[] = [
  { deg: 29, power: 49 },
  { deg: 40, power: 94 },
  { deg: 20, power: 100 },
  { deg: 45, power: 100 },
  { deg: 61, power: 83 },
];

/** A lone ball on a bridge plate (partner on its tee) shoots: the bridge must vanish under it and it never rests beyond the gap. */
export function lonePlateCheck(level: Level): LonePlateResult[] {
  const out: LonePlateResult[] = [];
  const base = newGame(level);
  for (const bridge of bridgesOf(level)) {
    const gap = level.terrain.gaps.find((g) => g.x1 === bridge.x);
    if (gap === undefined) continue;
    for (const sw of plateSwitches(level).filter((s) => (bridge.switchIds ?? [bridge.switchId]).includes(s.id) && s.x + s.w <= gap.x1)) {
      for (const shot of LONE_PLATE_SHOTS) {
        const shooter = restingBall(onFairway(level, sw.x + sw.w / 2));
        const game = withBalls(base, inSlotOrder(0, shooter, restingBall(level.starts[1])), 0);
        const r = takeShot(game, shot);
        if (r === null) continue;
        out.push({ switchId: sw.id, shot, restX: Math.round(r.summary.restX), fell: r.summary.fell, crossed: r.summary.restX > gap.x2, bridgeDrops: r.summary.bridgeDrops });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scripted lines (LEVELS.md intended lines, keyed by campaign order; predicates like verify-lines.ts)
// ---------------------------------------------------------------------------------------------

type Beat = { readonly who: PlayerId; readonly what: string; readonly ok: (s: ShotSummary) => boolean };
type ScriptedLine = { readonly order: number; readonly name: string; readonly beats: readonly Beat[] };

const clean = (s: ShotSummary): boolean => !s.fell && !s.partnerFell && !s.timedOut;
const past = (x: number) => (s: ShotSummary): boolean => clean(s) && s.restX > x;
const between = (a: number, b: number) => (s: ShotSummary): boolean => clean(s) && s.restX > a && s.restX < b;
const near = (x: number, d: number) => (s: ShotSummary): boolean => clean(s) && Math.abs(s.restX - x) < d;
const on = (id: string) => (s: ShotSummary): boolean => clean(s) && !s.sunk && s.switches[id] === true;
const sunk = (s: ShotSummary): boolean => s.sunk && !s.partnerFell;
const either = (...fns: ((s: ShotSummary) => boolean)[]) => (s: ShotSummary): boolean => fns.some((fn) => fn(s));
const both = (...fns: ((s: ShotSummary) => boolean)[]) => (s: ShotSummary): boolean => fns.every((fn) => fn(s));
const onGreenNoSand = (greenX: number) => (s: ShotSummary): boolean => past(greenX)(s) && !s.sand;

export const SCRIPTED_LINES: readonly ScriptedLine[] = [
  {
    order: 1,
    name: 'First Fairway',
    beats: [
      // The main line asks for "over the hill, short of the green": a 3/4 swing lays up on the shelf
      // 580-800 and a full swing runs off its lip into the bunker (800-1010). The sand line below is the
      // strict "stops dead in the bunker" variant of the same hole.
      { who: 0, what: 'drive over the hill, short of the green (540-1120)', ok: between(540, 1120) },
      { who: 1, what: 'drive over the hill, short of the green (540-1120)', ok: between(540, 1120) },
      { who: 0, what: 'pitch over the sand onto the green or sink', ok: either(sunk, onGreenNoSand(1120)) },
      { who: 1, what: 'pitch over the sand onto the green or sink', ok: either(sunk, onGreenNoSand(1120)) },
      { who: 0, what: 'putt / gimme', ok: sunk },
      { who: 1, what: 'putt / gimme', ok: sunk },
    ],
  },
  {
    order: 1,
    name: 'First Fairway (sand line)',
    beats: [
      { who: 0, what: 'full drive runs into the bunker and stops dead (800-1010)', ok: both((s) => s.sand, between(790, 1020)) },
      { who: 1, what: 'full drive runs into the bunker and stops dead', ok: both((s) => s.sand, between(790, 1020)) },
      { who: 0, what: 'pitch out of the sand onto the green or sink', ok: either(sunk, past(1120)) },
      { who: 1, what: 'pitch out of the sand onto the green or sink', ok: either(sunk, past(1120)) },
      { who: 0, what: 'putt / gimme', ok: sunk },
      { who: 1, what: 'putt / gimme', ok: sunk },
    ],
  },
  {
    order: 2,
    name: 'Two Doors',
    beats: [
      { who: 0, what: 'red: park on the DOOR plate from the tee (dish 690-900): door opens', ok: on('door') },
      { who: 1, what: 'blue: roll through the open door and settle on the WINDOW plate', ok: both(past(940), on('window')) },
      { who: 0, what: 'red: lob through the open window from the plate (land past the wall)', ok: past(940) },
      { who: 1, what: 'blue: approach the cup (within 160 px) or sink', ok: either(sunk, near(1680, 160)) },
      { who: 0, what: 'red: approach the cup (within 160 px) or sink', ok: either(sunk, near(1680, 160)) },
      { who: 1, what: 'blue: sink', ok: sunk },
      { who: 0, what: 'red: sink', ok: sunk },
    ],
  },
  {
    order: 3,
    name: 'Colour Keys',
    beats: [
      { who: 1, what: 'blue: lob through the BLUE field onto the DOOR 1 plate (bowl 650-1050)', ok: both((s) => s.gatePass.includes('blue'), on('door1')) },
      { who: 0, what: 'red: roll through the open door 1, finish close to wall 2 (900-1150)', ok: between(900, 1150) },
      { who: 1, what: 'blue: move up in front of wall 2 (1000-1150)', ok: between(1000, 1150) },
      { who: 0, what: 'red: lob through the RED field onto the DOOR 2 plate (bowl 1220-1610)', ok: both((s) => s.gatePass.includes('red'), on('door2')) },
      { who: 1, what: 'blue: roll through the open door 2 (x > 1200)', ok: past(1200) },
      { who: 0, what: 'red: approach / sink', ok: either(sunk, near(1740, 160)) },
      { who: 1, what: 'blue: approach / sink', ok: either(sunk, near(1740, 160)) },
      { who: 0, what: 'sink', ok: sunk },
      { who: 1, what: 'sink', ok: sunk },
    ],
  },
  {
    order: 4,
    name: 'Plate & Bridge',
    beats: [
      { who: 0, what: 'red: chip onto plate A (dish 350-520): bridge appears', ok: on('near') },
      { who: 1, what: 'blue: full swing from the tee across the bridge, rest on the deck or plate B', ok: both(past(544), either(on('deck'), on('far'))) },
      { who: 0, what: 'red: full swing from plate A, rest on plate B or the deck', ok: both(past(544), either(on('far'), on('deck'))) },
      { who: 1, what: 'blue: on to the far side (x > 1240) or sink', ok: either(sunk, past(1240)) },
      { who: 0, what: 'red: on to the far side or sink', ok: either(sunk, past(1240)) },
      { who: 1, what: 'blue: approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: 0, what: 'red: approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: 1, what: 'sink', ok: sunk },
      { who: 0, what: 'sink', ok: sunk },
    ],
  },
  {
    order: 4,
    name: 'Plate & Bridge (deck line)',
    beats: [
      { who: 0, what: 'chip onto plate A: bridge appears', ok: on('near') },
      { who: 1, what: 'cross from the tee and rest ON THE DECK (544-1216)', ok: both(between(544, 1216), on('deck')) },
      { who: 0, what: 'stall tap: stay on plate A (partner on the deck must not fall)', ok: on('near') },
      { who: 1, what: 'from the deck onto plate B', ok: on('far') },
      { who: 0, what: 'cross the bridge (held by B)', ok: past(1240) },
      { who: 1, what: 'approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: 0, what: 'approach / sink', ok: either(sunk, near(1860, 160)) },
      { who: 1, what: 'sink', ok: sunk },
      { who: 0, what: 'sink', ok: sunk },
    ],
  },
];

export type ScriptedBeatResult = { readonly who: PlayerId; readonly what: string; readonly shot: Shot | null; readonly candidates: number; readonly restX: number | null; readonly sunk: boolean; readonly held: readonly string[] };
export type ScriptedResult = {
  readonly name: string;
  readonly bothSunk: boolean;
  readonly strokes: readonly [number, number];
  readonly total: number;
  readonly beats: readonly ScriptedBeatResult[];
  readonly failedAt: string | null;
  /** The finished game: its `log` replays the line (golden replays in levels.test.ts). */
  readonly game: Game;
};

/** Replays an intended line: each beat takes the FIRST grid shot satisfying its predicate (an upper bound on the line). */
export function replayScripted(level: Level, line: ScriptedLine, grid: Grid): ScriptedResult {
  let game = newGame(level);
  const beats: ScriptedBeatResult[] = [];
  let failedAt: string | null = null;
  for (const beat of line.beats) {
    if (game.state.balls[beat.who].sunk) continue;
    if (game.state.activePlayer !== beat.who) {
      failedAt = `${beat.what} (sim says P${game.state.activePlayer + 1} is up, line says P${beat.who + 1})`;
      break;
    }
    let found: ShotOutcome | null = null;
    let candidates = 0;
    for (const shot of shotsOf(grid)) {
      const r = takeShot(game, shot);
      if (r === null || !beat.ok(r.summary)) continue;
      candidates += 1;
      if (found === null) found = r;
    }
    if (found === null) {
      beats.push({ who: beat.who, what: beat.what, shot: null, candidates: 0, restX: null, sunk: false, held: [] });
      failedAt = beat.what;
      break;
    }
    game = found.game;
    beats.push({ who: beat.who, what: beat.what, shot: found.summary.shot, candidates, restX: Math.round(found.summary.restX), sunk: found.summary.sunk, held: heldList(found.summary.switches) });
  }
  const strokes = game.state.players.map((p) => p.strokes) as [number, number];
  return { name: line.name, bothSunk: game.state.balls.every((b) => b.sunk), strokes, total: strokes[0] + strokes[1], beats, failedAt, game };
}

// ---------------------------------------------------------------------------------------------
// Stall taps and the deck lip (decision 19)
// ---------------------------------------------------------------------------------------------

const STALL_TAPS: Shot[] = [
  { deg: 90, power: 10 },
  { deg: 90, power: 15 },
  { deg: 80, power: 20 },
  { deg: 100, power: 15 },
];

export type StallResult = {
  readonly switchId: string;
  readonly partnerAt: 'tee' | 'plate' | 'deck';
  readonly tap: Shot;
  readonly heldBefore: boolean;
  readonly reHeld: boolean;
  readonly partnerFell: boolean;
  readonly bridgeDrops: number;
  readonly holderRestX: number;
};

function plateSwitches(level: Level): PressureSwitch[] {
  return level.switches.filter((sw) => sw.onRectId === undefined);
}

function deckBall(bridge: BridgeRect): BallState {
  return restingBall({ x: bridge.x + bridge.w / 2, y: bridge.y - BALL_RADIUS });
}

/** A holder taps straight up at low power: it must land back on its plate and a partner parked on the deck must not fall. */
export function stallTapCheck(level: Level): StallResult[] {
  const out: StallResult[] = [];
  const base = newGame(level);
  for (const sw of plateSwitches(level)) {
    const holder = restingBall(onFairway(level, sw.x + sw.w / 2));
    const partners: { at: StallResult['partnerAt']; ball: BallState }[] = [{ at: 'tee', ball: restingBall(level.starts[1]) }];
    for (const other of plateSwitches(level)) {
      if (other.id !== sw.id) partners.push({ at: 'plate', ball: restingBall(onFairway(level, other.x + other.w / 2)) });
    }
    for (const bridge of bridgesOf(level)) {
      if ((bridge.switchIds ?? [bridge.switchId]).includes(sw.id)) partners.push({ at: 'deck', ball: deckBall(bridge) });
    }
    for (const partner of partners) {
      for (const tap of STALL_TAPS) {
        const game = withBalls(base, inSlotOrder(0, holder, partner.ball), 0);
        const heldBefore = game.state.switches[sw.id] === true;
        const r = takeShot(game, tap);
        if (r === null) continue;
        out.push({
          switchId: sw.id,
          partnerAt: partner.at,
          tap,
          heldBefore,
          reHeld: r.summary.switches[sw.id] === true,
          partnerFell: r.summary.partnerFell,
          bridgeDrops: r.summary.bridgeDrops,
          holderRestX: Math.round(r.summary.restX),
        });
      }
    }
  }
  return out;
}

export type DeckLipResult = { readonly deckId: string; readonly lipSamples: number; readonly lipPresses: number; readonly deckSamples: number; readonly deckPresses: number };

const LIP_SAMPLE_PX = 24;
const DECK_SAMPLE_STEP_PX = 48;

/** Balls resting at either lip never press the deck plate; a ball resting on the inset strip always does. */
export function deckLipCheck(level: Level): DeckLipResult[] {
  const out: DeckLipResult[] = [];
  for (const deck of level.switches.filter((sw) => sw.onRectId !== undefined)) {
    const bridge = bridgesOf(level).find((b) => b.id === deck.onRectId);
    const gap = bridge !== undefined ? level.terrain.gaps.find((g) => g.x1 === bridge.x) : undefined;
    if (bridge === undefined || gap === undefined) continue;
    const holderPlate = plateSwitches(level).find((sw) => (bridge.switchIds ?? [bridge.switchId]).includes(sw.id));
    if (holderPlate === undefined) continue;
    const holder = restingBall(onFairway(level, holderPlate.x + holderPlate.w / 2));
    const pressedWith = (probe: BallState): boolean => settledSwitches(level, [holder, probe])[deck.id] === true;
    let lipSamples = 0;
    let lipPresses = 0;
    for (let d = 1; d <= LIP_SAMPLE_PX; d += 1) {
      for (const x of [gap.x1 - d, gap.x2 + d]) {
        lipSamples += 1;
        if (pressedWith(restingBall(onFairway(level, x)))) lipPresses += 1;
      }
    }
    let deckSamples = 0;
    let deckPresses = 0;
    for (let x = deck.x; x <= deck.x + deck.w; x += DECK_SAMPLE_STEP_PX) {
      deckSamples += 1;
      if (pressedWith(restingBall({ x, y: bridge.y - BALL_RADIUS }))) deckPresses += 1;
    }
    out.push({ deckId: deck.id, lipSamples, lipPresses, deckSamples, deckPresses });
  }
  return out;
}

export type LoneDeckResult = { readonly deckId: string; readonly fromX: number; readonly shot: Shot; readonly restX: number; readonly fell: boolean; readonly crossed: boolean };

/** Shots at or under this angle are "rolls" for the lone-deck rule; above it, "lobs". */
export const LONE_DECK_ROLL_MAX_DEG = 7;
const LONE_DECK_ROLLS: Shot[] = [3, 5, 7].flatMap((deg) => [40, 60, 80, 100].map((power) => ({ deg, power })));
const LONE_DECK_LOBS: Shot[] = [80, 90, 100].map((power) => ({ deg: 45, power }));
/** The deepest "far third" start: a roll from closer than this hops onto the far lip before it has fallen a ball height. */
const LONE_DECK_FAR_MARGIN_PX = 240;

/**
 * The rule the L4 copy teaches ("a ball parked on the DECK must FLY off, never roll"): a lone deck ball
 * ({deck} held, partner on its tee) releases the deck the tick it moves, so every roll drops into the
 * chasm and only a lob that carries to the far lip crosses.
 */
export function loneDeckCheck(level: Level): LoneDeckResult[] {
  const out: LoneDeckResult[] = [];
  const base = newGame(level);
  for (const deck of level.switches.filter((sw) => sw.onRectId !== undefined)) {
    const bridge = bridgesOf(level).find((b) => b.id === deck.onRectId);
    const gap = bridge !== undefined ? level.terrain.gaps.find((g) => g.x1 === bridge.x) : undefined;
    if (bridge === undefined || gap === undefined) continue;
    const froms = [deck.x + DECK_SAMPLE_STEP_PX, bridge.x + bridge.w / 2, gap.x2 - LONE_DECK_FAR_MARGIN_PX];
    for (const fromX of froms) {
      for (const shot of [...LONE_DECK_ROLLS, ...LONE_DECK_LOBS]) {
        const balls = inSlotOrder(1, restingBall({ x: fromX, y: bridge.y - BALL_RADIUS }), restingBall(level.starts[0]));
        const state: SimState = { ...base.state, balls, switches: { ...allOff(level), [deck.id]: true }, activePlayer: 1, turnDelayTicks: 0, phase: 'aiming' };
        const r = takeShot({ config: base.config, state, log: [] }, shot);
        if (r === null) continue;
        out.push({ deckId: deck.id, fromX, shot, restX: Math.round(r.summary.restX), fell: r.summary.fell, crossed: !r.summary.fell && r.summary.restX > gap.x2 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Criteria and reports
// ---------------------------------------------------------------------------------------------

export type PassName = 'coop' | 'wide' | 'solo' | 'aces' | 'walls' | 'gaps' | 'scripted' | 'stall' | 'deck';
export const PASS_NAMES: readonly PassName[] = ['coop', 'wide', 'solo', 'aces', 'walls', 'gaps', 'scripted', 'stall', 'deck'];

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
  readonly scripted?: readonly ScriptedResult[];
  readonly stall?: readonly StallResult[];
  readonly deck?: readonly DeckLipResult[];
  readonly loneDeck?: readonly LoneDeckResult[];
  readonly criteria: readonly Criterion[];
};

export type RunOptions = SearchOptions & { readonly passes: readonly PassName[]; readonly wideBeam: number };

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

const fmtLine = (line: readonly LineStep[]): string =>
  line.map((s) => `P${s.player + 1} ${fmtShot(s.shot)} → ${s.restX}${s.sunk ? ' SINK' : ''}${s.fell ? ' (fell)' : ''}${s.held.length > 0 ? ` [${s.held.join(',')}]` : ''}`).join(' · ');

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
 * LEVELS.md par rule: par is the scripted line, at most solver minimum + PAR_SLACK and never below the minimum.
 * Colour Keys (campaign order 3) is the one documented exception: its structural minimum is 5 (blue: lob onto
 * the DOOR 1 plate, a forced shot while DOOR 2 is shut, a roll-in; red: roll through DOOR 1, lob the red field
 * and hole out, which holds DOOR 2 from the cup) and BUILD_DECISIONS D2 caps the par change at +-1 from
 * LEVELS.md's 9, so it ships at par 8 = minimum + 3 until the lead waives the cap (levels/README.md "Pars").
 */
export const PAR_SLACK = 2;
export const PAR_SLACK_BY_ORDER: Readonly<Record<number, number>> = { 3: 3 };

export function parSlackFor(level: Level): number {
  return PAR_SLACK_BY_ORDER[level.order] ?? PAR_SLACK;
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
  const coopLevel = level.mechanicsPresent.includes('switch') || level.mechanicsPresent.includes('colourGate');
  const detail = solo.map((s) => `P${s.player + 1}: ${s.solved ? `SOLVED in ${s.strokes}` : 'no'}, reachableX ${s.reachableX}, first-shot sinks ${s.firstShotSinks}${s.line.length > 0 ? ` (${fmtLine(s.line)})` : ''}`).join(' | ');
  if (!coopLevel) return [{ name: 'solo-reference', pass: true, detail: `no co-op mechanic on this hole; ${detail}` }];
  return [
    { name: 'solo-not-bypassable', pass: solo.every((s) => !s.solved), detail },
    { name: 'solo-first-shot-zero', pass: solo.every((s) => s.firstShotSinks === 0), detail: solo.map((s) => `P${s.player + 1} ${s.firstShotSinks}`).join(', ') },
  ];
}

function aceCriteria(aces: readonly AceResult[]): Criterion[] {
  return [{ name: 'no-aces', pass: aces.every((a) => a.sinks === 0), detail: aces.map((a) => `P${a.player + 1} ${a.sinks}/${a.shots}${a.example !== null ? ` (e.g. ${a.example})` : ''}`).join(', ') }];
}

function wallCriteria(walls: readonly WallPassResult[]): Criterion[] {
  if (walls.length === 0) return [];
  const passes = walls.reduce((n, w) => n + w.passes, 0);
  const shots = walls.reduce((n, w) => n + w.shots, 0);
  const highest = Math.min(...walls.map((w) => w.highestY));
  const offenders = walls.filter((w) => w.passes > 0).map((w) => `wall ${w.wallX} P${w.player + 1} from ${w.fromX} (${w.grid}) ${w.passes}`);
  return [{ name: 'wall-pass-zero', pass: passes === 0, detail: `${passes}/${shots} passes, highest ball centre y ${highest}${offenders.length > 0 ? `: ${offenders.join('; ')}` : ''}` }];
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

function scriptedCriteria(level: Level, scripted: readonly ScriptedResult[]): Criterion[] {
  return scripted.map((line) => ({
    name: `scripted: ${line.name}`,
    pass: line.bothSunk && line.total <= level.par + 2,
    detail: line.bothSunk
      ? `${line.total} strokes (${line.strokes.join('+')}) vs par ${level.par}: ${line.beats.map((b) => `P${b.who + 1} ${b.shot !== null ? fmtShot(b.shot) : '?'} → ${b.restX ?? '?'}${b.sunk ? ' SINK' : ''} (${b.candidates}/${'grid'})`).join(' · ')}`
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
      detail: bad.length === 0 ? `${stall.length} taps re-held their plate, 0 partner falls, ${stall.filter((s) => s.partnerAt === 'deck').length} with a partner on the deck` : bad.map((s) => `${s.switchId} ${fmtShot(s.tap)} partner@${s.partnerAt}: held before ${s.heldBefore}, re-held ${s.reHeld}, partner fell ${s.partnerFell}, rest x ${s.holderRestX}`).join('; '),
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

const fmtLoneDeck = (l: LoneDeckResult): string => `${l.fromX} ${fmtShot(l.shot)} → ${l.restX}${l.fell ? ' fell' : ''}${l.crossed ? ' CROSSED' : ''}`;

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
    criteria.push(...wallCriteria(report.walls));
  }
  if (want('gaps')) {
    report.gaps = gapCrossSweep(level);
    report.lonePlate = lonePlateCheck(level);
    criteria.push(...gapCriteria(report.gaps, report.lonePlate));
  }
  if (want('scripted')) {
    report.scripted = SCRIPTED_LINES.filter((l) => l.order === level.order).map((l) => replayScripted(level, l, opts.grid));
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
  return { ...report, levelId: level.id, name: level.name, par: level.par, shotSpeed: SHOT_SPEED_PER_POWER, seconds: secondsSince(t0), criteria };
}

export function formatReport(report: LevelReport): string {
  const lines = [`== ${report.name} (${report.levelId}) par ${report.par}, shot speed ${report.shotSpeed}, ${report.seconds}s`];
  for (const c of report.criteria) lines.push(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

type CliArgs = { readonly levels: readonly Level[]; readonly options: RunOptions; readonly jsonOut: string | null };

function usage(message: string): never {
  process.stderr.write(`${message}\n`);
  process.stderr.write('usage: npm run solve -- <levelId|all> [--pass coop,wide,solo,aces,walls,gaps,scripted,stall,deck] [--depth N] [--beam N] [--wideBeam N] [--angles N] [--powers N] [--maxSeconds S] [--json out.json]\n');
  process.stderr.write(`levels: ${LEVELS.map((l) => l.id).join(', ')}\n`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliArgs {
  const [target, ...rest] = argv;
  if (target === undefined) usage('missing level id');
  const levels = target === 'all' ? LEVELS : hasLevel(target) ? [levelById(target)] : usage(`unknown level id "${target}"`);
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
    options: { depth: num('depth', maxPar + 3), beam: num('beam', 6), wideBeam: num('wideBeam', WIDE_BEAM), grid: cellGrid(num('angles', 16), num('powers', 8)), maxSeconds: num('maxSeconds', 900), passes },
    jsonOut: opt('json') ?? null,
  };
}

function main(argv: readonly string[]): number {
  const { levels, options, jsonOut } = parseArgs(argv);
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
