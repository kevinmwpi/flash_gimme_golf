// OWNER: net
// ARCH.md §4 rooms row (FakeSocket, `now` injected) + a malformed-frame fuzz test.
import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  PROTOCOL_VERSION,
  RECONNECT_TOKEN_RE,
  ROOM_CODE_RE,
  SNAPSHOT_KEEPALIVE_TICKS,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageType,
} from '../../src/net/protocol';
import { WORLD1_IDS } from '../../src/sim/levels/index';
import { decodeSnapshot } from '../../src/sim/serialize';
import { GOLDEN_LINES } from '../../src/sim/__tests__/levels-golden';
import { DEFAULT_AIM, PHASE_CODES, TICK_RATE, TURN_DELAY_TICKS, type PlayerCommand, type PlayerId, type ReplayEntry, type SimConfig } from '../../src/sim/types';
import { HELLO_TIMEOUT_MS, MAX_SOCKETS_PER_IP, RoomManager, SILENT_PROBE_AFTER_MS, SILENT_PROBE_TIMEOUT_MS, type SocketLike } from '../rooms';

const TICK_MS = 1000 / TICK_RATE;
const LEVEL_1 = WORLD1_IDS[0] ?? '';
const LEVEL_2 = WORLD1_IDS[1] ?? LEVEL_1;

type Of<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

class FakeSocket implements SocketLike {
  sent: ServerMessage[] = [];
  readyState = 1;
  isAlive = true;
  bufferedAmount = 0;
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  terminated = false;
  pings = 0;
  answered = 0;
  /** A half-open link: ws pings get no pong (a live browser answers them from the network stack). */
  deaf = false;

  constructor(public ip: string) {}

  ping(): void {
    this.pings += 1;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }

  of<T extends ServerMessageType>(type: T): Of<T>[] {
    return this.sent.filter((m): m is Of<T> => m.type === type);
  }

  last<T extends ServerMessageType>(type: T): Of<T> {
    const all = this.of(type);
    const m = all[all.length - 1];
    if (m === undefined) throw new Error(`no ${type} frame; got ${this.sent.map((x) => x.type).join(',')}`);
    return m;
  }

  errors(): string[] {
    return this.of('error').map((e) => e.code);
  }

  clear(): void {
    this.sent = [];
  }
}

class Harness {
  now = 10_000;
  tokens = 0;
  logs: string[] = [];
  readonly rm = new RoomManager({
    now: () => this.now,
    random: () => (++this.tokens).toString(16).padStart(32, '0'),
    log: (m) => this.logs.push(m),
  });

  readonly sockets: FakeSocket[] = [];

  open(ip = '203.0.113.7'): FakeSocket {
    const s = new FakeSocket(ip);
    this.sockets.push(s);
    this.rm.handleOpen(s);
    return s;
  }

  /** Live sockets pong every ws ping on the next poll, like a browser does without running page script. */
  private answerPings(): void {
    for (const s of this.sockets) {
      if (s.deaf || s.readyState !== 1 || s.pings === s.answered) continue;
      s.answered = s.pings;
      this.rm.handlePong(s);
    }
  }

  say(socket: FakeSocket, msg: ClientMessage | Record<string, unknown>): void {
    this.rm.handleMessage(socket, JSON.stringify(msg));
  }

  raw(socket: FakeSocket, frame: string): void {
    this.rm.handleMessage(socket, frame);
  }

  hello(socket: FakeSocket): void {
    this.say(socket, { type: 'hello', protocol: PROTOCOL_VERSION });
  }

  connect(ip?: string): FakeSocket {
    const s = this.open(ip);
    this.hello(s);
    return s;
  }

  createRoom(ip?: string): { host: FakeSocket; code: string; token: string } {
    const host = this.connect(ip);
    this.say(host, { type: 'createRoom' });
    const created = host.last('roomCreated');
    return { host, code: created.code, token: created.reconnectToken };
  }

  join(code: string, ip?: string): FakeSocket {
    const guest = this.connect(ip);
    this.say(guest, { type: 'joinRoom', code });
    return guest;
  }

  lobby(): { host: FakeSocket; guest: FakeSocket; code: string; hostToken: string; guestToken: string } {
    const { host, code, token } = this.createRoom();
    const guest = this.join(code);
    const guestToken = guest.last('joined').reconnectToken;
    host.clear();
    guest.clear();
    return { host, guest, code, hostToken: token, guestToken };
  }

  game(): { host: FakeSocket; guest: FakeSocket; code: string; hostToken: string; guestToken: string; config: SimConfig } {
    const room = this.lobby();
    this.say(room.host, { type: 'start' });
    const config = room.host.last('start').sync.config;
    room.host.clear();
    room.guest.clear();
    return { ...room, config };
  }

  advance(ms: number): void {
    this.now += ms;
    this.rm.tickAll(this.now);
    this.answerPings();
  }

  ticks(n: number): void {
    for (let i = 0; i < n; i += 1) this.advance(TICK_MS);
  }

  /** The sim tick as the server reports it in a pong (works without any snapshot traffic). */
  tickOf(socket: FakeSocket): number {
    socket.clear();
    this.say(socket, { type: 'ping', t: 1 });
    return socket.last('pong').tick;
  }

  command(socket: FakeSocket, cmd: PlayerCommand): void {
    this.say(socket, { type: 'command', cmd });
  }

  /** Dismiss the intro from the host so the active player may aim (requires the real stepSim). */
  teeOff(host: FakeSocket): void {
    this.command(host, { type: 'continue', playerId: 0 });
    this.ticks(1);
    this.ticks(TURN_DELAY_TICKS);
  }
}

const aim = (playerId: PlayerId, angle: number, power: number): ClientMessage => ({ type: 'command', cmd: { type: 'setAim', playerId, angle, power } });

describe('RoomManager handshake and lobby', () => {
  it('createRoom before hello => BAD_MESSAGE; 5 of them => closed 1008', () => {
    const h = new Harness();
    const s = h.open();
    for (let i = 0; i < 4; i += 1) h.say(s, { type: 'createRoom' });
    expect(s.errors()).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE', 'BAD_MESSAGE', 'BAD_MESSAGE']);
    expect(s.closed).toBeNull();
    h.say(s, { type: 'createRoom' });
    expect(s.closed?.code).toBe(1008);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });

  it('bad frames outside the 10 s window do not accumulate', () => {
    const h = new Harness();
    const s = h.connect();
    for (let i = 0; i < 4; i += 1) h.raw(s, 'not json');
    h.advance(LIMITS.badMessageWindowMs + 1);
    h.raw(s, 'not json');
    expect(s.errors()).toHaveLength(5);
    expect(s.closed).toBeNull();
  });

  it('hello with the wrong protocol => VERSION_MISMATCH and the socket is closed', () => {
    const h = new Harness();
    const s = h.open();
    h.say(s, { type: 'hello', protocol: PROTOCOL_VERSION + 1 });
    expect(s.errors()).toEqual(['VERSION_MISMATCH']);
    expect(s.closed).not.toBeNull();
    expect(h.rm.stats().sockets).toBe(0);
  });

  it('hello => welcome with serverTime; create => roomCreated + token + lobby', () => {
    const h = new Harness();
    const s = h.connect();
    expect(s.last('welcome')).toEqual({ type: 'welcome', protocol: PROTOCOL_VERSION, serverTime: h.now });
    h.say(s, { type: 'createRoom' });
    const created = s.last('roomCreated');
    expect(created.playerId).toBe(0);
    expect(ROOM_CODE_RE.test(created.code)).toBe(true);
    expect(RECONNECT_TOKEN_RE.test(created.reconnectToken)).toBe(true);
    expect(created.lobby).toEqual({ levelId: LEVEL_1, players: [true, false], names: ['Red', ''] });
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 1, playing: 0 });
  });

  it('second createRoom (or joinRoom) while in a room => ALREADY_IN_ROOM', () => {
    const h = new Harness();
    const { host, code } = h.createRoom();
    h.say(host, { type: 'createRoom' });
    h.say(host, { type: 'joinRoom', code });
    expect(host.errors()).toEqual(['ALREADY_IN_ROOM', 'ALREADY_IN_ROOM']);
    expect(h.rm.stats().rooms).toBe(1);
  });

  it('join bad code => ROOM_NOT_FOUND; join => joined + peerJoined/lobbyState; third join => ROOM_FULL', () => {
    const h = new Harness();
    const { host, code } = h.createRoom();
    const stranger = h.join('ZZZZZ');
    expect(stranger.errors()).toEqual(['ROOM_NOT_FOUND']);
    const guest = h.join(code);
    const joined = guest.last('joined');
    expect(joined.playerId).toBe(1);
    expect(joined.peerConnected).toBe(true);
    expect(joined.sync).toBeUndefined();
    expect(joined.lobby.players).toEqual([true, true]);
    expect(host.last('peerJoined')).toEqual({ type: 'peerJoined', playerId: 1, name: 'Blue' });
    expect(host.last('lobbyState').lobby.players).toEqual([true, true]);
    const third = h.join(code);
    expect(third.errors()).toEqual(['ROOM_FULL']);
  });

  it('guest setLevel / start => NOT_HOST; host setLevel broadcasts lobbyState', () => {
    const h = new Harness();
    const { host, guest } = h.lobby();
    h.say(guest, { type: 'setLevel', levelId: LEVEL_2 });
    h.say(guest, { type: 'start' });
    expect(guest.errors()).toEqual(['NOT_HOST', 'NOT_HOST']);
    h.say(host, { type: 'setLevel', levelId: LEVEL_2 });
    expect(host.last('lobbyState').lobby.levelId).toBe(LEVEL_2);
    expect(guest.last('lobbyState').lobby.levelId).toBe(LEVEL_2);
  });

  it('start with an unknown or duplicate level id => BAD_MESSAGE; unknown setLevel => BAD_MESSAGE', () => {
    const h = new Harness();
    const { host } = h.lobby();
    h.say(host, { type: 'start', levelIds: ['no-such-level'] });
    h.say(host, { type: 'start', levelIds: [LEVEL_1, LEVEL_1] });
    h.say(host, { type: 'setLevel', levelId: 'no-such-level' });
    expect(host.errors()).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE', 'BAD_MESSAGE']);
    expect(h.rm.stats().playing).toBe(0);
  });

  it('start without a guest => PEER_MISSING', () => {
    const h = new Harness();
    const { host } = h.createRoom();
    h.say(host, { type: 'start' });
    expect(host.errors()).toEqual(['PEER_MISSING']);
  });

  it('start => both get start{sync} with identical snapshots, the campaign from the lobby hole and sync.serverTime', () => {
    const h = new Harness();
    const { host, guest } = h.lobby();
    h.say(host, { type: 'setLevel', levelId: LEVEL_2 });
    h.say(host, { type: 'start' });
    const a = host.last('start').sync;
    const b = guest.last('start').sync;
    expect(a).toEqual(b);
    expect(a.serverTime).toBe(h.now);
    expect(a.tick).toBe(0);
    expect(a.config.mode).toBe('online');
    expect(a.config.playerCount).toBe(2);
    expect(a.config.levelIds).toEqual(WORLD1_IDS.slice(WORLD1_IDS.indexOf(LEVEL_2)));
    const state = decodeSnapshot(a.snap, a.config);
    expect(state.phase).toBe('intro');
    expect(state.players[0].aim).toEqual(DEFAULT_AIM);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 2, playing: 1 });
    h.say(host, { type: 'start' });
    expect(host.errors()).toEqual(['WRONG_PHASE']);
  });

  it('a guest leaving the lobby returns the host to WAITING with the same code', () => {
    const h = new Harness();
    const { host, guest, code } = h.lobby();
    h.say(guest, { type: 'leaveRoom' });
    expect(host.last('peerLeft')).toEqual({ type: 'peerLeft', playerId: 1, reason: 'left', graceMs: 0 });
    expect(host.last('lobbyState').lobby.players).toEqual([true, false]);
    const again = h.join(code);
    expect(again.last('joined').playerId).toBe(1);
    h.say(guest, { type: 'createRoom' });
    expect(guest.last('roomCreated').code).not.toBe(code);
  });

  it('a lobby that never starts is closed after LIMITS.lobbyWaitMs even while the host keeps talking', () => {
    const h = new Harness();
    const { host } = h.createRoom();
    const step = LIMITS.roomIdleMs / 2;
    let elapsed = 0;
    while (elapsed + step < LIMITS.lobbyWaitMs) {
      h.advance(step);
      h.say(host, { type: 'setLevel', levelId: LEVEL_1 });
      elapsed += step;
    }
    h.advance(LIMITS.lobbyWaitMs - elapsed - 1);
    expect(host.of('roomClosed')).toHaveLength(0);
    h.advance(2);
    expect(host.last('roomClosed').reason).toBe('idle');
    expect(h.rm.stats().rooms).toBe(0);
  });

  it('a waiting host with no inbound traffic is closed after LIMITS.roomIdleMs', () => {
    const h = new Harness();
    const { host } = h.createRoom();
    h.advance(LIMITS.roomIdleMs + 1);
    expect(host.last('roomClosed').reason).toBe('idle');
  });
});

describe('RoomManager ticking', () => {
  it('tickAll with 50 ms elapsed => exactly 3 sim ticks (integer units); 400 ms => capped at 15', () => {
    const h = new Harness();
    const { host } = h.game();
    expect(h.tickOf(host)).toBe(0);
    h.advance(50);
    expect(h.tickOf(host)).toBe(3);
    h.advance(400);
    expect(h.tickOf(host)).toBe(18);
    h.advance(1);
    expect(h.tickOf(host)).toBe(18);
    h.advance(16);
    expect(h.tickOf(host)).toBe(19);
  });

  it('nothing ticks before start, and 8 ms polls accumulate without drift (60 ticks per second)', () => {
    const h = new Harness();
    const { host } = h.lobby();
    h.advance(1000);
    h.say(host, { type: 'start' });
    for (let i = 0; i < 125; i += 1) h.advance(8);
    expect(h.tickOf(host)).toBe(60);
  });

  it('snapshots keep alive at 1/s while nothing changes, with events delivered exactly once', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS - 1);
    expect(host.of('snapshot')).toHaveLength(0);
    h.ticks(1);
    expect(host.of('snapshot')).toHaveLength(1);
    const first = host.last('snapshot');
    expect(first.tick).toBe(SNAPSHOT_KEEPALIVE_TICKS);
    expect(first.serverTime).toBe(h.now);
    expect(first.events.map((e) => e.type)).toEqual(['levelStart']);
    expect(guest.last('snapshot').events.map((e) => e.type)).toEqual(['levelStart']);
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    expect(host.of('snapshot')).toHaveLength(2);
    expect(host.last('snapshot').events).toEqual([]);
  });

  it('a socket with bufferedAmount 100 KB skips a snapshot and the next one carries ALL missed events (cursor)', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    guest.bufferedAmount = 100 * 1024;
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    expect(host.of('snapshot')).toHaveLength(1);
    expect(guest.of('snapshot')).toHaveLength(0);
    guest.bufferedAmount = 0;
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    expect(guest.of('snapshot')).toHaveLength(1);
    expect(guest.last('snapshot').events.map((e) => e.type)).toEqual(['levelStart']);
    expect(host.last('snapshot').events).toEqual([]);
  });

  it('an exception inside a room tick => error{INTERNAL} + roomClosed{internalError}, never a throw', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    Object.defineProperty(guest, 'bufferedAmount', {
      get: () => {
        throw new Error('boom');
      },
    });
    expect(() => h.ticks(SNAPSHOT_KEEPALIVE_TICKS)).not.toThrow();
    expect(host.errors()).toEqual(['INTERNAL']);
    expect(host.last('roomClosed').reason).toBe('internalError');
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 2, playing: 0 });
    expect(h.logs.some((l) => l.includes('boom'))).toBe(true);
  });
});

describe('RoomManager gameplay (needs the real stepSim)', () => {
  it('guest shoot on the host turn => NOT_YOUR_TURN; guest setAim => silently dropped', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    h.teeOff(host);
    guest.clear();
    h.command(guest, { type: 'shoot', playerId: 1 });
    expect(guest.errors()).toEqual(['NOT_YOUR_TURN']);
    guest.clear();
    h.say(guest, aim(1, -1, 40));
    expect(guest.sent).toEqual([]);
    h.command(guest, { type: 'restartLevel', playerId: 1 });
    expect(guest.errors()).toEqual(['NOT_HOST']);
    h.command(guest, { type: 'continue', playerId: 1 });
    h.ticks(1);
    expect(guest.errors()).toEqual(['NOT_HOST']);
    expect(host.of('snapshot').every((s) => s.snap[PHASE_INDEX] === PHASE_CODES.aiming)).toBe(true);
  });

  it('a second continue one tick after the first (Tee off race) is absorbed silently: no error frame', () => {
    const h = new Harness();
    const { host, guest, config } = h.game();
    h.command(host, { type: 'continue', playerId: 0 });
    h.ticks(1);
    expect(decodeSnapshot(host.last('snapshot').snap, config).phase).toBe('aiming');
    guest.clear();
    h.command(guest, { type: 'continue', playerId: 1 });
    h.ticks(1);
    expect(guest.errors()).toEqual([]);
    expect(decodeSnapshot(host.last('snapshot').snap, config).phase).toBe('aiming');
  });

  it('commands during a partner pause are refused (WRONG_PHASE) or dropped (setAim) and nothing fires on resume', () => {
    const h = new Harness();
    const { host, guest, code, guestToken, config } = h.game();
    h.teeOff(host);
    host.clear();
    h.say(host, aim(0, -1.0, 55));
    h.command(host, { type: 'shoot', playerId: 0 });
    h.rm.handleClose(guest);
    expect(host.last('paused').paused).toBe(true);
    host.clear();
    h.say(host, aim(0, -2.0, 70));
    h.command(host, { type: 'shoot', playerId: 0 });
    h.command(host, { type: 'restartLevel', playerId: 0 });
    h.command(host, { type: 'continue', playerId: 0 });
    expect(host.errors()).toEqual(['WRONG_PHASE', 'WRONG_PHASE', 'WRONG_PHASE']);
    h.advance(20_000);
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: guestToken });
    host.clear();
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    const keepalive = host.last('snapshot');
    expect(keepalive.events.map((e) => e.type)).toEqual([]);
    expect(decodeSnapshot(keepalive.snap, config).phase).toBe('aiming');
    expect(decodeSnapshot(keepalive.snap, config).players[0].strokes).toBe(0);
  });

  it('shoot during the intro => WRONG_PHASE; either player may continue', () => {
    const h = new Harness();
    const { host, guest, config } = h.game();
    h.command(host, { type: 'shoot', playerId: 0 });
    expect(host.errors()).toEqual(['WRONG_PHASE']);
    h.command(guest, { type: 'continue', playerId: 1 });
    h.ticks(1);
    const snap = decodeSnapshot(guest.last('snapshot').snap, config);
    expect(snap.phase).toBe('aiming');
    expect(guest.errors()).toEqual([]);
  });

  it('setAim then shoot from the active slot in one tick => the shot uses the NEW aim (ballHit.angle)', () => {
    const h = new Harness();
    const { host } = h.game();
    h.teeOff(host);
    host.clear();
    h.say(host, aim(0, -1.2, 60));
    h.say(host, aim(0, -1.1, 61));
    h.command(host, { type: 'shoot', playerId: 0 });
    h.ticks(1);
    const snap = host.last('snapshot');
    const hit = snap.events.find((e) => e.type === 'ballHit');
    expect(hit).toMatchObject({ type: 'ballHit', playerId: 0, angle: -1.1, power: 61 });
    expect(snap.immediate).toBe(true);
    expect(snap.snap[PHASE_INDEX]).toBe(PHASE_CODES.flying);
  });

  it('valid shoot => a snapshot on the SAME tick with immediate: true and ballHit; then every 3 ticks while flying', () => {
    const h = new Harness();
    const { host } = h.game();
    h.teeOff(host);
    host.clear();
    h.command(host, { type: 'shoot', playerId: 0 });
    h.ticks(1);
    expect(host.of('snapshot')).toHaveLength(1);
    expect(host.last('snapshot').immediate).toBe(true);
    expect(host.last('snapshot').events.some((e) => e.type === 'ballHit')).toBe(true);
    const tick0 = host.last('snapshot').tick;
    h.ticks(9);
    const ticks = host.of('snapshot').map((s) => s.tick);
    expect(ticks).toEqual([tick0, tick0 + 3, tick0 + 6, tick0 + 9]);
    expect(host.of('snapshot').slice(1).every((s) => !s.immediate)).toBe(true);
  });

  it('a late setAim replaces the pending one in place (order with a later shoot preserved)', () => {
    const h = new Harness();
    const { host } = h.game();
    h.teeOff(host);
    host.clear();
    h.say(host, aim(0, -2, 30));
    h.command(host, { type: 'shoot', playerId: 0 });
    h.say(host, aim(0, -2.5, 35));
    h.ticks(1);
    const hit = host.last('snapshot').events.find((e) => e.type === 'ballHit');
    expect(hit).toMatchObject({ angle: -2.5, power: 35 });
  });

  it('never auto-advances (D6): a minute on the intro card leaves it up, then either seat dismisses it', () => {
    const h = new Harness();
    const { host, guest, config } = h.game();
    h.ticks(60 * TICK_RATE);
    const idle = host.last('snapshot');
    expect(decodeSnapshot(idle.snap, config).phase).toBe('intro');
    expect(idle.events.map((e) => e.type)).not.toContain('playStart');
    h.command(guest, { type: 'continue', playerId: 1 });
    h.ticks(1);
    expect(decodeSnapshot(host.last('snapshot').snap, config).phase).toBe('aiming');
  });

  it('playAgain: guest => NOT_HOST; host while the guest is in grace => PEER_MISSING; host with both back => start, unpaused', () => {
    const h = new Harness();
    const { host, guest, code, guestToken, config } = campaignResults(h);
    h.say(guest, { type: 'playAgain' });
    expect(guest.errors()).toEqual(['NOT_HOST']);
    h.rm.handleClose(guest);
    host.clear();
    h.say(host, { type: 'playAgain' });
    expect(host.errors()).toEqual(['PEER_MISSING']);
    expect(host.of('start')).toHaveLength(0);
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: guestToken });
    expect(back.last('joined').sync).toBeDefined();
    h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
    expect(decodeSnapshot(host.last('snapshot').snap, config).phase).toBe('campaignResults');
    host.clear();
    h.say(host, { type: 'playAgain' });
    expect(host.errors()).toEqual([]);
    expect(host.of('start')).toHaveLength(1);
    expect(back.of('start')).toHaveLength(1);
    h.command(host, { type: 'continue', playerId: 0 });
    h.ticks(1);
    expect(host.errors()).toEqual([]);
    expect(decodeSnapshot(host.last('snapshot').snap, config).phase).toBe('aiming');
  });
});

/** A one-hole online campaign played to campaignResults with the golden line of World 1 hole 1. */
function campaignResults(h: Harness): ReturnType<Harness['lobby']> & { config: SimConfig } {
  const room = h.lobby();
  const line = GOLDEN_LINES[0];
  if (line === undefined) throw new Error('no golden line');
  h.say(room.host, { type: 'start', levelIds: [LEVEL_1] });
  const config = room.host.last('start').sync.config;
  const seats = [room.host, room.guest] as const;
  let cursor = 0;
  for (let t = 0; t < line.finalTick; t += 1) {
    for (; cursor < line.log.length && (line.log[cursor] as ReplayEntry).tick === t; cursor += 1) {
      const entry = line.log[cursor] as ReplayEntry;
      h.command(seats[entry.cmd.playerId], entry.cmd);
    }
    h.ticks(1);
  }
  h.command(room.host, { type: 'continue', playerId: 0 });
  h.ticks(SNAPSHOT_KEEPALIVE_TICKS);
  expect(decodeSnapshot(room.host.last('snapshot').snap, config).phase).toBe('campaignResults');
  room.host.clear();
  room.guest.clear();
  return { ...room, config };
}

const PHASE_INDEX = 2;

describe('RoomManager presence, grace and limits', () => {
  it('guest close => host gets peerLeft{graceMs:60000} + paused; the sim stops ticking', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    h.ticks(3);
    h.rm.handleClose(guest);
    expect(host.last('peerLeft')).toEqual({ type: 'peerLeft', playerId: 1, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    expect(host.last('paused')).toEqual({ type: 'paused', paused: true, reason: 'peerDisconnected' });
    const before = h.tickOf(host);
    h.advance(1000);
    expect(h.tickOf(host)).toBe(before);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 1, playing: 1 });
  });

  it('host close in LOBBY(2) => guest gets peerLeft{disconnected} WITHOUT paused; expiry => roomClosed{peerTimeout}', () => {
    const h = new Harness();
    const { host, guest } = h.lobby();
    h.rm.handleClose(host);
    expect(guest.last('peerLeft')).toMatchObject({ playerId: 0, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    expect(guest.of('paused')).toHaveLength(0);
    h.advance(LIMITS.reconnectGraceMs - 1);
    expect(guest.of('roomClosed')).toHaveLength(0);
    h.advance(2);
    expect(guest.last('roomClosed').reason).toBe('peerTimeout');
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 1, playing: 0 });
  });

  it('rejoin with token => joined{sync} + peerReconnected + unpaused, lastTickAt reset (no catch-up ticks)', () => {
    const h = new Harness();
    const { host, guest, code, guestToken } = h.game();
    h.ticks(6);
    h.rm.handleClose(guest);
    const tickAtDrop = h.tickOf(host);
    h.advance(LIMITS.reconnectGraceMs - 1000);
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: guestToken });
    const joined = back.last('joined');
    expect(joined.playerId).toBe(1);
    expect(joined.reconnectToken).toBe(guestToken);
    expect(joined.sync?.tick).toBe(tickAtDrop);
    expect(joined.sync?.serverTime).toBe(h.now);
    expect(host.last('peerReconnected')).toEqual({ type: 'peerReconnected', playerId: 1 });
    expect(host.last('paused')).toEqual({ type: 'paused', paused: false, reason: 'resumed' });
    expect(back.last('paused')).toEqual({ type: 'paused', paused: false, reason: 'resumed' });
    h.rm.tickAll(h.now);
    expect(h.tickOf(host)).toBe(tickAtDrop);
    h.advance(50);
    expect(h.tickOf(host)).toBe(tickAtDrop + 3);
    h.advance(LIMITS.reconnectGraceMs * 2);
    expect(host.of('roomClosed')).toHaveLength(0);
  });

  it('the host rejoining a LOBBY(2) room gets joined without sync and the guest a peerReconnected', () => {
    const h = new Harness();
    const { host, guest, code, hostToken } = h.lobby();
    h.rm.handleClose(host);
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: hostToken });
    const joined = back.last('joined');
    expect(joined.playerId).toBe(0);
    expect(joined.sync).toBeUndefined();
    expect(joined.lobby.players).toEqual([true, true]);
    expect(guest.last('peerReconnected').playerId).toBe(0);
    h.say(back, { type: 'start' });
    expect(back.of('start')).toHaveLength(1);
  });

  it('wrong token => BAD_TOKEN; the right token rejoins', () => {
    const h = new Harness();
    const { guest, code, guestToken } = h.game();
    h.rm.handleClose(guest);
    const bad = h.connect();
    h.say(bad, { type: 'joinRoom', code, reconnectToken: 'f'.repeat(32) });
    expect(bad.errors()).toEqual(['BAD_TOKEN']);
    h.say(bad, { type: 'joinRoom', code, reconnectToken: guestToken });
    expect(bad.last('joined').playerId).toBe(1);
  });

  it('a token rejoin while the old socket is still OPEN but half-open takes the seat over (latest wins)', () => {
    const h = new Harness();
    const { host, guest, code, guestToken } = h.game();
    h.ticks(6);
    guest.deaf = true;
    h.advance(2000);
    const tickBefore = h.tickOf(host);
    host.clear();
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: guestToken });
    expect(back.errors()).toEqual([]);
    expect(back.last('joined')).toMatchObject({ playerId: 1, reconnectToken: guestToken, peerConnected: true });
    expect(guest.terminated).toBe(true);
    expect(host.of('peerLeft')).toHaveLength(0);
    expect(host.of('paused')).toHaveLength(0);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 2, playing: 1 });
    // The evicted socket's late close event is a no-op for the room.
    h.rm.handleClose(guest);
    expect(host.of('peerLeft')).toHaveLength(0);
    h.advance(LIMITS.reconnectGraceMs + SILENT_PROBE_AFTER_MS + SILENT_PROBE_TIMEOUT_MS);
    expect(host.of('roomClosed')).toHaveLength(0);
    expect(h.tickOf(host)).toBeGreaterThan(tickBefore);
    h.say(back, { type: 'ping', t: 1 });
    expect(back.last('pong').tick).toBeGreaterThan(tickBefore);
  });

  it('a host token rejoin while the old host socket is still attached takes the seat over too', () => {
    const h = new Harness();
    const { host, guest, code, hostToken } = h.lobby();
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: hostToken });
    expect(back.last('joined')).toMatchObject({ playerId: 0, peerConnected: true });
    expect(host.terminated).toBe(true);
    expect(guest.of('peerLeft')).toHaveLength(0);
    expect(guest.of('roomClosed')).toHaveLength(0);
    h.say(back, { type: 'start' });
    expect(back.of('start')).toHaveLength(1);
    expect(guest.of('start')).toHaveLength(1);
  });

  it('a guest token that was released from an unstarted room becomes a fresh join', () => {
    const h = new Harness();
    const { host, guest, code, guestToken } = h.lobby();
    h.rm.handleClose(guest);
    expect(host.last('peerLeft')).toMatchObject({ playerId: 1, reason: 'disconnected', graceMs: 0 });
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: guestToken });
    const joined = back.last('joined');
    expect(joined.playerId).toBe(1);
    expect(joined.reconnectToken).not.toBe(guestToken);
  });

  it('host close in WAITING keeps the room for the grace window: token rejoin and the invite link still work', () => {
    const h = new Harness();
    const { host, code, token } = h.createRoom();
    h.rm.handleClose(host);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 0, playing: 0 });
    h.advance(1500);
    const friend = h.join(code);
    expect(friend.last('joined')).toMatchObject({ playerId: 1, peerConnected: false });
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: token });
    expect(back.last('joined')).toMatchObject({ playerId: 0, reconnectToken: token, peerConnected: true });
    expect(friend.last('peerReconnected').playerId).toBe(0);
    h.say(back, { type: 'start' });
    expect(back.of('start')).toHaveLength(1);
  });

  it('a WAITING host that never returns: the room is destroyed when the grace expires', () => {
    const h = new Harness();
    const { host } = h.createRoom();
    h.rm.handleClose(host);
    h.advance(LIMITS.reconnectGraceMs - 1);
    expect(h.rm.stats().rooms).toBe(1);
    h.advance(2);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });

  it('a socket that never says hello is closed (1008) after HELLO_TIMEOUT_MS; a helloed one is not', () => {
    const h = new Harness();
    const silent = h.open();
    const polite = h.connect();
    h.advance(HELLO_TIMEOUT_MS - 1);
    expect(silent.closed).toBeNull();
    h.advance(2);
    expect(silent.closed?.code).toBe(1008);
    expect(polite.closed).toBeNull();
    h.rm.heartbeat();
    expect(h.rm.stats().sockets).toBe(1);
  });

  it('per-ip socket cap: the 17th open socket from one ip gets SERVER_FULL and close 1013; closes free the slot', () => {
    const h = new Harness();
    const ip = '198.51.100.77';
    const held: FakeSocket[] = [];
    for (let i = 0; i < MAX_SOCKETS_PER_IP; i += 1) held.push(h.connect(ip));
    const extra = h.open(ip);
    expect(extra.errors()).toEqual(['SERVER_FULL']);
    expect(extra.closed?.code).toBe(1013);
    expect(h.rm.stats().sockets).toBe(MAX_SOCKETS_PER_IP);
    const other = h.open('198.51.100.78');
    expect(other.closed).toBeNull();
    h.rm.handleClose(held[0] as FakeSocket);
    const again = h.open(ip);
    expect(again.closed).toBeNull();
    expect(again.errors()).toEqual([]);
  });

  it('both players dropping keeps the paused room until the first grace lapses, then roomClosed{peerTimeout}', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    h.ticks(3);
    h.rm.handleClose(guest);
    h.advance(5000);
    h.rm.handleClose(host);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 0, playing: 1 });
    h.advance(LIMITS.reconnectGraceMs - 5000 - 1);
    expect(h.rm.stats().rooms).toBe(1);
    h.advance(2);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });

  it('both drop and both rejoin inside the grace: the first back waits (peerLeft with the remaining grace), the second resumes play', () => {
    const h = new Harness();
    const { host, guest, code, hostToken, guestToken } = h.game();
    h.ticks(6);
    const tickAtDrop = h.tickOf(host);
    h.rm.handleClose(host);
    h.advance(2000);
    h.rm.handleClose(guest);
    h.advance(10_000);
    const hostBack = h.connect();
    h.say(hostBack, { type: 'joinRoom', code, reconnectToken: hostToken });
    expect(hostBack.last('joined')).toMatchObject({ playerId: 0, peerConnected: false });
    expect(hostBack.last('joined').sync?.tick).toBe(tickAtDrop);
    expect(hostBack.last('peerLeft')).toEqual({ type: 'peerLeft', playerId: 1, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs - 10_000 });
    expect(hostBack.of('paused')).toHaveLength(0);
    h.advance(1000);
    expect(h.tickOf(hostBack)).toBe(tickAtDrop);
    const guestBack = h.connect();
    h.say(guestBack, { type: 'joinRoom', code, reconnectToken: guestToken });
    expect(guestBack.last('joined')).toMatchObject({ playerId: 1, peerConnected: true });
    expect(guestBack.of('peerLeft')).toHaveLength(0);
    expect(hostBack.last('peerReconnected').playerId).toBe(1);
    expect(hostBack.last('paused')).toEqual({ type: 'paused', paused: false, reason: 'resumed' });
    h.advance(50);
    expect(h.tickOf(hostBack)).toBe(tickAtDrop + 3);
    h.advance(LIMITS.reconnectGraceMs * 2);
    expect(hostBack.of('roomClosed')).toHaveLength(0);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 2, playing: 1 });
  });

  it('one heartbeat sweep catching both silent players keeps the room for the grace window', () => {
    const h = new Harness();
    const { host, guest, code, hostToken } = h.game();
    host.isAlive = false;
    guest.isAlive = false;
    h.rm.heartbeat();
    expect(host.terminated).toBe(true);
    expect(guest.terminated).toBe(true);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 0, playing: 1 });
    h.advance(30_000);
    const back = h.connect();
    h.say(back, { type: 'joinRoom', code, reconnectToken: hostToken });
    expect(back.last('joined')).toMatchObject({ playerId: 0, peerConnected: false });
    expect(back.errors()).toEqual([]);
  });

  it('a guest dropping after the host in an unstarted room is released; the host grace still closes the room', () => {
    const h = new Harness();
    const { host, guest } = h.lobby();
    h.rm.handleClose(host);
    h.rm.handleClose(guest);
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 0, playing: 0 });
    h.advance(LIMITS.reconnectGraceMs + 1);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });

  it('10 min idle => destroyed with roomClosed{idle}; pings do not count as activity', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    for (let i = 0; i < 10; i += 1) {
      h.advance(60_000);
      h.say(host, { type: 'ping', t: i });
    }
    expect(host.last('roomClosed').reason).toBe('idle');
    expect(guest.last('roomClosed').reason).toBe('idle');
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 2, playing: 0 });
  });

  it('a command resets the idle clock', () => {
    const h = new Harness();
    const { host } = h.game();
    h.advance(LIMITS.roomIdleMs - 1000);
    h.command(host, { type: 'continue', playerId: 0 });
    h.advance(LIMITS.roomIdleMs - 1000);
    expect(host.of('roomClosed')).toHaveLength(0);
  });

  it('host leaveRoom => roomClosed{hostLeft}; guest leaveRoom in PLAYING => roomClosed{guestLeft}', () => {
    const h = new Harness();
    const a = h.game();
    h.say(a.host, { type: 'leaveRoom' });
    expect(a.guest.last('roomClosed').reason).toBe('hostLeft');
    const b = h.game();
    h.say(b.guest, { type: 'leaveRoom' });
    expect(b.host.last('roomClosed').reason).toBe('guestLeft');
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 4, playing: 0 });
    h.say(b.guest, { type: 'leaveRoom' });
    expect(b.guest.errors()).toEqual(['NOT_IN_ROOM']);
  });

  it('non-JSON => BAD_MESSAGE; a command outside a room => NOT_IN_ROOM', () => {
    const h = new Harness();
    const s = h.connect();
    h.raw(s, 'not json at all');
    h.raw(s, '{"type":"createRoom"');
    expect(s.errors()).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE']);
    h.command(s, { type: 'shoot', playerId: 0 });
    expect(s.errors()).toEqual(['BAD_MESSAGE', 'BAD_MESSAGE', 'NOT_IN_ROOM']);
  });

  it('41 messages in 1 s => RATE_LIMITED, and the bucket refills', () => {
    const h = new Harness();
    const s = h.connect();
    for (let i = 0; i < 40; i += 1) h.say(s, { type: 'ping', t: i });
    expect(s.errors()).toEqual(['RATE_LIMITED']);
    expect(s.of('pong')).toHaveLength(39);
    h.advance(1000);
    s.clear();
    h.say(s, { type: 'ping', t: 99 });
    expect(s.errors()).toEqual([]);
    expect(s.of('pong')).toHaveLength(1);
  });

  it('setAim has its own 30/s budget and is coalesced, never rate-limited', () => {
    const h = new Harness();
    const { host } = h.game();
    for (let i = 0; i < 200; i += 1) h.say(host, aim(0, -1, 50));
    expect(host.errors()).toEqual([]);
    h.command(host, { type: 'continue', playerId: 0 });
    expect(host.errors()).toEqual([]);
  });

  it('room cap => SERVER_FULL (per server and per ip)', () => {
    const h = new Harness();
    for (let i = 0; i < LIMITS.maxRoomsPerIp; i += 1) h.createRoom('198.51.100.1');
    const extra = h.connect('198.51.100.1');
    h.say(extra, { type: 'createRoom' });
    expect(extra.errors()).toEqual(['SERVER_FULL']);
    let created = LIMITS.maxRoomsPerIp;
    while (created < LIMITS.maxRooms) {
      h.createRoom(`10.0.${Math.floor(created / 250)}.${created % 250}`);
      created += 1;
    }
    const last = h.connect('192.0.2.9');
    h.say(last, { type: 'createRoom' });
    expect(last.errors()).toEqual(['SERVER_FULL']);
    expect(h.rm.stats().rooms).toBe(LIMITS.maxRooms);
  });

  it('heartbeat terminates sockets that did not answer the last ping and runs their disconnect', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    guest.isAlive = false;
    h.rm.heartbeat();
    expect(guest.terminated).toBe(true);
    expect(host.terminated).toBe(false);
    expect(host.last('peerLeft').playerId).toBe(1);
    expect(h.rm.stats().sockets).toBe(1);
  });

  it('a socket silent for SILENT_PROBE_AFTER_MS is probed with a ws ping; a pong clears it, no pong => terminated + disconnect', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    guest.deaf = true;
    h.advance(SILENT_PROBE_AFTER_MS - 1);
    expect(guest.pings).toBe(0);
    h.advance(1);
    expect(guest.pings).toBe(1);
    expect(host.pings).toBe(1);
    h.advance(SILENT_PROBE_TIMEOUT_MS - 1);
    expect(guest.pings).toBe(1);
    expect(guest.terminated).toBe(false);
    h.advance(1);
    expect(guest.terminated).toBe(true);
    expect(host.terminated).toBe(false);
    expect(host.last('peerLeft')).toMatchObject({ playerId: 1, reason: 'disconnected', graceMs: LIMITS.reconnectGraceMs });
    expect(host.last('paused')).toMatchObject({ paused: true });
    expect(h.rm.stats()).toEqual({ rooms: 1, sockets: 1, playing: 1 });
    h.advance(SILENT_PROBE_AFTER_MS);
    expect(host.pings).toBe(2);
    expect(host.terminated).toBe(false);
  });

  it('a socket that keeps pinging is never probed; a socket that never said hello is not probed either', () => {
    const h = new Harness();
    const { host } = h.game();
    const mute = h.open();
    for (let i = 0; i < 10; i += 1) {
      h.advance(2000);
      h.say(host, { type: 'ping', t: i });
    }
    expect(host.pings).toBe(0);
    expect(host.terminated).toBe(false);
    expect(mute.pings).toBe(0);
    expect(mute.closed?.code).toBe(1008);
  });

  it('shutdown => roomClosed{serverShutdown} to everyone, sockets closed, stats zero', () => {
    const h = new Harness();
    const { host, guest } = h.game();
    const lone = h.connect();
    h.rm.shutdown();
    expect(host.last('roomClosed').reason).toBe('serverShutdown');
    expect(guest.last('roomClosed').reason).toBe('serverShutdown');
    expect(lone.closed).not.toBeNull();
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });

  it('stats() after everything => {rooms:0, sockets:0, playing:0}', () => {
    const h = new Harness();
    const a = h.game();
    const b = h.lobby();
    const c = h.createRoom();
    h.ticks(10);
    h.say(a.host, { type: 'leaveRoom' });
    h.rm.handleClose(a.host);
    h.rm.handleClose(a.guest);
    h.rm.handleClose(b.guest);
    h.rm.handleClose(b.host);
    h.rm.handleClose(c.host);
    expect(h.rm.stats()).toEqual({ rooms: 2, sockets: 0, playing: 0 });
    h.advance(LIMITS.reconnectGraceMs + 1);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
    expect(h.logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzz: malformed, oversized and deeply nested frames plus random valid traffic never throw.
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFrame(rnd: () => number, codes: string[]): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const junkValue = (): unknown =>
    pick<unknown>([null, true, -0, Number.NaN, 1e308, '', 'x'.repeat(Math.floor(rnd() * 64)), [], {}, [[[[[]]]]], { type: 'hello' }, 2 ** 40]);
  const types = ['hello', 'createRoom', 'joinRoom', 'leaveRoom', 'setLevel', 'start', 'command', 'playAgain', 'ping', 'input', ''];
  switch (Math.floor(rnd() * 8)) {
    case 0:
      return '['.repeat(1000) + ']'.repeat(1000);
    case 1:
      return `{"type":"createRoom","pad":"${'p'.repeat(100_000)}"}`;
    case 2:
      return String.fromCharCode(...Array.from({ length: 40 }, () => Math.floor(rnd() * 0x3000)));
    case 3:
      return JSON.stringify({ type: pick(types), protocol: junkValue(), code: pick([...codes, 'ABCDE', 'abcde', 12345]), levelId: junkValue(), levelIds: junkValue(), t: junkValue() });
    case 4:
      return JSON.stringify({
        type: 'command',
        cmd: { type: pick(['setAim', 'shoot', 'continue', 'restartLevel', 'nuke']), playerId: pick([0, 1, 2, '0', null]), angle: pick([-1, 0.5, junkValue()]), power: pick([50, 101, junkValue()]) },
      });
    case 5:
      return JSON.stringify({ type: 'joinRoom', code: pick(codes), reconnectToken: pick(['0'.repeat(32), 'zz', junkValue()]) });
    case 6:
      return JSON.stringify({ type: 'start', levelIds: pick([[LEVEL_1], [LEVEL_1, LEVEL_1], Array.from({ length: 20 }, (_, i) => `l-${i}`), junkValue()]) });
    default:
      return JSON.stringify(junkValue());
  }
}

describe('RoomManager fuzz', () => {
  it('never throws on malformed / oversized / nested frames mixed with random valid traffic', () => {
    const rnd = mulberry32(2026);
    const h = new Harness();
    const sockets: FakeSocket[] = [];
    const codes: string[] = [];
    for (let step = 0; step < 4000; step += 1) {
      const r = rnd();
      if (r < 0.08 || sockets.length === 0) {
        const s = h.open(`10.${step % 11}.${sockets.length % 7}.1`);
        if (rnd() < 0.8) h.hello(s);
        sockets.push(s);
      } else if (r < 0.14) {
        const s = sockets[Math.floor(rnd() * sockets.length)] as FakeSocket;
        h.say(s, { type: 'createRoom' });
        const created = s.of('roomCreated');
        const c = created[created.length - 1];
        if (c !== undefined && !codes.includes(c.code)) codes.push(c.code);
      } else if (r < 0.2 && codes.length > 0) {
        const s = sockets[Math.floor(rnd() * sockets.length)] as FakeSocket;
        h.say(s, { type: 'joinRoom', code: codes[Math.floor(rnd() * codes.length)] as string });
      } else if (r < 0.24) {
        const s = sockets[Math.floor(rnd() * sockets.length)] as FakeSocket;
        h.say(s, { type: 'start' });
        h.command(s, { type: 'continue', playerId: 0 });
      } else if (r < 0.3) {
        const s = sockets[Math.floor(rnd() * sockets.length)] as FakeSocket;
        h.say(s, aim(0, -1 - rnd(), 20 + Math.floor(rnd() * 60)));
        h.command(s, { type: 'shoot', playerId: 0 });
      } else if (r < 0.34) {
        const i = Math.floor(rnd() * sockets.length);
        const s = sockets[i] as FakeSocket;
        if (rnd() < 0.5) h.say(s, { type: 'leaveRoom' });
        h.rm.handleClose(s);
        sockets.splice(i, 1);
      } else if (r < 0.4) {
        h.advance(rnd() * 3000);
      } else if (r < 0.42) {
        h.advance(LIMITS.reconnectGraceMs + 1);
      } else {
        const s = sockets[Math.floor(rnd() * sockets.length)] as FakeSocket;
        expect(() => h.raw(s, randomFrame(rnd, codes))).not.toThrow();
      }
    }
    expect(h.logs.filter((l) => l.includes('failed'))).toEqual([]);
    for (const s of sockets) h.rm.handleClose(s);
    h.advance(LIMITS.roomIdleMs + LIMITS.lobbyWaitMs);
    expect(h.rm.stats()).toEqual({ rooms: 0, sockets: 0, playing: 0 });
  });
});
