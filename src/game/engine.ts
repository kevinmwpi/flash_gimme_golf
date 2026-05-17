import { levels } from './levels';
import { applyFan, clamp, collideBallWithBumper, collideBallWithRect, collideBallWithSegment, dist, integrateBall, len, resolveHazard, updateRest } from './physics';
import { isDown, wasPressed } from './input';
import type { Ball, GameState, InputState, Level, Particle, Player, Rect, Vec } from './types';

export const playerColors = [
  { color: '#ff5a76', accent: '#ffd6de' },
  { color: '#4dabf7', accent: '#d0ebff' },
  { color: '#51cf66', accent: '#d3f9d8' },
  { color: '#ffd43b', accent: '#fff3bf' },
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function makeBall(pos: Vec, color: string): Ball {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, radius: 13, color, strokes: 0, inHole: false, stopped: true, trail: [], restTime: 0 };
}

function createPlayers(level: Level, count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Player ${i + 1}`,
    color: playerColors[i].color,
    accent: playerColors[i].accent,
    ball: makeBall(level.starts[i] ?? level.starts[0], playerColors[i].color),
  }));
}

export function createGame(playerCount = 2): GameState {
  const level = clone(levels[0]);
  return {
    mode: 'start', levelIndex: 0, playerCount, level, players: createPlayers(level, playerCount),
    activePlayer: 0, angle: 45, power: 58, shotInMotion: false, cameraMode: 'full', focusIndex: 0,
    time: 0, particles: [], message: 'Choose 1-4 players, then press Space to begin.',
  };
}

export function loadLevel(state: GameState, index: number, playerCount = state.playerCount): GameState {
  const level = clone(levels[index]);
  return { ...state, mode: 'playing', levelIndex: index, playerCount, level, players: createPlayers(level, playerCount), activePlayer: 0,
    angle: 45, power: 58, shotInMotion: false, focusIndex: 0, particles: [], message: level.subtitle };
}

function activePlayer(state: GameState) { return state.players[state.activePlayer]; }

function nextUnfinishedPlayer(state: GameState, from = state.activePlayer + 1) {
  for (let i = 0; i < state.players.length; i += 1) {
    const idx = (from + i) % state.players.length;
    if (!state.players[idx].ball.inHole) return idx;
  }
  return state.activePlayer;
}

function spawnImpact(state: GameState, pos: Vec, color: string, count = 8) {
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 120;
    state.particles.push({ pos: { ...pos }, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life: 0.55, maxLife: 0.55, color, size: 2 + Math.random() * 4 });
  }
}

function gateCollisionRects(state: GameState): Rect[] {
  return state.level.gates.flatMap((gate) => {
    if (gate.kind === 'bridge' && !gate.open) return [];
    const o = gate.open && gate.kind !== 'bridge' ? (gate.openOffset ?? { x: 0, y: -999 }) : { x: 0, y: 0 };
    return [{ x: gate.rect.x + o.x, y: gate.rect.y + o.y, w: gate.rect.w, h: gate.rect.h }];
  });
}

function updateSwitches(state: GameState) {
  for (const sw of state.level.switches) {
    sw.pressed = state.players.some(({ ball }) => !ball.inHole && ball.stopped && ball.pos.x > sw.rect.x - 10 && ball.pos.x < sw.rect.x + sw.rect.w + 10 && Math.abs(ball.pos.y + ball.radius - sw.rect.y) < 24);
  }
  for (const gate of state.level.gates) gate.open = state.level.switches.some((sw) => sw.targetId === gate.id && sw.pressed);
}

function shoot(state: GameState) {
  const player = activePlayer(state);
  if (!player || player.ball.inHole || state.shotInMotion || !player.ball.stopped) return;
  const radians = (-state.angle * Math.PI) / 180;
  const speed = 140 + state.power * 7.8;
  player.ball.vel = { x: Math.cos(radians) * speed, y: Math.sin(radians) * speed };
  player.ball.stopped = false;
  player.ball.restTime = 0;
  player.ball.strokes += 1;
  state.shotInMotion = true;
  state.focusIndex = player.id;
  spawnImpact(state, player.ball.pos, player.color, 14);
}

function resetBallIfLost(state: GameState, player: Player) {
  const b = player.ball;
  if (b.pos.y < state.level.height + 260 && b.pos.x > -220 && b.pos.x < state.level.width + 220) return;
  const start = state.level.starts[player.id] ?? state.level.starts[0];
  b.pos = { ...start }; b.vel = { x: 0, y: 0 }; b.stopped = true; b.restTime = 0;
  state.message = `${player.name} tumbled into the mist and was returned to the tee.`;
  spawnImpact(state, b.pos, player.color, 16);
}

function updateBall(state: GameState, player: Player, dt: number) {
  const b = player.ball;
  if (b.inHole) return;
  for (const fan of state.level.fans) applyFan(b, fan, dt);
  integrateBall(b, dt, state.level.wind);

  let collided = false;
  for (const s of state.level.terrain) collided = collideBallWithSegment(b, s) || collided;
  for (const rect of state.level.staticRects) collided = collideBallWithRect(b, rect) || collided;
  for (const rect of gateCollisionRects(state)) collided = collideBallWithRect(b, rect) || collided;
  for (const hazard of state.level.hazards) collided = resolveHazard(b, hazard, player.id) || collided;
  for (const bumper of state.level.bumpers) {
    const hit = collideBallWithBumper(b, bumper);
    if (hit) spawnImpact(state, b.pos, bumper.color, 10);
    collided = hit || collided;
  }
  if (collided) b.restTime = Math.min(b.restTime, 0.12);

  b.pos.x = clamp(b.pos.x, -100, state.level.width + 100);
  b.trail.push({ ...b.pos });
  if (b.trail.length > 28) b.trail.shift();

  if (dist(b.pos, state.level.hole) < 23 && len(b.vel) < 105) {
    b.inHole = true; b.stopped = true; b.vel = { x: 0, y: 0 }; b.pos = { ...state.level.hole };
    spawnImpact(state, b.pos, '#ffffff', 22);
    state.message = `${player.name} sank it in ${b.strokes} stroke${b.strokes === 1 ? '' : 's'}!`;
    return;
  }
  updateRest(b, dt);
  resetBallIfLost(state, player);
}

function updateParticles(state: GameState, dt: number) {
  for (const p of state.particles) { p.life -= dt; p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt; p.vel.y += 260 * dt; p.vel.x *= 0.98; }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function handleStartInput(state: GameState, input: InputState) {
  for (let i = 1; i <= 4; i += 1) if (wasPressed(input, String(i))) state.playerCount = i;
  if (wasPressed(input, ' ', 'Enter')) Object.assign(state, loadLevel(state, 0, state.playerCount));
}

function handlePlayingInput(state: GameState, input: InputState, dt: number) {
  if (wasPressed(input, 'r', 'R')) Object.assign(state, loadLevel(state, state.levelIndex, state.playerCount));
  if (wasPressed(input, 'Tab')) state.cameraMode = state.cameraMode === 'full' ? 'follow' : 'full';
  if (state.shotInMotion) return;
  if (isDown(input, 'ArrowLeft', 'a', 'A')) state.angle = clamp(state.angle + 85 * dt, 5, 175);
  if (isDown(input, 'ArrowRight', 'd', 'D')) state.angle = clamp(state.angle - 85 * dt, 5, 175);
  if (isDown(input, 'ArrowUp', 'w', 'W')) state.power = clamp(state.power + 70 * dt, 12, 100);
  if (isDown(input, 'ArrowDown', 's', 'S')) state.power = clamp(state.power - 70 * dt, 12, 100);
  if (wasPressed(input, ' ')) shoot(state);
}

function handleCompleteInput(state: GameState, input: InputState) {
  if (wasPressed(input, 'r', 'R')) Object.assign(state, loadLevel(state, state.levelIndex, state.playerCount));
  if (wasPressed(input, ' ', 'Enter')) {
    const next = state.levelIndex + 1;
    if (next >= levels.length) state.mode = 'campaignComplete';
    else Object.assign(state, loadLevel(state, next, state.playerCount));
  }
}

export function updateGame(state: GameState, input: InputState, rawDt: number) {
  const dt = Math.min(rawDt, 1 / 30);
  state.time += dt;
  if (state.mode === 'start') handleStartInput(state, input);
  if (state.mode === 'playing') handlePlayingInput(state, input, dt);
  if (state.mode === 'levelComplete' || state.mode === 'campaignComplete') handleCompleteInput(state, input);

  if (state.mode === 'playing') {
    updateSwitches(state);
    for (const player of state.players) updateBall(state, player, dt);
    updateSwitches(state);
    const current = activePlayer(state);
    if (state.shotInMotion && (!current || current.ball.stopped || current.ball.inHole)) {
      state.shotInMotion = false;
      state.activePlayer = nextUnfinishedPlayer(state);
      state.focusIndex = state.activePlayer;
    }
    if (state.players.every((p) => p.ball.inHole)) state.mode = 'levelComplete';
  }
  updateParticles(state, dt);
}

export function predictArc(state: GameState, steps = 54): Vec[] {
  const player = activePlayer(state);
  if (!player || player.ball.inHole) return [];
  const radians = (-state.angle * Math.PI) / 180;
  const speed = 140 + state.power * 7.8;
  const pos = { ...player.ball.pos };
  const vel = { x: Math.cos(radians) * speed, y: Math.sin(radians) * speed };
  const points: Vec[] = [];
  const dt = 1 / 24;
  for (let i = 0; i < steps; i += 1) {
    vel.x += state.level.wind * dt; vel.y += 620 * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt;
    points.push({ ...pos });
    if (pos.y > state.level.height + 60 || pos.x < 0 || pos.x > state.level.width) break;
  }
  return points;
}
