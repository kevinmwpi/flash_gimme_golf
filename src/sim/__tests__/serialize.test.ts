// OWNER: sim
// ARCH.md §4 serialize row.
import { describe, expect, it, vi } from 'vitest';
import { isSettled } from '../physics';
import {
  SerializeError,
  buildShareUrl,
  decodeConfig,
  decodeShareLink,
  decodeSnapshot,
  encodeConfig,
  encodeShareLink,
  encodeSnapshot,
  fromBase64Url,
  isSimSnapshot,
  toBase64Url,
} from '../serialize';
import { createSim, stepSim } from '../sim';
import type { PlayerCommand, SimSnapshot, SimState } from '../types';
import {
  AIM_ANGLE_MIN,
  BALL_FLAG_ASLEEP,
  BALL_FLAG_SUNK,
  CEILING_Y,
  KILL_MARGIN,
  MAX_BALL_SPEED,
  MIN_POWER,
  SNAPSHOT_VERSION,
  VIEWPORT_H,
} from '../types';
import { FIXTURE_CAMPAIGN, FIXTURE_LOG, FIXTURE_LOG_TICKS, fixtureConfig } from './fixtures';

vi.mock('../levels/index', async () => (await import('./fixtures')).fixtureRegistry);

const CONFIG = fixtureConfig(FIXTURE_CAMPAIGN, 'local', 42);

/** Every state of the fixture replay (the sim's own progression, not a decoded copy). */
function replayStates(): SimState[] {
  const states: SimState[] = [];
  let state = createSim(CONFIG).state;
  states.push(state);
  for (let t = 0; t < FIXTURE_LOG_TICKS; t += 1) {
    const cmds: PlayerCommand[] = FIXTURE_LOG.filter((e) => e.tick === t).map((e) => e.cmd);
    state = stepSim(state, cmds).state;
    states.push(state);
  }
  return states;
}

const STATES = replayStates();
const SETTLED = STATES.filter((s) => s.balls.every(isSettled));
const MID_FLIGHT = STATES.filter((s) => s.phase === 'flying' && !s.balls.every(isSettled));

const withSnap = (edit: (snap: unknown[]) => void): unknown => {
  const snap: unknown[] = [...(encodeSnapshot(STATES[0] as SimState) as unknown[])];
  edit(snap);
  return snap;
};

describe('serialize', () => {
  it('the fixture replay has settled and mid-flight states to test with', () => {
    expect(SETTLED.length).toBeGreaterThan(100);
    expect(MID_FLIGHT.length).toBeGreaterThan(100);
  });

  it('encodeSnapshot(decodeSnapshot(encodeSnapshot(s), cfg)) deep-equals encodeSnapshot(s) (idempotence)', () => {
    for (const s of STATES.filter((_, i) => i % 7 === 0)) {
      const once = encodeSnapshot(s);
      expect(encodeSnapshot(decodeSnapshot(once, CONFIG))).toEqual(once);
      expect(isSimSnapshot(once)).toBe(true);
    }
  });

  it('decodeSnapshot(encodeSnapshot(s)) deep-equals s for every settled state of the fixture replay', () => {
    for (const s of SETTLED) expect(decodeSnapshot(encodeSnapshot(s), CONFIG)).toEqual(s);
    // a mid-flight state loses only the sub-2dp velocity/position digits
    const flying = MID_FLIGHT[40] as SimState;
    const back = decodeSnapshot(encodeSnapshot(flying), CONFIG);
    expect(back.phase).toBe(flying.phase);
    expect(back.balls[0].pos.x).toBeCloseTo(flying.balls[0].pos.x, 2);
  });

  it('round trip holds for a state with the aim clamped to AIM_ANGLE_MIN', () => {
    const aiming = stepSim(createSim(CONFIG).state, [{ type: 'continue', playerId: 0 }]).state;
    const clamped = stepSim(aiming, [{ type: 'setAim', playerId: 0, angle: -7, power: -3 }]).state;
    expect(clamped.players[0].aim).toEqual({ angle: AIM_ANGLE_MIN, power: MIN_POWER });
    expect(decodeSnapshot(encodeSnapshot(clamped), CONFIG)).toEqual(clamped);
    const quantised = stepSim(aiming, [{ type: 'setAim', playerId: 0, angle: -1.23456789, power: 42.42 }]).state;
    expect(quantised.players[0].aim).toEqual({ angle: -1.2346, power: 42.4 });
    expect(decodeSnapshot(encodeSnapshot(quantised), CONFIG)).toEqual(quantised);
  });

  it('snapshot JSON size <= 260 bytes', () => {
    let largest = 0;
    for (const s of STATES) largest = Math.max(largest, JSON.stringify(encodeSnapshot(s)).length);
    expect(largest).toBeLessThanOrEqual(260);
  });

  it('share link <= 600 chars', () => {
    for (const s of SETTLED.filter((_, i) => i % 50 === 0)) {
      const link = encodeShareLink(s);
      expect(link.length).toBeLessThanOrEqual(600);
      expect(link).toMatch(/^[A-Za-z0-9_-]+$/);
      const decoded = decodeShareLink(link);
      expect(decoded.config).toEqual(CONFIG);
      expect(decoded.state).toEqual({ ...s, config: decoded.config });
      expect(buildShareUrl('https://example.test/', s)).toBe(`https://example.test/?state=${link}`);
    }
    expect(decodeConfig(encodeConfig(CONFIG))).toEqual(CONFIG);
    expect(fromBase64Url(toBase64Url('héllo ✓ 🙂'))).toBe('héllo ✓ 🙂');
  });

  it('rejects wrong version, NaN, out-of-range phase, unknown level id, bad switch mask, non-tuple, angle outside [-3.11, -0.03]', () => {
    const bad: Array<[string, unknown]> = [
      ['wrong version', withSnap((s) => (s[0] = 2))],
      ['NaN tick', withSnap((s) => (s[1] = Number.NaN))],
      ['phase 5', withSnap((s) => (s[2] = 5))],
      ['negative phase', withSnap((s) => (s[2] = -1))],
      ['level index past the course', withSnap((s) => (s[3] = 9))],
      ['switch mask too large', withSnap((s) => (s[8] = 1 << 3))],
      ['non-tuple', { tick: 1 }],
      ['short tuple', [SNAPSHOT_VERSION, 0, 0]],
      ['angle too low', withSnap((s) => (s[6] = [[0, -3.1116, 55], [0, -0.7854, 55]]))],
      ['angle too high', withSnap((s) => (s[6] = [[0, -0.7854, 55], [0, 0.5, 55]]))],
      ['power 101', withSnap((s) => (s[6] = [[0, -0.7854, 101], [0, -0.7854, 55]]))],
      ['restTicks 7', withSnap((s) => (s[7] = [[200, 588, 0, 0, 5, 7, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['ball flags 8', withSnap((s) => (s[7] = [[200, 588, 0, 0, 8, 6, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['turnDelay 28', withSnap((s) => (s[5] = 28))],
      ['campaign longer than the course', withSnap((s) => (s[10] = [[1, 1], [1, 1], [1, 1]]))],
      ['rng not uint32', withSnap((s) => (s[9] = 4294967296))],
      ['angle not quantize4-exact', withSnap((s) => (s[6] = [[0, -0.78539816, 55], [0, -0.7854, 55]]))],
      ['power not quantize1-exact', withSnap((s) => (s[6] = [[0, -0.7854, 55.37], [0, -0.7854, 55]]))],
      ['ball x past the level width', withSnap((s) => (s[7] = [[2000, 588, 0, 0, 5, 6, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['ball above the ceiling', withSnap((s) => (s[7] = [[200, CEILING_Y - 1, 0, 0, 0, 0, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['ball below the kill line', withSnap((s) => (s[7] = [[200, VIEWPORT_H + KILL_MARGIN + 1, 0, 0, 0, 0, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['ball faster than MAX_BALL_SPEED', withSnap((s) => (s[7] = [[200, 500, MAX_BALL_SPEED + 1, 0, 0, 0, 200, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['lastRest over the gap (no support => endless respawn)', withSnap((s) => (s[7] = [[580, 588, 0, 0, 5, 6, 580, 588], [260, 588, 0, 0, 5, 6, 260, 588]]))],
      ['lastRest in the sky', withSnap((s) => (s[7] = [[200, 588, 0, 0, 5, 6, 200, 100], [260, 588, 0, 0, 5, 6, 260, 588]]))],
    ];
    for (const [label, snap] of bad) expect(() => decodeSnapshot(snap, CONFIG), label).toThrow(SerializeError);
    // a sunk ball keeps its last lastRest and never respawns, so it is not held to the support rule
    const sunkFlags = BALL_FLAG_ASLEEP | BALL_FLAG_SUNK;
    expect(() => decodeSnapshot(withSnap((s) => (s[7] = [[1400, 610, 0, 0, sunkFlags, 6, 580, 588], [260, 588, 0, 0, 5, 6, 260, 588]])), CONFIG)).not.toThrow();
    expect(() => decodeSnapshot(encodeSnapshot(STATES[0] as SimState), { ...CONFIG, levelIds: ['no-such-level'] })).toThrow(SerializeError);
    expect(() => decodeConfig([2, 1, 42, ['no-such-level']])).toThrow(SerializeError);
    expect(() => decodeConfig([2, 1, 42, [CONFIG.levelIds[0], CONFIG.levelIds[0]]])).toThrow(SerializeError);
    expect(isSimSnapshot(withSnap((s) => (s[0] = 2)))).toBe(false);
  });

  it('a crafted share link whose ball has no support under lastRest is refused instead of looping respawns', () => {
    const honest = STATES[0] as SimState;
    const hostile: SimState = {
      ...honest,
      balls: [honest.balls[0], { ...honest.balls[1], pos: { x: 580, y: 588 }, lastRest: { x: 580, y: 588 } }],
    };
    expect(() => decodeShareLink(encodeShareLink(hostile))).toThrow(SerializeError);
    expect(decodeShareLink(encodeShareLink(honest)).state).toEqual(honest);
  });

  it('a legacy base64 GameState => SerializeError', () => {
    const legacy = { level: { id: 1, name: 'Tutorial Hills' }, balls: [{ x: 1, y: 2 }], tick: 5 };
    const legacyBase64 = Buffer.from(JSON.stringify(legacy), 'utf8').toString('base64');
    expect(() => decodeShareLink(legacyBase64)).toThrow(SerializeError);
    expect(() => decodeShareLink(toBase64Url(JSON.stringify(legacy)))).toThrow(SerializeError);
    expect(() => decodeShareLink(toBase64Url('not json'))).toThrow(SerializeError);
    expect(() => decodeShareLink('***')).toThrow(SerializeError);
    const payload = { v: SNAPSHOT_VERSION, c: encodeConfig(CONFIG), s: [SNAPSHOT_VERSION] as unknown as SimSnapshot };
    expect(() => decodeShareLink(toBase64Url(JSON.stringify(payload)))).toThrow(SerializeError);
  });
});
