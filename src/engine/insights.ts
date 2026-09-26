// Rule-based observations for the insights panel (spec §9). Each rule is a
// pure function of analysis results; its thresholds are the constants in
// INSIGHT_RULES, which the panel also uses to state the rule it applied
// (ui/copy/insights.ts). Rules return structure only: which members, which
// group, which figures, and the map view that shows them. They never rank or
// judge a member; the wording, written as questions, is in the copy layer.
//
// Quantiles use linear interpolation between order statistics (NumPy's
// default), over the members whose value is defined.

import { percentile } from './metrics/bootstrap';
import {
  COMPOSITE,
  FI_CLASS,
  type AttributeColumn,
  type AttributeKey,
  type InsightOutcome,
  type InsightRuleId,
  type InsightUnavailable,
  type LayerKey,
  type LayerRef,
  type MemberId,
  type MultiplexResult,
  type NetworkMetrics,
  type NodeMetricKey,
  type NodeMetricTable,
  type Observation,
  type RefResult,
} from './types';

/** Thresholds of every rule. The panel quotes them, so what it says is what ran. */
export const INSIGHT_RULES = {
  brokers: {
    /** Betweenness (weighted, 1/w distances) among the top share of members… */
    topShare: 0.1,
    /** …and constraint at or below this quantile of members' constraint. */
    constraintQuantile: 0.5,
    maxMembers: 5,
  },
  peripheral: {
    /** In-strength (strength in the symmetrised view) at or below this quantile of a layer… */
    quantile: 0.2,
    /** …on more than this share of the layers considered. */
    layerShare: 0.5,
  },
  overload: {
    /** Layers the rule reads, by key. */
    layers: ['advice', 'workflow_dependency'] as readonly string[],
    /** In-degree (degree when symmetrised) at or above this quantile… */
    quantile: 0.9,
    /** …and at least this multiple of the median in-degree. */
    medianMultiple: 2,
    maxMembers: 5,
  },
  silo: {
    /** Attributes whose groups are checked, first one present wins. */
    attributes: ['team'] as readonly string[],
    /** E-I index at or below this value on a layer: at least three internal ties for every external one. */
    maxEi: -0.5,
    minGroupSize: 3,
  },
  negativeCluster: {
    /** Members joined by pairs who rate each other negatively in both directions, at least this many. */
    minSize: 3,
  },
  formalInformal: {
    /**
     * Groups (the first attribute of silo.attributes present) are compared in
     * pairs, and each with itself, where at least this share of the formal
     * (informal) ties has no informal (formal) counterpart…
     */
    minShare: 0.5,
    /** …and at least this many such ties. */
    minPairs: 5,
    /** The members in the most such ties, highlighted on the map. */
    maxMembers: 5,
  },
} as const;

/** Panel order. */
export const INSIGHT_RULE_ORDER: readonly InsightRuleId[] = [
  'brokers',
  'peripheral',
  'overload',
  'silo',
  'negativeCluster',
  'formalOnly',
  'informalOnly',
];

const definedSorted = (column: ArrayLike<number>): number[] =>
  Array.from(column)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

const unavailable = (rule: InsightRuleId, reason: InsightUnavailable): InsightOutcome => ({
  rule,
  status: 'unavailable',
  reason,
  observations: [],
});

const outcome = (rule: InsightRuleId, observations: Observation[]): InsightOutcome => ({
  rule,
  status: observations.length > 0 ? 'observed' : 'none',
  observations,
});

/** Member indices ordered by value, highest first, then by member order. */
const byValueDesc = (indices: number[], column: ArrayLike<number>) =>
  indices.sort((a, b) => (column[b] as number) - (column[a] as number) || a - b);

// ------------------------------------------------------------------ brokers

/**
 * Potential brokers: members whose betweenness is among the top
 * INSIGHT_RULES.brokers.topShare of members (at least one member; members
 * tied with the last one included) and above 0, and whose constraint is at or
 * below the median. High betweenness with low constraint means a member lies
 * on many shortest routes between others whose contacts are not tied to each
 * other (docs/method-notes.md §3).
 */
export function potentialBrokers(
  ids: readonly MemberId[],
  ref: LayerRef,
  node: NodeMetricTable,
  directed: boolean,
): InsightOutcome {
  const T = INSIGHT_RULES.brokers;
  const betweenness = node.columns.betweenness;
  const constraint = node.columns.constraint;
  if (!betweenness || !constraint) return unavailable('brokers', 'noComposite');
  const n = ids.length;
  const k = Math.max(1, Math.ceil(T.topShare * n));
  const ranked = byValueDesc(
    [...Array(n).keys()].filter((i) => (betweenness[i] as number) > 0),
    betweenness,
  );
  const cutoff = ranked[Math.min(k, ranked.length) - 1];
  if (cutoff === undefined) return outcome('brokers', []);
  const floor = betweenness[cutoff] as number;
  const medianConstraint = percentile(definedSorted(constraint), T.constraintQuantile);
  const chosen = ranked
    .filter((i) => (betweenness[i] as number) >= floor)
    .filter((i) => Number.isFinite(constraint[i]) && (constraint[i] as number) <= medianConstraint)
    .slice(0, T.maxMembers);
  if (chosen.length === 0) return outcome('brokers', []);
  return outcome('brokers', [
    {
      rule: 'brokers',
      ref,
      members: chosen.map((i) => ids[i] as MemberId),
      evidence: {
        count: chosen.length,
        topShare: T.topShare,
        medianConstraint,
        highestBetweenness: betweenness[chosen[0] as number] as number,
        directed: directed ? 1 : 0,
      },
      view: {
        layer: ref,
        sizeMetric: 'betweenness',
        layout: 'force',
        groupBy: null,
        filters: [],
        highlight: chosen.map((i) => ids[i] as MemberId),
        show: [],
      },
    },
  ]);
}

// --------------------------------------------------------------- peripheral

export interface LayerNodeTable {
  ref: LayerRef;
  node: NodeMetricTable;
}

/**
 * Peripheral members: members whose in-strength (strength when symmetrised) is
 * at or below the INSIGHT_RULES.peripheral.quantile of members on more than
 * half of the layers considered: every unsigned layer and the positive part of
 * each signed layer, not the composite and not negative ratings. A layer on
 * which nobody receives any tie is not considered, and a member at the layer's
 * highest value is never counted low.
 */
export function peripheralMembers(
  ids: readonly MemberId[],
  layers: readonly LayerNodeTable[],
  directed: boolean,
): InsightOutcome {
  const T = INSIGHT_RULES.peripheral;
  const metric: NodeMetricKey = directed ? 'inStrength' : 'strength';
  const n = ids.length;
  const low = new Array<number>(n).fill(0);
  let considered = 0;
  for (const { node } of layers) {
    const column = node.columns[metric];
    if (!column) continue;
    const values = definedSorted(column);
    const max = values[values.length - 1] ?? 0;
    if (max <= 0) continue;
    considered += 1;
    const q = percentile(values, T.quantile);
    for (let i = 0; i < n; i++) {
      const v = column[i] as number;
      if (Number.isFinite(v) && v <= q && v < max) low[i] = (low[i] ?? 0) + 1;
    }
  }
  if (considered === 0) return unavailable('peripheral', 'noLayers');
  const chosen = [...Array(n).keys()]
    .filter((i) => (low[i] ?? 0) > T.layerShare * considered)
    .sort((a, b) => (low[b] ?? 0) - (low[a] ?? 0) || a - b);
  if (chosen.length === 0) return outcome('peripheral', []);
  const members = chosen.map((i) => ids[i] as MemberId);
  return outcome('peripheral', [
    {
      rule: 'peripheral',
      ref: COMPOSITE,
      members,
      evidence: {
        count: chosen.length,
        layers: considered,
        fewestLowLayers: Math.min(...chosen.map((i) => low[i] ?? 0)),
        quantile: T.quantile,
        directed: directed ? 1 : 0,
      },
      view: {
        layer: COMPOSITE,
        sizeMetric: metric,
        layout: 'force',
        groupBy: null,
        filters: [],
        highlight: members,
        show: [],
      },
    },
  ]);
}

// ----------------------------------------------------------------- overload

/**
 * Possible overload: on the advice and workflow dependency layers, members
 * whose in-degree (degree when symmetrised) is at or above the
 * INSIGHT_RULES.overload.quantile of members and at least medianMultiple times
 * the median in-degree, and above 0; at most maxMembers per layer, highest
 * first. One observation per layer.
 */
export function possibleOverload(
  ids: readonly MemberId[],
  layers: readonly (LayerNodeTable & { layer: LayerKey })[],
  directed: boolean,
): InsightOutcome {
  const T = INSIGHT_RULES.overload;
  const metric: NodeMetricKey = directed ? 'inDegree' : 'degree';
  const read = layers.filter((l) => T.layers.includes(l.layer));
  if (read.length === 0) return unavailable('overload', 'layersNotEnabled');
  const observations: Observation[] = [];
  for (const { ref, node } of read) {
    const column = node.columns[metric];
    if (!column) continue;
    const values = definedSorted(column);
    const q = percentile(values, T.quantile);
    const median = percentile(values, 0.5);
    const floor = Math.max(q, T.medianMultiple * median);
    const chosen = byValueDesc(
      [...Array(ids.length).keys()].filter((i) => {
        const v = column[i] as number;
        return Number.isFinite(v) && v > 0 && v >= floor;
      }),
      column,
    ).slice(0, T.maxMembers);
    if (chosen.length === 0) continue;
    const members = chosen.map((i) => ids[i] as MemberId);
    observations.push({
      rule: 'overload',
      ref,
      members,
      evidence: {
        count: chosen.length,
        highest: column[chosen[0] as number] as number,
        median,
        directed: directed ? 1 : 0,
      },
      view: {
        layer: ref,
        sizeMetric: metric,
        layout: 'force',
        groupBy: null,
        filters: [],
        highlight: members,
        show: [],
      },
    });
  }
  return outcome('overload', observations);
}

// -------------------------------------------------------------------- silos

/**
 * Silos: groups of the first attribute in INSIGHT_RULES.silo.attributes that
 * the project has (team by default), of at least minGroupSize members, whose
 * E-I index is at or below maxEi on at least one of the layers given (each
 * unsigned layer and the composite): most ties involving the group stay
 * inside it. One observation per group, quoting the layer with the lowest
 * index. The E-I index counts ties, not strength (docs/method-notes.md §4).
 */
export function silos(
  ids: readonly MemberId[],
  layers: readonly { ref: LayerRef; network: NetworkMetrics }[],
  attributes: Readonly<Record<AttributeKey, AttributeColumn>>,
): InsightOutcome {
  const T = INSIGHT_RULES.silo;
  const attribute = T.attributes.find((a) => attributes[a]);
  const column = attribute ? attributes[attribute] : undefined;
  if (!attribute || !column) return unavailable('silo', 'noGroupAttribute');
  if (layers.length === 0) return unavailable('silo', 'noLayers');
  const found = new Map<
    string,
    { ref: LayerRef; ei: number; internal: number; external: number; size: number; layers: number }
  >();
  for (const { ref, network } of layers) {
    for (const g of network.mixing[attribute]?.perGroup ?? []) {
      if (g.size < T.minGroupSize || g.internal + g.external === 0 || !(g.ei <= T.maxEi)) continue;
      const best = found.get(g.group);
      if (!best || g.ei < best.ei) {
        found.set(g.group, {
          ref,
          ei: g.ei,
          internal: g.internal,
          external: g.external,
          size: g.size,
          layers: (best?.layers ?? 0) + 1,
        });
      } else best.layers += 1;
    }
  }
  const observations: Observation[] = [...found].map(([group, f]) => {
    const members = ids.filter((_, i) => column.values[i] === group);
    return {
      rule: 'silo',
      ref: f.ref,
      members,
      group: { attribute, value: group },
      evidence: {
        ei: f.ei,
        internal: f.internal,
        external: f.external,
        size: f.size,
        layers: f.layers,
        maxEi: T.maxEi,
      },
      view: {
        layer: f.ref,
        sizeMetric: 'betweenness',
        layout: 'grouped',
        groupBy: attribute,
        filters: [],
        highlight: members,
        show: [],
      },
    };
  });
  observations.sort((a, b) => (a.evidence.ei ?? 0) - (b.evidence.ei ?? 0));
  return outcome('silo', observations);
}

// -------------------------------------------------------- negative clusters

/**
 * Negative clusters: on each signed layer, pairs who rate each other
 * negatively in both directions (read from the directed ratings in either
 * view), grouped into connected sets; a set of at least
 * INSIGHT_RULES.negativeCluster.minSize members is an observation. `signed`
 * holds each signed layer's directed ratings on the −1..1 scale, NaN = not
 * rated.
 */
export function negativeClusters(
  ids: readonly MemberId[],
  signed: ReadonlyMap<LayerKey, Float64Array>,
  drawLayer: LayerRef,
): InsightOutcome {
  const T = INSIGHT_RULES.negativeCluster;
  if (signed.size === 0) return unavailable('negativeCluster', 'noSignedLayer');
  const n = ids.length;
  const observations: Observation[] = [];
  for (const [layer, s] of signed) {
    const parent = [...Array(n).keys()];
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i] as number] as number;
        i = parent[i] as number;
      }
      return i;
    };
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if ((s[i * n + j] as number) < 0 && (s[j * n + i] as number) < 0) {
          pairs.push([i, j]);
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
    const sets = new Map<number, number[]>();
    for (const [i, j] of pairs)
      for (const x of [i, j]) {
        const root = find(x);
        const list = sets.get(root) ?? [];
        if (!list.includes(x)) list.push(x);
        sets.set(root, list);
      }
    for (const [root, members] of sets) {
      if (members.length < T.minSize) continue;
      members.sort((a, b) => a - b);
      const within = pairs.filter(([i]) => find(i) === root).length;
      const memberIds = members.map((i) => ids[i] as MemberId);
      observations.push({
        rule: 'negativeCluster',
        ref: `${layer}-`,
        members: memberIds,
        evidence: { size: members.length, pairs: within },
        view: {
          layer: drawLayer,
          sizeMetric: 'betweenness',
          layout: 'force',
          groupBy: null,
          filters: [],
          highlight: memberIds,
          show: [layer],
        },
      });
    }
  }
  observations.sort((a, b) => (b.evidence.size ?? 0) - (a.evidence.size ?? 0));
  return outcome('negativeCluster', observations);
}

// ---------------------------------------------------- formal–informal gaps

/**
 * Formal/informal gaps, from the formal–informal classification
 * (multiplexity). Members are grouped by the first attribute of
 * INSIGHT_RULES.silo.attributes the project has (team by default), or taken as
 * one group without it. For every pair of groups, and every group with
 * itself, the share of formal ties with no informal counterpart is formal only
 * / (formal only + both); the reverse share uses informal only. A pair of
 * groups is an observation when the share is at least
 * INSIGHT_RULES.formalInformal.minShare and at least minPairs ties are
 * involved. Ties are ordered pairs in the directed view and unordered pairs in
 * the symmetrised view. Pairs with a missing rating on either layer are not
 * classified and not counted.
 */
export function formalInformalGaps(
  ids: readonly MemberId[],
  fi: MultiplexResult['formalInformal'],
  directed: boolean,
  attributes: Readonly<Record<AttributeKey, AttributeColumn>>,
): InsightOutcome[] {
  const T = INSIGHT_RULES.formalInformal;
  if (!fi) {
    return [
      unavailable('formalOnly', 'noFormalInformal'),
      unavailable('informalOnly', 'noFormalInformal'),
    ];
  }
  const n = ids.length;
  const attribute = INSIGHT_RULES.silo.attributes.find((a) => attributes[a]) ?? null;
  const values = attribute ? (attributes[attribute]?.values ?? []) : [];
  const groupOf = (i: number): string | null => (attribute ? (values[i] ?? null) : '');
  const key = (a: string, b: string) => (a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  type Tally = {
    a: string;
    b: string;
    formalOnly: number;
    informalOnly: number;
    both: number;
    fo: Map<number, number>;
    io: Map<number, number>;
  };
  const tallies = new Map<string, Tally>();
  for (let i = 0; i < n; i++) {
    for (let j = directed ? 0 : i + 1; j < n; j++) {
      if (i === j) continue;
      const c = fi.classes[i * n + j];
      if (c !== FI_CLASS.formalOnly && c !== FI_CLASS.informalOnly && c !== FI_CLASS.both) continue;
      const gi = groupOf(i);
      const gj = groupOf(j);
      if (gi === null || gj === null) continue;
      const k = key(gi, gj);
      let t = tallies.get(k);
      if (!t) {
        const [a, b] = gi <= gj ? [gi, gj] : [gj, gi];
        t = { a, b, formalOnly: 0, informalOnly: 0, both: 0, fo: new Map(), io: new Map() };
        tallies.set(k, t);
      }
      if (c === FI_CLASS.both) t.both += 1;
      else if (c === FI_CLASS.formalOnly) {
        t.formalOnly += 1;
        t.fo.set(i, (t.fo.get(i) ?? 0) + 1).set(j, (t.fo.get(j) ?? 0) + 1);
      } else {
        t.informalOnly += 1;
        t.io.set(i, (t.io.get(i) ?? 0) + 1).set(j, (t.io.get(j) ?? 0) + 1);
      }
    }
  }
  const make = (rule: 'formalOnly' | 'informalOnly'): InsightOutcome => {
    const layer = rule === 'formalOnly' ? fi.formal : fi.informal;
    const observations: Observation[] = [];
    for (const t of tallies.values()) {
      const only = rule === 'formalOnly' ? t.formalOnly : t.informalOnly;
      const total = only + t.both;
      const share = total > 0 ? only / total : 0;
      if (only < T.minPairs || share < T.minShare) continue;
      const counts = rule === 'formalOnly' ? t.fo : t.io;
      const involved = [...counts.keys()]
        .sort((x, y) => (counts.get(y) ?? 0) - (counts.get(x) ?? 0) || x - y)
        .slice(0, T.maxMembers);
      const members = involved.map((i) => ids[i] as MemberId);
      const filterValues = t.a === t.b ? [t.a] : [t.a, t.b];
      observations.push({
        rule,
        ref: layer,
        members,
        ...(attribute ? { group: { attribute, value: t.a, other: t.b } } : {}),
        evidence: { pairs: only, total, share, directed: directed ? 1 : 0, minShare: T.minShare },
        view: {
          layer,
          sizeMetric: directed ? 'inDegree' : 'degree',
          layout: attribute ? 'grouped' : 'force',
          groupBy: attribute,
          filters: attribute ? [{ key: attribute, values: filterValues }] : [],
          highlight: members,
          show: [fi.formal, fi.informal],
        },
      });
    }
    observations.sort(
      (x, y) =>
        (y.evidence.share ?? 0) - (x.evidence.share ?? 0) ||
        (y.evidence.pairs ?? 0) - (x.evidence.pairs ?? 0),
    );
    return outcome(rule, observations);
  };
  return [make('formalOnly'), make('informalOnly')];
}

// --------------------------------------------------------------------- all

export interface InsightInput {
  ids: readonly MemberId[];
  directed: boolean;
  refs: Readonly<Record<LayerRef, RefResult>>;
  refOrder: readonly LayerRef[];
  attributes: Readonly<Record<AttributeKey, AttributeColumn>>;
  /** Signed layers' directed ratings on −1..1. */
  signed: ReadonlyMap<LayerKey, Float64Array>;
  multiplex: MultiplexResult | null;
}

/** Applies every rule, in panel order. */
export function observe(input: InsightInput): InsightOutcome[] {
  const { ids, directed, refs, refOrder } = input;
  const composite = refs[COMPOSITE];
  const layerTables = refOrder
    .map((ref) => refs[ref])
    .filter(
      (r): r is RefResult => r !== undefined && (r.kind === 'unsigned' || r.kind === 'positive'),
    )
    .map((r) => ({ ref: r.ref, node: r.node, layer: r.layer ?? r.ref }));
  // Negative clusters are drawn over the composite, or the first unsigned layer without one.
  const drawLayer =
    composite?.ref ?? refOrder.find((ref) => refs[ref]?.kind === 'unsigned') ?? COMPOSITE;
  const out: InsightOutcome[] = [
    composite
      ? potentialBrokers(ids, composite.ref, composite.node, directed)
      : unavailable('brokers', 'noComposite'),
    peripheralMembers(ids, layerTables, directed),
    possibleOverload(
      ids,
      layerTables.filter((l) => refs[l.ref]?.kind === 'unsigned'),
      directed,
    ),
    silos(
      ids,
      [
        ...(composite ? [{ ref: composite.ref, network: composite.network }] : []),
        ...layerTables
          .filter((l) => refs[l.ref]?.kind === 'unsigned')
          .map((l) => ({ ref: l.ref, network: (refs[l.ref] as RefResult).network })),
      ],
      input.attributes,
    ),
    negativeClusters(ids, input.signed, drawLayer),
    ...formalInformalGaps(ids, input.multiplex?.formalInformal ?? null, directed, input.attributes),
  ];
  return INSIGHT_RULE_ORDER.map(
    (rule) => out.find((o) => o.rule === rule) ?? unavailable(rule, 'noLayers'),
  );
}
