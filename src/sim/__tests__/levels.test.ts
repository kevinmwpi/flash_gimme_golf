// OWNER: levels
// ARCH.md §4 levels row + BUILD_DECISIONS D1/D2 (firstPlayer, labels, cupHoldsSwitch, deck inset,
// 420 px walls, 720 px chasm). Level ids are derived from the file names and the level names so
// no level-id literal lives outside src/sim/levels/.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SWITCH_COLOUR, WALL_EMBED_PX, compileLevel, levelWarnings, validateLevel } from '../levels/authoring';
import { LEVELS, WORLD1_IDS, campaignFrom, coursePar, hasLevel, levelById, worldTitle } from '../levels/index';
import { encodeSnapshot } from '../serialize';
import { createSim, runReplay, stepSim } from '../sim';
import { surfaceYOnPiece } from '../terrain';
import type { BlockerRect, ColourGateRect, Level, LevelRect, PlayerCommand, SimConfig } from '../types';
import { GIMME_RADIUS, MIN_TEE_SEPARATION, NEAR_CUP_RADIUS, PLAYER_GATE_COLOUR, VIEWPORT_H } from '../types';
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

/** Wall rects sharing an x-range form one column; returns [x, top] per column. */
function wallColumns(level: Level): { x: number; top: number }[] {
  const columns = new Map<number, number>();
  for (const rect of level.rects.filter(isWall)) columns.set(rect.x, Math.min(columns.get(rect.x) ?? Infinity, rect.y));
  return [...columns.entries()].map(([x, top]) => ({ x, top }));
}

function configFor(level: Level): SimConfig {
  return { playerCount: 2, levelIds: [level.id], seed: 7, mode: 'local' };
}

const [L1, L2, L3, L4] = LEVELS as [Level, Level, Level, Level];

describe('World 1 registry', () => {
  it('registers exactly four levels in campaign order with 1-based order fields', () => {
    expect(LEVELS).toHaveLength(4);
    LEVELS.forEach((level, index) => {
      expect(level.world).toBe(1);
      expect(level.order).toBe(index + 1);
    });
    expect(Object.isFrozen(LEVELS)).toBe(true);
    expect(WORLD1_IDS).toEqual(LEVELS.map((l) => l.id));
  });

  it('ids are unique, kebab-case and equal "w1-0N-<slug of the name>"', () => {
    expect(new Set(WORLD1_IDS).size).toBe(WORLD1_IDS.length);
    LEVELS.forEach((level, index) => {
      expect(level.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(level.id).toBe(`w1-0${index + 1}-${slugOf(level.name)}`);
    });
  });

  it('ids match the level file names in directory order and no placeholder file remains', () => {
    const files = readdirSync(LEVELS_DIR)
      .filter((f) => /^w1-\d\d-.*\.ts$/.test(f))
      .sort();
    expect(files.map((f) => f.replace(/\.ts$/, ''))).toEqual([...WORLD1_IDS]);
    expect(files.some((f) => f.startsWith('w1-00-'))).toBe(false);
  });

  it('levelById / hasLevel / campaignFrom / coursePar / worldTitle', () => {
    for (const level of LEVELS) {
      expect(levelById(level.id)).toBe(level);
      expect(hasLevel(level.id)).toBe(true);
    }
    expect(hasLevel('w1-99-nope')).toBe(false);
    expect(() => levelById('w1-99-nope')).toThrow(/unknown level id/);
    expect(() => campaignFrom('w1-99-nope')).toThrow(/unknown level id/);
    expect(campaignFrom(L1.id)).toEqual([...WORLD1_IDS]);
    expect(campaignFrom(L3.id)).toEqual([L3.id, L4.id]);
    expect(coursePar(WORLD1_IDS)).toBe(28);
    expect(coursePar([L2.id, L4.id])).toBe(14);
    expect(worldTitle(1)).toBe('World 1 — Teach');
  });
});

describe('World 1 levels', () => {
  it('validateLevel(level) is [] and levelWarnings(level) is [] for every registered level', () => {
    for (const level of LEVELS) {
      expect(validateLevel(level), level.id).toEqual([]);
      expect(levelWarnings(level), level.id).toEqual([]);
    }
  });

  it('pars are 6 / 7 / 8 / 7 (course 28, re-derived against the real sim); every par >= 3; wind 0; height 720', () => {
    expect(LEVELS.map((l) => l.par)).toEqual([6, 7, 8, 7]);
    for (const level of LEVELS) {
      expect(level.par).toBeGreaterThanOrEqual(3);
      expect(level.wind).toBe(0);
      expect(level.height).toBe(VIEWPORT_H);
      expect(level.width).toBeGreaterThanOrEqual(1280);
    }
  });

  it('mechanicsIntroduced is sand, switch, colourGate, bridge: four distinct ideas, each present in its level', () => {
    expect(LEVELS.map((l) => l.mechanicsIntroduced)).toEqual([['sand'], ['switch'], ['colourGate'], ['bridge']]);
    expect(new Set(LEVELS.map((l) => l.mechanicsIntroduced[0])).size).toBe(LEVELS.length);
    for (const level of LEVELS) expect(level.mechanicsPresent).toContain(level.mechanicsIntroduced[0]);
  });

  it('mechanicsPresent lists exactly the kinds each level contains (every hole carries sand: the back bunker behind its cup)', () => {
    expect(L1.mechanicsPresent).toEqual(['sand']);
    expect(L2.mechanicsPresent).toEqual(['sand', 'switch', 'blocker']);
    expect(L3.mechanicsPresent).toEqual(['sand', 'colourGate', 'switch', 'blocker']);
    expect(L4.mechanicsPresent).toEqual(['sand', 'switch', 'bridge']);
  });

  it('every green ends in a back bunker that reaches the level edge, outside the gimme radius of the cup', () => {
    for (const level of LEVELS) {
      const back = level.rects.find((r) => r.kind === 'sand' && r.id === 'back-bunker');
      expect(back, level.id).toBeDefined();
      expect(back!.x + back!.w).toBe(level.width);
      expect(back!.x - level.hole.x).toBeGreaterThan(GIMME_RADIUS);
      expect(back!.x - level.hole.x).toBeLessThanOrEqual(NEAR_CUP_RADIUS);
      expect(back!.w).toBeGreaterThanOrEqual(40);
    }
  });

  it('hint / aha / watchOut are non-empty; hints are one or two sentences for the intro card', () => {
    for (const level of LEVELS) {
      expect(level.hint.trim().length).toBeGreaterThan(0);
      expect(level.aha.trim().length).toBeGreaterThan(0);
      expect(level.watchOut.trim().length).toBeGreaterThan(0);
      expect(level.hint.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0).length).toBeLessThanOrEqual(2);
      expect(level.hint.length).toBeLessThanOrEqual(220);
    }
    expect(L1.hint).toBe('Pull back from your ball and let go. Sand stops a rolling ball dead, so pitch over the bunker.');
  });

  it('firstPlayer is red, red, BLUE, red; cupHoldsSwitch wires L2 window, L3 door2, L4 far', () => {
    expect(LEVELS.map((l) => l.firstPlayer)).toEqual([0, 0, 1, 0]);
    expect(L1.cupHoldsSwitch).toBeUndefined();
    expect(L2.cupHoldsSwitch).toBe('window');
    expect(L3.cupHoldsSwitch).toBe('door2');
    expect(L4.cupHoldsSwitch).toBe('far');
    for (const level of LEVELS) {
      if (level.cupHoldsSwitch !== undefined) expect(level.switches.map((s) => s.id)).toContain(level.cupHoldsSwitch);
    }
  });

  it('every switch and switch-driven rect carries its D2 label (DOOR / WINDOW, DOOR 1 / DOOR 2, A / B / DECK, BRIDGE)', () => {
    expect(L2.switches.map((s) => [s.id, s.label])).toEqual([
      ['door', 'DOOR'],
      ['window', 'WINDOW'],
    ]);
    expect(L3.switches.map((s) => [s.id, s.label])).toEqual([
      ['door1', 'DOOR 1'],
      ['door2', 'DOOR 2'],
    ]);
    expect(L4.switches.map((s) => [s.id, s.label])).toEqual([
      ['near', 'A'],
      ['far', 'B'],
      ['deck', 'DECK'],
    ]);
    for (const level of LEVELS) {
      for (const rect of level.rects) {
        const driven = rect.switchId !== undefined || (rect.switchIds !== undefined && rect.switchIds.length > 0);
        if (driven) expect(rect.label, `${level.id}/${rect.id}`).toBeTruthy();
      }
    }
    const labelOf = (level: Level, id: string): string | undefined => level.rects.find((r) => r.id === id)?.label;
    expect(labelOf(L2, 'door-gate')).toBe('DOOR');
    expect(labelOf(L2, 'window-gate')).toBe('WINDOW');
    expect(labelOf(L3, 'door-1-gate')).toBe('DOOR 1');
    expect(labelOf(L3, 'door-2-gate')).toBe('DOOR 2');
    expect(labelOf(L4, 'bridge')).toBe('BRIDGE');
  });

  it('every World 1 plate uses the single switch accent colour (pairs differ by label, not hue)', () => {
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

  it('walls and colour fields rise >= 420 px above the fairway, stand embedded 20 px into it, and the L4 gap is 720 px', () => {
    for (const level of [L2, L3]) {
      const columns = wallColumns(level);
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) expect(fairwayY(level, column.x) - column.top, `${level.id} wall at ${column.x}`).toBeGreaterThanOrEqual(WALL_CLEARANCE_PX);
      const feet = level.rects.filter(isWall).map((r) => r.y + r.h);
      expect(Math.max(...feet)).toBe(fairwayY(level, columns[0]?.x ?? 0) + WALL_EMBED_PX);
    }
    expect(L4.terrain.gaps).toEqual([{ x1: 520, x2: 1240 }]);
    expect(L4.terrain.gaps[0]!.x2 - L4.terrain.gaps[0]!.x1).toBe(CHASM_PX);
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

  it('L4 bridge spans the gap at the lip height with switchIds near|far|deck; the DECK plate is inset 24 px on the bridge', () => {
    const bridge = L4.rects.find((r) => r.id === 'bridge');
    const gap = L4.terrain.gaps[0]!;
    expect(bridge?.kind).toBe('bridge');
    expect(bridge?.x).toBe(gap.x1);
    expect(bridge?.w).toBe(gap.x2 - gap.x1);
    expect(bridge?.y).toBe(620);
    expect(bridge?.switchIds).toEqual(['near', 'far', 'deck']);
    expect(bridge?.switchId).toBeUndefined();
    const deck = L4.switches.find((s) => s.id === 'deck');
    expect(deck?.onRectId).toBe('bridge');
    expect(deck?.x).toBe(gap.x1 + DECK_INSET_PX);
    expect(deck!.x + deck!.w).toBe(gap.x2 - DECK_INSET_PX);
    expect(deck?.surfaceY).toBe(bridge?.y);
    for (const sw of L4.switches) if (sw.onRectId === undefined) expect(sw.surfaceY).toBe(fairwayY(L4, sw.x + sw.w / 2));
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

describe('golden replay of each level\'s scripted line (runReplay on the real levels)', () => {
  const snapshotJson = (state: ReturnType<typeof runReplay>['state']): string => JSON.stringify(encodeSnapshot(state));

  it('every level has exactly one golden line and every golden line names a level', () => {
    expect(GOLDEN_LINES.map((g) => g.order)).toEqual(LEVELS.map((l) => l.order));
    for (const golden of GOLDEN_LINES) expect(golden.name).toBe(LEVELS[golden.order - 1]?.name);
  });

  for (const golden of GOLDEN_LINES) {
    const level = LEVELS[golden.order - 1]!;

    it(`hole ${golden.order} (${golden.name}): the recorded line holes both balls in ${golden.strokes.join('+')} and the snapshot is bit-exact`, () => {
      const { state, events } = runReplay(goldenConfig(level.id), golden.log, golden.finalTick);
      expect(state.phase).toBe('levelResults');
      expect(state.balls.every((b) => b.sunk)).toBe(true);
      expect(state.players.map((p) => p.strokes)).toEqual([...golden.strokes]);
      expect(state.campaign).toEqual([{ levelId: level.id, par: level.par, strokes: [...golden.strokes], medal: expect.any(String) }]);
      // every stroke is a shot or a gimme concession; none is a fall penalty
      const hits = events.filter((e) => e.type === 'ballHit').length;
      const gimmes = events.filter((e) => e.type === 'gimme').length;
      expect(hits + gimmes).toBe(golden.strokes[0] + golden.strokes[1]);
      expect(events.some((e) => e.type === 'fellOffWorld')).toBe(false);
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
