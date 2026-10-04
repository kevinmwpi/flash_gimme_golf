// Experiment: L3 lob hit rates vs door height (100 / 80 px) and blue tee x. Does not modify levels.ts.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const physics: any = await imp(PROJECT + '/src/game/physics.ts');
const terrain: any = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod: any = await imp(PROJECT + '/src/game/rng.ts');
const { levels }: any = await imp(HERE + '/levels.ts');
const S = 6.5;
function mk(level: any, pid: number, x: number) { const pos = terrain.placeBallOnSurface(level, x, 12); return { playerId: pid, pos, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: 12, color: '', safeColor: ['red', 'blue'][pid], strokes: 0, sunk: false, asleep: true, sinking: false, sinkT: 0, trail: [] } as any; }
function shoot(level: any, balls: any[], idx: number, deg: number, pow: number) {
  const b = balls[idx]; const a = (-deg * Math.PI) / 180;
  b.vel = { x: Math.cos(a) * pow * S, y: Math.sin(a) * pow * S }; b.asleep = false;
  const rng = rngMod.createRng(1);
  physics.updateSwitches(level, balls);
  for (let i = 0; i < 1500; i++) { physics.stepBall(b, level, 1 / 60, [], rng); physics.updateSwitches(level, balls); if (b.sunk || (b.asleep && !b.sinking)) break; }
  const sw: Record<string, boolean> = {}; for (const s of level.switches) sw[s.id] = s.pressed;
  return { rest: b.pos.x, sw };
}
const angles: number[] = []; for (let a = 5; a <= 90; a += 5) angles.push(a);
const powers: number[] = []; for (let p = 20; p <= 100; p += 10) powers.push(p);
function rate(level: any, setup: () => any[], idx: number, ok: (r: any) => boolean) {
  let n = 0, k = 0;
  for (const a of angles) for (const p of powers) { n++; if (ok(shoot(level, setup(), idx, a, p))) k++; }
  return `${k}/${n} (${((100 * k) / n).toFixed(0)}%)`;
}
for (const doorH of [100, 80, 60]) {
  const L3 = JSON.parse(JSON.stringify(levels[2]));
  for (const r of L3.rects) {
    if (r.kind === 'hazard') { r.h = 640 - doorH - r.y; }
    if (r.kind === 'gate') { r.y = 640 - doorH; r.h = doorH; }
  }
  // door rect bottom at 640 (20 px into the dirt), opening = doorH above the floor 620
  for (const r of L3.rects) if (r.kind === 'gate') { r.y = 620 - doorH; r.h = doorH + 20; }
  for (const r of L3.rects) if (r.kind === 'hazard') { r.h = (620 - doorH) - r.y; }
  console.log(`door opening ${doorH} px: blue tee150 -> plate1 ${rate(L3, () => [mk(L3, 0, 100), mk(L3, 1, 150)], 1, (r) => r.sw.door1)} | blue tee180 ${rate(L3, () => [mk(L3, 0, 100), mk(L3, 1, 180)], 1, (r) => r.sw.door1)} | blue tee220 ${rate(L3, () => [mk(L3, 0, 100), mk(L3, 1, 220)], 1, (r) => r.sw.door1)} | red 850 -> plate2 ${rate(L3, () => [mk(L3, 0, 850), mk(L3, 1, 1000)], 0, (r) => r.sw.door2)} | red 950 ${rate(L3, () => [mk(L3, 0, 950), mk(L3, 1, 1000)], 0, (r) => r.sw.door2)} | red 1050 ${rate(L3, () => [mk(L3, 0, 1050), mk(L3, 1, 1000)], 0, (r) => r.sw.door2)} | red tee through door1 (blue holds) ${rate(L3, () => [mk(L3, 0, 100), mk(L3, 1, 850)], 0, (r) => r.rest > 480)} | blue 1050 through door2 ${rate(L3, () => [mk(L3, 0, 1415), mk(L3, 1, 1050)], 1, (r) => r.rest > 1200)}`);
}
