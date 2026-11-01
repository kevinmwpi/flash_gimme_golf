// OWNER: levels
/**
 * The solver's single-shot sweeps (scripts/solver.ts), all on `predictShot` with every switch off and the
 * partner parked on its tee: aces, wall passes, gap crossings, plus the lone-plate rule of a bridged chasm.
 *
 * Every exception to these generic passes is one row of OPT_OUTS, never an implicit skip: the solver checks
 * each row still describes its level (the skipped column is no gate, the exempt ledge starts rows, the skipped
 * chasm has no bridge and a cannon flies across it) and reports it as a criterion of its own.
 */
import { waitingOf } from '../../src/sim/devices';
import { predictLaunch, predictShot } from '../../src/sim/physics';
import { collidersFor, rectContains, rectSwitchIds, solidColliders } from '../../src/sim/terrain';
import type { BallState, BlockerRect, BridgeRect, ColourGateRect, Gap, Level, LevelRect, PlayerId, PressureSwitch, Vec } from '../../src/sim/types';
import { BALL_RADIUS, PLAYER_GATE_COLOUR } from '../../src/sim/types';
import {
  FINE_GRID,
  HUMAN_GRID,
  MAX_PREDICT_TICKS,
  aimOf,
  allOff,
  allOn,
  craftedBall,
  fmtShot,
  inSlotOrder,
  mirrored,
  newGame,
  onFairway,
  otherOf,
  restingBall,
  shotsOf,
  takeShot,
  withBalls,
  type Grid,
  type Shot,
} from './game';

// ---------------------------------------------------------------------------------------------
// The opt-out table (BUILD_DECISIONS D10.13): the only exceptions to the walls and gaps passes
// ---------------------------------------------------------------------------------------------

export type OptOut =
  | { readonly levelId: string; readonly pass: 'walls'; readonly skip: 'column'; readonly rectId: string; readonly why: string }
  | { readonly levelId: string; readonly pass: 'walls'; readonly skip: 'highestY'; readonly fromX: readonly [number, number]; readonly why: string }
  | { readonly levelId: string; readonly pass: 'gaps'; readonly skip: 'lonePlate'; readonly gapX1: number; readonly why: string };

export const OPT_OUTS: readonly OptOut[] = [
  {
    levelId: 'w2-06-booby-trap',
    pass: 'walls',
    skip: 'column',
    rectId: 'backboard',
    why: 'a permanent backstop behind the PERCH bowl, not a gate: nothing behind it is guarded, so a lob over it from behind the perch is no bypass',
  },
  {
    levelId: 'w3-11-crossfire',
    pass: 'walls',
    skip: 'highestY',
    fromX: [0, 200],
    why: 'rows starting on the FIRE ledge (100 px above the floor, reached only by blue through its own field) peak above the 420 px reach line straight over the ledge, far left of every column; their passes still count',
  },
  {
    levelId: 'w2-07-load-and-fire',
    pass: 'gaps',
    skip: 'lonePlate',
    gapX1: 961,
    why: 'the chasm is crossed by the CANNON, not a bridge: no plate holds anything over it',
  },
  {
    levelId: 'w3-11-crossfire',
    pass: 'gaps',
    skip: 'lonePlate',
    gapX1: 900,
    why: 'the chasm is crossed by the CANNON, not a bridge: no plate holds anything over it',
  },
];

export function optOutsOf(level: Level): readonly OptOut[] {
  return OPT_OUTS.filter((o) => o.levelId === level.id);
}

export function describeOptOut(o: OptOut): string {
  switch (o.skip) {
    case 'column':
      return `walls: column "${o.rectId}" not swept (${o.why})`;
    case 'highestY':
      return `walls: no highest-y assertion for rows from x ${o.fromX[0]}-${o.fromX[1]} (${o.why})`;
    case 'lonePlate':
      return `gaps: no lone-plate assertion for the chasm at x ${o.gapX1} (${o.why})`;
  }
}

// ---------------------------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------------------------

export type SweepShot = {
  readonly shot: Shot;
  readonly outcome: 'rest' | 'sink' | 'gimme' | 'fell' | 'running';
  readonly maxX: number;
  readonly minX: number;
  readonly minY: number;
  readonly restX: number;
};

export function sweep(level: Level, player: PlayerId, from: Vec, switches: Readonly<Record<string, boolean>>, others: readonly BallState[], grid: Grid): SweepShot[] {
  return shotsOf(grid).map((shot) => {
    const r = predictShot(level, switches, restingBall(from), player, aimOf(shot), others, MAX_PREDICT_TICKS);
    let maxX = from.x;
    let minX = from.x;
    let minY = from.y;
    for (const p of r.points) {
      if (p.x > maxX) maxX = p.x;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }
    const last = r.points[r.points.length - 1] ?? from;
    return { shot, outcome: r.outcome, maxX, minX, minY, restX: last.x };
  });
}

/** Both directions: the fine sweep and the human grid, rightward and mirrored leftward (2 x 429 shots). */
export const ACE_GRIDS: readonly Grid[] = [FINE_GRID, HUMAN_GRID, mirrored(FINE_GRID), mirrored(HUMAN_GRID)];

export type AceResult = { readonly player: PlayerId; readonly shots: number; readonly sinks: number; readonly example: string | null };

/** One-shot sinks from the tee with the partner parked, every switch off (criterion: 0 on every hole). */
export function aceSweep(level: Level): AceResult[] {
  return ([0, 1] as const).map((player) => {
    const parked = restingBall(level.starts[otherOf(player)]);
    const results = ACE_GRIDS.flatMap((grid) => sweep(level, player, level.starts[player], allOff(level), [parked], grid));
    const sinks = results.filter((r) => r.outcome === 'sink' || r.outcome === 'gimme');
    return { player, shots: results.length, sinks: sinks.length, example: sinks[0] !== undefined ? fmtShot(sinks[0].shot) : null };
  });
}

/**
 * True when a ball of `player` could be resting at `pos` with the turn (every switch off): not inside a solid
 * rect, not on a spring pad, and free (an armed trap or a cold breech would make it wait, D10.4).
 */
export function canShootFrom(level: Level, player: PlayerId, pos: Vec, switches: Readonly<Record<string, boolean>>): boolean {
  if (collidersFor(solidColliders(level, switches), player).some((c) => c.kind === 'rect' && rectContains(c.rect, pos))) return false;
  if (level.rects.some((r) => r.kind === 'spring' && pos.x >= r.x && pos.x <= r.x + r.w)) return false;
  return waitingOf(level, switches, craftedBall(level, player, pos)) === null;
}

function isWall(rect: LevelRect): rect is BlockerRect | ColourGateRect {
  return rect.kind === 'blocker' || rect.kind === 'colourGate';
}

export type WallColumn = {
  readonly x1: number;
  readonly x2: number;
  readonly top: number;
  readonly blocks: readonly PlayerId[];
  readonly rectIds: readonly string[];
  /** A door, window or colour field: something in the column opens for someone. */
  readonly gate: boolean;
};

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
    const gate = rects.some((r) => r.kind === 'colourGate' || rectSwitchIds(r).length > 0);
    return { x1: first.x, x2: first.x + first.w, top: Math.min(...rects.map((r) => r.y)), blocks, rectIds: rects.map((r) => r.id), gate };
  });
}

/** The wall columns the walls pass sweeps: every column but those OPT_OUTS skips. */
export function checkedWallColumns(level: Level): WallColumn[] {
  const skipped = optOutsOf(level).flatMap((o) => (o.skip === 'column' ? [o.rectId] : []));
  return wallColumns(level).filter((c) => !c.rectIds.some((id) => skipped.includes(id)));
}

export type WallPassResult = {
  readonly wallX: number;
  readonly player: PlayerId;
  readonly fromX: number;
  /** The blocked ball approaches from the side its tee is on: rightward shots from the left, leftward from the right. */
  readonly side: 'left' | 'right';
  readonly grid: 'fine' | 'human';
  readonly shots: number;
  readonly passes: number;
  readonly highestY: number;
  /** OPT_OUTS exempts this row from the highest-y assertion (its passes still count). */
  readonly highestYExempt: boolean;
};

const APPROACH_OFFSETS = [600, 400, 250, 120, 60];

function approachXs(level: Level, player: PlayerId, column: WallColumn, side: 'left' | 'right'): number[] {
  const xs = new Set<number>();
  for (const start of level.starts) if (side === 'left' ? start.x < column.x1 : start.x > column.x2) xs.add(start.x);
  for (const d of APPROACH_OFFSETS) {
    const x = side === 'left' ? column.x1 - d : column.x2 + d;
    if (x > BALL_RADIUS && x < level.width - BALL_RADIUS && !inAnyGap(level, x)) xs.add(x);
  }
  return [...xs].filter((x) => canShootFrom(level, player, onFairway(level, x), allOff(level))).sort((a, b) => a - b);
}

function inAnyGap(level: Level, x: number): boolean {
  return level.terrain.gaps.some((g) => x > g.x1 && x < g.x2);
}

function highestYExempt(level: Level, fromX: number): boolean {
  return optOutsOf(level).some((o) => o.skip === 'highestY' && fromX >= o.fromX[0] && fromX <= o.fromX[1]);
}

/** With every switch off, the blocked ball never gets past a checked wall column (criterion: 0 passes). */
export function wallPassSweep(level: Level): WallPassResult[] {
  const out: WallPassResult[] = [];
  for (const column of checkedWallColumns(level)) {
    for (const player of column.blocks) {
      const side = level.starts[player].x < column.x1 ? 'left' : 'right';
      const parked = restingBall(level.starts[otherOf(player)]);
      for (const fromX of approachXs(level, player, column, side)) {
        for (const [name, base] of [['fine', FINE_GRID], ['human', HUMAN_GRID]] as const) {
          const grid = side === 'left' ? base : mirrored(base);
          const results = sweep(level, player, onFairway(level, fromX), allOff(level), [parked], grid);
          const passes = results.filter((r) =>
            side === 'left' ? r.restX > column.x2 || r.maxX > column.x2 + BALL_RADIUS : r.restX < column.x1 || r.minX < column.x1 - BALL_RADIUS,
          ).length;
          const highestY = Math.round(Math.min(...results.map((r) => r.minY)));
          out.push({ wallX: column.x1, player, fromX, side, grid: name, shots: results.length, passes, highestY, highestYExempt: highestYExempt(level, fromX) });
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

/** With no plate held (bridge absent, cannons cold) nothing crosses a gap (criterion: 0 crossings). */
export function gapCrossSweep(level: Level): GapCrossResult[] {
  const out: GapCrossResult[] = [];
  for (const gap of level.terrain.gaps) {
    for (const player of [0, 1] as const) {
      const parked = restingBall(level.starts[otherOf(player)]);
      const xs = new Set<number>([level.starts[player].x, ...GAP_APPROACH_OFFSETS.map((d) => gap.x1 - d).filter((x) => x > BALL_RADIUS)]);
      for (const fromX of [...xs].filter((x) => canShootFrom(level, player, onFairway(level, x), allOff(level))).sort((a, b) => a - b)) {
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

export function bridgesOf(level: Level): BridgeRect[] {
  return level.rects.filter((r): r is BridgeRect => r.kind === 'bridge');
}

/** Gaps a bridge spans (the lone-plate rule applies to these). */
export function bridgedGaps(level: Level): Gap[] {
  return level.terrain.gaps.filter((g) => bridgesOf(level).some((b) => b.x === g.x1));
}

export function plateSwitches(level: Level): PressureSwitch[] {
  return level.switches.filter((sw) => sw.onRectId === undefined);
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
    for (const sw of plateSwitches(level).filter((s) => rectSwitchIds(bridge).includes(s.id) && s.x + s.w <= gap.x1)) {
      for (const shot of LONE_PLATE_SHOTS) {
        const shooter = craftedBall(level, 0, onFairway(level, sw.x + sw.w / 2));
        const game = withBalls(base, inSlotOrder(0, shooter, craftedBall(level, 1, level.starts[1])), 0);
        const r = takeShot(game, shot);
        if (r === null) continue;
        out.push({ switchId: sw.id, shot, restX: Math.round(r.summary.restX), fell: r.summary.fell, crossed: r.summary.restX > gap.x2, bridgeDrops: r.summary.bridgeDrops });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Opt-out validity: a row of OPT_OUTS must still describe its level, or the skip would be silent
// ---------------------------------------------------------------------------------------------

export type OptOutCheck = { readonly optOut: OptOut; readonly valid: boolean; readonly detail: string };

/** The nominal flight of every cannon (every plate held, so it is lit) from its breech centre. */
function cannonFlights(level: Level): { readonly id: string; readonly from: Vec; readonly to: Vec | null }[] {
  return level.rects.flatMap((r) => {
    if (r.kind !== 'cannon') return [];
    const from = { x: r.x + r.w / 2, y: r.y - BALL_RADIUS };
    const flight = predictLaunch(level, allOn(level), from, r.launch, 0, MAX_PREDICT_TICKS);
    return [{ id: r.id, from, to: flight.outcome === 'rest' ? (flight.points[flight.points.length - 1] ?? null) : null }];
  });
}

/** Checks every OPT_OUTS row of the level; `walls` is the walls pass's rows (the highest-y exemption must apply to some). */
export function checkOptOuts(level: Level, walls: readonly WallPassResult[]): OptOutCheck[] {
  return optOutsOf(level).map((o) => {
    switch (o.skip) {
      case 'column': {
        const column = wallColumns(level).find((c) => c.rectIds.includes(o.rectId));
        const valid = column !== undefined && !column.gate;
        return { optOut: o, valid, detail: column === undefined ? `no wall column holds "${o.rectId}"` : `column ${column.x1}-${column.x2} top ${column.top}: ${column.gate ? 'IS a gate' : 'permanent, no gate'}` };
      }
      case 'highestY': {
        const rows = walls.filter((w) => w.highestYExempt);
        const highest = rows.length > 0 ? Math.min(...rows.map((w) => w.highestY)) : null;
        return { optOut: o, valid: rows.length > 0 && rows.every((w) => w.passes === 0), detail: `${rows.length} exempt rows, ${rows.reduce((n, w) => n + w.passes, 0)} passes, highest centre y ${highest ?? '-'}` };
      }
      case 'lonePlate': {
        const gap = level.terrain.gaps.find((g) => g.x1 === o.gapX1);
        const bridged = gap !== undefined && bridgedGaps(level).includes(gap);
        const crossing = gap === undefined ? undefined : cannonFlights(level).find((f) => f.from.x < gap.x1 && f.to !== null && f.to.x > gap.x2);
        const valid = gap !== undefined && !bridged && crossing !== undefined;
        const lands = crossing?.to;
        return {
          optOut: o,
          valid,
          detail: gap === undefined ? `no gap starts at x ${o.gapX1}` : `gap ${gap.x1}-${gap.x2}: ${bridged ? 'BRIDGED' : 'no bridge'}, ${crossing === undefined || lands === undefined || lands === null ? 'NO cannon crosses it' : `cannon "${crossing.id}" lands at x ${Math.round(lands.x)}`}`,
        };
      }
    }
  });
}
