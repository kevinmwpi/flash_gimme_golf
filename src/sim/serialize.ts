// OWNER: sim
/**
 * Compact snapshot + share-link codec (ARCH.md §1.6, §5). Implemented for real in the stub commit;
 * the SIM group may refine it. Every number is validated for type AND range on decode; `par`/`medal`
 * of campaign entries are recomputed from the level registry, never trusted from the wire.
 */
import { hasLevel, levelById } from './levels/index';
import { groundAt, groundSupports, switchMaskOf } from './terrain';
import type {
  BallSnap,
  BallState,
  CampaignSnap,
  Level,
  LevelResult,
  PhaseCode,
  PlayerId,
  PlayerSnap,
  PlayerState,
  ShareLinkPayload,
  SimConfig,
  SimConfigSnap,
  SimMode,
  SimSnapshot,
  SimState,
  Vec,
} from './types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  BALL_FLAG_ASLEEP,
  BALL_FLAG_GROUNDED,
  BALL_FLAG_SUNK,
  CEILING_Y,
  KILL_MARGIN,
  MAX_BALL_SPEED,
  MAX_POWER,
  MIN_POWER,
  PHASES_BY_CODE,
  PHASE_CODES,
  REST_TICKS,
  SNAPSHOT_VERSION,
  TURN_DELAY_TICKS,
  medalFor,
  quantize1,
  quantize2,
  quantize4,
} from './types';

export class SerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerializeError';
  }
}

const MODE_CODES: Readonly<Record<SimMode, 0 | 1 | 2>> = Object.freeze({ solo: 0, local: 1, online: 2 });
const MODES_BY_CODE: readonly SimMode[] = Object.freeze(['solo', 'local', 'online']);
const UINT32_MAX = 4294967295;

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isTuple = (v: unknown, length: number): v is unknown[] => Array.isArray(v) && v.length === length;

function fail(message: string): never {
  throw new SerializeError(message);
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

function encodePlayer(p: Readonly<PlayerState>): PlayerSnap {
  return [p.strokes, quantize4(p.aim.angle), quantize1(p.aim.power)];
}

function encodeBall(b: Readonly<BallState>): BallSnap {
  const flags = (b.asleep ? BALL_FLAG_ASLEEP : 0) | (b.sunk ? BALL_FLAG_SUNK : 0) | (b.grounded ? BALL_FLAG_GROUNDED : 0);
  return [
    quantize2(b.pos.x),
    quantize2(b.pos.y),
    quantize2(b.vel.x),
    quantize2(b.vel.y),
    flags,
    b.restTicks,
    quantize2(b.lastRest.x),
    quantize2(b.lastRest.y),
  ];
}

export function encodeSnapshot(state: SimState): SimSnapshot {
  const level = levelById(state.levelId);
  const campaign: CampaignSnap = state.campaign.map((c) => [c.strokes[0], c.strokes[1]]);
  return [
    SNAPSHOT_VERSION,
    state.tick,
    PHASE_CODES[state.phase],
    state.levelIndex,
    state.activePlayer,
    state.turnDelayTicks,
    [encodePlayer(state.players[0]), encodePlayer(state.players[1])],
    [encodeBall(state.balls[0]), encodeBall(state.balls[1])],
    switchMaskOf(level, state.switches),
    state.rng,
    campaign,
  ];
}

function isPlayerSnap(v: unknown): v is PlayerSnap {
  return isTuple(v, 3) && v.every(isFiniteNum);
}

function isBallSnap(v: unknown): v is BallSnap {
  return isTuple(v, 8) && v.every(isFiniteNum);
}

function isCampaignSnap(v: unknown): v is CampaignSnap {
  return Array.isArray(v) && v.every((row) => isTuple(row, 2) && row.every(isFiniteNum));
}

/** Shape check only (no ranges): the positional tuple described in types.ts. */
export function isSimSnapshot(v: unknown): v is SimSnapshot {
  if (!isTuple(v, 11)) return false;
  const [version, tick, phase, levelIndex, activePlayer, turnDelay, players, balls, switchMask, rng, campaign] = v;
  return (
    version === SNAPSHOT_VERSION &&
    isFiniteNum(tick) &&
    isFiniteNum(phase) &&
    isFiniteNum(levelIndex) &&
    (activePlayer === 0 || activePlayer === 1) &&
    isFiniteNum(turnDelay) &&
    isTuple(players, 2) &&
    players.every(isPlayerSnap) &&
    isTuple(balls, 2) &&
    balls.every(isBallSnap) &&
    isFiniteNum(switchMask) &&
    isFiniteNum(rng) &&
    isCampaignSnap(campaign)
  );
}

/** Aims must be the quantised values the sim stores (quantize4 / quantize1), inside the bounds. */
function decodePlayer(p: PlayerSnap): PlayerState {
  const [strokes, angle, power] = p;
  if (!isInt(strokes, 0, Number.MAX_SAFE_INTEGER)) fail('strokes');
  if (angle < AIM_ANGLE_MIN || angle > AIM_ANGLE_MAX) fail('aim angle out of range');
  if (power < MIN_POWER || power > MAX_POWER) fail('aim power out of range');
  if (angle !== quantize4(angle) || power !== quantize1(power)) fail('aim not quantised');
  return { strokes, aim: { angle, power } };
}

/** A world position the sim can produce: inside the level's x-range, below the ceiling, above the kill line. */
function inWorld(level: Level, x: number, y: number): boolean {
  return x >= 0 && x <= level.width && y >= CEILING_Y && y <= level.height + KILL_MARGIN;
}

/** A ball centre standing on permanent ground (a tee or a recorded rest position). */
function restsOnPermanentGround(level: Level, switches: Readonly<Record<string, boolean>>, pos: Vec, slot: PlayerId): boolean {
  const g = groundAt(level, switches, pos, slot);
  return g !== null && g.permanent && groundSupports(g, pos);
}

/**
 * Ranges per ball. `lastRest` is where a fallen ball respawns, so it must stand on permanent ground
 * (the sim only ever records such a spot): an unsupported lastRest would respawn, fall and respawn
 * forever, and the turn would never come back.
 */
function decodeBall(b: BallSnap, level: Level, switches: Readonly<Record<string, boolean>>, slot: PlayerId): BallState {
  const [x, y, vx, vy, flags, restTicks, lastRestX, lastRestY] = b;
  if (!isInt(flags, 0, BALL_FLAG_ASLEEP | BALL_FLAG_SUNK | BALL_FLAG_GROUNDED)) fail('ball flags');
  if (!isInt(restTicks, 0, REST_TICKS)) fail('restTicks');
  if (!inWorld(level, x, y) || !inWorld(level, lastRestX, lastRestY)) fail('ball position out of world');
  if (Math.abs(vx) > MAX_BALL_SPEED || Math.abs(vy) > MAX_BALL_SPEED) fail('ball speed');
  const sunk = (flags & BALL_FLAG_SUNK) !== 0;
  if (!sunk && !restsOnPermanentGround(level, switches, { x: lastRestX, y: lastRestY }, slot)) fail('lastRest unsupported');
  return {
    pos: { x, y },
    vel: { x: vx, y: vy },
    asleep: (flags & BALL_FLAG_ASLEEP) !== 0,
    sunk,
    grounded: (flags & BALL_FLAG_GROUNDED) !== 0,
    restTicks,
    lastRest: { x: lastRestX, y: lastRestY },
  };
}

function decodeCampaign(rows: CampaignSnap, config: SimConfig): LevelResult[] {
  if (rows.length > config.levelIds.length) fail('campaign longer than the course');
  return rows.map((row, i) => {
    const [s0, s1] = row;
    if (!isInt(s0, 0, Number.MAX_SAFE_INTEGER) || !isInt(s1, 0, Number.MAX_SAFE_INTEGER)) fail('campaign strokes');
    const levelId = config.levelIds[i];
    if (levelId === undefined) fail('campaign index');
    const par = levelById(levelId).par;
    return { levelId, par, strokes: [s0, s1], medal: medalFor(s0 + s1, par) };
  });
}

/** Validates shape + ranges and rebuilds a SimState; throws SerializeError. */
export function decodeSnapshot(snap: unknown, config: SimConfig): SimState {
  if (!isSimSnapshot(snap)) fail('bad snapshot shape');
  const [, tick, phaseCode, levelIndex, activePlayer, turnDelayTicks, players, balls, switchMask, rng, campaign] = snap;
  if (!isInt(tick, 0, Number.MAX_SAFE_INTEGER)) fail('tick');
  if (!isInt(phaseCode, 0, 4)) fail('phase');
  if (!isInt(levelIndex, 0, config.levelIds.length - 1)) fail('levelIndex');
  if (!isInt(turnDelayTicks, 0, TURN_DELAY_TICKS)) fail('turnDelayTicks');
  if (!isInt(rng, 0, UINT32_MAX)) fail('rng');
  const levelId = config.levelIds[levelIndex];
  if (levelId === undefined || !hasLevel(levelId)) fail('unknown level id');
  const level = levelById(levelId);
  const maxMask = (1 << level.switches.length) - 1;
  if (!isInt(switchMask, 0, maxMask)) fail('switch mask');
  const switches: Record<string, boolean> = {};
  level.switches.forEach((sw, i) => {
    switches[sw.id] = (switchMask & (1 << i)) !== 0;
  });
  return {
    config,
    tick,
    phase: PHASES_BY_CODE[phaseCode as PhaseCode],
    levelIndex,
    levelId,
    players: [decodePlayer(players[0]), decodePlayer(players[1])],
    balls: [decodeBall(balls[0], level, switches, 0), decodeBall(balls[1], level, switches, 1)],
    switches,
    activePlayer,
    turnDelayTicks,
    rng,
    campaign: decodeCampaign(campaign, config),
  };
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export function encodeConfig(config: SimConfig): SimConfigSnap {
  return [config.playerCount, MODE_CODES[config.mode], config.seed, [...config.levelIds]];
}

/** Validates the tuple; every level id must exist in the registry. */
export function decodeConfig(v: unknown): SimConfig {
  if (!isTuple(v, 4)) fail('bad config shape');
  const [playerCount, modeCode, seed, levelIds] = v;
  if (playerCount !== 1 && playerCount !== 2) fail('playerCount');
  if (!isInt(modeCode, 0, 2)) fail('mode');
  if (!isInt(seed, 0, UINT32_MAX)) fail('seed');
  if (!Array.isArray(levelIds) || levelIds.length === 0) fail('levelIds');
  const ids: string[] = [];
  for (const id of levelIds as unknown[]) {
    if (typeof id !== 'string' || !hasLevel(id) || ids.includes(id)) fail('unknown or duplicate level id');
    ids.push(id);
  }
  const mode = MODES_BY_CODE[modeCode];
  if (mode === undefined) fail('mode');
  return { playerCount, mode, seed, levelIds: ids };
}

// ---------------------------------------------------------------------------------------------
// base64url (manual table; identical in Node 22 and browsers, no Buffer/atob dependency)
// ---------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Array.from(B64, (ch, i) => [ch, i] as const)),
);

function utf8Encode(s: string): number[] {
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return bytes;
}

function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] ?? 0;
    let cp: number;
    let extra: number;
    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if (b0 < 0xe0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if (b0 < 0xf0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else {
      cp = b0 & 0x07;
      extra = 3;
    }
    for (let k = 1; k <= extra; k += 1) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

export function toBase64Url(json: string): string {
  const bytes = utf8Encode(json);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2] ?? '';
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)] ?? '';
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] ?? '';
    if (b2 !== undefined) out += B64[b2 & 63] ?? '';
  }
  return out;
}

export function fromBase64Url(s: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64_INDEX[ch];
    if (v === undefined) fail('bad base64url character');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

// ---------------------------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------------------------

export function encodeShareLink(state: SimState): string {
  const payload: ShareLinkPayload = { v: SNAPSHOT_VERSION, c: encodeConfig(state.config), s: encodeSnapshot(state) };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShareLink(param: string): { config: SimConfig; state: SimState } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(param));
  } catch (e) {
    if (e instanceof SerializeError) throw e;
    fail('share link is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('bad share link shape');
  const payload = parsed as Record<string, unknown>;
  if (payload.v !== SNAPSHOT_VERSION) fail('share link version');
  const config = decodeConfig(payload.c);
  const state = decodeSnapshot(payload.s, config);
  return { config, state };
}

export function buildShareUrl(base: string, state: SimState): string {
  return `${base}?state=${encodeShareLink(state)}`;
}
