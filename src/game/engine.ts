import { consume, isHeld } from './input';
import { InputState } from './types';
import { levels, playerColors, safeColors } from './levels';
import {
  burst,
  clamp,
  distance,
  isRectActive,
  predictArc,
  stepBall,
  updateGolferHandoff,
  updateSwitches,
} from './physics';
import { alignGolferToGround, placeBallOnSurface, placeGolferBesideBall } from './terrain';
import { Ball, GameState, Golfer, LeaderboardRow, Player } from './types';

const MIN_POWER = 10;
const MAX_POWER = 100;
const BALL_RADIUS = 12;
const TURN_HANDOFF_DURATION = 0.5;

export function createGameState(playerCount = 2, levelIndex = 0): GameState {
  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: i,
    name: `Player ${i + 1}`,
    color: playerColors[i],
    safeColor: safeColors[i],
    strokes: 0,
  }));
  const level = cloneLevel(levels[levelIndex]);
  const balls = spawnBalls(level, players);
  const golfers = spawnGolfers(level, balls);
  return {
    phase: 'start',
    playerCount,
    levelIndex,
    level,
    players,
    golfers,
    balls,
    activePlayerIndex: 0,
    angle: -Math.PI / 4,
    power: 48,
    camera: { x: 0, y: 0 },
    cameraMode: 'overview',
    particles: [],
    messageTimer: 0,
    turnHandoffLeft: 0,
    time: 0,
    campaignHistory: Array.from({ length: playerCount }, () => []),
  };
}

function spawnBalls(level: GameState['level'], players: Player[]): Ball[] {
  return players.map((player) => {
    const startX = level.starts[player.id]?.x ?? 100 + player.id * 40;
    const pos = placeBallOnSurface(level, startX, BALL_RADIUS);
    return {
      playerId: player.id,
      pos,
      prevPos: { ...pos },
      vel: { x: 0, y: 0 },
      radius: BALL_RADIUS,
      color: player.color,
      safeColor: player.safeColor,
      strokes: 0,
      sunk: false,
      asleep: true,
      sinking: false,
      sinkT: 0,
      trail: [],
    };
  });
}

function spawnGolfers(level: GameState['level'], balls: Ball[]): Golfer[] {
  return balls.map((ball) => {
    const beside = placeGolferBesideBall(ball.pos, 1);
    const pos = alignGolferToGround(level, beside, ball.radius);
    return { playerId: ball.playerId, pos, facing: 1, ready: true };
  });
}

export function startGame(playerCount: number) {
  const state = createGameState(playerCount, 0);
  state.phase = 'aiming';
  state.campaignHistory = Array.from({ length: playerCount }, () => []);
  return state;
}

function recordLevelScores(state: GameState) {
  state.players.forEach((player, i) => {
    if (!state.campaignHistory[i]) state.campaignHistory[i] = [];
    state.campaignHistory[i].push(player.strokes);
  });
}

export function getCampaignLeaderboard(state: GameState): LeaderboardRow[] {
  const rows: LeaderboardRow[] = state.players.map((player, i) => {
    const perLevel = state.campaignHistory[i] ?? [];
    const total = perLevel.reduce((sum, strokes) => sum + strokes, 0);
    return {
      rank: 0,
      playerId: player.id,
      name: player.name,
      color: player.color,
      total,
      perLevel,
      isWinner: false,
    };
  });
  rows.sort((a, b) => a.total - b.total || a.playerId - b.playerId);
  const best = rows[0]?.total ?? 0;
  rows.forEach((row, index) => {
    row.rank = index + 1;
    row.isWinner = row.total === best;
  });
  return rows;
}

export function resetLevel(state: GameState) {
  const fresh = createGameState(state.playerCount, state.levelIndex);
  fresh.campaignHistory = state.campaignHistory.map((scores) => [...scores]);
  fresh.phase = 'aiming';
  return fresh;
}

export function nextLevel(state: GameState) {
  recordLevelScores(state);
  if (state.levelIndex >= levels.length - 1) {
    return { ...state, phase: 'campaignComplete' as const };
  }
  const fresh = createGameState(state.playerCount, state.levelIndex + 1);
  fresh.campaignHistory = state.campaignHistory.map((scores) => [...scores]);
  fresh.phase = 'aiming';
  return fresh;
}

export function updateGame(state: GameState, input: InputState, dt: number, viewport: { x: number; y: number }) {
  state.time += dt;

  if (state.phase === 'start') {
    for (let n = 1; n <= 4; n += 1) {
      if (consume(input, String(n))) return startGame(n);
    }
    return state;
  }

  if (consume(input, 'r')) return resetLevel(state);
  if (consume(input, 'Tab')) state.cameraMode = state.cameraMode === 'overview' ? 'follow' : 'overview';

  if (state.phase === 'levelComplete') {
    if (consume(input, 'Enter') || consume(input, ' ')) return nextLevel(state);
  }
  if (state.phase === 'campaignComplete') {
    if (consume(input, 'Enter') || consume(input, ' ')) return startGame(state.playerCount);
  }

  if (state.phase === 'aiming') handleAiming(state, input, dt);
  if (state.phase === 'flying') handleFlight(state, dt);

  updateParticles(state, dt);
  updateCamera(state, viewport, dt);
  return state;
}

function handleAiming(state: GameState, input: InputState, dt: number) {
  const ball = activeBall(state);
  const golfer = activeGolfer(state);
  if (!ball || !golfer || ball.sunk) return;

  if (state.turnHandoffLeft > 0) {
    state.turnHandoffLeft = Math.max(0, state.turnHandoffLeft - dt);
    const progress = 1 - state.turnHandoffLeft / TURN_HANDOFF_DURATION;
    updateGolferHandoff(golfer, ball, state.level, progress);
  }

  const turnSpeed = 1.7;
  if (isHeld(input, 'ArrowLeft', 'a')) state.angle -= turnSpeed * dt;
  if (isHeld(input, 'ArrowRight', 'd')) state.angle += turnSpeed * dt;
  state.angle = clamp(state.angle, -Math.PI * 0.96, -0.05);
  if (isHeld(input, 'ArrowUp', 'w')) state.power += 54 * dt;
  if (isHeld(input, 'ArrowDown', 's')) state.power -= 54 * dt;
  state.power = clamp(state.power, MIN_POWER, MAX_POWER);

  if (consume(input, ' ') && golfer.ready) shoot(state);
}

function shoot(state: GameState) {
  const ball = activeBall(state);
  if (!ball || ball.sunk) return;
  const speed = state.power * 8.8;
  ball.vel = { x: Math.cos(state.angle) * speed, y: Math.sin(state.angle) * speed };
  ball.asleep = false;
  ball.strokes += 1;
  state.players[ball.playerId].strokes = ball.strokes;
  state.phase = 'flying';
  state.cameraMode = 'follow';
  state.turnHandoffLeft = 0;
  burst(state.particles, ball.pos, ball.color, 10);
}

function handleFlight(state: GameState, dt: number) {
  const ball = activeBall(state);
  if (!ball) return;
  stepBall(ball, state.level, Math.min(dt, 1 / 30), state.particles);
  updateSwitches(state.level, state.balls);
  if (ball.sunk || (ball.asleep && !ball.sinking)) {
    updateSwitches(state.level, state.balls);
    if (state.balls.every((item) => item.sunk)) {
      state.phase = 'levelComplete';
      state.cameraMode = 'overview';
      return;
    }
    advanceTurn(state);
  }
}

function advanceTurn(state: GameState) {
  for (let step = 1; step <= state.balls.length; step += 1) {
    const next = (state.activePlayerIndex + step) % state.balls.length;
    if (!state.balls[next].sunk) {
      state.activePlayerIndex = next;
      state.angle = -Math.PI / 4;
      state.power = clamp(state.power, MIN_POWER, MAX_POWER);
      state.phase = 'aiming';
      state.messageTimer = 0;
      state.turnHandoffLeft = TURN_HANDOFF_DURATION;
      const golfer = state.golfers[next];
      if (golfer) {
        golfer.handoffFrom = { ...golfer.pos };
        golfer.ready = false;
      }
      return;
    }
  }
}

function updateParticles(state: GameState, dt: number) {
  for (const particle of state.particles) {
    particle.life -= dt;
    particle.vel.y += 240 * dt;
    particle.pos.x += particle.vel.x * dt;
    particle.pos.y += particle.vel.y * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
  state.messageTimer = Math.max(0, state.messageTimer - dt);
}

function updateCamera(state: GameState, viewport: { x: number; y: number }, dt: number) {
  let target = { x: (state.level.width - viewport.x) / 2, y: (state.level.height - viewport.y) / 2 };
  if (state.cameraMode === 'follow') {
    const ball = activeBall(state) ?? state.balls[0];
    target = {
      x: clamp(ball.pos.x - viewport.x * 0.5, 0, Math.max(0, state.level.width - viewport.x)),
      y: clamp(ball.pos.y - viewport.y * 0.55, 0, Math.max(0, state.level.height - viewport.y)),
    };
  }
  const smooth = 1 - Math.pow(0.001, dt);
  state.camera.x += (target.x - state.camera.x) * smooth;
  state.camera.y += (target.y - state.camera.y) * smooth;
}

export function activeBall(state: GameState) {
  return state.balls[state.activePlayerIndex];
}

export function activeGolfer(state: GameState) {
  return state.golfers[state.activePlayerIndex];
}

export function aimArc(state: GameState) {
  const ball = activeBall(state);
  return ball ? predictArc(ball.pos, state.angle, state.power, state.level.wind) : [];
}

export function dynamicRects(state: GameState) {
  return state.level.rects.filter((rect) => isRectActive(rect, state.level)).map((rect) => {
    if (!rect.switchId || (!rect.vx && !rect.vy)) return rect;
    const pressed = state.level.switches.find((sw) => sw.id === rect.switchId)?.pressed ?? false;
    return pressed ? { ...rect, x: rect.x + (rect.vx ?? 0), y: rect.y + (rect.vy ?? 0) } : rect;
  });
}

export function cloneLevel(level: (typeof levels)[number]) {
  return JSON.parse(JSON.stringify(level)) as typeof level;
}

export function nearestBallToHole(state: GameState) {
  return state.balls.reduce(
    (best, ball) => (distance(ball.pos, state.level.hole) < distance(best.pos, state.level.hole) ? ball : best),
    state.balls[0],
  );
}
