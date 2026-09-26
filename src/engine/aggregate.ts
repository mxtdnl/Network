// Tie aggregation (spec §6, plan §3.1): per-layer rescaling to 0–1, the signed
// split, directed or symmetrised views, and reciprocity.
//
// Every layer is rescaled before any metric (CLAUDE.md D3):
//   unsigned  r = (v − min) / (max − min)                      in 0..1
//   signed    s = v / max for v ≥ 0, v / |min| for v < 0        in −1..1
//             w⁺ = max(s, 0), w⁻ = max(−s, 0)
// A tie exists where the weight is > 0. NaN (not rated) is never a tie and is
// never turned into 0 here: "rated 0" and "not rated" stay distinct until a
// graph is built (spec §4.2).

import type { EngineLayer, Reciprocity, SymmetriseRule } from './types';

export function rescaleUnsigned(ratings: Float64Array, layer: EngineLayer): Float64Array {
  const out = new Float64Array(ratings.length);
  const span = layer.max - layer.min;
  for (let k = 0; k < ratings.length; k++) {
    const v = ratings[k] as number;
    out[k] = Number.isNaN(v) ? NaN : (v - layer.min) / span;
  }
  return out;
}

/** Signed ratings on −1..1: v / max above zero, v / |min| below. */
export function scaleSigned(ratings: Float64Array, layer: EngineLayer): Float64Array {
  const out = new Float64Array(ratings.length);
  const neg = -layer.min;
  for (let k = 0; k < ratings.length; k++) {
    const v = ratings[k] as number;
    out[k] = Number.isNaN(v) ? NaN : v >= 0 ? v / layer.max : v / neg;
  }
  return out;
}

/** Positive (sign 1) or negative (sign −1) part of a −1..1 matrix; NaN stays NaN. */
export function signedPart(s: Float64Array, sign: 1 | -1): Float64Array {
  const out = new Float64Array(s.length);
  for (let k = 0; k < s.length; k++) {
    const x = s[k] as number;
    out[k] = Number.isNaN(x) ? NaN : Math.max(sign * x, 0);
  }
  return out;
}

/** Combines the two directions of a dyad. When one is missing the other is used (plan Q3). */
export function combine(a: number, b: number, rule: SymmetriseRule): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (rule === 'mean') return (a + b) / 2;
  if (rule === 'min') return Math.min(a, b);
  return Math.max(a, b);
}

export function symmetrise(m: Float64Array, n: number, rule: SymmetriseRule): Float64Array {
  const out = new Float64Array(n * n).fill(NaN);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = combine(m[i * n + j] as number, m[j * n + i] as number, rule);
      out[i * n + j] = v;
      out[j * n + i] = v;
    }
  }
  return out;
}

/** Reciprocity of the directed tie set (weight > 0), reported in both views. */
export function reciprocity(directed: Float64Array, n: number): Reciprocity {
  let ties = 0;
  let mutual = 0;
  let asym = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = (directed[i * n + j] as number) > 0;
      const b = (directed[j * n + i] as number) > 0;
      if (a && b) {
        mutual += 1;
        ties += 2;
      } else if (a || b) {
        asym += 1;
        ties += 1;
      }
    }
  }
  return {
    overall: ties > 0 ? (2 * mutual) / ties : NaN,
    dyad: mutual + asym > 0 ? mutual / (mutual + asym) : NaN,
    mutualDyads: mutual,
    asymmetricDyads: asym,
  };
}
