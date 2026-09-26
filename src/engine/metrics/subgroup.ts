// Subgroups and layer overlap for the linked views (spec §8): the tie density
// inside a chosen group of members against the density of its ties to
// everyone else, and which ties two layers share. Both count binary ties
// (weight > 0) in the weights of the current view (docs/method-notes.md §6).
// Pure and cheap (one pass over n² pairs), so the interface calls them on the
// weights the engine returned rather than making a worker round trip.

export interface SubgroupDensity {
  size: number;
  /** Members outside the subgroup that are counted (the rest of the network). */
  others: number;
  internalTies: number;
  internalPossible: number;
  /** internalTies / internalPossible; NaN when the subgroup has fewer than two members. */
  internal: number;
  externalTies: number;
  externalPossible: number;
  /** externalTies / externalPossible; NaN when there is no one outside the subgroup. */
  external: number;
  /** (E − I) / (E + I) on tie counts; NaN when the subgroup has no ties. */
  ei: number;
}

/**
 * `members` are indices into the n × n weights (NaN = not rated = no tie).
 * `among`, when given, limits "the rest" to those indices (for example the
 * members the map shows); by default it is everyone outside the subgroup.
 * Directed view: ordered pairs, so a subgroup of k has k(k − 1) possible
 * internal ties and 2k(n − k) possible ties with the rest. Symmetrised view:
 * unordered pairs, k(k − 1)/2 and k(n − k).
 */
export function subgroupDensity(
  weights: Float64Array,
  n: number,
  directed: boolean,
  members: readonly number[],
  among?: readonly number[],
): SubgroupDensity {
  const inGroup = new Uint8Array(n);
  for (const i of members) if (i >= 0 && i < n) inGroup[i] = 1;
  const inScope = new Uint8Array(n);
  if (among) {
    for (const i of among) if (i >= 0 && i < n) inScope[i] = 1;
  } else {
    inScope.fill(1);
  }
  for (let i = 0; i < n; i++) if (inGroup[i]) inScope[i] = 1;

  let size = 0;
  let others = 0;
  for (let i = 0; i < n; i++) {
    if (inGroup[i]) size += 1;
    else if (inScope[i]) others += 1;
  }
  const tie = (k: number) => (weights[k] as number) > 0;
  let internalTies = 0;
  let externalTies = 0;
  for (let i = 0; i < n; i++) {
    if (!inScope[i]) continue;
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j || !inScope[j]) continue;
      const a = inGroup[i] === 1;
      const b = inGroup[j] === 1;
      if (!a && !b) continue;
      if (!tie(i * n + j)) continue;
      if (a && b) internalTies += 1;
      else externalTies += 1;
    }
  }
  const internalPossible = directed ? size * (size - 1) : (size * (size - 1)) / 2;
  const externalPossible = (directed ? 2 : 1) * size * others;
  const total = internalTies + externalTies;
  return {
    size,
    others,
    internalTies,
    internalPossible,
    internal: internalPossible > 0 ? internalTies / internalPossible : NaN,
    externalTies,
    externalPossible,
    external: externalPossible > 0 ? externalTies / externalPossible : NaN,
    ei: total > 0 ? (externalTies - internalTies) / total : NaN,
  };
}

export interface TieOverlap {
  /** Pairs tied on both layers, on the first only, on the second only. */
  both: number;
  firstOnly: number;
  secondOnly: number;
  /** both / (both + firstOnly + secondOnly); NaN when neither layer has a tie. */
  jaccard: number;
  /** n × n: 0 no tie, 1 first only, 2 second only, 3 both (symmetric when undirected). */
  classes: Uint8Array;
}

export const OVERLAP = { none: 0, firstOnly: 1, secondOnly: 2, both: 3 } as const;

/** Which ties two layers share, pair by pair (ordered pairs in the directed view). */
export function tieOverlap(
  first: Float64Array,
  second: Float64Array,
  n: number,
  directed: boolean,
): TieOverlap {
  const classes = new Uint8Array(n * n);
  let both = 0;
  let firstOnly = 0;
  let secondOnly = 0;
  for (let i = 0; i < n; i++) {
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j) continue;
      const k = i * n + j;
      const a = (first[k] as number) > 0;
      const b = (second[k] as number) > 0;
      const c = a && b ? OVERLAP.both : a ? OVERLAP.firstOnly : b ? OVERLAP.secondOnly : 0;
      if (c === OVERLAP.both) both += 1;
      else if (c === OVERLAP.firstOnly) firstOnly += 1;
      else if (c === OVERLAP.secondOnly) secondOnly += 1;
      classes[k] = c;
      if (!directed) classes[j * n + i] = c;
    }
  }
  const union = both + firstOnly + secondOnly;
  return { both, firstOnly, secondOnly, jaccard: union > 0 ? both / union : NaN, classes };
}
