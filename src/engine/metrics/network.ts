// Network metrics (spec §6, plan §3.3).

import louvain from 'graphology-communities-louvain';
import { connectedComponents, stronglyConnectedComponents } from 'graphology-components';
import { density as graphDensity } from 'graphology-metrics/graph/density';
import modularity from 'graphology-metrics/graph/modularity';
import { toGraphology, type DenseGraph } from '../graphs';
import { mulberry32 } from '../rng';
import type {
  AttributeColumn,
  Centralisation,
  CommunityResult,
  Components,
  GroupMixing,
  NodeMetricTable,
} from '../types';

export const LOUVAIN_RESOLUTION = 1;

export function density(g: DenseGraph): number {
  return graphDensity(toGraphology(g));
}

export function averageClustering(values: Float64Array): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

const bySizeDesc = (a: number, b: number) => b - a;

export function components(g: DenseGraph): Components {
  const graph = toGraphology(g);
  if (g.directed) {
    // Weak components: the same ties read without direction.
    const undirected = toGraphology({ ...g, directed: false, w: symmetricSupport(g) });
    return {
      weak: connectedComponents(undirected)
        .map((c) => c.length)
        .sort(bySizeDesc),
      strong: stronglyConnectedComponents(graph)
        .map((c) => c.length)
        .sort(bySizeDesc),
    };
  }
  return {
    connected: connectedComponents(graph)
      .map((c) => c.length)
      .sort(bySizeDesc),
  };
}

/** 1 where a tie exists in either direction. */
export function symmetricSupport(g: DenseGraph): Float64Array {
  const { n, w } = g;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((w[i * n + j] as number) > 0 || (w[j * n + i] as number) > 0) out[i * n + j] = 1;
    }
  }
  return out;
}

/**
 * Freeman centralisation, Σ_i (c_max − c_i) / (star-graph maximum), for binary
 * degree and binary betweenness only (plan Q10).
 *   undirected degree       ÷ (n − 1)(n − 2)
 *   directed in/out degree  ÷ (n − 1)²
 *   normalised betweenness  ÷ (n − 1)
 */
export function centralisation(
  n: number,
  directed: boolean,
  node: NodeMetricTable,
): Centralisation {
  const spread = (xs: Float64Array | undefined, denom: number) => {
    if (!xs || !(denom > 0)) return NaN;
    let max = -Infinity;
    for (const x of xs) if (x > max) max = x;
    let s = 0;
    for (const x of xs) s += max - x;
    return s / denom;
  };
  const out: Centralisation = {};
  if (directed) {
    out.inDegree = n >= 2 ? spread(node.columns.inDegree, (n - 1) ** 2) : NaN;
    out.outDegree = n >= 2 ? spread(node.columns.outDegree, (n - 1) ** 2) : NaN;
  } else {
    out.degree = n >= 3 ? spread(node.columns.degree, (n - 1) * (n - 2)) : NaN;
  }
  if (node.columns.betweennessBinary) {
    out.betweenness = n >= 3 ? spread(node.columns.betweennessBinary, n - 1) : NaN;
  }
  return out;
}

/** Groups present, in category order then order of first appearance. */
export function groupOrder(column: AttributeColumn): string[] {
  const present = new Set<string>();
  for (const v of column.values) if (v !== null) present.add(v);
  const order: string[] = [];
  for (const c of column.categories) if (present.has(c) && !order.includes(c)) order.push(c);
  for (const v of column.values) if (v !== null && !order.includes(v)) order.push(v);
  return order;
}

/**
 * E-I index (Krackhardt & Stern, 1988) and group × group tie density for one
 * attribute, on binary ties. Members with no value are left out and counted.
 */
export function mixing(g: DenseGraph, column: AttributeColumn): GroupMixing {
  const { n, w } = g;
  const groups = groupOrder(column);
  const index = new Map(groups.map((gName, k) => [gName, k]));
  const k = groups.length;
  const size = new Array<number>(k).fill(0);
  let excluded = 0;
  const gi = column.values.map((v) => {
    if (v === null) {
      excluded += 1;
      return -1;
    }
    const x = index.get(v) as number;
    size[x] = (size[x] as number) + 1;
    return x;
  });
  const e = new Float64Array(k * k);
  const perInt = new Array<number>(k).fill(0);
  const perExt = new Array<number>(k).fill(0);
  let internal = 0;
  let external = 0;
  for (let i = 0; i < n; i++) {
    for (let j = g.directed ? 0 : i + 1; j < n; j++) {
      if (i === j || !((w[i * n + j] as number) > 0)) continue;
      const a = gi[i] as number;
      const b = gi[j] as number;
      if (a < 0 || b < 0) continue;
      e[a * k + b] = (e[a * k + b] as number) + 1;
      if (!g.directed && a !== b) e[b * k + a] = (e[b * k + a] as number) + 1;
      if (a === b) {
        internal += 1;
        perInt[a] = (perInt[a] as number) + 1;
      } else {
        external += 1;
        perExt[a] = (perExt[a] as number) + 1;
        perExt[b] = (perExt[b] as number) + 1;
      }
    }
  }
  const densityMatrix = new Float64Array(k * k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      const sa = size[a] as number;
      const sb = size[b] as number;
      let pairs = a === b ? sa * (sa - 1) : sa * sb;
      if (a === b && !g.directed) pairs /= 2;
      densityMatrix[a * k + b] = pairs > 0 ? (e[a * k + b] as number) / pairs : NaN;
    }
  }
  const ei = (x: number, y: number) => (x + y > 0 ? (x - y) / (x + y) : NaN);
  return {
    groups,
    excluded,
    internal,
    external,
    ei: ei(external, internal),
    perGroup: groups.map((group, x) => ({
      group,
      size: size[x] as number,
      internal: perInt[x] as number,
      external: perExt[x] as number,
      ei: ei(perExt[x] as number, perInt[x] as number),
    })),
    density: densityMatrix,
  };
}

/**
 * Louvain communities on an undirected graph (graphology-communities-louvain,
 * seeded), with the modularity of the partition found (graphology-metrics).
 * Null when the graph has no ties.
 */
export function communities(g: DenseGraph, seed: number): CommunityResult | null {
  if (g.directed) throw new Error('communities: expects the symmetrised graph');
  const graph = toGraphology(g);
  if (graph.size === 0) return null;
  const found = louvain(graph, {
    getEdgeWeight: 'weight',
    resolution: LOUVAIN_RESOLUTION,
    rng: mulberry32(seed),
  });
  // Renumber communities by their lowest member index so labels are stable.
  const relabel = new Map<number, number>();
  const membership = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const c = found[String(i)] as number;
    if (!relabel.has(c)) relabel.set(c, relabel.size);
    membership[i] = relabel.get(c) as number;
  }
  return {
    membership,
    count: relabel.size,
    modularity: partitionModularity(g, membership),
    resolution: LOUVAIN_RESOLUTION,
    seed,
  };
}

/** Modularity of a fixed partition (graphology-metrics), undirected or directed. */
export function partitionModularity(g: DenseGraph, membership: ArrayLike<number>): number {
  const graph = toGraphology(g);
  if (graph.size === 0) return NaN;
  return modularity(graph, {
    getNodeCommunity: (node: string) => membership[Number(node)] as number,
    getEdgeWeight: 'weight',
    resolution: LOUVAIN_RESOLUTION,
  });
}
