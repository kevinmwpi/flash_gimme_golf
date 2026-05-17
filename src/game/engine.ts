import { isDown, wasPressed } from './input';
import { levels } from './levels';
import { isBallStopped, stepBall, stepParticles, updateSwitches } from './physics';
import { GameState, InputState, Level, Player } from './types';

const colors = [
  { color: '#ff5c8a', accent: '#ffd6e1', safe: '#ff5c8a' },
  { color: '#4cc9f0', accent: '#ddf8ff', safe: '#4cc9f0' },
  { color: '#9be564', accent: '#efffdc', safe: '#9be564' },
  { color: '#ffd166', accent: '#fff0bd', safe: '#ffd166' },
];

function cloneLevel(level: Level): Level {
  return JSON.parse(JSON.stringify(level)) as Level;
}

function createPlayers(playerCount: number, level: Level): Player[] {
  return Array.from({ length: playerCount }, (_, index) => {
    const spawn = level.spawns[index] ?? level.spawns[0];
    return {
      id: index,
      name: `Player ${index + 1}`,
      color: colors[index].color,
      accent: colors[index].accent,
      safeHazardColor: colors[index].safe,
      spawn,
      strokes: 0,
      finished: false,
      ball: {
        pos: { ...spawn },
        vel: { x: 0, y: 0 },
        radius: 13,
        playerId: index,
        moving: false,
        sunk: false,
        restingFrames: 40,
        trail: [],
      },
    };
  });
}

export function createGame(): GameState {
  const level = cloneLevel(levels[0]);
  return {
    mode: 'menu',
    playerCount: 2,
    levelIndex: 0,
    level,
    players: createPlayers(2, level),
    activePlayerIndex: 0,
    angle: 45,
    power: 58,
    camera: { x: 0, y: 0, zoom: 1, focusIndex: 0 },
    shotInFlight: false,
    particles: [],
    time: 0,
    message: 'Choose players to begin.',
  };
}

export function startGame(state: GameState, count: number) {
  state.playerCount = count;
  state.levelIndex = 0;
  loadLevel(state, 0);
  state.mode = 'playing';
}

export function loadLevel(state: GameState, levelIndex: number) {
  state.levelIndex = levelIndex;
  state.level = cloneLevel(levels[levelIndex]);
  state.players = createPlayers(state.playerCount, state.level);
  state.activePlayerIndex = 0;
  state.angle = 45;
  state.power = 58;
  state.shotInFlight = false;
  state.particles = [];
  state.camera = { x: 0, y: 0, zoom: 1, focusIndex: 0 };
  state.message = `${state.level.name}: ${state.level.subtitle}`;
}

function activePlayer(state: GameState) {
  return state.players[state.activePlayerIndex];
}

function nextUnfinishedIndex(state: GameState, from = state.activePlayerIndex + 1) {
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const index = (from + offset) % state.players.length;
    if (!state.players[index].finished) return index;
  }
  return state.activePlayerIndex;
}

function shoot(state: GameState) {
  const player = activePlayer(state);
  if (player.finished || player.ball.moving || state.shotInFlight) return;
  const rad = (state.angle * Math.PI) / 180;
  player.ball.vel.x = Math.cos(rad) * state.power * 8.2;
  player.ball.vel.y = -Math.sin(rad) * state.power * 8.2;
  player.ball.moving = true;
  player.ball.restingFrames = 0;
  player.ball.trail = [];
  player.strokes += 1;
  state.shotInFlight = true;
  state.camera.focusIndex = player.id;
  state.message = `${player.name} launched stroke ${player.strokes}.`;
}

function checkHole(state: GameState, player: Player) {
  const ball = player.ball;
  const hole = state.level.hole;
  if (ball.sunk) return;
  const dist = Math.hypot(ball.pos.x - hole.x, ball.pos.y - hole.y);
  const slowEnough = Math.hypot(ball.vel.x, ball.vel.y) < 85;
  if (dist < hole.radius + 9 && slowEnough) {
    ball.sunk = true;
    ball.moving = false;
    ball.vel = { x: 0, y: 0 };
    player.finished = true;
    state.message = `${player.name} dropped into the cup!`;
    for (let i = 0; i < 22; i += 1) {
      state.particles.push({ pos: { x: hole.x, y: hole.y }, vel: { x: (Math.random() - 0.5) * 180, y: -40 - Math.random() * 180 }, life: 0.8, color: player.color, size: 3 + Math.random() * 4 });
    }
  }
}

function updateCamera(state: GameState, canvasWidth: number, canvasHeight: number) {
  const level = state.level;
  const target = state.players[state.camera.focusIndex]?.ball.pos ?? activePlayer(state).ball.pos;
  const fullZoom = Math.min(canvasWidth / level.width, canvasHeight / level.height);
  const followZoom = Math.min(1.05, Math.max(fullZoom, 0.78));
  const zoom = state.shotInFlight ? followZoom : Math.min(1, Math.max(fullZoom, 0.72));
  state.camera.zoom += (zoom - state.camera.zoom) * 0.08;
  const viewW = canvasWidth / state.camera.zoom;
  const viewH = canvasHeight / state.camera.zoom;
  const desiredX = Math.max(0, Math.min(level.width - viewW, target.x - viewW * 0.48));
  const desiredY = Math.max(0, Math.min(level.height - viewH, target.y - viewH * 0.55));
  state.camera.x += (desiredX - state.camera.x) * 0.08;
  state.camera.y += (desiredY - state.camera.y) * 0.08;
}

export function updateGame(state: GameState, input: InputState, dt: number, canvasWidth: number, canvasHeight: number) {
  state.time += dt;

  if (state.mode === 'menu') {
    for (const key of ['1', '2', '3', '4']) if (wasPressed(input, key)) startGame(state, Number(key));
    return;
  }

  if (wasPressed(input, 'r', 'R')) loadLevel(state, state.levelIndex);
  if (wasPressed(input, 'Tab')) state.camera.focusIndex = (state.camera.focusIndex + 1) % state.players.length;

  if (state.mode === 'levelComplete' || state.mode === 'gameComplete') {
    if (wasPressed(input, ' ', 'Enter')) {
      if (state.levelIndex + 1 < levels.length) {
        loadLevel(state, state.levelIndex + 1);
        state.mode = 'playing';
      } else {
        state.mode = 'menu';
      }
    }
    updateCamera(state, canvasWidth, canvasHeight);
    return;
  }

  const player = activePlayer(state);
  if (!state.shotInFlight && !player.finished) {
    const turnSpeed = isDown(input, 'Shift') ? 95 : 55;
    if (isDown(input, 'ArrowLeft', 'a', 'A')) state.angle += turnSpeed * dt;
    if (isDown(input, 'ArrowRight', 'd', 'D')) state.angle -= turnSpeed * dt;
    if (isDown(input, 'ArrowUp', 'w', 'W')) state.power += 48 * dt;
    if (isDown(input, 'ArrowDown', 's', 'S')) state.power -= 48 * dt;
    state.angle = Math.max(5, Math.min(175, state.angle));
    state.power = Math.max(18, Math.min(100, state.power));
    if (wasPressed(input, ' ')) shoot(state);
  }

  for (const p of state.players) {
    stepBall(p.ball, state.level, dt, state.particles);
    checkHole(state, p);
  }
  updateSwitches(state.level, state.players.map((p) => p.ball));
  state.particles = stepParticles(state.particles, dt);

  if (state.shotInFlight) {
    const p = activePlayer(state);
    if (p.finished || isBallStopped(p.ball)) {
      state.shotInFlight = false;
      if (state.players.every((each) => each.finished)) {
        state.mode = state.levelIndex === levels.length - 1 ? 'gameComplete' : 'levelComplete';
      } else {
        state.activePlayerIndex = nextUnfinishedIndex(state);
        state.camera.focusIndex = state.activePlayerIndex;
        state.message = `${activePlayer(state).name}'s turn.`;
      }
    }
  }

  if (activePlayer(state).finished && !state.players.every((each) => each.finished)) {
    state.activePlayerIndex = nextUnfinishedIndex(state);
  }

  updateCamera(state, canvasWidth, canvasHeight);
}
