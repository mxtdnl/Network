// Resilience (spec §6, plan §3.6): remove members and compare components,
// reachability and average path length before and after, on the induced
// subgraph of the remaining members. Average path lengths are over reachable
// pairs only, so they stay defined when the network falls apart
// (nx.average_shortest_path_length raises instead).

import { connectedComponents, stronglyConnectedComponents } from 'graphology-components';
import { inducedSubgraph, pathGraph, toGraphology, type DenseGraph } from '../graphs';
import { bfs, dijkstra } from '../paths';
import type { MemberId, ResilienceResult, ResilienceSnapshot } from '../types';
import { symmetricSupport } from './network';

export function resilienceSnapshot(g: DenseGraph): ResilienceSnapshot {
  const { n } = g;
  const p = pathGraph(g);
  const graph = toGraphology(g);
  let components: ResilienceSnapshot['components'];
  if (g.directed) {
    const weak = connectedComponents(
      toGraphology({ ...g, directed: false, w: symmetricSupport(g) }),
    );
    components = {
      weak: weak.length,
      strong: stronglyConnectedComponents(graph).length,
      largest: weak.reduce((m, c) => Math.max(m, c.length), 0),
    };
  } else {
    const cc = connectedComponents(graph);
    components = { connected: cc.length, largest: cc.reduce((m, c) => Math.max(m, c.length), 0) };
  }
  let reachable = 0;
  let totalDistance = 0;
  let totalHops = 0;
  const dist = new Float64Array(n);
  const hops = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    dijkstra(p, u, dist);
    bfs(p, u, hops);
    for (let v = 0; v < n; v++) {
      if (v === u || dist[v] === Infinity) continue;
      reachable += 1;
      totalDistance += dist[v] as number;
      totalHops += hops[v] as number;
    }
  }
  const pairs = n * (n - 1);
  return {
    members: n,
    components,
    reachablePairs: reachable,
    reachability: pairs > 0 ? reachable / pairs : NaN,
    averageDistance: reachable > 0 ? totalDistance / reachable : NaN,
    averageHops: reachable > 0 ? totalHops / reachable : NaN,
  };
}

function componentCount(s: ResilienceSnapshot): number {
  return s.components.weak ?? s.components.connected ?? 0;
}

export function resilience(
  g: DenseGraph,
  ref: string,
  memberIds: readonly MemberId[],
  removed: readonly MemberId[],
): ResilienceResult {
  const drop = new Set(removed);
  const keep: number[] = [];
  memberIds.forEach((id, i) => {
    if (!drop.has(id)) keep.push(i);
  });
  const before = resilienceSnapshot(g);
  const after = resilienceSnapshot(inducedSubgraph(g, keep));
  return {
    ref,
    removed: memberIds.filter((id) => drop.has(id)),
    before,
    after,
    change: {
      components: componentCount(after) - componentCount(before),
      largest: after.components.largest - before.components.largest,
      reachability: after.reachability - before.reachability,
      averageDistance: after.averageDistance - before.averageDistance,
      averageHops: after.averageHops - before.averageHops,
    },
  };
}
