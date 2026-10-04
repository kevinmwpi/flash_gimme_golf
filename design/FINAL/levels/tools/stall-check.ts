// Locked decision 19 check: EVERY ball stepped every tick. Does a holder's stall tap (and a holder leaving)
// keep a partner parked on the bridge deck safe (L4), and does a lone ball ever cross? Also: L2/L3 door-plate
// taps re-hold the plate, and a ball resting on plate A alone never crosses.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const PROJECT = 'C:/Users/KevnP/Downloads/flash_golf/flash_gimme_golf';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const imp = (p: string) => import(pathToFileURL(path.resolve(p)).href);
const physics = await imp(PROJECT + '/src/game/physics.ts');
const terrain = await imp(PROJECT + '/src/game/terrain.ts');
const rngMod = await imp(PROJECT + '/src/game/rng.ts');
const { levels, SHOT_SPEED_PER_POWER: S } = await imp(HERE + '/levels.ts');

function ball(pid: number, pos: { x: number; y: number }) {
  return { playerId: pid, pos: { ...pos }, prevPos: { ...pos }, vel: { x: 0, y: 0 }, radius: 12, color: '#fff', safeColor: pid === 0 ? 'red' : 'blue', strokes: 0, sunk: false, asleep: true, sinking: false, sinkT: 0, trail: [] };
}
function run(label: string, level: any, balls: any[], shooter: number, deg: number, power: number) {
  const bs = JSON.parse(JSON.stringify(balls));
  physics.updateSwitches(level, bs);
  const before = level.switches.map((s: any) => `${s.id}=${s.pressed ? 1 : 0}`).join(' ');
  const b = bs[shooter];
  const a = (-deg * Math.PI) / 180;
  b.vel = { x: Math.cos(a) * power * S, y: Math.sin(a) * power * S };
  b.asleep = false;
  const rng = rngMod.createRng(1);
  const partner = bs[1 - shooter];
  const p0 = { ...partner.pos };
  let partnerFell = false, maxDrop = 0, ticks = 0, releasedTicks = 0;
  for (let t = 0; t < 900; t += 1) {
    ticks = t + 1;
    for (const x of bs) if (!x.sunk) physics.stepBall(x, level, 1 / 60, [], rng);
    physics.updateSwitches(level, bs);
    if (!level.rects.some((r: any) => physics.isRectActive(r, level) && r.kind === 'bridge') && level.rects.some((r: any) => r.kind === 'bridge')) releasedTicks++;
    const dy = partner.pos.y - p0.y;
    if (dy > maxDrop) maxDrop = dy;
    if (partner.pos.y > level.height + 150 || Math.abs(partner.pos.x - p0.x) > 200) partnerFell = true;
    if (bs.every((x: any) => x.asleep || x.sunk)) break;
  }
  const after = level.switches.map((s: any) => `${s.id}=${s.pressed ? 1 : 0}`).join(' ');
  console.log(`${label}\n  switches before: ${before} | after: ${after} | bridge-down ticks: ${releasedTicks}\n  shooter rests at x=${Math.round(b.pos.x)} after ${ticks} ticks; partner (${Math.round(p0.x)},${Math.round(p0.y)}) -> (${Math.round(partner.pos.x)},${Math.round(partner.pos.y)}) maxDrop=${Math.round(maxDrop)} px, FELL=${partnerFell}`);
}

const L2 = levels[1], L3 = levels[2], L4 = levels[3];
const bridgeTop = L4.rects[0].y;
console.log('=== L4 Plate & Bridge: red holds plate A, blue rests mid-deck (x=880); red stall-taps ===');
for (const [ang, pow] of [[90, 10], [90, 15], [80, 20], [100, 15]]) run(`red tap ${ang}deg/${pow}`, L4, [ball(0, terrain.placeBallOnSurface(L4, 435, 12)), ball(1, { x: 880, y: bridgeTop - 12 })], 0, ang, pow);
run('red leaves A and crosses (40deg/94)', L4, [ball(0, terrain.placeBallOnSurface(L4, 435, 12)), ball(1, { x: 880, y: bridgeTop - 12 })], 0, 40, 94);
console.log('\n=== L4: blue on plate B, red parked on the deck; blue putts away ===');
run('blue B -> cup (29deg/61)', L4, [ball(0, { x: 880, y: bridgeTop - 12 }), ball(1, terrain.placeBallOnSurface(L4, 1406, 12))], 1, 29, 61);
console.log('\n=== L4: lone ball on plate A (partner at tee): can it use the deck to cross? ===');
for (const [ang, pow] of [[29, 49], [40, 94], [20, 100], [45, 100]]) run(`lone blue from A ${ang}deg/${pow}`, L4, [ball(0, terrain.placeBallOnSurface(L4, 250, 12)), ball(1, terrain.placeBallOnSurface(L4, 435, 12))], 1, ang, pow);
console.log('\n=== L4: ball on the deck, NOBODY else holding (partner on far side off plate): shot from the deck ===');
for (const [ang, pow] of [[90, 15], [10, 40], [29, 61], [51, 72], [61, 83]]) run(`deck ball ${ang}deg/${pow}`, L4, [ball(0, terrain.placeBallOnSurface(L4, 1600, 12)), ball(1, { x: 880, y: bridgeTop - 12 })], 1, ang, pow);
console.log('\n=== L2: blue holds DOOR plate (dish), red waits at 600; blue stall-taps ===');
for (const [ang, pow] of [[90, 10], [90, 15], [80, 20], [100, 15]]) run(`blue tap ${ang}deg/${pow}`, L2, [ball(0, terrain.placeBallOnSurface(L2, 600, 12)), ball(1, terrain.placeBallOnSurface(L2, 795, 12))], 1, ang, pow);
console.log('\n=== L3: red holds DOOR 2 plate (bowl behind wall 2), blue waits at 1050; red stall-taps ===');
for (const [ang, pow] of [[90, 10], [90, 15], [80, 20]]) run(`red tap ${ang}deg/${pow}`, L3, [ball(0, terrain.placeBallOnSurface(L3, 1415, 12)), ball(1, terrain.placeBallOnSurface(L3, 1050, 12))], 0, ang, pow);
console.log('\n=== L3: blue holds DOOR 1 plate (dish behind wall 1), red waits at 400; blue stall-taps ===');
for (const [ang, pow] of [[90, 10], [90, 15], [80, 20]]) run(`blue tap ${ang}deg/${pow}`, L3, [ball(0, terrain.placeBallOnSurface(L3, 300, 12)), ball(1, terrain.placeBallOnSurface(L3, 850, 12))], 1, ang, pow);
