import { levels } from './levels';
import { BALL_RADIUS, clamp, updateBall, updateSwitches } from './physics';
import { consumePressed } from './input';
import type { GameState, InputState, Player } from './types';

const COLORS = ['#ff5c7c', '#50b7ff', '#49df78', '#ffd34f'];
const COLOR_KEYS = ['red', 'blue', 'green', 'gold'] as const;

export function createGame(playerCount = 2, levelIndex = 0): GameState {
  const level = structuredClone(levels[levelIndex]);
  const players: Player[] = Array.from({ length: playerCount }, (_, id) => ({
    id,
    name: `Player ${id + 1}`,
    color: COLORS[id],
    colorKey: COLOR_KEYS[id],
    ball: { pos: { ...level.starts[id] }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS, moving: false, inHole: false, onGround: false, trail: [] },
    strokes: 0,
    angle: 42,
    power: 54,
  }));
  return {
    mode: 'start',
    levelIndex,
    level,
    playerCount,
    players,
    activePlayer: 0,
    camera: { x: 0, y: 0, zoom: 1, mode: 'full' },
    particles: [],
    shotInFlight: false,
    time: 0,
    message: 'Choose 1–4 golfers to begin.',
  };
}

export function startGame(count: number) {
  const game = createGame(count, 0);
  game.mode = 'playing';
  game.message = levels[0].parHint;
  return game;
}

export function resetLevel(state: GameState) {
  const next = createGame(state.playerCount, state.levelIndex);
  next.mode = 'playing';
  next.camera.mode = state.camera.mode;
  next.message = next.level.parHint;
  return next;
}

export function nextLevel(state: GameState) {
  if (state.levelIndex >= levels.length - 1) {
    return { ...state, mode: 'finished' as const, message: 'The siege is won!' };
  }
  const next = createGame(state.playerCount, state.levelIndex + 1);
  next.mode = 'playing';
  next.message = next.level.parHint;
  return next;
}

export function updateGame(state: GameState, input: InputState, dt: number, viewport: { w: number; h: number }) {
  state.time += dt;
  if (consumePressed(input, 'r')) return resetLevel(state);
  if (consumePressed(input, 'Tab')) state.camera.mode = state.camera.mode === 'full' ? 'follow' : 'full';
  if (state.mode === 'levelComplete' && (consumePressed(input, 'Space') || consumePressed(input, 'Enter'))) return nextLevel(state);
  if (state.mode !== 'playing') return state;

  const active = state.players[state.activePlayer];
  if (!state.shotInFlight && active && !active.ball.inHole) {
    const angleDir = (input.keys.has('ArrowRight') || input.keys.has('d') ? 1 : 0) - (input.keys.has('ArrowLeft') || input.keys.has('a') ? 1 : 0);
    const powerDir = (input.keys.has('ArrowUp') || input.keys.has('w') ? 1 : 0) - (input.keys.has('ArrowDown') || input.keys.has('s') ? 1 : 0);
    active.angle = clamp(active.angle + angleDir * 80 * dt, 5, 175);
    active.power = clamp(active.power + powerDir * 58 * dt, 12, 100);
    if (consumePressed(input, 'Space')) shoot(active, state);
  }

  let anyMoving = false;
  for (const player of state.players) {
    if (player.ball.moving || Math.hypot(player.ball.vel.x, player.ball.vel.y) > 0) updateBall(player, state.level, dt);
    anyMoving = anyMoving || player.ball.moving;
  }
  updateSwitches(state.level, state.players);
  updateParticles(state, dt);

  if (state.shotInFlight && !anyMoving) {
    state.shotInFlight = false;
    state.activePlayer = findNextPlayer(state, state.activePlayer + 1);
  }
  if (state.players.every((p) => p.ball.inHole)) {
    state.mode = 'levelComplete';
    state.message = state.levelIndex === levels.length - 1 ? 'All balls sunk. Final scores!' : 'Level clear! Press Space for the next course.';
  }
  updateCamera(state, viewport);
  return state;
}

function shoot(player: Player, state: GameState) {
  const radians = (player.angle * Math.PI) / 180;
  player.ball.vel = { x: Math.cos(radians) * player.power * 7.2, y: -Math.sin(radians) * player.power * 7.2 };
  player.ball.moving = true;
  player.ball.trail = [];
  player.strokes += 1;
  state.shotInFlight = true;
  for (let i = 0; i < 12; i += 1) {
    state.particles.push({ pos: { ...player.ball.pos }, vel: { x: -Math.cos(radians) * (40 + Math.random() * 90), y: Math.sin(radians) * (20 + Math.random() * 80) - 30 }, life: 0.45 + Math.random() * 0.25, color: player.color, size: 2 + Math.random() * 4 });
  }
}

function findNextPlayer(state: GameState, start: number) {
  for (let i = 0; i < state.players.length; i += 1) {
    const index = (start + i) % state.players.length;
    if (!state.players[index].ball.inHole) return index;
  }
  return state.activePlayer;
}

function updateParticles(state: GameState, dt: number) {
  for (const p of state.particles) {
    p.life -= dt;
    p.vel.y += 520 * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function updateCamera(state: GameState, viewport: { w: number; h: number }) {
  if (state.camera.mode === 'full') {
    state.camera.zoom = Math.min(viewport.w / state.level.width, viewport.h / state.level.height) * 0.94;
    state.camera.x = (viewport.w / state.camera.zoom - state.level.width) / -2;
    state.camera.y = (viewport.h / state.camera.zoom - state.level.height) / -2;
    return;
  }
  const focus = state.players[state.activePlayer]?.ball.pos ?? state.level.hole;
  const targetZoom = Math.min(1.05, Math.max(0.65, viewport.w / 950));
  state.camera.zoom += (targetZoom - state.camera.zoom) * 0.08;
  const viewW = viewport.w / state.camera.zoom;
  const viewH = viewport.h / state.camera.zoom;
  const targetX = clamp(focus.x - viewW / 2, 0, Math.max(0, state.level.width - viewW));
  const targetY = clamp(focus.y - viewH / 2, 0, Math.max(0, state.level.height - viewH));
  state.camera.x += (targetX - state.camera.x) * 0.08;
  state.camera.y += (targetY - state.camera.y) * 0.08;
}
