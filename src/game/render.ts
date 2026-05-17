import { activeBall, activeGolfer, aimArc, dynamicRects } from './engine';
import { drawMarioBlock } from './terrain';
import { Ball, GameState, Golfer, Rect } from './types';

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
  ctx.fillStyle = '#0c0e18';
  ctx.fillRect(0, 0, state.level.width, state.level.height + 200);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < state.level.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.level.height + 200);
    ctx.stroke();
  }
  for (let y = 0; y < state.level.height + 200; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.level.width, y);
    ctx.stroke();
  }

  for (const block of state.level.blocks) drawMarioBlock(ctx, block);
  drawRamps(ctx, state);
  drawHoleCup(ctx, state);
  drawSwitches(ctx, state);
  for (const rect of dynamicRects(state)) drawRectMechanic(ctx, rect, state.time);

  for (const ball of state.balls) drawBall(ctx, ball);
  for (const golfer of state.golfers) {
    const ball = state.balls[golfer.playerId];
    if (!ball?.sunk) drawGolfer(ctx, golfer, ball, state);
  }
}

function drawRamps(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.lineCap = 'round';
  for (const seg of state.level.segments) {
    if (seg.kind !== 'ramp') continue;
    ctx.strokeStyle = '#5cb838';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
    ctx.strokeStyle = '#8b5528';
    ctx.lineWidth = 6;
    ctx.stroke();
  }
}

function drawRectMechanic(ctx: CanvasRenderingContext2D, rect: Rect, time: number) {
  ctx.save();
  const round = Math.min(12, rect.h / 2);
  if (rect.kind === 'hazard') {
    const colors = { red: '#ff4f6d', blue: '#46b7ff', green: '#6bed77', gold: '#ffe066' };
    ctx.fillStyle = colors[rect.color ?? 'gold'];
    ctx.shadowColor = colors[rect.color ?? 'gold'];
    ctx.shadowBlur = 14;
  } else if (rect.kind === 'sand') ctx.fillStyle = '#e8c779';
  else if (rect.kind === 'spring') ctx.fillStyle = '#ff85e1';
  else if (rect.kind === 'fan') ctx.fillStyle = '#87f2ff';
  else if (rect.kind === 'bridge') ctx.fillStyle = '#7ed38a';
  else if (rect.kind === 'gate') ctx.fillStyle = '#6f6c8f';
  else ctx.fillStyle = '#ffb74f';
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, round);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (rect.kind === 'fan') {
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const y = rect.y + 18 + i * 24;
      ctx.beginPath();
      ctx.moveTo(rect.x + 12, y + Math.sin(time * 8 + i) * 4);
      ctx.quadraticCurveTo(rect.x + rect.w / 2, y - 18, rect.x + rect.w - 12, y);
      ctx.stroke();
    }
  }
  if (rect.label) label(ctx, rect.label, rect.x + rect.w / 2, rect.y - 8);
  ctx.restore();
}

function drawSwitches(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const sw of state.level.switches) {
    ctx.save();
    ctx.translate(sw.x, sw.y + (sw.pressed ? 5 : 0));
    ctx.fillStyle = sw.pressed ? '#49ef8f' : '#f5e56b';
    roundedRect(ctx, 0, 0, sw.w, sw.h, 6);
    ctx.fill();
    ctx.strokeStyle = '#604b2d';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, sw.label, sw.w / 2, -6);
    ctx.restore();
  }
}

function drawHoleCup(ctx: CanvasRenderingContext2D, state: GameState) {
  const { hole } = state.level;
  const rim = hole.rimY;
  const depth = hole.depth;

  ctx.fillStyle = '#1a1208';
  ctx.beginPath();
  ctx.ellipse(hole.x, rim + depth * 0.35, hole.radius * 1.1, depth * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.moveTo(hole.x - hole.radius, rim);
  ctx.lineTo(hole.x - hole.radius * 0.65, rim + depth);
  ctx.lineTo(hole.x + hole.radius * 0.65, rim + depth);
  ctx.lineTo(hole.x + hole.radius, rim);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#5cb838';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(hole.x, rim + 2, hole.radius, 6, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hole.x + 6, rim);
  ctx.lineTo(hole.x + 6, rim - 52);
  ctx.stroke();
  ctx.fillStyle = '#ff6868';
  ctx.beginPath();
  ctx.moveTo(hole.x + 8, rim - 52);
  ctx.quadraticCurveTo(hole.x + 44, rim - 46 + Math.sin(state.time * 5) * 3, hole.x + 10, rim - 32);
  ctx.closePath();
  ctx.fill();
}

function drawGolfer(ctx: CanvasRenderingContext2D, golfer: Golfer, ball: Ball, state: GameState) {
  const isActive = activeGolfer(state)?.playerId === golfer.playerId && state.phase === 'aiming';
  const bob = isActive ? Math.sin(state.time * 4) * 1.5 : 0;
  const x = golfer.pos.x;
  const y = golfer.pos.y + bob;

  ctx.save();
  ctx.strokeStyle = ball.color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 12, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 20);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x - 12, y + 14);
  ctx.moveTo(x, y + 5);
  ctx.lineTo(x + 11, y + 14);
  ctx.moveTo(x, y + 20);
  ctx.lineTo(x - 8, y + 34);
  ctx.moveTo(x, y + 20);
  ctx.lineTo(x + 8, y + 34);
  ctx.stroke();

  const clubX = x + golfer.facing * 28;
  ctx.strokeStyle = '#3b2d27';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + golfer.facing * 10, y + 6);
  ctx.lineTo(clubX, y + 26);
  ctx.stroke();

  if (isActive && golfer.ready) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 8, 22, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isActive && !golfer.ready) {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('…', x, y - 22);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  if (ball.trail.length > 2 && !ball.sunk) {
    for (let i = 0; i < ball.trail.length; i += 1) {
      const p = ball.trail[i];
      ctx.globalAlpha = (i / ball.trail.length) * 0.3;
      ctx.fillStyle = ball.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.radius * (i / ball.trail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (ball.sunk) return;
  if (ball.sinking) {
    ctx.globalAlpha = Math.max(0.25, 1 - ball.sinkT * 1.4);
  }
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
  ctx.globalAlpha = 1;
}

function drawAim(ctx: CanvasRenderingContext2D, state: GameState) {
  if (state.phase !== 'aiming') return;
  const ball = activeBall(state);
  const golfer = activeGolfer(state);
  if (!ball || !golfer?.ready) return;
  const arc = aimArc(state);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const [i, p] of arc.entries()) {
    if (p.y > state.level.height + 80) continue;
    ctx.globalAlpha = 1 - i / arc.length;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ball.color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(ball.pos.x, ball.pos.y);
  ctx.lineTo(
    ball.pos.x + Math.cos(state.angle) * (30 + state.power * 0.6),
    ball.pos.y + Math.sin(state.angle) * (30 + state.power * 0.6),
  );
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
  panel(ctx, 18, 16, 400, 136);
  const active = activeBall(state);
  const golfer = activeGolfer(state);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px system-ui';
  ctx.fillText(`Golf Siege — ${state.level.name}`, 34, 46);
  ctx.font = '14px system-ui';
  ctx.fillText(state.level.subtitle, 34, 70);
  ctx.fillText(`Wind: ${state.level.wind > 0 ? '→' : '←'} ${Math.abs(state.level.wind).toFixed(0)}   Camera: ${state.cameraMode}`, 34, 94);
  if (active) {
    ctx.fillStyle = active.color;
    const ready = golfer?.ready ? 'at ball' : 'walking…';
    ctx.fillText(
      `Turn: P${active.playerId + 1} (${ready})  Angle: ${Math.round((-state.angle * 180) / Math.PI)}°  Power: ${Math.round(state.power)}`,
      34,
      121,
    );
  }
  panel(ctx, width - 320, 16, 300, 34 + state.balls.length * 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 17px system-ui';
  ctx.fillText('Scoreboard', width - 300, 42);
  ctx.font = '14px system-ui';
  state.balls.forEach((ball, i) => {
    ctx.fillStyle = ball.color;
    ctx.fillText(`P${i + 1} ${ball.sunk ? '✓ in cup' : ball.safeColor} — ${ball.strokes} strokes`, width - 300, 69 + i * 28);
  });
  panel(ctx, 18, height - 78, Math.min(920, width - 36), 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px system-ui';
  ctx.fillText('A/D aim • W/S power • Space shoot (when at ball) • R reset • Tab camera', 34, height - 48);
  ctx.fillStyle = '#b8c8e8';
  ctx.fillText(state.level.hint, 34, height - 27);
}

function drawStart(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  ctx.fillStyle = '#0c0e18';
  ctx.fillRect(0, 0, width, height);
  panel(ctx, width / 2 - 330, height / 2 - 210, 660, 420);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '900 64px system-ui';
  ctx.fillText('Golf Siege', width / 2, height / 2 - 116);
  ctx.font = '20px system-ui';
  ctx.fillText('Co-op artillery golf on floating Mario-style platforms.', width / 2, height / 2 - 70);
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
  ctx.fillStyle = '#b8c8e8';
  ctx.font = '16px system-ui';
  ctx.fillText('Press 1–4 to start. Walk to your ball, then aim and shoot.', width / 2, height / 2 + 154);
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
  ctx.fillStyle = '#b8c8e8';
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
  ctx.fillText('All courses complete. Thanks for playing!', width / 2, height / 2 - 12);
  ctx.fillStyle = '#b8c8e8';
  ctx.fillText('Press Space or Enter to restart.', width / 2, height / 2 + 48);
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
