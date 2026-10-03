// Co-op level solver / bypass analysis for Flash Golf levels against the CURRENT physics
// (src/game/physics.ts: shot speed = power*8.8, gravity 620, 1/60 step).
//
// Usage (run from anywhere):
//   npx tsx "<scratch>/tools/solver.ts" <levelModule.ts> [--svg <outDir>] [--json <out.json>] [--depth 8] [--beam 6] [--shotSpeed 8.8]
//   --shotSpeed = px/s per power unit (max range at 45deg = (100*shotSpeed)^2 / 620). 8.8 is the current build; levels may be designed for a lower value.
//
// <levelModule.ts> must export `levels: Level[]` (or a default export array). Build levels with the
// project's helpers, e.g.:
//   import { terrainPiece, holeAt, applyPropsOnSurface, applySwitchesOnSurface, bridgeSurfaceY } from
//     'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf/src/game/terrain';
//
// For every level it reports, for the 2-ball co-op game (balls alternate, switches are held by RESTING balls,
// the moving ball releases any switch it was on):
//   coop.minTotalStrokes   — fewest total strokes found to sink BOTH balls (beam search; an upper bound on par)
//   coop.solved            — whether both balls were sunk within the depth budget
//   solo[p].minStrokes     — fewest strokes for ball p to sink with the OTHER ball parked at its start
//                            (if this succeeds on a "co-op" level, the co-op mechanic is bypassable)
//   solo[p].reachableX     — farthest x reached by ball p alone (shows where a lone ball gets stuck)
//   hazards/bridges/gates  — which mechanics were actually touched on the best co-op path
// Also writes an SVG overview of each level when --svg is given (convert with pw/shot.mjs).

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);

const physics = await imp(PROJECT + '/src/game/physics.ts');
const terrain = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod = await imp(PROJECT + '/src/game/rng.ts');

const args = process.argv.slice(2);
const levelModulePath = args[0];
if (!levelModulePath) {
  console.error('usage: npx tsx solver.ts <levelModule.ts> [--svg outDir] [--json out.json] [--depth N] [--beam N]');
  process.exit(2);
}
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SVG_DIR = opt('--svg', '');
const JSON_OUT = opt('--json', '');
const DEPTH = Number(opt('--depth', '8'));
const BEAM = Number(opt('--beam', '6'));
const SHOT_SPEED = Number(opt('--shotSpeed', '8.8')); // px/s per power unit; current physics uses 8.8
const ANGLES = 16;
const POWERS = 8;
const MAX_STEPS = 1500;
const BALL_RADIUS = 12;
const SAFE = ['red', 'blue'];
const COLORS = ['#ff5d73', '#50b7ff'];

const levelsMod = await imp(levelModulePath);
const levels: any[] = levelsMod.levels ?? (levelsMod.default && levelsMod.default.levels) ?? levelsMod.default;
if (!Array.isArray(levels)) throw new Error('level module must export levels: Level[]');

type B = any;
type Joint = { balls: B[]; active: number; strokes: number[]; path: string[]; touched: Set<string> };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function makeBall(level: any, playerId: number): B {
  const startX = level.starts[playerId]?.x ?? 100 + playerId * 40;
  const pos = terrain.placeBallOnSurface(level, startX, BALL_RADIUS);
  return {
    playerId, pos, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS,
    color: COLORS[playerId], safeColor: SAFE[playerId], strokes: 0, sunk: false, asleep: true,
    sinking: false, sinkT: 0, trail: [],
  };
}

function settleSwitches(level: any, balls: B[]) {
  physics.updateSwitches(level, balls);
}

/** Simulate one shot. Returns new balls, whether the ball fell off the world, mechanics touched. */
function simulateShot(level: any, balls: B[], idx: number, angle: number, power: number) {
  const lvl = level; // shared: physics only mutates level.switches[i].pressed
  const bs = clone(balls);
  for (const b of bs) b.trail = [];
  settleSwitches(lvl, bs);
  const b = bs[idx];
  const speed = power * SHOT_SPEED;
  b.vel = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  b.asleep = false;
  const particles: any[] = [];
  const rng = rngMod.createRng(1);
  let fell = false;
  const touched = new Set<string>();
  let maxX = b.pos.x;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    physics.stepBall(b, lvl, 1 / 60, particles, rng);
    settleSwitches(lvl, bs);
    if (b.pos.y > lvl.height + 150) fell = true;
    if (b.pos.x > maxX) maxX = b.pos.x;
    // record mechanics the ball overlaps this step
    for (const r of lvl.rects) {
      if (!physics.isRectActive(r, lvl)) continue;
      const live = r; // moving rects are rare; good enough for reporting
      const cx = Math.max(live.x, Math.min(b.pos.x, live.x + live.w));
      const cy = Math.max(live.y, Math.min(b.pos.y, live.y + live.h));
      if (Math.hypot(b.pos.x - cx, b.pos.y - cy) <= b.radius + 2) touched.add(r.kind + (r.label ? ':' + r.label : ''));
    }
    if (b.sunk || (b.asleep && !b.sinking)) break;
  }
  // a fallen ball is respawned by stepBall at the start, asleep
  const switches = lvl.switches.map((s: any) => s.pressed);
  return { balls: bs, fell, touched, switches, maxX };
}

function heuristic(level: any, s: Joint) {
  let h = 0;
  for (const b of s.balls) {
    if (b.sunk) continue;
    const dx = Math.abs(b.pos.x - level.hole.x);
    const dy = Math.abs(b.pos.y - level.hole.rimY);
    h += dx + dy * 0.5;
  }
  return h + s.strokes.reduce((a, c) => a + c, 0) * 40;
}

function key(s: Joint) {
  return s.balls.map((b) => `${b.sunk ? 'S' : Math.round(b.pos.x / 8)},${Math.round(b.pos.y / 8)}`).join('|') + '#' + s.active;
}

function nextActive(balls: B[], from: number) {
  for (let step = 1; step <= balls.length; step += 1) {
    const n = (from + step) % balls.length;
    if (!balls[n].sunk) return n;
  }
  return -1;
}

function angleGrid() {
  const out: number[] = [];
  const lo = -Math.PI * 0.96;
  const hi = -0.05;
  for (let i = 0; i < ANGLES; i += 1) out.push(lo + ((hi - lo) * (i + 0.5)) / ANGLES);
  return out;
}
function powerGrid() {
  const out: number[] = [];
  for (let i = 0; i < POWERS; i += 1) out.push(10 + (90 * (i + 0.5)) / POWERS);
  return out;
}

function search(level: any, balls: B[], movable: boolean[], depth: number, beam: number) {
  const init: Joint = { balls: clone(balls), active: movable.findIndex(Boolean), strokes: balls.map(() => 0), path: [], touched: new Set() };
  let frontier: Joint[] = [init];
  const seen = new Set<string>([key(init)]);
  let best: Joint | null = null;
  let farthest = balls.map((b) => b.pos.x);
  const angles = angleGrid();
  const powers = powerGrid();
  for (let d = 0; d < depth; d += 1) {
    const candidates: Joint[] = [];
    for (const s of frontier) {
      const idx = s.active;
      if (idx < 0 || !movable[idx]) continue;
      for (const a of angles) {
        for (const p of powers) {
          const r = simulateShot(level, s.balls, idx, a, p);
          const strokes = [...s.strokes];
          strokes[idx] += 1;
          for (let i = 0; i < r.balls.length; i += 1) if (r.balls[i].pos.x > farthest[i]) farthest[i] = r.balls[i].pos.x;
          // next active: next unsunk movable ball
          let na = -1;
          for (let step = 1; step <= r.balls.length; step += 1) {
            const n = (idx + step) % r.balls.length;
            if (!r.balls[n].sunk && movable[n]) { na = n; break; }
          }
          const touched = new Set(s.touched);
          for (const t of r.touched) touched.add(t);
          const ns: Joint = {
            balls: r.balls, active: na, strokes,
            path: [...s.path, `P${idx + 1} a=${Math.round((-a * 180) / Math.PI)}° p=${Math.round(p)}${r.fell ? ' (fell)' : ''}${r.balls[idx].sunk ? ' SINK' : ''}`],
            touched,
          };
          const allDone = r.balls.every((b, i) => b.sunk || !movable[i]);
          if (allDone) {
            const total = strokes.reduce((x, y) => x + y, 0);
            if (!best || total < best.strokes.reduce((x, y) => x + y, 0)) best = ns;
            continue;
          }
          if (na < 0) continue;
          const k = key(ns);
          if (seen.has(k)) continue;
          seen.add(k);
          candidates.push(ns);
        }
      }
    }
    if (best) break; // first depth at which a solution exists == fewest shots (BFS by depth)
    candidates.sort((x, y) => heuristic(level, x) - heuristic(level, y));
    frontier = candidates.slice(0, beam);
    if (!frontier.length) break;
  }
  return { best, farthest };
}

function svgFor(level: any) {
  const W = level.width, H = level.height;
  const scale = 1280 / W;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${Math.round(H * scale)}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#9ad7ff"/>`);
  for (const piece of level.terrain.pieces) {
    const pts = piece.surface.map((p: any) => `${p.x},${p.y}`).join(' ');
    const last = piece.surface[piece.surface.length - 1];
    const first = piece.surface[0];
    parts.push(`<polygon points="${pts} ${last.x},${piece.baseY} ${first.x},${piece.baseY}" fill="#8b5528" stroke="#2f5d1c" stroke-width="6"/>`);
    parts.push(`<polyline points="${pts}" fill="none" stroke="#5cb838" stroke-width="12"/>`);
  }
  for (const seg of level.segments ?? []) {
    parts.push(`<line x1="${seg.a.x}" y1="${seg.a.y}" x2="${seg.b.x}" y2="${seg.b.y}" stroke="#5cb838" stroke-width="12" stroke-linecap="round"/>`);
  }
  const fill: Record<string, string> = { hazard: '#ff4f6d', sand: '#e8c779', spring: '#ff85e1', fan: '#87f2ff', bridge: '#7ed38a', gate: '#6f6c8f', bumper: '#ffb74f' };
  for (const r of level.rects) {
    const c = r.kind === 'hazard' ? ({ red: '#ff4f6d', blue: '#46b7ff', green: '#6bed77', gold: '#ffe066' } as any)[r.color ?? 'gold'] : fill[r.kind] ?? '#ccc';
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${c}" stroke="#222" stroke-width="3" opacity="${r.kind === 'fan' ? 0.5 : 1}"/>`);
    parts.push(`<text x="${r.x + r.w / 2}" y="${r.y - 8}" font-size="22" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#222">${(r.label ?? r.kind).toUpperCase()}${r.switchId ? ' [' + r.switchId + (r.activeWhen === false ? ':off' : ':on') + ']' : ''}</text>`);
  }
  for (const s of level.switches) {
    parts.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="#f5e56b" stroke="#604b2d" stroke-width="3"/>`);
    parts.push(`<text x="${s.x + s.w / 2}" y="${s.y - 8}" font-size="22" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#222">SWITCH ${s.id}</text>`);
  }
  const h = level.hole;
  parts.push(`<ellipse cx="${h.x}" cy="${h.rimY}" rx="${h.radius}" ry="6" fill="#111"/>`);
  parts.push(`<line x1="${h.x + 4}" y1="${h.rimY}" x2="${h.x + 4}" y2="${h.rimY - 70}" stroke="#fff" stroke-width="4"/>`);
  parts.push(`<polygon points="${h.x + 6},${h.rimY - 70} ${h.x + 50},${h.rimY - 58} ${h.x + 6},${h.rimY - 46}" fill="#ff4040"/>`);
  level.starts.slice(0, 2).forEach((s: any, i: number) => {
    const y = terrain.surfaceYAt(level, s.x) ?? 500;
    parts.push(`<circle cx="${s.x}" cy="${y - 12}" r="12" fill="${COLORS[i]}" stroke="#222" stroke-width="3"/>`);
  });
  parts.push(`<text x="20" y="40" font-size="30" font-family="sans-serif" font-weight="bold" fill="#123">${level.name} — ${W}×${H}, wind ${level.wind}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

const results: any[] = [];
for (const [li, level] of levels.entries()) {
  const t0 = performance.now();
  const balls = [makeBall(level, 0), makeBall(level, 1)];
  const coop = search(level, balls, [true, true], DEPTH, BEAM);
  const soloA = search(level, balls, [true, false], DEPTH, BEAM);
  const soloB = search(level, balls, [false, true], DEPTH, BEAM);
  const sum = (s: Joint | null) => (s ? s.strokes.reduce((a, c) => a + c, 0) : null);
  const r = {
    index: li,
    name: level.name,
    size: `${level.width}x${level.height}`,
    wind: level.wind,
    shotSpeed: SHOT_SPEED,
    switches: level.switches.map((s: any) => s.id),
    rects: level.rects.map((x: any) => `${x.kind}${x.label ? ':' + x.label : ''}${x.switchId ? '[' + x.switchId + ']' : ''}`),
    coop: {
      solved: !!coop.best,
      minTotalStrokes: sum(coop.best),
      perPlayer: coop.best?.strokes ?? null,
      path: coop.best?.path ?? null,
      touched: coop.best ? [...coop.best.touched] : null,
    },
    solo: [
      { player: 1, solved: !!soloA.best, minStrokes: sum(soloA.best), reachableX: Math.round(soloA.farthest[0]), path: soloA.best?.path ?? null },
      { player: 2, solved: !!soloB.best, minStrokes: sum(soloB.best), reachableX: Math.round(soloB.farthest[1]), path: soloB.best?.path ?? null },
    ],
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
  results.push(r);
  console.log(JSON.stringify(r, null, 1));
  if (SVG_DIR) {
    fs.mkdirSync(SVG_DIR, { recursive: true });
    const file = path.join(SVG_DIR, `level-${li + 1}.svg`);
    fs.writeFileSync(file, svgFor(level));
    console.log('wrote', file);
  }
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
