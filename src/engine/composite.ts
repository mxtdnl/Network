// Composite weighting (spec §7, plan §3.9). The formula object returned here is
// the same structure that computes the composite, so what is displayed cannot
// drift from what is evaluated.
//
// For each directed pair (i, j):
//   C_ij = Σ_l ω_l · r_l(v_ijl) / Σ_l ω_l, over the summed layers l rated for (i, j)
//   ω_l  = W_l / Σ_k W_k over all summed layers (weights shown sum to 1)
// Summed layers are unsigned layers and signed layers under "positive" (r = w⁺).
// A pair rated on none of them is missing (plan Q2). Then, in order:
//   filterNegative  C_ij = 0 where the signed rating is < 0
//   multiplier      C_ij ← C_ij · (1 + α·s_ij), α = 0.5, s on −1..1 (plan Q5);
//                   a missing signed rating leaves C_ij unchanged
//   cap             C_ij ← min(C_ij, 1)
// A layer with weight 0 is left out entirely, including its signed treatment.
// scripts/generate_fixtures.py mirrors this arithmetic operation for operation.

import { rescaleUnsigned, scaleSigned } from './aggregate';
import type {
  CompositeFormula,
  EngineLayer,
  EngineSettings,
  LayerKey,
  SignedTreatment,
} from './types';

export const MULTIPLIER_ALPHA = 0.5;
export const COMPOSITE_CAP = 1;

export function layerWeight(layer: EngineLayer, settings: EngineSettings): number {
  const w = settings.weights[layer.key];
  return w === undefined || !Number.isFinite(w) ? layer.defaultWeight : Math.max(w, 0);
}

export function layerTreatment(layer: EngineLayer, settings: EngineSettings): SignedTreatment {
  return settings.signedTreatment[layer.key] ?? 'positive';
}

function formatWeight(w: number): string {
  return String(Math.round(w * 100) / 100);
}

/** Builds the formula; null when no layer is summed (the composite is then undefined). */
export function compositeFormula(
  layers: readonly EngineLayer[],
  settings: EngineSettings,
): CompositeFormula | null {
  const summed: EngineLayer[] = [];
  const filters: EngineLayer[] = [];
  const multipliers: EngineLayer[] = [];
  const excluded: LayerKey[] = [];
  for (const l of layers) {
    if (layerWeight(l, settings) <= 0) {
      excluded.push(l.key);
      continue;
    }
    const t = l.signed ? layerTreatment(l, settings) : 'positive';
    if (t === 'positive') summed.push(l);
    else if (t === 'filterNegative') filters.push(l);
    else multipliers.push(l);
  }
  if (summed.length === 0) return null;
  let total = 0;
  for (const l of summed) total += layerWeight(l, settings);

  const terms = summed.map((l) => ({
    layer: l.key,
    label: l.label,
    rawWeight: layerWeight(l, settings),
    weight: layerWeight(l, settings) / total,
    transform: l.signed ? ('positivePart' as const) : ('rescale' as const),
  }));
  const sum = terms
    .map((t) => `${formatWeight(t.weight)}·${t.transform === 'rescale' ? 'r' : 'r⁺'}(${t.label})`)
    .join(' + ');
  let notation = `C = ${multipliers.length > 0 && terms.length > 1 ? `(${sum})` : sum}`;
  for (const m of multipliers) {
    notation = `${notation} × (1 + ${String(MULTIPLIER_ALPHA)}·s(${m.label}))`;
  }
  for (const f of filters) notation = `${notation}; C = 0 where ${f.label} < 0`;
  notation = `${notation}; C ≤ ${String(COMPOSITE_CAP)}`;

  return {
    terms,
    filters: filters.map((l) => ({ layer: l.key, label: l.label })),
    multipliers: multipliers.map((l) => ({
      layer: l.key,
      label: l.label,
      alpha: MULTIPLIER_ALPHA,
    })),
    excluded,
    missingRule: 'renormalise',
    cap: COMPOSITE_CAP,
    notation,
  };
}

/** Directed composite weights (NaN = missing) for the given formula. */
export function compositeMatrix(
  formula: CompositeFormula,
  layers: readonly EngineLayer[],
  ratings: readonly Float64Array[],
  n: number,
): Float64Array {
  const byKey = new Map<LayerKey, { layer: EngineLayer; ratings: Float64Array }>();
  layers.forEach((layer, k) => {
    byKey.set(layer.key, { layer, ratings: ratings[k] as Float64Array });
  });
  const scaled = (key: LayerKey): Float64Array => {
    const entry = byKey.get(key);
    if (!entry) throw new Error(`composite: unknown layer ${key}`);
    return entry.layer.signed
      ? scaleSigned(entry.ratings, entry.layer)
      : rescaleUnsigned(entry.ratings, entry.layer);
  };
  const terms = formula.terms.map((t) => ({
    x: scaled(t.layer),
    omega: t.weight,
    positive: t.transform === 'positivePart',
  }));
  const filters = formula.filters.map((f) => scaled(f.layer));
  const multipliers = formula.multipliers.map((m) => ({ x: scaled(m.layer), alpha: m.alpha }));

  const out = new Float64Array(n * n).fill(NaN);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const k = i * n + j;
      let num = 0;
      let den = 0;
      for (const t of terms) {
        const x = t.x[k] as number;
        if (Number.isNaN(x)) continue;
        const r = t.positive ? Math.max(x, 0) : x;
        num += t.omega * r;
        den += t.omega;
      }
      if (den === 0) continue;
      let c = num / den;
      for (const f of filters) {
        const x = f[k] as number;
        if (!Number.isNaN(x) && x < 0) c = 0;
      }
      for (const m of multipliers) {
        const x = m.x[k] as number;
        if (!Number.isNaN(x)) c = c * (1 + m.alpha * x);
      }
      if (c > formula.cap) c = formula.cap;
      out[k] = c;
    }
  }
  return out;
}
