// Re-check of design/proposals/worlds-2-3/LEVELS.md. Run from the repo root:
//   npx tsx design/proposals/worlds-2-3/tools/check.ts [build|launchers|gates]
// Independent spot-check of design/proposals/worlds-2-3/LEVELS.md, built from the doc's appendix
// geometry with the REAL authoring + physics code. Cannons are modelled as springs (the doc's own
// rule: a LIT breech behaves exactly like a spring contact). Traps are omitted: they only catch
// resting balls and never change a flight.
import { compileLevel, terrainPiece, SWITCH_COLOUR, type PropDef, type SwitchDef } from '../../../../src/sim/levels/authoring';
import { evaluateSwitches, predictShot, stepBall, type StepBallOut } from '../../../../src/sim/physics';
import { collidersFor, solidColliders } from '../../../../src/sim/terrain';
import { BALL_RADIUS, type BallState, type Level, type PlayerId, type Vec } from '../../../../src/sim/types';

type Spec = {
  id: string;
  width: number;
  pieces: [number, number][][];
  gaps?: [number, number][];
  props: PropDef[];
  switches: SwitchDef[];
  holeX: number;
  startXs: [number, number];
  cupHoldsSwitch?: string;
};

function build(s: Spec): Level {
  // Cannons are modelled as always-on springs, so their FIRE plates would be referenced by nothing
  // and fail validation. Reference them from an inert 2 px post at the level edge (the edge is
  // already a wall), which leaves every tested flight unchanged.
  const referenced = new Set<string>();
  for (const p of s.props) {
    const anyP = p as { switchId?: string; switchIds?: readonly string[] };
    if (anyP.switchId) referenced.add(anyP.switchId);
    for (const id of anyP.switchIds ?? []) referenced.add(id);
  }
  if (s.cupHoldsSwitch) referenced.add(s.cupHoldsSwitch);
  const orphans = s.switches.map((w) => w.id).filter((id) => !referenced.has(id));
  const props = orphans.length
    ? [...s.props, { kind: 'blocker', id: 'test-post', centerX: s.width - 2, w: 2, h: 120, switchIds: orphans, activeWhen: false } as PropDef]
    : s.props;
  return compileLevel({
    id: s.id,
    name: s.id,
    world: 1,
    order: 5,
    par: 7,
    hint: 'x',
    aha: 'x',
    watchOut: 'x',
    mechanicsIntroduced: ['switch'],
    firstPlayer: 0,
    width: s.width,
    wind: 0,
    terrain: { pieces: s.pieces.map((p) => terrainPiece(p, 720)), gaps: (s.gaps ?? []).map(([x1, x2]) => ({ x1, x2 })) },
    props,
    switches: s.switches,
    holeX: s.holeX,
    startXs: s.startXs,
    ...(s.cupHoldsSwitch ? { cupHoldsSwitch: s.cupHoldsSwitch } : {}),
  } as never);
}

const sw = (id: string, x: number, w: number, extra: Partial<SwitchDef> = {}): SwitchDef => ({ id, centerX: x + w / 2, w, colour: SWITCH_COLOUR, label: id.toUpperCase(), ...extra });

function ball(pos: Vec, vel: Vec = { x: 0, y: 0 }): BallState {
  return { pos, vel, asleep: false, sunk: false, grounded: false, restTicks: 0, lastRest: pos };
}

/** Drop a ball onto x (just above the surface) with ambient switches fixed; run to rest. */
function drop(level: Level, ambient: Record<string, boolean>, x: number, padTop: number, pid: PlayerId): { rest: Vec | null; outcome: string; held: string[] } {
  const b = ball({ x, y: padTop - BALL_RADIUS - 1 });
  const out: StepBallOut = { events: [] };
  for (let t = 0; t < 1800; t += 1) {
    const colliders = solidColliders(level, ambient);
    stepBall(b, { level, switches: ambient, playerId: pid, colliders: collidersFor(colliders, pid) }, out);
    if (out.events.some((e) => e.type === 'fellOffWorld')) return { rest: null, outcome: 'fell', held: [] };
    if (b.sunk) return { rest: b.pos, outcome: 'sunk', held: [] };
    if (b.asleep) {
      const s = evaluateSwitches(level, {}, pid === 0 ? [b] : [ball({ x: -999, y: -999 }), b]);
      return { rest: b.pos, outcome: 'rest', held: Object.keys(s).filter((k) => s[k]) };
    }
    out.events.length = 0;
  }
  return { rest: b.pos, outcome: 'running', held: [] };
}

const PERTURB = [0.97, 1, 1.03];

/** Every pad x (1 px, 2 px in from each edge) x 9 launch perturbations: count rests holding `target`. */
function launcherCheck(name: string, spec: Spec, padId: string, launch: Vec, ambient: Record<string, boolean>, target: string, pid: PlayerId) {
  let ok = 0;
  let total = 0;
  const fails: string[] = [];
  for (const kx of PERTURB) {
    for (const ky of PERTURB) {
      const props = spec.props.map((p) => (p.kind === 'spring' && p.id === padId ? { ...p, launch: { x: launch.x * kx, y: launch.y * ky } } : p));
      const level = build({ ...spec, props });
      const pad = level.rects.find((r) => r.id === padId)!;
      for (let x = Math.ceil(pad.x) + 2; x <= Math.floor(pad.x + pad.w) - 2; x += 1) {
        const r = drop(level, ambient, x, pad.y, pid);
        total += 1;
        if (r.outcome === 'rest' && r.held.includes(target)) ok += 1;
        else if (fails.length < 4) fails.push(`x${x} k(${kx},${ky}) -> ${r.outcome} ${r.rest ? `(${r.rest.x.toFixed(0)},${r.rest.y.toFixed(0)})` : ''} held=[${r.held}]`);
      }
    }
  }
  console.log(`${name}: ${ok}/${total} rest holding ${target}${fails.length ? `  FAILS e.g. ${fails.join(' | ')}` : ''}`);
}

/** A partner ball parked (asleep) at pos: it holds whatever plate it rests on during predictShot. */
function parked(pos: Vec): BallState {
  return { pos, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: 6, lastRest: pos };
}

/** 162-shot human grid from a start; returns outcomes. dir +1 = rightward, -1 = leftward. */
function grid(level: Level, from: Vec, pid: PlayerId, switches: Record<string, boolean>, dir = 1, partner: BallState[] = []) {
  const res: { rest: Vec | null; outcome: string; held: string[] }[] = [];
  for (let e = 5; e <= 90; e += 5) {
    for (let p = 20; p <= 100; p += 10) {
      const angle = dir > 0 ? (-e * Math.PI) / 180 : -Math.PI + (e * Math.PI) / 180;
      const r = predictShot(level, switches, ball(from), pid, { angle: Math.max(-3.11, Math.min(-0.03, angle)), power: p }, partner, 2400);
      const last = r.points[r.points.length - 1] ?? null;
      let held: string[] = [];
      if (r.outcome === 'rest' && last) {
        const b = ball(last);
        b.asleep = true;
        b.grounded = true;
        const s = evaluateSwitches(level, {}, pid === 0 ? [b] : [ball({ x: -999, y: -999 }), b]);
        held = Object.keys(s).filter((k) => s[k]);
      }
      res.push({ rest: last, outcome: r.outcome, held });
    }
  }
  return res;
}

// ------------------------------------------------------------------ level specs (from the appendix)
const L5: Spec = {
  id: 'w2-05-spring-step', width: 1800,
  pieces: [[[0, 620], [440, 620], [490, 640], [600, 640], [650, 620], [1080, 620], [1081, 240], [1200, 240], [1250, 264], [1370, 264], [1410, 240], [1460, 240], [1461, 440], [1800, 440]]],
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: 670, w: 40, h: 320, bottom: 520 },
    { kind: 'blocker', id: 'door-gate', centerX: 670, w: 40, h: 120, bottom: 640, switchIds: ['door', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'spring', id: 'spring', centerX: 890, w: 56, launch: { x: 150, y: -800 }, label: 'SPRING' },
    { kind: 'sand', id: 'back-bunker', x1: 1750, x2: 1800 },
  ],
  switches: [sw('door', 490, 110), sw('top', 1250, 120)],
  holeX: 1690, startXs: [100, 150], cupHoldsSwitch: 'top',
};

const L7: Spec = {
  id: 'w2-07-load-and-fire', width: 1960,
  pieces: [
    [[0, 620], [450, 620], [500, 640], [600, 640], [650, 620], [840, 620], [841, 540], [890, 565], [930, 565], [960, 540], [961, 620]],
    [[1520, 400], [1540, 400], [1560, 410], [1720, 410], [1740, 400], [1960, 400]],
  ],
  gaps: [[961, 1520]],
  props: [
    { kind: 'sand', id: 'funnel-l', x1: 841, x2: 889 },
    { kind: 'spring', id: 'cannon', centerX: 910, w: 40, launch: { x: 400, y: -700 }, label: 'CANNON' },
    { kind: 'sand', id: 'funnel-r', x1: 931, x2: 960 },
    { kind: 'sand', id: 'landing', x1: 1540, x2: 1740 },
    { kind: 'sand', id: 'back-bunker', x1: 1920, x2: 1960 },
  ],
  switches: [sw('fire', 500, 100), sw('fire-far', 1560, 160)],
  holeX: 1870, startXs: [100, 150], cupHoldsSwitch: 'fire-far',
};

const L8: Spec = {
  id: 'w2-08-colour-lift', width: 1960,
  pieces: [[[0, 620], [240, 620], [241, 560], [702, 620], [758, 620], [940, 560], [1000, 560], [1001, 300], [1020, 300], [1050, 320], [1150, 320], [1180, 300], [1260, 300], [1390, 300], [1420, 320], [1600, 320], [1630, 300], [1680, 300], [1681, 460], [1960, 460]]],
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: 220, w: 40, h: 120, bottom: 320 },
    { kind: 'blocker', id: 'window', centerX: 220, w: 40, h: 120, bottom: 440, switchIds: ['window'], activeWhen: false, label: 'WINDOW' },
    { kind: 'colourGate', id: 'blue-field', centerX: 220, w: 40, h: 200, bottom: 640, colour: 'blue' },
    { kind: 'spring', id: 'spring', centerX: 730, w: 56, launch: { x: 380, y: -780 }, label: 'SPRING' },
    { kind: 'sand', id: 'window-sand', x1: 1040, x2: 1160 },
    { kind: 'colourGate', id: 'red-field', centerX: 1220, w: 40, h: 420, bottom: 200, colour: 'red' },
    { kind: 'blocker', id: 'door', centerX: 1220, w: 40, h: 120, bottom: 320, switchIds: ['door'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'door-sand', x1: 1410, x2: 1610 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [sw('window', 1050, 100), sw('door', 1420, 180)],
  holeX: 1840, startXs: [80, 130], cupHoldsSwitch: 'door',
};

const L9: Spec = {
  id: 'w3-09-bait', width: 1960,
  pieces: [[[0, 620], [440, 620], [490, 640], [760, 640], [800, 620], [960, 620], [961, 564], [968, 564], [976, 580], [1040, 580], [1041, 620], [1240, 620], [1241, 260], [1260, 260], [1290, 280], [1450, 280], [1480, 260], [1560, 260], [1561, 440], [1960, 440]]],
  props: [
    { kind: 'blocker', id: 'wall-cap', centerX: 670, w: 40, h: 320, bottom: 520 },
    { kind: 'blocker', id: 'door', centerX: 670, w: 40, h: 120, bottom: 640, switchIds: ['bait', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'spring', id: 'spring', centerX: 1008, w: 64, launch: { x: 200, y: -740 }, label: 'SPRING' },
    { kind: 'sand', id: 'yard-sand', x1: 820, x2: 950 },
    { kind: 'sand', id: 'top-sand', x1: 1270, x2: 1470 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [sw('bait', 490, 110), sw('top', 1300, 140)],
  holeX: 1840, startXs: [100, 150], cupHoldsSwitch: 'top',
};

const L10: Spec = {
  id: 'w3-10-sky-bridge', width: 1960,
  pieces: [
    [[0, 620], [40, 620], [41, 580], [56, 580], [76, 600], [124, 600], [144, 580], [160, 580], [161, 620], [600, 620], [601, 400], [640, 400], [670, 416], [790, 416], [820, 400], [860, 400]],
    [[1580, 400], [1600, 400], [1630, 416], [1750, 416], [1780, 400], [1810, 400], [1830, 390], [1960, 390]],
  ],
  gaps: [[860, 1580]],
  props: [
    { kind: 'spring', id: 'cannon', centerX: 100, w: 48, launch: { x: 520, y: -760 }, label: 'CANNON' },
    { kind: 'spring', id: 'spring', centerX: 470, w: 56, launch: { x: 120, y: -690 }, label: 'SPRING' },
    { kind: 'bridge', id: 'bridge', gap: { x1: 860, x2: 1580 }, switchIds: ['a', 'b', 'deck'], label: 'BRIDGE' },
    { kind: 'sand', id: 'a-sand', x1: 642, x2: 818 },
    { kind: 'sand', id: 'b-sand', x1: 1602, x2: 1778 },
    { kind: 'sand', id: 'back-bunker', x1: 1930, x2: 1960 },
  ],
  switches: [sw('a', 670, 120), sw('b', 1630, 120), sw('deck', 884, 672, { onRectId: 'bridge' })],
  holeX: 1880, startXs: [280, 330], cupHoldsSwitch: 'b',
};

const L11: Spec = {
  id: 'w3-11-crossfire', width: 1960,
  pieces: [
    [[0, 520], [40, 520], [60, 530], [180, 530], [200, 520], [201, 620], [740, 620], [780, 640], [840, 640], [880, 620], [900, 620]],
    [[1460, 400], [1480, 400], [1500, 412], [1700, 412], [1720, 400], [1960, 400]],
  ],
  gaps: [[900, 1460]],
  props: [
    { kind: 'colourGate', id: 'blue-field', centerX: 250, w: 40, h: 440, bottom: 640, colour: 'blue' },
    { kind: 'colourGate', id: 'red-field', centerX: 720, w: 40, h: 320, bottom: 520, colour: 'red' },
    { kind: 'blocker', id: 'door', centerX: 720, w: 40, h: 120, bottom: 640, switchIds: ['far'], activeWhen: false, label: 'DOOR' },
    { kind: 'sand', id: 'pit-l', x1: 741, x2: 779 },
    { kind: 'spring', id: 'cannon', centerX: 810, w: 60, launch: { x: 440, y: -730 }, label: 'CANNON' },
    { kind: 'sand', id: 'pit-r', x1: 841, x2: 879 },
    { kind: 'sand', id: 'landing', x1: 1480, x2: 1720 },
    { kind: 'sand', id: 'back-bunker', x1: 1910, x2: 1960 },
  ],
  switches: [sw('fire', 60, 120), sw('far', 1500, 200)],
  holeX: 1860, startXs: [420, 470], cupHoldsSwitch: 'far',
};

const L12: Spec = {
  id: 'w3-12-grand-machine', width: 1960,
  pieces: [[[0, 640], [40, 640], [41, 540], [100, 565], [140, 565], [200, 540], [201, 620], [420, 620], [460, 640], [560, 640], [600, 620], [640, 620], [680, 640], [1180, 640], [1181, 320], [1200, 320], [1215, 334], [1690, 334], [1691, 300], [1730, 300], [1731, 400], [1960, 400]]],
  props: [
    { kind: 'sand', id: 'funnel-l', x1: 41, x2: 99 },
    { kind: 'spring', id: 'cannon', centerX: 120, w: 40, launch: { x: 700, y: -760 }, label: 'CANNON' },
    { kind: 'sand', id: 'funnel-r', x1: 141, x2: 199 },
    { kind: 'blocker', id: 'wall-cap', centerX: 840, w: 40, h: 320, bottom: 520 },
    { kind: 'blocker', id: 'door', centerX: 840, w: 40, h: 120, bottom: 640, switchIds: ['door', 'top'], activeWhen: false, label: 'DOOR' },
    { kind: 'spring', id: 'spring', centerX: 1000, w: 56, launch: { x: 180, y: -800 }, label: 'SPRING' },
    { kind: 'sand', id: 'top-sand', x1: 1205, x2: 1690 },
    { kind: 'sand', id: 'back-bunker', x1: 1900, x2: 1960 },
  ],
  switches: [sw('fire', 460, 100), sw('door', 680, 100), sw('top', 1230, 450)],
  holeX: 1850, startXs: [300, 350], cupHoldsSwitch: 'top',
};

// ------------------------------------------------------------------ run
const only = process.argv[2];
function section(name: string, fn: () => void) {
  if (only && !name.startsWith(only)) return;
  try {
    fn();
  } catch (err) {
    console.log(`${name}: BUILD/RUN ERROR ${(err as Error).message}`);
  }
}

section('build', () => {
  for (const s of [L5, L7, L8, L9, L10, L11, L12]) {
    build(s);
    console.log(`build ${s.id}: compiles + validateLevel OK`);
  }
});

section('launchers', () => {
  launcherCheck('L5 spring -> TOP (blue)', L5, 'spring', { x: 150, y: -800 }, { door: true }, 'top', 1);
  launcherCheck('L7 cannon -> far FIRE (red)', L7, 'cannon', { x: 400, y: -700 }, { fire: true }, 'fire-far', 0);
  launcherCheck('L8 spring -> WINDOW (blue bounces off red field)', L8, 'spring', { x: 380, y: -780 }, { window: true }, 'window', 1);
  launcherCheck('L8 spring -> DOOR (red flies through red field)', L8, 'spring', { x: 380, y: -780 }, { window: true }, 'door', 0);
  launcherCheck('L9 spring -> TOP (blue)', L9, 'spring', { x: 200, y: -740 }, { bait: true }, 'top', 1);
  launcherCheck('L10 spring -> A (red)', L10, 'spring', { x: 120, y: -690 }, {}, 'a', 0);
  launcherCheck('L10 cannon -> B (blue, bridge up)', L10, 'cannon', { x: 520, y: -760 }, { a: true }, 'b', 1);
  launcherCheck('L11 cannon -> FAR (red)', L11, 'cannon', { x: 440, y: -730 }, { fire: true }, 'far', 0);
  launcherCheck('L11 cannon -> FAR (blue)', L11, 'cannon', { x: 440, y: -730 }, { fire: true, far: true }, 'far', 1);
  launcherCheck('L12 cannon -> TOP (red)', L12, 'cannon', { x: 700, y: -760 }, { fire: true }, 'top', 0);
  launcherCheck('L12 spring -> TOP (blue)', L12, 'spring', { x: 180, y: -800 }, { door: true }, 'top', 1);
});

section('gates', () => {
  // L5: door shut, both tees, both colours: does any hand shot get past the wall (x > 690)?
  {
    const lv = build(L5);
    let past = 0;
    let n = 0;
    for (const pid of [0, 1] as PlayerId[]) {
      for (const g of grid(lv, lv.starts[pid], pid, {})) {
        n += 1;
        if (g.rest && g.rest.x > 690 && g.outcome !== 'fell') past += 1;
      }
    }
    console.log(`L5 door shut: ${past}/${n} hand shots from the tees end past the wall`);
  }
  // L5 hit rate claim: blue from tee 150 while RED RESTS on the DOOR plate (x 545, dish floor y 640)
  // -> rests holding TOP (doc says 25 %). The partner must be in the scene: predictShot
  // re-evaluates every plate each tick from the balls it is given.
  {
    const lv = build(L5);
    const red = parked({ x: 545, y: 640 - BALL_RADIUS });
    const held0 = evaluateSwitches(lv, {}, [red]);
    const g = grid(lv, lv.starts[1], 1, held0, 1, [red]);
    const top = g.filter((r) => r.held.includes('top')).length;
    console.log(`L5 blue tee, red parked on DOOR (door=${held0.door}): ${top}/162 = ${((100 * top) / 162).toFixed(1)} % rest holding TOP (doc says 25 %)`);
  }
  // L7: no hand crossing of the chasm from the approach, either colour, with the cannon COLD
  // (breech = ordinary ground, which is what an unlit cannon is under the doc's rule).
  {
    const lv = build({ ...L7, props: L7.props.filter((p) => p.id !== 'cannon') });
    let cross = 0;
    let n = 0;
    for (const x of [650, 700, 750, 800, 830]) {
      for (const pid of [0, 1] as PlayerId[]) {
        for (const g of grid(lv, { x, y: 608 }, pid, {})) {
          n += 1;
          if (g.rest && g.rest.x >= 1520 && g.outcome === 'rest') cross += 1;
        }
      }
    }
    console.log(`L7 chasm: ${cross}/${n} hand shots from the approach (no cannon use counted only if resting beyond 1520)`);
  }
  // L9: door shut (nobody on BAIT/TOP): hand shots from the tees never get past the wall.
  {
    const lv = build(L9);
    let past = 0;
    let n = 0;
    for (const pid of [0, 1] as PlayerId[]) {
      for (const g of grid(lv, lv.starts[pid], pid, {})) {
        n += 1;
        if (g.rest && g.rest.x > 690 && g.outcome !== 'fell') past += 1;
      }
    }
    console.log(`L9 door shut: ${past}/${n} hand shots from the tees end past the wall`);
  }
  // L12: door shut + flush door foot (bottom 640 = channel floor): low rolls along the channel never pass.
  {
    const lv = build(L12);
    let past = 0;
    let n = 0;
    for (const x of [700, 740, 780]) {
      for (const p of [30, 50, 70, 90, 100]) {
        for (const e of [2, 5, 10, 15]) {
          const r = predictShot(lv, {}, ball({ x, y: 628 }), 0, { angle: (-e * Math.PI) / 180, power: p }, [], 2400);
          const last = r.points[r.points.length - 1];
          n += 1;
          if (last && last.x > 860) past += 1;
        }
      }
    }
    console.log(`L12 flush door foot: ${past}/${n} low rolls from the seat channel get past the shut door`);
  }
});
