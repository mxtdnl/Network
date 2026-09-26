// Multiplexity (spec §6, plan §3.5): which layers tie each pair, Jaccard
// overlap between layers, and the formal–informal classification.
// Pairs are ordered (i, j) in the directed view and unordered dyads in the
// symmetrised view. A signed layer contributes its two sub-layers separately.

import {
  FI_CLASS,
  type FormalInformalCounts,
  type LayerKey,
  type LayerRef,
  type MultiplexResult,
} from '../types';

export interface MultiplexLayer {
  ref: LayerRef;
  /** View weights, NaN = not rated. */
  weights: Float64Array;
}

export function multiplex(
  layers: readonly MultiplexLayer[],
  n: number,
  directed: boolean,
  formalInformal: { formal: LayerKey; informal: LayerKey; f: Float64Array; g: Float64Array } | null,
): MultiplexResult {
  const r = layers.length;
  const pairCounts = new Uint8Array(n * n);
  const sizes = new Array<number>(r).fill(0);
  const inter = new Float64Array(r * r);
  const overlapDistribution = new Array<number>(r + 1).fill(0);
  const tied = new Uint8Array(r);
  for (let i = 0; i < n; i++) {
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j) continue;
      const k = i * n + j;
      let count = 0;
      for (let a = 0; a < r; a++) {
        const t = ((layers[a] as MultiplexLayer).weights[k] as number) > 0 ? 1 : 0;
        tied[a] = t;
        count += t;
        if (t) sizes[a] = (sizes[a] as number) + 1;
      }
      for (let a = 0; a < r; a++) {
        if (!tied[a]) continue;
        for (let b = 0; b < r; b++)
          if (tied[b]) inter[a * r + b] = (inter[a * r + b] as number) + 1;
      }
      overlapDistribution[count] = (overlapDistribution[count] as number) + 1;
      pairCounts[k] = count;
      if (!directed) pairCounts[j * n + i] = count;
    }
  }
  const jaccard = new Float64Array(r * r);
  for (let a = 0; a < r; a++) {
    for (let b = 0; b < r; b++) {
      const both = inter[a * r + b] as number;
      const union = (sizes[a] as number) + (sizes[b] as number) - both;
      jaccard[a * r + b] = union > 0 ? both / union : NaN;
    }
  }

  let fi: MultiplexResult['formalInformal'] = null;
  if (formalInformal) {
    const { f, g } = formalInformal;
    const classes = new Uint8Array(n * n);
    const counts: FormalInformalCounts = {
      formalOnly: 0,
      informalOnly: 0,
      both: 0,
      neither: 0,
      notClassified: 0,
    };
    for (let i = 0; i < n; i++) {
      for (let j = directed ? 0 : i + 1; j < n; j++) {
        if (i === j) continue;
        const k = i * n + j;
        const a = f[k] as number;
        const b = g[k] as number;
        let c: number;
        if (Number.isNaN(a) || Number.isNaN(b)) {
          c = FI_CLASS.notClassified;
          counts.notClassified += 1;
        } else if (a > 0 && b > 0) {
          c = FI_CLASS.both;
          counts.both += 1;
        } else if (a > 0) {
          c = FI_CLASS.formalOnly;
          counts.formalOnly += 1;
        } else if (b > 0) {
          c = FI_CLASS.informalOnly;
          counts.informalOnly += 1;
        } else {
          c = FI_CLASS.neither;
          counts.neither += 1;
        }
        classes[k] = c;
        if (!directed) classes[j * n + i] = c;
      }
    }
    fi = { formal: formalInformal.formal, informal: formalInformal.informal, counts, classes };
  }

  return {
    refs: layers.map((l) => l.ref),
    jaccard,
    overlapDistribution,
    pairCounts,
    formalInformal: fi,
  };
}
