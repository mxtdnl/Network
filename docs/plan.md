# Graticule: Phase 0 build plan

Status: approved by the owner on 2026-09-26, with the section 6 defaults. `spec.md` is the source of truth; where this plan interprets or extends it, the item is marked **Proposed** and, if it changes behaviour, is repeated as a question in section 6.

Library behaviour cited below was checked on 2026-09-26 against graphology 0.26.0, graphology-metrics 2.4.2, graphology-communities-louvain 2.0.2, graphology-shortest-path 2.1.0 and NetworkX 3.6.1, by running both libraries on Zachary's karate club (undirected, weighted) and on a directed, weighted variant of it with two strongly connected components. Differences reported as "verified" are measured, not assumed.

---

## 1. Architecture

### 1.1 Module boundaries

```
src/
  data/                 no React, no DOM, no engine imports
    schema.ts           project-file types (section 2), constants, SCHEMA_VERSION
    migrations.ts       migrate(v_n → v_n+1) chain; refuses unknown future versions
    projectFile.ts      parse / serialise .ona.json; validates against schema
    import/
      csv.ts            Papa Parse → RawRow[]
      xlsx.ts           SheetJS → RawRow[]
      validate.ts       RawRow[] → { validRows, issues[] } (never coerces)
      apply.ts          validRows → ProjectPatch
    templates.ts        template headers (files live in public/templates/)
    persistence.ts      IndexedDB (off by default), clearAll()
    anonymise.ts        stable member → code mapping (pure)
  engine/               pure TypeScript; imports only graphology* and d3-array
    worker.ts           Web Worker entry; message router (section 1.2)
    input.ts            AnalysisInput builder: project + settings → dense tensors
    aggregate.ts        directed / symmetrised (mean | min | max), reciprocity
    rescale.ts          per-layer 0–1 rescaling, signed split (+ / −)
    composite.ts        weights, signed-layer treatments, formula string
    graphs.ts           build graphology graphs from edge tensors
    metrics/
      node.ts           strength, degree, betweenness, harmonic, eigenvector,
                        constraint, effective size, clustering
      network.ts        density, reciprocity, clustering, components,
                        Louvain + modularity, centralisation, E-I, cross-group density
      signed.ts         in-valence (+ / −), structural balance triads
      multiplex.ts      per-pair layer overlap, formal–informal classes
      resilience.ts     removal simulation
      coverage.ts       response rates, threshold flag
      bootstrap.ts      node-dropping rank intervals
    insights.ts         rule evaluation → structured Observation[] (no prose)
    rng.ts              seeded PRNG (shared by Louvain, bootstrap, demo)
  ui/
    state/              Zustand store (section 1.3)
    engineClient.ts     typed wrapper around the worker (the only UI→engine seam)
    copy/               all user-facing strings, metric explanations, insight wording
    map/                layout (d3-force), canvas renderer, SVG serialiser, hit-testing
    views/              workspace, matrix, table, layer comparison, presentation
    components/         controls, panels, dialogs
  styles/               tokens.css (generated from docs/design-system.md values), global.css
  demo/                 committed output of scripts/generate-demo.ts
scripts/
  generate-demo.ts      seeded generator
  networkx_fixtures.py  writes tests/fixtures/*.json
```

Dependency rule, enforced by an ESLint `no-restricted-imports` rule in Phase 1: `engine` may not import from `ui` or `data/persistence`; `data` may not import from `ui` or `engine`; `ui` reaches the engine only through `ui/engineClient.ts`. `ui/state` is placed under `ui/` to stay within the spec's suggested structure.

**Proposed:** insight wording lives in `ui/copy/`, not the engine. The engine returns `{ ruleId, subjects, evidence, viewRef }`; the copy layer renders the neutral question. This keeps wording reviewable in one place and lets anonymisation apply at render time.

### 1.2 Worker interface

A small hand-written typed RPC over `postMessage` rather than Comlink: the message surface is five request types, and a hand-written union keeps cancellation and progress explicit without another dependency.

```ts
// engine/protocol.ts — shared by worker.ts and ui/engineClient.ts
export type RequestId = number;

export type EngineRequest =
  | { id: RequestId; kind: 'analyse';    input: AnalysisInput }
  | { id: RequestId; kind: 'resilience'; inputKey: string; removed: MemberId[] }
  | { id: RequestId; kind: 'bootstrap';  inputKey: string; opts: BootstrapOptions }
  | { id: RequestId; kind: 'path';       inputKey: string; from: MemberId; to: MemberId; layer: LayerRef }
  | { id: RequestId; kind: 'cancel';     target: RequestId };

export type EngineResponse =
  | { id: RequestId; kind: 'progress'; fraction: number; stage: string }
  | { id: RequestId; kind: 'analysis'; inputKey: string; result: AnalysisResult }
  | { id: RequestId; kind: 'resilience'; result: ResilienceResult }
  | { id: RequestId; kind: 'bootstrap'; result: BootstrapResult }
  | { id: RequestId; kind: 'path'; result: PathResult | null }
  | { id: RequestId; kind: 'cancelled' }
  | { id: RequestId; kind: 'error'; code: EngineErrorCode; message: string };

export interface AnalysisInput {
  inputKey: string;                 // hash of project revision + analysis settings
  memberIds: MemberId[];            // index i ↔ memberIds[i]
  groups: Record<AttributeKey, (string | null)[]>;  // per-member attribute values
  layers: EngineLayer[];            // enabled layers only, with scale + signed flag
  ratings: Float64Array[];          // one n×n row-major tensor per layer; NaN = not rated
  settings: AnalysisSettings;       // view, symmetrise rule, weights, treatments, seed
}

export interface AnalysisResult {
  inputKey: string;
  nodeMetrics: Record<LayerRef, NodeMetricTable>;   // columnar Float64Array, NaN = not defined
  networkMetrics: Record<LayerRef, NetworkMetrics>;
  signed: Record<LayerKey, SignedResult>;
  multiplex: MultiplexResult;
  coverage: CoverageResult;
  communities: Record<LayerRef, CommunityResult>;
  observations: Observation[];
  warnings: EngineWarning[];        // e.g. eigenvector undefined, coverage below threshold
  compositeFormula: string;         // plain-notation formula actually evaluated
}
```

Rules:
- **Null handling.** `null` exists only at the file and store boundary; `engine/input.ts` is the single place it becomes `NaN`, and a unit test asserts that a rated 0 and a missing rating produce different results for every metric that reads raw ratings (coverage, symmetrisation, composite).
- **Latest wins.** The client keeps the latest `id` per request kind and drops stale responses. A new `analyse` sends `cancel` for the previous one; long loops (bootstrap, resilience) check a cancellation flag between iterations.
- **Transfer.** Tensors and metric columns are sent as transferable `ArrayBuffer`s. At 250 members × 15 layers the ratings payload is about 7.5 MB, so transfer rather than structured clone.
- **Caching.** The worker keeps the last `AnalysisInput` and its graphs keyed by `inputKey`, so `resilience`, `bootstrap` and `path` reuse them.

### 1.3 State shape (Zustand)

```ts
interface AppState {
  project: Project;                 // section 2; the only persisted slice
  projectRevision: number;          // incremented on every data mutation
  importSession: ImportSession | null;   // parsed rows + ValidationReport awaiting confirmation

  analysis: {                       // serialised into saved views
    view: 'directed' | 'symmetrised';
    symmetrise: 'mean' | 'min' | 'max';
    activeLayer: LayerRef;          // a layer key, `${key}+`, `${key}-`, or 'composite'
    weights: Record<LayerKey, number>;          // raw slider values; normalised in engine
    signedTreatment: Record<LayerKey, 'positive' | 'filterNegative' | 'multiplier'>;
    preset: 'formal' | 'informal' | 'health' | 'custom';
    nodeSizeMetric: MetricKey;
    nodeFill: { kind: 'attribute'; key: AttributeKey } | { kind: 'community' };
  };

  results: {
    status: 'idle' | 'running' | 'ready' | 'error';
    progress: number;
    current: AnalysisResult | null;
    resilience: ResilienceResult | null;
    bootstrap: BootstrapResult | null;
  };

  map: {                            // serialised into saved views
    layout: 'force' | 'grouped' | 'circular' | 'hierarchy';
    groupBy: AttributeKey | null;
    positions: Record<MemberId, { x: number; y: number; pinned: boolean }>;
    viewport: { x: number; y: number; k: number };
    threshold: number;              // 0–1 on the active layer's rescaled weight
    layerToggles: Record<LayerKey, boolean>;
    filters: AttributeFilter[];
    egoView: { member: MemberId; depth: 1 | 2 } | null;
    path: { from: MemberId; to: MemberId } | null;
  };

  selection: {                      // shared by every linked view
    members: MemberId[];
    hovered: MemberId | null;
    focused: MemberId | null;       // keyboard focus on the map
  };

  ui: {
    mode: 'analyst' | 'presentation';
    secondaryView: 'matrix' | 'table' | 'compare' | null;
    rightPanel: 'member' | 'insights' | 'coverage';
    anonymise: boolean;
    excludeSignedFromExports: boolean;
    persistence: 'off' | 'on';
    firstRunNoticeSeen: boolean;
    presentation: { viewIds: ViewId[]; index: number } | null;
  };
}
```

Derived values (filtered edge lists, display names after anonymisation, legend entries) are memoised selectors, not stored.

### 1.4 Data flow: import to render

```
CSV / XLSX file
  → data/import/csv|xlsx          parse to RawRow[] with source row numbers
  → data/import/validate          issues[]: unknown id, self-rating, out of range,
                                  duplicate, unknown variable, non-numeric (row numbers kept)
  → ui: validation report         user chooses "Import valid rows"; report states skipped count
  → data/import/apply             ProjectPatch → store.project, projectRevision++
  → (optional) data/persistence   debounced IndexedDB write when persistence is on
  → ui/engineClient               builds AnalysisInput (inputKey = hash(revision, analysis))
  → worker: engine/input          null → NaN, dense tensors
            engine/aggregate      directed or symmetrised edges; reciprocity from directed data
            engine/rescale        each layer to 0–1; signed layers split into + and −
            engine/composite      weighted sum with signed treatments; formula string
            engine/graphs         graphology graphs per LayerRef (+ distance = 1/w)
            engine/metrics/*      node, network, signed, multiplex, coverage
            engine/insights       Observation[]
  → store.results                 AnalysisResult
  → ui/map/layout                 d3-force on the main thread (for drag), attraction ∝ composite
                                  or selected layer; interpolates old → new positions
  → ui/map/renderer               canvas for interaction; SVG serialiser for export
  → legend, panels, matrix, table read the same result + selection
```

Map filtering (threshold, attribute filters, layer toggles) is applied by selectors on the main thread and does not change metric values unless the owner decides otherwise (Q6).

---

## 2. Project file schema (`.ona.json`)

```ts
export const SCHEMA_VERSION = 1 as const;

type MemberId = string;       // user-supplied, unique, stable across imports
type LayerKey = string;       // e.g. 'connection_strength'
type AttributeKey = string;   // e.g. 'team'
type ViewId = string;
type ISODateTime = string;

export interface ProjectFile {
  schema_version: 1;
  app: { name: 'Graticule'; version: string };   // writer version, informational
  meta: {
    title: string;
    created_at: ISODateTime;
    modified_at: ISODateTime;
    notes: string;
  };
  attribute_definitions: AttributeDefinition[];
  members: Member[];
  layers: LayerDefinition[];
  ties: Tie[];
  saved_views: SavedView[];
  settings: ProjectSettings;
}

export interface AttributeDefinition {
  key: AttributeKey;
  label: string;
  type: 'categorical' | 'ordinal' | 'member_ref';   // member_ref: formal manager id
  categories?: string[];                            // ordered for ordinal
  builtin: boolean;       // team, level, location, tenure_band, manager_id
}

export interface Member {
  id: MemberId;
  display_name: string;
  attributes: Record<AttributeKey, string | null>;  // null = not recorded
}

export interface LayerDefinition {
  key: LayerKey;
  label: string;
  question_wording: string;
  scale_type: 'strength' | 'frequency' | 'signed' | 'categorical';
  min: number;                   // ignored for categorical
  max: number;
  signed: boolean;
  default_weight: number;
  enabled: boolean;
  scale_labels?: Record<number, string>;   // e.g. { 0: 'Never', 5: 'Daily' }
  categories?: string[];         // Primary channel: ['in_person','video','chat','email']
  group?: string;                // Conflict sub-layers share group 'conflict'
  role?: 'formal' | 'informal';  // marks the pair used by the formal–informal comparison
  builtin: boolean;
}

export interface Tie {
  rater_id: MemberId;
  ratee_id: MemberId;
  variable: LayerKey;
  value: number | string | null; // number for scaled layers, string for categorical;
                                 // null = explicitly not rated (see Q1)
  wave: number;                  // default 1
}
// A (rater, ratee, variable, wave) key absent from `ties` is also "not rated".
// The key is unique; duplicates are a load error, never merged.

export interface SavedView {
  id: ViewId;
  name: string;
  caption: string;
  created_at: ISODateTime;
  analysis: AppState['analysis'];
  map: Omit<AppState['map'], 'viewport'> & { viewport: AppState['map']['viewport'] };
  selection: MemberId[];
}

export interface ProjectSettings {
  coverage_threshold: number;    // default 0.8
  anonymise: boolean;
  exclude_signed_from_exports: boolean;
  random_seed: number;           // Louvain and bootstrap
  bootstrap: { replicates: number; drop_fraction: number };
  anonymisation_scheme: 'role_team';
}
```

Migration: `migrations.ts` exports `migrate(file: unknown): ProjectFile`. It reads `schema_version`; if greater than `SCHEMA_VERSION` it throws `"This file was saved by a newer version of Graticule (schema N). Update Graticule to open it."`; if lower it applies each step in order. Every migration step ships with a fixture file and a round-trip test.

---

## 3. Metric definitions

Notation: n members; `w_ij ∈ (0,1]` the rescaled weight of the tie i→j on the active layer (absent if the rating is 0 or missing); `a_ij = 1` if a tie exists; `d_ij` the shortest-path distance with edge length `1/w`; N(i) the neighbours of i in either direction.

**Proposed conventions that apply to every metric:**
- **Tie existence.** A tie exists when the rating is greater than the layer minimum for unsigned layers (0 = "no connection" or "never"), and when it is non-zero for each signed sub-layer. A 0 is a rated non-tie; `NaN` is missing. Missing ratings do not create ties and are counted in coverage.
- **Weights.** Every layer is rescaled to 0–1 before any metric, `r(v) = (v − min) / (max − min)`, so per-layer metrics and the composite share one scale (spec §7 requires this for the composite; applying it everywhere keeps per-layer and composite values comparable). The fixture script applies the same rescaling.
- **Signed layers.** `w⁺ = max(v, 0) / max`, `w⁻ = max(−v, 0) / |min|`. Path-based metrics receive only non-negative magnitudes.
- **Directed view.** Graph is directed. **Symmetrised view:** undirected, `w_ij = f(w_ij, w_ji)` with f ∈ {mean, min, max} (missing-direction rule: Q3).
- **Undefined values** are `NaN` in the engine and shown as "Not defined" with the reason, never as 0.

### 3.1 Tie aggregation and reciprocity

| | Definition / formula | Library | NetworkX divergence |
|---|---|---|---|
| Symmetrisation | `w_ij = w_ji = f(w_ij, w_ji)`, f = mean / min / max | custom (`aggregate.ts`) | NetworkX `to_undirected()` keeps one arbitrary direction's attributes; fixtures build the symmetrised graph explicitly in Python |
| Reciprocity | `R = |{(i,j) ∈ E : (j,i) ∈ E}| / |E|` on the directed tie set, reported in both views | custom | Matches `nx.overall_reciprocity`. **Proposed:** also report dyad reciprocity `mutual dyads / (mutual + asymmetric dyads)`, which is labelled separately because it differs numerically |

### 3.2 Node metrics (per layer, per signed sub-layer, and composite)

| Metric | Definition | Formula | Normalisation | Library | Divergence from NetworkX |
|---|---|---|---|---|---|
| In-strength / out-strength | Sum of incoming / outgoing tie weights | `s_i^in = Σ_j w_ji`, `s_i^out = Σ_j w_ij` | None (raw, on 0–1 weights); symmetrised view reports strength `Σ_j w_ij` | graphology-metrics `weightedInDegree`, `weightedOutDegree`, `weightedDegree` | None. Matches `G.in_degree(weight=)` |
| Degree | Number of ties | `k_i^in = Σ_j a_ji`, `k_i^out = Σ_j a_ij`, symmetrised `k_i = |N(i)|` | Raw counts shown; normalised `k/(n−1)` stored for fixtures | graphology `inDegree`, `outDegree`, `degree` | NetworkX `degree_centrality` on a directed graph returns `(k^in + k^out)/(n−1)`, which can exceed 1. We report in and out separately and never that sum |
| Betweenness | Share of shortest paths between other pairs that pass through i | `B_i = Σ_{s≠i≠t} σ_st(i)/σ_st`, lengths `1/w` | Directed: `× 1/((n−1)(n−2))`; undirected: same factor applied to the double-counted Brandes sum, i.e. equivalent to `2/((n−1)(n−2))` over unordered pairs | graphology-metrics `betweennessCentrality(g, { getEdgeWeight: 'distance', normalized: true })` | **None, verified:** max absolute difference ≤ 6×10⁻¹⁷ against `nx.betweenness_centrality(weight='distance', normalized=True)` in both directed and undirected cases. Documented because this is the usual point of divergence between libraries (the spec's example). Caveat: equal-length paths are detected by floating-point equality in both libraries; sums of `1/w` can differ in the last bit, so σ counts may differ on ties. Mitigation in Q12 |
| Harmonic closeness | How easily others reach i, tolerating disconnection | `H_i = (1/(n−1)) Σ_{j≠i} 1/d_ji`, with `1/∞ = 0` | Divided by (n−1) → [0, max w]; with 0–1 weights, H ≤ 1 | custom, using graphology-shortest-path `dijkstra.singleSource` per source. graphology-metrics `closenessCentrality` is unweighted (BFS) and is not harmonic, so it is not used | NetworkX `harmonic_centrality` returns the unnormalised sum; fixtures divide by (n−1). Direction: NetworkX sums `1/d(j→i)` (incoming), verified on a 3-node chain; we follow it (Q7) |
| Eigenvector centrality | i is central if connected to central members | Principal eigenvector: `λx_i = Σ_j w_ji x_j`, power iteration on `(A + I)ᵀ`, L2-normalised | ‖x‖₂ = 1 | graphology-metrics `eigenvectorCentrality(g, { getEdgeWeight: 'weight', maxIterations: 1000, tolerance: 1e-10 })` | **None, verified:** max difference ≤ 1.2×10⁻¹⁶ against `nx.eigenvector_centrality` (directed and undirected). "Where defined": NetworkX returns values for a directed graph with two strongly connected components without complaint; we do not. **Proposed:** defined only if the view graph is connected (undirected) or strongly connected (directed) and iteration converges; otherwise shown as not defined with the reason (Q8). graphology throws on non-convergence; the engine catches it |
| Burt's constraint | How much i's contacts are themselves connected (redundancy of i's network) | `p_ij = (w_ij + w_ji) / Σ_{k∈N(i)} (w_ik + w_ki)`; `c_i = Σ_{j∈N(i)} (p_ij + Σ_{q∈N(i), q≠i,j} p_iq p_qj)²` | None (range ≈ 0–1.125) | custom (none in graphology) | None intended: follows `nx.constraint(weight=)` including directed graphs (neighbours in either direction). Isolates → not defined (NetworkX gives NaN) |
| Effective size | Number of non-redundant contacts | `ES_i = Σ_{j∈N(i)} (1 − Σ_{q∈N(i), q≠j} p_iq m_jq)`, `m_jq = (w_jq + w_qj) / max_k (w_jk + w_kj)` | None | custom | Follows `nx.effective_size(weight=)`. Note: NetworkX switches to Borgatti's simplification `n − 2t/n` for unweighted undirected graphs, which is algebraically equal there; we always use the general formula and the fixture test covers both |
| Local clustering | Proportion of i's neighbours that are connected to each other, weighted | Undirected (Onnela): `C_i = (1/(k_i(k_i−1))) Σ_{j,h} (ŵ_ij ŵ_ih ŵ_jh)^{1/3}`, `ŵ = w / max(w)`. Directed (Fagiolo): `C_i = [(Ŵ^{1/3} + (Ŵᵀ)^{1/3})³]_ii / (2[k_i^tot(k_i^tot − 1) − 2k_i^↔])` | 0–1 | custom | Follows `nx.clustering(weight=)`. Caveat for the method notes: `ŵ` is divided by the **graph-wide** maximum weight, so one strong tie elsewhere changes every member's value. Nodes with k < 2 → 0 (NetworkX convention), labelled "fewer than two contacts" |

### 3.3 Network metrics

| Metric | Formula | Normalisation | Library | Divergence |
|---|---|---|---|---|
| Density | Directed `m / (n(n−1))`; undirected `2m / (n(n−1))`, binary ties | 0–1 | graphology-metrics `density` | None, verified (equal to 17 significant figures) |
| Reciprocity | See 3.1 | | | |
| Average clustering | `(1/n) Σ_i C_i` including zeros | | custom | Matches `nx.average_clustering(weight=, count_zeros=True)` |
| Components | Directed: weak and strong; undirected: connected. Report count and sizes | | graphology-components `connectedComponents`, `stronglyConnectedComponents` | None |
| Communities and modularity | Louvain maximising `Q = (1/m) Σ_ij [w_ij − γ s_i^out s_j^in / m] δ(c_i, c_j)` (directed form; undirected uses `2m`), γ = 1 | | graphology-communities-louvain with seeded `rng`; graphology-metrics `modularity` | Modularity of a fixed partition: **none, verified** (0.23004468059413116 in both, directed weighted). Louvain partitions are order-dependent and will not match NetworkX's partition. **Proposed test:** exact match of modularity for a fixed partition; Louvain's modularity ≥ NetworkX's − 0.02 on the same graph. Proposed default: communities on the symmetrised composite (Q9) |
| Centralisation | Freeman: `C = Σ_i (c_max − c_i) / max_G Σ_i (c_max − c_i)` | Denominator is the star-graph maximum | custom; NetworkX has no centralisation function, so the fixture script computes it from NetworkX centralities | Only defined here for binary degree (in, out, total) and binary betweenness, where the theoretical maximum is established. Weighted variants: Q10 |
| E-I index | `EI = (E − I)/(E + I)`, E = ties between groups, I = ties within groups, for any attribute; also per group | −1 (all internal) to +1 (all external) | custom (NetworkX has none; fixture script computes it) | Krackhardt & Stern (1988). Members with a null attribute are excluded and counted |
| Cross-group density | `D_AB = e_AB / (|A||B|)` for A ≠ B (directed), `D_AA = e_AA / (|A|(|A|−1))` | 0–1 | custom | Shown as a group × group heat matrix |

### 3.4 Signed layers (valence, energy; conflict is unsigned frequency and is excluded here)

| Metric | Formula | Library | Notes |
|---|---|---|---|
| Positive / negative in-valence | `V_i^+ = Σ_j w⁺_ji`, `V_i^- = Σ_j w⁻_ji`; also counts of raters | custom | Reported side by side; never netted into one score (a net score would read as an evaluation of the person, spec §2) |
| Sub-layer metrics | All node metrics on the + sub-layer. **Proposed:** only non-path metrics (strength, degree, clustering) on the − sub-layer, because shortest paths through negative ties have no clear social meaning (Q11) | as 3.2 | |
| Structural balance | On the symmetrised signed graph, each closed triad with all three dyads signed is balanced if the product of signs is positive (+++, +−−), else unbalanced (++−, −−−). Report counts and the balance ratio | custom; NetworkX has no triad-sign function, fixture script counts directly | Dyad sign when the two directions disagree: Q4 |

### 3.5 Multiplexity

- **Per-pair overlap:** for each dyad, the set of enabled layers in which a tie exists, and `|set|`. Network-level: Jaccard overlap between each pair of layers' tie sets, `J = |E_a ∩ E_b| / |E_a ∪ E_b|`. Custom; fixtures computed with Python sets.
- **Formal–informal comparison:** per directed pair (or per dyad in the symmetrised view): formal-only, informal-only, both, neither; pairs with either rating missing are "not classified" and counted. Custom.

### 3.6 Resilience

Remove set S; recompute on the induced subgraph of the remaining members (the active layer or composite, current view):
- components (count, largest size);
- reachability `R = |{(u,v): u≠v, d_uv < ∞}| / (n'(n'−1))`;
- average path length over reachable pairs only, `L = mean d_uv`, reported for weighted distance (1/w) and for hops.

Divergence: `nx.average_shortest_path_length` raises on a disconnected graph; ours averages over reachable pairs and states that it does so. Fixtures compute the same quantity in Python explicitly.

### 3.7 Data coverage

`coverage_i = |{(j, l): rating_{i,j,l} not missing}| / ((n−1) × L_enabled)`; overall coverage is the same ratio over all raters. Categorical layers count. A persistent warning appears when overall coverage < threshold (default 0.8). Custom.

### 3.8 Stability (optional)

Node-dropping bootstrap: for b = 1…B (default 200), drop a random ⌊p·n⌋ members (default p = 0.1), recompute the chosen metric on the induced subgraph, convert each retained member's value to a percentile rank among retained members. Report the 2.5th–97.5th percentile interval of each member's rank, as an interval (spec §6). Seeded PRNG, runs in the worker with progress and cancellation. Custom. No NetworkX counterpart; tested by determinism (same seed, same output) and by a sanity case (a star graph's centre always ranks first).

### 3.9 Composite (spec §7)

`C_ij = Σ_{l ∈ L_sum} ω_l · r_l(v_ijl)`, with `ω_l = W_l / Σ_{k ∈ L_sum} W_k` so the weights shown sum to 1. Signed layers:
- **Positive only:** `r_l = w⁺` is included in the sum.
- **Filter out negative ties:** the layer is not in the sum; `C_ij = 0` (no tie) where `v_ijl < 0`.
- **Multiplier:** the layer is not in the sum; `C_ij ← C_ij · m(v_ijl)`. The form of m is Q5.

The formula shown beneath the sliders is produced by `composite.ts` from the same data structure that computes C, so the two cannot diverge. Missing-value rule: Q2.

### 3.10 Correctness testing

- `scripts/networkx_fixtures.py` (pinned NetworkX version recorded in each fixture) reads the committed demo project and a karate-club project, applies the same rescaling and 1/w distances, and writes `tests/fixtures/{demo,karate}.{directed,symmetrised-mean}.json`.
- Tolerances: 1×10⁻⁹ absolute for closed-form and exact path metrics; 1×10⁻⁶ for eigenvector centrality; fixed-partition modularity 1×10⁻⁹; Louvain as in 3.3.
- Metrics with no NetworkX function (centralisation, E-I, cross-group density, balance, multiplexity, resilience) are computed in the fixture script from NetworkX primitives or plain Python, and the script says so in each fixture's `source` field.

---

## 4. Other technical decisions (proposed)

| Topic | Proposal | Reason |
|---|---|---|
| Map rendering | Canvas from the start, SVG serialiser for export only | 10,000 edges as SVG elements is a known bottleneck; building one renderer avoids a mid-project switch |
| Layout | d3-force on the main thread, with the worker supplying weights | Dragging and pinning need synchronous position updates; 250 nodes with Barnes–Hut is well within budget |
| PDF export | Not in the spec's stack. Candidates: pdf-lib (MIT) or jsPDF (MIT). Decision deferred to Phase 7 and recorded in CLAUDE.md (Q14) | |
| XLSX | SheetJS Community Edition. Current releases are distributed from `cdn.sheetjs.com` rather than the npm registry, whose `xlsx` package is older; the install source must be pinned by URL and integrity hash (Q15) | |
| Routing | No router; presentation mode and dialogs are state, not routes | Spec §13 |
| CSP | `default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`. To verify in Phase 1 that the Vite build emits no inline scripts or styles | `blob:` is needed for export downloads and possibly the worker |
| Randomness | One seeded PRNG module shared by demo generator, Louvain and bootstrap | Reproducible results for the same file |

---

## 5. Risks

1. **Eigenvector and closeness on sparse or fragmented layers.** Optional layers will often be disconnected; many cells will read "not defined". Needs clear explanation rather than silent zeros.
2. **Float tie-breaking in shortest paths** (see betweenness). Could cause fixture mismatches at 10⁻² scale on specific nodes, not just at 10⁻¹⁶.
3. **Louvain instability.** Partitions vary with node order and seed; community colours could change between sessions. Mitigation: seeded RNG stored in the project; saved views store the partition they showed.
4. **Performance.** Weighted Brandes betweenness is O(nm + n² log n); ×15 layers ×(1 + sub-layers) on every weight-slider change is the heaviest path. Mitigation: per-layer results cached by layer content hash; only the composite recomputes on slider moves; composite metric recomputation debounced (~150 ms) while positions interpolate.
5. **Matrix entry at 250 members.** 62,250 cells per layer requires a virtualised grid; paste of a full 250×250 block must be validated like an import.
6. **Composite semantics** (Q2, Q5) directly affect every ranking; a wrong choice would be visible in the boardroom.
7. **Anonymisation leakage.** Role/team codes can re-identify people in small teams (a team of one). Proposal: warn when any code maps to a group of fewer than 3 members (Q13).
8. **CSP versus tooling.** Vite dev server and some libraries inject inline styles or use `eval`; the production CSP may break SheetJS or PDF generation. Verify early (Phase 1 shell).
9. **SheetJS supply chain** (section 4).
10. **Data protection.** The first-run notice is advisory; the tool cannot enforce consent. The README and notice must not overstate what the CSP guarantees (it blocks network requests from the page; it does not stop a user from emailing an export).
11. **Presentation on unknown projectors.** Colour rendering and contrast vary; the palette was checked by simulation, not on hardware.

---

## 6. Questions for the owner

Each has a proposed default that I will use if you approve the plan without comment.

**Q1. Two kinds of "not rated".** Should the file distinguish "declined to rate" (explicit `null` tie) from "not yet entered" (absent)? *Default:* both are stored and both count as missing in every metric; only the coverage view shows the difference.

**Q2. Composite with partial ratings.** If a pair is rated on some layers of the composite but not others, is the composite value missing, or computed from the rated layers with weights renormalised over them? *Default:* renormalise over rated layers; missing only if no included layer is rated; the coverage view reports how many composite ties rely on partial data.

**Q3. Symmetrising with one direction missing.** If A rated B and B did not rate A: use A's rating alone, or treat the dyad as missing? *Default:* use the available direction and count such dyads in a coverage note. (Mean, min and max coincide in that case.)

**Q4. Signed dyads that disagree.** For structural balance on the symmetrised graph, when A→B is positive and B→A negative, what is the dyad's sign? *Default:* follow the chosen symmetrisation rule (mean → sign of the mean, 0 = unsigned and excluded; min → negative; max → positive).

**Q5. Multiplier treatment.** Which mapping from a signed rating to the multiplier? (a) `m = (v − min)/(max − min)`, so neutral halves the composite and −3 zeroes it; (b) `m = 1 + α·v/max` with α = 0.5, so neutral leaves it unchanged and the range is 0.5–1.5, then clipped to 1. *Default:* (b), because a neutral relationship should not weaken a tie.

**Q6. Threshold slider scope.** Does the tie-strength threshold only hide edges on the map, or also remove ties before metrics are computed? *Default:* display only; metrics always use all ties, and the legend states the threshold.

**Q7. Closeness direction.** In the directed view, harmonic closeness can measure how easily others reach a member (incoming, NetworkX convention) or how easily a member reaches others (outgoing). *Default:* incoming, labelled "Reachability from others"; outgoing available in the metrics table.

**Q8. Eigenvector where undefined.** When the view graph is not (strongly) connected, show "not defined" for everyone, or compute within the largest (strongly) connected component and mark the rest "not defined"? *Default:* the latter, with the component stated in the member panel.

**Q9. Community detection input.** Detect communities on the symmetrised composite, or on whichever layer and view is active? *Default:* active layer, symmetrised (Louvain on directed data is supported but less familiar to the audience).

**Q10. Centralisation scope.** Freeman centralisation has a standard maximum only for binary degree, betweenness and closeness. Report it for those only, or add a normalised dispersion (e.g. Gini) for weighted metrics? *Default:* binary degree and betweenness only.

**Q11. Metrics on negative sub-layers.** Compute path-based metrics (betweenness, closeness, eigenvector) on the negative sub-layers of valence and energy? *Default:* no; strength, degree and clustering only.

**Q12. Path-length rounding.** To make equal-length paths compare equal, round distances to 12 significant figures before comparison in both the engine and the fixture script? *Default:* yes, if a fixture mismatch appears in Phase 3; not before.

**Q13. Anonymisation codes.** Format and small-group handling. *Default:* `<team abbreviation>-<level>-<nn>` (for example "FIN-L3-02"), stable per project, with a warning when a code's team–level group has fewer than 3 members.

**Q14. PDF library.** pdf-lib or jsPDF, or another? *Default:* decide in Phase 7 on output quality and bundle size, recorded in CLAUDE.md.

**Q15. SheetJS distribution.** Accept installing SheetJS from `cdn.sheetjs.com` with a pinned integrity hash, or restrict XLSX support to a library on the npm registry? *Default:* SheetJS from its CDN tarball, pinned.

**Q16. Layout transition duration.** Spec §12 limits UI transitions to 250 ms. Is the node-position interpolation after a weight change a UI transition? At 250 ms it is too fast to follow what moved. *Default:* treat it as a data transition at 600 ms, skippable, and 0 ms under `prefers-reduced-motion`.

**Q17. Status colour.** The six base colours contain no warning or error hue (see design-system.md §1). Accept status shown by icon and wording only, or add one restrained warning hue? *Default:* icon and wording only.

**Q18. Branch name.** You asked for a branch named `phase-0`; this session is configured to push to `claude/phase-0-planning-design-htojcv`. The work is committed on a local `phase-0` branch and pushed to the configured remote branch. Should I also push `phase-0` to the remote?
