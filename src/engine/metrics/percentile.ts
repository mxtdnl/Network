// Kept apart from bootstrap.ts so modules that only need a quantile (the
// insight rules, whose thresholds the main thread quotes) do not pull the
// metric code and graphology into the workspace bundle.

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
