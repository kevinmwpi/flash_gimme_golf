// OWNER: sim
/**
 * mulberry32, functional form: `SimState.rng` is a plain uint32, so every call returns the next
 * state instead of mutating. Body copied verbatim from the previous build (ARCH.md §1.2).
 */

/** Normalises any number to a uint32 seed. */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** One mulberry32 draw. Returns [nextState, value in [0, 1)]. */
export function rngNext(state: number): [next: number, value: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next >>> 0, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Integer draw in [0, maxExclusive). */
export function rngInt(state: number, maxExclusive: number): [next: number, value: number] {
  const [next, value] = rngNext(state);
  return [next, Math.floor(value * maxExclusive)];
}
