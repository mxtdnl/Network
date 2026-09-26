// Shortest paths on a checked PathGraph (distance = 1/w). Array-based Dijkstra,
// O(n²) per source, which suits dense graphs of up to 250 members.

import type { PathGraph } from './graphs';

/** Shortest distances from `source` (Infinity where unreachable). */
export function dijkstra(p: PathGraph, source: number, dist = new Float64Array(p.n)): Float64Array {
  const { n, starts, targets, distances } = p;
  dist.fill(Infinity);
  const done = new Uint8Array(n);
  dist[source] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let v = 0; v < n; v++) {
      if (done[v] === 0 && (dist[v] as number) < best) {
        best = dist[v] as number;
        u = v;
      }
    }
    if (u < 0) break;
    done[u] = 1;
    const end = starts[u + 1] as number;
    for (let e = starts[u] as number; e < end; e++) {
      const v = targets[e] as number;
      const d = best + (distances[e] as number);
      if (d < (dist[v] as number)) dist[v] = d;
    }
  }
  return dist;
}

/** Hop counts from `source` (Infinity where unreachable). */
export function bfs(p: PathGraph, source: number, hops = new Float64Array(p.n)): Float64Array {
  const { n, starts, targets } = p;
  hops.fill(Infinity);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  hops[source] = 0;
  queue[tail++] = source;
  while (head < tail) {
    const u = queue[head++] as number;
    const next = (hops[u] as number) + 1;
    const end = starts[u + 1] as number;
    for (let e = starts[u] as number; e < end; e++) {
      const v = targets[e] as number;
      if (hops[v] === Infinity) {
        hops[v] = next;
        queue[tail++] = v;
      }
    }
  }
  return hops;
}

/**
 * Harmonic closeness divided by (n − 1).
 * incoming: H_v = Σ_u 1/d(u→v) (NetworkX convention); outgoing: Σ_v 1/d(u→v).
 */
export function harmonic(p: PathGraph): { incoming: Float64Array; outgoing: Float64Array } {
  const { n } = p;
  const incoming = new Float64Array(n);
  const outgoing = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    dijkstra(p, u, dist);
    for (let v = 0; v < n; v++) {
      if (v === u) continue;
      const d = dist[v] as number;
      if (d === Infinity) continue;
      incoming[v] = (incoming[v] as number) + 1 / d;
      outgoing[u] = (outgoing[u] as number) + 1 / d;
    }
  }
  if (n > 1) {
    for (let v = 0; v < n; v++) {
      incoming[v] = (incoming[v] as number) / (n - 1);
      outgoing[v] = (outgoing[v] as number) / (n - 1);
    }
  }
  return { incoming, outgoing };
}

export interface ShortestPath {
  /** Member indices from source to target. */
  path: number[];
  distance: number;
  /** Number of distinct shortest paths (equal length by floating-point equality, as NetworkX). */
  count: number;
}

/**
 * One shortest path from `source` to `target`, or null if there is none.
 * Among equally short paths, the one whose members, read backwards from the
 * target, have the lowest indices is returned, so the result is deterministic.
 */
export function shortestPath(p: PathGraph, source: number, target: number): ShortestPath | null {
  const { n, starts, targets, distances } = p;
  const dist = new Float64Array(n).fill(Infinity);
  const sigma = new Float64Array(n);
  const preds: number[][] = Array.from({ length: n }, () => []);
  const done = new Uint8Array(n);
  dist[source] = 0;
  sigma[source] = 1;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let v = 0; v < n; v++) {
      if (done[v] === 0 && (dist[v] as number) < best) {
        best = dist[v] as number;
        u = v;
      }
    }
    if (u < 0 || u === target) break;
    done[u] = 1;
    const end = starts[u + 1] as number;
    for (let e = starts[u] as number; e < end; e++) {
      const v = targets[e] as number;
      if (done[v] === 1) continue;
      const d = best + (distances[e] as number);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        sigma[v] = sigma[u] as number;
        preds[v] = [u];
      } else if (d === dist[v]) {
        sigma[v] = (sigma[v] as number) + (sigma[u] as number);
        (preds[v] as number[]).push(u);
      }
    }
  }
  if (source === target || dist[target] === Infinity) return null;
  const path = [target];
  let v = target;
  while (v !== source) {
    v = Math.min(...(preds[v] as number[]));
    path.push(v);
  }
  path.reverse();
  return { path, distance: dist[target] as number, count: sigma[target] as number };
}
