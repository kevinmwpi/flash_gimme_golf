import type { GameState, Player, Segment } from './types';
import { activeRects, activeSegments, predictArc } from './physics';

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  drawSky(ctx, width, height, state.time);
  ctx.save();
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x, -state.camera.y);
  drawWorld(ctx, state);
  ctx.restore();
  drawHud(ctx, state, width, height);
}

function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#83d8ff');
  sky.addColorStop(0.55, '#d6f1ff');
  sky.addColorStop(1, '#f8db91');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 8; i += 1) {
    const x = ((i * 240 + time * 13) % (width + 220)) - 140;
    const y = 42 + (i % 3) * 42;
    blob(ctx, x, y, 52, 15);
    blob(ctx, x + 45, y - 8, 42, 13);
    blob(ctx, x + 86, y, 55, 16);
  }
}

function drawWorld(ctx: CanvasRenderingContext2D, state: GameState) {
  const { level } = state;
  ctx.fillStyle = 'rgba(40,58,84,.18)';
  ctx.fillRect(0, 0, level.width, level.height);
  drawBackgroundHills(ctx, state);

  for (const fan of level.fans ?? []) {
    const grad = ctx.createLinearGradient(fan.x, fan.y + fan.h, fan.x, fan.y);
    grad.addColorStop(0, 'rgba(89,232,255,.05)');
    grad.addColorStop(1, 'rgba(89,232,255,.42)');
    ctx.fillStyle = grad;
    ctx.fillRect(fan.x, fan.y, fan.w, fan.h);
    ctx.fillStyle = '#125c74';
    ctx.fillRect(fan.x + 10, fan.y + fan.h - 14, fan.w - 20, 14);
    ctx.fillStyle = '#e9ffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(fan.label, fan.x + 14, fan.y + fan.h - 20);
    for (let i = 0; i < 6; i += 1) arrow(ctx, fan.x + 22 + i * 14, fan.y + fan.h - 34 - ((state.time * 45 + i * 18) % 80), '#d7fbff');
  }

  drawHole(ctx, state);
  for (const sw of level.switches) drawSwitch(ctx, sw.x, sw.y, sw.w, sw.pressed, sw.label);
  for (const rect of activeRects(level)) drawPlatform(ctx, rect.x, rect.y, rect.w, rect.h, rect.switchId ? '#65e6ff' : '#6fdb84');
  for (const segment of activeSegments(level)) drawSegment(ctx, segment);

  if (state.mode === 'playing' && !state.shotInFlight) drawAim(ctx, state);
  for (const player of state.players) drawGolfer(ctx, player, state.time);
  for (const player of state.players) drawBall(ctx, player);
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawBackgroundHills(ctx: CanvasRenderingContext2D, state: GameState) {
  const { level } = state;
  ctx.fillStyle = '#7fc776';
  ctx.beginPath();
  ctx.moveTo(0, level.height);
  for (let x = 0; x <= level.width; x += 80) ctx.lineTo(x, level.height - 115 - Math.sin(x * 0.006 + state.time * 0.2) * 26);
  ctx.lineTo(level.width, level.height); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#50a864';
  ctx.beginPath();
  ctx.moveTo(0, level.height);
  for (let x = 0; x <= level.width; x += 70) ctx.lineTo(x, level.height - 70 - Math.sin(x * 0.01) * 34);
  ctx.lineTo(level.width, level.height); ctx.closePath(); ctx.fill();
}

function drawSegment(ctx: CanvasRenderingContext2D, s: Segment) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color ?? '#3a8f4c';
  ctx.lineWidth = s.kind === 'gate' ? 18 : s.kind === 'hazard' ? 16 : s.kind === 'bumper' || s.kind === 'moving' ? 14 : 22;
  ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
  if (!s.kind || s.kind === 'terrain') {
    ctx.strokeStyle = '#8ee179'; ctx.lineWidth = 6; ctx.stroke();
  }
  if (s.kind === 'hazard') {
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawPlatform(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(x + 8, y + 4, w - 16, 3);
}

function drawSwitch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, pressed: boolean, label: string) {
  ctx.fillStyle = '#27354a'; roundRect(ctx, x, y + 7, w, 12, 5); ctx.fill();
  ctx.fillStyle = pressed ? '#9cff6e' : '#ffdf61'; roundRect(ctx, x + 7, y + (pressed ? 2 : -4), w - 14, 12, 6); ctx.fill();
  ctx.fillStyle = '#203040'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y - 9); ctx.textAlign = 'left';
}

function drawHole(ctx: CanvasRenderingContext2D, state: GameState) {
  const { hole } = state.level;
  ctx.fillStyle = '#1b1720';
  ctx.beginPath(); ctx.ellipse(hole.x, hole.y + 8, 29, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#593414'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hole.x + 18, hole.y + 8); ctx.lineTo(hole.x + 18, hole.y - 78); ctx.stroke();
  ctx.fillStyle = '#ff5c7c';
  ctx.beginPath();
  ctx.moveTo(hole.x + 20, hole.y - 78);
  ctx.quadraticCurveTo(hole.x + 62, hole.y - 72 + Math.sin(state.time * 5) * 4, hole.x + 24, hole.y - 48);
  ctx.closePath(); ctx.fill();
}

function drawGolfer(ctx: CanvasRenderingContext2D, player: Player, time: number) {
  if (player.ball.inHole) return;
  const b = player.ball.pos;
  const bob = Math.sin(time * 4 + player.id) * 2;
  const x = b.x - 18;
  const y = b.y - player.ball.radius - 26 + bob;
  ctx.strokeStyle = '#273040'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y + 15); ctx.lineTo(x - 7, y + 32); ctx.moveTo(x, y + 15); ctx.lineTo(x + 8, y + 31); ctx.moveTo(x, y + 6); ctx.lineTo(x - 12, y + 17); ctx.stroke();
  ctx.fillStyle = player.color; roundRect(ctx, x - 8, y, 16, 21, 7); ctx.fill();
  ctx.fillStyle = '#ffd3aa'; ctx.beginPath(); ctx.arc(x, y - 8, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#332716'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 8, y + 11); ctx.lineTo(x + 21, y + 27); ctx.stroke();
}

function drawBall(ctx: CanvasRenderingContext2D, player: Player) {
  const b = player.ball;
  if (b.inHole) return;
  for (let i = 0; i < b.trail.length; i += 1) {
    const p = b.trail[i]; ctx.globalAlpha = i / b.trail.length * 0.32; ctx.fillStyle = player.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3 + i / 14, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = player.color; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = player.color; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(player.id + 1), b.pos.x, b.pos.y + 3); ctx.textAlign = 'left';
}

function drawAim(ctx: CanvasRenderingContext2D, state: GameState) {
  const p = state.players[state.activePlayer];
  if (!p || p.ball.inHole) return;
  const arc = predictArc(p, state.level);
  ctx.fillStyle = p.color;
  arc.forEach((pt, i) => { if (i % 3 === 0) { ctx.globalAlpha = 0.25 + i / arc.length * 0.45; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill(); } });
  ctx.globalAlpha = 1;
  const r = (p.angle * Math.PI) / 180;
  ctx.strokeStyle = p.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(p.ball.pos.x, p.ball.pos.y); ctx.lineTo(p.ball.pos.x + Math.cos(r) * 54, p.ball.pos.y - Math.sin(r) * 54); ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  const active = state.players[state.activePlayer];
  ctx.fillStyle = 'rgba(8,15,28,.74)'; roundRect(ctx, 18, 16, Math.min(720, width - 36), 116, 18); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '900 25px sans-serif'; ctx.fillText(`Golf Siege — ${state.level.name}`, 36, 50);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#d9efff'; ctx.fillText(`${state.level.subtitle}  •  ${state.message}`, 37, 76);
  if (active) {
    ctx.fillStyle = active.color; ctx.font = 'bold 16px sans-serif'; ctx.fillText(`Turn: P${active.id + 1}`, 38, 105);
    ctx.fillStyle = '#fff'; ctx.fillText(`Angle ${Math.round(active.angle)}°`, 136, 105); ctx.fillText(`Power ${Math.round(active.power)}%`, 238, 105); ctx.fillText(`Wind ${state.level.wind > 0 ? '→' : state.level.wind < 0 ? '←' : '—'} ${Math.abs(state.level.wind)}`, 352, 105);
  }
  const sx = width - 196;
  ctx.fillStyle = 'rgba(8,15,28,.74)'; roundRect(ctx, sx, 16, 178, 36 + state.players.length * 30, 18); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('Scoreboard', sx + 18, 42);
  state.players.forEach((p, i) => { ctx.fillStyle = p.color; ctx.fillText(`P${p.id + 1}`, sx + 18, 70 + i * 30); ctx.fillStyle = '#fff'; ctx.fillText(`${p.strokes} strokes${p.ball.inHole ? ' ✓' : ''}`, sx + 62, 70 + i * 30); });
  ctx.fillStyle = 'rgba(8,15,28,.64)'; roundRect(ctx, 18, height - 58, Math.min(880, width - 36), 40, 14); ctx.fill();
  ctx.fillStyle = '#e9f8ff'; ctx.font = '13px sans-serif'; ctx.fillText('Aim: ←/→ or A/D   Power: ↑/↓ or W/S   Shoot/continue: Space   Reset: R   Camera: Tab', 36, height - 33);
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) { ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill(); }
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 12); ctx.lineTo(x + 12, y); ctx.closePath(); ctx.fill(); }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
