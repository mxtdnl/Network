// Engine types shared by the analysis modules, the worker and ui/engineClient.ts
// (plan §1.2). Pure data: no functions, no graph objects, so every value can
// cross the worker boundary by structured clone or transfer.
//
import type { CoverageResult } from '../data/coverage';

export type { CoverageResult };

// Conventions (docs/method-notes.md):
// - Matrices are n × n, row-major, `m[i * n + j]` for the tie i → j.
// - Inside the engine a missing rating is NaN (CLAUDE.md D2); `null` exists only
//   in project files and the store. engine/input.ts is the only place one
//   becomes the other.
// - A metric that is not defined for a member is NaN, and `flags` says why.

export type MemberId = string;
export type LayerKey = string;
export type AttributeKey = string;
/** A layer key, `${key}+` / `${key}-` for a signed layer's sub-layers, or 'composite'. */
export type LayerRef = string;

export type ViewKind = 'directed' | 'symmetrised';
export type SymmetriseRule = 'mean' | 'min' | 'max';
export type SignedTreatment = 'positive' | 'filterNegative' | 'multiplier';

export const COMPOSITE: LayerRef = 'composite';

export interface EngineLayer {
  key: LayerKey;
  label: string;
  min: number;
  max: number;
  signed: boolean;
  role?: 'formal' | 'informal';
  defaultWeight: number;
}

export interface EngineSettings {
  view: ViewKind;
  symmetrise: SymmetriseRule;
  /** Raw slider values; layers without an entry use their default weight. */
  weights: Record<LayerKey, number>;
  /** Signed layers without an entry use 'positive'. */
  signedTreatment: Record<LayerKey, SignedTreatment>;
  /** Louvain seed (project settings.random_seed). */
  seed: number;
}

export interface AttributeColumn {
  /** Known categories in display order; values not listed follow in order of first appearance. */
  categories: string[];
  /** One value per member; null = not recorded. */
  values: (string | null)[];
}

export interface AnalysisInput {
  /** Identifies the project revision and settings this input was built from. */
  inputKey: string;
  memberIds: MemberId[];
  attributes: Record<AttributeKey, AttributeColumn>;
  /** Enabled, non-categorical layers. */
  layers: EngineLayer[];
  /** One n × n tensor per layer, aligned with `layers`; NaN = not rated, diagonal NaN. */
  ratings: Float64Array[];
  settings: EngineSettings;
  /** Data coverage, computed from the project on the main thread (CLAUDE.md D29), passed through. */
  coverage?: CoverageResult | null;
}

// ------------------------------------------------------------ node metrics

export type NodeMetricKey =
  | 'inStrength'
  | 'outStrength'
  | 'strength'
  | 'inDegree'
  | 'outDegree'
  | 'degree'
  | 'betweenness'
  | 'betweennessBinary'
  | 'harmonicIn'
  | 'harmonicOut'
  | 'harmonic'
  | 'eigenvector'
  | 'constraint'
  | 'effectiveSize'
  | 'clustering';

/** Why a value is not defined (NaN), or why a defined value needs a note. */
export type NodeFlag =
  'isolated' | 'outsideLargestComponent' | 'noComponent' | 'notConverged' | 'fewerThanTwoContacts';

export interface NodeMetricTable {
  /** Only the metrics computed for this layer and view are present. */
  columns: Partial<Record<NodeMetricKey, Float64Array>>;
  /** Per-member flags for a metric, null where there is nothing to say. */
  flags: Partial<Record<NodeMetricKey, (NodeFlag | null)[]>>;
  /** Metrics deliberately not computed for this layer, with the reason. */
  omitted: { metrics: NodeMetricKey[]; reason: 'negativeSubLayer' } | null;
}

// --------------------------------------------------------- network metrics

export interface Reciprocity {
  /** Share of directed ties that are reciprocated (nx.overall_reciprocity). */
  overall: number;
  /** Mutual dyads / (mutual + asymmetric dyads). */
  dyad: number;
  mutualDyads: number;
  asymmetricDyads: number;
}

export interface Components {
  /** Directed view: weakly and strongly connected component sizes, largest first. */
  weak?: number[];
  strong?: number[];
  /** Symmetrised view: connected component sizes, largest first. */
  connected?: number[];
}

export interface Centralisation {
  inDegree?: number;
  outDegree?: number;
  degree?: number;
  /** Freeman centralisation of binary (unweighted) betweenness. */
  betweenness?: number;
}

export interface GroupMixing {
  groups: string[];
  /** Members with no value for the attribute; their ties are left out. */
  excluded: number;
  internal: number;
  external: number;
  /** (E − I) / (E + I). */
  ei: number;
  perGroup: { group: string; size: number; internal: number; external: number; ei: number }[];
  /** groups × groups, row-major: tie density from row group to column group. */
  density: Float64Array;
}

export interface NetworkMetrics {
  members: number;
  ties: number;
  density: number;
  reciprocity: Reciprocity;
  averageClustering: number;
  components: Components;
  centralisation: Centralisation;
  mixing: Record<AttributeKey, GroupMixing>;
}

export interface CommunityResult {
  /** Community index per member, numbered by lowest member index. */
  membership: Int32Array;
  count: number;
  modularity: number;
  resolution: number;
  seed: number;
  /** Louvain runs from the seeded stream; the best partition is kept. */
  restarts: number;
}

export type RefKind = 'unsigned' | 'positive' | 'negative' | 'composite';

export interface RefResult {
  ref: LayerRef;
  kind: RefKind;
  /** Source layer; absent for the composite. */
  layer?: LayerKey;
  node: NodeMetricTable;
  network: NetworkMetrics;
  /** Louvain on the symmetrised graph of this layer (plan Q9), null when it has no ties. */
  communities: CommunityResult | null;
  /**
   * n × n tie weights (0–1) in the requested view, NaN = not rated: the values
   * the metrics were computed from, used by the map for edge width, the
   * threshold and layout attraction (CLAUDE.md D51). A copy, so transferring
   * it leaves the worker's prepared input intact.
   */
  weights: Float64Array;
}

// ------------------------------------------------------------------ signed

export interface TriadCounts {
  ppp: number;
  ppn: number;
  pnn: number;
  nnn: number;
  balanced: number;
  unbalanced: number;
  /** balanced / (balanced + unbalanced). */
  balanceRatio: number;
}

export interface SignedResult {
  layer: LayerKey;
  /** Σ_j of positive (negative) ratings received, on the −1..1 scale. */
  inPositive: Float64Array;
  inNegative: Float64Array;
  inPositiveCount: Int32Array;
  inNegativeCount: Int32Array;
  /** Structural balance on the signed graph symmetrised by the chosen rule. */
  triads: TriadCounts;
}

// ------------------------------------------------------------- multiplexity

export interface FormalInformalCounts {
  formalOnly: number;
  informalOnly: number;
  both: number;
  neither: number;
  notClassified: number;
}

export const FI_CLASS = {
  none: 0,
  formalOnly: 1,
  informalOnly: 2,
  both: 3,
  neither: 4,
  notClassified: 5,
} as const;

export interface MultiplexResult {
  refs: LayerRef[];
  /** refs × refs, row-major Jaccard overlap of tie sets. */
  jaccard: Float64Array;
  /** Index k: number of pairs tied in exactly k of `refs`. */
  overlapDistribution: number[];
  /** n × n: number of refs in which the pair is tied (symmetric in the symmetrised view). */
  pairCounts: Uint8Array;
  formalInformal: {
    formal: LayerKey;
    informal: LayerKey;
    counts: FormalInformalCounts;
    /** n × n, FI_CLASS codes; the diagonal is FI_CLASS.none. */
    classes: Uint8Array;
  } | null;
}

// ---------------------------------------------------------------- composite

export interface CompositeTerm {
  layer: LayerKey;
  label: string;
  rawWeight: number;
  /** Normalised so the terms' weights sum to 1. */
  weight: number;
  /** rescale: (v − min)/(max − min); positivePart: max(v, 0)/max. */
  transform: 'rescale' | 'positivePart';
}

export interface CompositeFormula {
  terms: CompositeTerm[];
  /** Signed layers whose negative ratings remove the tie. */
  filters: { layer: LayerKey; label: string }[];
  /** Signed layers applied as m = 1 + α·s, s the rating on the −1..1 scale. */
  multipliers: { layer: LayerKey; label: string; alpha: number }[];
  /** Layers with weight 0, left out entirely. */
  excluded: LayerKey[];
  /** Weights are renormalised over the terms rated for each pair (plan Q2). */
  missingRule: 'renormalise';
  /** The composite is capped at this value after multipliers. */
  cap: number;
  /** Plain notation, e.g. "C = 0.25·r(Connection strength) + …". */
  notation: string;
}

// ----------------------------------------------------------------- analysis

export type EngineWarning =
  | { code: 'compositeUndefined'; reason: 'noWeightedLayers' | 'noLayers' }
  | { code: 'invalidScale'; layer: LayerKey }
  | { code: 'eigenvectorUndefined'; ref: LayerRef; reason: 'noComponent' | 'notConverged' };

export interface AnalysisResult {
  inputKey: string;
  view: ViewKind;
  symmetrise: SymmetriseRule;
  memberIds: MemberId[];
  refOrder: LayerRef[];
  refs: Record<LayerRef, RefResult>;
  signed: Record<LayerKey, SignedResult>;
  multiplex: MultiplexResult | null;
  composite: CompositeFormula | null;
  /** Response rates and the threshold flag (spec §6), or null when the input had none. */
  coverage: CoverageResult | null;
  warnings: EngineWarning[];
}

// --------------------------------------------------------------- resilience

export interface ResilienceSnapshot {
  members: number;
  /** Directed view: weak and strong counts; symmetrised: connected count. */
  components: { weak?: number; strong?: number; connected?: number; largest: number };
  reachablePairs: number;
  /** Share of ordered pairs (u, v), u ≠ v, with a path from u to v. */
  reachability: number;
  /** Mean shortest-path distance (1/w) over reachable pairs only. */
  averageDistance: number;
  /** Mean shortest-path length in steps over reachable pairs only. */
  averageHops: number;
}

export interface ResilienceResult {
  ref: LayerRef;
  removed: MemberId[];
  before: ResilienceSnapshot;
  after: ResilienceSnapshot;
  change: {
    components: number;
    largest: number;
    reachability: number;
    averageDistance: number;
    averageHops: number;
  };
}

// --------------------------------------------------------------------- path

export interface PathResult {
  ref: LayerRef;
  /** Members along one shortest path, from the first member to the second. */
  members: MemberId[];
  /** Sum of 1/w along the path. */
  distance: number;
  hops: number;
  /** How many distinct paths share this shortest length. */
  shortestPaths: number;
}

// ---------------------------------------------------------------- bootstrap

export type BootstrapMetric = Exclude<NodeMetricKey, 'betweennessBinary'>;

export interface BootstrapOptions {
  ref: LayerRef;
  metric: BootstrapMetric;
  replicates: number;
  /** Share of members dropped in each replicate. */
  dropFraction: number;
  seed: number;
}

export interface BootstrapResult {
  ref: LayerRef;
  metric: BootstrapMetric;
  replicates: number;
  dropped: number;
  /** Rank on the full network, 1 = highest value; NaN where the metric is not defined. */
  observedRank: Float64Array;
  /** 2.5th and 97.5th percentiles of the member's rank, rescaled to the full network (1..n). */
  rankLow: Float64Array;
  rankHigh: Float64Array;
  /** Replicates in which the member was retained and its value was defined. */
  samples: Int32Array;
}
