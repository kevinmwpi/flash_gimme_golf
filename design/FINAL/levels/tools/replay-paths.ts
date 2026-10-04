// Replays the official solver's best co-op path (from solver.json / solver-beam120.json) shot by shot and
// prints where each ball rests and which plates are held, so LEVELS.md can describe the line in words.
// Run from the project dir: npx tsx replay-paths.ts <solver.json>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const physics = await imp(PROJECT + '/src/game/physics.ts');
const terrain = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod = await imp(PROJECT + '/src/game/rng.ts');
const { levels, SHOT_SPEED_PER_POWER: S } = await imp(HERE + '/levels.ts');
const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ANGLES: number[] = [];
for (let i = 0; i < 16; i += 1) ANGLES.push(-Math.PI * 0.96 + ((-0.05 + Math.PI * 0.96) * (i + 0.5)) / 16);
const POWERS: number[] = [];
for (let i = 0; i < 8; i += 1) POWERS.push(10 + (90 * (i + 0.5)) / 8);
function mk(level: any, pid: number) {
  const pos = terrain.placeBallOnSurface(level, level.starts[pid].x, 12);
  return { playerId: pid, pos, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: 12, color: '', safeColor: ['red', 'blue'][pid], strokes: 0, sunk: false, asleep: true, sinking: false, sinkT: 0, trail: [] } as any;
}
for (const r of results) {
  const level = levels.find((l: any) => l.name === r.name);
  if (!level || !r.coop.path) { console.log(`${r.name}: no co-op path`); continue; }
  const balls = [mk(level, 0), mk(level, 1)];
  console.log(`\n${r.name}: ${r.coop.minTotalStrokes} strokes (${r.coop.perPlayer.join('+')})`);
  for (const step of r.coop.path as string[]) {
    const m = step.match(/P(\d) a=(-?\d+).{1,2} p=(\d+)/);
    if (!m) { console.log('  ?', step); continue; }
    const idx = Number(m[1]) - 1;
    const deg = Number(m[2]), pw = Number(m[3]);
    // snap to the solver grid
    const a = ANGLES.reduce((best, v) => (Math.abs(Math.round((-v * 180) / Math.PI) - deg) < Math.abs(Math.round((-best * 180) / Math.PI) - deg) ? v : best), ANGLES[0]);
    const p = POWERS.reduce((best, v) => (Math.abs(Math.round(v) - pw) < Math.abs(Math.round(best) - pw) ? v : best), POWERS[0]);
    physics.updateSwitches(level, balls);
    const b = balls[idx];
    b.vel = { x: Math.cos(a) * p * S, y: Math.sin(a) * p * S };
    b.asleep = false;
    const rng = rngMod.createRng(1);
    const touched = new Set<string>();
    let fell = false;
    for (let s = 0; s < 1500; s += 1) {
      physics.stepBall(b, level, 1 / 60, [], rng);
      physics.updateSwitches(level, balls);
      if (b.pos.y > level.height + 150) fell = true;
      for (const rc of level.rects) {
        if (!physics.isRectActive(rc, level)) continue;
        const cx = Math.max(rc.x, Math.min(b.pos.x, rc.x + rc.w)), cy = Math.max(rc.y, Math.min(b.pos.y, rc.y + rc.h));
        if (Math.hypot(b.pos.x - cx, b.pos.y - cy) <= 14) touched.add(rc.label ?? rc.kind);
      }
      if (b.sunk || (b.asleep && !b.sinking)) break;
    }
    physics.updateSwitches(level, balls);
    const sw = level.switches.map((s: any) => `${s.id}=${s.pressed ? 1 : 0}`).join(' ');
    console.log(`  ${step.padEnd(28)} -> P${idx + 1} rests at (${Math.round(b.pos.x)},${Math.round(b.pos.y)})${b.sunk ? ' SUNK' : ''}${fell ? ' FELL' : ''} touched[${[...touched].join(' ')}] ${sw}`);
  }
}
