// The analysis pipeline (plan §1.4): rescale → directed or symmetrised view →
// composite → graphs → metrics. `prepare` builds every layer's weights once;
// the worker keeps the prepared input so resilience and bootstrap requests
// reuse it.

import { reciprocity, rescaleUnsigned, scaleSigned, signedPart, symmetrise } from './aggregate';
import { compositeFormula, compositeMatrix } from './composite';
import { denseGraph, pathGraph, tieCount, type DenseGraph } from './graphs';
import { bootstrap } from './metrics/bootstrap';
import { multiplex, type MultiplexLayer } from './metrics/multiplex';
import {
  averageClustering,
  centralisation,
  communities,
  components,
  density,
  mixing,
} from './metrics/network';
import { metricKeysFor, nodeMetrics } from './metrics/node';
import { resilience } from './metrics/resilience';
import { shortestPath } from './paths';
import { signedResult } from './metrics/signed';
import { Scheduler, type RunControl } from './schedule';
import {
  COMPOSITE,
  type AnalysisInput,
  type AnalysisResult,
  type BootstrapOptions,
  type BootstrapResult,
  type CompositeFormula,
  type EngineLayer,
  type EngineWarning,
  type LayerKey,
  type LayerRef,
  type MemberId,
  type RefKind,
  type PathResult,
  type RefResult,
  type ResilienceResult,
} from './types';

export interface PreparedRef {
  ref: LayerRef;
  kind: RefKind;
  layer?: LayerKey;
  /** Directed weights before symmetrisation (≥ 0, NaN = not rated). */
  directed: Float64Array;
  /** Weights in the requested view (≥ 0, NaN = not rated). */
  view: Float64Array;
  /** Symmetrised weights (by the chosen rule), used for communities. */
  symmetric: Float64Array;
}

export interface Prepared {
  input: AnalysisInput;
  n: number;
  refs: PreparedRef[];
  /** Signed layers on the −1..1 scale, directed. */
  signedScaled: Map<LayerKey, Float64Array>;
  composite: CompositeFormula | null;
  warnings: EngineWarning[];
}

export function prepare(input: AnalysisInput): Prepared {
  const n = input.memberIds.length;
  const { view, symmetrise: rule } = input.settings;
  const warnings: EngineWarning[] = [];
  const refs: PreparedRef[] = [];
  const signedScaled = new Map<LayerKey, Float64Array>();
  const layers: EngineLayer[] = [];
  const ratings: Float64Array[] = [];

  input.layers.forEach((layer, k) => {
    const r = input.ratings[k];
    if (!r || r.length !== n * n)
      throw new Error(`prepare: ratings for ${layer.key} are not ${String(n)}×${String(n)}`);
    if (!(layer.max > layer.min) || (layer.signed && !(layer.min < 0 && layer.max > 0))) {
      warnings.push({ code: 'invalidScale', layer: layer.key });
      return;
    }
    layers.push(layer);
    ratings.push(r);
  });

  const add = (
    ref: LayerRef,
    kind: RefKind,
    directed: Float64Array,
    sym: Float64Array,
    layer?: LayerKey,
  ) => {
    refs.push({
      ref,
      kind,
      ...(layer === undefined ? {} : { layer }),
      directed,
      view: view === 'directed' ? directed : sym,
      symmetric: sym,
    });
  };

  layers.forEach((layer, k) => {
    const r = ratings[k] as Float64Array;
    if (layer.signed) {
      // Signed layers are symmetrised before the split, so a dyad's sign follows the rule (plan Q4).
      const s = scaleSigned(r, layer);
      signedScaled.set(layer.key, s);
      const sSym = symmetrise(s, n, rule);
      add(`${layer.key}+`, 'positive', signedPart(s, 1), signedPart(sSym, 1), layer.key);
      add(`${layer.key}-`, 'negative', signedPart(s, -1), signedPart(sSym, -1), layer.key);
    } else {
      const w = rescaleUnsigned(r, layer);
      add(layer.key, 'unsigned', w, symmetrise(w, n, rule), layer.key);
    }
  });

  let composite: CompositeFormula | null = null;
  if (layers.length === 0) {
    warnings.push({ code: 'compositeUndefined', reason: 'noLayers' });
  } else {
    composite = compositeFormula(layers, input.settings);
    if (composite) {
      const c = compositeMatrix(composite, layers, ratings, n);
      add(COMPOSITE, 'composite', c, symmetrise(c, n, rule));
    } else {
      warnings.push({ code: 'compositeUndefined', reason: 'noWeightedLayers' });
    }
  }
  return { input, n, refs, signedScaled, composite, warnings };
}

export function viewGraph(p: Prepared, ref: LayerRef): DenseGraph {
  const r = p.refs.find((x) => x.ref === ref);
  if (!r) throw new Error(`Unknown layer ${ref}`);
  return denseGraph(r.view, p.n, p.input.settings.view === 'directed');
}

function refResult(p: Prepared, r: PreparedRef, warnings: EngineWarning[]): RefResult {
  const directed = p.input.settings.view === 'directed';
  const g = denseGraph(r.view, p.n, directed);
  const { table, eigenvectorReason } = nodeMetrics(g, r.kind);
  if (eigenvectorReason)
    warnings.push({ code: 'eigenvectorUndefined', ref: r.ref, reason: eigenvectorReason });
  const clusteringValues = table.columns.clustering ?? new Float64Array(0);
  const mix: RefResult['network']['mixing'] = {};
  for (const [key, column] of Object.entries(p.input.attributes)) mix[key] = mixing(g, column);
  return {
    ref: r.ref,
    kind: r.kind,
    ...(r.layer === undefined ? {} : { layer: r.layer }),
    node: table,
    network: {
      members: p.n,
      ties: tieCount(g),
      density: density(g),
      reciprocity: reciprocity(r.directed, p.n),
      averageClustering: averageClustering(clusteringValues),
      components: components(g),
      centralisation: centralisation(p.n, directed, table),
      mixing: mix,
    },
    communities: communities(denseGraph(r.symmetric, p.n, false), p.input.settings.seed),
    weights: r.view.slice(),
  };
}

export async function analysePrepared(
  p: Prepared,
  control: RunControl = {},
): Promise<AnalysisResult> {
  const s = new Scheduler(control);
  const { input, n } = p;
  const directed = input.settings.view === 'directed';
  const warnings = [...p.warnings];
  const steps = p.refs.length + 2;
  let done = 0;

  const refs: Record<LayerRef, RefResult> = {};
  for (const r of p.refs) {
    s.progress(done / steps, r.ref);
    await s.pause();
    refs[r.ref] = refResult(p, r, warnings);
    done += 1;
  }

  s.progress(done / steps, 'signed');
  await s.pause();
  const signed: AnalysisResult['signed'] = {};
  for (const [key, sc] of p.signedScaled)
    signed[key] = signedResult(key, sc, n, input.settings.symmetrise);
  done += 1;

  s.progress(done / steps, 'multiplex');
  await s.pause();
  const layerRefs = p.refs.filter((r) => r.kind !== 'composite');
  let mx: AnalysisResult['multiplex'] = null;
  if (layerRefs.length > 1) {
    const find = (role: 'formal' | 'informal') =>
      input.layers.find((l) => l.role === role && !l.signed);
    const formal = find('formal');
    const informal = find('informal');
    const fRef = formal && p.refs.find((r) => r.ref === formal.key);
    const gRef = informal && p.refs.find((r) => r.ref === informal.key);
    mx = multiplex(
      layerRefs.map((r): MultiplexLayer => ({ ref: r.ref, weights: r.view })),
      n,
      directed,
      formal && informal && fRef && gRef
        ? { formal: formal.key, informal: informal.key, f: fRef.view, g: gRef.view }
        : null,
    );
  }
  s.progress(1, 'done');

  return {
    inputKey: input.inputKey,
    view: input.settings.view,
    symmetrise: input.settings.symmetrise,
    memberIds: input.memberIds,
    refOrder: p.refs.map((r) => r.ref),
    refs,
    signed,
    multiplex: mx,
    composite: p.composite,
    coverage: input.coverage ?? null,
    warnings,
  };
}

export function analyse(input: AnalysisInput, control: RunControl = {}): Promise<AnalysisResult> {
  return analysePrepared(prepare(input), control);
}

/** Path-based work is refused on negative sub-layers (plan Q11). */
function assertNotNegative(p: Prepared, ref: LayerRef, what: string): void {
  if (p.refs.find((x) => x.ref === ref)?.kind === 'negative') {
    throw new Error(`${what} is not computed on a negative sub-layer`);
  }
}

export function runResilience(
  p: Prepared,
  ref: LayerRef,
  removed: readonly MemberId[],
): ResilienceResult {
  assertNotNegative(p, ref, 'Resilience');
  return resilience(viewGraph(p, ref), ref, p.input.memberIds, removed);
}

export async function runBootstrap(
  p: Prepared,
  opts: BootstrapOptions,
  control: RunControl = {},
): Promise<BootstrapResult> {
  const directed = p.input.settings.view === 'directed';
  if (!metricKeysFor(directed, 'negative').includes(opts.metric)) {
    assertNotNegative(p, opts.ref, opts.metric);
  }
  return bootstrap(viewGraph(p, opts.ref), opts, control);
}

/**
 * Shortest path (distance 1/w) between two members on a layer in the current
 * view; null when there is no path. Refused on negative sub-layers (plan Q11).
 */
export function runPath(
  p: Prepared,
  ref: LayerRef,
  from: MemberId,
  to: MemberId,
): PathResult | null {
  assertNotNegative(p, ref, 'A shortest path');
  const ids = p.input.memberIds;
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`Unknown member ${a < 0 ? from : to}`);
  const found = shortestPath(pathGraph(viewGraph(p, ref)), a, b);
  if (!found) return null;
  return {
    ref,
    members: found.path.map((i) => ids[i] as MemberId),
    distance: found.distance,
    hops: found.path.length - 1,
    shortestPaths: found.count,
  };
}
