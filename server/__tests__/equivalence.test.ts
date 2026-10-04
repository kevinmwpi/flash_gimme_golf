// OWNER: net
// ARCH.md §4 equivalence row: the only test that proves server path == local path.
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/net/protocol';
import { encodeSnapshot } from '../../src/sim/serialize';
import { runReplay } from '../../src/sim/sim';
import { TICK_RATE, type ReplayEntry, type SimConfig } from '../../src/sim/types';
import { RoomManager, type SocketLike } from '../rooms';

const TICK_MS = 1000 / TICK_RATE;

class FakeSocket implements SocketLike {
  sent: ServerMessage[] = [];
  readyState = 1;
  isAlive = true;
  ip = '127.0.0.1';
  bufferedAmount = 0;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  ping(): void {}
  snapshots(): Extract<ServerMessage, { type: 'snapshot' }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: 'snapshot' }> => m.type === 'snapshot');
  }
}

/**
 * A log that exercises every command type from both seats. Entries that the rules reject are
 * rejected identically on both paths; the point is that the server never diverges from runReplay.
 * No tick carries a setAim after a shoot from the same slot (the server coalesces setAim in place).
 */
const LOG: readonly ReplayEntry[] = [
  { tick: 0, cmd: { type: 'continue', playerId: 1 } },
  { tick: 2, cmd: { type: 'setAim', playerId: 0, angle: -0.9, power: 70 } },
  { tick: 2, cmd: { type: 'setAim', playerId: 0, angle: -0.95, power: 72 } },
  { tick: 3, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 3, cmd: { type: 'setAim', playerId: 1, angle: -2, power: 40 } },
  { tick: 40, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 300, cmd: { type: 'setAim', playerId: 1, angle: -2.2, power: 65 } },
  { tick: 301, cmd: { type: 'shoot', playerId: 1 } },
  { tick: 302, cmd: { type: 'setAim', playerId: 0, angle: -1.0, power: 50 } },
  { tick: 303, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 700, cmd: { type: 'setAim', playerId: 0, angle: -0.5, power: 90 } },
  { tick: 701, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 702, cmd: { type: 'restartLevel', playerId: 1 } },
  { tick: 1000, cmd: { type: 'restartLevel', playerId: 0 } },
  { tick: 1040, cmd: { type: 'setAim', playerId: 0, angle: -1.3, power: 80 } },
  { tick: 1041, cmd: { type: 'shoot', playerId: 0 } },
  { tick: 1300, cmd: { type: 'setAim', playerId: 1, angle: -1.9, power: 75 } },
  { tick: 1301, cmd: { type: 'shoot', playerId: 1 } },
];
const UNTIL_TICK = 1600;

describe('server == local equivalence', () => {
  it('the replay log fed through RoomManager tick by tick => final snapshot.snap deep-equals encodeSnapshot(runReplay(...).state)', () => {
    let now = 5000;
    const rm = new RoomManager({ now: () => now, random: () => 'a'.repeat(32) });
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
    say(host, { type: 'start' });
    const start = host.sent.find((m) => m.type === 'start');
    if (start?.type !== 'start') throw new Error('no start');
    const config: SimConfig = start.sync.config;
    const seats = [host, guest] as const;

    let cursor = 0;
    for (let t = 0; t < UNTIL_TICK; t += 1) {
      while (cursor < LOG.length && (LOG[cursor] as ReplayEntry).tick === t) {
        const entry = LOG[cursor] as ReplayEntry;
        say(seats[entry.cmd.playerId], { type: 'command', cmd: entry.cmd });
        cursor += 1;
      }
      now += TICK_MS;
      rm.tickAll(now);
    }
    expect(cursor).toBe(LOG.length);

    const snaps = host.snapshots();
    const last = snaps[snaps.length - 1];
    if (last === undefined) throw new Error('no snapshot received');
    expect(last.tick).toBeGreaterThan(LOG[LOG.length - 1]?.tick ?? 0);
    const local = runReplay(config, LOG, last.tick);
    expect(last.snap).toEqual(encodeSnapshot(local.state));
    expect(guest.snapshots()[guest.snapshots().length - 1]?.snap).toEqual(last.snap);

    const serverEvents = snaps.flatMap((s) => s.events).filter((e) => e.tick < last.tick);
    const localEvents = local.events.filter((e) => e.type !== 'commandRejected' && e.tick < last.tick);
    expect(serverEvents).toEqual(localEvents);
  });
});
