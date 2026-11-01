// OWNER: sim
/**
 * The rules (ARCH.md §1.5, BUILD_DECISIONS D10.4-D10.6). `stepSim` never mutates its input: every tick
 * builds a new SimState (sub-objects shared when unchanged) and a list of SimEvents stamped with the NEW
 * tick. Order per tick: commands -> physics for every ball -> switches (+ diff) -> flight watchdog ->
 * phase transitions (the WAITING-rule hand-off) -> turn-delay decrement -> flightTicks -> finiteness check.
 */
import { onCannonBreech, restEventOf, trapHolding, waitingOf, type Waiting } from './devices';
import { levelById } from './levels/index';
import { evaluateSwitches, isSettled, launchVelocity, stepBall, switchPresser, type StepBallOut } from './physics';
import { seedRng } from './rng';
import { clamp, collidersFor, groundAt, groundSupports, isPermanentRect, isRectActive, rectSwitchIds, solidColliders } from './terrain';
import type {
  BallState,
  CommandRejectReason,
  Level,
  LevelResult,
  MetaScreen,
  PlayerCommand,
  PlayerCommandType,
  PlayerId,
  PlayerState,
  ReplayEntry,
  SimConfig,
  SimEvent,
  SimEventBody,
  SimState,
  StepResult,
  Vec,
} from './types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  BACK_PENALTY,
  DEFAULT_AIM,
  FLIGHT_WATCHDOG_TICKS,
  MAX_POWER,
  MIN_POWER,
  REST_TICKS,
  SHOT_SPEED_PER_POWER,
  TURN_DELAY_TICKS,
  medalFor,
  quantize1,
  quantize4,
} from './types';

type Emit = (body: SimEventBody) => void;
type Players = [Readonly<PlayerState>, Readonly<PlayerState>];
type Balls = [Readonly<BallState>, Readonly<BallState>];

const SLOTS: readonly PlayerId[] = [0, 1];

// ---- initial state (physics-notes §6) --------------------------------------------------------------

function initialBall(start: Vec): BallState {
  return { pos: start, vel: { x: 0, y: 0 }, asleep: true, sunk: false, grounded: true, restTicks: REST_TICKS, lastRest: start };
}

function initialPlayer(): PlayerState {
  return { strokes: 0, aim: DEFAULT_AIM };
}

function initialSwitches(level: Level): Record<string, boolean> {
  const switches: Record<string, boolean> = {};
  for (const sw of level.switches) switches[sw.id] = false;
  return switches;
}

type LevelFields = Pick<SimState, 'players' | 'balls' | 'switches' | 'activePlayer' | 'flightTicks'>;

/** Balls at the tees, strokes 0, aims DEFAULT_AIM, switches all false, firstPlayer from the level (D2), no flight. */
function freshLevelFields(level: Level): LevelFields {
  return {
    players: [initialPlayer(), initialPlayer()],
    balls: [initialBall(level.starts[0]), initialBall(level.starts[1])],
    switches: initialSwitches(level),
    activePlayer: level.firstPlayer,
    flightTicks: 0,
  };
}

/** Phase 'intro', levelIndex 0, events [levelStart]; balls per physics-notes §6; firstPlayer from the level. */
export function createSim(config: SimConfig): StepResult {
  const levelId = config.levelIds[0];
  if (levelId === undefined) throw new Error('sim: config.levelIds is empty');
  const level = levelById(levelId);
  const state: SimState = {
    config,
    tick: 0,
    phase: 'intro',
    levelIndex: 0,
    levelId,
    ...freshLevelFields(level),
    turnDelayTicks: 0,
    rng: seedRng(config.seed),
    campaign: [],
  };
  const events: SimEvent[] = [
    { type: 'levelStart', levelId, levelIndex: 0, firstPlayer: level.firstPlayer, restarted: false, tick: 0 },
  ];
  return { state, events };
}

// ---- stepSim ---------------------------------------------------------------------------------------

/** Never mutates `state`. */
export function stepSim(state: SimState, commands: readonly PlayerCommand[]): StepResult {
  const tick = state.tick + 1;
  const events: SimEvent[] = [];
  const emit: Emit = (body) => {
    events.push({ ...body, tick });
  };
  const phaseAtStart = state.phase;
  // flightTicks is 0 outside 'flying' (an invariant decodeSnapshot enforces); never trust a stale count.
  const flownBefore = phaseAtStart === 'flying' ? state.flightTicks : 0;
  let next = state;
  for (const cmd of commands) next = applyCommand(next, cmd, emit);
  let switchesChanged = false;
  if (next.phase === 'aiming' || next.phase === 'flying') {
    const stepped = stepBalls(next, emit);
    next = stepped.state;
    switchesChanged = stepped.switchesChanged;
  }
  const watchdogFired = next.phase === 'flying' && flownBefore + 1 >= FLIGHT_WATCHDOG_TICKS;
  if (watchdogFired) {
    const timedOut = endFlight(next, emit);
    next = timedOut.state;
    switchesChanged = switchesChanged || timedOut.switchesChanged;
  }
  next = transition(next, switchesChanged, emit);
  if (phaseAtStart === 'aiming' && next.turnDelayTicks > 0 && !turnStartedThisTick(events)) {
    next = { ...next, turnDelayTicks: next.turnDelayTicks - 1 };
  }
  const flightTicks = next.phase === 'flying' && !watchdogFired ? flownBefore + 1 : 0;
  next = { ...next, tick, flightTicks };
  assertFinite(next);
  return { state: next, events };
}

/**
 * Rule 4 skips the decrement on a tick that (re)entered `aiming`, so `turnStart.readyInTicks` is what the
 * first observable state shows. The flying -> aiming hand-off is already exempt (phaseAtStart is `flying`);
 * this covers a host `restartLevel` issued while aiming, which resets the delay in the same tick.
 */
function turnStartedThisTick(events: readonly SimEvent[]): boolean {
  return events.some((e) => e.type === 'turnStart');
}

// ---- rule 1: commands -----------------------------------------------------------------------------

function applyCommand(state: SimState, cmd: PlayerCommand, emit: Emit): SimState {
  const seat = seatOf(state.config, cmd.playerId);
  const reject = (reason: CommandRejectReason): SimState => {
    emit({ type: 'commandRejected', command: cmd.type, playerId: cmd.playerId, reason });
    return state;
  };
  if (!allowedCommands(state, seat).includes(cmd.type)) return reject(rejectReason(state, cmd));
  switch (cmd.type) {
    case 'setAim': {
      if (cmd.playerId !== state.activePlayer) return reject('notActivePlayer');
      if (!Number.isFinite(cmd.angle) || !Number.isFinite(cmd.power)) return reject('outOfRange');
      return withAim(state, cmd.angle, cmd.power);
    }
    case 'shoot': {
      if (cmd.playerId !== state.activePlayer) return reject('notActivePlayer');
      if (!isShotReady(state)) return reject('turnDelay');
      return shoot(state, emit);
    }
    case 'continue':
      if (staleScreen(state, cmd)) return reject('wrongPhase');
      return state.phase === 'intro' ? startPlay(state, emit) : advanceLevel(state, emit);
    case 'restartLevel':
      if (staleScreen(state, cmd)) return reject('wrongPhase');
      return restartLevel(state, cmd.playerId, emit);
  }
}

/** A meta command stamped with a screen the sim has already left (ARCH.md §1.5 "first wins"). */
function staleScreen(state: SimState, screen: MetaScreen): boolean {
  if (screen.levelIndex !== undefined && screen.levelIndex !== state.levelIndex) return true;
  return screen.phase !== undefined && screen.phase !== state.phase;
}

function rejectReason(state: SimState, cmd: PlayerCommand): CommandRejectReason {
  switch (cmd.type) {
    case 'restartLevel':
      return state.phase === 'campaignResults' ? 'wrongPhase' : 'notHost';
    case 'setAim':
    case 'shoot':
      return state.phase === 'aiming' ? 'notActivePlayer' : 'wrongPhase';
    case 'continue':
      return 'wrongPhase';
  }
}

/** Quantised aim on the active player; no new object when unchanged (physics-notes §7). */
function withAim(state: SimState, rawAngle: number, rawPower: number): SimState {
  const angle = quantize4(clamp(rawAngle, AIM_ANGLE_MIN, AIM_ANGLE_MAX));
  const power = quantize1(clamp(rawPower, MIN_POWER, MAX_POWER));
  const p = state.activePlayer;
  const current = state.players[p].aim;
  if (current.angle === angle && current.power === power) return state;
  const players: Players = [state.players[0], state.players[1]];
  players[p] = { ...players[p], aim: { angle, power } };
  return { ...state, players };
}

function shoot(state: SimState, emit: Emit): SimState {
  const p = state.activePlayer;
  const aim = state.players[p].aim;
  const ball = state.balls[p];
  const balls: Balls = [state.balls[0], state.balls[1]];
  balls[p] = { ...ball, vel: launchVelocity(aim), asleep: false, restTicks: 0, grounded: false };
  const players: Players = [state.players[0], state.players[1]];
  players[p] = { ...players[p], strokes: players[p].strokes + 1 };
  emit({ type: 'ballHit', playerId: p, pos: ball.pos, angle: aim.angle, power: aim.power, speed: aim.power * SHOT_SPEED_PER_POWER });
  return { ...state, balls, players, phase: 'flying' };
}

function startPlay(state: SimState, emit: Emit): SimState {
  emit({ type: 'playStart', levelId: state.levelId });
  emit({ type: 'turnStart', playerId: state.activePlayer, readyInTicks: 0, sameAsBefore: false });
  return { ...state, phase: 'aiming', turnDelayTicks: 0 };
}

/** levelResults -> next level's intro, or campaignResults after the last level. */
function advanceLevel(state: SimState, emit: Emit): SimState {
  const levelIndex = state.levelIndex + 1;
  const levelId = state.config.levelIds[levelIndex];
  if (levelId === undefined) {
    const totalStrokes = state.campaign.reduce((sum, r) => sum + r.strokes[0] + r.strokes[1], 0);
    const coursePar = campaignPar(state);
    emit({ type: 'campaignComplete', results: state.campaign, totalStrokes, coursePar, medal: medalFor(totalStrokes, coursePar) });
    return { ...state, phase: 'campaignResults' };
  }
  const level = levelById(levelId);
  emit({ type: 'levelStart', levelId, levelIndex, firstPlayer: level.firstPlayer, restarted: false });
  return { ...state, ...freshLevelFields(level), levelIndex, levelId, phase: 'intro', turnDelayTicks: 0 };
}

/** Rebuilds the current level in `aiming` with the hand-off delay; results of earlier levels are kept. */
function restartLevel(state: SimState, byPlayer: PlayerId, emit: Emit): SimState {
  const level = levelOf(state);
  emit({ type: 'levelRestart', levelId: state.levelId, byPlayer });
  emit({ type: 'levelStart', levelId: state.levelId, levelIndex: state.levelIndex, firstPlayer: level.firstPlayer, restarted: true });
  emit({ type: 'turnStart', playerId: level.firstPlayer, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: false });
  const campaign = state.campaign.length > state.levelIndex ? state.campaign.slice(0, state.levelIndex) : state.campaign;
  return { ...state, ...freshLevelFields(level), phase: 'aiming', turnDelayTicks: TURN_DELAY_TICKS, campaign };
}

// ---- rule 2: physics for every ball, then switches --------------------------------------------------

function stepBalls(state: SimState, emit: Emit): { state: SimState; switchesChanged: boolean } {
  const level = levelOf(state);
  const switches = state.switches;
  const colliders = solidColliders(level, switches);
  const balls: [BallState, BallState] = [{ ...state.balls[0] }, { ...state.balls[1] }];
  let players: SimState['players'] = state.players;
  const out: StepBallOut = { events: [] };
  for (const i of SLOTS) {
    const ball = balls[i];
    if (ball.sunk) continue;
    const ctx = { level, switches, playerId: i, colliders: collidersFor(colliders, i), strokes: players[i].strokes };
    const delta = stepBall(ball, ctx, out);
    if (delta === 0) continue;
    const credited: Players = [players[0], players[1]];
    credited[i] = { ...players[i], strokes: players[i].strokes + delta };
    players = credited;
  }
  for (const body of out.events) emit(body);
  const nextSwitches = evaluateSwitches(level, switches, balls);
  const switchesChanged = emitSwitchDiff(level, switches, nextSwitches, balls, emit);
  return { state: { ...state, balls, players, switches: switchesChanged ? nextSwitches : switches }, switchesChanged };
}

function sunkSlot(balls: readonly Readonly<BallState>[]): PlayerId {
  return balls[1]?.sunk === true && balls[0]?.sunk !== true ? 1 : 0;
}

/** The driving switch that flipped this tick (first in the rect's list), for `bridgeToggle.switchId`. */
function flippedDriver(rectIds: readonly string[], prev: Readonly<Record<string, boolean>>, next: Readonly<Record<string, boolean>>): string {
  for (const id of rectIds) if ((prev[id] === true) !== (next[id] === true)) return id;
  return rectIds[0] ?? '';
}

/**
 * switchOn/Off per changed switch, then bridgeToggle per switch-driven rect whose activity changed (never for
 * a trap or a cannon: their state is read from `switches`), then the trap moments the new switch map caused:
 * `trapCaught` for a resting ball an armed trap now holds that was free, `trapFreed` for a caught one now free.
 */
function emitSwitchDiff(
  level: Level,
  prev: Readonly<Record<string, boolean>>,
  next: Readonly<Record<string, boolean>>,
  balls: readonly Readonly<BallState>[],
  emit: Emit,
): boolean {
  let changed = false;
  for (const sw of level.switches) {
    const was = prev[sw.id] === true;
    const now = next[sw.id] === true;
    if (was === now) continue;
    changed = true;
    const pos: Vec = { x: sw.x + sw.w / 2, y: sw.surfaceY };
    if (now) emit({ type: 'switchOn', switchId: sw.id, byPlayer: switchPresser(level, sw, prev, balls) ?? sunkSlot(balls), pos });
    else emit({ type: 'switchOff', switchId: sw.id, pos });
  }
  if (!changed) return false;
  for (const rect of level.rects) {
    if (isPermanentRect(rect) || rect.kind === 'trap' || rect.kind === 'cannon') continue;
    const active = isRectActive(rect, next);
    if (isRectActive(rect, prev) === active) continue;
    emit({ type: 'bridgeToggle', rectId: rect.id, kind: rect.kind, active, switchId: flippedDriver(rectSwitchIds(rect), prev, next) });
  }
  for (const i of SLOTS) {
    const ball = balls[i];
    if (ball === undefined) continue;
    const before = trapHolding(level, prev, ball);
    const after = trapHolding(level, next, ball);
    if (before === null && after !== null) emit({ type: 'trapCaught', playerId: i, pos: ball.pos, rectId: after.id });
    else if (before !== null && after === null) emit({ type: 'trapFreed', playerId: i, pos: ball.pos, rectId: before.id });
  }
  return true;
}

// ---- teleports: the flight watchdog (D10.6) and the scoped reset (D10.5) ----------------------------

/** Re-evaluates the switches after balls were teleported; emits and writes the diff when the mask changed. */
function reevaluateSwitches(level: Level, state: SimState, balls: Balls, emit: Emit): { state: SimState; switchesChanged: boolean } {
  const next = evaluateSwitches(level, state.switches, balls);
  const switchesChanged = emitSwitchDiff(level, state.switches, next, balls, emit);
  return { state: { ...state, balls, switches: switchesChanged ? next : state.switches }, switchesChanged };
}

/** A ball teleported to `pos` lands asleep; its device moment (an armed trap there) follows its teleport event. */
function placeAt(level: Level, switches: Readonly<Record<string, boolean>>, slot: PlayerId, ball: Readonly<BallState>, pos: Vec, emit: Emit): BallState {
  const placed: BallState = { ...ball, pos, vel: { x: 0, y: 0 }, asleep: true, grounded: true, restTicks: REST_TICKS };
  const device = restEventOf(level, switches, placed, slot);
  if (device !== null) emit(device);
  return placed;
}

/** The flight's FLIGHT_WATCHDOG_TICKS-th tick: every moving ball goes to its safe spot, no stroke; then the switches. */
function endFlight(state: SimState, emit: Emit): { state: SimState; switchesChanged: boolean } {
  const level = levelOf(state);
  const balls: Balls = [state.balls[0], state.balls[1]];
  for (const i of SLOTS) {
    const ball = balls[i];
    if (ball.sunk || ball.asleep) continue;
    emit({ type: 'flightTimeout', playerId: i, pos: ball.pos, respawnPos: ball.lastRest });
    balls[i] = placeAt(level, state.switches, i, ball, ball.lastRest, emit);
  }
  return reevaluateSwitches(level, state, balls, emit);
}

// ---- rule 3: phase transitions ---------------------------------------------------------------------

function transition(state: SimState, switchesChanged: boolean, emit: Emit): SimState {
  const allSettled = state.balls.every(isSettled);
  if (state.phase === 'aiming') return allSettled ? state : { ...state, phase: 'flying' };
  if (state.phase !== 'flying' || !allSettled || switchesChanged) return state;
  if (state.balls[0].sunk && state.balls[1].sunk) return completeLevel(state, emit);
  return handOff(state, emit);
}

function otherSlot(slot: PlayerId): PlayerId {
  return slot === 0 ? 1 : 0;
}

/**
 * The WAITING rule (D10.5). The next shooter is the first of [the other ball, the same ball] that is neither
 * sunk nor waiting (caught or loaded); each candidate passed over BECAUSE it waits gets a `turnSkipped` just
 * before the `turnStart`. If nobody can shoot, the scoped reset sends the waiting ball that moved last (the
 * shooter if it waits, else the other) to its safe spot with BACK_PENALTY, then the other waiting ball, then,
 * as a guard a valid level never reaches, the first one to its tee. A reset that would not move its ball is
 * skipped (no stroke, no event). A reset that changes a switch emits the diff and returns WITHOUT a
 * `turnStart` (ARCH R5): the phase stays 'flying' and the next settled tick redoes the hand-off from scratch.
 */
function handOff(state: SimState, emit: Emit): SimState {
  const level = levelOf(state);
  let s = recordFreedSafeSpots(level, state);
  const chosen = pickShooter(level, s);
  if (chosen !== null) return startTurn(s, chosen, emit);
  const prev = s.activePlayer;
  const first = waitingOf(level, s.switches, s.balls[prev]) !== null ? prev : otherSlot(prev);
  const resets: readonly { slot: PlayerId; toTee: boolean }[] = [
    { slot: first, toTee: false },
    { slot: otherSlot(first), toTee: false },
    { slot: first, toTee: true },
  ];
  for (const { slot, toTee } of resets) {
    const ball = s.balls[slot];
    if (waitingOf(level, s.switches, ball) === null) continue;
    const dest = toTee ? level.starts[slot] : ball.lastRest;
    if (dest.x === ball.pos.x && dest.y === ball.pos.y) continue;
    const reset = resetBall(level, s, slot, dest, toTee, emit);
    if (reset.switchesChanged) return reset.state;
    s = reset.state;
    const next = pickShooter(level, s);
    if (next !== null) return startTurn(s, next, emit);
  }
  return s;
}

/** A ball freed where it sits (asleep, free, supported by permanent ground, not on a breech) records its safe spot. */
function recordFreedSafeSpots(level: Level, state: SimState): SimState {
  let balls: Balls | null = null;
  for (const i of SLOTS) {
    const ball = state.balls[i];
    if (ball.sunk || !ball.asleep || waitingOf(level, state.switches, ball) !== null || onCannonBreech(level, ball.pos)) continue;
    if (ball.lastRest.x === ball.pos.x && ball.lastRest.y === ball.pos.y) continue;
    const g = groundAt(level, state.switches, ball.pos, i);
    if (g === null || !g.permanent || !groundSupports(g, ball.pos)) continue;
    balls ??= [state.balls[0], state.balls[1]];
    balls[i] = { ...ball, lastRest: ball.pos };
  }
  return balls === null ? state : { ...state, balls };
}

type Skip = { readonly slot: PlayerId; readonly waiting: Waiting };
type Shooter = { readonly next: PlayerId; readonly skipped: readonly Skip[] };

function pickShooter(level: Level, state: SimState): Shooter | null {
  const skipped: Skip[] = [];
  for (const slot of [otherSlot(state.activePlayer), state.activePlayer]) {
    const ball = state.balls[slot];
    if (ball.sunk) continue;
    const waiting = waitingOf(level, state.switches, ball);
    if (waiting === null) return { next: slot, skipped };
    skipped.push({ slot, waiting });
  }
  return null;
}

function startTurn(state: SimState, chosen: Shooter, emit: Emit): SimState {
  const prev = state.activePlayer;
  for (const skip of chosen.skipped) {
    emit({ type: 'turnSkipped', playerId: skip.slot, reason: skip.waiting.reason, rectId: skip.waiting.rectId, nextPlayer: chosen.next });
  }
  emit({ type: 'turnStart', playerId: chosen.next, readyInTicks: TURN_DELAY_TICKS, sameAsBefore: chosen.next === prev });
  return { ...state, phase: 'aiming', activePlayer: chosen.next, turnDelayTicks: TURN_DELAY_TICKS };
}

/** The scoped reset ("BACK +1"): the ball to `dest` (its safe spot, or its tee as the guard), then the switches. */
function resetBall(level: Level, state: SimState, slot: PlayerId, dest: Vec, toTee: boolean, emit: Emit): { state: SimState; switchesChanged: boolean } {
  const ball = state.balls[slot];
  const players: Players = [state.players[0], state.players[1]];
  const strokes = players[slot].strokes + BACK_PENALTY;
  players[slot] = { ...players[slot], strokes };
  emit({ type: 'trapReturn', playerId: slot, pos: ball.pos, respawnPos: dest, strokes, toTee });
  const balls: Balls = [state.balls[0], state.balls[1]];
  const placed = placeAt(level, state.switches, slot, ball, dest, emit);
  // the tee is a safe spot: a later fall or reset must not send the ball back into the device it left
  balls[slot] = toTee ? { ...placed, lastRest: dest } : placed;
  return reevaluateSwitches(level, { ...state, players }, balls, emit);
}

function completeLevel(state: SimState, emit: Emit): SimState {
  const level = levelOf(state);
  const strokes: [number, number] = [state.players[0].strokes, state.players[1].strokes];
  const team = strokes[0] + strokes[1];
  const result: LevelResult = { levelId: state.levelId, par: level.par, strokes, medal: medalFor(team, level.par) };
  emit({ type: 'levelComplete', result, teamStrokes: team, isLastLevel: nextLevelId(state) === null });
  return { ...state, phase: 'levelResults', campaign: [...state.campaign, result] };
}

// ---- rule 5: finiteness -----------------------------------------------------------------------------

function assertFinite(state: SimState): void {
  const numbers: number[] = [state.tick, state.levelIndex, state.turnDelayTicks, state.rng, state.activePlayer, state.flightTicks];
  for (const p of state.players) numbers.push(p.strokes, p.aim.angle, p.aim.power);
  for (const b of state.balls) numbers.push(b.pos.x, b.pos.y, b.vel.x, b.vel.y, b.restTicks, b.lastRest.x, b.lastRest.y);
  for (const n of numbers) if (!Number.isFinite(n)) throw new Error('sim: non-finite state');
}

// ---- queries -----------------------------------------------------------------------------------------

export function levelOf(state: SimState): Level {
  return levelById(state.levelId);
}

export function activeBall(state: SimState): Readonly<BallState> {
  return state.balls[state.activePlayer];
}

export function teamStrokes(state: SimState): number {
  return state.players[0].strokes + state.players[1].strokes;
}

/** Sum of par over config.levelIds (NOT named coursePar: that is levels/index.ts). */
export function campaignPar(state: SimState): number {
  let total = 0;
  for (const id of state.config.levelIds) total += levelById(id).par;
  return total;
}

/** The human seat that owns a slot: solo => 0 for both slots; local/online => the slot itself. */
export function seatOf(config: SimConfig, playerId: PlayerId): PlayerId {
  return config.mode === 'solo' ? 0 : playerId;
}

/** Host = seat 0 in every mode. */
export function isHost(config: SimConfig, seat: PlayerId): boolean {
  void config;
  return seat === 0;
}

export function canControl(config: SimConfig, seat: PlayerId, slot: PlayerId): boolean {
  return seatOf(config, slot) === seat;
}

/** Phase x role table from ARCH.md §1.5. */
export function allowedCommands(state: SimState, seat: PlayerId): PlayerCommandType[] {
  const host = isHost(state.config, seat);
  const owner = canControl(state.config, seat, state.activePlayer);
  const out: PlayerCommandType[] = [];
  switch (state.phase) {
    case 'intro':
    case 'levelResults':
      out.push('continue');
      if (host) out.push('restartLevel');
      break;
    case 'aiming':
      if (owner) out.push('setAim', 'shoot');
      if (host) out.push('restartLevel');
      break;
    case 'flying':
      if (host) out.push('restartLevel');
      break;
    case 'campaignResults':
      break;
  }
  return out;
}

export function isShotReady(state: SimState): boolean {
  return state.phase === 'aiming' && state.turnDelayTicks === 0;
}

export function nextLevelId(state: SimState): string | null {
  return state.config.levelIds[state.levelIndex + 1] ?? null;
}

/** Replay contract: commands applied at exactly entry.tick (array order within a tick); entries sorted by tick. */
export function runReplay(
  config: SimConfig,
  log: readonly ReplayEntry[],
  untilTick: number,
): { state: SimState; events: SimEvent[] } {
  const first = createSim(config);
  let state = first.state;
  const events: SimEvent[] = [...first.events];
  let cursor = 0;
  for (let t = 0; t < untilTick; t += 1) {
    const cmds: PlayerCommand[] = [];
    while (cursor < log.length) {
      const entry = log[cursor];
      if (entry === undefined || entry.tick !== t) break;
      cmds.push(entry.cmd);
      cursor += 1;
    }
    const r = stepSim(state, cmds);
    state = r.state;
    for (const e of r.events) events.push(e);
  }
  return { state, events };
}
