// Beat-by-beat replay of the INTENDED co-op line of every final level, using the solver's exact shot
// semantics (current physics, 1/60 step, SHOT_SPEED_PER_POWER from levels.ts) and the solver's 16x8
// angle/power grid. For each beat it picks the FIRST grid shot that satisfies the beat's predicate,
// applies it and goes on; the stroke count is therefore an upper bound on the intended line.
// After every shot the OTHER ball is stepped too (locked decision 19) so a ball parked on a vanished
// bridge falls instead of floating.
// Run from the project dir:  npx tsx verify-lines.ts [--json out.json]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const physics = await imp(PROJECT + '/src/game/physics.ts');
const terrain = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod = await imp(PROJECT + '/src/game/rng.ts');
const { levels, SHOT_SPEED_PER_POWER } = await imp(HERE + '/levels.ts');

const R = 12;
const SAFE = ['red', 'blue'];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ANGLES: number[] = [];
for (let i = 0; i < 16; i += 1) ANGLES.push(-Math.PI * 0.96 + ((-0.05 + Math.PI * 0.96) * (i + 0.5)) / 16);
const POWERS: number[] = [];
for (let i = 0; i < 8; i += 1) POWERS.push(10 + (90 * (i + 0.5)) / 8);

type Ball = any;
function makeBalls(level: any): Ball[] {
  return [0, 1].map((i) => {
    const pos = terrain.placeBallOnSurface(level, level.starts[i].x, R);
    return { playerId: i, pos, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: R, color: '#fff', safeColor: SAFE[i], strokes: 0, sunk: false, asleep: true, sinking: false, sinkT: 0, trail: [] };
  });
}
function shoot(level: any, balls: Ball[], idx: number, angle: number, power: number) {
  const bs = clone(balls);
  physics.updateSwitches(level, bs);
  const b = bs[idx];
  const v = power * SHOT_SPEED_PER_POWER;
  b.vel = { x: Math.cos(angle) * v, y: Math.sin(angle) * v };
  b.asleep = false;
  const rng = rngMod.createRng(1);
  let fell = false;
  let partnerFell = false;
  const touched = new Set<string>();
  const o = bs[1 - idx];
  const oStart = { ...o.pos };
  for (let s = 0; s < 1500; s += 1) {
    physics.stepBall(b, level, 1 / 60, [], rng);
    if (!o.sunk) physics.stepBall(o, level, 1 / 60, [], rng); // strict: every ball every tick
    physics.updateSwitches(level, bs);
    if (b.pos.y > level.height + 150) fell = true;
    if (!o.sunk && (o.pos.y > level.height + 150 || Math.abs(o.pos.x - oStart.x) > 200)) partnerFell = true;
    for (const r of level.rects) {
      if (!physics.isRectActive(r, level)) continue;
      const cx = Math.max(r.x, Math.min(b.pos.x, r.x + r.w)), cy = Math.max(r.y, Math.min(b.pos.y, r.y + r.h));
      if (Math.hypot(b.pos.x - cx, b.pos.y - cy) <= R + 2) touched.add(r.label ?? r.kind);
    }
    if ((b.sunk || (b.asleep && !b.sinking)) && (o.sunk || o.asleep)) break;
  }
  physics.updateSwitches(level, bs);
  const sw: Record<string, boolean> = {};
  for (const s of level.switches) sw[s.id] = s.pressed;
  return { balls: bs, fell, partnerFell, touched: [...touched], sw, b };
}

type Beat = { who: 1 | 2; what: string; ok: (r: any, prev: Ball[]) => boolean };
const past = (x: number) => (r: any) => r.b.pos.x > x && !r.fell && !r.partnerFell;
const on = (id: string) => (r: any) => r.sw[id] === true && r.b.asleep && !r.b.sunk && !r.partnerFell;
const near = (x: number, d: number) => (r: any) => Math.abs(r.b.pos.x - x) < d && !r.fell && !r.partnerFell;
const between = (a: number, b: number) => (r: any) => r.b.pos.x > a && r.b.pos.x < b && !r.fell && !r.partnerFell;
const sunk = (r: any) => r.b.sunk === true && !r.partnerFell;

const LINES: Record<string, Beat[]> = {
  'First Fairway': [
    { who: 1, what: 'drive over the hill, short of the bunker (600-860)', ok: between(600, 860) },
    { who: 2, what: 'drive over the hill, short of the bunker (600-860)', ok: between(600, 860) },
    { who: 1, what: 'pitch over the sand onto the green (x>1120) or sink', ok: (r) => sunk(r) || (past(1120)(r) && !r.touched.includes('sand')) },
    { who: 2, what: 'pitch over the sand onto the green (x>1120) or sink', ok: (r) => sunk(r) || (past(1120)(r) && !r.touched.includes('sand')) },
    { who: 1, what: 'putt / gimme', ok: sunk },
    { who: 2, what: 'putt / gimme', ok: sunk },
  ],
  'First Fairway (sand line)': [
    { who: 1, what: 'full drive runs into the bunker and stops dead (rests in 870-1010)', ok: (r) => r.touched.includes('sand') && between(860, 1020)(r) },
    { who: 2, what: 'full drive runs into the bunker and stops dead', ok: (r) => r.touched.includes('sand') && between(860, 1020)(r) },
    { who: 1, what: 'pitch out of the sand onto the green or sink', ok: (r) => sunk(r) || past(1120)(r) },
    { who: 2, what: 'pitch out of the sand onto the green or sink', ok: (r) => sunk(r) || past(1120)(r) },
    { who: 1, what: 'putt / gimme', ok: sunk },
    { who: 2, what: 'putt / gimme', ok: sunk },
  ],
  'Two Doors': [
    { who: 1, what: 'position in front of the wall (450-690)', ok: between(450, 690) },
    { who: 2, what: 'park on the DOOR plate (dish 690-900) -> door opens', ok: on('door') },
    { who: 1, what: 'roll/skip through the open door and stop on the WINDOW plate (dish 940-1230)', ok: (r) => past(940)(r) && on('window')(r) },
    { who: 2, what: 'lob through the open window (land past the wall)', ok: past(940) },
    { who: 1, what: 'approach the cup (within 160 px) or sink', ok: (r) => sunk(r) || near(1680, 160)(r) },
    { who: 2, what: 'approach the cup (within 160 px) or sink', ok: (r) => sunk(r) || near(1680, 160)(r) },
    { who: 1, what: 'sink', ok: sunk },
    { who: 2, what: 'sink', ok: sunk },
  ],
  'Colour Keys': [
    { who: 2, what: 'blue: lob through the BLUE field from the tee, rest on the DOOR 1 plate (bowl 650-1050) -> door 1 opens', ok: (r) => r.touched.includes('blue') && on('door1')(r) },
    { who: 1, what: 'red: roll through the open door 1, finish close to wall 2 (900-1150)', ok: between(900, 1150) },
    { who: 2, what: 'blue: move up in front of wall 2 (1000-1150)', ok: between(1000, 1150) },
    { who: 1, what: 'red: lob through the RED field, rest on the DOOR 2 plate (bowl 1220-1610) -> door 2 opens', ok: (r) => r.touched.includes('red') && on('door2')(r) },
    { who: 2, what: 'blue: roll through the open door 2 (x>1200)', ok: past(1200) },
    { who: 1, what: 'red: approach/sink', ok: (r) => sunk(r) || near(1740, 160)(r) },
    { who: 2, what: 'blue: approach/sink', ok: (r) => sunk(r) || near(1740, 160)(r) },
    { who: 1, what: 'sink', ok: sunk },
    { who: 2, what: 'sink', ok: sunk },
  ],
  'Plate & Bridge': [
    { who: 1, what: 'red: chip onto plate A (dish 350-520) -> bridge appears', ok: on('near') },
    { who: 2, what: 'blue: full swing from the tee across the bridge, rest on the deck or plate B', ok: (r) => past(544)(r) && (on('deck')(r) || on('far')(r)) },
    { who: 1, what: 'red: full swing from plate A, rest on plate B (or the deck)', ok: (r) => past(544)(r) && (on('far')(r) || on('deck')(r)) },
    { who: 2, what: 'blue: on to the far side (x>1240) or sink', ok: (r) => sunk(r) || past(1240)(r) },
    { who: 1, what: 'red: on to the far side or sink', ok: (r) => sunk(r) || past(1240)(r) },
    { who: 2, what: 'blue: approach/sink', ok: (r) => sunk(r) || near(1860, 160)(r) },
    { who: 1, what: 'red: approach/sink', ok: (r) => sunk(r) || near(1860, 160)(r) },
    { who: 2, what: 'sink', ok: sunk },
    { who: 1, what: 'sink', ok: sunk },
  ],
  // Alternative Plate & Bridge line where the crosser under-hits and parks on the DECK (the common
  // current-physics outcome): the deck holds the bridge; the holder stall-taps; the deck ball chips to B.
  'Plate & Bridge (deck line)': [
    { who: 1, what: 'chip onto plate A -> bridge appears', ok: on('near') },
    { who: 2, what: 'cross from the tee and rest ON THE BRIDGE DECK (544-1216)', ok: (r) => between(544, 1216)(r) && on('deck')(r) },
    { who: 1, what: 'stall tap: stay on plate A (partner on the deck must not fall)', ok: (r) => on('near')(r) && !r.partnerFell },
    { who: 2, what: 'from the deck onto plate B', ok: on('far') },
    { who: 1, what: 'cross the bridge (held by B)', ok: past(1240) },
    { who: 2, what: 'approach/sink', ok: (r) => sunk(r) || near(1860, 160)(r) },
    { who: 1, what: 'approach/sink', ok: (r) => sunk(r) || near(1860, 160)(r) },
    { who: 2, what: 'sink', ok: sunk },
    { who: 1, what: 'sink', ok: sunk },
  ],
};

const out: any[] = [];
for (const [lineName, beats] of Object.entries(LINES)) {
  const level = levels.find((l: any) => lineName.startsWith(l.name));
  if (!level) continue;
  let balls = makeBalls(level);
  const strokes = [0, 0];
  const log: string[] = [];
  for (const beat of beats) {
    const idx = beat.who - 1;
    if (balls[idx].sunk) { log.push(`P${beat.who} already sunk, skip "${beat.what}"`); continue; }
    let found: any = null, fa = 0, fp = 0, count = 0;
    for (const a of ANGLES) for (const p of POWERS) {
      const r = shoot(level, balls, idx, a, p);
      if (beat.ok(r, balls)) { count += 1; if (!found) { found = r; fa = a; fp = p; } }
    }
    if (!found) { log.push(`P${beat.who}: NO GRID SHOT for "${beat.what}"`); break; }
    strokes[idx] += 1;
    balls = found.balls;
    log.push(`P${beat.who} a=${Math.round((-fa * 180) / Math.PI)}deg p=${Math.round(fp)} -> (${Math.round(found.b.pos.x)},${Math.round(found.b.pos.y)})${found.b.sunk ? ' SINK' : ''} [${found.touched.join(' ')}] ${Object.entries(found.sw).map(([k, v]) => k + '=' + (v ? 1 : 0)).join(',')} (${count}/128 grid shots satisfy) : ${beat.what}`);
  }
  const done = balls.every((b) => b.sunk);
  console.log(`\n=== ${lineName}: ${done ? 'BOTH SUNK' : 'INCOMPLETE'} strokes P1=${strokes[0]} P2=${strokes[1]} total=${strokes[0] + strokes[1]}`);
  for (const l of log) console.log('  ' + l);
  out.push({ line: lineName, level: level.name, bothSunk: done, strokes, total: strokes[0] + strokes[1], beats: log });
}
const j = process.argv.indexOf('--json');
if (j >= 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 2));
