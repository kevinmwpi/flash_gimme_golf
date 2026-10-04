// OWNER: net
// ARCH.md §1.14 / §2.2 client behaviour + BUILD_DECISIONS D3 CD-6, against a fake WebSocket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD1_IDS } from '../../sim/levels/index';
import { encodeSnapshot } from '../../sim/serialize';
import { createSim } from '../../sim/sim';
import { DEFAULT_AIM, type SimConfig, type SimEvent, type SimSnapshot, type SimState } from '../../sim/types';
import {
  EVENT_REPLAY_WINDOW_MS,
  GameClient,
  LINK_DEAD_MS,
  LINK_STALE_MS,
  PING_INTERVAL_MS,
  RECONNECT_RETRY_MS,
  RECONNECT_STORAGE_KEY,
  type ClientStatus,
  type SocketHandle,
  type StorageLike,
} from '../GameClient';
import {
  CLIENT_RENDER_DELAY_MS,
  LIMITS,
  MAX_EXTRAPOLATION_MS,
  PROTOCOL_VERSION,
  SNAPSHOT_GAP_DISCONTINUITY_MS,
  type ClientMessage,
  type LobbyState,
  type RoomSync,
  type ServerMessage,
} from '../protocol';

const LEVEL_1 = WORLD1_IDS[0] ?? '';
const CONFIG: SimConfig = { playerCount: 2, mode: 'online', seed: 7, levelIds: [LEVEL_1] };
const LOBBY: LobbyState = { levelId: LEVEL_1, players: [true, false], names: ['Red', ''] };
const TOKEN = 'b'.repeat(32);
const CODE = 'KPQ27';

class FakeSocket implements SocketHandle {
  sent: ClientMessage[] = [];
  readyState = 0;
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(msg: ServerMessage | Record<string, unknown>): void {
    this.onmessage?.(JSON.stringify(msg));
  }

  /** The network dropped the socket (not the client). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.(1006, '');
  }

  types(): string[] {
    return this.sent.map((m) => m.type);
  }
}

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

type Rig = {
  client: GameClient;
  sockets: FakeSocket[];
  statuses: ClientStatus[];
  storage: MemoryStorage;
  clock: { now: number };
  socket(): FakeSocket;
  status(): ClientStatus;
};

function rig(): Rig {
  const sockets: FakeSocket[] = [];
  const statuses: ClientStatus[] = [];
  const storage = new MemoryStorage();
  const clock = { now: 1000 };
  const client = new GameClient({
    url: 'ws://test/ws',
    now: () => clock.now,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    storage,
    inviteBase: 'https://flash-golf.test/',
  });
  client.subscribe((s) => statuses.push(s));
  return {
    client,
    sockets,
    statuses,
    storage,
    clock,
    socket: () => sockets[sockets.length - 1] as FakeSocket,
    status: () => client.getStatus(),
  };
}

function baseState(): SimState {
  return createSim(CONFIG).state;
}

function withBall(state: SimState, x: number, vx = 0): SimState {
  const b0 = state.balls[0];
  return { ...state, balls: [{ ...b0, pos: { x, y: b0.pos.y }, vel: { x: vx, y: 0 }, asleep: vx === 0 }, state.balls[1]] };
}

function sync(state: SimState, serverTime: number): RoomSync {
  return { config: CONFIG, tick: state.tick, snap: encodeSnapshot(state), serverTime };
}

function snapshotMsg(state: SimState, serverTime: number, extra: { immediate?: boolean; events?: SimEvent[] } = {}): ServerMessage {
  return { type: 'snapshot', tick: state.tick, serverTime, snap: encodeSnapshot(state), events: extra.events ?? [], immediate: extra.immediate ?? false };
}

/** Deliver a snapshot with the client clock at the server time (zero one-way delay, offset stays 0). */
function deliver(r: Rig, s: FakeSocket, state: SimState, serverTime: number, extra: { immediate?: boolean; events?: SimEvent[] } = {}): void {
  r.clock.now = serverTime;
  s.receive(snapshotMsg(state, serverTime, extra));
}

/** Host flow up to a running game; the clock offset is zero (serverTime === client now). */
function playingHost(r: Rig, startTime = r.clock.now): FakeSocket {
  void r.client.createRoom();
  const s = r.socket();
  s.open();
  s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
  s.receive({ type: 'roomCreated', code: CODE, playerId: 0, reconnectToken: TOKEN, lobby: LOBBY });
  s.receive({ type: 'peerJoined', playerId: 1, name: 'Blue' });
  r.clock.now = startTime;
  s.receive({ type: 'start', sync: sync(baseState(), startTime) });
  return s;
}

describe('GameClient status machine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('createRoom: connecting -> hello -> createRoom after welcome -> waiting with invite url and stored session', () => {
    const r = rig();
    const done = r.client.createRoom();
    expect(r.status()).toEqual({ kind: 'connecting', attempt: 1 });
    const s = r.socket();
    expect(s.url).toBe('ws://test/ws');
    s.open();
    expect(s.sent).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION }]);
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 50_000 });
    expect(s.types()).toEqual(['hello', 'createRoom']);
    s.receive({ type: 'roomCreated', code: CODE, playerId: 0, reconnectToken: TOKEN, lobby: LOBBY });
    expect(r.status()).toEqual({ kind: 'waiting', code: CODE, inviteUrl: `https://flash-golf.test/?room=${CODE}`, peerConnected: false, lobby: LOBBY });
    expect(JSON.parse(r.storage.getItem(RECONNECT_STORAGE_KEY) ?? '{}')).toEqual({ code: CODE, token: TOKEN, seat: 0 });
    expect(r.client.renderTime(1000)).toBe(50_000 - CLIENT_RENDER_DELAY_MS);
    return expect(done).resolves.toBeUndefined();
  });

  it('lobby updates: peerJoined / lobbyState / peerLeft toggle peerConnected; start => playing', () => {
    const r = rig();
    void r.client.createRoom();
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 1000 });
    s.receive({ type: 'roomCreated', code: CODE, playerId: 0, reconnectToken: TOKEN, lobby: LOBBY });
    s.receive({ type: 'peerJoined', playerId: 1, name: 'Blue' });
    expect(r.status()).toMatchObject({ kind: 'waiting', peerConnected: true, lobby: { players: [true, true] } });
    const lobby: LobbyState = { ...LOBBY, players: [true, true], names: ['Red', 'Blue'] };
    s.receive({ type: 'lobbyState', lobby });
    expect(r.status()).toMatchObject({ kind: 'waiting', peerConnected: true, lobby });
    s.receive({ type: 'peerLeft', playerId: 1, reason: 'left', graceMs: 0 });
    expect(r.status()).toMatchObject({ kind: 'waiting', peerConnected: false });
    s.receive({ type: 'peerJoined', playerId: 1, name: 'Blue' });
    r.client.setLevel(LEVEL_1);
    r.client.start([LEVEL_1]);
    expect(s.sent.slice(-2)).toEqual([
      { type: 'setLevel', levelId: LEVEL_1 },
      { type: 'start', levelIds: [LEVEL_1] },
    ]);
    s.receive({ type: 'start', sync: sync(baseState(), 1000) });
    expect(r.status()).toEqual({ kind: 'playing', code: CODE, seat: 0, paused: false, peerConnected: true });
    expect(r.client.getConfig()).toEqual(CONFIG);
    expect(r.client.interpolated(1100)?.state.phase).toBe('intro');
  });

  it('joinRoom: joined => joined status (guest); uppercase/trimmed code on the wire', () => {
    const r = rig();
    void r.client.joinRoom(' kpq27 ');
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 1000 });
    expect(s.sent[1]).toEqual({ type: 'joinRoom', code: CODE });
    const lobby: LobbyState = { ...LOBBY, players: [true, true], names: ['Red', 'Blue'] };
    s.receive({ type: 'joined', code: CODE, playerId: 1, reconnectToken: TOKEN, peerConnected: true, lobby });
    expect(r.status()).toEqual({ kind: 'joined', code: CODE, peerConnected: true, lobby });
    expect(JSON.parse(r.storage.getItem(RECONNECT_STORAGE_KEY) ?? '{}')).toEqual({ code: CODE, token: TOKEN, seat: 1 });
  });

  it('a fatal error before joining => error status with recoverable flag; non-fatal errors in a room go to onServerError', () => {
    const r = rig();
    void r.client.joinRoom(CODE);
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 1000 });
    s.receive({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'nope' });
    expect(r.status()).toMatchObject({ kind: 'error', code: 'ROOM_NOT_FOUND', recoverable: true });
    expect(s.closed).not.toBeNull();

    const r2 = rig();
    const s2 = playingHost(r2);
    const seen: string[] = [];
    r2.client.onServerError((code) => seen.push(code));
    s2.receive({ type: 'error', code: 'NOT_YOUR_TURN', message: 'wait' });
    expect(seen).toEqual(['NOT_YOUR_TURN']);
    expect(r2.status().kind).toBe('playing');
    s2.receive({ type: 'error', code: 'VERSION_MISMATCH', message: 'old' });
    expect(r2.status()).toMatchObject({ kind: 'error', code: 'VERSION_MISMATCH', recoverable: false });
  });

  it('connect timeout => closed{timeout}; server drop while connecting => closed{serverUnreachable}', () => {
    const r = rig();
    void r.client.createRoom();
    vi.advanceTimersByTime(8000);
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'timeout' });
    expect(r.socket().closed).not.toBeNull();

    const r2 = rig();
    void r2.client.createRoom();
    r2.socket().drop();
    expect(r2.status()).toMatchObject({ kind: 'closed', reason: 'serverUnreachable' });
  });

  it('paused / peerLeft / peerReconnected / roomClosed update the playing status and clear the session on close', () => {
    const r = rig();
    const s = playingHost(r);
    s.receive({ type: 'peerLeft', playerId: 1, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    s.receive({ type: 'paused', paused: true, reason: 'peerDisconnected' });
    expect(r.status()).toEqual({ kind: 'playing', code: CODE, seat: 0, paused: true, peerConnected: false, peerDeadlineMs: r.clock.now + LIMITS.reconnectGraceMs });
    s.receive({ type: 'peerReconnected', playerId: 1 });
    s.receive({ type: 'paused', paused: false, reason: 'resumed' });
    expect(r.status()).toEqual({ kind: 'playing', code: CODE, seat: 0, paused: false, peerConnected: true });
    s.receive({ type: 'roomClosed', reason: 'guestLeft' });
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'guestLeft' });
    expect(r.storage.getItem(RECONNECT_STORAGE_KEY)).toBeNull();
    expect(s.closed).not.toBeNull();
  });

  it('leave() sends leaveRoom and closes without surfacing an error, even if the socket then reports close', () => {
    const r = rig();
    const s = playingHost(r);
    r.client.leave();
    expect(s.sent[s.sent.length - 1]).toEqual({ type: 'leaveRoom' });
    expect(s.closed?.code).toBe(1000);
    expect(r.status()).toEqual({ kind: 'closed', reason: 'left', message: 'You left the room.' });
    expect(r.storage.getItem(RECONNECT_STORAGE_KEY)).toBeNull();
    s.onclose?.(1005, '');
    r.client.leave();
    expect(r.statuses.filter((st) => st.kind === 'error' || st.kind === 'reconnecting')).toEqual([]);
    expect(r.sockets).toHaveLength(1);
  });

  it('Cancel while connecting is an intentional close (closed{left}, never an error)', () => {
    const r = rig();
    const pending = r.client.createRoom();
    r.client.leave();
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'left' });
    expect(r.socket().closed).not.toBeNull();
    return expect(pending).resolves.toBeUndefined();
  });
});

describe('GameClient commands', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('setAim is coalesced to <= LIMITS.setAimPerSecond (latest wins) and flushed before shoot / continue / restartLevel', () => {
    const r = rig();
    const s = playingHost(r);
    const before = s.sent.length;
    const interval = 1000 / LIMITS.setAimPerSecond;
    r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -1, power: 50 });
    r.clock.now += 5;
    r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -1.1, power: 51 });
    r.clock.now += 5;
    r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -1.2, power: 52 });
    expect(s.sent.slice(before)).toEqual([{ type: 'command', cmd: { type: 'setAim', playerId: 0, angle: -1, power: 50 } }]);
    r.clock.now += interval;
    vi.advanceTimersByTime(interval);
    expect(s.sent.slice(before)).toEqual([
      { type: 'command', cmd: { type: 'setAim', playerId: 0, angle: -1, power: 50 } },
      { type: 'command', cmd: { type: 'setAim', playerId: 0, angle: -1.2, power: 52 } },
    ]);
    r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -1.3, power: 53 });
    r.client.sendCommand({ type: 'shoot', playerId: 0 });
    expect(s.sent.slice(before + 2)).toEqual([
      { type: 'command', cmd: { type: 'setAim', playerId: 0, angle: -1.3, power: 53 } },
      { type: 'command', cmd: { type: 'shoot', playerId: 0 } },
    ]);
    vi.advanceTimersByTime(1000);
    expect(s.sent).toHaveLength(before + 4);
    r.clock.now += 1000;
    for (const type of ['continue', 'restartLevel'] as const) {
      r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -2, power: 20 });
      r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -2.1, power: 21 });
      r.client.sendCommand({ type, playerId: 0 });
      expect(s.sent.slice(-2).map((m) => (m.type === 'command' ? m.cmd.type : m.type))).toEqual(['setAim', type]);
      r.clock.now += 1000;
    }
    const aims = s.sent.filter((m) => m.type === 'command' && m.cmd.type === 'setAim');
    expect(aims.length).toBeLessThanOrEqual(LIMITS.setAimPerSecond);
  });

  it('sendCommand is inert while the server has the room paused (partner in reconnect grace)', () => {
    const r = rig();
    const s = playingHost(r);
    s.receive({ type: 'peerLeft', playerId: 1, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    s.receive({ type: 'paused', paused: true, reason: 'peerDisconnected' });
    const before = s.sent.length;
    r.client.sendCommand({ type: 'setAim', playerId: 0, angle: -1, power: 50 });
    r.client.sendCommand({ type: 'shoot', playerId: 0 });
    r.client.sendCommand({ type: 'restartLevel', playerId: 0 });
    vi.advanceTimersByTime(1000);
    expect(s.sent).toHaveLength(before);
    s.receive({ type: 'peerReconnected', playerId: 1 });
    s.receive({ type: 'paused', paused: false, reason: 'resumed' });
    r.client.sendCommand({ type: 'shoot', playerId: 0 });
    expect(s.sent.slice(before)).toEqual([{ type: 'command', cmd: { type: 'shoot', playerId: 0 } }]);
  });

  it('commands are ignored outside the playing state; ping/pong feeds rttMs()', () => {
    const r = rig();
    void r.client.createRoom();
    r.client.sendCommand({ type: 'shoot', playerId: 0 });
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 1000 });
    expect(s.types()).toEqual(['hello', 'createRoom']);
    vi.advanceTimersByTime(2000);
    const ping = s.sent[s.sent.length - 1];
    expect(ping).toEqual({ type: 'ping', t: 1000 });
    r.clock.now = 1080;
    s.receive({ type: 'pong', t: 1000, serverTime: 1040, tick: 0 });
    expect(r.client.rttMs()).toBe(80);
    expect(r.client.linkStale()).toBe(false);
  });
});

describe('GameClient link watchdog (UX.md §4.1 row BR)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Fires the next ping interval with the injected clock moved the same amount. */
  function pingInterval(r: Rig): void {
    r.clock.now += PING_INTERVAL_MS;
    vi.advanceTimersByTime(PING_INTERVAL_MS);
  }

  it('an answered ping is never stale; a ping with no reply is stale after LINK_STALE_MS and fresh again on any inbound frame', () => {
    const r = rig();
    const s = playingHost(r);
    pingInterval(r);
    expect(s.types().filter((t) => t === 'ping')).toHaveLength(1);
    s.receive({ type: 'pong', t: r.clock.now, serverTime: r.clock.now, tick: 0 });
    r.clock.now += LINK_STALE_MS;
    expect(r.client.linkStale()).toBe(false);
    pingInterval(r);
    r.clock.now += LINK_STALE_MS - 1;
    expect(r.client.linkStale()).toBe(false);
    r.clock.now += 1;
    expect(r.client.linkStale()).toBe(true);
    deliver(r, s, baseState(), r.clock.now);
    expect(r.client.linkStale()).toBe(false);
    expect(r.status().kind).toBe('playing');
  });

  it('three unanswered pings tear the half-open socket down and start the reconnect loop; snapshots count as replies', () => {
    const r = rig();
    const s = playingHost(r);
    pingInterval(r);
    pingInterval(r);
    deliver(r, s, baseState(), r.clock.now);
    pingInterval(r);
    pingInterval(r);
    expect(s.readyState).toBe(1);
    expect(r.status().kind).toBe('playing');
    const firstUnanswered = r.clock.now - PING_INTERVAL_MS;
    pingInterval(r);
    pingInterval(r);
    expect(r.clock.now - firstUnanswered).toBe(LINK_DEAD_MS);
    expect(s.closed).toEqual({ code: 4000, reason: 'no reply' });
    expect(r.status()).toEqual({ kind: 'reconnecting', code: CODE, attempt: 1, deadlineMs: r.clock.now + LIMITS.reconnectGraceMs });
    expect(r.sockets).toHaveLength(2);
    expect(r.client.linkStale()).toBe(false);
    const retry = r.socket();
    retry.open();
    retry.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    expect(retry.sent[1]).toEqual({ type: 'joinRoom', code: CODE, reconnectToken: TOKEN });
    s.onclose?.(1006, '');
    expect(r.status().kind).toBe('reconnecting');
  });

  it('a WAITING host on a dead link rejoins by token too; leave() stops the watchdog', () => {
    const r = rig();
    void r.client.createRoom();
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    s.receive({ type: 'roomCreated', code: CODE, playerId: 0, reconnectToken: TOKEN, lobby: LOBBY });
    for (let i = 0; i < 4; i += 1) pingInterval(r);
    expect(r.status()).toMatchObject({ kind: 'reconnecting', code: CODE });
    expect(r.sockets).toHaveLength(2);
    r.client.leave();
    for (let i = 0; i < 4; i += 1) pingInterval(r);
    expect(r.sockets).toHaveLength(2);
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'left' });
  });
});

describe('GameClient interpolation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('alpha between two ring entries; the first frame after a sync snaps', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = withBall(baseState(), 100);
    const b = withBall({ ...a, tick: 3 }, 200);
    deliver(r, s, a, 1000);
    deliver(r, s, b, 1050);
    const first = r.client.interpolated(1125);
    expect(first).toMatchObject({ alpha: 0.5, snap: true });
    expect(first?.prev.balls[0].pos.x).toBe(100);
    expect(first?.state.balls[0].pos.x).toBe(200);
    expect(first?.state.tick).toBe(3);
    const second = r.client.interpolated(1140);
    expect(second?.alpha).toBeCloseTo(0.8);
    expect(second?.snap).toBe(false);
  });

  it('discontinuity (gap > 150 ms, immediate, IMMEDIATE_SNAPSHOT_EVENTS) holds then snaps', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = withBall(baseState(), 100);
    deliver(r, s, a, 1000);
    r.client.interpolated(1100);
    const b = withBall({ ...a, tick: 3 }, 200);
    deliver(r, s, b, 1050, { immediate: true });
    const hold = r.client.interpolated(1125);
    expect(hold).toMatchObject({ alpha: 0, snap: false });
    expect(hold?.state.balls[0].pos.x).toBe(100);
    const snapped = r.client.interpolated(1150);
    expect(snapped).toMatchObject({ snap: true });
    expect(snapped?.state.balls[0].pos.x).toBe(200);
    expect(r.client.interpolated(1160)?.snap).toBe(false);

    const c = withBall({ ...a, tick: 6 }, 300);
    deliver(r, s, c, 1050 + SNAPSHOT_GAP_DISCONTINUITY_MS + 1);
    expect(r.client.interpolated(1200)).toMatchObject({ alpha: 0, snap: false });
    expect(r.client.interpolated(1310)).toMatchObject({ snap: true });

    const d = withBall({ ...a, tick: 9 }, 400);
    const hit: SimEvent = { type: 'ballHit', playerId: 0, pos: { x: 300, y: 0 }, angle: -1, power: 50, speed: 325, tick: 9 };
    deliver(r, s, d, 1250, { events: [hit] });
    expect(r.client.interpolated(1340)).toMatchObject({ alpha: 0, snap: false });
    expect(r.client.interpolated(1350)).toMatchObject({ snap: true });
    expect(r.client.interpolated(1350)?.state.balls[0].pos.x).toBe(400);
  });

  it('stall: extrapolates balls with their velocity for at most MAX_EXTRAPOLATION_MS, then holds', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = withBall(baseState(), 100, 300);
    deliver(r, s, a, 1000);
    const soon = r.client.interpolated(1200);
    expect(soon?.state.balls[0].pos.x).toBeCloseTo(100 + 300 * 0.1);
    expect(soon?.prev.balls[0].pos.x).toBe(100);
    const late = r.client.interpolated(1100 + MAX_EXTRAPOLATION_MS + 1000);
    expect(late?.state.balls[0].pos.x).toBe(100);
    expect(late?.alpha).toBe(0);
  });

  it('drainEvents releases events whose serverTime <= renderTime in order, each at most once', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = baseState();
    const e1: SimEvent = { type: 'playStart', levelId: LEVEL_1, tick: 1 };
    const e2: SimEvent = { type: 'turnStart', playerId: 0, readyInTicks: 0, sameAsBefore: false, tick: 1 };
    const e3: SimEvent = { type: 'switchOff', switchId: 'x', pos: { x: 0, y: 0 }, tick: 4 };
    deliver(r, s, { ...a, tick: 1 }, 1000, { events: [e1, e2] });
    deliver(r, s, { ...a, tick: 4 }, 1050, { events: [e3] });
    expect(r.client.drainEvents(999)).toEqual([]);
    expect(r.client.drainEvents(1020)).toEqual([e1, e2]);
    expect(r.client.drainEvents(1020)).toEqual([]);
    expect(r.client.drainEvents(1060)).toEqual([e3]);
    expect(r.client.drainEvents(5000)).toEqual([]);
  });

  it('event batches more than EVENT_REPLAY_WINDOW_MS behind render time are dropped, not replayed (hidden tab)', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = baseState();
    const hitAt = (tick: number): SimEvent => ({ type: 'ballHit', playerId: 1, pos: { x: 0, y: 0 }, angle: -1, power: 50, speed: 325, tick });
    // Five minutes of 20 Hz snapshots, each carrying an event, with no frame rendered in between.
    const n = 6000;
    const spacing = 50;
    for (let i = 0; i < n; i += 1) deliver(r, s, { ...a, tick: i + 1 }, 1000 + i * spacing, { events: [hitAt(i + 1)] });
    const renderTime = r.client.renderTime(r.clock.now);
    const out = r.client.drainEvents(renderTime);
    expect(out).toHaveLength(EVENT_REPLAY_WINDOW_MS / spacing + 1);
    expect(out[0]?.tick).toBe(n - CLIENT_RENDER_DELAY_MS / spacing - EVENT_REPLAY_WINDOW_MS / spacing);
    // The batches still ahead of render time follow on later frames as usual.
    expect(r.client.drainEvents(renderTime + CLIENT_RENDER_DELAY_MS)).toHaveLength(CLIENT_RENDER_DELAY_MS / spacing);
  });

  it('the ring and event buffer are cleared on start and joined{sync}', () => {
    const r = rig();
    const s = playingHost(r, 900);
    const a = withBall(baseState(), 100);
    const e: SimEvent = { type: 'playStart', levelId: LEVEL_1, tick: 1 };
    deliver(r, s, { ...a, tick: 1 }, 1000, { events: [e] });
    deliver(r, s, withBall({ ...a, tick: 4 }, 200), 1050);
    r.client.interpolated(1125);
    const fresh = withBall({ ...a, tick: 0 }, 900);
    s.receive({ type: 'start', sync: sync(fresh, 2000) });
    expect(r.client.drainEvents(10_000)).toEqual([]);
    const after = r.client.interpolated(2100);
    expect(after).toMatchObject({ alpha: 0, snap: true });
    expect(after?.state.balls[0].pos.x).toBe(900);
    expect(r.client.interpolated(1125)?.state.balls[0].pos.x).toBe(900);
  });

  it('a SerializeError from decodeSnapshot => error{BAD_SNAPSHOT, recoverable:false}, socket closed, never throws', () => {
    const r = rig();
    const s = playingHost(r, 1000);
    const bad = encodeSnapshot(baseState()) as unknown as number[];
    bad[2] = 9;
    expect(() => s.receive({ type: 'snapshot', tick: 1, serverTime: 1000, snap: bad as unknown as SimSnapshot, events: [], immediate: false })).not.toThrow();
    expect(r.status()).toEqual({ kind: 'error', code: 'BAD_SNAPSHOT', message: expect.stringContaining('Reload'), recoverable: false });
    expect(s.closed).not.toBeNull();
    expect(r.client.interpolated(2000)).not.toBeNull();
    expect(r.client.getStatus().kind).toBe('error');
  });

  it('clock offset follows serverTime; renderTime = now + offset - CLIENT_RENDER_DELAY_MS', () => {
    const r = rig();
    void r.client.createRoom();
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: 71_000 });
    expect(r.client.renderTime(1000)).toBe(71_000 - CLIENT_RENDER_DELAY_MS);
    s.receive({ type: 'roomCreated', code: CODE, playerId: 0, reconnectToken: TOKEN, lobby: LOBBY });
    s.receive({ type: 'start', sync: sync(baseState(), 71_040) });
    const offset = r.client.renderTime(1000) + CLIENT_RENDER_DELAY_MS - 1000;
    expect(offset).toBeGreaterThan(70_000);
    expect(offset).toBeLessThanOrEqual(70_040);
  });
});

describe('GameClient reconnect (D3 CD-6)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('an unexpected drop while playing => reconnecting with deadlineMs = dropAt + reconnectGraceMs, retrying every 2 s', async () => {
    const r = rig();
    const s = playingHost(r);
    const dropAt = r.clock.now;
    s.drop();
    expect(r.status()).toEqual({ kind: 'reconnecting', code: CODE, attempt: 1, deadlineMs: dropAt + LIMITS.reconnectGraceMs });
    expect(r.sockets).toHaveLength(2);
    const retry = r.socket();
    retry.open();
    retry.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    expect(retry.sent[1]).toEqual({ type: 'joinRoom', code: CODE, reconnectToken: TOKEN });
    retry.drop();
    expect(r.sockets).toHaveLength(2);
    r.clock.now += RECONNECT_RETRY_MS;
    await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS);
    expect(r.sockets).toHaveLength(3);
    expect(r.status()).toMatchObject({ kind: 'reconnecting', attempt: 2, deadlineMs: dropAt + LIMITS.reconnectGraceMs });
    const third = r.socket();
    third.open();
    third.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    const state = withBall(baseState(), 555);
    third.receive({ type: 'joined', code: CODE, playerId: 0, reconnectToken: TOKEN, peerConnected: true, lobby: LOBBY, sync: sync(state, r.clock.now) });
    expect(r.status()).toEqual({ kind: 'playing', code: CODE, seat: 0, paused: false, peerConnected: true });
    expect(r.client.interpolated(r.clock.now + 100)?.state.balls[0].pos.x).toBe(555);
  });

  it('ROOM_NOT_FOUND / SERVER_FULL / RATE_LIMITED answered during a reconnect attempt => error{recoverable:false}, session cleared', () => {
    for (const code of ['ROOM_NOT_FOUND', 'SERVER_FULL', 'RATE_LIMITED'] as const) {
      const r = rig();
      const s = playingHost(r);
      s.drop();
      const retry = r.socket();
      retry.open();
      retry.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
      retry.receive({ type: 'error', code, message: 'gone' });
      expect(r.status()).toMatchObject({ kind: 'error', code, recoverable: false });
      expect(r.storage.getItem(RECONNECT_STORAGE_KEY)).toBeNull();
      expect(r.sockets).toHaveLength(2);
    }
  });

  it('a rejoin sync for the same game keeps the config object identity; a new seed replaces it', () => {
    const r = rig();
    const s = playingHost(r);
    const before = r.client.getConfig();
    s.drop();
    const retry = r.socket();
    retry.open();
    retry.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    retry.receive({ type: 'joined', code: CODE, playerId: 0, reconnectToken: TOKEN, peerConnected: true, lobby: LOBBY, sync: sync(baseState(), r.clock.now) });
    expect(r.status().kind).toBe('playing');
    expect(r.client.getConfig()).toBe(before);
    const again: SimConfig = { ...CONFIG, seed: CONFIG.seed + 1 };
    retry.receive({ type: 'start', sync: { config: again, tick: 0, snap: encodeSnapshot(createSim(again).state), serverTime: r.clock.now } });
    expect(r.client.getConfig()).toEqual(again);
    expect(r.client.getConfig()).not.toBe(before);
  });

  it('tryReconnect from sessionStorage gives up with closed{timeout} once the grace deadline passes', async () => {
    const r = rig();
    r.storage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({ code: CODE, token: TOKEN, seat: 1 }));
    const start = r.clock.now;
    const result = r.client.tryReconnect();
    let attempts = 0;
    while (r.status().kind === 'reconnecting') {
      attempts += 1;
      expect(r.status()).toMatchObject({ kind: 'reconnecting', code: CODE, attempt: attempts, deadlineMs: start + LIMITS.reconnectGraceMs });
      r.socket().drop();
      r.clock.now += RECONNECT_RETRY_MS;
      await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS);
    }
    expect(attempts).toBe(LIMITS.reconnectGraceMs / RECONNECT_RETRY_MS);
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'timeout' });
    expect(r.storage.getItem(RECONNECT_STORAGE_KEY)).toBeNull();
    await expect(result).resolves.toBe(false);
  });

  it('tryReconnect stops on BAD_TOKEN (error, session cleared) and returns false; returns false with no session', async () => {
    const r = rig();
    await expect(r.client.tryReconnect()).resolves.toBe(false);
    expect(r.status()).toEqual({ kind: 'idle' });
    r.storage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({ code: CODE, token: TOKEN, seat: 0 }));
    const result = r.client.tryReconnect();
    const s = r.socket();
    s.open();
    s.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: r.clock.now });
    s.receive({ type: 'error', code: 'BAD_TOKEN', message: 'gone' });
    await expect(result).resolves.toBe(false);
    expect(r.status()).toMatchObject({ kind: 'error', code: 'BAD_TOKEN', recoverable: false });
    expect(r.storage.getItem(RECONNECT_STORAGE_KEY)).toBeNull();
  });

  it('leave() during a reconnect wait ends the loop with closed{left}', async () => {
    const r = rig();
    const s = playingHost(r);
    s.drop();
    r.socket().drop();
    r.client.leave();
    await vi.advanceTimersByTimeAsync(LIMITS.reconnectGraceMs);
    expect(r.status()).toMatchObject({ kind: 'closed', reason: 'left' });
    expect(r.sockets).toHaveLength(2);
  });

  it('the stored session survives a restart of the client object (reload) and the aim defaults hold', () => {
    const r = rig();
    playingHost(r);
    const again = new GameClient({ url: 'ws://test/ws', storage: r.storage, now: () => r.clock.now, createSocket: () => new FakeSocket('x') });
    void again.tryReconnect();
    expect(again.getStatus()).toMatchObject({ kind: 'reconnecting', code: CODE });
    expect(baseState().players[0].aim).toEqual(DEFAULT_AIM);
  });
});
