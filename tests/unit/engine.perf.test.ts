// Performance of the full metric suite (spec §8: 250 members, about 10,000
// ties). A seeded synthetic network with the four core layers; every pair is
// rated, and about 16 % of ordered pairs carry a non-zero rating on each layer
// (≈ 10,000 directed ties per layer). The timing is printed; the assertion is a
// generous ceiling so a slow CI runner does not fail the build, while a
// regression of an order of magnitude does.

import { describe, expect, it } from 'vitest';
import { analyse } from '../../src/engine/analyse';
import { mulberry32 } from '../../src/engine/rng';
import type { AnalysisInput, EngineLayer, ViewKind } from '../../src/engine/types';

export const PERF_SEED = 20260927;
const N = 250;
const TIE_PROBABILITY = 10000 / (N * (N - 1));
const CEILING_MS = 60000;

export function syntheticInput(view: ViewKind): AnalysisInput {
  const rng = mulberry32(PERF_SEED);
  const layers: EngineLayer[] = [
    {
      key: 'connection_strength',
      label: 'Connection strength',
      min: 0,
      max: 5,
      signed: false,
      defaultWeight: 1,
    },
    { key: 'valence', label: 'Valence', min: -3, max: 3, signed: true, defaultWeight: 1 },
    {
      key: 'informal_collaboration',
      label: 'Informal collaboration',
      min: 0,
      max: 5,
      signed: false,
      role: 'informal',
      defaultWeight: 1,
    },
    {
      key: 'formal_collaboration',
      label: 'Formal collaboration',
      min: 0,
      max: 5,
      signed: false,
      role: 'formal',
      defaultWeight: 1,
    },
  ];
  const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const team = Array.from({ length: N }, (_, i) => teams[i % teams.length] as string);
  const ratings = layers.map((l) => {
    const m = new Float64Array(N * N).fill(NaN);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const tied = rng() < TIE_PROBABILITY;
        if (l.signed) {
          m[i * N + j] = tied
            ? rng() < 0.1
              ? -1 - Math.floor(rng() * 3)
              : 1 + Math.floor(rng() * 3)
            : 0;
        } else {
          m[i * N + j] = tied ? 1 + Math.floor(rng() * 5) : 0;
        }
      }
    }
    return m;
  });
  return {
    inputKey: `perf:${view}`,
    memberIds: Array.from({ length: N }, (_, i) => `M${String(i).padStart(3, '0')}`),
    attributes: { team: { categories: teams, values: team } },
    layers,
    ratings,
    settings: { view, symmetrise: 'mean', weights: {}, signedTreatment: {}, seed: 1 },
  };
}

describe('performance', () => {
  for (const view of ['directed', 'symmetrised'] as const) {
    it(
      `runs the full metric suite on 250 members and ~10,000 ties (${view} view)`,
      async () => {
        const input = syntheticInput(view);
        const t0 = performance.now();
        const result = await analyse(input);
        const ms = performance.now() - t0;
        const ties = Object.fromEntries(
          result.refOrder.map((r) => [r, result.refs[r]?.network.ties]),
        );
        console.log(
          `perf ${view}: ${ms.toFixed(0)} ms for ${String(result.refOrder.length)} layers; ties ${JSON.stringify(ties)}`,
        );
        expect(result.refs.connection_strength?.network.ties).toBeGreaterThan(
          view === 'directed' ? 9500 : 8000,
        );
        expect(ms).toBeLessThan(CEILING_MS);
      },
      CEILING_MS * 2,
    );
  }
});
