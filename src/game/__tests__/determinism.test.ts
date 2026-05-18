import { describe, expect, it } from 'vitest';
import { createGameState } from '../engine';
import { burst, stepBall } from '../physics';
import { createRng, rngNext } from '../rng';
import { deserializeState, serializeState } from '../state';
import type { Ball, Particle } from '../types';

describe('determinism', () => {
  it('rng produces identical sequences from the same seed', () => {
    const a = createRng(0xdeadbeef);
    const b = createRng(0xdeadbeef);
    for (let i = 0; i < 1000; i += 1) {
      expect(rngNext(a)).toBe(rngNext(b));
    }
  });

  it('rng diverges from different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    let diverged = false;
    for (let i = 0; i < 100; i += 1) {
      if (rngNext(a) !== rngNext(b)) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it('burst with a seeded rng produces bit-identical particles', () => {
    const rngA = createRng(42);
    const rngB = createRng(42);
    const particlesA: Particle[] = [];
    const particlesB: Particle[] = [];
    burst(rngA, particlesA, { x: 100, y: 200 }, '#ffffff', 50);
    burst(rngB, particlesB, { x: 100, y: 200 }, '#ffffff', 50);
    expect(JSON.stringify(particlesA)).toBe(JSON.stringify(particlesB));
    expect(rngA.state).toBe(rngB.state);
  });

  it('stepping a ball at fixed dt is reproducible from the same seed', () => {
    const stateA = createGameState(2, 0, 7777);
    const stateB = createGameState(2, 0, 7777);
    const ballA: Ball = JSON.parse(JSON.stringify(stateA.balls[0]));
    const ballB: Ball = JSON.parse(JSON.stringify(stateB.balls[0]));
    ballA.vel = { x: 400, y: -500 };
    ballB.vel = { x: 400, y: -500 };
    const partsA: Particle[] = [];
    const partsB: Particle[] = [];
    for (let i = 0; i < 240; i += 1) {
      stepBall(ballA, stateA.level, 1 / 60, partsA, stateA.rng);
      stepBall(ballB, stateB.level, 1 / 60, partsB, stateB.rng);
    }
    expect(JSON.stringify(ballA)).toBe(JSON.stringify(ballB));
    expect(JSON.stringify(partsA)).toBe(JSON.stringify(partsB));
    expect(stateA.rng.state).toBe(stateB.rng.state);
  });

  it('game state round-trips through serialize/deserialize byte-for-byte', () => {
    const original = createGameState(3, 1, 12345);
    original.angle = -1.234;
    original.power = 73.5;
    original.balls[0].vel = { x: 12.5, y: -42.25 };
    rngNext(original.rng);
    rngNext(original.rng);

    const encoded = serializeState(original);
    const restored = deserializeState(encoded);
    expect(serializeState(restored)).toBe(encoded);
  });
});
