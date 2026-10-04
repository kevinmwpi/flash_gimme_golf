// OWNER: net
// ARCH.md §4 protocol row.
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_VERSION } from '../../sim/types';
import { LIMITS, MAX_CAMPAIGN_LENGTH, PROTOCOL_VERSION, parseClientMessage, parsePlayerCommand, parseServerMessage } from '../protocol';

const frame = (v: unknown): string => JSON.stringify(v);

describe('parseClientMessage', () => {
  it('accepts every documented shape', () => {
    expect(parseClientMessage(frame({ type: 'hello', protocol: PROTOCOL_VERSION }))).toEqual({ type: 'hello', protocol: PROTOCOL_VERSION });
    expect(parseClientMessage(frame({ type: 'hello', protocol: 2, name: 'Kev' }))).toEqual({ type: 'hello', protocol: 2, name: 'Kev' });
    expect(parseClientMessage(frame({ type: 'createRoom' }))).toEqual({ type: 'createRoom' });
    expect(parseClientMessage(frame({ type: 'joinRoom', code: 'ABCDE' }))).toEqual({ type: 'joinRoom', code: 'ABCDE' });
    const token = 'a'.repeat(32);
    expect(parseClientMessage(frame({ type: 'joinRoom', code: 'ABCDE', reconnectToken: token }))).toEqual({
      type: 'joinRoom',
      code: 'ABCDE',
      reconnectToken: token,
    });
    expect(parseClientMessage(frame({ type: 'leaveRoom' }))).toEqual({ type: 'leaveRoom' });
    expect(parseClientMessage(frame({ type: 'setLevel', levelId: 'w1-01-first-fairway' }))).toEqual({ type: 'setLevel', levelId: 'w1-01-first-fairway' });
    expect(parseClientMessage(frame({ type: 'start' }))).toEqual({ type: 'start' });
    expect(parseClientMessage(frame({ type: 'start', levelIds: ['a', 'b'] }))).toEqual({ type: 'start', levelIds: ['a', 'b'] });
    expect(parseClientMessage(frame({ type: 'command', cmd: { type: 'setAim', playerId: 0, angle: -0.7854, power: 55 } }))).toEqual({
      type: 'command',
      cmd: { type: 'setAim', playerId: 0, angle: -0.7854, power: 55 },
    });
    for (const type of ['shoot', 'continue', 'restartLevel'] as const) {
      expect(parseClientMessage(frame({ type: 'command', cmd: { type, playerId: 1 } }))).toEqual({ type: 'command', cmd: { type, playerId: 1 } });
    }
    expect(parseClientMessage(frame({ type: 'playAgain' }))).toEqual({ type: 'playAgain' });
    expect(parseClientMessage(frame({ type: 'ping', t: 12.5 }))).toEqual({ type: 'ping', t: 12.5 });
  });

  it('REBUILDS objects: an extra junk key is absent from the result', () => {
    const parsed = parseClientMessage(frame({ type: 'joinRoom', code: 'ABCDE', junk: 1, __proto__: { evil: true } }));
    expect(parsed).toEqual({ type: 'joinRoom', code: 'ABCDE' });
    expect(Object.keys(parsed ?? {})).toEqual(['type', 'code']);
    const hello = parseClientMessage(frame({ type: 'hello', protocol: 3, junk: 'x' }));
    expect(Object.keys(hello ?? {})).toEqual(['type', 'protocol']);
  });

  it('rejects an unknown type and non-object frames', () => {
    expect(parseClientMessage(frame({ type: 'input', keys: ['ArrowLeft'] }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'HELLO', protocol: 3 }))).toBeNull();
    expect(parseClientMessage(frame([1, 2, 3]))).toBeNull();
    expect(parseClientMessage(frame('createRoom'))).toBeNull();
    expect(parseClientMessage(frame(null))).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('keeps a valid screen stamp on continue/restartLevel and rejects a malformed one', () => {
    for (const type of ['continue', 'restartLevel'] as const) {
      expect(parsePlayerCommand({ type, playerId: 1, levelIndex: 2, phase: 'levelResults', junk: 1 })).toEqual({ type, playerId: 1, levelIndex: 2, phase: 'levelResults' });
      expect(parsePlayerCommand({ type, playerId: 0, levelIndex: 0 })).toEqual({ type, playerId: 0, levelIndex: 0 });
      for (const bad of [{ levelIndex: -1 }, { levelIndex: 1.5 }, { levelIndex: MAX_CAMPAIGN_LENGTH }, { levelIndex: '0' }, { phase: 'results' }, { phase: 3 }]) {
        expect(parsePlayerCommand({ type, playerId: 0, ...bad })).toBeNull();
      }
    }
  });

  it('strips `held: 123` from a known command type', () => {
    const parsed = parseClientMessage(frame({ type: 'command', cmd: { type: 'shoot', playerId: 0, held: 123 } }));
    expect(parsed).toEqual({ type: 'command', cmd: { type: 'shoot', playerId: 0 } });
    expect(parsePlayerCommand({ type: 'setAim', playerId: 1, angle: -1, power: 50, held: 123 })).toEqual({
      type: 'setAim',
      playerId: 1,
      angle: -1,
      power: 50,
    });
  });

  it('rejects oversized frames (> LIMITS.maxMessageBytes)', () => {
    const big = frame({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'x'.repeat(LIMITS.maxMessageBytes) });
    expect(big.length).toBeGreaterThan(LIMITS.maxMessageBytes);
    expect(parseClientMessage(big)).toBeNull();
    const padded = `${' '.repeat(LIMITS.maxMessageBytes)}{"type":"createRoom"}`;
    expect(parseClientMessage(padded)).toBeNull();
  });

  it('rejects room codes containing O / 0 / I / 1, wrong length or lowercase', () => {
    for (const code of ['ABCDO', 'ABCD0', 'ABCDI', 'ABCD1', 'ABCD', 'ABCDEF', 'abcde', '']) {
      expect(parseClientMessage(frame({ type: 'joinRoom', code }))).toBeNull();
    }
    expect(parseClientMessage(frame({ type: 'joinRoom', code: 'ABCDE', reconnectToken: 'short' }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'joinRoom', code: 'ABCDE', reconnectToken: 'G'.repeat(32) }))).toBeNull();
  });

  it('rejects angle 0.5, angle -3.1116, power 101 and NaN', () => {
    const aim = (angle: unknown, power: unknown): string => frame({ type: 'command', cmd: { type: 'setAim', playerId: 0, angle, power } });
    expect(parseClientMessage(aim(0.5, 50))).toBeNull();
    expect(parseClientMessage(aim(-3.1116, 50))).toBeNull();
    expect(parseClientMessage(aim(-1, 101))).toBeNull();
    expect(parseClientMessage(aim(-1, 9.9))).toBeNull();
    expect(parseClientMessage(aim(Number.NaN, 50))).toBeNull();
    expect(parseClientMessage(aim('-1', 50))).toBeNull();
    expect(parseClientMessage(aim(-1, null))).toBeNull();
    expect(parseClientMessage(aim(-3.11, 10))).not.toBeNull();
    expect(parseClientMessage(aim(-0.03, 100))).not.toBeNull();
    expect(parseClientMessage(frame({ type: 'command', cmd: { type: 'shoot', playerId: 2 } }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'command', cmd: 'shoot' }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'ping', t: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('rejects duplicate levelIds, 17 level ids, empty lists and bad id shapes', () => {
    expect(parseClientMessage(frame({ type: 'start', levelIds: ['a', 'a'] }))).toBeNull();
    const many = Array.from({ length: MAX_CAMPAIGN_LENGTH + 1 }, (_, i) => `level-${i}`);
    expect(parseClientMessage(frame({ type: 'start', levelIds: many }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'start', levelIds: many.slice(0, MAX_CAMPAIGN_LENGTH) }))).not.toBeNull();
    expect(parseClientMessage(frame({ type: 'start', levelIds: [] }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'start', levelIds: ['Upper-Case'] }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'start', levelIds: 'w1-01' }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'setLevel', levelId: 'x'.repeat(41) }))).toBeNull();
  });

  it('rejects a non-integer, non-finite or missing protocol in hello and overlong names', () => {
    expect(parseClientMessage(frame({ type: 'hello', protocol: 3.5 }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'hello', protocol: '3' }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'hello' }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'hello', protocol: 3, name: 'x'.repeat(LIMITS.maxNameLength + 1) }))).toBeNull();
    expect(parseClientMessage(frame({ type: 'hello', protocol: 3, name: 7 }))).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('accepts known types and rejects unknown ones / non-JSON', () => {
    expect(parseServerMessage(frame({ type: 'welcome', protocol: 3, serverTime: 1 }))).toEqual({ type: 'welcome', protocol: 3, serverTime: 1 });
    expect(parseServerMessage(frame({ type: 'nope' }))).toBeNull();
    expect(parseServerMessage(frame({ kind: 'welcome' }))).toBeNull();
    expect(parseServerMessage('{')).toBeNull();
  });

  it('rejects a snapshot (or sync) whose snap[0] !== SNAPSHOT_VERSION', () => {
    const snap = [SNAPSHOT_VERSION + 1, 0, 0, 0, 0, 0, [], [], 0, 0, []];
    expect(parseServerMessage(frame({ type: 'snapshot', tick: 0, serverTime: 0, snap, events: [], immediate: false }))).toBeNull();
    expect(parseServerMessage(frame({ type: 'start', sync: { config: {}, tick: 0, snap, serverTime: 0 } }))).toBeNull();
    expect(parseServerMessage(frame({ type: 'joined', code: 'ABCDE', playerId: 1, sync: { snap } }))).toBeNull();
    expect(parseServerMessage(frame({ type: 'snapshot', tick: 0, serverTime: 0, snap: 'nope', events: [], immediate: false }))).toBeNull();
    const ok = [SNAPSHOT_VERSION, 0, 0, 0, 0, 0, [], [], 0, 0, []];
    expect(parseServerMessage(frame({ type: 'snapshot', tick: 0, serverTime: 0, snap: ok, events: [], immediate: false }))).not.toBeNull();
    expect(parseServerMessage(frame({ type: 'joined', code: 'ABCDE', playerId: 1 }))).not.toBeNull();
  });
});
