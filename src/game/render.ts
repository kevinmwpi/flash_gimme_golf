import { playerColors } from './engine';
import { predictArc } from './engine';
import type { GameState, Rect, Vec } from './types';

const VIRTUAL_W = 1280;
const VIRTUAL_H = 720;

type Camera = { x: number; y: number; scale: number; w: number; h: number };

function rectPath(ctx: CanvasRenderingContext2D, r: Rect, radius = 8) {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rr);
}

function worldCamera(state: GameState): Camera {
  const level = state.level;
  const fullScale = Math.min(VIRTUAL_W / level.width, (VIRTUAL_H - 96) / level.height);
  if (state.cameraMode === 'full' || state.mode !== 'playing') return { x: 0, y: 0, scale: fullScale, w: VIRTUAL_W, h: VIRTUAL_H };
  const focus = state.players[state.focusIndex]?.ball.pos ?? level.starts[0];
  const scale = Math.min(1.05, Math.max(fullScale, 0.78));
  const viewW = VIRTUAL_W / scale;
  const viewH = VIRTUAL_H / scale;
  return {
    x: Math.max(0, Math.min(level.width - viewW, focus.x - viewW * 0.45)),
    y: Math.max(0, Math.min(level.height - viewH, focus.y - viewH * 0.58)),
    scale, w: VIRTUAL_W, h: VIRTUAL_H,
  };
}

function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera) {
  ctx.translate(0, 0);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);
}

function drawBackground(ctx: CanvasRenderingContext2D, state: GameState) {
  const g = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
  g.addColorStop(0, '#7bd5ff'); g.addColorStop(0.55, '#d7f4ff'); g.addColorStop(1, '#fff0b8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 7; i += 1) {
    const x = ((state.time * 13 + i * 230) % 1500) - 160;
    const y = 54 + (i % 3) * 42;
    ctx.beginPath(); ctx.ellipse(x, y, 64, 18, 0, 0, Math.PI * 2); ctx.ellipse(x + 52, y + 8, 52, 16, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D, state: GameState) {
  const { level } = state;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of level.terrain) {
    ctx.strokeStyle = '#2b7144'; ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y + 12); ctx.lineTo(s.b.x, s.b.y + 12); ctx.stroke();
    ctx.strokeStyle = s.color ?? '#46ad5f'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4; ctx.stroke();
  }
  for (const r of level.staticRects) {
    ctx.fillStyle = '#8d6e63'; rectPath(ctx, r, 6); ctx.fill();
    ctx.fillStyle = '#5fbf65'; ctx.fillRect(r.x, r.y, r.w, 8);
  }
}

function drawMechanics(ctx: CanvasRenderingContext2D, state: GameState) {
  const { level } = state;
  for (const fan of level.fans) {
    ctx.fillStyle = `${fan.color}55`; rectPath(ctx, fan.rect, 16); ctx.fill();
    ctx.strokeStyle = fan.color; ctx.lineWidth = 3; ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      const y = fan.rect.y + 22 + i * 24 + Math.sin(state.time * 7 + i) * 5;
      ctx.strokeStyle = `${fan.color}aa`; ctx.beginPath(); ctx.moveTo(fan.rect.x + 12, y); ctx.quadraticCurveTo(fan.rect.x + fan.rect.w / 2, y - 18, fan.rect.x + fan.rect.w - 12, y); ctx.stroke();
    }
  }
  for (const sw of level.switches) {
    ctx.fillStyle = sw.pressed ? sw.color : '#59485c';
    const y = sw.pressed ? sw.rect.y + 7 : sw.rect.y;
    rectPath(ctx, { ...sw.rect, y, h: sw.pressed ? 9 : sw.rect.h }, 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(sw.rect.x + 8, y + 3, sw.rect.w - 16, 3);
  }
  for (const gate of level.gates) {
    if (gate.kind === 'bridge' && !gate.open) {
      ctx.strokeStyle = `${gate.color}55`; ctx.setLineDash([10, 8]); ctx.strokeRect(gate.rect.x, gate.rect.y, gate.rect.w, gate.rect.h); ctx.setLineDash([]);
      continue;
    }
    const target = gate.open && gate.kind !== 'bridge' ? (gate.openOffset ?? { x: 0, y: -999 }) : { x: 0, y: 0 };
    const r = { x: gate.rect.x + target.x, y: gate.rect.y + target.y, w: gate.rect.w, h: gate.rect.h };
    ctx.fillStyle = gate.color; rectPath(ctx, r, gate.kind === 'gate' ? 5 : 10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = r.x + 12; x < r.x + r.w; x += 28) ctx.fillRect(x, r.y, 5, r.h);
    if (gate.open && gate.kind !== 'bridge') { ctx.strokeStyle = `${gate.color}55`; ctx.setLineDash([10, 8]); ctx.strokeRect(gate.rect.x, gate.rect.y, gate.rect.w, gate.rect.h); ctx.setLineDash([]); }
  }
  for (const h of level.hazards) {
    ctx.fillStyle = `${h.color}80`; rectPath(ctx, h.rect, 14); ctx.fill();
    ctx.strokeStyle = h.color; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`P${h.safePlayer + 1} safe`, h.rect.x + h.rect.w / 2, h.rect.y + h.rect.h / 2 + 6);
  }
  for (const b of level.bumpers) {
    const pulse = 1 + Math.sin(state.time * 6) * 0.06;
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.center.x, b.center.y, b.radius * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(b.center.x - b.radius * 0.28, b.center.y - b.radius * 0.28, b.radius * 0.26, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHole(ctx: CanvasRenderingContext2D, state: GameState) {
  const h = state.level.hole;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(h.x, h.y + 8, 32, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3b2d1f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(h.x + 18, h.y + 6); ctx.lineTo(h.x + 18, h.y - 72); ctx.stroke();
  ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.moveTo(h.x + 20, h.y - 72); ctx.quadraticCurveTo(h.x + 68 + Math.sin(state.time * 5) * 6, h.y - 62, h.x + 20, h.y - 48); ctx.closePath(); ctx.fill();
}

function drawPlayers(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const p of state.players) {
    const b = p.ball;
    if (!b.inHole) {
      const bob = Math.sin(state.time * 5 + p.id) * 3;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(b.pos.x - 23, b.pos.y - b.radius - 18 + bob, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = p.accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(b.pos.x - 23, b.pos.y - b.radius - 8 + bob); ctx.lineTo(b.pos.x - 17, b.pos.y - b.radius + 14 + bob); ctx.moveTo(b.pos.x - 18, b.pos.y - b.radius + 2 + bob); ctx.lineTo(b.pos.x + 2, b.pos.y - b.radius + 4 + bob); ctx.stroke();
    }
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < b.trail.length; i += 1) {
      const t = b.trail[i]; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(t.x, t.y, (i / b.trail.length) * 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!b.inHole) {
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#12233f'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(p.id + 1), b.pos.x, b.pos.y + 5);
    }
  }
}

function drawAim(ctx: CanvasRenderingContext2D, state: GameState) {
  if (state.mode !== 'playing' || state.shotInMotion) return;
  const p = state.players[state.activePlayer]; if (!p || p.ball.inHole) return;
  const b = p.ball; const a = (-state.angle * Math.PI) / 180; const length = 35 + state.power * 1.2;
  ctx.strokeStyle = p.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(b.pos.x, b.pos.y); ctx.lineTo(b.pos.x + Math.cos(a) * length, b.pos.y + Math.sin(a) * length); ctx.stroke();
  const arc = predictArc(state);
  ctx.fillStyle = 'rgba(18,35,63,0.55)';
  arc.forEach((pt, i) => { if (i % 3 === 0) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill(); } });
}

function drawParticles(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(12, 24, 46, 0.76)'; rectPath(ctx, { x, y, w, h }, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState) {
  panel(ctx, 18, 16, 1244, 92);
  const p = state.players[state.activePlayer];
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 24px sans-serif'; ctx.fillText(`Golf Siege · ${state.level.name}`, 38, 49);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#dbeafe'; ctx.fillText(state.level.subtitle, 38, 78);
  if (p) {
    ctx.fillStyle = p.color; ctx.font = 'bold 19px sans-serif'; ctx.fillText(`Turn: P${p.id + 1}`, 520, 48);
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.fillText(`Angle ${Math.round(state.angle)}°  Power ${Math.round(state.power)}  Wind ${state.level.wind > 0 ? '→' : '←'} ${Math.abs(state.level.wind)}`, 520, 77);
  }
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#e0f2fe'; ctx.fillText('Aim: ←/→ or A/D · Power: ↑/↓ or W/S · Space shoot/continue · R reset · Tab camera', 760, 48);
  ctx.fillText(state.message, 760, 77);

  panel(ctx, 18, 118, 178, 42 + state.players.length * 34);
  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('Scoreboard', 34, 145);
  state.players.forEach((pl, i) => {
    ctx.fillStyle = pl.color; ctx.beginPath(); ctx.arc(40, 174 + i * 32, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif'; ctx.fillText(`P${pl.id + 1}: ${pl.ball.strokes}${pl.ball.inHole ? ' ✓' : ''}`, 58, 179 + i * 32);
  });
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState) {
  if (state.mode === 'playing') return;
  ctx.fillStyle = 'rgba(6, 16, 33, 0.62)'; ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  panel(ctx, 290, 110, 700, state.mode === 'start' ? 500 : 430);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 58px sans-serif'; ctx.fillText('Golf Siege', 640, 190);
  ctx.font = '20px sans-serif'; ctx.fillStyle = '#dbeafe';
  if (state.mode === 'start') {
    ctx.fillText('A co-op artillery golf prototype for 1-4 local players.', 640, 230);
    ctx.fillText('Choose a team size with number keys, then press Space.', 640, 270);
    for (let i = 1; i <= 4; i += 1) {
      const x = 350 + i * 118; const selected = state.playerCount === i;
      ctx.fillStyle = selected ? playerColors[i - 1].color : 'rgba(255,255,255,0.14)'; rectPath(ctx, { x, y: 315, w: 88, h: 86 }, 18); ctx.fill();
      ctx.fillStyle = selected ? '#12233f' : '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.fillText(String(i), x + 44, 367);
      ctx.font = '13px sans-serif'; ctx.fillText(`key ${i}`, x + 44, 394);
    }
    ctx.fillStyle = '#fff'; ctx.font = '17px sans-serif'; ctx.fillText('Co-op mechanics: switches open bridges, player-colored hazards, moving platforms, fans, and bumpers.', 640, 470);
    ctx.fillText('No external assets: everything is drawn with canvas shapes.', 640, 505);
  } else {
    const title = state.mode === 'campaignComplete' ? 'Campaign Complete!' : 'Level Complete!';
    ctx.fillText(title, 640, 245);
    const y0 = 300;
    state.players.forEach((p, i) => {
      ctx.fillStyle = p.color; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`Player ${i + 1}: ${p.ball.strokes} strokes`, 640, y0 + i * 36);
    });
    ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif';
    ctx.fillText(state.mode === 'campaignComplete' ? 'Press Space to view the final screen again or R to replay this level.' : 'Press Space for the next level, or R to replay.', 640, 500);
  }
}

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  ctx.save(); ctx.scale(width / VIRTUAL_W, height / VIRTUAL_H); ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
  drawBackground(ctx, state);
  const cam = worldCamera(state);
  ctx.save(); applyCamera(ctx, cam);
  drawTerrain(ctx, state); drawMechanics(ctx, state); drawHole(ctx, state); drawAim(ctx, state); drawPlayers(ctx, state); drawParticles(ctx, state);
  ctx.restore();
  if (state.mode === 'playing') drawHud(ctx, state);
  drawOverlay(ctx, state);
  ctx.restore();
}
