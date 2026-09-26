// Signed layers (spec §6, plan §3.4). Ratings arrive on the −1..1 scale from
// aggregate.scaleSigned. Positive and negative in-valence are reported side by
// side and never netted into one score (spec §2). Structural balance uses the
// signed graph symmetrised by the chosen rule, so a dyad's sign follows that
// rule when the two directions disagree (plan Q4).

import { symmetrise } from '../aggregate';
import type { LayerKey, SignedResult, SymmetriseRule, TriadCounts } from '../types';

export function inValence(s: Float64Array, n: number) {
  const inPositive = new Float64Array(n);
  const inNegative = new Float64Array(n);
  const inPositiveCount = new Int32Array(n);
  const inNegativeCount = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const x = s[j * n + i] as number;
      if (x > 0) {
        inPositive[i] = (inPositive[i] as number) + x;
        inPositiveCount[i] = (inPositiveCount[i] as number) + 1;
      } else if (x < 0) {
        inNegative[i] = (inNegative[i] as number) - x;
        inNegativeCount[i] = (inNegativeCount[i] as number) + 1;
      }
    }
  }
  return { inPositive, inNegative, inPositiveCount, inNegativeCount };
}

/**
 * Closed triads whose three dyads all carry a sign (non-zero, rated). Balanced:
 * +++ and +−−; unbalanced: ++− and −−−.
 */
export function triads(sym: Float64Array, n: number): TriadCounts {
  const counts = [0, 0, 0, 0];
  const sign = new Int8Array(n * n);
  for (let k = 0; k < sym.length; k++) {
    const x = sym[k] as number;
    sign[k] = x > 0 ? 1 : x < 0 ? -1 : 0;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sij = sign[i * n + j] as number;
      if (sij === 0) continue;
      for (let k = j + 1; k < n; k++) {
        const sjk = sign[j * n + k] as number;
        const sik = sign[i * n + k] as number;
        if (sjk === 0 || sik === 0) continue;
        const negatives = (sij < 0 ? 1 : 0) + (sjk < 0 ? 1 : 0) + (sik < 0 ? 1 : 0);
        counts[negatives] = (counts[negatives] as number) + 1;
      }
    }
  }
  const [ppp, ppn, pnn, nnn] = counts as [number, number, number, number];
  const balanced = ppp + pnn;
  const unbalanced = ppn + nnn;
  return {
    ppp,
    ppn,
    pnn,
    nnn,
    balanced,
    unbalanced,
    balanceRatio: balanced + unbalanced > 0 ? balanced / (balanced + unbalanced) : NaN,
  };
}

export function signedResult(
  layer: LayerKey,
  s: Float64Array,
  n: number,
  rule: SymmetriseRule,
): SignedResult {
  return { layer, ...inValence(s, n), triads: triads(symmetrise(s, n, rule), n) };
}
