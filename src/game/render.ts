import { activeBall, aimArc, dynamicRects } from './engine';
import { Ball, GameState, Rect } from './types';

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (state.phase === 'start') return drawStart(ctx, state, width, height);

  ctx.save();
  const scale = fitScale(state, width, height);
  const viewW = width / scale;
  const viewH = height / scale;
  const camX = state.cameraMode === 'overview' ? Math.max(0, (state.level.width - viewW) / 2) : state.camera.x;
  const camY = state.cameraMode === 'overview' ? Math.max(0, (state.level.height - viewH) / 2) : state.camera.y;
  ctx.scale(scale, scale);
  ctx.translate(-camX, -camY);

  drawWorld(ctx, state);
  drawAim(ctx, state);
  drawParticles(ctx, state);
  ctx.restore();

  drawHud(ctx, state, width, height);
  if (state.phase === 'levelComplete') drawLevelComplete(ctx, state, width, height);
  if (state.phase === 'campaignComplete') drawCampaignComplete(ctx, state, width, height);
}

function fitScale(state: GameState, width: number, height: number) {
  if (state.cameraMode === 'overview' || state.phase === 'levelComplete' || state.phase === 'campaignComplete') {
    return Math.min(width / state.level.width, height / state.level.height);
  }
  return Math.min(1.05, Math.max(0.82, Math.min(width / 1120, height / 680)));
}

function drawWorld(ctx: CanvasRenderingContext2D, state: GameState) {
  const sky = ctx.createLinearGradient(0, 0, 0, state.level.height);
  sky.addColorStop(0, state.level.skyTop);
  sky.addColorStop(1, state.level.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, state.level.width, state.level.height + 160);

  drawBackdrop(ctx, state);
  drawHole(ctx, state);
  drawSwitches(ctx, state);
  for (const rect of dynamicRects(state)) drawRectMechanic(ctx, rect, state.time);
  drawTerrain(ctx, state);
  drawPlayersAndBalls(ctx, state);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 8; i += 1) {
    const x = 110 + i * 280;
    const y = 130 + Math.sin(i * 1.3) * 25;
    ctx.fillStyle = i % 2 ? '#ffffff' : '#dff6ff';
    cloud(ctx, x, y, 70 + (i % 3) * 18);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(18, 34, 54, 0.18)';
  for (let x = -40; x < state.level.width; x += 240) {
    ctx.beginPath();
    ctx.moveTo(x, state.level.height);
    ctx.lineTo(x + 135, state.level.height - 210);
    ctx.lineTo(x + 300, state.level.height);
    ctx.fill();
  }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.32, 0, 0, Math.PI * 2);
  ctx.ellipse(x - size * 0.42, y + 5, size * 0.48, size * 0.26, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.48, y + 2, size * 0.44, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTerrain(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const seg of state.level.segments) {
    ctx.strokeStyle = seg.kind === 'platform' ? '#7e5d3f' : seg.kind === 'wall' ? '#5a4a55' : '#4c8a43';
    ctx.lineWidth = seg.kind === 'platform' ? 20 : 28;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
    ctx.strokeStyle = seg.kind === 'platform' ? '#cf965f' : '#83d369';
    ctx.lineWidth = seg.kind === 'platform' ? 8 : 10;
    ctx.stroke();
  }
}

function drawRectMechanic(ctx: CanvasRenderingContext2D, rect: Rect, time: number) {
  ctx.save();
  const round = Math.min(12, rect.h / 2);
  if (rect.kind === 'hazard') {
    const colors = { red: '#ff4f6d', blue: '#46b7ff', green: '#6bed77', gold: '#ffe066' };
    ctx.shadowColor = colors[rect.color ?? 'gold'];
    ctx.shadowBlur = 18;
    ctx.fillStyle = colors[rect.color ?? 'gold'];
  } else if (rect.kind === 'sand') ctx.fillStyle = '#e8c779';
  else if (rect.kind === 'spring') ctx.fillStyle = '#ff85e1';
  else if (rect.kind === 'fan') ctx.fillStyle = '#87f2ff';
  else if (rect.kind === 'bridge') ctx.fillStyle = '#7ed38a';
  else if (rect.kind === 'gate') ctx.fillStyle = '#6f6c8f';
  else ctx.fillStyle = '#ffb74f';
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, round);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (rect.kind === 'fan') {
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i += 1) {
      const y = rect.y + 18 + i * 24;
      ctx.beginPath();
      ctx.moveTo(rect.x + 12, y + Math.sin(time * 8 + i) * 4);
      ctx.quadraticCurveTo(rect.x + rect.w / 2, y - 20, rect.x + rect.w - 12, y);
      ctx.stroke();
    }
  }
  if (rect.label) label(ctx, rect.label, rect.x + rect.w / 2, rect.y - 8);
  ctx.restore();
}

function drawSwitches(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const sw of state.level.switches) {
    ctx.save();
    ctx.translate(sw.x, sw.y + (sw.pressed ? 6 : 0));
    ctx.fillStyle = sw.pressed ? '#49ef8f' : '#f5e56b';
    roundedRect(ctx, 0, 0, sw.w, sw.h, 7);
    ctx.fill();
    ctx.strokeStyle = '#604b2d';
    ctx.lineWidth = 3;
    ctx.stroke();
    label(ctx, sw.label, sw.w / 2, -7);
    ctx.restore();
  }
}

function drawHole(ctx: CanvasRenderingContext2D, state: GameState) {
  const { hole } = state.level;
  ctx.fillStyle = '#161923';
  ctx.beginPath();
  ctx.ellipse(hole.x, hole.y + 8, hole.radius * 1.35, hole.radius * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(hole.x + 8, hole.y + 5);
  ctx.lineTo(hole.x + 8, hole.y - 68);
  ctx.stroke();
  ctx.fillStyle = '#ff6868';
  ctx.beginPath();
  ctx.moveTo(hole.x + 10, hole.y - 68);
  ctx.quadraticCurveTo(hole.x + 54, hole.y - 61 + Math.sin(state.time * 5) * 4, hole.x + 14, hole.y - 42);
  ctx.closePath();
  ctx.fill();
}

function drawPlayersAndBalls(ctx: CanvasRenderingContext2D, state: GameState) {
  const active = activeBall(state);
  for (const ball of state.balls) {
    if (ball.sunk) continue;
    drawGolfer(ctx, ball, state.time, active?.playerId === ball.playerId && state.phase === 'aiming');
  }
  for (const ball of state.balls) drawBall(ctx, ball);
}

function drawGolfer(ctx: CanvasRenderingContext2D, ball: Ball, time: number, isActive: boolean) {
  const bob = Math.sin(time * 4 + ball.playerId) * 2;
  const x = ball.pos.x - 22;
  const y = ball.pos.y - ball.radius - 20 + bob;
  ctx.save();
  ctx.globalAlpha = ball.sunk ? 0.25 : 1;
  ctx.strokeStyle = ball.color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 12, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 20);
  ctx.moveTo(x, y + 5); ctx.lineTo(x - 12, y + 14);
  ctx.moveTo(x, y + 5); ctx.lineTo(x + 11, y + 14);
  ctx.moveTo(x, y + 20); ctx.lineTo(x - 8, y + 34);
  ctx.moveTo(x, y + 20); ctx.lineTo(x + 8, y + 34);
  ctx.stroke();
  ctx.strokeStyle = '#3b2d27';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 8); ctx.lineTo(x + 28, y + 28);
  ctx.stroke();
  if (isActive) {
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 8, 26 + Math.sin(time * 8) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  if (ball.trail.length > 2) {
    for (let i = 0; i < ball.trail.length; i += 1) {
      const p = ball.trail[i];
      ctx.globalAlpha = (i / ball.trail.length) * 0.35;
      ctx.fillStyle = ball.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.radius * (i / ball.trail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (ball.sunk) return;
  const grad = ctx.createRadialGradient(ball.pos.x - 4, ball.pos.y - 5, 2, ball.pos.x, ball.pos.y, ball.radius + 3);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, ball.color);
  grad.addColorStop(1, '#1d2438');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ball.pos.x, ball.pos.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAim(ctx: CanvasRenderingContext2D, state: GameState) {
  if (state.phase !== 'aiming') return;
  const ball = activeBall(state);
  if (!ball) return;
  const arc = aimArc(state);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const [i, p] of arc.entries()) {
    if (p.y > state.level.height + 80) continue;
    ctx.globalAlpha = 1 - i / arc.length;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ball.color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(ball.pos.x, ball.pos.y);
  ctx.lineTo(ball.pos.x + Math.cos(state.angle) * (34 + state.power * 0.65), ball.pos.y + Math.sin(state.angle) * (34 + state.power * 0.65));
  ctx.stroke();
}

function drawParticles(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.pos.x, particle.pos.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  if (state.phase === 'start') return;
  panel(ctx, 18, 16, 390, 136);
  const active = activeBall(state);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 23px system-ui';
  ctx.fillText(`Golf Siege — ${state.level.name}`, 34, 48);
  ctx.font = '14px system-ui';
  ctx.fillText(state.level.subtitle, 34, 72);
  ctx.fillText(`Wind: ${state.level.wind > 0 ? '→' : '←'} ${Math.abs(state.level.wind).toFixed(0)}   Camera: ${state.cameraMode}`, 34, 96);
  if (active) {
    ctx.fillStyle = active.color;
    ctx.fillText(`Turn: Player ${active.playerId + 1}    Angle: ${Math.round((-state.angle * 180) / Math.PI)}°    Power: ${Math.round(state.power)}`, 34, 121);
  }
  panel(ctx, width - 320, 16, 300, 34 + state.balls.length * 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 17px system-ui';
  ctx.fillText('Scoreboard', width - 300, 42);
  ctx.font = '14px system-ui';
  state.balls.forEach((ball, i) => {
    ctx.fillStyle = ball.color;
    ctx.fillText(`P${i + 1} ${ball.sunk ? '✓ sunk' : ball.safeColor + ' safe'} — ${ball.strokes} strokes`, width - 300, 69 + i * 28);
  });
  panel(ctx, 18, height - 78, Math.min(900, width - 36), 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px system-ui';
  ctx.fillText('Controls: A/D or ←/→ aim  •  W/S or ↑/↓ power  •  Space shoot/continue  •  R reset  •  Tab camera', 34, height - 48);
  ctx.fillStyle = '#d8f3ff';
  ctx.fillText(state.level.hint, 34, height - 27);
}

function drawStart(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#42b3ff'); grad.addColorStop(0.55, '#7557d8'); grad.addColorStop(1, '#151b32');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 18; i += 1) ctx.fillRect(i * 120 - 30, height - 130 - (i % 4) * 30, 80, 260);
  panel(ctx, width / 2 - 330, height / 2 - 210, 660, 420);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '900 68px system-ui';
  ctx.fillText('Golf Siege', width / 2, height / 2 - 116);
  ctx.font = '20px system-ui';
  ctx.fillText('A co-op artillery mini-golf prototype with strange terrain and teamwork switches.', width / 2, height / 2 - 70);
  ctx.font = '700 24px system-ui';
  ctx.fillText('Choose local players', width / 2, height / 2 - 12);
  for (let i = 1; i <= 4; i += 1) {
    const x = width / 2 - 220 + (i - 1) * 146;
    ctx.fillStyle = ['#ff5d73', '#50b7ff', '#72de72', '#ffd75c'][i - 1];
    roundedRect(ctx, x, height / 2 + 24, 108, 82, 18);
    ctx.fill();
    ctx.fillStyle = '#102033';
    ctx.font = '900 34px system-ui';
    ctx.fillText(String(i), x + 54, height / 2 + 73);
    ctx.font = '13px system-ui';
    ctx.fillText(`${i} player${i > 1 ? 's' : ''}`, x + 54, height / 2 + 96);
  }
  ctx.fillStyle = '#d8f3ff';
  ctx.font = '16px system-ui';
  ctx.fillText('Press number keys 1–4 to start. Original canvas art, no external assets.', width / 2, height / 2 + 154);
  ctx.textAlign = 'left';
}

function drawLevelComplete(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  panel(ctx, width / 2 - 250, height / 2 - 165, 500, 330);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '800 38px system-ui';
  ctx.fillText('Level Complete!', width / 2, height / 2 - 105);
  ctx.font = '18px system-ui';
  ctx.fillText(state.level.name, width / 2, height / 2 - 74);
  state.balls.forEach((ball, i) => {
    ctx.fillStyle = ball.color;
    ctx.font = '700 20px system-ui';
    ctx.fillText(`Player ${i + 1}: ${ball.strokes} strokes`, width / 2, height / 2 - 28 + i * 32);
  });
  ctx.fillStyle = '#d8f3ff';
  ctx.font = '17px system-ui';
  ctx.fillText('Press Space or Enter to continue', width / 2, height / 2 + 130);
  ctx.textAlign = 'left';
}

function drawCampaignComplete(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  panel(ctx, width / 2 - 260, height / 2 - 130, 520, 260);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '800 38px system-ui';
  ctx.fillText('Siege Cleared!', width / 2, height / 2 - 54);
  ctx.font = '18px system-ui';
  ctx.fillText('All prototype holes are complete. Thanks for playing!', width / 2, height / 2 - 12);
  ctx.fillStyle = '#d8f3ff';
  ctx.fillText('Press Space or Enter to restart from Tutorial Hills.', width / 2, height / 2 + 48);
  ctx.textAlign = 'left';
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(8, 15, 31, .76)';
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 11px system-ui';
  ctx.fillStyle = 'rgba(14,20,30,.72)';
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}
