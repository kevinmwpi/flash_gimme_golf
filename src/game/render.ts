import { activeBall, activeGolfer, aimArc, dynamicRects, getCampaignLeaderboard } from './engine';
import { drawTerrain } from './terrain';
import { Ball, GameState, Golfer, Rect } from './types';

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (state.phase === 'start') return drawStart(ctx, state, width, height);
  if (state.phase === 'campaignComplete') return drawCampaignComplete(ctx, state, width, height);

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

  drawTerrain(ctx, state.level.terrain);
  drawPlatforms(ctx, state);
  drawHoleCup(ctx, state);
  drawSwitches(ctx, state);
  for (const rect of dynamicRects(state)) drawRectMechanic(ctx, rect, state.time);

  for (const ball of state.balls) drawBall(ctx, ball);
  for (const golfer of state.golfers) {
    const ball = state.balls[golfer.playerId];
    if (!ball?.sunk) drawGolfer(ctx, golfer, ball, state);
  }
}

function drawPlatforms(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.lineCap = 'round';
  for (const seg of state.level.segments) {
    if (seg.kind !== 'platform') continue;
    ctx.strokeStyle = '#5cb838';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
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
  ctx.fillText(`Flash Golf — ${state.level.name}`, 34, 46);
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

function drawStart(ctx: CanvasRenderingContext2D, _state: GameState, width: number, height: number) {
  ctx.fillStyle = '#0c0e18';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < width; gx += 80) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 0; gy < height; gy += 80) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  const panelW = Math.min(560, width - 48);
  const panelH = Math.min(400, height - 48);
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  const cx = width / 2;

  panel(ctx, panelX, panelY, panelW, panelH);

  const contentTop = panelY + 52;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.min(52, panelW * 0.09)}px system-ui`;
  ctx.fillText('Flash Golf', cx, contentTop);

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '17px system-ui';
  ctx.fillText('Co-op artillery golf', cx, contentTop + 44);
  ctx.fillText('Walk to your ball, aim, and shoot into the cup.', cx, contentTop + 68);

  ctx.fillStyle = '#fff';
  ctx.font = '700 20px system-ui';
  ctx.fillText('Players', cx, contentTop + 108);

  const colors = ['#ff5d73', '#50b7ff', '#72de72', '#ffd75c'];
  const btnW = Math.min(96, (panelW - 80) / 4);
  const btnH = 72;
  const gap = Math.max(10, (panelW - 48 - btnW * 4) / 3);
  const rowW = btnW * 4 + gap * 3;
  let btnX = cx - rowW / 2;
  const btnY = contentTop + 132;

  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = colors[i];
    roundedRect(ctx, btnX, btnY, btnW, btnH, 14);
    ctx.fill();
    ctx.fillStyle = '#102033';
    ctx.font = '800 28px system-ui';
    ctx.fillText(String(i + 1), btnX + btnW / 2, btnY + btnH / 2 - 6);
    ctx.font = '12px system-ui';
    ctx.fillStyle = 'rgba(16,32,51,0.85)';
    ctx.fillText(i === 0 ? '1 player' : `${i + 1} players`, btnX + btnW / 2, btnY + btnH / 2 + 18);
    btnX += btnW + gap;
  }

  ctx.fillStyle = '#b8c8e8';
  ctx.font = '15px system-ui';
  ctx.fillText('Press 1, 2, 3, or 4 on your keyboard to begin', cx, panelY + panelH - 36);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
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
  ctx.fillStyle = '#0c0e18';
  ctx.fillRect(0, 0, width, height);

  const leaderboard = getCampaignLeaderboard(state);
  const rowH = 68;
  const headerH = 118;
  const tableHeaderH = 28;
  const footerH = 80;
  const panelW = Math.min(640, width - 48);
  const contentH = headerH + tableHeaderH + leaderboard.length * rowH + footerH;
  const panelH = Math.min(contentH, height - 40);
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  const cx = width / 2;

  panel(ctx, panelX, panelY, panelW, panelH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.font = '800 34px system-ui';
  ctx.fillText('All Courses Cleared!', cx, panelY + 28);
  ctx.font = '16px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('Final leaderboard — lowest total strokes wins', cx, panelY + 72);

  const tableTop = panelY + headerH;
  const colRank = panelX + 28;
  const colDot = panelX + 78;
  const colName = panelX + 100;
  const colTotal = panelX + panelW - 36;

  ctx.textAlign = 'left';
  ctx.font = '700 12px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('RANK', colRank, tableTop + 4);
  ctx.fillText('PLAYER', colName, tableTop + 4);
  ctx.textAlign = 'right';
  ctx.fillText('STROKES', colTotal, tableTop + 4);

  const firstRowY = tableTop + tableHeaderH;

  leaderboard.forEach((row, i) => {
    const rowY = firstRowY + i * rowH;
    const mainY = rowY + 16;
    const subY = rowY + 40;

    if (row.isWinner) {
      ctx.fillStyle = 'rgba(255, 215, 80, 0.1)';
      roundedRect(ctx, panelX + 14, rowY + 6, panelW - 28, rowH - 12, 12);
      ctx.fill();
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = row.isWinner ? '800 17px system-ui' : '600 16px system-ui';
    ctx.fillStyle = row.isWinner ? '#ffe066' : 'rgba(255,255,255,0.65)';
    const rankLabel = row.rank === 1 ? '1st' : row.rank === 2 ? '2nd' : row.rank === 3 ? '3rd' : `${row.rank}th`;
    ctx.fillText(rankLabel, colRank, mainY);

    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(colDot, mainY, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = row.isWinner ? '700 17px system-ui' : '600 16px system-ui';
    ctx.fillText(row.name, colName, mainY);

    if (row.isWinner) {
      ctx.fillStyle = 'rgba(255, 224, 102, 0.2)';
      const badgeW = 58;
      const badgeX = colName + 108;
      roundedRect(ctx, badgeX, mainY - 10, badgeW, 20, 8);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.font = '600 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Winner', badgeX + badgeW / 2, mainY);
      ctx.textAlign = 'left';
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = row.isWinner ? '#ffe066' : '#fff';
    ctx.font = row.isWinner ? '800 22px system-ui' : '700 18px system-ui';
    ctx.fillText(String(row.total), colTotal, mainY);

    const levelShort = ['Tutorial', 'Switch', 'Hazard'];
    const breakdown = row.perLevel
      .map((strokes, levelIndex) => `${levelShort[levelIndex] ?? `L${levelIndex + 1}`}: ${strokes}`)
      .join('   ·   ');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.font = '12px system-ui';
    ctx.fillText(breakdown, colName, subY);
  });

  const winners = leaderboard.filter((row) => row.isWinner);
  const footerTop = panelY + panelH - footerH + 12;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#b8c8e8';
  ctx.font = '15px system-ui';
  const winText =
    winners.length > 1
      ? `Tie — ${winners.map((w) => w.name).join(' & ')} at ${winners[0].total} strokes`
      : `${winners[0]?.name ?? 'Champion'} wins with ${winners[0]?.total ?? 0} total strokes`;
  ctx.fillText(winText, cx, footerTop);
  ctx.fillStyle = 'rgba(184,200,232,0.8)';
  ctx.font = '14px system-ui';
  ctx.fillText('Press Space or Enter to play again', cx, footerTop + 28);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
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
