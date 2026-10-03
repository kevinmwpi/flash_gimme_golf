// Human-range sweeps against the real current physics (not just the solver grid, whose top power is 94.4):
// angles 5..90 step 5 x power 20..100 step 10 (162 shots) from given positions, plus continuous-aim
// power 95-100 wall/gap checks. Assertions the rebuilt vitest level-validity suite should carry.
// Run from the project dir: npx tsx sweep.ts
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const physics = await imp(PROJECT + '/src/game/physics.ts');
const terrain = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod = await imp(PROJECT + '/src/game/rng.ts');
const { levels, SHOT_SPEED_PER_POWER: S } = await imp(HERE + '/levels.ts');

function mk(level: any, pid: number, x: number) {
  const pos = terrain.placeBallOnSurface(level, x, 12);
  return { playerId: pid, pos, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: 12, color: '', safeColor: ['red', 'blue'][pid], strokes: 0, sunk: false, asleep: true, sinking: false, sinkT: 0, trail: [] } as any;
}
function shoot(level: any, balls: any[], idx: number, deg: number, pow: number) {
  const b = balls[idx];
  const a = (-deg * Math.PI) / 180;
  b.vel = { x: Math.cos(a) * pow * S, y: Math.sin(a) * pow * S };
  b.asleep = false;
  const rng = rngMod.createRng(1);
  let fell = false, maxX = b.pos.x, minY = b.pos.y;
  const touched = new Set<string>();
  physics.updateSwitches(level, balls);
  for (let i = 0; i < 1500; i++) {
    physics.stepBall(b, level, 1 / 60, [], rng);
    physics.updateSwitches(level, balls);
    if (b.pos.y > level.height + 150) fell = true;
    if (b.pos.x > maxX) maxX = b.pos.x;
    if (b.pos.y < minY) minY = b.pos.y;
    for (const r of level.rects) {
      if (!physics.isRectActive(r, level)) continue;
      const cx = Math.max(r.x, Math.min(b.pos.x, r.x + r.w)), cy = Math.max(r.y, Math.min(b.pos.y, r.y + r.h));
      if (Math.hypot(b.pos.x - cx, b.pos.y - cy) <= b.radius + 2) touched.add(r.label ?? r.kind);
    }
    if (b.sunk || (b.asleep && !b.sinking)) break;
  }
  const sw: Record<string, boolean> = {};
  for (const s of level.switches) sw[s.id] = s.pressed;
  return { fell, maxX, minY, touched, rest: { ...b.pos }, sunk: b.sunk, sw };
}
const angles: number[] = []; for (let a = 5; a <= 90; a += 5) angles.push(a);
const powers: number[] = []; for (let p = 20; p <= 100; p += 10) powers.push(p);
function sweep(name: string, level: any, setup: () => any[], idx: number, classify: (r: any) => string, angs = angles, pows = powers) {
  const counts: Record<string, number> = {}; let n = 0; const ex: Record<string, string> = {};
  for (const a of angs) for (const p of pows) {
    const balls = setup();
    const r = shoot(level, balls, idx, a, p);
    const c = classify(r); counts[c] = (counts[c] ?? 0) + 1; n++;
    if (!ex[c]) ex[c] = `${a}deg/${p}`;
  }
  console.log(`${name} (${n} shots): ` + Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v} (${((100 * v) / n).toFixed(0)}%, e.g. ${ex[k]})`).join(' | '));
  return counts;
}
const fine: number[] = []; for (let a = 20; a <= 88; a += 1) fine.push(a);
const full = [95, 97, 100];
const [L1, L2, L3, L4] = levels;

console.log(`shot speed ${S}`);
// apex / range on flat ground
{
  const up = shoot(L3, [mk(L3, 0, 100), mk(L3, 1, 150)], 0, 90, 100);
  const r45 = shoot(L3, [mk(L3, 0, 100), mk(L3, 1, 150)], 0, 45, 100);
  console.log(`apex at 90deg/100 = ${(608 - up.minY).toFixed(0)} px (ball centre), 45deg/100 rests ${(r45.rest.x - 100).toFixed(0)} px out`);
}
// L1: no holes-in-one from either tee; where do tee drives go
sweep('L1 red from tee x=90', L1, () => [mk(L1, 0, 90), mk(L1, 1, 130)], 0, (r) => r.sunk ? 'HOLE-IN-ONE' : r.rest.x >= 1120 ? 'on green (ACE RISK)' : r.touched.has('sand') ? 'in/through sand' : r.rest.x >= 600 ? 'fairway 600+' : 'short');
sweep('L1 blue from tee x=130', L1, () => [mk(L1, 0, 90), mk(L1, 1, 130)], 1, (r) => r.sunk ? 'HOLE-IN-ONE' : r.rest.x >= 1120 ? 'on green (ACE RISK)' : r.touched.has('sand') ? 'in/through sand' : r.rest.x >= 600 ? 'fairway 600+' : 'short');
sweep('L1 red from tee, continuous aim p95-100', L1, () => [mk(L1, 0, 90), mk(L1, 1, 130)], 0, (r) => r.sunk ? 'HOLE-IN-ONE' : r.rest.x >= 1120 ? 'on green (ACE RISK)' : r.touched.has('sand') ? 'sand' : 'short', fine, full);
sweep('L1 red from x=760 (2nd shot zone) to the green', L1, () => [mk(L1, 0, 760), mk(L1, 1, 130)], 0, (r) => r.sunk ? 'SUNK' : r.rest.x >= 1120 ? 'on green' : r.touched.has('sand') ? 'in sand' : 'short/other');
sweep('L1 red from the sand x=940 to the green', L1, () => [mk(L1, 0, 940), mk(L1, 1, 130)], 0, (r) => r.sunk ? 'SUNK' : r.rest.x >= 1120 ? 'on green' : r.touched.has('sand') ? 'still in sand' : 'short/other');

// L2: wall unclearable at power 95-100 from anywhere in front; plate hit rates
sweep('L2 red from tee -> DOOR plate', L2, () => [mk(L2, 0, 100), mk(L2, 1, 150)], 0, (r) => r.sw.door ? 'ON DOOR PLATE' : r.rest.x > 690 ? 'in front of wall, off plate' : 'short');
sweep('L2 blue from tee -> DOOR plate', L2, () => [mk(L2, 0, 100), mk(L2, 1, 150)], 1, (r) => r.sw.door ? 'ON DOOR PLATE' : r.rest.x > 690 ? 'in front of wall, off plate' : 'short');
sweep('L2 red from x=550 -> DOOR plate', L2, () => [mk(L2, 0, 550), mk(L2, 1, 150)], 0, (r) => r.sw.door ? 'ON DOOR PLATE' : r.rest.x > 690 ? 'off plate near wall' : 'short');
{
  let passes = 0, total = 0, minY = 9999, best = '';
  for (const x of [300, 500, 600, 700, 780, 820, 860, 880]) for (const a of fine) for (const p of full) {
    total++;
    const r = shoot(L2, [mk(L2, 0, x), mk(L2, 1, 150)], 0, a, p);
    if (r.maxX > 950) passes++;
    if (r.minY < minY) { minY = r.minY; best = `x=${x} ${a}deg/${p}`; }
  }
  console.log(`L2 wall (top y200, 420 px): ${passes}/${total} continuous-aim p95-100 shots passed the wall; highest ball centre y=${minY.toFixed(0)} (${best}); wall top needs centre < 188`);
}
sweep('L2 red through open door from x=600 (blue holds)', L2, () => [mk(L2, 0, 600), mk(L2, 1, 795)], 0, (r) => r.rest.x < 900 ? 'did not pass' : r.sw.window ? 'ON WINDOW PLATE' : r.rest.x < 1230 ? 'past wall, off plate (<1230)' : 'past wall, beyond dish');
sweep('L2 red through open door from x=500 (blue holds)', L2, () => [mk(L2, 0, 500), mk(L2, 1, 795)], 0, (r) => r.rest.x < 900 ? 'did not pass' : r.sw.window ? 'ON WINDOW PLATE' : r.rest.x < 1230 ? 'past wall, off plate (<1230)' : 'past wall, beyond dish');
sweep('L2 blue window lob from DOOR plate x=795 (red holds window)', L2, () => [mk(L2, 0, 1085), mk(L2, 1, 795)], 1, (r) => r.rest.x > 940 ? 'THROUGH WINDOW' : 'bounced back');
sweep('L2 blue window lob from x=760 (red holds window)', L2, () => [mk(L2, 0, 1085), mk(L2, 1, 760)], 1, (r) => r.rest.x > 940 ? 'THROUGH WINDOW' : 'bounced back');
sweep('L2 stall tap on DOOR plate keeps it held (any power<=30, angle>=70)', L2, () => [mk(L2, 0, 600), mk(L2, 1, 795)], 1, (r) => r.sw.door ? 'still on plate' : 'LEFT PLATE', [70, 75, 80, 85, 90], [20, 30]);

// L3 Colour Keys
sweep('L3 blue from tee x=150 -> DOOR 1 plate behind wall 1 (blue field)', L3, () => [mk(L3, 0, 100), mk(L3, 1, 150)], 1, (r) => r.sw.door1 ? 'ON DOOR1 PLATE' : r.rest.x > 480 ? 'past wall 1, off plate' : 'short/bounced');
sweep('L3 blue from x=250 (after a position shot) -> DOOR 1 plate', L3, () => [mk(L3, 0, 100), mk(L3, 1, 250)], 1, (r) => r.sw.door1 ? 'ON DOOR1 PLATE' : r.rest.x > 480 ? 'past wall 1, off plate' : 'short/bounced');
sweep('L3 red from tee x=100 with door 1 open (blue on plate) -> through door 1', L3, () => [mk(L3, 0, 100), mk(L3, 1, 850)], 0, (r) => r.rest.x > 480 ? (r.rest.x >= 650 && r.rest.x <= 1050 ? 'THROUGH DOOR 1, in the bowl' : 'THROUGH DOOR 1, elsewhere') : r.touched.has('blue') ? 'bounced off blue field' : 'short');
sweep('L3 red from tee x=100 with door 1 CLOSED', L3, () => [mk(L3, 0, 100), mk(L3, 1, 150)], 0, (r) => r.rest.x > 480 ? 'PASSED?!' : 'blocked');
sweep('L3 red from the bowl x=850 -> lob RED field onto DOOR 2 plate', L3, () => [mk(L3, 0, 850), mk(L3, 1, 1000)], 0, (r) => r.sw.door2 ? 'ON DOOR2 PLATE' : r.rest.x > 1200 ? 'past wall 2, off plate' : 'short/bounced');
sweep('L3 red from x=950 -> lob RED field onto DOOR 2 plate', L3, () => [mk(L3, 0, 950), mk(L3, 1, 1000)], 0, (r) => r.sw.door2 ? 'ON DOOR2 PLATE' : r.rest.x > 1200 ? 'past wall 2, off plate' : 'short/bounced');
sweep('L3 blue from the bowl x=850 through open door 2 (red on plate 2)', L3, () => [mk(L3, 0, 1415), mk(L3, 1, 850)], 1, (r) => r.rest.x > 1200 ? 'THROUGH DOOR 2' : r.touched.has('red') ? 'bounced off red field' : 'short');
sweep('L3 blue from x=1050 through open door 2 (red on plate 2)', L3, () => [mk(L3, 0, 1415), mk(L3, 1, 1050)], 1, (r) => r.rest.x > 1200 ? 'THROUGH DOOR 2' : r.touched.has('red') ? 'bounced off red field' : 'short');
sweep('L3 red from DOOR 2 plate x=1415 to the cup (1740)', L3, () => [mk(L3, 0, 1415), mk(L3, 1, 1050)], 0, (r) => r.sunk ? 'SUNK' : Math.abs(r.rest.x - 1740) < 60 ? 'within 60 px' : 'other');
{
  let passes = 0, total = 0, minY = 9999, best = '';
  for (const x of [100, 200, 300, 380, 410, 425]) for (const a of fine) for (const p of full) {
    total++;
    const r = shoot(L3, [mk(L3, 0, x), mk(L3, 1, 150)], 0, a, p);
    if (r.maxX > 490) passes++;
    if (r.minY < minY) { minY = r.minY; best = `x=${x} ${a}deg/${p}`; }
  }
  console.log(`L3 wall 1 (blue field top y200, 420 px) vs RED ball: ${passes}/${total} continuous-aim p95-100 shots passed; highest centre y=${minY.toFixed(0)} (${best}); needs <188`);
  passes = 0; total = 0;
  for (const x of [700, 850, 950, 1050, 1120, 1148]) for (const a of fine) for (const p of full) {
    total++;
    const r = shoot(L3, [mk(L3, 0, 100), mk(L3, 1, x)], 1, a, p);
    if (r.maxX > 1210) passes++;
  }
  console.log(`L3 wall 2 (red field top y200) vs BLUE ball: ${passes}/${total} continuous-aim p95-100 shots passed`);
}

// L4: gap uncrossable without the bridge at power 95-100, from the lip; plate hit rates with holder
{
  let crossed = 0, total = 0, maxX = 0;
  for (const x of [320, 435, 470, 500, 519]) for (let a = 10; a <= 60; a += 1) for (const p of full) {
    total++;
    const r = shoot(L4, [mk(L4, 0, x), mk(L4, 1, 150)], 0, a, p);
    if (!r.fell && r.rest.x >= 1240) crossed++;
    if (r.maxX > maxX) maxX = r.maxX;
  }
  console.log(`L4 gap (720 px) with NO holder: ${crossed}/${total} continuous-aim p95-100 shots crossed; farthest ball centre x=${maxX.toFixed(0)} (far lip 1240)`);
}
sweep('L4 red from tee x=250 -> plate A', L4, () => [mk(L4, 0, 250), mk(L4, 1, 290)], 0, (r) => r.fell ? 'FELL IN GAP' : r.sw.near ? 'ON PLATE A' : 'short/other');
sweep('L4 blue from x=290 with red on A -> across', L4, () => [mk(L4, 0, 435), mk(L4, 1, 290)], 1, (r) => r.fell ? 'FELL' : r.sw.far ? 'ON PLATE B' : r.sw.deck ? 'on deck (self-holding)' : r.rest.x > 1240 ? 'far side off plate' : 'stayed near');
sweep('L4 blue from x=290 with red on A -> across, power 90-100', L4, () => [mk(L4, 0, 435), mk(L4, 1, 290)], 1, (r) => r.fell ? 'FELL' : r.sw.far ? 'ON PLATE B' : r.sw.deck ? 'on deck (self-holding)' : r.rest.x > 1240 ? 'far side off plate' : 'stayed near', angles, [90, 100]);
sweep('L4 blue from plate A x=435 with red on A -> across', L4, () => [mk(L4, 0, 435), mk(L4, 1, 435)], 1, (r) => r.fell ? 'FELL' : r.sw.far ? 'ON PLATE B' : r.sw.deck ? 'on deck (self-holding)' : r.rest.x > 1240 ? 'far side off plate' : 'stayed near');
sweep('L4 blue from plate A x=435 with red on A -> across, power 90-100', L4, () => [mk(L4, 0, 435), mk(L4, 1, 435)], 1, (r) => r.fell ? 'FELL' : r.sw.far ? 'ON PLATE B' : r.sw.deck ? 'on deck (self-holding)' : r.rest.x > 1240 ? 'far side off plate' : 'stayed near', angles, [90, 100]);
sweep('L4 blue from tee x=290 -> plate A (red already on A)', L4, () => [mk(L4, 0, 435), mk(L4, 1, 290)], 1, (r) => r.fell ? 'FELL IN GAP' : r.sw.near && r.rest.x > 390 ? 'ON PLATE A' : r.sw.deck ? 'ON DECK' : 'short/other');
sweep('L4 lip test: ball resting at x=500-519 must NOT press the deck', L4, () => [mk(L4, 0, 250), mk(L4, 1, 250)], 1, (r) => (r.rest.x > 495 && r.rest.x < 520 && r.sw.deck) ? 'LIP PRESSES DECK (BUG)' : 'ok');
sweep('L4 ball on deck x=880 chips to plate B (partner on A)', L4, () => [mk(L4, 0, 435), { ...mk(L4, 1, 880), pos: { x: 880, y: L4.rects[0].y - 12 } }], 1, (r) => r.fell ? 'FELL' : r.sw.far ? 'ON PLATE B' : r.sw.deck ? 'still on deck' : 'far side off plate');
sweep('L4 ball on plate B putts (cup 1860)', L4, () => [mk(L4, 0, 1406), mk(L4, 1, 290)], 0, (r) => r.sunk ? 'SUNK' : Math.abs(r.rest.x - 1860) < 60 ? 'within 60 px' : 'other');
