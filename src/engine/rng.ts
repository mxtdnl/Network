// Seeded pseudo-random number generator shared by the demo generator, Louvain
// and the bootstrap (plan §4), so the same seed always gives the same result.
// Mulberry32: 32-bit state, period 2^32, adequate for simulation, not for security.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
