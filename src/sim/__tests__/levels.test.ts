// OWNER: levels
// ARCH.md §4 levels row + BUILD_DECISIONS D1/D2 (firstPlayer, labels, cupHoldsSwitch, deck inset, 420 px
// walls, 720 px chasm) + D10 (twelve holes in three worlds, global hole numbers, one world per campaign,
// traps and cannons, at most one introduced mechanic, rect and switch ids disjoint, the overview rule).
// Level ids are derived from the file names and the level names, so this file holds no level-id literal;
// the goldens it replays (levels-golden.ts) and the solver's tables are keyed by level id (D10.1). The levels
// README is binding for the level docs, so the files, constants and solver passes it names are checked to exist.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as solver from '../../../scripts/solver';
import { cameraFor } from '../../view/view';
import { onCannonBreech, releaseLabel } from '../devices';
import * as authoring from '../levels/authoring';
import { SWITCH_COLOUR, WALL_EMBED_PX, compileLevel, levelWarnings, validateLevel } from '../levels/authoring';
import * as registry from '../levels/index';
import {
  LEVELS,
  WORLD1_IDS,
  WORLDS,
  WORLD_IDS,
  campaignFrom,
  coursePar,
  hasLevel,
  levelById,
  levelsOfWorld,
  nextWorld,
  worldOf,
  worldTitle,
} from '../levels/index';
import { predictLaunch } from '../physics';
import { encodeSnapshot } from '../serialize';
import { createSim, runReplay, stepSim } from '../sim';
import { rectContains, rectSwitchIds, surfaceYAt, surfaceYOnPiece } from '../terrain';
import * as simTypes from '../types';
import type { BlockerRect, CannonRect, ColourGateRect, Level, LevelRect, PlayerCommand, SimConfig, TrapRect, Vec } from '../types';
import { BALL_RADIUS, GIMME_RADIUS, MIN_TEE_SEPARATION, NEAR_CUP_RADIUS, PLAYER_GATE_COLOUR, VIEWPORT_H } from '../types';
import { GOLDEN_LINES, goldenConfig } from './levels-golden';

/** The wall height LEVELS.md verified against the 6.5 shot speed (vacuum apex 341 + radius 12 + margin). */
const WALL_CLEARANCE_PX = 420;
const CHASM_PX = 720;
const DECK_INSET_PX = 24;

const LEVELS_DIR = fileURLToPath(new URL('../levels/', import.meta.url));

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Lowest piece surface at x (the fairway), as compileLevel resolves it. */
function fairwayY(level: Level, x: number): number {
  let best = -Infinity;
  for (const piece of level.terrain.pieces) {
    const y = surfaceYOnPiece(piece, x);
    if (y !== null && y > best) best = y;
  }
  return best;
}

function isWall(rect: LevelRect): rect is BlockerRect | ColourGateRect {
  return rect.kind === 'blocker' || rect.kind === 'colourGate';
}

function isDevice(rect: LevelRect): rect is TrapRect | CannonRect {
  return rect.kind === 'trap' || rect.kind === 'cannon';
}

/** Wall rects sharing an x-range form one column. A GATE column holds a door / window or a colour field. */
type Column = { x: number; top: number; foot: number; gate: boolean };

function wallColumns(level: Level): Column[] {
  const columns = new Map<number, Column>();
  for (const rect of level.rects.filter(isWall)) {
    const seen = columns.get(rect.x);
    const gate = rect.kind === 'colourGate' || rectSwitchIds(rect).length > 0;
    columns.set(rect.x, {
      x: rect.x,
      top: Math.min(seen?.top ?? Infinity, rect.y),
      foot: Math.max(seen?.foot ?? -Infinity, rect.y + rect.h),
      gate: (seen?.gate ?? false) || gate,
    });
  }
  return [...columns.values()];
}

function configFor(level: Level): SimConfig {
  return { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' };
}

type Twelve = [Level, Level, Level, Level, Level, Level, Level, Level, Level, Level, Level, Level];
const [L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12] = LEVELS as Twelve;

/** D10.12: the doors of Bait and Grand Machine stand flush on their channel floors. */
const FLUSH_DOOR_HOLES: readonly Level[] = [L9, L12];

describe('registry', () => {
  it('registers twelve levels in campaign order: orders 1-12, worlds 1/1/1/1/2/2/2/2/3/3/3/3', () => {
    expect(LEVELS).toHaveLength(12);
    LEVELS.forEach((level, index) => expect(level.order).toBe(index + 1));
    expect(LEVELS.map((l) => l.world)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect(Object.isFrozen(LEVELS)).toBe(true);
  });

  it('ids are unique, kebab-case and equal "w<world>-<hole, 2 digits>-<slug of the name>"', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const level of LEVELS) {
      expect(level.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(level.id).toBe(`w${level.world}-${String(level.order).padStart(2, '0')}-${slugOf(level.name)}`);
    }
  });

  it('ids match the level file names in directory order and no placeholder file remains', () => {
    const files = readdirSync(LEVELS_DIR)
      .filter((f) => /^w[1-3]-\d\d-.*\.ts$/.test(f))
      .sort();
    expect(files.map((f) => f.replace(/\.ts$/, ''))).toEqual(LEVELS.map((l) => l.id));
    expect(files.some((f) => /^w\d-00-/.test(f))).toBe(false);
  });

  it('WORLDS / WORLD_IDS / WORLD1_IDS / levelsOfWorld / worldOf / nextWorld split the twelve holes into three worlds of four', () => {
    expect(WORLDS).toEqual([1, 2, 3]);
    expect(WORLDS.flatMap((w) => WORLD_IDS[w])).toEqual(LEVELS.map((l) => l.id));
    for (const world of WORLDS) {
      expect(WORLD_IDS[world]).toEqual(LEVELS.filter((l) => l.world === world).map((l) => l.id));
      expect(levelsOfWorld(world).map((l) => l.id)).toEqual(WORLD_IDS[world]);
      expect(Object.isFrozen(WORLD_IDS[world])).toBe(true);
      for (const id of WORLD_IDS[world]) expect(worldOf(id)).toBe(world);
    }
    expect(WORLD1_IDS).toEqual([L1.id, L2.id, L3.id, L4.id]);
    expect(levelsOfWorld(2)).toEqual([L5, L6, L7, L8]);
    expect(levelsOfWorld(3)).toEqual([L9, L10, L11, L12]);
    expect([nextWorld(1), nextWorld(2), nextWorld(3)]).toEqual([2, 3, null]);
    expect(() => worldOf('w1-99-nope')).toThrow(/unknown level id/);
  });

  it('levelById / hasLevel / campaignFrom (to the last hole of the SAME world, D10.2) / coursePar / worldTitle', () => {
    for (const level of LEVELS) {
      expect(levelById(level.id)).toBe(level);
      expect(hasLevel(level.id)).toBe(true);
      const campaign = campaignFrom(level.id);
      const world = WORLD_IDS[level.world];
      expect(campaign).toEqual(world.slice(world.indexOf(level.id)));
    }
    expect(hasLevel('w1-99-nope')).toBe(false);
    expect(() => levelById('w1-99-nope')).toThrow(/unknown level id/);
    expect(() => campaignFrom('w1-99-nope')).toThrow(/unknown level id/);
    expect(campaignFrom(L1.id)).toEqual([...WORLD1_IDS]);
    expect(campaignFrom(L3.id)).toEqual([L3.id, L4.id]);
    expect(campaignFrom(L4.id)).toEqual([L4.id]);
    expect(campaignFrom(L5.id)).toEqual([L5.id, L6.id, L7.id, L8.id]);
    expect(campaignFrom(L7.id)).toEqual([L7.id, L8.id]);
    expect(campaignFrom(L9.id)).toEqual([L9.id, L10.id, L11.id, L12.id]);
    expect(campaignFrom(L12.id)).toEqual([L12.id]);
    expect(WORLDS.map((w) => coursePar(WORLD_IDS[w]))).toEqual([28, 29, 30]);
    expect(coursePar([L2.id, L4.id])).toBe(14);
    expect(WORLDS.map(worldTitle)).toEqual(['World 1 — Teach', 'World 2 — Lift & Lock', 'World 3 — Sky Machines']);
  });
});

describe('levels', () => {
  it('validateLevel(level) is [] and levelWarnings(level) is [] for every registered level', () => {
    for (const level of LEVELS) {
      expect(validateLevel(level), level.id).toEqual([]);
      expect(levelWarnings(level), level.id).toEqual([]);
    }
  });

  it('pars are 6 / 7 / 8 / 7, 7 / 6 / 8 / 8, 8 / 7 / 8 / 7 (World 1 re-derived against the real sim; worlds 2-3 calibrated by the solver, D10.13); every par >= 3; wind 0; height 720', () => {
    expect(LEVELS.map((l) => l.par)).toEqual([6, 7, 8, 7, 7, 6, 8, 8, 8, 7, 8, 7]);
    for (const level of LEVELS) {
      expect(level.par).toBeGreaterThanOrEqual(3);
      expect(level.wind).toBe(0);
      expect(level.height).toBe(VIEWPORT_H);
      expect(level.width).toBeGreaterThanOrEqual(1280);
    }
  });

  it('mechanicsIntroduced: sand, switch, colourGate, bridge in World 1; spring, trap, cannon on holes 5-7; none on holes 8-12 (D10.12); every idea distinct and present', () => {
    expect(LEVELS.map((l) => l.mechanicsIntroduced)).toEqual([['sand'], ['switch'], ['colourGate'], ['bridge'], ['spring'], ['trap'], ['cannon'], [], [], [], [], []]);
    const introduced = LEVELS.flatMap((l) => [...l.mechanicsIntroduced]);
    expect(new Set(introduced).size).toBe(introduced.length);
    for (const level of LEVELS) for (const kind of level.mechanicsIntroduced) expect(level.mechanicsPresent).toContain(kind);
  });

  it('mechanicsPresent lists exactly the kinds each level contains (every hole carries sand: the back bunker behind its cup)', () => {
    expect(LEVELS.map((l) => l.mechanicsPresent)).toEqual([
      ['sand'],
      ['sand', 'switch', 'blocker'],
      ['sand', 'colourGate', 'switch', 'blocker'],
      ['sand', 'switch', 'bridge'],
      ['sand', 'spring', 'switch', 'blocker'],
      ['sand', 'switch', 'blocker', 'trap'],
      ['sand', 'switch', 'cannon'],
      ['sand', 'spring', 'colourGate', 'switch', 'blocker'],
      ['sand', 'spring', 'switch', 'blocker', 'trap'],
      ['sand', 'spring', 'switch', 'bridge', 'cannon'],
      ['sand', 'colourGate', 'switch', 'blocker', 'cannon'],
      ['sand', 'spring', 'switch', 'blocker', 'trap', 'cannon'],
    ]);
  });

  it('every green ends in a back bunker that reaches the level edge, outside the gimme radius of the cup', () => {
    for (const level of LEVELS) {
      const back = level.rects.find((r) => r.kind === 'sand' && r.id === 'back-bunker');
      expect(back, level.id).toBeDefined();
      expect(back!.x + back!.w, level.id).toBe(level.width);
      expect(back!.x - level.hole.x, level.id).toBeGreaterThan(GIMME_RADIUS);
      expect(back!.x - level.hole.x, level.id).toBeLessThanOrEqual(NEAR_CUP_RADIUS);
      expect(back!.w, level.id).toBeGreaterThanOrEqual(40);
    }
  });

  it('the overview camera (intro and results) shows every hole down to the level bottom: rimY >= 720 - 216 / zoom', () => {
    // cameraFor (src/view/view.ts) puts the cup rim at OVERVIEW_GROUND_FRACTION of the frame, so the frame
    // bottom is rimY + 216 / zoom with zoom = 1280 / width; L10 (rim 390 on a 1960 px hole) keeps 0.75 px.
    for (const level of LEVELS) {
      const camera = cameraFor(level, createSim(configFor(level)).state, 'overview');
      expect(camera.y + VIEWPORT_H / camera.zoom, level.id).toBeGreaterThanOrEqual(level.height);
    }
  });

  it('hint / aha / watchOut are non-empty; hints are one or two sentences for the intro card', () => {
    for (const level of LEVELS) {
      expect(level.hint.trim().length).toBeGreaterThan(0);
      expect(level.aha.trim().length).toBeGreaterThan(0);
      expect(level.watchOut.trim().length).toBeGreaterThan(0);
      expect(level.hint.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0).length, level.id).toBeLessThanOrEqual(2);
      expect(level.hint.length, level.id).toBeLessThanOrEqual(220);
    }
    expect(L1.hint).toBe('Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker.');
  });

  it('firstPlayer and cupHoldsSwitch follow the design: blue first on holes 3, 8 and 10; the cup holds a plate on every hole but the first', () => {
    expect(LEVELS.map((l) => l.firstPlayer)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
    expect(LEVELS.map((l) => l.cupHoldsSwitch)).toEqual([undefined, 'window', 'door2', 'far', 'top', 'far', 'fire-far', 'door', 'top', 'b', 'far', 'top']);
    for (const level of LEVELS) {
      if (level.cupHoldsSwitch !== undefined) expect(level.switches.map((s) => s.id)).toContain(level.cupHoldsSwitch);
    }
  });

  it('every switch and switch-driven rect carries its D2 / D10 label', () => {
    const plates = (level: Level): (string | undefined)[][] => level.switches.map((s) => [s.id, s.label]);
    expect(plates(L2)).toEqual([
      ['door', 'DOOR'],
      ['window', 'WINDOW'],
    ]);
    expect(plates(L3)).toEqual([
      ['door1', 'DOOR 1'],
      ['door2', 'DOOR 2'],
    ]);
    expect(plates(L4)).toEqual([
      ['near', 'A'],
      ['far', 'B'],
      ['deck', 'DECK'],
    ]);
    expect(plates(L5)).toEqual([
      ['door', 'DOOR'],
      ['top', 'TOP'],
    ]);
    expect(plates(L6)).toEqual([
      ['perch', 'PERCH'],
      ['free', 'FREE'],
      ['far', 'FAR'],
    ]);
    expect(plates(L7)).toEqual([
      ['fire', 'FIRE'],
      ['fire-far', 'FIRE'],
    ]);
    expect(plates(L8)).toEqual([
      ['window', 'WINDOW'],
      ['door', 'DOOR'],
    ]);
    expect(plates(L9)).toEqual([
      ['bait', 'BAIT'],
      ['top', 'TOP'],
    ]);
    expect(plates(L10)).toEqual([
      ['a', 'A'],
      ['b', 'B'],
      ['deck', 'DECK'],
    ]);
    expect(plates(L11)).toEqual([
      ['fire', 'FIRE'],
      ['far', 'FAR'],
    ]);
    expect(plates(L12)).toEqual([
      ['fire', 'FIRE'],
      ['door', 'DOOR'],
      ['top', 'TOP'],
    ]);
    for (const level of LEVELS) {
      for (const rect of level.rects) {
        if (rectSwitchIds(rect).length > 0) expect(rect.label, `${level.id}/${rect.id}`).toBeTruthy();
        if (rect.kind === 'spring') expect(rect.label, `${level.id}/${rect.id}`).toBe('SPRING');
      }
    }
    const labelOf = (level: Level, id: string): string | undefined => level.rects.find((r) => r.id === id)?.label;
    expect(labelOf(L2, 'door-gate')).toBe('DOOR');
    expect(labelOf(L2, 'window-gate')).toBe('WINDOW');
    expect(labelOf(L3, 'door-1-gate')).toBe('DOOR 1');
    expect(labelOf(L3, 'door-2-gate')).toBe('DOOR 2');
    expect(labelOf(L4, 'bridge')).toBe('BRIDGE');
    for (const level of [L5, L6, L8, L9, L11, L12]) expect(labelOf(level, 'door-gate'), level.id).toBe('DOOR');
    expect(labelOf(L8, 'window-gate')).toBe('WINDOW');
    expect(labelOf(L10, 'bridge')).toBe('BRIDGE');
  });

  it('rect ids and switch ids are disjoint within every level (D10.8: door-gate, window-gate)', () => {
    for (const level of LEVELS) {
      const rectIds = new Set(level.rects.map((r) => r.id));
      expect(level.switches.map((s) => s.id).filter((id) => rectIds.has(id)), level.id).toEqual([]);
    }
  });

  it('traps and cannons follow the D10 table: kind, release / FIRE plates in order (partner-reachable first), label TRAP / CANNON', () => {
    const devicesOf = (level: Level): unknown[][] => level.rects.filter(isDevice).map((r) => [r.id, r.kind, rectSwitchIds(r), r.label]);
    for (const level of [L1, L2, L3, L4, L5, L8]) expect(devicesOf(level), level.id).toEqual([]);
    expect(devicesOf(L6)).toEqual([['snare', 'trap', ['free', 'far'], 'TRAP']]);
    expect(devicesOf(L7)).toEqual([['cannon', 'cannon', ['fire', 'fire-far'], 'CANNON']]);
    expect(devicesOf(L9)).toEqual([['bait-trap', 'trap', ['top'], 'TRAP']]);
    expect(devicesOf(L10)).toEqual([['cannon', 'cannon', ['a', 'b', 'deck'], 'CANNON']]);
    expect(devicesOf(L11)).toEqual([['cannon', 'cannon', ['fire', 'far'], 'CANNON']]);
    expect(devicesOf(L12)).toEqual([
      ['pit', 'trap', ['fire', 'top'], 'TRAP'],
      ['cannon', 'cannon', ['fire', 'top'], 'CANNON'],
      ['door-seat', 'trap', ['top'], 'TRAP'],
    ]);
  });

  it('every device names a labelled first plate (the HUD chip "CAUGHT · needs <LABEL>", D10.10) and the cup holds one of its plates', () => {
    const chips: string[] = [];
    for (const level of LEVELS) {
      for (const rect of level.rects.filter(isDevice)) {
        const first = level.switches.find((s) => s.id === rectSwitchIds(rect)[0]);
        expect(first, `${level.id}/${rect.id}`).toBeDefined();
        expect(first?.label, `${level.id}/${rect.id}`).toBeTruthy();
        expect(releaseLabel(level, rect)).toBe(first?.label);
        expect(rectSwitchIds(rect), `${level.id}/${rect.id}`).toContain(level.cupHoldsSwitch);
        chips.push(`${level.order}:${rect.id}:${releaseLabel(level, rect)}`);
      }
    }
    expect(chips).toEqual(['6:snare:FREE', '7:cannon:FIRE', '9:bait-trap:TOP', '10:cannon:A', '11:cannon:FIRE', '12:pit:FIRE', '12:cannon:FIRE', '12:door-seat:TOP']);
  });

  it('launchers keep the vectors and pads the launcher re-verification measured (levels README): breech or pad x-range, y and launch', () => {
    const launchers = (level: Level): unknown[][] =>
      level.rects.flatMap((r) => (r.kind === 'spring' || r.kind === 'cannon' ? [[r.id, r.x, r.x + r.w, r.y, r.launch.x, r.launch.y]] : []));
    expect(launchers(L5)).toEqual([['spring', 862, 918, 620, 150, -800]]);
    expect(launchers(L7)).toEqual([['cannon', 890, 930, 565, 400, -700]]);
    expect(launchers(L8)).toEqual([['spring', 702, 758, 620, 380, -780]]);
    expect(launchers(L9)).toEqual([['spring', 976, 1040, 580, 200, -740]]);
    expect(launchers(L10)).toEqual([
      ['cannon', 76, 124, 600, 520, -760],
      ['spring', 442, 498, 620, 120, -690],
    ]);
    expect(launchers(L11)).toEqual([['cannon', 780, 840, 640, 440, -730]]);
    expect(launchers(L12)).toEqual([
      ['cannon', 100, 140, 565, 700, -760],
      ['spring', 972, 1028, 640, 180, -800],
    ]);
    const zones = (level: Level): unknown[][] => level.rects.flatMap((r) => (r.kind === 'trap' ? [[r.id, r.x, r.y, r.w, r.h]] : []));
    expect(zones(L6)).toEqual([['snare', 350, 560, 100, 80]]);
    expect(zones(L9)).toEqual([['bait-trap', 480, 590, 130, 50]]);
    expect(zones(L12)).toEqual([
      ['pit', 12, 590, 28, 50],
      ['door-seat', 680, 590, 100, 50],
    ]);
  });

  it('the only seats (a plate wholly inside a trap, so its holder is caught) are BAIT on hole 9 and DOOR on hole 12; no release or FIRE plate is a seat', () => {
    const seats: string[] = [];
    for (const level of LEVELS) {
      const devicePlates = new Set(level.rects.filter(isDevice).flatMap((r) => [...rectSwitchIds(r)]));
      for (const sw of level.switches) {
        const rests: Vec[] = [sw.x, sw.x + sw.w / 2, sw.x + sw.w].map((x) => ({ x, y: sw.surfaceY - BALL_RADIUS }));
        for (const trap of level.rects.filter((r) => r.kind === 'trap')) {
          const inside = rests.filter((p) => rectContains(trap, p)).length;
          if (inside === 0) continue;
          expect(inside, `${level.id}/${sw.id} straddles ${trap.id}`).toBe(rests.length);
          expect(devicePlates.has(sw.id), `${level.id}/${sw.id}`).toBe(false);
          seats.push(`${level.order}:${sw.id}:${trap.id}`);
        }
      }
    }
    expect(seats).toEqual(['9:bait:bait-trap', '12:door:door-seat']);
  });

  it('L11: between the DOOR and the chasm a ball rests only on the cannon breech (LOADED while cold), and a lit cannon fires every ball there', () => {
    // Blue gets right of the red field only through the door, which only FAR holds open. Appendix A's 20 px flat at
    // 880-900 held a ball there after red left FAR: door shut, cannon cold, FIRE and FAR out of reach, a softlock the
    // scoped reset never ends. Every ball between the door and the chasm lip (dropped dead or rolling either way)
    // must end in the breech, fired by FIRE or LOADED, or fall into the chasm (+1 back to its safe spot).
    const door = L11.rects.find((r) => r.kind === 'blocker' && rectSwitchIds(r).length > 0);
    const cannon = L11.rects.find((r): r is CannonRect => r.kind === 'cannon');
    const gap = L11.terrain.gaps[0];
    if (door === undefined || cannon === undefined || gap === undefined) throw new Error('L11 lost its door, cannon or chasm');
    // the FIRE plate is the cannon's plate that does not also open the door (FAR does both)
    expect(rectSwitchIds(cannon).filter((id) => !rectSwitchIds(door).includes(id))).toEqual(['fire']);
    const strays: string[] = [];
    let loaded = 0;
    let fired = 0;
    for (let x = door.x + door.w + 1; x < gap.x1; x += 1) {
      const ground = surfaceYAt(L11, x);
      if (ground === null) throw new Error(`L11 has no ground at x ${x}`);
      for (const vx of [0, -60, 60]) {
        for (const player of [0, 1] as const) {
          const from = { x, y: ground - BALL_RADIUS - 1 };
          const cold = predictLaunch(L11, {}, from, { x: vx, y: 0 }, player);
          const coldEnd = cold.points[cold.points.length - 1];
          if (cold.outcome === 'rest' && coldEnd !== undefined && onCannonBreech(L11, coldEnd)) loaded += 1;
          else if (cold.outcome !== 'fell') strays.push(`cold P${player + 1} ${x}/${vx}: ${cold.outcome} at ${coldEnd?.x}`);
          const lit = predictLaunch(L11, { fire: true }, from, { x: vx, y: 0 }, player);
          const litEnd = lit.points[lit.points.length - 1];
          if (lit.outcome === 'rest' && litEnd !== undefined && litEnd.x > gap.x2) fired += 1;
          else if (lit.outcome !== 'fell') strays.push(`lit P${player + 1} ${x}/${vx}: ${lit.outcome} at ${litEnd?.x}`);
        }
      }
    }
    expect(strays).toEqual([]);
    expect(loaded).toBeGreaterThan(0);
    expect(fired).toBe(loaded);
  });

  it('every plate uses the single switch accent colour (pairs differ by label, not hue)', () => {
    for (const level of LEVELS) for (const sw of level.switches) expect(sw.colour).toBe(SWITCH_COLOUR);
  });

  it('every plate is far outside the gimme and near-cup radii of its cup (a holder is never conceded)', () => {
    for (const level of LEVELS) {
      for (const sw of level.switches) {
        const edgeDistance = Math.max(sw.x - level.hole.x, level.hole.x - (sw.x + sw.w), 0);
        expect(edgeDistance, `${level.id}/${sw.id}`).toBeGreaterThan(GIMME_RADIUS + NEAR_CUP_RADIUS);
      }
    }
  });

  it('every gate column (door, window or colour field, a cap stacked on it) rises >= 420 px above the fairway; its foot sinks 20 px into it, flush on the L9 and L12 channel floors (D10.12)', () => {
    for (const level of LEVELS) {
      for (const column of wallColumns(level).filter((c) => c.gate)) {
        const fairway = fairwayY(level, column.x);
        expect(fairway - column.top, `${level.id} wall at ${column.x}`).toBeGreaterThanOrEqual(WALL_CLEARANCE_PX);
        expect(column.foot - fairway, `${level.id} wall foot at ${column.x}`).toBe(FLUSH_DOOR_HOLES.includes(level) ? 0 : WALL_EMBED_PX);
      }
    }
    expect(LEVELS.map((l) => wallColumns(l).filter((c) => c.gate).length)).toEqual([0, 1, 2, 0, 1, 1, 0, 2, 1, 0, 2, 1]);
    // The L6 backboard (a permanent 120 px backstop behind the perch bowl) is the one wall that is not a gate.
    expect(wallColumns(L6).filter((c) => !c.gate)).toEqual([{ x: 162, top: 340, foot: 480, gate: false }]);
  });

  it('L3 colour fields are blue over DOOR 1 (red bounces) and red over DOOR 2 (blue bounces), each above a door opened by the other colour', () => {
    const fields = L3.rects.filter((r): r is ColourGateRect => r.kind === 'colourGate');
    expect(fields.map((f) => f.colour)).toEqual([PLAYER_GATE_COLOUR[1], PLAYER_GATE_COLOUR[0]]);
    const doors = L3.rects.filter((r): r is BlockerRect => r.kind === 'blocker');
    expect(doors.map((d) => d.switchId)).toEqual(['door1', 'door2']);
    expect(doors.every((d) => d.activeWhen === false)).toBe(true);
    fields.forEach((field, i) => expect(field.y + field.h).toBe(doors[i]!.y));
  });

  it('L2 door and window are blockers with activeWhen false under a permanent cap; the cap has no switch', () => {
    const cap = L2.rects.find((r) => r.id === 'wall-cap');
    expect(cap?.kind).toBe('blocker');
    expect(cap?.switchId).toBeUndefined();
    expect(cap?.switchIds).toBeUndefined();
    for (const id of ['window-gate', 'door-gate']) {
      const gate = L2.rects.find((r) => r.id === id);
      expect(gate?.kind).toBe('blocker');
      expect(gate?.activeWhen).toBe(false);
    }
  });

  it('the L4 and L10 bridges span their 720 px gap at the lip height, held by A, B or the DECK; each DECK plate is inset 24 px on its bridge', () => {
    for (const [level, plates, top] of [
      [L4, ['near', 'far', 'deck'], 620],
      [L10, ['a', 'b', 'deck'], 400],
    ] as const) {
      const bridge = level.rects.find((r) => r.id === 'bridge');
      expect(level.terrain.gaps).toHaveLength(1);
      const gap = level.terrain.gaps[0]!;
      expect(gap.x2 - gap.x1).toBe(CHASM_PX);
      expect(bridge?.kind).toBe('bridge');
      expect(bridge?.x).toBe(gap.x1);
      expect(bridge?.w).toBe(gap.x2 - gap.x1);
      expect(bridge?.y).toBe(top);
      expect(bridge?.switchIds).toEqual(plates);
      expect(bridge?.switchId).toBeUndefined();
      const deck = level.switches.find((s) => s.id === 'deck');
      expect(deck?.onRectId).toBe('bridge');
      expect(deck?.x).toBe(gap.x1 + DECK_INSET_PX);
      expect(deck!.x + deck!.w).toBe(gap.x2 - DECK_INSET_PX);
      expect(deck?.surfaceY).toBe(bridge?.y);
      for (const sw of level.switches) if (sw.onRectId === undefined) expect(sw.surfaceY).toBe(fairwayY(level, sw.x + sw.w / 2));
    }
    expect(L4.terrain.gaps).toEqual([{ x1: 520, x2: 1240 }]);
  });

  it('tees sit on the fairway >= MIN_TEE_SEPARATION apart and compiled positions are 2-dp exact', () => {
    for (const level of LEVELS) {
      const [a, b] = level.starts;
      expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(MIN_TEE_SEPARATION);
      for (const v of [a.x, a.y, b.x, b.y, level.hole.rimY, ...level.switches.map((s) => s.surfaceY)]) {
        expect(Math.round(v * 100) / 100).toBe(v);
      }
      expect(a.y + 12).toBe(fairwayY(level, a.x));
      expect(level.hole.rimY).toBe(fairwayY(level, level.hole.x));
    }
  });

  it('createSim on every level starts with firstPlayer active, balls on the tees and one switch key per plate', () => {
    for (const level of LEVELS) {
      const { state, events } = createSim(configFor(level));
      expect(state.phase).toBe('intro');
      expect(state.activePlayer).toBe(level.firstPlayer);
      expect(state.balls.map((b) => b.pos)).toEqual([...level.starts]);
      expect(Object.keys(state.switches).sort()).toEqual(level.switches.map((s) => s.id).sort());
      expect(Object.values(state.switches).every((v) => v === false)).toBe(true);
      expect(events[0]).toMatchObject({ type: 'levelStart', levelId: level.id, firstPlayer: level.firstPlayer });
    }
  });
});

describe("golden replay of each level's scripted line (runReplay on the real levels)", () => {
  const snapshotJson = (state: ReturnType<typeof runReplay>['state']): string => JSON.stringify(encodeSnapshot(state));

  it('every hole has exactly one golden line, keyed by its level id in campaign order, with the hole number and name of the registry', () => {
    expect(GOLDEN_LINES.map((g) => g.levelId)).toEqual(LEVELS.map((l) => l.id));
    for (const golden of GOLDEN_LINES) {
      expect(golden.order).toBe(levelById(golden.levelId).order);
      expect(golden.name).toBe(levelById(golden.levelId).name);
    }
  });

  for (const golden of GOLDEN_LINES) {
    const level = levelById(golden.levelId);

    it(`hole ${golden.order} (${golden.name}): the recorded line holes both balls in ${golden.strokes.join('+')} and the snapshot is bit-exact`, () => {
      const { state, events } = runReplay(goldenConfig(level.id), golden.log, golden.finalTick);
      expect(state.phase).toBe('levelResults');
      expect(state.balls.every((b) => b.sunk)).toBe(true);
      expect(state.players.map((p) => p.strokes)).toEqual([...golden.strokes]);
      expect(state.campaign).toEqual([{ levelId: level.id, par: level.par, strokes: [...golden.strokes], medal: expect.any(String) }]);
      // every stroke is a shot or a gimme concession; none is a fall penalty or a BACK +1, and no flight needs the watchdog
      const hits = events.filter((e) => e.type === 'ballHit').length;
      const gimmes = events.filter((e) => e.type === 'gimme').length;
      expect(hits + gimmes).toBe(golden.strokes[0] + golden.strokes[1]);
      expect(events.some((e) => e.type === 'fellOffWorld' || e.type === 'trapReturn' || e.type === 'flightTimeout')).toBe(false);
      // Recorded on Node 22 / V8 by scripts/solver.ts. A differing value means the physics, the level or the engine changed.
      expect(snapshotJson(state)).toBe(golden.snapshot);
    });

    it(`hole ${golden.order} (${golden.name}): the same log stepped incrementally equals the replay (split-run equivalence)`, () => {
      const whole = runReplay(goldenConfig(level.id), golden.log, golden.finalTick).state;
      let state = createSim(goldenConfig(level.id)).state;
      let cursor = 0;
      for (let t = 0; t < golden.finalTick; t += 1) {
        const cmds: PlayerCommand[] = [];
        while (cursor < golden.log.length && golden.log[cursor]!.tick === t) cmds.push(golden.log[cursor++]!.cmd);
        state = stepSim(state, cmds).state;
      }
      expect(snapshotJson(state)).toBe(snapshotJson(whole));
      expect(state).toEqual(whole);
    });
  }
});

describe('validateLevel rules (negative cases on mutated copies of the real levels)', () => {
  const mutate = (level: Level, patch: Partial<Level>): Level => ({ ...level, ...patch });

  it('a bridge needs switchId or a non-empty switchIds and must start at a gap with the gap width', () => {
    const bridge = L4.rects[0]!;
    const { switchIds: _ignored, ...bare } = bridge;
    expect(validateLevel(mutate(L4, { rects: [bare] })).join(' ')).toMatch(/switchId or a non-empty switchIds/);
    expect(validateLevel(mutate(L4, { rects: [{ ...bridge, switchIds: [] }] })).join(' ')).toMatch(/empty switchIds|switchId or a non-empty/);
    expect(validateLevel(mutate(L4, { rects: [{ ...bridge, x: 500 }] })).join(' ')).toMatch(/does not start at a gap/);
    expect(validateLevel(mutate(L4, { rects: [{ ...bridge, w: 700 }] })).join(' ')).toMatch(/width 700 must equal the gap width 720/);
    expect(validateLevel(mutate(L4, { rects: [{ ...bridge, y: 630 }] })).join(' ')).toMatch(/not within 3 px of the lip/);
  });

  it('a deck plate must sit on a bridge/blocker rect, inside it, at the rect top', () => {
    const deck = L4.switches[2]!;
    const bridge = L4.rects[0]!;
    const sand: LevelRect = { kind: 'sand', id: 'sandy', x: 100, y: 624, w: 60, h: 16 };
    const onSand = mutate(L4, { rects: [bridge, sand], switches: [L4.switches[0]!, L4.switches[1]!, { ...deck, onRectId: 'sandy' }] });
    expect(validateLevel(onSand).join(' ')).toMatch(/not a bridge or blocker/);
    const stickingOut = mutate(L4, { switches: [L4.switches[0]!, L4.switches[1]!, { ...deck, x: 500 }] });
    expect(validateLevel(stickingOut).join(' ')).toMatch(/sticks out of rect/);
    const wrongY = mutate(L4, { switches: [L4.switches[0]!, L4.switches[1]!, { ...deck, surfaceY: 630 }] });
    expect(validateLevel(wrongY).join(' ')).toMatch(/must equal the top of/);
  });

  it('every switchId resolves and every switch is referenced by a rect or the cup', () => {
    const orphan = mutate(L2, { switches: [...L2.switches, { id: 'spare', x: 300, w: 60, surfaceY: 620, colour: SWITCH_COLOUR }] });
    expect(validateLevel(orphan).join(' ')).toMatch(/switch "spare" is referenced by nothing/);
    const dangling = mutate(L2, { rects: L2.rects.map((r) => (r.id === 'door-gate' ? { ...r, switchId: 'ghost' } : r)) });
    expect(validateLevel(dangling).join(' ')).toMatch(/unknown switch "ghost"/);
    expect(validateLevel(mutate(L2, { cupHoldsSwitch: 'ghost' })).join(' ')).toMatch(/cupHoldsSwitch "ghost" is not a switch/);
  });

  it('gaps may not be covered and must be bounded by piece ends; pieces need increasing x and a lower base', () => {
    const covering = mutate(L4, { terrain: { ...L4.terrain, pieces: [L1.terrain.pieces[0]!, ...L4.terrain.pieces] } });
    expect(validateLevel(covering).join(' ')).toMatch(/covers the inside of gap/);
    const openEnded = mutate(L4, { terrain: { ...L4.terrain, gaps: [{ x1: 530, x2: 1240 }] } });
    expect(validateLevel(openEnded).join(' ')).toMatch(/no piece ends exactly at gap x1=530/);
    const badPiece = mutate(L1, { terrain: { pieces: [{ surface: [{ x: 0, y: 590 }, { x: 0, y: 590 }], baseY: 500 }], gaps: [] } });
    const errors = validateLevel(badPiece).join(' ');
    expect(errors).toMatch(/strictly increasing/);
    expect(errors).toMatch(/baseY must be below/);
  });

  it('walls must be tall, grounded (or stacked) and mechanicsPresent must match the rects', () => {
    const floating = mutate(L2, { rects: L2.rects.map((r) => (r.id === 'door-gate' ? { ...r, y: 400 } : r)) });
    expect(validateLevel(floating).join(' ')).toMatch(/neither stands on the fairway nor on another wall/);
    const stubby = mutate(L2, { rects: L2.rects.map((r) => (r.id === 'wall-cap' ? { ...r, y: 300, h: 50 } : r)) });
    expect(validateLevel(stubby).join(' ')).toMatch(/shorter than 120 px/);
    expect(validateLevel(mutate(L2, { mechanicsPresent: ['switch'] })).join(' ')).toMatch(/mechanicsPresent/);
    expect(validateLevel(mutate(L1, { mechanicsIntroduced: ['spring'] })).join(' ')).toMatch(/introduced mechanic "spring" is not present/);
  });

  it('tees, plates and the cup must rest on gentle fairway, outside gaps; ids must be kebab-case and unique', () => {
    const rampTee = mutate(L2, { starts: [{ x: 715, y: 618 }, L2.starts[1]] });
    expect(validateLevel(rampTee).join(' ')).toMatch(/tee 0 sits on a slope/);
    const gapCup = mutate(L4, { hole: { ...L4.hole, x: 900 } });
    expect(validateLevel(gapCup).join(' ')).toMatch(/cup at x=900 is inside a gap/);
    const dupe = mutate(L3, { rects: [...L3.rects, { ...L3.rects[0]! }] });
    expect(validateLevel(dupe).join(' ')).toMatch(/duplicate rect id/);
    const shouty = mutate(L1, { rects: [{ ...L1.rects[0]!, id: 'Bunker_1' }] });
    expect(validateLevel(shouty).join(' ')).toMatch(/not kebab-case/);
  });

  it('compileLevel throws with every message when a definition is invalid', () => {
    expect(() =>
      compileLevel({
        id: 'w1-99-broken',
        name: 'Broken',
        world: 1,
        order: 9,
        par: 2,
        hint: 'x',
        aha: 'x',
        watchOut: 'x',
        mechanicsIntroduced: ['sand'],
        firstPlayer: 0,
        width: 1280,
        wind: 0,
        terrain: L1.terrain,
        props: [],
        switches: [],
        holeX: 1190,
        startXs: [90, 100],
      }),
    ).toThrow(/par must be >= 3.*tees too close|tees too close.*par must be >= 3|introduced mechanic "sand" is not present/);
  });
});

// worlds-2-3 LEVELS.md: "the code and that README win where they differ", so the README may not drift from the code.
describe('levels README names only files, constants and solver passes that exist', () => {
  const ROOT = new URL('../../../', import.meta.url);
  const README = readFileSync(`${LEVELS_DIR}README.md`, 'utf8');
  /** The text of every inline code span (the fenced recipe block dropped; a span may wrap onto the next line). */
  const spans = [...README.replace(/^```[\s\S]*?^```$/gm, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  /** `levels-solver-w{1,2,3}.test.ts` names three files. */
  const expandBraces = (s: string): string[] => {
    const open = s.indexOf('{');
    const close = s.indexOf('}', open);
    if (open < 0 || close < 0) return [s];
    return s.slice(open + 1, close).split(',').flatMap((alt) => expandBraces(s.slice(0, open) + alt + s.slice(close + 1)));
  };
  const exists = (file: string): boolean => existsSync(new URL(file, ROOT));
  /** Where a bare file name (no directory) may live. */
  const BARE_NAME_DIRS = ['src/sim/', 'src/sim/levels/', 'src/sim/__tests__/', 'scripts/', 'scripts/solver/'];

  it('every file it names exists (a repo path, or a bare name in src/sim, its levels or tests, scripts or scripts/solver)', () => {
    const files = spans.filter((s) => /^[\w./{},-]+\.(ts|md|yml)$/.test(s)).flatMap(expandBraces);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => (f.includes('/') ? !exists(f) : !BARE_NAME_DIRS.some((dir) => exists(dir + f))))).toEqual([]);
  });

  it('every SCREAMING_SNAKE_CASE constant it names is exported by sim/types, levels/authoring, the registry or the solver', () => {
    const constants = spans.filter((s) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s));
    expect(constants.length).toBeGreaterThan(0);
    expect(constants.filter((name) => ![simTypes, authoring, registry, solver].some((mod) => name in mod))).toEqual([]);
  });

  it('the verification recipe documents every solver pass in a bullet of its own', () => {
    expect(solver.PASS_NAMES.filter((pass) => !README.includes(`\n- \`${pass}\` — `))).toEqual([]);
  });
});
