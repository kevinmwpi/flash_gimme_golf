// OWNER: net
/**
 * Browser side of the room protocol (ARCH.md §1.14, §2.2; BUILD_DECISIONS D3 CD-6). Owns the socket,
 * the snapshot ring (SNAPSHOT_RING_SIZE), the per-snapshot event buffer, the clock-offset EMA,
 * setAim coalescing (<= LIMITS.setAimPerSecond, flushed before shoot/continue/restartLevel) and the
 * sessionStorage 'fg.reconnect' token. A SerializeError from decodeSnapshot becomes status
 * error{BAD_SNAPSHOT} and never throws into the RAF loop. `leave()` marks the close intentional so
 * Cancel/Leave never surface an error.
 *
 * Liveness: a ping goes out every PING_INTERVAL_MS and any inbound frame answers it. With no reply for
 * LINK_STALE_MS `linkStale()` turns the net pill `--bad` (UX.md §4.1 row BR); after LINK_DEAD_MS the
 * socket is torn down and the reconnect loop runs, because a half-open WebSocket (Wi-Fi to LTE, router
 * reboot, sleep/wake) stays OPEN in the browser for a minute or more before `close` ever fires.
 */
import { SerializeError, decodeSnapshot } from '../sim/serialize';
import type { BallState, PlayerCommand, PlayerId, SimConfig, SimEvent, SimState } from '../sim/types';
import { IMMEDIATE_SNAPSHOT_EVENTS } from '../sim/types';
import {
  CLIENT_RENDER_DELAY_MS,
  ERROR_COPY,
  LIMITS,
  MAX_EXTRAPOLATION_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_GAP_DISCONTINUITY_MS,
  SNAPSHOT_RING_SIZE,
  parseServerMessage,
  type ClientMessage,
  type ErrorCode,
  type LobbyState,
  type RoomCloseReason,
  type RoomSync,
  type ServerMessage,
} from './protocol';

export type ClientStatus =
  | { kind: 'idle' }
  | { kind: 'connecting'; attempt: number }
  /** host in lobby */
  | { kind: 'waiting'; code: string; inviteUrl: string; peerConnected: boolean; lobby: LobbyState }
  /** guest in lobby */
  | { kind: 'joined'; code: string; peerConnected: boolean; lobby: LobbyState }
  /** `peerDeadlineMs` (now() clock) is set while the partner is inside their reconnect grace. */
  | { kind: 'playing'; code: string; seat: PlayerId; paused: boolean; peerConnected: boolean; peerDeadlineMs?: number }
  /** `deadlineMs` = dropAt + LIMITS.reconnectGraceMs (D3 CD-6), in the now() clock */
  | { kind: 'reconnecting'; code: string; attempt: number; deadlineMs: number }
  | { kind: 'closed'; reason: RoomCloseReason | 'left' | 'serverUnreachable' | 'timeout'; message: string }
  | { kind: 'error'; code: ErrorCode | 'BAD_SNAPSHOT'; message: string; recoverable: boolean };

export type InterpolatedState = { state: SimState; prev: SimState; alpha: number; snap: boolean };

/** The slice of a WebSocket the client uses; tests substitute a fake through `createSocket`. */
export type SocketHandle = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: (() => void) | null;
};

export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export type GameClientOptions = {
  url: string;
  name?: string;
  /** default 8000 */
  connectTimeoutMs?: number;
  /** default performance.now */
  now?: () => number;
  /** default: a browser WebSocket */
  createSocket?: (url: string) => SocketHandle;
  /** default: window.sessionStorage (null when unavailable) */
  storage?: StorageLike | null;
  /** Prefix of invite links; default `${location.origin}${location.pathname}` */
  inviteBase?: string;
};

export type ServerErrorListener = (code: ErrorCode, message: string) => void;

type RingEntry = { state: SimState; serverTime: number; tick: number; discontinuity: boolean };
type EventBatch = { serverTime: number; events: SimEvent[] };
type Session = { code: string; token: string; seat: PlayerId };

export const RECONNECT_STORAGE_KEY = 'fg.reconnect';
export const RECONNECT_RETRY_MS = 2000;
export const PING_INTERVAL_MS = 2000;
/** No frame of any kind for this long after a ping: the net pill goes `--bad`. */
export const LINK_STALE_MS = 3000;
/** Three pings unanswered: the socket is half-open; drop it and reconnect through the server grace. */
export const LINK_DEAD_MS = 3 * PING_INTERVAL_MS;
const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const AIM_INTERVAL_MS = 1000 / LIMITS.setAimPerSecond;
const OFFSET_EMA = 0.1;
const RTT_EMA = 0.3;
/** An offset sample this far from the estimate is a clock step or a long stall: adopt it outright. */
const OFFSET_RESET_MS = 500;
const RECOVERABLE: readonly ErrorCode[] = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'SERVER_FULL', 'PEER_MISSING', 'RATE_LIMITED'];
const CLOSE_NORMAL = 1000;
/** Application close code (4000-4999 are free for apps) for a socket the watchdog gave up on. */
const CLOSE_LINK_DEAD = 4000;
/**
 * Event batches older than this (behind render time) are history, not news: a tab that was hidden
 * re-syncs from the next snapshot (UX.md §11) instead of replaying every buffered hit and toast.
 * Wide enough that an ordinary frame hitch loses nothing.
 */
export const EVENT_REPLAY_WINDOW_MS = 500;

function browserSocket(url: string): SocketHandle {
  const ws = new WebSocket(url);
  const handle: SocketHandle = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    get readyState() {
      return ws.readyState;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => handle.onopen?.();
  ws.onmessage = (ev) => handle.onmessage?.(typeof ev.data === 'string' ? ev.data : '');
  ws.onclose = (ev) => handle.onclose?.(ev.code, ev.reason);
  ws.onerror = () => handle.onerror?.();
  return handle;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function defaultInviteBase(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

function readSession(storage: StorageLike | null): Session | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(RECONNECT_STORAGE_KEY);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { code, token, seat } = v as Record<string, unknown>;
    if (typeof code !== 'string' || typeof token !== 'string' || (seat !== 0 && seat !== 1)) return null;
    return { code, token, seat };
  } catch {
    return null;
  }
}

/** Same game: a rejoin sync for the running campaign must not replace the config object App keys on. */
function sameConfig(a: SimConfig, b: SimConfig): boolean {
  return (
    a.seed === b.seed &&
    a.mode === b.mode &&
    a.playerCount === b.playerCount &&
    a.levelIds.length === b.levelIds.length &&
    a.levelIds.every((id, i) => id === b.levelIds[i])
  );
}

function extrapolateBalls(state: SimState, dtSec: number): SimState {
  const move = (b: Readonly<BallState>): BallState =>
    b.sunk || b.asleep ? { ...b } : { ...b, pos: { x: b.pos.x + b.vel.x * dtSec, y: b.pos.y + b.vel.y * dtSec } };
  return { ...state, balls: [move(state.balls[0]), move(state.balls[1])] };
}

const ROOM_CLOSED_COPY: Readonly<Record<RoomCloseReason, string>> = Object.freeze({
  hostLeft: 'Red left the game. Thanks for playing together.',
  guestLeft: 'Blue left the game. Thanks for playing together.',
  peerTimeout: "Your partner didn't come back in time.",
  idle: 'The room was closed after sitting idle.',
  serverShutdown: 'The server is restarting. Create a new room in a moment.',
  internalError: ERROR_COPY.INTERNAL,
});

export class GameClient {
  readonly options: GameClientOptions;
  private status: ClientStatus = { kind: 'idle' };
  private readonly listeners = new Set<(s: ClientStatus) => void>();
  private readonly errorListeners = new Set<ServerErrorListener>();
  private readonly now: () => number;
  private readonly storage: StorageLike | null;

  private socket: SocketHandle | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeReconnect: (() => void) | null = null;
  /** What to send once `welcome` arrives, and how to settle the pending connect promise. */
  private afterWelcome: ClientMessage | null = null;
  private settle: ((joined: boolean) => void) | null = null;

  private session: Session | null = null;
  private config: SimConfig | null = null;
  private peerDeadlineMs: number | undefined;

  private readonly ring: RingEntry[] = [];
  private readonly eventQueue: EventBatch[] = [];
  private lastBaseTime = Number.NEGATIVE_INFINITY;
  private clockOffset: number | null = null;
  private rtt = 0;
  private pingSentAt: number | null = null;
  /** Time of the oldest ping still unanswered by any inbound frame; null while the link is talking. */
  private silentSince: number | null = null;
  private heldAim: PlayerCommand | null = null;
  private lastAimSentAt = Number.NEGATIVE_INFINITY;

  constructor(opts: GameClientOptions) {
    this.options = opts;
    this.now = opts.now ?? (() => performance.now());
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  }

  subscribe(listener: (s: ClientStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Non-fatal server errors while in a room (NOT_YOUR_TURN, WRONG_PHASE, RATE_LIMITED, …). */
  onServerError(listener: ServerErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  getStatus(): ClientStatus {
    return this.status;
  }

  getConfig(): SimConfig | null {
    return this.config;
  }

  // -------------------------------------------------------------------------------------------
  // Connecting
  // -------------------------------------------------------------------------------------------

  /** idempotent: closes any previous socket first */
  createRoom(): Promise<void> {
    return this.connect({ type: 'createRoom' }, 1).then(() => undefined);
  }

  joinRoom(code: string): Promise<void> {
    return this.connect({ type: 'joinRoom', code: code.trim().toUpperCase() }, 1).then(() => undefined);
  }

  /**
   * Rejoin with the sessionStorage token, retrying every RECONNECT_RETRY_MS until
   * dropAt + LIMITS.reconnectGraceMs (D3 CD-6). Resolves true once the room answered `joined`.
   */
  async tryReconnect(): Promise<boolean> {
    const session = this.session ?? readSession(this.storage);
    if (session === null) return false;
    this.session = session;
    return this.reconnectLoop(session, this.now() + LIMITS.reconnectGraceMs);
  }

  private async reconnectLoop(session: Session, deadlineMs: number): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      this.setStatus({ kind: 'reconnecting', code: session.code, attempt, deadlineMs });
      const joined = await this.connect({ type: 'joinRoom', code: session.code, reconnectToken: session.token }, attempt, true);
      if (joined) return true;
      if (this.status.kind === 'error' || this.status.kind === 'closed') return false;
      if (this.now() + RECONNECT_RETRY_MS > deadlineMs) {
        this.clearSession();
        this.setStatus({ kind: 'closed', reason: 'timeout', message: 'Could not reconnect in time. The room has moved on.' });
        return false;
      }
      await this.sleep(RECONNECT_RETRY_MS);
      if (this.status.kind !== 'reconnecting') return false;
    }
  }

  /** Resolves after `ms`, or at once when `leave()` cancels the wait. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.wakeReconnect = null;
        resolve();
      };
      this.wakeReconnect = done;
      this.reconnectTimer = setTimeout(done, ms);
    });
  }

  /** Opens a socket, says hello, sends `first` after welcome; resolves true when a room answered. */
  private connect(first: ClientMessage, attempt: number, reconnecting = false): Promise<boolean> {
    this.finishConnect(false);
    this.teardownSocket();
    if (!reconnecting) this.setStatus({ kind: 'connecting', attempt });
    this.afterWelcome = first;
    return new Promise((resolve) => {
      this.settle = resolve;
      const create = this.options.createSocket ?? browserSocket;
      let socket: SocketHandle;
      try {
        socket = create(this.options.url);
      } catch {
        this.finishConnect(false);
        this.setStatus({ kind: 'closed', reason: 'serverUnreachable', message: 'Could not reach the game server.' });
        return;
      }
      this.socket = socket;
      socket.onopen = () => this.onOpen(socket);
      socket.onmessage = (data) => this.onMessage(socket, data);
      socket.onclose = () => this.onClose(socket);
      socket.onerror = () => undefined;
      this.connectTimer = setTimeout(() => {
        if (this.socket !== socket || this.inRoom()) return;
        this.teardownSocket();
        this.finishConnect(false);
        if (this.status.kind === 'connecting') {
          this.setStatus({ kind: 'closed', reason: 'timeout', message: 'The game server did not answer in time.' });
        }
      }, this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    });
  }

  private onOpen(socket: SocketHandle): void {
    if (this.socket !== socket) return;
    const hello: ClientMessage =
      this.options.name !== undefined ? { type: 'hello', protocol: PROTOCOL_VERSION, name: this.options.name } : { type: 'hello', protocol: PROTOCOL_VERSION };
    this.sendRaw(hello);
  }

  /** Unexpected close (intentional closes detach the handlers first, so they never get here). */
  private onClose(socket: SocketHandle): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopTimers();
    this.finishConnect(false);
    const session = this.session;
    if (this.inRoom() && session !== null) {
      void this.reconnectLoop(session, this.now() + LIMITS.reconnectGraceMs);
      return;
    }
    // A failed reconnect attempt keeps the reconnecting status; the loop decides what is next.
    if (this.status.kind === 'connecting') {
      this.setStatus({ kind: 'closed', reason: 'serverUnreachable', message: 'Could not reach the game server.' });
    }
  }

  private finishConnect(joined: boolean): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const settle = this.settle;
    this.settle = null;
    settle?.(joined);
  }

  private inRoom(): boolean {
    const k = this.status.kind;
    return k === 'waiting' || k === 'joined' || k === 'playing';
  }

  // -------------------------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------------------------

  private onMessage(socket: SocketHandle, data: string): void {
    if (this.socket !== socket) return;
    this.silentSince = null;
    const msg = parseServerMessage(data);
    if (msg === null) return;
    const now = this.now();
    switch (msg.type) {
      case 'welcome':
        this.clockOffset = msg.serverTime - now;
        this.startPinging();
        if (this.afterWelcome !== null) {
          this.sendRaw(this.afterWelcome);
          this.afterWelcome = null;
        }
        return;
      case 'roomCreated':
        this.session = { code: msg.code, token: msg.reconnectToken, seat: 0 };
        this.saveSession();
        this.setStatus({ kind: 'waiting', code: msg.code, inviteUrl: this.inviteUrl(msg.code), peerConnected: false, lobby: msg.lobby });
        this.finishConnect(true);
        return;
      case 'joined':
        this.onJoined(msg);
        return;
      case 'peerJoined':
        this.updateLobby((lobby) => ({ ...lobby, players: msg.playerId === 0 ? [true, lobby.players[1]] : [lobby.players[0], true] }), true);
        return;
      case 'lobbyState':
        this.updateLobby(() => msg.lobby, msg.lobby.players[this.peerSeat()]);
        return;
      case 'peerLeft':
        this.onPeerLeft(msg.graceMs, now);
        return;
      case 'peerReconnected':
        this.peerDeadlineMs = undefined;
        this.setPeerConnected(true);
        return;
      case 'start':
        this.onStart(msg.sync, now);
        return;
      case 'snapshot':
        this.onSnapshot(msg, now);
        return;
      case 'paused':
        if (this.status.kind === 'playing') this.setStatus({ ...this.status, paused: msg.paused });
        return;
      case 'roomClosed':
        this.onRoomClosed(msg.reason);
        return;
      case 'pong':
        this.onPong(msg.t, msg.serverTime, now);
        return;
      case 'error':
        this.onError(msg.code, msg.message);
        return;
    }
  }

  private onJoined(msg: Extract<ServerMessage, { type: 'joined' }>): void {
    this.session = { code: msg.code, token: msg.reconnectToken, seat: msg.playerId };
    this.saveSession();
    if (msg.sync !== undefined) {
      if (!this.applySync(msg.sync, this.now())) return;
      this.setStatus({ kind: 'playing', code: msg.code, seat: msg.playerId, paused: !msg.peerConnected, peerConnected: msg.peerConnected });
    } else if (msg.playerId === 0) {
      this.setStatus({ kind: 'waiting', code: msg.code, inviteUrl: this.inviteUrl(msg.code), peerConnected: msg.peerConnected, lobby: msg.lobby });
    } else {
      this.setStatus({ kind: 'joined', code: msg.code, peerConnected: msg.peerConnected, lobby: msg.lobby });
    }
    this.finishConnect(true);
  }

  private onStart(sync: RoomSync, now: number): void {
    const session = this.session;
    if (session === null || !this.applySync(sync, now)) return;
    this.setStatus({ kind: 'playing', code: session.code, seat: session.seat, paused: false, peerConnected: true });
  }

  /** Clears the ring and seeds it from a sync. Returns false (and fails the client) on a bad snapshot. */
  private applySync(sync: RoomSync, now: number): boolean {
    const config = this.config !== null && sameConfig(this.config, sync.config) ? this.config : sync.config;
    this.config = config;
    this.ring.length = 0;
    this.eventQueue.length = 0;
    this.lastBaseTime = Number.NEGATIVE_INFINITY;
    const state = this.decode(sync.snap, config);
    if (state === null) return false;
    this.observeServerTime(sync.serverTime, now);
    this.ring.push({ state, serverTime: sync.serverTime, tick: sync.tick, discontinuity: true });
    return true;
  }

  private onSnapshot(msg: Extract<ServerMessage, { type: 'snapshot' }>, now: number): void {
    const config = this.config;
    if (config === null) return;
    const state = this.decode(msg.snap, config);
    if (state === null) return;
    this.observeServerTime(msg.serverTime, now);
    const last = this.ring[this.ring.length - 1];
    if (last !== undefined && msg.serverTime <= last.serverTime) {
      if (msg.tick > last.tick) this.ring[this.ring.length - 1] = { ...last, state, tick: msg.tick };
      this.queueEvents(msg.serverTime, msg.events, now);
      return;
    }
    const gap = last === undefined ? Number.POSITIVE_INFINITY : msg.serverTime - last.serverTime;
    const discontinuity = gap > SNAPSHOT_GAP_DISCONTINUITY_MS || msg.immediate || msg.events.some((e) => IMMEDIATE_SNAPSHOT_EVENTS.includes(e.type));
    this.ring.push({ state, serverTime: msg.serverTime, tick: msg.tick, discontinuity });
    if (this.ring.length > SNAPSHOT_RING_SIZE) this.ring.splice(0, this.ring.length - SNAPSHOT_RING_SIZE);
    this.queueEvents(msg.serverTime, msg.events, now);
  }

  /** Buffers a snapshot's events and forgets batches no frame will ever want (the RAF loop stops while hidden; messages do not). */
  private queueEvents(serverTime: number, events: SimEvent[], now: number): void {
    if (events.length > 0) this.eventQueue.push({ serverTime, events });
    this.dropStaleEvents(this.renderTime(now));
  }

  private dropStaleEvents(renderTimeMs: number): void {
    const cutoff = renderTimeMs - EVENT_REPLAY_WINDOW_MS;
    let stale = 0;
    while (stale < this.eventQueue.length && (this.eventQueue[stale] as EventBatch).serverTime < cutoff) stale += 1;
    if (stale > 0) this.eventQueue.splice(0, stale);
  }

  private decode(snap: unknown, config: SimConfig): SimState | null {
    try {
      return decodeSnapshot(snap, config);
    } catch (err) {
      if (!(err instanceof SerializeError)) throw err;
      this.teardownSocket();
      this.finishConnect(false);
      this.clearSession();
      this.setStatus({ kind: 'error', code: 'BAD_SNAPSHOT', message: 'The server sent a game state this build cannot read. Reload the page.', recoverable: false });
      return null;
    }
  }

  private onPeerLeft(graceMs: number, now: number): void {
    this.peerDeadlineMs = graceMs > 0 ? now + graceMs : undefined;
    this.setPeerConnected(false);
  }

  private onRoomClosed(reason: RoomCloseReason): void {
    this.clearSession();
    this.teardownSocket();
    this.finishConnect(false);
    this.setStatus({ kind: 'closed', reason, message: ROOM_CLOSED_COPY[reason] });
  }

  private onPong(t: number, serverTime: number, now: number): void {
    if (this.pingSentAt === null || t !== this.pingSentAt) return;
    this.pingSentAt = null;
    const sample = now - t;
    this.rtt = this.rtt === 0 ? sample : this.rtt + (sample - this.rtt) * RTT_EMA;
    this.observeServerTime(serverTime, now);
  }

  private onError(code: ErrorCode, message: string): void {
    const fatal = code === 'VERSION_MISMATCH' || !this.inRoom();
    if (!fatal) {
      for (const listener of this.errorListeners) listener(code, message);
      return;
    }
    // A refused rejoin has nothing left to recover: the room is gone and the session is dropped.
    const recoverable = RECOVERABLE.includes(code) && this.status.kind !== 'reconnecting';
    if (!recoverable) this.clearSession();
    this.teardownSocket();
    this.finishConnect(false);
    this.setStatus({ kind: 'error', code, message: ERROR_COPY[code], recoverable });
  }

  // -------------------------------------------------------------------------------------------
  // Lobby / game actions
  // -------------------------------------------------------------------------------------------

  /** host, lobby */
  setLevel(levelId: string): void {
    this.sendRaw({ type: 'setLevel', levelId });
  }

  /** host */
  start(levelIds?: string[]): void {
    this.sendRaw(levelIds !== undefined ? { type: 'start', levelIds } : { type: 'start' });
  }

  playAgain(): void {
    this.sendRaw({ type: 'playAgain' });
  }

  /**
   * setAim is held and coalesced (latest wins); shoot/continue/restartLevel FIRST FLUSH the held setAim.
   * Inert while the server has the room paused (partner in reconnect grace): nothing may queue up behind the pause.
   */
  sendCommand(cmd: PlayerCommand): void {
    if (this.status.kind !== 'playing' || this.status.paused) return;
    if (cmd.type === 'setAim') {
      this.heldAim = cmd;
      const wait = this.lastAimSentAt + AIM_INTERVAL_MS - this.now();
      if (wait <= 0) this.flushAim();
      else if (this.aimTimer === null) this.aimTimer = setTimeout(() => this.flushAim(), wait);
      return;
    }
    this.flushAim();
    this.sendRaw({ type: 'command', cmd });
  }

  private flushAim(): void {
    if (this.aimTimer !== null) {
      clearTimeout(this.aimTimer);
      this.aimTimer = null;
    }
    const held = this.heldAim;
    if (held === null) return;
    this.heldAim = null;
    this.lastAimSentAt = this.now();
    this.sendRaw({ type: 'command', cmd: held });
  }

  /** sends leaveRoom, closes with the intentional flag (no error surfaced); idempotent */
  leave(): void {
    if (this.inRoom()) this.sendRaw({ type: 'leaveRoom' });
    this.teardownSocket();
    this.clearSession();
    this.config = null;
    this.finishConnect(false);
    this.setStatus({ kind: 'closed', reason: 'left', message: 'You left the room.' });
    this.wakeReconnect?.();
  }

  // -------------------------------------------------------------------------------------------
  // Render-side queries
  // -------------------------------------------------------------------------------------------

  /** nowMs + clockOffset - CLIENT_RENDER_DELAY_MS */
  renderTime(nowMs: number): number {
    return nowMs + (this.clockOffset ?? 0) - CLIENT_RENDER_DELAY_MS;
  }

  /** EMA from ping/pong every 2 s */
  rttMs(): number {
    return this.rtt;
  }

  /** True once a ping has gone LINK_STALE_MS without any inbound frame (the socket may still read OPEN). */
  linkStale(): boolean {
    return this.silentSince !== null && this.now() - this.silentSince >= LINK_STALE_MS;
  }

  /** Render-delayed pair of decoded snapshots; `snap` = true when this frame is a discontinuity. */
  interpolated(nowMs: number): InterpolatedState | null {
    const first = this.ring[0];
    if (first === undefined) return null;
    const t = this.renderTime(nowMs);
    let aIndex = -1;
    for (let i = this.ring.length - 1; i >= 0; i -= 1) {
      const entry = this.ring[i];
      if (entry !== undefined && entry.serverTime <= t) {
        aIndex = i;
        break;
      }
    }
    if (aIndex < 0) return { state: first.state, prev: first.state, alpha: 0, snap: this.advanceBase(first) };
    const a = this.ring[aIndex] as RingEntry;
    const b = this.ring[aIndex + 1];
    const snap = this.advanceBase(a);
    if (b === undefined) return this.stalled(a, t, snap);
    if (b.discontinuity) return { state: a.state, prev: a.state, alpha: 0, snap };
    const alpha = (t - a.serverTime) / (b.serverTime - a.serverTime);
    return { state: b.state, prev: a.state, alpha, snap };
  }

  /** Newest snapshot is behind render time: extrapolate briefly, then hold. */
  private stalled(a: RingEntry, t: number, snap: boolean): InterpolatedState {
    const behind = t - a.serverTime;
    if (behind <= 0 || behind > MAX_EXTRAPOLATION_MS) return { state: a.state, prev: a.state, alpha: 0, snap };
    const state = extrapolateBalls(a.state, behind / 1000);
    return { state, prev: a.state, alpha: 1, snap };
  }

  /** Moves the base entry forward; true when a discontinuity lies in (lastBase, base]. */
  private advanceBase(base: RingEntry): boolean {
    if (base.serverTime <= this.lastBaseTime) return false;
    let crossed = false;
    for (const entry of this.ring) {
      if (entry.serverTime > this.lastBaseTime && entry.serverTime <= base.serverTime && entry.discontinuity) crossed = true;
    }
    this.lastBaseTime = base.serverTime;
    return crossed;
  }

  /**
   * Events of every buffered snapshot whose serverTime <= renderTimeMs (in order; each at most once).
   * Batches more than EVENT_REPLAY_WINDOW_MS behind render time are dropped, not replayed.
   */
  drainEvents(renderTimeMs: number): SimEvent[] {
    this.dropStaleEvents(renderTimeMs);
    const out: SimEvent[] = [];
    while (this.eventQueue.length > 0) {
      const head = this.eventQueue[0];
      if (head === undefined || head.serverTime > renderTimeMs) break;
      this.eventQueue.shift();
      for (const e of head.events) out.push(e);
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private observeServerTime(serverTime: number, now: number): void {
    const sample = serverTime - (now - this.rtt / 2);
    if (this.clockOffset === null || Math.abs(sample - this.clockOffset) > OFFSET_RESET_MS) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * OFFSET_EMA;
  }

  private startPinging(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.pingTick(), PING_INTERVAL_MS);
  }

  /** Watchdog first (so a dead link is dropped, not pinged again), then the next probe. */
  private pingTick(): void {
    const socket = this.socket;
    if (socket === null) return;
    const t = this.now();
    if (this.silentSince !== null && t - this.silentSince >= LINK_DEAD_MS) {
      this.dropDeadLink(socket);
      return;
    }
    this.pingSentAt = t;
    if (this.silentSince === null) this.silentSince = t;
    this.sendRaw({ type: 'ping', t });
  }

  /**
   * A half-open socket: close it ourselves and run the unexpected-close path, which reconnects with the
   * token while in a room. The handlers come off first so the browser's eventual `close` is a no-op.
   */
  private dropDeadLink(socket: SocketHandle): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close(CLOSE_LINK_DEAD, 'no reply');
    this.onClose(socket);
  }

  private peerSeat(): PlayerId {
    return this.session?.seat === 0 ? 1 : 0;
  }

  private updateLobby(update: (lobby: LobbyState) => LobbyState, peerConnected: boolean): void {
    const s = this.status;
    if (s.kind === 'waiting' || s.kind === 'joined') this.setStatus({ ...s, lobby: update(s.lobby), peerConnected });
  }

  private setPeerConnected(peerConnected: boolean): void {
    const s = this.status;
    if (s.kind === 'playing') {
      const next: ClientStatus = { kind: 'playing', code: s.code, seat: s.seat, paused: s.paused, peerConnected };
      this.setStatus(this.peerDeadlineMs !== undefined ? { ...next, peerDeadlineMs: this.peerDeadlineMs } : next);
    } else if (s.kind === 'waiting' || s.kind === 'joined') {
      this.setStatus({ ...s, peerConnected });
    }
  }

  private inviteUrl(code: string): string {
    return `${this.options.inviteBase ?? defaultInviteBase()}?room=${code}`;
  }

  private sendRaw(msg: ClientMessage): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  private saveSession(): void {
    if (this.storage === null || this.session === null) return;
    try {
      this.storage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      // storage unavailable: reconnect after reload is simply not offered
    }
  }

  private clearSession(): void {
    this.session = null;
    if (this.storage === null) return;
    try {
      this.storage.removeItem(RECONNECT_STORAGE_KEY);
    } catch {
      // nothing to clear
    }
  }

  /**
   * The intentional close: detaches every handler BEFORE closing so the socket's own close event
   * can never be mistaken for a drop (no reconnect loop, no error status).
   */
  private teardownSocket(): void {
    const socket = this.socket;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) socket.close(CLOSE_NORMAL, 'client closed');
    }
    this.socket = null;
    this.stopTimers();
  }

  private stopTimers(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.aimTimer !== null) clearTimeout(this.aimTimer);
    this.connectTimer = null;
    this.pingTimer = null;
    this.aimTimer = null;
    this.heldAim = null;
    this.pingSentAt = null;
    this.silentSince = null;
  }

  private setStatus(status: ClientStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
