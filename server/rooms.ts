// OWNER: net
/**
 * Room manager (ARCH.md §1.15, §6). Sockets are an interface so tests can fake them; no `ws` class
 * import here. The server is the only sim instance online and never decodes a snapshot.
 *
 * Lifecycle: open -> hello -> createRoom (WAITING) -> joinRoom (LOBBY) -> start (PLAYING).
 * Every inbound frame goes through `parseClientMessage`; bad frames answer error{BAD_MESSAGE}
 * and 5 of them in 10 s close the socket (1008). A socket that has not said `hello` within
 * HELLO_TIMEOUT_MS is closed (1008); an ip may hold at most MAX_SOCKETS_PER_IP open sockets.
 * Token buckets: 40/s (burst 60) for every frame plus a 30/s bucket just for setAim whose overflow
 * is coalesced in place, never errored. Ticking uses an integer accumulator in 1/60 ms units
 * (50 ms => exactly 3 ticks, 400 ms => 15). While a room is paused (partner in reconnect grace)
 * commands are refused, never queued. A started room survives BOTH players dropping: each slot keeps
 * its own grace and `expireRoom` closes the room when the first one lapses.
 *
 * Liveness: the client pings every 2 s. A helloed socket silent (no frame, no ws pong) for
 * SILENT_PROBE_AFTER_MS gets a ws-level ping, which browsers answer from the network stack even in a
 * throttled background tab; no answer within SILENT_PROBE_TIMEOUT_MS => terminate + disconnect logic,
 * so a half-open peer is noticed in ~15 s instead of up to two LIMITS.heartbeatMs sweeps.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  ERROR_COPY,
  LIMITS,
  MAX_CATCHUP_MS,
  MAX_SOCKET_BACKLOG_BYTES,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SNAPSHOT_EVERY_TICKS,
  SNAPSHOT_KEEPALIVE_TICKS,
  TICK_UNITS_PER_MS,
  TICK_UNITS_PER_TICK,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type LobbyState,
  type RoomCloseReason,
  type RoomSync,
  type ServerMessage,
} from '../src/net/protocol';
import { WORLD1_IDS, campaignFrom, hasLevel } from '../src/sim/levels/index';
import { encodeSnapshot } from '../src/sim/serialize';
import { allowedCommands, createSim, stepSim } from '../src/sim/sim';
import type { PlayerCommand, PlayerId, SimConfig, SimEvent, SimState } from '../src/sim/types';
import { IMMEDIATE_SNAPSHOT_EVENTS, PLAYER_NAMES } from '../src/sim/types';

export type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  /** ws-level ping frame; the browser answers without running page script. */
  ping(): void;
  readyState: number;
  isAlive: boolean;
  ip: string;
  bufferedAmount: number;
};

export type Slot = { socket: SocketLike | null; token: string; name: string; disconnectedAt: number | null; sentEventIndex: number };

export type Room = {
  code: string;
  createdAt: number;
  lastInboundAt: number;
  slots: [Slot, Slot | null];
  lobby: LobbyState;
  sim: SimState | null;
  config: SimConfig | null;
  /** integer, units of 1/60 ms (TICK_UNITS_PER_MS); one tick = TICK_UNITS_PER_TICK */
  accUnits: number;
  lastTickAt: number;
  paused: boolean;
  /** ONE ordered queue; an incoming setAim REPLACES the last unsent setAim from the same slot IN PLACE */
  pending: PlayerCommand[];
  /** events[k] has absolute index eventBase + k; trimmed past min(sentEventIndex) */
  events: SimEvent[];
  eventBase: number;
  ticksSinceSnapshot: number;
  dirty: boolean;
  immediate: boolean;
  /** Creator's ip, for LIMITS.maxRoomsPerIp. */
  hostIp: string;
};

export type RoomManagerOptions = {
  /** monotonic ms; performance.now */
  now?: () => number;
  /** token source */
  random?: () => string;
  log?: (msg: string) => void;
};

type Bucket = { tokens: number; refilledAt: number };

/** Per-socket bookkeeping: handshake, room membership, rate limits. */
type Conn = {
  socket: SocketLike;
  openedAt: number;
  /** Last inbound frame or ws pong. */
  lastSeenAt: number;
  /** When the silence probe was sent; null while the socket is talking. */
  probedAt: number | null;
  helloed: boolean;
  name: string | null;
  room: Room | null;
  slot: PlayerId | null;
  badAt: number[];
  messages: Bucket;
  aims: Bucket;
  /** One RATE_LIMITED reply per dry spell; further excess frames are dropped silently. */
  rateLimited: boolean;
};

const WS_OPEN = 1;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_TRY_AGAIN_LATER = 1013;
const MAX_EVENT_BUFFER = 2000;
/** A socket that has not completed the handshake by then is closed; pongs alone keep nothing alive. */
export const HELLO_TIMEOUT_MS = 5000;
/** Open sockets per client ip (two players plus generous reconnect/tab slack); more => SERVER_FULL + 1013. */
export const MAX_SOCKETS_PER_IP = 16;
/** A helloed socket with no inbound frame for this long (five missed client pings) is probed with a ws ping. */
export const SILENT_PROBE_AFTER_MS = 10_000;
/** No pong (or frame) this long after the probe => the link is dead: terminate and run the disconnect logic. */
export const SILENT_PROBE_TIMEOUT_MS = 5000;
const MAX_CATCHUP_UNITS = MAX_CATCHUP_MS * TICK_UNITS_PER_MS;
const UINT32_RANGE = 0x100000000;

function defaultToken(): string {
  return randomBytes(16).toString('hex');
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  return code;
}

function isImmediateEvent(e: SimEvent): boolean {
  return IMMEDIATE_SNAPSHOT_EVENTS.includes(e.type);
}

/** Anything a client renders differently: phase, turn, aims, strokes, balls, switches. */
function simChanged(a: SimState, b: SimState): boolean {
  if (a.phase !== b.phase || a.activePlayer !== b.activePlayer || a.turnDelayTicks !== b.turnDelayTicks) return true;
  if (a.levelIndex !== b.levelIndex || a.campaign.length !== b.campaign.length) return true;
  for (const i of [0, 1] as const) {
    const pa = a.players[i];
    const pb = b.players[i];
    if (pa.strokes !== pb.strokes || pa.aim.angle !== pb.aim.angle || pa.aim.power !== pb.aim.power) return true;
    const ba = a.balls[i];
    const bb = b.balls[i];
    if (ba.pos.x !== bb.pos.x || ba.pos.y !== bb.pos.y || ba.vel.x !== bb.vel.x || ba.vel.y !== bb.vel.y) return true;
    if (ba.asleep !== bb.asleep || ba.sunk !== bb.sunk || ba.grounded !== bb.grounded) return true;
  }
  for (const key of Object.keys(b.switches)) if (a.switches[key] !== b.switches[key]) return true;
  return false;
}

function takeToken(bucket: Bucket, ratePerSecond: number, capacity: number, now: number): boolean {
  const elapsed = Math.max(0, now - bucket.refilledAt);
  bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed * ratePerSecond) / 1000);
  bucket.refilledAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export class RoomManager {
  readonly options: RoomManagerOptions;
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly log: (msg: string) => void;
  private readonly conns = new Map<SocketLike, Conn>();
  private readonly rooms = new Map<string, Room>();
  private readonly roomsByIp = new Map<string, number>();
  private readonly socketsByIp = new Map<string, number>();

  constructor(opts: RoomManagerOptions = {}) {
    this.options = opts;
    this.now = opts.now ?? (() => performance.now());
    this.random = opts.random ?? defaultToken;
    this.log = opts.log ?? (() => undefined);
  }

  // -------------------------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------------------------

  /** Registers the socket, or refuses it (SERVER_FULL, close 1013) when its ip already holds MAX_SOCKETS_PER_IP. */
  handleOpen(socket: SocketLike): void {
    if (this.conns.has(socket)) return;
    const now = this.now();
    const perIp = this.socketsByIp.get(socket.ip) ?? 0;
    if (perIp >= MAX_SOCKETS_PER_IP) {
      this.sendError(socket, 'SERVER_FULL');
      socket.close(CLOSE_TRY_AGAIN_LATER, 'too many connections');
      return;
    }
    this.socketsByIp.set(socket.ip, perIp + 1);
    this.conns.set(socket, {
      socket,
      openedAt: now,
      lastSeenAt: now,
      probedAt: null,
      helloed: false,
      name: null,
      room: null,
      slot: null,
      badAt: [],
      messages: { tokens: LIMITS.messagesPerSecond, refilledAt: now },
      aims: { tokens: LIMITS.setAimPerSecond, refilledAt: now },
      rateLimited: false,
    });
  }

  /** parseClientMessage -> dispatch; never throws. */
  handleMessage(socket: SocketLike, raw: string): void {
    const conn = this.conns.get(socket);
    if (conn === undefined) return;
    this.markSeen(conn);
    try {
      this.dispatch(conn, raw);
    } catch (err) {
      this.log(`handleMessage failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      if (conn.room !== null) this.failRoom(conn.room);
    }
  }

  /** ws-level pong: answers both the heartbeat sweep (`isAlive`) and the silence probe. */
  handlePong(socket: SocketLike): void {
    socket.isAlive = true;
    const conn = this.conns.get(socket);
    if (conn !== undefined) this.markSeen(conn);
  }

  /** Starts reconnect grace or closes the room. Idempotent: unknown sockets are ignored. */
  handleClose(socket: SocketLike): void {
    const conn = this.conns.get(socket);
    if (conn === undefined) return;
    this.conns.delete(socket);
    this.releaseIp(socket.ip);
    const { room, slot } = conn;
    if (room === null || slot === null) return;
    this.detachSlot(room, slot);
  }

  /** Called every 8 ms by index.ts: handshake and silence sweep, then the per-room integer accumulator. */
  tickAll(nowMs: number): void {
    this.reapSilentSockets(nowMs);
    for (const room of [...this.rooms.values()]) {
      try {
        this.expireRoom(room, nowMs);
        if (!this.rooms.has(room.code)) continue;
        this.tickRoom(room, nowMs);
      } catch (err) {
        this.log(`room ${room.code} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        this.failRoom(room);
      }
    }
  }

  /** Every LIMITS.heartbeatMs: terminate sockets that did not answer the previous ping. */
  heartbeat(): void {
    for (const conn of [...this.conns.values()]) {
      if (conn.socket.isAlive) continue;
      conn.socket.terminate();
      this.handleClose(conn.socket);
    }
  }

  /** roomClosed{serverShutdown} to everyone; every socket closed. */
  shutdown(): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room, 'serverShutdown');
    for (const conn of [...this.conns.values()]) {
      conn.socket.close(CLOSE_GOING_AWAY, 'server shutting down');
      this.conns.delete(conn.socket);
    }
    this.socketsByIp.clear();
  }

  /**
   * Sockets that never completed the handshake are closed once HELLO_TIMEOUT_MS has passed; helloed
   * sockets silent for SILENT_PROBE_AFTER_MS are probed, and terminated when the probe goes unanswered.
   */
  private reapSilentSockets(now: number): void {
    for (const conn of [...this.conns.values()]) {
      if (!conn.helloed) {
        if (now - conn.openedAt >= HELLO_TIMEOUT_MS) this.dropSocket(conn, CLOSE_POLICY_VIOLATION, 'no hello');
        continue;
      }
      if (now - conn.lastSeenAt < SILENT_PROBE_AFTER_MS) continue;
      if (conn.probedAt === null) {
        conn.probedAt = now;
        conn.socket.ping();
      } else if (now - conn.probedAt >= SILENT_PROBE_TIMEOUT_MS) {
        conn.socket.terminate();
        this.handleClose(conn.socket);
      }
    }
  }

  private markSeen(conn: Conn): void {
    conn.lastSeenAt = this.now();
    conn.probedAt = null;
  }

  private releaseIp(ip: string): void {
    const perIp = (this.socketsByIp.get(ip) ?? 0) - 1;
    if (perIp <= 0) this.socketsByIp.delete(ip);
    else this.socketsByIp.set(ip, perIp);
  }

  stats(): { rooms: number; sockets: number; playing: number } {
    let playing = 0;
    for (const room of this.rooms.values()) if (room.sim !== null) playing += 1;
    return { rooms: this.rooms.size, sockets: this.conns.size, playing };
  }

  // -------------------------------------------------------------------------------------------
  // Inbound frames
  // -------------------------------------------------------------------------------------------

  private dispatch(conn: Conn, raw: string): void {
    const now = this.now();
    const msg = parseClientMessage(raw);
    if (msg === null) {
      this.badMessage(conn, now);
      return;
    }
    if (msg.type === 'command' && msg.cmd.type === 'setAim') {
      if (!takeToken(conn.aims, LIMITS.setAimPerSecond, LIMITS.setAimPerSecond, now)) {
        // Over the aim budget: coalesce into the pending slot without charging the main bucket.
        if (conn.helloed) this.queueSetAim(conn, msg.cmd, now);
        return;
      }
    } else if (!takeToken(conn.messages, LIMITS.messagesPerSecond, LIMITS.messageBurst, now)) {
      if (!conn.rateLimited) this.sendError(conn.socket, 'RATE_LIMITED');
      conn.rateLimited = true;
      return;
    } else {
      conn.rateLimited = false;
    }
    if (!conn.helloed) {
      if (msg.type === 'hello') this.onHello(conn, msg, now);
      else this.badMessage(conn, now);
      return;
    }
    if (msg.type !== 'ping' && conn.room !== null) conn.room.lastInboundAt = now;
    switch (msg.type) {
      case 'hello':
        this.badMessage(conn, now);
        return;
      case 'createRoom':
        this.onCreateRoom(conn, now);
        return;
      case 'joinRoom':
        this.onJoinRoom(conn, msg.code, msg.reconnectToken, now);
        return;
      case 'leaveRoom':
        this.onLeaveRoom(conn);
        return;
      case 'setLevel':
        this.onSetLevel(conn, msg.levelId, now);
        return;
      case 'start':
        this.onStart(conn, msg.levelIds, now);
        return;
      case 'command':
        this.onCommand(conn, msg.cmd, now);
        return;
      case 'playAgain':
        this.onPlayAgain(conn, now);
        return;
      case 'ping':
        this.send(conn.socket, { type: 'pong', t: msg.t, serverTime: now, tick: conn.room?.sim?.tick ?? 0 });
        return;
    }
  }

  private badMessage(conn: Conn, now: number): void {
    this.sendError(conn.socket, 'BAD_MESSAGE');
    conn.badAt = conn.badAt.filter((t) => now - t < LIMITS.badMessageWindowMs);
    conn.badAt.push(now);
    if (conn.badAt.length >= LIMITS.badMessagesBeforeClose) this.dropSocket(conn, CLOSE_POLICY_VIOLATION, 'too many bad messages');
  }

  private onHello(conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>, now: number): void {
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.sendError(conn.socket, 'VERSION_MISMATCH');
      this.dropSocket(conn, CLOSE_PROTOCOL_ERROR, 'protocol version mismatch');
      return;
    }
    conn.helloed = true;
    conn.name = msg.name !== undefined && msg.name.trim().length > 0 ? msg.name.trim() : null;
    this.send(conn.socket, { type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: now });
  }

  private onCreateRoom(conn: Conn, now: number): void {
    if (conn.room !== null) {
      this.sendError(conn.socket, 'ALREADY_IN_ROOM');
      return;
    }
    const ip = conn.socket.ip;
    if (this.rooms.size >= LIMITS.maxRooms || (this.roomsByIp.get(ip) ?? 0) >= LIMITS.maxRoomsPerIp) {
      this.sendError(conn.socket, 'SERVER_FULL');
      return;
    }
    const code = this.uniqueCode();
    const host: Slot = { socket: conn.socket, token: this.random(), name: conn.name ?? PLAYER_NAMES[0], disconnectedAt: null, sentEventIndex: 0 };
    const room: Room = {
      code,
      createdAt: now,
      lastInboundAt: now,
      slots: [host, null],
      lobby: { levelId: WORLD1_IDS[0] ?? '', players: [true, false], names: [host.name, ''] },
      sim: null,
      config: null,
      accUnits: 0,
      lastTickAt: now,
      paused: false,
      pending: [],
      events: [],
      eventBase: 0,
      ticksSinceSnapshot: 0,
      dirty: false,
      immediate: false,
      hostIp: ip,
    };
    this.rooms.set(code, room);
    this.roomsByIp.set(ip, (this.roomsByIp.get(ip) ?? 0) + 1);
    conn.room = room;
    conn.slot = 0;
    this.send(conn.socket, { type: 'roomCreated', code, playerId: 0, reconnectToken: host.token, lobby: room.lobby });
  }

  private onJoinRoom(conn: Conn, code: string, token: string | undefined, now: number): void {
    if (conn.room !== null) {
      this.sendError(conn.socket, 'ALREADY_IN_ROOM');
      return;
    }
    const room = this.rooms.get(code);
    if (room === undefined) {
      this.sendError(conn.socket, 'ROOM_NOT_FOUND');
      return;
    }
    if (token !== undefined) {
      const slot = this.slotForToken(room, token);
      if (slot !== null) {
        this.reattachSlot(conn, room, slot, now);
        return;
      }
      // A stale guest token on an unstarted room with a free seat is just a fresh join.
      if (room.sim !== null || room.slots[1] !== null) {
        this.sendError(conn.socket, 'BAD_TOKEN');
        return;
      }
    }
    if (room.slots[1] !== null || room.sim !== null) {
      this.sendError(conn.socket, 'ROOM_FULL');
      return;
    }
    const guest: Slot = { socket: conn.socket, token: this.random(), name: conn.name ?? PLAYER_NAMES[1], disconnectedAt: null, sentEventIndex: 0 };
    room.slots[1] = guest;
    room.lobby = { ...room.lobby, players: [room.slots[0].socket !== null, true], names: [room.lobby.names[0], guest.name] };
    conn.room = room;
    conn.slot = 1;
    this.send(conn.socket, {
      type: 'joined',
      code,
      playerId: 1,
      reconnectToken: guest.token,
      peerConnected: room.slots[0].socket !== null,
      lobby: room.lobby,
    });
    this.sendToSlot(room, 0, { type: 'peerJoined', playerId: 1, name: guest.name });
    this.sendToSlot(room, 0, { type: 'lobbyState', lobby: room.lobby });
  }

  private slotForToken(room: Room, token: string): PlayerId | null {
    for (const i of [0, 1] as const) {
      const slot = room.slots[i];
      if (slot !== null && slot.token === token) return i;
    }
    return null;
  }

  /** Token rejoin: resume the slot, resync the client, unpause when both are back. */
  private reattachSlot(conn: Conn, room: Room, playerId: PlayerId, now: number): void {
    const slot = room.slots[playerId];
    if (slot === null) return;
    if (slot.socket !== null) this.evictSocket(slot.socket);
    slot.socket = conn.socket;
    slot.disconnectedAt = null;
    if (slot.sentEventIndex < room.eventBase) slot.sentEventIndex = room.eventBase + room.events.length;
    conn.room = room;
    conn.slot = playerId;
    room.lastInboundAt = now;
    room.lobby = { ...room.lobby, players: [room.slots[0].socket !== null, room.slots[1]?.socket != null] };
    const other = playerId === 0 ? 1 : 0;
    const peerConnected = room.slots[other]?.socket != null;
    const sync = this.syncFor(room, now);
    const joined: ServerMessage = {
      type: 'joined',
      code: room.code,
      playerId,
      reconnectToken: slot.token,
      peerConnected,
      lobby: room.lobby,
      ...(sync !== null ? { sync } : {}),
    };
    this.send(conn.socket, joined);
    this.sendToSlot(room, other, { type: 'peerReconnected', playerId });
    // Both had dropped: the returning player learns how long the absent partner's grace still runs.
    const otherSlot = room.slots[other];
    if (otherSlot !== null && otherSlot.disconnectedAt !== null) {
      const graceMs = Math.max(0, LIMITS.reconnectGraceMs - (now - otherSlot.disconnectedAt));
      this.send(conn.socket, { type: 'peerLeft', playerId: other, reason: 'disconnected', graceMs });
    }
    if (room.sim === null) {
      this.sendToSlot(room, other, { type: 'lobbyState', lobby: room.lobby });
      return;
    }
    if (room.paused && peerConnected) {
      room.paused = false;
      room.lastTickAt = now;
      room.accUnits = 0;
      this.broadcast(room, { type: 'paused', paused: false, reason: 'resumed' });
    }
  }

  /**
   * A valid token arrived while the seat still holds a socket: the old link is half-open (network switch,
   * sleep/wake) and the silence probe has not caught it yet, or a duplicate tab is taking over. Latest wins:
   * the old conn is cut loose from the room first so its eventual close cannot start a grace.
   */
  private evictSocket(socket: SocketLike): void {
    const old = this.conns.get(socket);
    if (old !== undefined) {
      old.room = null;
      old.slot = null;
    }
    socket.terminate();
    this.handleClose(socket);
  }

  private onLeaveRoom(conn: Conn): void {
    const { room, slot } = conn;
    if (room === null || slot === null) {
      this.sendError(conn.socket, 'NOT_IN_ROOM');
      return;
    }
    if (slot === 0) {
      this.closeRoom(room, 'hostLeft');
      return;
    }
    if (room.sim !== null) {
      this.closeRoom(room, 'guestLeft');
      return;
    }
    this.releaseGuest(room, 'left');
  }

  /** Guest gone from an unstarted room: back to WAITING with the same code. */
  private releaseGuest(room: Room, reason: 'left' | 'disconnected'): void {
    const guest = room.slots[1];
    if (guest === null) return;
    if (guest.socket !== null) {
      const conn = this.conns.get(guest.socket);
      if (conn !== undefined) {
        conn.room = null;
        conn.slot = null;
      }
    }
    room.slots[1] = null;
    room.lobby = { ...room.lobby, players: [room.slots[0].socket !== null, false], names: [room.lobby.names[0], ''] };
    this.sendToSlot(room, 0, { type: 'peerLeft', playerId: 1, reason, graceMs: 0 });
    this.sendToSlot(room, 0, { type: 'lobbyState', lobby: room.lobby });
    // A host inside its own reconnect grace keeps the room; `expireRoom` closes it if they never return.
  }

  private onSetLevel(conn: Conn, levelId: string, now: number): void {
    const room = this.requireRoom(conn);
    if (room === null) return;
    if (conn.slot !== 0) {
      this.sendError(conn.socket, 'NOT_HOST');
      return;
    }
    if (room.sim !== null) {
      this.sendError(conn.socket, 'WRONG_PHASE');
      return;
    }
    if (!hasLevel(levelId)) {
      this.badMessage(conn, now);
      return;
    }
    room.lobby = { ...room.lobby, levelId };
    this.broadcast(room, { type: 'lobbyState', lobby: room.lobby });
  }

  private onStart(conn: Conn, levelIds: string[] | undefined, now: number): void {
    const room = this.requireRoom(conn);
    if (room === null) return;
    if (conn.slot !== 0) {
      this.sendError(conn.socket, 'NOT_HOST');
      return;
    }
    if (room.sim !== null) {
      this.sendError(conn.socket, 'WRONG_PHASE');
      return;
    }
    if (room.slots[1] === null || room.slots[1].socket === null) {
      this.sendError(conn.socket, 'PEER_MISSING');
      return;
    }
    if (levelIds !== undefined && !levelIds.every(hasLevel)) {
      this.badMessage(conn, now);
      return;
    }
    const ids = levelIds ?? campaignFrom(room.lobby.levelId);
    this.startGame(room, { playerCount: 2, mode: 'online', seed: randomInt(UINT32_RANGE), levelIds: ids }, now);
  }

  private onPlayAgain(conn: Conn, now: number): void {
    const room = this.requireRoom(conn);
    if (room === null) return;
    if (conn.slot !== 0) {
      this.sendError(conn.socket, 'NOT_HOST');
      return;
    }
    if (room.sim === null || room.config === null || room.sim.phase !== 'campaignResults') {
      this.sendError(conn.socket, 'WRONG_PHASE');
      return;
    }
    // A partner inside reconnect grace: a new round would start frozen behind a `start` that cannot say so.
    if (room.paused || room.slots[1] === null || room.slots[1].socket === null) {
      this.sendError(conn.socket, 'PEER_MISSING');
      return;
    }
    this.startGame(room, { ...room.config, seed: randomInt(UINT32_RANGE) }, now);
  }

  private startGame(room: Room, config: SimConfig, now: number): void {
    const first = createSim(config);
    room.config = config;
    room.sim = first.state;
    room.events = first.events.filter((e) => e.type !== 'commandRejected');
    room.eventBase = 0;
    room.pending = [];
    room.accUnits = 0;
    room.lastTickAt = now;
    room.ticksSinceSnapshot = 0;
    room.dirty = false;
    room.immediate = false;
    // Both callers refuse with PEER_MISSING unless both seats are connected, and `start` carries no paused flag.
    room.paused = false;
    for (const slot of room.slots) if (slot !== null) slot.sentEventIndex = 0;
    const sync = this.syncFor(room, now);
    if (sync !== null) this.broadcast(room, { type: 'start', sync });
  }

  private onCommand(conn: Conn, cmd: PlayerCommand, now: number): void {
    const room = this.requireRoom(conn);
    if (room === null || conn.slot === null) return;
    const sim = room.sim;
    // No sim yet, or the sim is frozen behind a partner's reconnect grace: nothing may queue up.
    if (sim === null || room.paused) {
      if (cmd.type !== 'setAim') this.sendError(conn.socket, 'WRONG_PHASE');
      return;
    }
    const slot = conn.slot;
    const stamped: PlayerCommand = { ...cmd, playerId: slot };
    if (stamped.type === 'setAim') {
      this.queueSetAim(conn, stamped, now);
      return;
    }
    // `continue` is checked by the sim itself: the loser of a Tee off / Next hole race (the client's
    // phase lags render delay plus latency) gets an idempotent silent rejection, not an error toast.
    // Clients stamp meta commands with the screen they were pressed on (MetaScreen), so the sim also
    // drops a Next/Retry that lands after the other seat already moved the game off that screen.
    if (stamped.type !== 'continue' && !allowedCommands(sim, slot).includes(stamped.type)) {
      this.sendError(conn.socket, this.rejectionCode(sim, stamped));
      return;
    }
    room.pending.push(stamped);
  }

  /** setAim never errors: dropped silently unless it is the active slot's, then coalesced in place. */
  private queueSetAim(conn: Conn, cmd: PlayerCommand, now: number): void {
    const room = conn.room;
    if (room === null || room.sim === null || room.paused || conn.slot === null || cmd.type !== 'setAim') return;
    if (room.sim.phase !== 'aiming' || room.sim.activePlayer !== conn.slot) return;
    room.lastInboundAt = now;
    const stamped: PlayerCommand = { ...cmd, playerId: conn.slot };
    for (let i = room.pending.length - 1; i >= 0; i -= 1) {
      const queued = room.pending[i];
      if (queued !== undefined && queued.type === 'setAim' && queued.playerId === conn.slot) {
        room.pending[i] = stamped;
        return;
      }
    }
    room.pending.push(stamped);
  }

  private rejectionCode(sim: SimState, cmd: PlayerCommand): ErrorCode {
    if (cmd.type === 'restartLevel' && cmd.playerId !== 0) return 'NOT_HOST';
    if (cmd.type === 'shoot') return sim.phase === 'aiming' ? 'NOT_YOUR_TURN' : 'WRONG_PHASE';
    return 'WRONG_PHASE';
  }

  private requireRoom(conn: Conn): Room | null {
    if (conn.room === null) {
      this.sendError(conn.socket, 'NOT_IN_ROOM');
      return null;
    }
    return conn.room;
  }

  // -------------------------------------------------------------------------------------------
  // Ticking and snapshots
  // -------------------------------------------------------------------------------------------

  private tickRoom(room: Room, now: number): void {
    if (room.sim === null || room.paused) {
      room.lastTickAt = now;
      return;
    }
    room.accUnits = Math.min(room.accUnits + Math.round((now - room.lastTickAt) * TICK_UNITS_PER_MS), MAX_CATCHUP_UNITS);
    room.lastTickAt = now;
    let ticked = false;
    while (room.accUnits >= TICK_UNITS_PER_TICK) {
      this.stepRoom(room);
      room.accUnits -= TICK_UNITS_PER_TICK;
      ticked = true;
    }
    if (!ticked) return;
    const due =
      room.immediate ||
      (room.dirty && room.ticksSinceSnapshot >= SNAPSHOT_EVERY_TICKS) ||
      room.ticksSinceSnapshot >= SNAPSHOT_KEEPALIVE_TICKS;
    if (due) this.broadcastSnapshot(room, now);
  }

  private stepRoom(room: Room): void {
    const before = room.sim;
    if (before === null) return;
    const cmds = room.pending.splice(0);
    const r = stepSim(before, cmds);
    room.sim = r.state;
    const events = r.events.filter((e) => e.type !== 'commandRejected');
    for (const e of events) room.events.push(e);
    room.dirty = room.dirty || events.length > 0 || simChanged(before, r.state);
    room.immediate = room.immediate || events.some(isImmediateEvent);
    room.ticksSinceSnapshot += 1;
  }

  private broadcastSnapshot(room: Room, now: number): void {
    const sim = room.sim;
    if (sim === null) return;
    const snap = encodeSnapshot(sim);
    const end = room.eventBase + room.events.length;
    for (const slot of room.slots) {
      if (slot === null || slot.socket === null) continue;
      if (slot.socket.bufferedAmount > MAX_SOCKET_BACKLOG_BYTES) continue;
      const from = Math.max(slot.sentEventIndex, room.eventBase);
      const events = room.events.slice(from - room.eventBase);
      this.send(slot.socket, { type: 'snapshot', tick: sim.tick, serverTime: now, snap, events, immediate: room.immediate });
      slot.sentEventIndex = end;
    }
    this.trimEvents(room);
    room.dirty = false;
    room.immediate = false;
    room.ticksSinceSnapshot = 0;
  }

  /** Drop events every live slot has received; cap the buffer so a long absence cannot grow it unbounded. */
  private trimEvents(room: Room): void {
    let minSent = room.eventBase + room.events.length;
    for (const slot of room.slots) if (slot !== null) minSent = Math.min(minSent, slot.sentEventIndex);
    let drop = Math.max(0, minSent - room.eventBase);
    const overflow = room.events.length - drop - MAX_EVENT_BUFFER;
    if (overflow > 0) drop += overflow;
    if (drop === 0) return;
    room.events.splice(0, drop);
    room.eventBase += drop;
  }

  private syncFor(room: Room, now: number): RoomSync | null {
    if (room.sim === null || room.config === null) return null;
    return { config: room.config, tick: room.sim.tick, snap: encodeSnapshot(room.sim), serverTime: now };
  }

  // -------------------------------------------------------------------------------------------
  // Presence, grace and expiry
  // -------------------------------------------------------------------------------------------

  private detachSlot(room: Room, playerId: PlayerId): void {
    const slot = room.slots[playerId];
    if (slot === null) return;
    const now = this.now();
    if (playerId === 1 && room.sim === null) {
      this.releaseGuest(room, 'disconnected');
      return;
    }
    slot.socket = null;
    slot.disconnectedAt = now;
    room.lobby = { ...room.lobby, players: [room.slots[0].socket !== null, room.slots[1]?.socket != null] };
    const other = playerId === 0 ? 1 : 0;
    const otherSlot = room.slots[other];
    // WAITING host blip (phone backgrounded while pasting the invite): the code and the invite link keep
    // working for the grace window; `expireRoom` closes the room as peerTimeout if the host never returns.
    if (otherSlot === null) return;
    // Both gone (shared Wi-Fi blip, one heartbeat sweep catching both): the room waits for the first of the
    // two graces to lapse, exactly what each client's "Reconnecting… N s left" promises.
    if (otherSlot.socket !== null) this.sendToSlot(room, other, { type: 'peerLeft', playerId, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    if (room.sim === null) return;
    room.paused = true;
    room.pending = [];
    room.lastTickAt = now;
    this.sendToSlot(room, other, { type: 'paused', paused: true, reason: 'peerDisconnected' });
  }

  private expireRoom(room: Room, now: number): void {
    if (room.sim === null && now - room.createdAt >= LIMITS.lobbyWaitMs) {
      this.closeRoom(room, 'idle');
      return;
    }
    if (now - room.lastInboundAt >= LIMITS.roomIdleMs) {
      this.closeRoom(room, 'idle');
      return;
    }
    for (const slot of room.slots) {
      if (slot === null || slot.disconnectedAt === null) continue;
      if (now - slot.disconnectedAt >= LIMITS.reconnectGraceMs) {
        this.closeRoom(room, 'peerTimeout');
        return;
      }
    }
  }

  private failRoom(room: Room): void {
    this.broadcast(room, { type: 'error', code: 'INTERNAL', message: ERROR_COPY.INTERNAL });
    this.closeRoom(room, 'internalError');
  }

  private closeRoom(room: Room, reason: RoomCloseReason): void {
    this.broadcast(room, { type: 'roomClosed', reason });
    this.destroyRoom(room);
  }

  private destroyRoom(room: Room): void {
    if (!this.rooms.delete(room.code)) return;
    const perIp = (this.roomsByIp.get(room.hostIp) ?? 0) - 1;
    if (perIp <= 0) this.roomsByIp.delete(room.hostIp);
    else this.roomsByIp.set(room.hostIp, perIp);
    for (const slot of room.slots) {
      if (slot === null || slot.socket === null) continue;
      const conn = this.conns.get(slot.socket);
      if (conn !== undefined) {
        conn.room = null;
        conn.slot = null;
      }
    }
    room.sim = null;
  }

  private uniqueCode(): string {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    return code;
  }

  // -------------------------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------------------------

  private send(socket: SocketLike, msg: ServerMessage): void {
    if (socket.readyState !== WS_OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      this.log(`send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private sendError(socket: SocketLike, code: ErrorCode): void {
    this.send(socket, { type: 'error', code, message: ERROR_COPY[code] });
  }

  private sendToSlot(room: Room, playerId: PlayerId, msg: ServerMessage): void {
    const socket = room.slots[playerId]?.socket;
    if (socket != null) this.send(socket, msg);
  }

  private broadcast(room: Room, msg: ServerMessage): void {
    for (const slot of room.slots) if (slot !== null && slot.socket !== null) this.send(slot.socket, msg);
  }

  /** Close a socket for cause and run its disconnect logic now (ws emits 'close' later; that is then a no-op). */
  private dropSocket(conn: Conn, code: number, reason: string): void {
    conn.socket.close(code, reason);
    this.handleClose(conn.socket);
  }
}
