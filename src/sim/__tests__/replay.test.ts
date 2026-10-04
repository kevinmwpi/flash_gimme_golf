// OWNER: sim
// ARCH.md §4 replay rows + the mulberry32 determinism tests ported from the old build (real).
import { describe, expect, it, vi } from 'vitest';
import { rngInt, rngNext, seedRng } from '../rng';
import { encodeSnapshot } from '../serialize';
import { runReplay, stepSim } from '../sim';
import type { PlayerCommand, ReplayEntry, SimState } from '../types';
import { FIXTURE_CAMPAIGN, FIXTURE_LOG, FIXTURE_LOG_TICKS, fixtureConfig } from './fixtures';

vi.mock('../levels/index', async () => (await import('./fixtures')).fixtureRegistry);

describe('rng (mulberry32, functional)', () => {
  it('produces identical sequences from the same seed', () => {
    let a = seedRng(0xdeadbeef);
    let b = seedRng(0xdeadbeef);
    for (let i = 0; i < 1000; i += 1) {
      const [na, va] = rngNext(a);
      const [nb, vb] = rngNext(b);
      expect(va).toBe(vb);
      expect(na).toBe(nb);
      a = na;
      b = nb;
    }
  });

  it('diverges from different seeds', () => {
    let a = seedRng(1);
    let b = seedRng(2);
    let diverged = false;
    for (let i = 0; i < 100; i += 1) {
      const [na, va] = rngNext(a);
      const [nb, vb] = rngNext(b);
      if (va !== vb) diverged = true;
      a = na;
      b = nb;
    }
    expect(diverged).toBe(true);
  });

  it('never mutates its input and keeps the state a uint32', () => {
    const seed = seedRng(-1);
    expect(seed).toBe(0xffffffff);
    const [next, value] = rngNext(seed);
    expect(seed).toBe(0xffffffff);
    expect(Number.isInteger(next)).toBe(true);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThanOrEqual(0xffffffff);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it('matches the first draws of the previous build byte for byte', () => {
    // Golden values from the old `createRng(42)` + `rngNext` (same mulberry32 body).
    let state = seedRng(42);
    const draws: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [next, value] = rngNext(state);
      draws.push(value);
      state = next;
    }
    expect(draws).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });

  it('rngInt stays inside [0, maxExclusive)', () => {
    let state = seedRng(7);
    for (let i = 0; i < 500; i += 1) {
      const [next, value] = rngInt(state, 6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      expect(Number.isInteger(value)).toBe(true);
      state = next;
    }
  });
});

const CONFIG = fixtureConfig(FIXTURE_CAMPAIGN, 'local', 42);
const snapshotJson = (state: SimState): string => JSON.stringify(encodeSnapshot(state));

describe('runReplay determinism', () => {
  it('the fixture log is fully accepted and plays four shots', () => {
    const { state, events } = runReplay(CONFIG, FIXTURE_LOG, FIXTURE_LOG_TICKS);
    expect(events.filter((e) => e.type === 'commandRejected')).toEqual([]);
    expect(events.filter((e) => e.type === 'ballHit').map((e) => e.tick)).toEqual([2, 601, 1201, 1651]);
    expect(state.tick).toBe(FIXTURE_LOG_TICKS);
    expect(state.phase).toBe('aiming');
    expect(state.players[0].strokes + state.players[1].strokes).toBeGreaterThanOrEqual(4);
  });

  it('runReplay(cfg, log, 2000) twice on fixtures gives identical JSON.stringify(encodeSnapshot(final))', () => {
    const a = runReplay(CONFIG, FIXTURE_LOG, FIXTURE_LOG_TICKS);
    const b = runReplay(CONFIG, FIXTURE_LOG, FIXTURE_LOG_TICKS);
    expect(snapshotJson(a.state)).toBe(snapshotJson(b.state));
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('the same log split into two runs (runReplay to 1000 then stepSim onward) gives an identical final snapshot', () => {
    const whole = runReplay(CONFIG, FIXTURE_LOG, FIXTURE_LOG_TICKS);
    const half = runReplay(CONFIG, FIXTURE_LOG, 1000);
    let state = half.state;
    const events = [...half.events];
    for (let t = 1000; t < FIXTURE_LOG_TICKS; t += 1) {
      const cmds: PlayerCommand[] = FIXTURE_LOG.filter((e) => e.tick === t).map((e) => e.cmd);
      const r = stepSim(state, cmds);
      state = r.state;
      events.push(...r.events);
    }
    expect(snapshotJson(state)).toBe(snapshotJson(whole.state));
    expect(state).toEqual(whole.state);
    expect(events).toEqual(whole.events);
  });

  it('golden snapshot string for the fixture log (own it: an engine change must be recognisable)', () => {
    const { state } = runReplay(CONFIG, FIXTURE_LOG, FIXTURE_LOG_TICKS);
    // Recorded on Node 20 / V8 with ROLL_DAMP 0.996 + ROLL_FRICTION 60. A differing value means the physics,
    // the fixtures or the engine changed.
    expect(snapshotJson(state)).toBe(
      '[1,2000,1,0,0,0,[[2,-1.2,40],[2,-1.4,60]],[[468.05,587.95,0,0,5,6,468.05,587.95],[949.07,587.95,0,0,5,6,949.07,587.95]],0,42,[]]',
    );
  });

  it('continue at tick 0 then shoot at tick 1 vs shoot at tick 2 produce DIFFERENT states (ticks matter)', () => {
    const shootAt = (tick: number): ReplayEntry[] => [
      { tick: 0, cmd: { type: 'continue', playerId: 0 } },
      { tick, cmd: { type: 'setAim', playerId: 0, angle: -0.7854, power: 60 } },
      { tick, cmd: { type: 'shoot', playerId: 0 } },
    ];
    const early = runReplay(CONFIG, shootAt(1), 60).state;
    const late = runReplay(CONFIG, shootAt(2), 60).state;
    expect(early.tick).toBe(late.tick);
    expect(early.balls[0].pos).not.toEqual(late.balls[0].pos);
    expect(snapshotJson(early)).not.toBe(snapshotJson(late));
    // the same commands inside one tick are applied in array order: continue then shoot both land on tick 1
    const sameTick = runReplay(CONFIG, [{ tick: 1, cmd: { type: 'continue', playerId: 0 } }, ...shootAt(1).slice(1)], 60).state;
    expect(snapshotJson(sameTick)).toBe(snapshotJson(early));
  });
});
