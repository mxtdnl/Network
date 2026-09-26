// Node metrics (spec §6, plan §3.2). Formulas follow NetworkX 3.6.1 unless
// docs/method-notes.md records a difference.

import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import eigenvectorCentrality from 'graphology-metrics/centrality/eigenvector';
import { connectedComponents, stronglyConnectedComponents } from 'graphology-components';
import {
  graphologyForPaths,
  inducedSubgraph,
  pathGraph,
  toGraphology,
  type DenseGraph,
  type PathGraph,
} from '../graphs';
import { harmonic } from '../paths';
import type { NodeFlag, NodeMetricKey, NodeMetricTable, RefKind } from '../types';

export const EIGENVECTOR_MAX_ITERATIONS = 10000;
export const EIGENVECTOR_TOLERANCE = 1e-12;

// ---------------------------------------------------------------- degree

export function strengthAndDegree(g: DenseGraph) {
  const { n, w } = g;
  const inS = new Float64Array(n);
  const outS = new Float64Array(n);
  const inD = new Float64Array(n);
  const outD = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = w[i * n + j] as number;
      if (x > 0) {
        outS[i] = (outS[i] as number) + x;
        inS[j] = (inS[j] as number) + x;
        outD[i] = (outD[i] as number) + 1;
        inD[j] = (inD[j] as number) + 1;
      }
    }
  }
  return { inS, outS, inD, outD };
}

// ----------------------------------------------------------- betweenness

/** Normalised betweenness; weighted uses distance 1/w, binary counts steps. */
export function betweenness(p: PathGraph, weighted: boolean): Float64Array {
  const graph = graphologyForPaths(p);
  const result = betweennessCentrality(graph, {
    getEdgeWeight: weighted ? 'distance' : null,
    normalized: true,
  });
  const out = new Float64Array(p.n);
  for (let i = 0; i < p.n; i++) out[i] = result[String(i)] ?? NaN;
  return out;
}

// ----------------------------------------------------------- eigenvector

/** Members of the largest (strongly) connected component; ties go to the one holding the lowest index. */
export function largestComponent(g: DenseGraph): number[] {
  const graph = toGraphology(g);
  const comps = g.directed ? stronglyConnectedComponents(graph) : connectedComponents(graph);
  let best: number[] = [];
  let bestMin = Infinity;
  for (const c of comps) {
    const members = c.map(Number).sort((a, b) => a - b);
    const min = members[0] ?? Infinity;
    if (members.length > best.length || (members.length === best.length && min < bestMin)) {
      best = members;
      bestMin = min;
    }
  }
  return best;
}

/**
 * Eigenvector centrality where defined (plan Q8): on the largest strongly
 * connected (directed) or connected (undirected) component, L2-normalised
 * there; members outside it are NaN.
 */
export function eigenvector(g: DenseGraph): {
  values: Float64Array;
  flags: (NodeFlag | null)[];
  reason: 'noComponent' | 'notConverged' | null;
} {
  const values = new Float64Array(g.n).fill(NaN);
  const comp = largestComponent(g);
  if (comp.length < 2) {
    return { values, flags: new Array<NodeFlag>(g.n).fill('noComponent'), reason: 'noComponent' };
  }
  const sub = toGraphology(inducedSubgraph(g, comp));
  let result: Record<string, number>;
  try {
    result = eigenvectorCentrality(sub, {
      getEdgeWeight: 'weight',
      maxIterations: EIGENVECTOR_MAX_ITERATIONS,
      tolerance: EIGENVECTOR_TOLERANCE,
    });
  } catch {
    return {
      values,
      flags: new Array<NodeFlag>(g.n).fill('notConverged'),
      reason: 'notConverged',
    };
  }
  const flags = new Array<NodeFlag | null>(g.n).fill('outsideLargestComponent');
  comp.forEach((member, k) => {
    values[member] = result[String(k)] ?? NaN;
    flags[member] = null;
  });
  return { values, flags, reason: null };
}

// ------------------------------------------------ constraint, effective size

/**
 * Burt's constraint and effective size (nx.constraint, nx.effective_size with
 * weight). Mutual weight M_ij = w_ij + w_ji; p_ij = M_ij / Σ_k M_ik;
 * m_jq = M_jq / max_k M_jk. Members with no ties are NaN ('isolated').
 */
export function structuralHoles(g: DenseGraph) {
  const { n, w } = g;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) M[i * n + j] = (w[i * n + j] as number) + (w[j * n + i] as number);
    }
  }
  const P = new Float64Array(n * n);
  const Mx = new Float64Array(n * n);
  const isolated = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let max = 0;
    for (let j = 0; j < n; j++) {
      const x = M[i * n + j] as number;
      sum += x;
      if (x > max) max = x;
    }
    if (sum === 0) {
      isolated[i] = 1;
      continue;
    }
    for (let j = 0; j < n; j++) {
      P[i * n + j] = (M[i * n + j] as number) / sum;
      Mx[i * n + j] = (M[i * n + j] as number) / max;
    }
  }
  const constraint = new Float64Array(n);
  const effectiveSize = new Float64Array(n);
  const flags: (NodeFlag | null)[] = new Array<NodeFlag | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (isolated[i] === 1) {
      constraint[i] = NaN;
      effectiveSize[i] = NaN;
      flags[i] = 'isolated';
      continue;
    }
    let c = 0;
    let es = 0;
    for (let j = 0; j < n; j++) {
      const pij = P[i * n + j] as number;
      if (!(pij > 0)) continue;
      let indirect = 0;
      let redundancy = 0;
      for (let q = 0; q < n; q++) {
        const piq = P[i * n + q] as number;
        if (piq === 0) continue;
        indirect += piq * (P[q * n + j] as number);
        redundancy += piq * (Mx[j * n + q] as number);
      }
      c += (pij + indirect) ** 2;
      es += 1 - redundancy;
    }
    constraint[i] = c;
    effectiveSize[i] = es;
  }
  return { constraint, effectiveSize, flags };
}

// ------------------------------------------------------------ clustering

/**
 * Weighted local clustering (nx.clustering with weight). Weights are divided by
 * the graph's largest weight, ŵ = w / max(w), and a = ŵ^(1/3).
 * Undirected (Onnela):  C_i = Σ_jk a_ij a_jk a_ki / (k_i (k_i − 1))
 * Directed (Fagiolo):   C_i = [(A + Aᵀ)³]_ii / (2 (d_tot (d_tot − 1) − 2 d_↔))
 * Members with no closed triangle are 0; fewer than two contacts is flagged.
 */
export function clustering(g: DenseGraph): { values: Float64Array; flags: (NodeFlag | null)[] } {
  const { n, w } = g;
  let max = 0;
  for (let k = 0; k < w.length; k++) if ((w[k] as number) > max) max = w[k] as number;
  const a = new Float64Array(n * n);
  if (max > 0) for (let k = 0; k < w.length; k++) a[k] = Math.cbrt((w[k] as number) / max);

  // S = A (undirected) or A + Aᵀ (directed); t_i = [S³]_ii = Σ_j S_ij [S²]_ji.
  let S = a;
  if (g.directed) {
    S = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++)
        S[i * n + j] = (a[i * n + j] as number) + (a[j * n + i] as number);
    }
  }
  const values = new Float64Array(n);
  const flags: (NodeFlag | null)[] = new Array<NodeFlag | null>(n).fill(null);
  const row = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // row = S_i· S  (so row[k] = Σ_j S_ij S_jk), then t = Σ_k row[k] S_ki.
    row.fill(0);
    for (let j = 0; j < n; j++) {
      const sij = S[i * n + j] as number;
      if (sij === 0) continue;
      for (let k = 0; k < n; k++) row[k] = (row[k] as number) + sij * (S[j * n + k] as number);
    }
    let t = 0;
    for (let k = 0; k < n; k++) t += (row[k] as number) * (S[k * n + i] as number);

    let denom: number;
    let contacts: number;
    if (g.directed) {
      let dIn = 0;
      let dOut = 0;
      let dBoth = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = (w[i * n + j] as number) > 0;
        const inn = (w[j * n + i] as number) > 0;
        if (o) dOut += 1;
        if (inn) dIn += 1;
        if (o && inn) dBoth += 1;
      }
      const dt = dIn + dOut;
      denom = 2 * (dt * (dt - 1) - 2 * dBoth);
      contacts = dt - dBoth;
    } else {
      let k = 0;
      for (let j = 0; j < n; j++) if ((w[i * n + j] as number) > 0) k += 1;
      denom = k * (k - 1);
      contacts = k;
    }
    values[i] = t === 0 ? 0 : t / denom;
    if (contacts < 2) flags[i] = 'fewerThanTwoContacts';
  }
  return { values, flags };
}

// ------------------------------------------------------------- the table

/** All node metrics for one layer in one view. */
export function nodeMetrics(
  g: DenseGraph,
  kind: RefKind,
): {
  table: NodeMetricTable;
  eigenvectorReason: 'noComponent' | 'notConverged' | null;
} {
  const columns: NodeMetricTable['columns'] = {};
  const flags: NodeMetricTable['flags'] = {};
  const { inS, outS, inD, outD } = strengthAndDegree(g);
  if (g.directed) {
    columns.inStrength = inS;
    columns.outStrength = outS;
    columns.inDegree = inD;
    columns.outDegree = outD;
  } else {
    columns.strength = outS;
    columns.degree = outD;
  }
  const cl = clustering(g);
  columns.clustering = cl.values;
  flags.clustering = cl.flags;

  if (kind === 'negative') {
    return {
      table: {
        columns,
        flags,
        omitted: {
          metrics: metricKeysFor(g.directed, 'unsigned').filter(
            (m) => !metricKeysFor(g.directed, 'negative').includes(m),
          ),
          reason: 'negativeSubLayer',
        },
      },
      eigenvectorReason: null,
    };
  }

  const p = pathGraph(g);
  columns.betweenness = betweenness(p, true);
  columns.betweennessBinary = betweenness(p, false);
  const h = harmonic(p);
  if (g.directed) {
    columns.harmonicIn = h.incoming;
    columns.harmonicOut = h.outgoing;
  } else {
    columns.harmonic = h.incoming;
  }
  const ev = eigenvector(g);
  columns.eigenvector = ev.values;
  flags.eigenvector = ev.flags;
  const sh = structuralHoles(g);
  columns.constraint = sh.constraint;
  columns.effectiveSize = sh.effectiveSize;
  flags.constraint = sh.flags;
  flags.effectiveSize = sh.flags;
  return { table: { columns, flags, omitted: null }, eigenvectorReason: ev.reason };
}

/** One node metric on its own (used by the bootstrap). */
export function singleNodeMetric(g: DenseGraph, metric: NodeMetricKey): Float64Array {
  switch (metric) {
    case 'inStrength':
      return strengthAndDegree(g).inS;
    case 'outStrength':
    case 'strength':
      return strengthAndDegree(g).outS;
    case 'inDegree':
      return strengthAndDegree(g).inD;
    case 'outDegree':
    case 'degree':
      return strengthAndDegree(g).outD;
    case 'betweenness':
      return betweenness(pathGraph(g), true);
    case 'betweennessBinary':
      return betweenness(pathGraph(g), false);
    case 'harmonicIn':
    case 'harmonic':
      return harmonic(pathGraph(g)).incoming;
    case 'harmonicOut':
      return harmonic(pathGraph(g)).outgoing;
    case 'eigenvector':
      return eigenvector(g).values;
    case 'constraint':
      return structuralHoles(g).constraint;
    case 'effectiveSize':
      return structuralHoles(g).effectiveSize;
    case 'clustering':
      return clustering(g).values;
  }
}

export function metricKeysFor(directed: boolean, kind: RefKind): NodeMetricKey[] {
  const base: NodeMetricKey[] = directed
    ? ['inStrength', 'outStrength', 'inDegree', 'outDegree']
    : ['strength', 'degree'];
  if (kind === 'negative') return [...base, 'clustering'];
  return [
    ...base,
    'betweenness',
    'betweennessBinary',
    ...(directed ? (['harmonicIn', 'harmonicOut'] as const) : (['harmonic'] as const)),
    'eigenvector',
    'constraint',
    'effectiveSize',
    'clustering',
  ];
}
