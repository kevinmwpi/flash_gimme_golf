// Renders design/proposals/worlds-2-3/LEVELS.md Appendix A geometry to SVG diagrams.
// Launcher arcs are SIMULATED with the real authoring + physics code (cannons = lit springs).
//   npx tsx design/proposals/worlds-2-3/tools/render.ts design/proposals/worlds-2-3/LEVELS.md design/proposals/worlds-2-3/svg
import fs from 'node:fs';
import path from 'node:path';
import { compileLevel, terrainPiece, SWITCH_COLOUR, type PropDef, type SwitchDef } from '../../../../src/sim/levels/authoring';
import { stepBall, type StepBallOut } from '../../../../src/sim/physics';
import { collidersFor, solidColliders } from '../../../../src/sim/terrain';
import { BALL_RADIUS, type BallState, type Level, type PlayerId, type Vec } from '../../../../src/sim/types';

type J = {
  id: string; name: string; width: number; floorY: number;
  terrain: { points: [number, number][]; baseY: number }[];
  gaps?: [number, number][];
  rects?: { id: string; kind: string; x: number; y: number; w: number; h: number; launch?: [number, number]; colour?: string; switchIds?: string[]; label?: string }[];
  switches?: { id: string; x: number; w: number; y: number; label?: string }[];
  devices?: { id: string; kind: string; x: number; y: number; w: number; h: number; angleDeg?: number; speed?: number; releaseSwitch?: string; label?: string }[];
  tees: [number, number][]; cup: [number, number];
  notes?: { text: string; x: number; y: number }[];
};

const [docPath, outDir] = process.argv.slice(2);
const doc = fs.readFileSync(docPath, 'utf8');
const levels: J[] = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));

const TITLES: Record<string, { n: number; idea: string; par: number; first: string }> = {
  'w2-05-spring-step': { n: 5, idea: 'NEW: SPRING', par: 7, first: 'Red' },
  'w2-06-booby-trap': { n: 6, idea: 'NEW: TRAP', par: 7, first: 'Red' },
  'w2-07-load-and-fire': { n: 7, idea: 'NEW: CANNON', par: 8, first: 'Red' },
  'w2-08-colour-lift': { n: 8, idea: 'World 2 exam (nothing new)', par: 8, first: 'Blue' },
  'w3-09-bait': { n: 9, idea: 'trap + spring + door', par: 9, first: 'Red' },
  'w3-10-sky-bridge': { n: 10, idea: 'cannon + spring + bridge', par: 7, first: 'Blue' },
  'w3-11-crossfire': { n: 11, idea: 'colour fields + cannon + door', par: 8, first: 'Red' },
  'w3-12-grand-machine': { n: 12, idea: 'finale: cannon + spring + trap + door', par: 8, first: 'Red' },
};

const C = {
  ink: '#241b33', sky1: '#3fb6ff', sky2: '#c9f1ff', grass: '#6ad636', grassSh: '#45b02a', dirt: '#c97f3d', dirtSh: '#a3602a',
  pitTop: '#4a2d18', pitBot: '#1a0d05', sand: '#f5d98a', sandSh: '#d9b35c', spring: '#ffd93b', springSh: '#e0a800',
  plate: '#8d93a8', sw: '#b57bee', swSh: '#8f55cc', plank: '#d89a4b', plankSh: '#b97a33', p1: '#ff5d73', p2: '#50b7ff',
  rock: '#3b2516', trap: '#ff9f1c', cannon: '#3b3a4a', mint: '#44d67a', white: '#ffffff',
};

const cannonVec = (d: { angleDeg?: number; speed?: number }): Vec => {
  const a = ((d.angleDeg ?? 45) * Math.PI) / 180;
  const s = d.speed ?? 800;
  return { x: Math.round((s * Math.cos(a)) / 10) * 10, y: -Math.round((s * Math.sin(a)) / 10) * 10 };
};

/** Compile a simulation copy of the level: cannons become springs at their breech, traps are omitted. */
function compile(j: J): Level {
  const bridge = (j.rects ?? []).find((r) => r.kind === 'bridge');
  const props: PropDef[] = [];
  for (const r of j.rects ?? []) {
    const cx = r.x + r.w / 2;
    if (r.kind === 'wall') props.push({ kind: 'blocker', id: r.id, centerX: cx, w: r.w, h: r.h, bottom: r.y + r.h });
    else if (r.kind === 'blocker') props.push({ kind: 'blocker', id: r.id, centerX: cx, w: r.w, h: r.h, bottom: r.y + r.h, switchIds: r.switchIds ?? [], activeWhen: false, label: r.label ?? r.id.toUpperCase() });
    else if (r.kind === 'colourGate') props.push({ kind: 'colourGate', id: r.id, centerX: cx, w: r.w, h: r.h, bottom: r.y + r.h, colour: (r.colour ?? 'red') as 'red' | 'blue' });
    else if (r.kind === 'spring') props.push({ kind: 'spring', id: r.id, centerX: cx, w: r.w, launch: { x: r.launch![0], y: r.launch![1] }, label: r.label ?? 'SPRING' });
    else if (r.kind === 'sand') props.push({ kind: 'sand', id: r.id, x1: r.x, x2: r.x + r.w });
    else if (r.kind === 'bridge') props.push({ kind: 'bridge', id: r.id, gap: { x1: r.x, x2: r.x + r.w }, switchIds: r.switchIds ?? [], label: r.label ?? 'BRIDGE' });
  }
  for (const d of j.devices ?? []) {
    if (d.kind === 'cannon') props.push({ kind: 'spring', id: d.id, centerX: d.x + d.w / 2, w: d.w, launch: cannonVec(d), label: 'CANNON' });
  }
  const switches: SwitchDef[] = (j.switches ?? []).map((s) => {
    const onBridge = bridge && s.x >= bridge.x && s.x + s.w <= bridge.x + bridge.w && Math.abs(s.y - bridge.y) < 4;
    return { id: s.id, centerX: s.x + s.w / 2, w: s.w, colour: SWITCH_COLOUR, label: s.label ?? s.id, ...(onBridge ? { onRectId: bridge!.id } : {}) };
  });
  const referenced = new Set<string>();
  for (const p of props) for (const id of ((p as { switchIds?: string[] }).switchIds ?? [])) referenced.add(id);
  const orphans = switches.map((s) => s.id).filter((id) => !referenced.has(id));
  if (orphans.length) props.push({ kind: 'blocker', id: 'render-post', centerX: j.width - 2, w: 2, h: 120, switchIds: orphans, activeWhen: false } as PropDef);
  return compileLevel({
    id: j.id, name: j.name, world: 1, order: 5, par: 7, hint: 'x', aha: 'x', watchOut: 'x',
    mechanicsIntroduced: ['switch'], firstPlayer: 0, width: j.width, wind: 0,
    terrain: { pieces: j.terrain.map((t) => terrainPiece(t.points, t.baseY)), gaps: (j.gaps ?? []).map(([x1, x2]) => ({ x1, x2 })) },
    props, switches, holeX: j.cup[0], startXs: [j.tees[0][0], j.tees[1][0]],
  } as never);
}

/** Simulated flight of a ball dropped onto a launcher pad, every switch held (the "lit" state). */
function flight(level: Level, padId: string, pid: PlayerId): Vec[] {
  const pad = level.rects.find((r) => r.id === padId)!;
  const sw: Record<string, boolean> = {};
  for (const s of level.switches) sw[s.id] = s.id !== 'render-post';
  const start = { x: pad.x + pad.w / 2, y: pad.y - BALL_RADIUS - 1 };
  const b: BallState = { pos: start, vel: { x: 0, y: 0 }, asleep: false, sunk: false, grounded: false, restTicks: 0, lastRest: start };
  const out: StepBallOut = { events: [] };
  const pts: Vec[] = [];
  for (let t = 0; t < 1800 && !b.asleep && !b.sunk; t += 1) {
    const col = solidColliders(level, sw);
    stepBall(b, { level, switches: sw, playerId: pid, colliders: collidersFor(col, pid) }, out);
    if (out.events.some((e) => e.type === 'fellOffWorld')) break;
    out.events.length = 0;
    if (t % 3 === 0) pts.push(b.pos);
  }
  pts.push(b.pos);
  return pts;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n: number) => Number(n.toFixed(1));

let CLAMP_W = 1960;
function text(x: number, y: number, s: string, size: number, fill = C.ink, anchor = 'middle', weight = 700) {
  if (anchor === 'middle') {
    const half = (s.length * size * 0.62) / 2 + 6;
    x = Math.min(Math.max(x, half), CLAMP_W - half);
  }
  return `<text x="${f(x)}" y="${f(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" stroke="#fff" stroke-width="${size / 4}" paint-order="stroke" stroke-linejoin="round">${esc(s)}</text>`;
}

/** World-space SVG group for one level (720 tall, j.width wide), plus a title band of `band` px. */
function levelSvg(j: J, band: number): { body: string; w: number; h: number } {
  const t = TITLES[j.id];
  const lv = compile(j);
  const parts: string[] = [];
  const W = j.width;
  CLAMP_W = W;
  // sky
  parts.push(`<rect x="0" y="0" width="${W}" height="720" fill="url(#sky)"/>`);
  // pits under gaps
  for (const [x1, x2] of j.gaps ?? []) {
    parts.push(`<rect x="${x1}" y="560" width="${x2 - x1}" height="160" fill="url(#pit)"/>`);
    parts.push(text((x1 + x2) / 2, 700, `CHASM ${x2 - x1} px`, 22, C.white, 'middle', 700).replace(`stroke="#fff"`, `stroke="${C.pitBot}"`));
  }
  // terrain
  for (const piece of j.terrain) {
    const pts = piece.points;
    const poly = [...pts, [pts[pts.length - 1][0], piece.baseY], [pts[0][0], piece.baseY]].map(([x, y]) => `${x},${y}`).join(' ');
    parts.push(`<polygon points="${poly}" fill="${C.dirt}" stroke="${C.dirtSh}" stroke-width="3"/>`);
    parts.push(`<polyline points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${C.grass}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>`);
    parts.push(`<polyline points="${pts.map(([x, y]) => `${x},${y + 5}`).join(' ')}" fill="none" stroke="${C.grassSh}" stroke-width="3" stroke-linejoin="round"/>`);
  }
  // compiled pads (exact y from the real compiler): sand, springs, cannon breeches
  for (const r of lv.rects) {
    if (r.kind === 'sand') parts.push(`<rect x="${f(r.x)}" y="${f(r.y - 4)}" width="${f(r.w)}" height="12" rx="4" fill="${C.sand}" stroke="${C.sandSh}" stroke-width="2"/>`);
  }
  // every label goes through one placer (drawn last, nudged apart so nothing overlaps)
  const labels: { x: number; y: number; s: string; size: number; fill: string; weight: number; dir: number }[] = [];
  const addLabel = (x: number, y: number, s: string, size: number, fill: string = C.ink, weight = 700, dir = -1) =>
    labels.push({ x, y, s, size, fill, weight, dir });
  const rel = (r?: string) => (r ?? '').split(',').map((q) => q.trim().toUpperCase()).join(' / ');
  // plates
  for (const sw of lv.switches) {
    if (sw.id === 'render-post') continue;
    const y = sw.surfaceY;
    parts.push(`<rect x="${f(sw.x)}" y="${f(y - 5)}" width="${f(sw.w)}" height="8" rx="3" fill="${C.sw}" stroke="${C.swSh}" stroke-width="2"/>`);
    addLabel(sw.x + sw.w / 2, y + 26, sw.label ?? sw.id, 18, C.swSh, 700, 1);
  }
  // walls, doors, colour fields, bridges, springs (from the JSON, so labels match the doc)
  for (const r of j.rects ?? []) {
    if (r.kind === 'wall') parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#9aa0b4" stroke="${C.ink}" stroke-width="3"/>`);
    else if (r.kind === 'blocker') {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${C.plank}" stroke="${C.ink}" stroke-width="3" stroke-dasharray="10 6"/>`);
      addLabel(r.x + r.w / 2, r.y + r.h / 2 + 6, r.label ?? 'DOOR', 15, C.ink, 700, -1);
    } else if (r.kind === 'colourGate') {
      const col = r.colour === 'blue' ? C.p2 : C.p1;
      const y0 = Math.max(r.y, 0);
      parts.push(`<rect x="${r.x}" y="${y0}" width="${r.w}" height="${r.y + r.h - y0}" fill="${col}" fill-opacity="0.55" stroke="${col}" stroke-width="3"/>`);
      addLabel(r.x + r.w / 2, Math.max(y0 + 120, r.y + r.h - 14), `${(r.colour ?? '').toUpperCase()} FIELD`, 15, col, 700, -1);
    } else if (r.kind === 'bridge') {
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${C.plank}" fill-opacity="0.6" stroke="${C.plankSh}" stroke-width="3" stroke-dasharray="14 8"/>`);
      addLabel(r.x + r.w / 2, r.y + 50, `BRIDGE (while ${rel((r.switchIds ?? []).join(','))} is held)`, 18, C.plankSh, 700, 1);
    } else if (r.kind === 'spring') {
      const pad = lv.rects.find((q) => q.id === r.id)!;
      parts.push(`<rect x="${f(pad.x)}" y="${f(pad.y - 6)}" width="${f(pad.w)}" height="14" rx="4" fill="${C.spring}" stroke="${C.springSh}" stroke-width="3"/>`);
      const L = Math.hypot(r.launch![0], r.launch![1]);
      const ux = r.launch![0] / L;
      const uy = r.launch![1] / L;
      const cx = pad.x + pad.w / 2;
      parts.push(`<line x1="${f(cx)}" y1="${f(pad.y - 6)}" x2="${f(cx + ux * 70)}" y2="${f(pad.y - 6 + uy * 70)}" stroke="${C.springSh}" stroke-width="6" marker-end="url(#arrow)"/>`);
      addLabel(cx, pad.y + 30, 'SPRING', 18, C.springSh, 700, 1);
    }
  }
  // devices: traps and cannons
  for (const d of j.devices ?? []) {
    if (d.kind === 'trap') {
      parts.push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="url(#hatch)" stroke="${C.trap}" stroke-width="4"/>`);
      addLabel(d.x + d.w / 2, d.y + d.h + 24, `TRAP (freed by ${rel(d.releaseSwitch)})`, 16, '#c25e00', 700, 1);
    } else if (d.kind === 'cannon') {
      const v = cannonVec(d);
      const ang = (Math.atan2(v.y, v.x) * 180) / Math.PI;
      const cx = d.x + d.w / 2;
      const cy = d.y;
      parts.push(`<g transform="translate(${f(cx)},${f(cy - 4)}) rotate(${f(ang)})"><rect x="-10" y="-15" width="86" height="30" rx="8" fill="${C.cannon}" stroke="${C.ink}" stroke-width="3"/><rect x="66" y="-18" width="14" height="36" rx="4" fill="${C.cannon}" stroke="${C.ink}" stroke-width="3"/></g>`);
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy + 2)}" r="9" fill="${C.mint}" stroke="${C.ink}" stroke-width="2"/>`);
      addLabel(cx, cy + 40, `CANNON (lit by ${rel(d.releaseSwitch)})`, 16, C.cannon, 700, 1);
    }
  }
  // simulated launcher arcs
  const arcs: { pts: Vec[]; col: string }[] = [];
  const springIds = (j.rects ?? []).filter((r) => r.kind === 'spring').map((r) => r.id);
  const cannonIds = (j.devices ?? []).filter((d) => d.kind === 'cannon').map((d) => d.id);
  const hasColourFieldInFlight = j.id === 'w2-08-colour-lift';
  for (const id of [...springIds, ...cannonIds]) {
    if (hasColourFieldInFlight) {
      arcs.push({ pts: flight(lv, id, 1), col: C.p2 });
      arcs.push({ pts: flight(lv, id, 0), col: C.p1 });
    } else arcs.push({ pts: flight(lv, id, 0), col: C.ink });
  }
  for (const a of arcs) {
    parts.push(`<polyline points="${a.pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="none" stroke="${a.col}" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round" opacity="0.9"/>`);
    const end = a.pts[a.pts.length - 1];
    parts.push(`<circle cx="${f(end.x)}" cy="${f(end.y)}" r="12" fill="none" stroke="${a.col}" stroke-width="3" stroke-dasharray="4 4"/>`);
  }
  // cup + flag
  const [hx, hy] = j.cup;
  parts.push(`<ellipse cx="${hx}" cy="${hy + 2}" rx="18" ry="7" fill="${C.ink}"/><line x1="${hx + 4}" y1="${hy}" x2="${hx + 4}" y2="${hy - 70}" stroke="${C.ink}" stroke-width="4"/><path d="M${hx + 6},${hy - 70} l38,12 l-38,12 z" fill="${C.p1}" stroke="${C.ink}" stroke-width="2"/>`);
  // tees: tee 0 red, tee 1 blue
  j.tees.forEach(([x, y], i) => parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="${i === 0 ? C.p1 : C.p2}" stroke="${C.ink}" stroke-width="3"/>`));
  addLabel((j.tees[0][0] + j.tees[1][0]) / 2, j.tees[0][1] - 26, 'TEES', 16, C.ink, 700, -1);
  // notes from the doc
  for (const n of j.notes ?? []) addLabel(n.x, n.y, n.text, 17, C.ink, 600, -1);
  // place labels: clamp inside the level, then nudge along each label's direction until clear
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const l of labels) {
    const half = (l.s.length * l.size * 0.62) / 2 + 6;
    const cx = Math.min(Math.max(l.x, half), W - half);
    const clampY = (yy: number) => Math.min(Math.max(yy, 92), 712);
    const hit = (yy: number) => boxes.some((b) => b.x0 < cx + half && cx - half < b.x1 && b.y0 < yy + 5 && yy - l.size - 3 < b.y1);
    let y = clampY(l.y);
    for (let k = 0; k < 14 && hit(y); k += 1) {
      const next = clampY(y + l.dir * (l.size + 6));
      if (next === y) l.dir = -l.dir;
      y = clampY(y + l.dir * (l.size + 6));
    }
    boxes.push({ x0: cx - half, x1: cx + half, y0: y - l.size - 3, y1: y + 5 });
    parts.push(text(cx, y, l.s, l.size, l.fill, 'middle', l.weight));
  }
  // HUD bands (where the live game draws its top and bottom HUD)
  parts.push(`<line x1="0" y1="68" x2="${W}" y2="68" stroke="${C.ink}" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="6 10"/><line x1="0" y1="652" x2="${W}" y2="652" stroke="${C.ink}" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="6 10"/>`);
  const title = `Level ${t.n}: ${j.name}  ·  ${t.idea}  ·  par ${t.par}  ·  ${t.first} first  ·  ${W}×720`;
  const head = `<rect x="0" y="${-band}" width="${W}" height="${band}" fill="#241b33"/><text x="20" y="${-band / 2 + 12}" font-size="34" font-weight="800" fill="#fff">${esc(title)}</text>`;
  return { body: head + parts.join(''), w: W, h: 720 + band };
}

const DEFS = `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky1}"/><stop offset="1" stop-color="${C.sky2}"/></linearGradient>
<linearGradient id="pit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.pitTop}"/><stop offset="1" stop-color="${C.pitBot}"/></linearGradient>
<pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#ffe2bd" fill-opacity="0.8"/><line x1="0" y1="0" x2="0" y2="12" stroke="${C.trap}" stroke-width="5"/></pattern>
<marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.springSh}"/></marker>
</defs>`;

const BAND = 56;
const SCALE = 0.5;
fs.mkdirSync(outDir, { recursive: true });
const sheets: { svg: string; w: number; h: number }[] = [];
for (const j of levels) {
  const { body, w, h } = levelSvg(j, BAND);
  const t = TITLES[j.id];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SCALE}" height="${h * SCALE}" viewBox="0 ${-BAND} ${w} ${h}" font-family="Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif">${DEFS}${body}</svg>`;
  const file = path.join(outDir, `level-${t.n}.svg`);
  fs.writeFileSync(file, svg);
  sheets.push({ svg: body, w, h });
  console.log('wrote', file);
}
// one overview sheet: all eight stacked, at a common width of 1960 world px
const GAP = 40;
const totalH = sheets.reduce((a, s) => a + s.h + GAP, 0);
let y = 0;
const groups = sheets.map((s) => {
  const g = `<g transform="translate(0,${y + BAND})">${s.svg}</g>`;
  y += s.h + GAP;
  return g;
});
const overview = `<svg xmlns="http://www.w3.org/2000/svg" width="${1960 * SCALE}" height="${totalH * SCALE}" viewBox="0 0 1960 ${totalH}" font-family="Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif"><rect width="1960" height="${totalH}" fill="#10263d"/>${DEFS}${groups.join('')}</svg>`;
fs.writeFileSync(path.join(outDir, 'overview.svg'), overview);
console.log('wrote overview.svg', 1960 * SCALE, 'x', totalH * SCALE);
