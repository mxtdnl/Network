// Graphs built from weight matrices. A DenseGraph holds non-negative tie
// weights (0 = no tie); it is the input to every metric.
//
// Path-based algorithms (betweenness, harmonic closeness, resilience, shortest
// paths) take a PathGraph, and the only way to make one is `pathGraph()`, which
// refuses negative, NaN or infinite weights (spec §6: negative weights are
// never passed to path-based algorithms). Distances are 1/w.

import Graph from 'graphology';

export interface DenseGraph {
  n: number;
  directed: boolean;
  /** n × n, w[i*n+j] ≥ 0; 0 = no tie. Symmetric when undirected. */
  w: Float64Array;
}

/** Builds a DenseGraph from view weights (NaN = not rated → no tie). */
export function denseGraph(weights: Float64Array, n: number, directed: boolean): DenseGraph {
  const w = new Float64Array(n * n);
  for (let k = 0; k < w.length; k++) {
    const x = weights[k] as number;
    w[k] = Number.isNaN(x) ? 0 : x;
  }
  for (let i = 0; i < n; i++) w[i * n + i] = 0;
  return { n, directed, w };
}

export function tieCount(g: DenseGraph): number {
  let m = 0;
  const { n, w } = g;
  for (let i = 0; i < n; i++) {
    for (let j = g.directed ? 0 : i + 1; j < n; j++) {
      if (i !== j && (w[i * n + j] as number) > 0) m += 1;
    }
  }
  return m;
}

/** Induced subgraph on `keep` (member indices, in order). */
export function inducedSubgraph(g: DenseGraph, keep: readonly number[]): DenseGraph {
  const m = keep.length;
  const w = new Float64Array(m * m);
  for (let a = 0; a < m; a++) {
    const i = keep[a] as number;
    for (let b = 0; b < m; b++) {
      w[a * m + b] = g.w[i * g.n + (keep[b] as number)] as number;
    }
  }
  return { n: m, directed: g.directed, w };
}

// -------------------------------------------------------------- path guard

export class NegativeWeightError extends Error {
  constructor(i: number, j: number, value: number) {
    super(
      `Path algorithms need non-negative weights; tie ${String(i)}→${String(j)} is ${String(value)}.`,
    );
    this.name = 'NegativeWeightError';
  }
}

/** Counters read by the test that asserts path algorithms never see a negative weight. */
export const pathGuardAudit = { graphs: 0, ties: 0, minWeight: Infinity };

export function resetPathGuardAudit(): void {
  pathGuardAudit.graphs = 0;
  pathGuardAudit.ties = 0;
  pathGuardAudit.minWeight = Infinity;
}

declare const pathGraphBrand: unique symbol;

export interface PathGraph {
  readonly [pathGraphBrand]: true;
  n: number;
  directed: boolean;
  /** Out-neighbours (all neighbours when undirected) and distances 1/w. */
  starts: Int32Array;
  targets: Int32Array;
  distances: Float64Array;
  /** Out-neighbours with distance 1 for hop counts. */
  source: DenseGraph;
}

/** The single gate into path-based algorithms. Throws on a negative weight. */
export function pathGraph(g: DenseGraph): PathGraph {
  const { n, w } = g;
  const starts = new Int32Array(n + 1);
  const targets: number[] = [];
  const distances: number[] = [];
  for (let i = 0; i < n; i++) {
    starts[i] = targets.length;
    for (let j = 0; j < n; j++) {
      const x = w[i * n + j] as number;
      if (!(x >= 0) || !Number.isFinite(x)) throw new NegativeWeightError(i, j, x);
      if (i === j || x === 0) continue;
      targets.push(j);
      distances.push(1 / x);
      if (x < pathGuardAudit.minWeight) pathGuardAudit.minWeight = x;
    }
  }
  starts[n] = targets.length;
  pathGuardAudit.graphs += 1;
  pathGuardAudit.ties += targets.length;
  return {
    n,
    directed: g.directed,
    starts,
    targets: Int32Array.from(targets),
    distances: Float64Array.from(distances),
    source: g,
  } as PathGraph;
}

export interface EdgeAttributes {
  weight: number;
  distance: number;
}

/** graphology graph for betweenness (distance 1/w), built only from a checked PathGraph. */
export function graphologyForPaths(p: PathGraph): Graph<Record<string, never>, EdgeAttributes> {
  return toGraphology(p.source);
}

/** graphology graph with `weight` (and `distance`) edge attributes; node keys are indices. */
export function toGraphology(g: DenseGraph): Graph<Record<string, never>, EdgeAttributes> {
  const graph = new Graph<Record<string, never>, EdgeAttributes>({
    type: g.directed ? 'directed' : 'undirected',
    multi: false,
    allowSelfLoops: false,
  });
  const { n, w } = g;
  for (let i = 0; i < n; i++) graph.addNode(String(i));
  for (let i = 0; i < n; i++) {
    for (let j = g.directed ? 0 : i + 1; j < n; j++) {
      const x = w[i * n + j] as number;
      if (i === j || !(x > 0)) continue;
      graph.addEdge(String(i), String(j), { weight: x, distance: 1 / x });
    }
  }
  return graph;
}
