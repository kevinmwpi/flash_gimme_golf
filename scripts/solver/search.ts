// OWNER: levels
/**
 * The solver's searches (scripts/solver.ts): the co-op beam search over full two-ball games, its replay
 * proof, and the solo-bypass chains. States are keyed with their WAITING flags (caught / loaded, D10.4) so a
 * ball waiting in a device never merges with, or loses its bucket to, a free ball closer to the cup.
 */
import { waitingOf } from '../../src/sim/devices';
import { predictShot } from '../../src/sim/physics';
import { runReplay } from '../../src/sim/sim';
import type { BallState, Level, PlayerId, SimState } from '../../src/sim/types';
import {
  DEDUPE_CELL_PX,
  MAX_PREDICT_TICKS,
  aimOf,
  craftedBall,
  heldList,
  inSlotOrder,
  newGame,
  otherOf,
  settledSwitches,
  shotsOf,
  takeShot,
  type Game,
  type Grid,
  type Shot,
  type ShotSummary,
} from './game';

export type LineStep = {
  readonly player: PlayerId;
  readonly shot: Shot;
  readonly restX: number;
  readonly restY: number;
  readonly sunk: boolean;
  readonly fell: boolean;
  readonly held: readonly string[];
  /** CAUGHT / LOADED after the shot, BOOM when the shooter fired, BACK +1 resets during it. */
  readonly waiting: ShotSummary['waiting'];
  readonly fired: boolean;
  readonly partnerFired: boolean;
  readonly resets: number;
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

export function stepOf(summary: ShotSummary): LineStep {
  return {
    player: summary.shooter,
    shot: summary.shot,
    restX: Math.round(summary.restX),
    restY: Math.round(summary.restY),
    sunk: summary.sunk,
    fell: summary.fell,
    held: heldList(summary.switches),
    waiting: summary.waiting,
    fired: summary.fired,
    partnerFired: summary.partnerFired,
    resets: summary.resets,
  };
}

function cellOf(x: number, y: number): string {
  return `${Math.round(x / DEDUPE_CELL_PX)},${Math.round(y / DEDUPE_CELL_PX)}`;
}

/** 'C' caught, 'L' loaded, '-' free (or sunk / moving). */
function waitingFlag(level: Level, state: SimState, ball: Readonly<BallState>): string {
  const waiting = waitingOf(level, state.switches, ball);
  return waiting === null ? '-' : waiting.reason === 'caught' ? 'C' : 'L';
}

/**
 * Dedupe key: per ball its 8 px cell and WAITING flag (a cell straddling a trap edge never merges a caught and a
 * free ball), plus a waiting ball's safe spot (where a scoped reset would send it); the active ball; held plates.
 */
export function stateKey(level: Level, state: SimState): string {
  const balls = state.balls
    .map((b) => {
      if (b.sunk) return 'S';
      const flag = waitingFlag(level, state, b);
      return flag === '-' ? cellOf(b.pos.x, b.pos.y) : `${cellOf(b.pos.x, b.pos.y)}${flag}@${cellOf(b.lastRest.x, b.lastRest.y)}`;
    })
    .join('|');
  return `${balls}#${state.activePlayer}#${heldList(state.switches).join(',')}`;
}

/** Beam bucket: sunk flags x WAITING flags x held plates x active player. */
export function bucketKey(level: Level, state: SimState): string {
  const sunk = state.balls.map((b) => (b.sunk ? 1 : 0)).join('');
  const waiting = state.balls.map((b) => waitingFlag(level, state, b)).join('');
  return `${sunk}|${waiting}|${heldList(state.switches).join(',')}|${state.activePlayer}`;
}

function distanceToCup(level: Level, state: SimState): number {
  let total = 0;
  for (const ball of state.balls) {
    if (ball.sunk) continue;
    total += Math.abs(ball.pos.x - level.hole.x) + 0.5 * Math.abs(ball.pos.y - level.hole.rimY);
  }
  return total;
}

export function secondsSince(t0: number): number {
  return Math.round((performance.now() - t0) / 100) / 10;
}

/** A shot the searches never build on: the sim did not hand off, or the flight watchdog had to end it. */
export function isBroken(summary: ShotSummary): boolean {
  return summary.timedOut || summary.timeouts > 0;
}

export function searchCoop(level: Level, opts: SearchOptions): CoopResult {
  const t0 = performance.now();
  const start = newGame(level);
  const shots = shotsOf(opts.grid);
  const seen = new Set<string>([stateKey(level, start.state)]);
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
        if (out === null || isBroken(out.summary)) continue;
        const child: Node = { game: out.game, line: [...node.line, stepOf(out.summary)] };
        if (out.game.state.phase === 'levelResults') {
          const strokes = out.game.state.players.map((p) => p.strokes) as [number, number];
          return { solved: true, strokes, total: strokes[0] + strokes[1], line: child.line, game: out.game, expanded, seconds: secondsSince(t0), truncated: false };
        }
        const key = stateKey(level, out.game.state);
        if (seen.has(key)) continue;
        seen.add(key);
        const bucket = bucketKey(level, out.game.state);
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

/** Re-runs a game's command log through `runReplay`; true when it reproduces the state exactly. */
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
  /** Rests where the lone ball ended caught or loaded: dead ends (its partner never moves to free or fire it). */
  readonly deadEnds: number;
  readonly line: readonly LineStep[];
  readonly expanded: number;
};

type SoloNode = { readonly ball: BallState; readonly line: readonly LineStep[] };

export function searchSolo(level: Level, player: PlayerId, opts: SearchOptions): SoloResult {
  const parked = craftedBall(level, otherOf(player), level.starts[otherOf(player)]);
  const shots = shotsOf(opts.grid);
  const seen = new Set<string>();
  let frontier: SoloNode[] = [{ ball: craftedBall(level, player, level.starts[player]), line: [] }];
  let reachableX = level.starts[player].x;
  let firstShotSinks = 0;
  let deadEnds = 0;
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
        const sunk = r.outcome === 'sink' || r.outcome === 'gimme';
        const step: LineStep = { player, shot, restX: Math.round(last.x), restY: Math.round(last.y), sunk, fell: r.outcome === 'fell', held: [], waiting: null, fired: false, partnerFired: false, resets: 0 };
        if (sunk) {
          if (depth === 0) firstShotSinks += 1;
          return { player, solved: true, strokes: depth + 1 + (r.outcome === 'gimme' ? 1 : 0), reachableX: level.hole.x, firstShotSinks, deadEnds, line: [...node.line, step], expanded };
        }
        reachableX = Math.max(reachableX, last.x);
        const key = `${Math.round(last.x / DEDUPE_CELL_PX)},${Math.round(last.y / DEDUPE_CELL_PX)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rest = craftedBall(level, player, last);
        // A caught or loaded lone ball never shoots again: the WAITING rule would hand every turn to the parked partner.
        if (waitingOf(level, settledSwitches(level, inSlotOrder(player, rest, parked)), rest) !== null) {
          deadEnds += 1;
          continue;
        }
        next.push({ ball: rest, line: [...node.line, step] });
      }
    }
    next.sort((a, b) => Math.abs(a.ball.pos.x - level.hole.x) - Math.abs(b.ball.pos.x - level.hole.x));
    frontier = next.slice(0, opts.beam);
  }
  return { player, solved: false, strokes: null, reachableX: Math.round(reachableX), firstShotSinks, deadEnds, line: [], expanded };
}
