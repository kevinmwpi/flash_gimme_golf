import { predictPath, rectToSegments } from './physics';
import { GameState, Player, Segment } from './types';

function world(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x, -state.camera.y);
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function strokeSegment(ctx: CanvasRenderingContext2D, segment: Segment) {
  ctx.strokeStyle = segment.color ?? '#46784f';
  ctx.lineWidth = segment.kind === 'terrain' ? 24 : 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(segment.a.x, segment.a.y);
  ctx.lineTo(segment.b.x, segment.b.y);
  ctx.stroke();
  if (segment.kind === 'terrain') {
    ctx.strokeStyle = '#82c46c';
    ctx.lineWidth = 7;
    ctx.stroke();
  }
}

function drawGolfer(ctx: CanvasRenderingContext2D, player: Player, time: number) {
  if (player.finished) return;
  const ball = player.ball;
  const bob = Math.sin(time * 4 + player.id) * 2;
  const x = ball.pos.x - 26;
  const y = ball.pos.y - 26 + bob;
  ctx.strokeStyle = '#233142';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 15); ctx.lineTo(x - 7, y + 37);
  ctx.moveTo(x, y + 15); ctx.lineTo(x + 7, y + 37);
  ctx.moveTo(x, y + 19); ctx.lineTo(x + 19, y + 28);
  ctx.moveTo(x + 17, y + 28); ctx.lineTo(x + 24, y + 44);
  ctx.stroke();
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(x, y + 4, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = player.accent;
  ctx.fillRect(x - 12, y + 12, 24, 17);
}

function drawBall(ctx: CanvasRenderingContext2D, player: Player) {
  const ball = player.ball;
  if (ball.sunk) return;
  for (let i = ball.trail.length - 1; i >= 0; i -= 1) {
    const p = ball.trail[i];
    ctx.globalAlpha = (ball.trail.length - i) / ball.trail.length * 0.22;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ball.radius * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const grad = ctx.createRadialGradient(ball.pos.x - 5, ball.pos.y - 5, 2, ball.pos.x, ball.pos.y, ball.radius + 4);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.34, player.accent);
  grad.addColorStop(1, player.color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ball.pos.x, ball.pos.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#162033';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawHole(ctx: CanvasRenderingContext2D, state: GameState) {
  const { hole } = state.level;
  ctx.fillStyle = '#09111d';
  ctx.beginPath();
  ctx.ellipse(hole.x, hole.y + 9, hole.radius * 1.25, hole.radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(hole.x + 14, hole.y + 4);
  ctx.lineTo(hole.x + 14, hole.y - 76);
  ctx.stroke();
  ctx.fillStyle = '#ffde59';
  ctx.beginPath();
  ctx.moveTo(hole.x + 16, hole.y - 74);
  ctx.quadraticCurveTo(hole.x + 66, hole.y - 62 + Math.sin(state.time * 6) * 4, hole.x + 16, hole.y - 48);
  ctx.closePath();
  ctx.fill();
}

function drawAim(ctx: CanvasRenderingContext2D, state: GameState) {
  const player = state.players[state.activePlayerIndex];
  if (state.shotInFlight || player.finished || state.mode !== 'playing') return;
  const ball = player.ball;
  const rad = (state.angle * Math.PI) / 180;
  const length = 38 + state.power * 0.9;
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.moveTo(ball.pos.x, ball.pos.y);
  ctx.lineTo(ball.pos.x + Math.cos(rad) * length, ball.pos.y - Math.sin(rad) * length);
  ctx.stroke();
  ctx.setLineDash([]);
  const path = predictPath(ball.pos, state.angle, state.power, state.level.wind);
  ctx.fillStyle = player.accent;
  path.forEach((p, i) => {
    ctx.globalAlpha = 1 - i / path.length;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawLevel(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, state.level.sky[0]);
  sky.addColorStop(1, state.level.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  world(ctx, state);
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  for (let x = 80; x < state.level.width; x += 210) {
    ctx.beginPath();
    ctx.ellipse(x, 115 + Math.sin(x) * 24, 54, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 45, 108, 38, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  state.level.terrain.forEach((segment) => strokeSegment(ctx, segment));
  for (const rect of state.level.rects) {
    if (rect.kind === 'bridge' && rect.active === false && rect.y > state.level.height - 200) continue;
    if (rect.kind === 'bumper' && rect.active === false) ctx.globalAlpha = 0.28;
    ctx.fillStyle = rect.color ?? '#94a3b8';
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.kind === 'hazard' ? 4 : 8);
    ctx.globalAlpha = 1;
    if (rect.kind === 'hazard') {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (let y = rect.y + 10; y < rect.y + rect.h; y += 22) ctx.fillRect(rect.x + 4, y, rect.w - 8, 4);
    }
  }
  for (const sw of state.level.switches) {
    ctx.fillStyle = sw.pressed ? '#b8f26a' : '#fb7185';
    drawRoundedRect(ctx, sw.x, sw.y + (sw.pressed ? 8 : 0), sw.w, sw.h - (sw.pressed ? 6 : 0), 8);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sw.label, sw.x + sw.w / 2, sw.y - 6);
  }
  drawHole(ctx, state);
  state.players.forEach((player) => drawGolfer(ctx, player, state.time));
  state.players.forEach((player) => drawBall(ctx, player));
  drawAim(ctx, state);
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.pos.x, particle.pos.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, width: number) {
  const active = state.players[state.activePlayerIndex];
  ctx.fillStyle = 'rgba(8, 13, 24, .72)';
  ctx.fillRect(16, 16, width - 32, 92);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${state.level.name}  •  ${active.name}`, 32, 46);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(`Angle ${Math.round(state.angle)}°   Power ${Math.round(state.power)}   Wind ${state.level.wind > 0 ? '→' : '←'} ${Math.abs(state.level.wind)}   ${state.message}`, 32, 72);
  ctx.fillText('Aim: arrows/WASD  •  Space: shoot/continue  •  R: reset  •  Tab: camera  •  1-4: new player count on menu', 32, 96);
  let x = width - 330;
  state.players.forEach((player) => {
    ctx.fillStyle = player.color;
    ctx.beginPath(); ctx.arc(x, 44, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`P${player.id + 1}: ${player.finished ? 'IN' : player.strokes}`, x + 14, 49);
    x += 76;
  });
}

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  drawLevel(ctx, state, width, height);
  if (state.mode !== 'menu') drawHud(ctx, state, width);
}
