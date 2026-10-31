// OWNER: net
// Worlds 2-3 online (BUILD_DECISIONS D10.4-D10.6): on the device fixtures, the server path equals runReplay under
// the WAITING rule (catches, a scoped reset, skipped turns, a partner-fired cannon), device teleports go out at
// once, and the flight watchdog leaves a log line.
import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/net/protocol';
import { MACHINE_LOG, MACHINE_LOG_TICKS, machineLevel, pogoLevel } from '../../src/sim/__tests__/device-fixtures';
import { encodeSnapshot } from '../../src/sim/serialize';
import { runReplay } from '../../src/sim/sim';
import { FLIGHT_WATCHDOG_TICKS, TICK_RATE, type PlayerCommand, type ReplayEntry, type SimConfig } from '../../src/sim/types';
import { RoomManager, type SocketLike } from '../rooms';

vi.mock('../../src/sim/levels/index', async () => (await import('../../src/sim/__tests__/device-fixtures')).deviceRegistry);

const TICK_MS = 1000 / TICK_RATE;

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;

class FakeSocket implements SocketLike {
  sent: ServerMessage[] = [];
  readyState = 1;
  isAlive = true;
  ip = '127.0.0.1';
  bufferedAmount = 0;
  pings = 0;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  ping(): void {
    this.pings += 1;
  }
  snapshots(): Snapshot[] {
    return this.sent.filter((m): m is Snapshot => m.type === 'snapshot');
  }
}

/** A started two-seat room on `levelId`; `step(cmds)` sends each command from its own seat and ticks once. */
function room(levelId: string): { config: SimConfig; host: FakeSocket; guest: FakeSocket; logs: string[]; code: string; step(cmds: readonly PlayerCommand[]): void } {
  let now = 5000;
  const logs: string[] = [];
  const rm = new RoomManager({ now: () => now, random: () => 'c'.repeat(32), log: (m) => logs.push(m) });
  const host = new FakeSocket();
  const guest = new FakeSocket();
  const say = (s: FakeSocket, msg: unknown): void => rm.handleMessage(s, JSON.stringify(msg));
  for (const s of [host, guest]) {
    rm.handleOpen(s);
    say(s, { type: 'hello', protocol: PROTOCOL_VERSION });
  }
  say(host, { type: 'createRoom' });
  const created = host.sent.find((m) => m.type === 'roomCreated');
  if (created?.type !== 'roomCreated') throw new Error('no roomCreated');
  say(guest, { type: 'joinRoom', code: created.code });
  say(host, { type: 'start', levelIds: [levelId] });
  const start = host.sent.find((m) => m.type === 'start');
  if (start?.type !== 'start') throw new Error('no start');
  const seats = [host, guest] as const;
  return {
    config: start.sync.config,
    host,
    guest,
    logs,
    code: created.code,
    step(cmds) {
      for (const cmd of cmds) say(seats[cmd.playerId], { type: 'command', cmd });
      now += TICK_MS;
      rm.tickAll(now);
      // a live browser answers the server's ws probe of a quiet socket from its network stack
      for (const s of seats) {
        if (s.pings === 0) continue;
        s.pings = 0;
        rm.handlePong(s);
      }
    },
  };
}

describe('online devices (fixture registry)', () => {
  it('the device scenario fed through RoomManager equals runReplay: final snapshot and every event', () => {
    const r = room(machineLevel.id);
    expect(r.config.levelIds).toEqual([machineLevel.id]);
    let cursor = 0;
    for (let t = 0; t < MACHINE_LOG_TICKS + 2 * TICK_RATE; t += 1) {
      const cmds: PlayerCommand[] = [];
      while (cursor < MACHINE_LOG.length && (MACHINE_LOG[cursor] as ReplayEntry).tick === t) cmds.push((MACHINE_LOG[cursor++] as ReplayEntry).cmd);
      r.step(cmds);
    }
    expect(cursor).toBe(MACHINE_LOG.length);
    const snaps = r.host.snapshots();
    const last = snaps[snaps.length - 1];
    if (last === undefined) throw new Error('no snapshot');
    const local = runReplay(r.config, MACHINE_LOG, last.tick);
    expect(local.state.phase).toBe('levelResults');
    expect(last.snap).toEqual(encodeSnapshot(local.state));
    expect(r.guest.snapshots()[r.guest.snapshots().length - 1]?.snap).toEqual(last.snap);
    const serverEvents = snaps.flatMap((s) => s.events).filter((e) => e.tick < last.tick);
    const localEvents = local.events.filter((e) => e.type !== 'commandRejected' && e.tick < last.tick);
    expect(serverEvents).toEqual(localEvents);
    for (const type of ['trapCaught', 'trapReturn', 'turnSkipped', 'trapFreed', 'cannonLoad', 'cannonFire'] as const) {
      expect(serverEvents.some((e) => e.type === type), type).toBe(true);
    }
    // the scoped reset teleports a ball: its snapshot goes out the same tick, marked immediate
    const reset = snaps.find((s) => s.events.some((e) => e.type === 'trapReturn'));
    expect(reset?.immediate).toBe(true);
    expect(reset?.tick).toBe(serverEvents.find((e) => e.type === 'trapReturn')?.tick);
    expect(r.logs).toEqual([]);
  });

  it('the flight watchdog ends a perpetual flight online and leaves one log line; nothing else is logged', () => {
    const r = room(pogoLevel.id);
    r.step([{ type: 'continue', playerId: 0 }]);
    r.step([
      { type: 'setAim', playerId: 0, angle: -0.03, power: 50 },
      { type: 'shoot', playerId: 0 },
    ]);
    for (let t = 0; t < FLIGHT_WATCHDOG_TICKS + TICK_RATE; t += 1) r.step([]);
    const timeouts = r.host.snapshots().flatMap((s) => s.events.filter((e) => e.type === 'flightTimeout'));
    expect(timeouts).toEqual([expect.objectContaining({ playerId: 0 })]);
    expect(r.host.snapshots().find((s) => s.events.some((e) => e.type === 'flightTimeout'))?.immediate).toBe(true);
    expect(r.logs).toEqual([`room ${r.code} flightTimeout: ${pogoLevel.id} tick ${timeouts[0]?.tick} player 0`]);
  });
});
