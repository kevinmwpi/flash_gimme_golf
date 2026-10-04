/**
 * src/net/protocol.ts — wire contract between the browser client and server/rooms.ts.
 *
 * - Shared by client (src/net/GameClient.ts) and server (server/rooms.ts). Importable from both
 *   tsconfigs: NO DOM, NO node imports, NO import.meta. (`getWsUrl` lives in src/net/wsUrl.ts.)
 *   Imports ONLY from '../sim/types'. Compiles under strict + exactOptionalPropertyTypes.
 * - Transport: one WebSocket per client at path /ws, JSON text frames, one message per frame.
 * - The server is authoritative. Clients never run `stepSim` online; they render snapshots.
 *   The server never DECODES a snapshot (it keeps its own SimState); `RoomSync` is client-only input.
 * - Every inbound frame is validated by `parseClientMessage` (server) / `parseServerMessage`
 *   (client). `parseClientMessage` REBUILDS every object it returns (unknown extra properties never
 *   reach the sim). Anything that fails validation is dropped and (server side) answered with
 *   `error{code:'BAD_MESSAGE'}`; a socket that sends 5 bad frames in 10 s is closed (1008).
 * - Timestamps (`serverTime`) are MONOTONIC milliseconds from the server's `performance.now()`
 *   (never Date.now(), so an NTP step cannot reorder the client's interpolation ring). Only
 *   differences between two serverTimes are meaningful.
 */

import type { MetaScreen, PlayerCommand, PlayerId, SimConfig, SimEvent, SimPhase, SimSnapshot } from '../sim/types';
import {
  AIM_ANGLE_MAX,
  AIM_ANGLE_MIN,
  MAX_POWER,
  MIN_POWER,
  PHASE_CODES,
  TICK_RATE,
  SNAPSHOT_VERSION,
} from '../sim/types';

/** Bump when a message shape changes incompatibly. Client sends it in `hello`; mismatch => VERSION_MISMATCH. */
export const PROTOCOL_VERSION = 3;

/** Room codes: 5 chars from this alphabet (no 0/O/1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

/** Reconnect tokens: 32 lowercase hex chars (16 random bytes from crypto.randomBytes). */
export const RECONNECT_TOKEN_RE = /^[0-9a-f]{32}$/;

/** Level ids on the wire: kebab-case, <= 40 chars. Existence is checked server-side with `hasLevel`. */
export const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_CAMPAIGN_LENGTH = 16;

/** Server tick rate IS the sim tick rate (one definition, re-exported; ARCH.md §3.3). */
export { TICK_RATE as SERVER_TICK_RATE };
/** Server sim tick in integer units of 1/60 ms (= 1000 units per tick); see ARCH.md §6 "Tick". */
export const TICK_UNITS_PER_MS = 60;
export const TICK_UNITS_PER_TICK = 1000;
/** Max wall-clock the server catches up per tickAll call (ms); more is dropped. */
export const MAX_CATCHUP_MS = 250;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz while anything changed
export const SNAPSHOT_KEEPALIVE_TICKS = 60; // 1 Hz when idle
/** Client render delay behind the newest snapshot so interpolation always has two samples. */
export const CLIENT_RENDER_DELAY_MS = 100;
/** Two consecutive snapshots further apart than this (ms) are NOT interpolated across (hold then snap). */
export const SNAPSHOT_GAP_DISCONTINUITY_MS = 3 * (1000 / TICK_RATE) * SNAPSHOT_EVERY_TICKS; // 150
/** Extrapolate balls with their velocity for at most this long during a stall, then hold. */
export const MAX_EXTRAPOLATION_MS = 150;
/** Snapshot ring length on the client. */
export const SNAPSHOT_RING_SIZE = 8;
/** Reserved and unused: online play never auto-advances (BUILD_DECISIONS D6, either seat continues).
 *  Kept so the frozen contract keeps its exports. */
export const INTRO_AUTO_CONTINUE_MS = 4000;
export const RESULTS_AUTO_CONTINUE_MS = 12000;
/** Socket skipped for a snapshot when its `bufferedAmount` exceeds this; it catches up from its event cursor. */
export const MAX_SOCKET_BACKLOG_BYTES = 64 * 1024;

/** Limits enforced by the server (see ARCH.md "Server room lifecycle"). */
export const LIMITS = Object.freeze({
  maxPayloadBytes: 4096, // ws maxPayload
  maxMessageBytes: 2048, // after parse; longer => BAD_MESSAGE
  messagesPerSecond: 40, // token bucket, burst 60
  messageBurst: 60,
  setAimPerSecond: 30, // extra bucket just for setAim; excess coalesced in place, not errored
  badMessagesBeforeClose: 5, // within badMessageWindowMs
  badMessageWindowMs: 10_000,
  maxRooms: 300,
  maxRoomsPerIp: 8,
  roomIdleMs: 10 * 60_000, // destroy a room with no inbound message for 10 min
  lobbyWaitMs: 15 * 60_000, // destroy a room that never started after 15 min
  reconnectGraceMs: 60_000, // slot held for a dropped player
  heartbeatMs: 30_000, // ws ping; no pong by next ping => terminate
  maxNameLength: 12,
});

// ---------------------------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------------------------

export type ClientMessage =
  /** First frame after open. Server replies `welcome` or `error{VERSION_MISMATCH}` and closes.
   *  Any other message before a valid `hello` => `error{BAD_MESSAGE}` (counts toward the 5-in-10 s close). */
  | { type: 'hello'; protocol: number; name?: string }
  /** Create a room; sender becomes host (slot 0). One room per socket. */
  | { type: 'createRoom' }
  /** Join by code as guest (slot 1). With `reconnectToken`, reclaim a dropped slot instead. */
  | { type: 'joinRoom'; code: string; reconnectToken?: string }
  /** Leave the current room deliberately (no reconnect grace for the leaver). */
  | { type: 'leaveRoom' }
  /** Host only, lobby only (no sim yet): choose the start hole. Server validates with `hasLevel`
   *  and broadcasts `lobbyState`. Campaign = WORLD1_IDS from that id to the end. */
  | { type: 'setLevel'; levelId: string }
  /** Host only, both players present, room not started: create the sim. `levelIds` (optional)
   *  overrides the lobby choice; every id must pass `hasLevel`, no duplicates, else BAD_MESSAGE. */
  | { type: 'start'; levelIds?: string[] }
  /** Gameplay command. Server overwrites cmd.playerId with the sender's slot before validation.
   *  A `setAim` from the non-active slot is DROPPED SILENTLY (no error frame). */
  | { type: 'command'; cmd: PlayerCommand }
  /** After campaignResults: new sim with a new seed (same room, same players). Either player. */
  | { type: 'playAgain' }
  /** Latency probe; server echoes `t` plus its tick. */
  | { type: 'ping'; t: number };

export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'VERSION_MISMATCH'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'BAD_TOKEN'
  | 'RATE_LIMITED'
  | 'SERVER_FULL'
  | 'PEER_MISSING'
  | 'INTERNAL';

export type RoomCloseReason = 'hostLeft' | 'guestLeft' | 'peerTimeout' | 'idle' | 'serverShutdown' | 'internalError';

/** What a client needs to resume rendering a room mid-game (also sent on reconnect). */
export type RoomSync = {
  config: SimConfig;
  tick: number;
  snap: SimSnapshot;
  /** Monotonic server ms at which `snap` was taken (seeds the interpolation ring). */
  serverTime: number;
};

export type LobbyState = {
  /** Start hole chosen by the host (a WORLD1_IDS entry). */
  levelId: string;
  /** Which slots currently have a connected socket. */
  players: [boolean, boolean];
  names: [string, string];
};

export type ServerMessage =
  | { type: 'welcome'; protocol: number; serverTime: number }
  | { type: 'roomCreated'; code: string; playerId: 0; reconnectToken: string; lobby: LobbyState }
  /** Sent to the joiner after a successful join (fresh or reconnect). `sync` present when the game is running. */
  | { type: 'joined'; code: string; playerId: PlayerId; reconnectToken: string; peerConnected: boolean; lobby: LobbyState; sync?: RoomSync }
  | { type: 'peerJoined'; playerId: PlayerId; name: string }
  /** Lobby changed (start hole, names, presence). Lobby only. */
  | { type: 'lobbyState'; lobby: LobbyState }
  /** Partner dropped. In PLAYING the sim pauses (a `paused` message follows); in the lobby no `paused` is sent. */
  | { type: 'peerLeft'; playerId: PlayerId; reason: 'left' | 'disconnected'; graceMs: number }
  | { type: 'peerReconnected'; playerId: PlayerId }
  /** Game created (host pressed start, or playAgain). Carries the full config and first snapshot. Client clears its ring. */
  | { type: 'start'; sync: RoomSync }
  /**
   * Periodic authoritative state. `events` are every SimEvent this SOCKET has not yet received,
   * in order (`commandRejected` filtered server-side; per-slot event cursor, so a skipped
   * snapshot never loses events). `serverTime` is the server's monotonic ms at the END of the
   * tick in which `snap` was taken. `immediate` is true when IMMEDIATE_SNAPSHOT_EVENTS forced it.
   */
  | { type: 'snapshot'; tick: number; serverTime: number; snap: SimSnapshot; events: SimEvent[]; immediate: boolean }
  /** Sim paused/resumed (partner reconnecting). While paused the server does not tick. */
  | { type: 'paused'; paused: boolean; reason: 'peerDisconnected' | 'resumed' }
  | { type: 'roomClosed'; reason: RoomCloseReason }
  | { type: 'pong'; t: number; serverTime: number; tick: number }
  | { type: 'error'; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage['type'];

// ---------------------------------------------------------------------------------------------
// Validation (runtime guards; used by server/rooms.ts and src/net/GameClient.ts)
// ---------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPlayerId = (v: unknown): v is PlayerId => v === 0 || v === 1;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isSimPhase = (v: unknown): v is SimPhase => typeof v === 'string' && Object.hasOwn(PHASE_CODES, v);

export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && ROOM_CODE_RE.test(v);
}

export function isReconnectToken(v: unknown): v is string {
  return typeof v === 'string' && RECONNECT_TOKEN_RE.test(v);
}

export function isLevelIdShape(v: unknown): v is string {
  return typeof v === 'string' && LEVEL_ID_RE.test(v);
}

/**
 * Validates shape + numeric ranges and returns a REBUILT command (only known fields), or null.
 * Turn/phase/host rules are checked by the sim (`allowedCommands`).
 */
export function parsePlayerCommand(v: unknown): PlayerCommand | null {
  if (!isObj(v) || !isPlayerId(v.playerId)) return null;
  const playerId = v.playerId;
  switch (v.type) {
    case 'setAim': {
      const { angle, power } = v;
      if (!isFiniteNum(angle) || angle < AIM_ANGLE_MIN || angle > AIM_ANGLE_MAX) return null;
      if (!isFiniteNum(power) || power < MIN_POWER || power > MAX_POWER) return null;
      return { type: 'setAim', playerId, angle, power };
    }
    case 'shoot':
      return { type: 'shoot', playerId };
    case 'continue': {
      const screen = parseMetaScreen(v);
      return screen === null ? null : { type: 'continue', playerId, ...screen };
    }
    case 'restartLevel': {
      const screen = parseMetaScreen(v);
      return screen === null ? null : { type: 'restartLevel', playerId, ...screen };
    }
    default:
      return null;
  }
}

/** The optional screen stamp on `continue`/`restartLevel` (sim/types.ts MetaScreen); null when malformed. */
function parseMetaScreen(v: Record<string, unknown>): MetaScreen | null {
  const { levelIndex, phase } = v;
  const validIndex = levelIndex === undefined || (isFiniteNum(levelIndex) && Number.isInteger(levelIndex) && levelIndex >= 0 && levelIndex < MAX_CAMPAIGN_LENGTH);
  if (!validIndex || !(phase === undefined || isSimPhase(phase))) return null;
  return {
    ...(levelIndex === undefined ? {} : { levelIndex }),
    ...(phase === undefined ? {} : { phase }),
  };
}

/** Type guard form of `parsePlayerCommand` (does not rebuild; use `parsePlayerCommand` on the wire). */
export function isPlayerCommand(v: unknown): v is PlayerCommand {
  return parsePlayerCommand(v) !== null;
}

/**
 * Parse one inbound client frame. Returns null for anything that is not a known shape
 * (unknown types, extra nesting, wrong field types, out-of-range numbers, overlong strings).
 * Every returned object is REBUILT from validated fields; the caller never sees extra properties.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > LIMITS.maxMessageBytes) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'hello': {
      if (!isFiniteNum(v.protocol) || !Number.isInteger(v.protocol)) return null;
      if (v.name === undefined) return { type: 'hello', protocol: v.protocol };
      if (!isStr(v.name, LIMITS.maxNameLength)) return null;
      return { type: 'hello', protocol: v.protocol, name: v.name };
    }
    case 'createRoom':
      return { type: 'createRoom' };
    case 'joinRoom': {
      if (!isRoomCode(v.code)) return null;
      if (v.reconnectToken === undefined) return { type: 'joinRoom', code: v.code };
      if (!isReconnectToken(v.reconnectToken)) return null;
      return { type: 'joinRoom', code: v.code, reconnectToken: v.reconnectToken };
    }
    case 'leaveRoom':
      return { type: 'leaveRoom' };
    case 'setLevel':
      return isLevelIdShape(v.levelId) ? { type: 'setLevel', levelId: v.levelId } : null;
    case 'start': {
      if (v.levelIds === undefined) return { type: 'start' };
      const ids = v.levelIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_CAMPAIGN_LENGTH) return null;
      const out: string[] = [];
      for (const id of ids as unknown[]) {
        if (!isLevelIdShape(id) || out.includes(id)) return null; // shape + duplicates here; existence (`hasLevel`) in rooms.ts
        out.push(id);
      }
      return { type: 'start', levelIds: out };
    }
    case 'command': {
      const cmd = parsePlayerCommand(v.cmd);
      return cmd ? { type: 'command', cmd } : null;
    }
    case 'playAgain':
      return { type: 'playAgain' };
    case 'ping':
      return isFiniteNum(v.t) ? { type: 'ping', t: v.t } : null;
    default:
      return null;
  }
}

const KNOWN_SERVER_TYPES: readonly string[] = Object.freeze([
  'welcome',
  'roomCreated',
  'joined',
  'peerJoined',
  'lobbyState',
  'peerLeft',
  'peerReconnected',
  'start',
  'snapshot',
  'paused',
  'roomClosed',
  'pong',
  'error',
]);

/**
 * Light client-side guard (the server is trusted, but a stale build must not crash on new
 * shapes). Only `type` is checked here; `decodeSnapshot` (sim/serialize.ts) is the hard
 * validation point for `snap`, and a SerializeError there becomes `ClientStatus{kind:'error'}`,
 * never an exception inside the RAF loop.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.type !== 'string') return null;
  if (!KNOWN_SERVER_TYPES.includes(v.type)) return null;
  if (v.type === 'snapshot' || v.type === 'start' || v.type === 'joined') {
    const snap = v.type === 'snapshot' ? v.snap : isObj(v.sync) ? v.sync.snap : undefined;
    if (snap !== undefined && !(Array.isArray(snap) && snap[0] === SNAPSHOT_VERSION)) return null;
  }
  return v as ServerMessage;
}

/** Human copy for error codes (UI uses this unless the server message is more specific). */
export const ERROR_COPY: Readonly<Record<ErrorCode, string>> = Object.freeze({
  BAD_MESSAGE: 'The game sent something the server did not understand.',
  VERSION_MISMATCH: 'Your game is out of date. Reload the page to update.',
  ROOM_NOT_FOUND: 'No room with that code. Check the code or ask your friend for a new link.',
  ROOM_FULL: 'That room already has two players.',
  ALREADY_IN_ROOM: 'You are already in a room.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_HOST: 'Only the host can do that.',
  NOT_YOUR_TURN: 'Wait for your turn.',
  WRONG_PHASE: 'You cannot do that right now.',
  BAD_TOKEN: 'Could not rejoin: the room moved on without you.',
  RATE_LIMITED: 'Slow down a little.',
  SERVER_FULL: 'The server is busy. Try again in a minute.',
  PEER_MISSING: 'Your friend has not joined yet.',
  INTERNAL: 'Something went wrong on the server. The room was closed.',
});
