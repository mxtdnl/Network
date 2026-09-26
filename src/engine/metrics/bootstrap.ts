// Stability of centrality rankings (spec §6, plan §3.8): a node-dropping
// bootstrap. Each replicate drops a random ⌊p·n⌋ members (seeded), recomputes
// the metric on the induced subgraph, and ranks the retained members. Ranks
// are rescaled to the full network (1..n) so replicates of different sizes are
// comparable, and each member's rank is reported as the 2.5th–97.5th
// percentile interval, not a single rank.

import { inducedSubgraph, type DenseGraph } from '../graphs';
import { mulberry32 } from '../rng';
import { Scheduler, type RunControl } from '../schedule';
import type { BootstrapOptions, BootstrapResult } from '../types';
import { singleNodeMetric } from './node';

/** Ranks, 1 = highest; ties share their average rank; NaN values are unranked. */
export function rankDescending(values: Float64Array): { ranks: Float64Array; defined: number } {
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) idx.push(i);
  idx.sort((a, b) => (values[b] as number) - (values[a] as number) || a - b);
  const ranks = new Float64Array(values.length).fill(NaN);
  let k = 0;
  while (k < idx.length) {
    let end = k;
    const v = values[idx[k] as number] as number;
    while (end + 1 < idx.length && values[idx[end + 1] as number] === v) end += 1;
    const avg = (k + end) / 2 + 1;
    for (let t = k; t <= end; t++) ranks[idx[t] as number] = avg;
    k = end + 1;
  }
  return { ranks, defined: idx.length };
}

/** Linear-interpolation percentile (numpy's default), q in 0..1. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

function toFullScale(rank: number, defined: number, n: number): number {
  return defined > 1 ? 1 + ((rank - 1) * (n - 1)) / (defined - 1) : 1;
}

export async function bootstrap(
  g: DenseGraph,
  opts: BootstrapOptions,
  control: RunControl = {},
): Promise<BootstrapResult> {
  const { n } = g;
  const s = new Scheduler(control);
  const rng = mulberry32(opts.seed);
  const dropped = Math.floor(opts.dropFraction * n);
  const replicates = Math.max(0, Math.floor(opts.replicates));

  const observed = rankDescending(singleNodeMetric(g, opts.metric));
  const observedRank = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = observed.ranks[i] as number;
    observedRank[i] = Number.isNaN(r) ? NaN : toFullScale(r, observed.defined, n);
  }

  const samples: number[][] = Array.from({ length: n }, () => []);
  const order = new Int32Array(n);
  s.progress(0, 'bootstrap');
  for (let b = 0; b < replicates; b++) {
    await s.pause();
    // Partial Fisher–Yates: the first `dropped` entries are removed.
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = 0; i < dropped; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const t = order[i] as number;
      order[i] = order[j] as number;
      order[j] = t;
    }
    const keep = Array.from(order.subarray(dropped)).sort((x, y) => x - y);
    const values = singleNodeMetric(inducedSubgraph(g, keep), opts.metric);
    const { ranks, defined } = rankDescending(values);
    keep.forEach((member, k) => {
      const r = ranks[k] as number;
      if (!Number.isNaN(r)) (samples[member] as number[]).push(toFullScale(r, defined, n));
    });
    s.progress((b + 1) / replicates, 'bootstrap');
  }

  const rankLow = new Float64Array(n);
  const rankHigh = new Float64Array(n);
  const count = new Int32Array(n);
  samples.forEach((xs, i) => {
    xs.sort((a, b) => a - b);
    rankLow[i] = percentile(xs, 0.025);
    rankHigh[i] = percentile(xs, 0.975);
    count[i] = xs.length;
  });
  return {
    ref: opts.ref,
    metric: opts.metric,
    replicates,
    dropped,
    observedRank,
    rankLow,
    rankHigh,
    samples: count,
  };
}
