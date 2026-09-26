# Graticule — Phase 0 plan

Status: proposal. Nothing here is binding until the owner approves it.
Source of truth: `spec.md`. Where this document and the spec disagree, the spec wins and the
disagreement is a defect in this document.

---

## 1. Architecture

### 1.1 Module boundaries

Five layers. Dependencies point downwards only; there are no upward or sideways imports.

```
  ui/            React components, map renderer, panels, exports
     |  reads state, dispatches intents
  state/         Zustand store: project, params, results, selection, view
     |  posts jobs
  worker/        single Web Worker host: job queue, cancellation, transfer
     |  calls
  engine/        pure TypeScript analysis. No DOM, no React, no worker globals
     |  imports types only
  data/          schema, validation, import, migration, persistence, project I/O
```

Enforced rules (ESLint `no-restricted-imports`, checked in CI from Phase 1):

| Module | May import | May not import |
|---|---|---|
| `engine/` | `data/schema` **types only** (`import type`), graph libraries | anything in `ui/`, `state/`, `worker/`; any DOM or worker global |
| `data/` | parsers, schema validator | `ui/`, `state/`, `engine/` runtime |
| `worker/` | `engine/`, `data/schema` types | `ui/`, `state/` |
| `state/` | `data/`, `worker/` client, `engine/` types | `ui/` |
| `ui/` | everything below | — |

`engine/` is the module the fixture tests exercise directly, in Node, with no browser
environment. That is the reason for the hard no-DOM rule: if the engine can only run in a
browser, the NetworkX fixture comparison in section 6 of the spec becomes untestable in CI.

Internal shape of `engine/`:

```
engine/
  graph/        build graphology instances from a project snapshot; layer views
  aggregate/    direction handling, symmetrisation, per-layer rescale, composite
  metrics/
    node.ts     strength, degree, betweenness, harmonic, eigenvector, constraint,
                effective size, clustering
    network.ts  density, reciprocity, clustering, components, communities,
                centralisation, E-I, cross-group density
    signed.ts   positive/negative split, in-valence, structural balance
  multiplex/    per-pair overlap, formal vs informal classification
  resilience/   node removal, components, reachability, path length
  coverage/     response rates, threshold evaluation
  stability/    node-dropping bootstrap
  insights/     rule evaluation (rules are data; the evaluator is pure)
  index.ts      the only public surface the worker imports
```

Insights live in `engine/`, not `ui/`, because each insight must carry the rule that produced
it (spec §9). Making the rule a serialisable object evaluated by a pure function is what lets
the panel show the rule, and lets the rule be unit-tested.

### 1.2 Worker interface

One worker, one job queue. The project is uploaded once and cached inside the worker; after
that, only parameters cross the boundary. Without this, every slider drag would re-serialise
250 members and 10,000 ties.

```ts
// worker/protocol.ts — shared by main thread and worker, no implementation
export type JobId = string;

export type EngineRequest =
  | { id: JobId; kind: 'loadProject';   payload: ProjectSnapshot }
  | { id: JobId; kind: 'analyse';       payload: AnalysisParams }
  | { id: JobId; kind: 'composite';     payload: CompositeParams }
  | { id: JobId; kind: 'resilience';    payload: { remove: MemberId[]; params: AnalysisParams } }
  | { id: JobId; kind: 'shortestPath';  payload: { from: MemberId; to: MemberId; params: AnalysisParams } }
  | { id: JobId; kind: 'subgroup';      payload: { members: MemberId[]; params: AnalysisParams } }
  | { id: JobId; kind: 'stability';     payload: BootstrapParams }
  | { id: JobId; kind: 'cancel';        payload: { target: JobId } };

export type EngineResponse =
  | { id: JobId; kind: 'progress'; phase: string; done: number; total: number }
  | { id: JobId; kind: 'result';   payload: unknown }   // narrowed per request kind
  | { id: JobId; kind: 'error';    payload: EngineError }
  | { id: JobId; kind: 'cancelled' };

export interface EngineError {
  code: 'BAD_PROJECT' | 'NO_PROJECT' | 'NOT_CONVERGED' | 'OUT_OF_MEMORY' | 'INTERNAL';
  message: string;          // user-facing: what went wrong and how to fix it
  detail?: string;          // developer-facing, shown behind a disclosure
  metric?: MetricKey;       // set when one metric failed but others succeeded
}
```

Design constraints this protocol has to satisfy:

- **Results are index-keyed, not id-keyed.** Every response carries `order: MemberId[]` once,
  and each metric as a `Float64Array` in that order. Those arrays are `postMessage`
  transferables, so a full metric set for 250 members moves with no structured-clone cost.
  A `Record<MemberId, number>` would allocate 250 objects per metric per recompute.
- **Superseded jobs are dropped, not queued.** Weight sliders emit at pointer rate. The client
  debounces at 80 ms and tags composite jobs with a monotonic generation; when a newer
  `composite` job arrives, the worker abandons any older one at its next chunk boundary.
- **Cancellation is cooperative.** A worker cannot be pre-empted mid-call, so the long loops
  (betweenness, bootstrap, all-pairs reachability) are written as chunked iterators that check
  a cancelled-set every N source nodes and emit `progress`. Anything that cannot be chunked
  must be fast enough not to need it, and that is a review criterion.
- **Partial failure is reportable.** Eigenvector centrality can fail to converge. One metric
  failing must not void the whole response, hence `EngineError.metric`.
- **A fatal worker error restarts the worker and replays `loadProject`.** The main thread keeps
  the last snapshot for exactly this reason. There is no synchronous fallback path; the UI shows
  an error state with a retry action instead of silently freezing the tab.

### 1.3 State shape

Zustand, one store, sliced. The store holds the project, the parameters, and the last results.
It holds nothing that can be derived, with one deliberate exception noted below.

```ts
interface AppState {
  // ---- the serialisable truth -------------------------------------------------
  project: ProjectFile | null;
  projectRevision: number;          // bumped on every mutation; jobs carry it
  dirty: boolean;                   // unsaved changes exist

  // ---- analysis parameters (part of a saved view) -----------------------------
  params: {
    direction: 'directed' | 'symmetrised';
    symmetrise: 'mean' | 'min' | 'max';
    activeLayers: LayerKey[];
    weights: Record<LayerKey, number>;       // raw; normalised to sum 1 on read
    signedTreatment: Record<LayerKey, 'positiveOnly' | 'dropNegative' | 'multiplier'>;
    threshold: number;                       // tie-strength cut for display
    coverageThreshold: number;               // default 0.8
  };

  // ---- worker output ----------------------------------------------------------
  results: {
    status: 'empty' | 'computing' | 'ready' | 'stale' | 'error';
    forRevision: number | null;              // results are stale if != projectRevision
    order: MemberId[];
    node: Record<MetricKey, Float64Array>;
    network: NetworkMetrics | null;
    communities: Int32Array | null;
    insights: Insight[];
    error: EngineError | null;
  };

  // ---- selection, shared by every linked view ---------------------------------
  selection: {
    hovered: MemberId | null;
    selected: MemberId[];
    egoRoot: MemberId | null;
    egoDepth: 1 | 2;
    path: { from: MemberId; to: MemberId } | null;
    removed: MemberId[];                     // resilience simulation
  };

  // ---- view -------------------------------------------------------------------
  view: {
    layout: 'force' | 'grouped' | 'circular' | 'hierarchy';
    groupBy: AttributeKey | null;
    colourBy: AttributeKey | 'community' | null;
    sizeBy: MetricKey;
    transform: { x: number; y: number; k: number };
    pinned: Record<MemberId, { x: number; y: number }>;
    secondary: 'none' | 'matrix' | 'table' | 'compare';
  };

  // ---- session ----------------------------------------------------------------
  session: {
    mode: 'analyst' | 'presenter';
    anonymised: boolean;
    excludeSignedFromExports: boolean;
    persistence: 'off' | 'on';
    presentation: { active: boolean; viewIndex: number } | null;
    noticeAcknowledged: boolean;
  };
}
```

Two decisions worth stating because they are easy to get wrong later:

1. **Live node positions are not in the store.** The force simulation writes into a
   `Float32Array` owned by the renderer. Putting 250 positions into Zustand at 60 fps would
   re-render every subscriber sixty times a second. Positions enter the store only when the
   user pins a node or saves a view. `view.pinned` is therefore sparse, and a saved view
   snapshots the full position array at save time.
2. **`results.forRevision` makes staleness explicit.** When the project or the params change,
   results become `stale` rather than being cleared. The map keeps showing the previous numbers,
   greyed in the metrics table, while the new job runs. Blanking the screen on every slider
   nudge would make the weight panel unusable.

### 1.4 Data flow, import to render

```
 file (.csv / .xlsx)
   │  Papa Parse / SheetJS          data/import/
   ▼
 raw rows + 1-based source row numbers
   │  schema + domain checks        data/validate/
   ▼
 ValidationReport { accepted[], rejected[{row, code, message}], counts }
   │  user chooses "import valid rows"          (nothing is coerced)
   ▼
 normalise → ProjectFile.ties (sparse)          data/normalise/
   │  store.commit → projectRevision++
   ▼
 worker.loadProject(snapshot)                   worker/
   │  build per-layer graphs; pre-rescale each layer's edge array to 0–1
   ▼
 worker.analyse(params)
   │  aggregate → composite → node metrics → network metrics → signed → multiplex
   │  → coverage → insights
   ▼
 EngineResponse { order, Float64Arrays, network, communities, insights }   [transferred]
   │  store.results
   ▼
 selectors (memoised)  ──►  legend
   │                   ──►  metrics table / matrix / comparison
   ▼
 layout runner (d3-force, composite drives attraction)
   │  positions Float32Array
   ▼
 canvas renderer  ──►  quadtree hit-test  ──►  hover / click / lasso  ──► selection
   │
   ▼
 export boundary (anonymisation + signed-layer exclusion applied here, once)
   │
   ▼
 PNG / SVG / CSV / PDF
```

Three properties of this pipeline that the implementation must preserve:

- **Row provenance survives to the report.** Every rejected row carries its source row number
  from the parser to the screen. That is the whole point of the validation report.
- **Rescaling happens once, at `loadProject`.** A composite recompute is then a weighted sum
  over fixed `Float64Array`s — O(edges × layers) with no allocation, which is what makes the
  weight sliders feel live.
- **Anonymisation and signed-layer exclusion are applied at one boundary, not per exporter.**
  Every exporter takes an already-filtered view object. A new exporter therefore cannot forget
  to honour them.

---

## 2. Project file schema (TypeScript sketch)

Illustrative, not final. `zod` (or equivalent) schemas are derived from these types in Phase 2,
and the types are inferred back from the schemas so there is one definition, not two.

```ts
export type SchemaVersion = 1;
export type MemberId   = string;      // stable, opaque, never a display name
export type LayerKey    = string;
export type AttributeKey = string;
export type Wave = number;            // defaults to 1; reserved for multi-wave

export interface ProjectFile {
  schema_version: SchemaVersion;
  meta: {
    name: string;
    created_at: string;               // ISO 8601
    updated_at: string;
    app_version: string;
    notes?: string;
  };
  attributes: AttributeDef[];
  members: Member[];
  layers: LayerDef[];
  ties: Tie[];
  views: SavedView[];
  settings: ProjectSettings;
}

export interface AttributeDef {
  key: AttributeKey;
  label: string;                      // sentence case, user-facing
  type: 'categorical' | 'ordinal' | 'numeric' | 'member_ref';
  values?: string[];                  // categorical/ordinal domain, in display order
}

export interface Member {
  id: MemberId;
  display_name: string;
  attributes: Record<AttributeKey, string | number | null>;
  // default attribute keys: team, level, location, tenure_band, manager_id
  // manager_id is type 'member_ref' and may be null (no manager / top of tree)
}

export interface LayerDef {
  key: LayerKey;
  label: string;                      // "Connection strength"
  question_wording: string;
  scale_type: 'interval' | 'frequency' | 'categorical';
  min: number;                        // ignored when scale_type === 'categorical'
  max: number;
  signed: boolean;                    // true ⇒ min < 0 < max, 0 is the neutral point
  default_weight: number;             // 0–1, pre-normalisation
  enabled: boolean;
  categories?: string[];              // categorical layers only, e.g. primary channel
  group?: string;                     // e.g. 'conflict' for the two conflict sub-layers
}

export interface Tie {
  rater: MemberId;
  ratee: MemberId;                    // rater !== ratee; self-ties are rejected at import
  layer: LayerKey;
  value: number | string;             // string only for categorical layers
  wave: Wave;                         // defaults to 1
}
// Unrated pairs are ABSENT from `ties`. A stored value is always a real response.
// A value of 0 on a 0–5 layer means "rated, no meaningful connection" and is a
// response for coverage purposes, but contributes no edge to the graph.
// The matrix editor materialises a dense grid in which unrated cells are `null`;
// `null` is never written to the file.

export interface SavedView {
  id: string;
  name: string;
  caption: string;                    // shown in presentation mode
  params: AnalysisParams;             // direction, layers, weights, treatments, thresholds
  view: {
    layout: 'force' | 'grouped' | 'circular' | 'hierarchy';
    groupBy: AttributeKey | null;
    colourBy: AttributeKey | 'community' | null;
    sizeBy: MetricKey;
    transform: { x: number; y: number; k: number };
    positions: Record<MemberId, { x: number; y: number }>;
  };
  filters: {
    threshold: number;
    attributes: Record<AttributeKey, string[]>;
    search: string;
  };
  selection: { selected: MemberId[]; egoRoot: MemberId | null; egoDepth: 1 | 2 };
}

export interface ProjectSettings {
  coverage_threshold: number;          // default 0.8
  anonymise: boolean;
  exclude_signed_from_exports: boolean;
  persistence_enabled: boolean;        // IndexedDB, default false
  composite: CompositeParams;
  active_wave: Wave;                   // v1 always 1
}

export interface CompositeParams {
  weights: Record<LayerKey, number>;
  signedTreatment: Record<LayerKey, 'positiveOnly' | 'dropNegative' | 'multiplier'>;
  preset: 'formal' | 'informal' | 'relationship_health' | 'custom';
}

export interface AnalysisParams extends CompositeParams {
  direction: 'directed' | 'symmetrised';
  symmetrise: 'mean' | 'min' | 'max';
  activeLayers: LayerKey[];
  threshold: number;
  wave: Wave;
}
```

Migration contract:

```ts
type Migration = (input: unknown) => unknown;          // version N -> version N+1
const MIGRATIONS: Record<number, Migration> = { /* 1 -> 2, 2 -> 3, ... */ };

// load():
//   parse JSON
//   read schema_version
//   if version > CURRENT  -> refuse: "This project was saved by a newer version of
//                                     Graticule. Update the app, then open it again."
//   if version < CURRENT  -> apply MIGRATIONS[v], v+1, ... in order, validating after each
//   validate against the current schema; on failure refuse with the failing path
```

Every migration ships with a fixture of the old version and a test asserting the migrated
result validates and preserves tie counts. A version is never bumped without one.

---

## 3. Metrics

Conventions that apply throughout, stated once:

- **Weight is strength; distance is `1/w`.** Every path-based algorithm receives `1/w`, never
  `w`. NetworkX's `weight=` argument is a *distance*, so the fixture script passes the same
  reciprocal. The method notes state this in plain language.
- **`0` is not an edge.** A rated 0 counts as a response for coverage and produces no edge.
  An unrated pair counts as a non-response and produces no edge. These are never merged.
- **Negative weights never reach a path algorithm.** Signed layers are split first (§3.4).
- **Isolates.** Degree 0, strength 0, betweenness 0, harmonic closeness 0, clustering 0,
  constraint undefined (reported as blank, not 0), eigenvector as defined by the solver.
- **Reported precision.** Metrics are reported to 3 significant figures in the UI and exported
  at full double precision.

### 3.1 Node metrics

**In-strength**
- *Definition:* total weight of ties others direct at the member on the layer or composite.
- *Formula:* `s_in(i) = Σ_j w(j→i)`.
- *Normalisation:* raw; a normalised variant divides by `(n−1)·w_max` and is offered in the
  metrics table as "share of possible".
- *Library:* computed directly in `engine/metrics/node.ts` over the edge arrays.
- *Divergence:* none. Cross-checked against NetworkX `G.in_degree(weight='w')`.

**Out-strength**
- *Definition:* total weight of ties the member directs at others.
- *Formula:* `s_out(i) = Σ_j w(i→j)`.
- *Normalisation:* as above.
- *Library:* in-house.
- *Divergence:* none. Note for the method notes: out-strength is partly a property of how the
  rater answered, not only of the relationship, so it is reported alongside that rater's
  response rate.

**Degree**
- *Definition:* number of ties with a non-zero weight, in / out / total.
- *Formula:* `k_in(i) = |{ j : w(j→i) > 0 }|`, similarly out.
- *Normalisation:* `k / (n−1)`.
- *Library:* in-house.
- *Divergence:* computed on the unthresholded tie set. The display threshold slider changes
  what is drawn, not what is measured; the metrics table says so in its column header tooltip.

**Betweenness centrality**
- *Definition:* how often a member lies on shortest paths between other pairs.
- *Formula:* `C_B(v) = Σ_{s≠v≠t} σ_st(v) / σ_st`, Brandes with Dijkstra on `1/w`.
- *Normalisation:* divide by `(n−1)(n−2)` for directed graphs and `(n−1)(n−2)/2` for
  undirected. Endpoints excluded.
- *Library:* `graphology-metrics` betweenness with a `1/w` edge-weight accessor, subject to the
  API check in §5.
- *Divergence from NetworkX:* NetworkX uses exactly these constants with `normalized=True`, so
  the values should match. The divergence to document is the input: we pass `1/w` where a naive
  port would pass `w`, which would invert the meaning of a strong tie.

**Harmonic closeness**
- *Definition:* how close a member is to everyone else, defined even when the graph is
  disconnected.
- *Formula:* `C_H(v) = Σ_{u≠v} 1 / d(u,v)`, unreachable pairs contributing 0.
- *Normalisation:* divide by `(n−1)`, giving 0–1.
- *Library:* in-house Dijkstra over the engine's own adjacency, to keep the direction
  convention explicit.
- *Divergence from NetworkX:* NetworkX `harmonic_centrality` returns the **unnormalised** sum,
  so the fixture script divides by `n−1` before writing the fixture, and the fixture records
  that it did. NetworkX's directed convention sums over *incoming* distances `d(u,v)`; we
  follow that and offer an explicit "outgoing" variant in the metrics table, which has no
  NetworkX counterpart and is tested against a hand-computed fixture instead.
- *Also:* we do **not** use NetworkX `closeness_centrality`. Its default Wasserman–Faust
  correction produces different numbers; harmonic closeness is the spec's choice and the only
  closeness reported, so no comparison is meaningful.

**Eigenvector centrality**
- *Definition:* influence weighted by the influence of those connected to you.
- *Formula:* `A x = λ_max x`, `x ≥ 0`, power iteration.
- *Normalisation:* L2-normalised by the solver, then rescaled to max = 1 for display; both are
  exported.
- *Library:* `graphology-metrics` eigenvector centrality, subject to §5.
- *Divergence from NetworkX:* two, both real. (a) NetworkX L2-normalises; our display
  max-normalises, so exported and displayed values differ by a constant factor which the
  method notes state. (b) On directed graphs the in-edge versus out-edge convention differs
  between implementations. **This is resolved empirically, not from memory:** the fixture
  script writes both conventions for the karate-club and demo graphs, and the Phase 3 test
  records which one we match. (c) Convergence is not guaranteed on directed or disconnected
  graphs. On non-convergence we report the metric as unavailable for that layer, with a short
  explanation, rather than returning a partly converged vector. The spec's phrase "where
  defined" is implemented as exactly this.

**Burt's constraint**
- *Definition:* how far a member's ties are concentrated in a single, densely interconnected
  group. Low constraint with high betweenness is the broker signature (spec §9).
- *Formula:* `C(i) = Σ_j ( p_ij + Σ_q p_iq p_qj )²`, `q ≠ i,j`, where
  `p_ij = (w_ij + w_ji) / Σ_k (w_ik + w_ki)`.
- *Normalisation:* none; range is roughly 0–1.125 for the standard definition. Reported raw.
- *Library:* in-house. `graphology-metrics` is not assumed to provide structural-holes measures.
- *Divergence from NetworkX:* NetworkX `constraint` uses mutual weight `w_ij + w_ji` exactly as
  above and returns `nan` for isolates; we return `null` and the table shows a blank with a
  tooltip. The fixture script converts `nan` to `null` so the comparison is well defined.

**Effective size**
- *Definition:* the number of a member's contacts that are non-redundant.
- *Formula:* general Burt form `ES(i) = Σ_j [ 1 − Σ_q p_iq m_jq ]`, `q ≠ i,j`, with
  `m_jq = w_jq / max_k w_jk`.
- *Normalisation:* none. Efficiency `ES(i)/k(i)` is also reported.
- *Library:* in-house.
- *Divergence from NetworkX:* **this one is a trap.** NetworkX `effective_size` uses Borgatti's
  simplified `n − 2t/n` form for *unweighted, undirected* graphs and the general Burt formula
  otherwise. The two do not agree on a weighted graph. We always use the general form. The
  fixture script therefore calls NetworkX with the general path (weighted input) and the karate
  fixture explicitly records both NetworkX values so the divergence is visible rather than a
  silent test failure.

**Local clustering**
- *Definition:* how far a member's contacts are connected to each other.
- *Formula (unweighted, undirected):* `C(i) = 2 t_i / (k_i (k_i − 1))`.
  *(weighted):* Onnela's geometric mean, `C_w(i) = (1 / (k_i(k_i−1))) Σ_{jk} (ŵ_ij ŵ_jk ŵ_ki)^{1/3}`
  with `ŵ = w / max(w)`.
  *(directed):* Fagiolo's definition over the full directed adjacency.
- *Normalisation:* already 0–1.
- *Library:* in-house, to keep the three cases explicit.
- *Divergence from NetworkX:* none intended — these are NetworkX's own conventions. The
  divergence to document is which one is in force: the UI names it ("clustering, weighted") and
  the fixture asserts each case separately. Silently switching formula with the view mode would
  make the number incomparable across views, so the view label always carries the variant.

### 3.2 Network metrics

**Density**
- *Definition:* the share of possible ties that exist.
- *Formula:* directed `m / (n(n−1))`; undirected `2m / (n(n−1))`. `m` counts edges with `w > 0`.
- *Normalisation:* inherent, 0–1.
- *Library:* `graphology-metrics` density, or in-house — it is two lines either way.
- *Divergence from NetworkX:* NetworkX `density` matches. We additionally report **mean tie
  strength among realised ties** and **observed-pair density** (ties present out of pairs both
  parties were asked about). Weighted density has no single standard definition, so we do not
  invent one; we report the two components instead.

**Reciprocity**
- *Definition:* the tendency of ties to be returned.
- *Formula:* `r = |{(i,j) : w(i→j)>0 ∧ w(j→i)>0}| / |{(i,j) : w(i→j)>0}|`.
- *Normalisation:* inherent, 0–1.
- *Library:* in-house.
- *Divergence from NetworkX:* NetworkX `overall_reciprocity` uses this definition and is
  undefined for undirected graphs. **This is an open question — see Q1.** In a symmetrised view
  reciprocity is 1 by construction, so reporting it there is either meaningless or means
  something else. Proposal: always compute reciprocity on the underlying directed data, and in
  the symmetrised view additionally report *rating agreement* — the mean absolute difference
  `|w(i→j) − w(j→i)|` over pairs both rated, on the layer's own scale — labelled as such.

**Average clustering**
- *Definition:* mean local clustering across members.
- *Formula:* `Ĉ = (1/n) Σ_i C(i)`, isolates contributing 0.
- *Normalisation:* inherent.
- *Library:* in-house, from the node values.
- *Divergence from NetworkX:* NetworkX `average_clustering` includes zero-degree nodes as 0 by
  default. We match that and say so, because excluding them changes the number materially in a
  sparse network.

**Components**
- *Definition:* weakly and strongly connected components.
- *Formula:* standard; weak via union-find on the undirected projection, strong via Tarjan.
- *Normalisation:* count, plus the size of the largest as a share of `n`.
- *Library:* `graphology-components`, subject to §5.
- *Divergence from NetworkX:* none. Both weak and strong counts are reported in the directed
  view because they answer different questions, and the labels say which is which.

**Community detection (Louvain) and modularity**
- *Definition:* a partition into densely connected groups, and how good that partition is.
- *Formula:* `Q = (1/2m) Σ_ij [ A_ij − (k_i k_j)/(2m) ] δ(c_i, c_j)`, resolution γ applied to the
  null term.
- *Normalisation:* `Q` is bounded above by 1; typically 0.2–0.7.
- *Library:* `graphology-communities-louvain`, with a seeded RNG and an explicit weight accessor.
- *Divergence from NetworkX:* **Louvain is stochastic and order-dependent. Two correct
  implementations will not return the same partition.** The Phase 3 test therefore does *not*
  assert partition equality. It asserts three things: (a) our modularity function, given the
  NetworkX partition, reproduces the NetworkX `Q` to 1e-9; (b) our Louvain result's `Q` is
  within a stated tolerance of NetworkX's, or higher; (c) our Louvain is deterministic for a
  fixed seed across runs. The UI states that community membership is a model output, not a
  fact, and offers a re-run with a different seed so users can see how stable it is.

**Centralisation**
- *Definition:* how far the network's centrality is concentrated in one member.
- *Formula:* Freeman, `C = Σ_i (C_max − C_i) / max Σ_i (C_max − C_i)`, with the theoretical
  maximum taken over a star graph of the same size: `(n−1)(n−2)` for undirected degree
  centralisation, `(n−1)²` for directed.
- *Normalisation:* 0–1 by construction.
- *Library:* in-house. NetworkX does not provide Freeman centralisation.
- *Divergence:* none available to compare against, so the fixture is a hand-computed star, path
  and complete graph where the expected values are 1, low, and 0 respectively.

**E-I index**
- *Definition:* whether a group's ties point outside it or stay inside it.
- *Formula:* `EI = (E − I) / (E + I)`, `E` external ties, `I` internal, counted or weighted.
- *Normalisation:* −1 (wholly internal) to +1 (wholly external).
- *Library:* in-house.
- *Divergence:* not in NetworkX. Fixture is hand-computed. Reported at three levels — whole
  network, per group, per member — because the spec's silo insight needs the group level and
  the broker insight needs the member level. See Q9 on whether all three are wanted.

**Cross-group density**
- *Definition:* tie density within and between every pair of attribute groups.
- *Formula:* for groups `g,h`: `d(g,h) = Σ_{i∈g, j∈h, i≠j} 1[w>0] / (|g||h| − [g=h]|g|)`.
- *Normalisation:* inherent, 0–1. Also reported as a ratio to overall density.
- *Library:* in-house; displayed as a small group-by-group matrix.
- *Divergence:* not in NetworkX. Hand-computed fixture.

### 3.3 Aggregation and the composite

**Symmetrisation**
- *Definition:* collapsing `w(i→j)` and `w(j→i)` into one undirected weight.
- *Formula:* `mean = (a+b)/2`, `min = min(a,b)`, `max = max(a,b)`.
- *Unrated handling:* if exactly one direction is rated, `mean` and `max` use the rated value,
  `min` treats the pair as unrated. This is a judgement call; it is stated in the method notes
  and surfaced as a footnote in the metrics table. See Q2.
- *Library:* in-house.
- *Divergence:* NetworkX `to_undirected()` keeps one arbitrary edge's data; we never use it.

**Layer rescaling**
- *Definition:* putting every layer on 0–1 before combining.
- *Formula:* unsigned `w' = (w − min) / (max − min)` using the layer's *declared* min and max,
  not the observed range. Using the observed range would make the composite change when a single
  rating changes, which would be indefensible in a boardroom.
- *Signed layers:* `positiveOnly` → `w' = max(w,0)/max`; `dropNegative` → ties with `w < 0` are
  removed, the rest rescaled `w/max`; `multiplier` → the layer produces a factor
  `f = (w − min)/(max − min)` in 0–1 applied to the composite of the other layers. See Q3.
- *Library:* in-house.

**Composite**
- *Formula:* `composite(i→j) = Σ_L ω_L · w'_L(i→j)` over non-multiplier layers, with
  `Σ ω_L = 1`, then multiplied by each multiplier layer's factor.
- *Unrated handling:* a layer unrated for a pair is excluded from that pair's sum and the
  weights are renormalised over the layers that *are* rated for it, so a pair is not penalised
  for a layer nobody was asked about. The live formula display shows this renormalisation.
- *Divergence:* no library equivalent; this is a product decision, and the plain-notation
  formula beneath the sliders is the user-facing specification of it.

### 3.4 Signed layers

**Positive / negative split**
- *Definition:* a signed layer becomes two non-negative layers.
- *Formula:* `w⁺ = max(w, 0)`, `w⁻ = max(−w, 0)`. Edges with `w = 0` appear in neither.
- *Library:* in-house.
- *Divergence:* structural, and the reason the spec forbids negative weights in path
  algorithms — Dijkstra is invalid with negative weights and Brandes would silently produce
  nonsense. The engine enforces this with an assertion, not a convention: any path routine
  receiving a negative weight throws.

**Positive and negative in-valence**
- *Definition:* the total positive and total negative regard directed at a member.
- *Formula:* `v⁺(i) = Σ_j w⁺(j→i)`, `v⁻(i) = Σ_j w⁻(j→i)`. Reported as a pair, never netted.
- *Normalisation:* divided by the number of raters who rated that member on the layer, giving a
  mean rather than a count, so a well-covered member is not penalised.
- *Divergence:* netting the two would hide a member who is strongly liked by some and strongly
  disliked by others, which is exactly the pattern the tool exists to surface. Never netted.

**Structural balance**
- *Definition:* signed triads are balanced when the product of their three signs is positive.
- *Formula:* over triads where all three dyads have a non-null signed tie, sign
  `σ = sign(w)`; balanced iff `σ_ij σ_jk σ_ki > 0`. Counts reported by type (+++, ++−, +−−, −−−)
  with the balanced share.
- *Normalisation:* share of complete signed triads; the count of complete triads is reported
  alongside, because the share is meaningless when few triads are complete.
- *Library:* in-house. NetworkX's triad census is unsigned and is not used.
- *Divergence:* fixture is a hand-built six-node signed graph with known counts. Symmetrisation
  is required first, and the method notes say which rule was used, because balance is defined on
  undirected signed graphs.

### 3.5 Multiplexity

**Per-pair overlap**
- *Definition:* how many layers a pair is connected on, and how much they agree.
- *Formula:* count `|{L : w_L(i→j) > 0}|`, and Jaccard `|L_ij ∩ L_kl| / |L_ij ∪ L_kl|` between
  layer tie-sets across the whole network.
- *Normalisation:* count divided by the number of active layers.
- *Library:* in-house. Categorical layers (primary channel) are excluded — see Q7.

**Formal versus informal**
- *Definition:* classifies each pair as formal-only, informal-only, both, or neither.
- *Formula:* thresholded at `> 0` on each of the two collaboration layers; counts and shares by
  group, and a list of the largest mismatches.
- *Library:* in-house. This drives the spec §9 formal/informal gap insight.

### 3.6 Resilience

**Node removal**
- *Definition:* what changes when named members are removed.
- *Formula:* recompute on the induced subgraph over `V \ R` and report deltas in: weak and
  strong component counts, largest-component share, reachability, and average path length.
- *Reachability:* share of ordered pairs `(u,v)`, `u ≠ v`, with a directed path. Computed by BFS
  from each node — `O(n·m)`, about 2.5 million steps at 250 nodes and 10,000 edges, which is
  acceptable inside the worker.
- *Average path length:* mean `d(u,v)` over **reachable ordered pairs only**, reported with the
  reachable-pair share beside it so the two are never read apart.
- *Divergence from NetworkX:* NetworkX `average_shortest_path_length` raises on a disconnected
  graph. We do not raise; we restrict to reachable pairs and report the restriction. The fixture
  script computes the same restricted quantity so the comparison is like for like.
- *Framing:* the UI presents this as a structural what-if about the network, never as a
  statement about the person (spec §2, §9).

### 3.7 Coverage

**Response rate**
- *Definition:* how much of the roster each rater actually rated.
- *Formula:* per rater per layer, `responses / (n − 1)`, where a response is any non-null value
  including 0. Overall is the mean across raters, and also reported as the share of all possible
  ordered pairs that were rated.
- *Normalisation:* inherent, 0–1.
- *Gate:* below `coverage_threshold` (default 0.80) a persistent, non-dismissible banner states
  that whole-network metrics may be unreliable, and the PDF report carries the same statement.
- *Divergence:* no library equivalent. Coverage is computed before any metric and is attached to
  every export.

### 3.8 Stability (optional)

**Node-dropping bootstrap**
- *Definition:* how much the centrality *ranking* would change on a slightly different roster.
- *Formula:* for each drop proportion `p ∈ {0.1 … 0.5}`, draw `B` subsamples without
  replacement, recompute the chosen metrics, and correlate each subsample's ranking with the
  full-sample ranking (Spearman). Report per-member rank intervals as the 2.5th–97.5th
  percentile of the member's rank across subsamples.
- *Normalisation:* ranks are reported as intervals, never as a single rank — this is a spec
  requirement and is enforced in the component API, which has no single-rank prop.
- *Library:* in-house, reusing the metric functions.
- *Cost:* `B` × the full metric set. Betweenness dominates. Default `B = 100` with progress and
  cancellation; higher values are offered with a stated time estimate. See Q10.
- *Divergence:* not a NetworkX feature. The fixture is a determinism test (same seed, same
  intervals) plus a sanity test (a star graph's centre never leaves rank 1).

---

## 4. Correctness plan

- `scripts/fixtures/generate.py` — NetworkX, pinned version, writes `tests/fixtures/*.json`.
  Graphs: Zachary's karate club (undirected, unweighted); the seeded demo dataset (directed,
  weighted, signed, multi-layer); and four hand-built micro-graphs (star, path, complete,
  signed six-node) for the metrics NetworkX does not provide.
- Each fixture file records: the NetworkX version, the exact function call and its keyword
  arguments, the direction convention, and whether any post-processing (such as dividing
  harmonic centrality by `n−1`) was applied. A fixture without that provenance block is a
  failing fixture.
- Vitest compares engine output to the fixtures. Tolerances: `0` for counts and integer-valued
  results; `1e-9` absolute for closed-form quantities (density, E-I, modularity of a fixed
  partition); `1e-6` relative for iterative and path-based quantities; a separate, looser and
  explicitly justified tolerance for eigenvector centrality, which depends on the solver's
  convergence criterion.
- CI reads the committed fixtures. Python is never installed in CI. Regenerating fixtures is a
  deliberate local act with a reviewable diff.
- `docs/method-notes.md` is generated from the same metric registry that the engine and the
  in-app explanations use, so a metric cannot be documented one way and computed another. This
  file starts in Phase 3, not Phase 9 — see Q13.

---

## 5. Risks

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| R1 | **Library API assumptions.** This plan names `graphology-metrics`, `graphology-components` and `graphology-communities-louvain` functions from expectation, not from a verified installed version. Export paths, weight-accessor options and directed-graph support may differ. | Phase 3 could stall on missing functions. | First task of Phase 1 is a spike that installs the pinned versions and writes down the actual exports and options. Any metric the libraries do not cover is implemented in-house against a fixture — which is already the plan for constraint, effective size, centralisation, E-I, balance and multiplexity. The engine's public surface does not change either way. |
| R2 | **Louvain is not reproducible across implementations.** | A naive "match NetworkX" test will fail forever. | Assert modularity and determinism, not partition identity (§3.2). Say so in the UI. |
| R3 | **Bootstrap cost.** `B` × betweenness on 250 nodes is the heaviest thing the app does. | A frozen tab in front of a client. | Chunked, cancellable, progress-reported; default `B = 100`; the metric subset is user-chosen; a time estimate is shown before it starts. |
| R4 | **Canvas hit-testing at 10,000 edges.** Edge picking by geometry is expensive. | Hover and lasso feel laggy exactly when the network is interesting. | Nodes are picked from a quadtree; edges are picked only via their endpoints (hover a node to highlight its ties). Direct edge hover, if wanted, uses an off-screen colour-index buffer. |
| R5 | **CSP versus the build.** A strict `<meta>` CSP interacts badly with bundler-injected inline styles and with worker loading (`worker-src`, `blob:`). | The claim that data stays in the browser must be enforced, not asserted. | Phase 1 ships the CSP and a Playwright test that fails the build on any console CSP violation. The worker is bundled as a same-origin module, not a blob, if the policy allows no `blob:`. |
| R6 | **XLSX dependency supply.** The SheetJS community package's distribution channel has moved away from the public npm registry in recent years; I am not confident about its current state. | A Phase 2 blocker, and a supply-chain consideration for a tool handling employee data. | Verify at the start of Phase 2. If the pinned package cannot be installed from the registry CI uses, switch to an alternative reader and record the reason in `CLAUDE.md`. CSV import is unaffected either way. See Q11. |
| R7 | **Matrix entry scale.** 250 members × 249 ratees × up to 15 layers is roughly 930,000 cells. | A naive grid will not render. | Virtualised rows and columns, one layer at a time, paste applied in a single transaction. Phase 2 acceptance includes a 250-member paste. |
| R8 | **Respondent burden.** A whole-network roster design across many enabled layers asks each person for hundreds of ratings. | Low coverage makes whole-network metrics unreliable, and the coverage gate will fire constantly. | Not a code risk, but the tool should help: the layer picker shows the implied question count per respondent as layers are enabled. Flagged for the owner as Q12. |
| R9 | **Anonymisation leakage through exports.** | An anonymised PNG whose file name or embedded metadata carries real names is a data-protection failure. | Single export boundary (§1.4); a Playwright test asserts no member name appears in any export while anonymisation is on, including file names, SVG `<title>` elements and PDF text. |
| R10 | **Client-side PDF with embedded fonts.** | Bundle size, and the fonts must be embeddable under their licence. | OFL fonts are embeddable; confirm the specific family's licence text in Phase 1. Subset aggressively; the PDF is generated from the same SVG the map exports. |
| R11 | **Describing the network as the organisation.** A metric computed on 60% coverage looks exactly as authoritative as one computed on 100%. | The tool's credibility, and its ethics. | Coverage travels with every export and every insight; insights are phrased as questions; no member is ever ranked "best" or "worst". Reviewed again at Phase 8. |

---

## 6. Questions for the owner

Ordered by how much the answer changes the build.

**Q1 — Reciprocity in the symmetrised view (§6).** In a symmetrised graph every tie is mutual,
so reciprocity is 1 by definition. My proposal: always report directed reciprocity, and in the
symmetrised view additionally report *rating agreement* (mean `|w(i→j) − w(j→i)|` over pairs
both directions rated). Is that the right reading of "reciprocity is reported in both views"?

**Q2 — One-sided pairs under symmetrisation.** If A rates B a 4 and B never rated A, should
`mean` be 4 (my proposal — use the one rating), 2 (treat the missing side as 0), or unrated? The
choice changes every symmetrised metric, and `min` is affected differently from `mean` and `max`.

**Q3 — The signed "multiplier" treatment (§7).** My proposal: the signed layer maps to a factor
in 0–1 by `(w − min)/(max − min)`, so valence −3 multiplies the composite by 0, 0 by 0.5 and +3
by 1, applied after the weighted sum of the other layers. Confirm, or specify the mapping you
intend — in particular whether a neutral relationship should halve the composite, which is what
0.5 does.

**Q4 — Rated zero versus unrated.** I read "0 = no meaningful working connection" as a *response*
that produces no edge: it counts towards that rater's response rate but not towards density or
degree. Confirm, because it changes both coverage and every count-based metric.

**Q5 — What the composite ranks.** Section 7 says the composite drives "all rankings". I read
that as: the composite becomes the active edge weight, and rankings are then by whichever node
metric is selected. Confirm there is no separate single "priority score" per member intended.

**Q6 — Eigenvector fallback.** When power iteration does not converge on a directed layer, I
propose showing the metric as unavailable with an explanation, rather than substituting PageRank
or Katz. Is a documented substitute preferable to a gap?

**Q7 — Primary channel.** It is categorical and unweighted. I propose excluding it from the
composite and from multiplexity overlap, and using it only as an edge filter and an optional
edge encoding. Confirm.

**Q8 — The conflict layer's two sub-layers.** Task disagreement and personal friction: two
separate layer definitions sharing a `group`, each with its own weight slider and its own
question wording. Confirm, rather than one layer with two questions.

**Q9 — E-I index levels.** Network, per group, and per member. Three levels means three places it
appears in the UI. Do you want all three, or is the group level sufficient for the silo insight?

**Q10 — Stability scope.** It is marked optional in §6 and does not appear in the phase table at
all. Which phase owns it, and is `B = 100` node-dropping subsamples with rank intervals enough,
or do you also want a correlation-stability coefficient reported?

**Q11 — XLSX reader.** If the pinned SheetJS package cannot be installed from the registry CI
uses (R6), is switching readers acceptable as a `CLAUDE.md`-recorded decision, or do you want to
be asked at the time?

**Q12 — Respondent burden.** Every enabled layer multiplies each person's question count by
`n − 1`. At 60 members with 6 layers that is 354 questions per person. Should the layer picker
show the implied burden and warn above a threshold, or is that outside v1?

**Q13 — `docs/method-notes.md`.** It appears in the repository structure but the phase table
places documentation at Phase 9. I propose it is generated from the metric registry from Phase 3
onwards and merely polished at Phase 9. Confirm.

**Q14 — Waves.** `wave` defaults to 1 and multi-wave comparison is out of scope. If an import
file contains `wave = 2` rows, should the importer reject them, or store them and filter the
analysis to the active wave with a note in the validation report? I propose the latter.
