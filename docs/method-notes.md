# Method notes

These notes define every metric Graticule computes: what it means in plain English, the formula the engine evaluates, and the caveats a reader needs. The in-app explanations are drawn from this text. Where Graticule's convention differs from NetworkX, the difference is stated and the reference fixtures apply the same convention (see "Reference values" at the end).

The analysis engine is `src/engine/`. Formulas below use this notation:

- n: number of members.
- v_ij: the rating member i gave member j on a layer (the rater is i).
- w_ij: the rescaled weight of the tie i → j, between 0 and 1. A tie exists when w_ij > 0.
- d_ij: the length of the shortest path from i to j, where each tie counts as 1/w.
- N(i): the members i has a tie with, in either direction.

## 1. General conventions

### 1.1 Not rated is not zero

A rating of 0 means "no connection" or "never". A missing rating means the person did not answer. The two are never treated alike: a missing rating does not create a tie, is not counted as a 0 in averages, and is counted as missing in data coverage. Inside the engine a missing rating is the value NaN; in project files it is `null` or an absent tie.

### 1.2 Rescaling

Every layer is rescaled to 0–1 before any metric, so values from different layers can be compared and combined.

- Unsigned layers: r = (v − min) / (max − min). On a 0–5 scale, 0 → 0, 1 → 0.2, 5 → 1.
- Signed layers (valence, energy): s = v / max for v ≥ 0 and v / |min| for v < 0, so s runs from −1 to +1. Each signed layer is split into a positive sub-layer, w⁺ = max(s, 0), and a negative sub-layer, w⁻ = max(−s, 0). The two are analysed separately and never netted.

Caveat: rescaling assumes the points of a rating scale are equally spaced. A "5" is treated as five times a "1".

### 1.3 Directed and symmetrised views

In the directed view A's rating of B and B's rating of A are separate ties.

In the symmetrised view each pair has one tie, combined from the two directions by the rule the analyst chooses:

- mean: (w_ij + w_ji) / 2;
- minimum: min(w_ij, w_ji), a tie only if both sides report one;
- maximum: max(w_ij, w_ji), a tie if either side reports one.

If only one of the two has rated the other, that rating is used on its own (mean, minimum and maximum then agree). If neither has, the pair is missing. Signed layers are combined before they are split, so when A rates B positively and B rates A negatively the pair's sign follows the rule: the sign of the mean, negative under minimum, positive under maximum.

Caveat: the minimum rule makes the network sparser and the maximum rule denser; metrics can change markedly between them. The chosen rule is part of every result.

### 1.4 Distance for path-based metrics

Shortest paths treat a strong tie as short: each tie has length 1/w. A tie of weight 1 has length 1; a tie of weight 0.2 has length 5. This applies to betweenness, harmonic closeness, resilience and shortest paths.

Negative weights are never passed to path-based algorithms. The only way into them is one gate (`pathGraph` in `src/engine/graphs.ts`), which refuses any negative or undefined weight, and a unit test runs a full analysis of the demo (which has negative valence) through every view, rule and signed treatment while checking that gate. Path-based metrics are not computed on negative sub-layers at all (section 3.1).

### 1.5 Undefined values

A metric that cannot be computed for a member is shown as "Not defined" with the reason, never as 0. Reasons: the member has no ties; the member is outside the largest connected group (eigenvector centrality); the calculation did not converge.

## 2. Tie aggregation

### Reciprocity

**Meaning.** How often ties are returned: when one member reports a tie to another, how often the other reports one back.

**Formula.** On the directed ties of the layer, whichever view is shown:

- tie reciprocity = (number of ties whose reverse tie also exists) / (number of ties);
- dyad reciprocity = mutual pairs / (mutual pairs + one-way pairs).

**Caveats.** The two figures differ: a network with one mutual pair and one one-way pair has tie reciprocity 2/3 and dyad reciprocity 1/2. Both ignore tie strength. Missing ratings lower reciprocity, because an unanswered survey looks like an unreturned tie.

## 3. Node metrics

Computed for every unsigned layer, the positive sub-layer of each signed layer, and the composite. In the directed view in- and out- versions are reported separately; in the symmetrised view there is one of each.

### 3.1 Negative sub-layers

Negative sub-layers get strength, degree and clustering only. Betweenness, harmonic closeness, eigenvector centrality, constraint and effective size are not computed there, because a shortest path or a flow along negative ties has no clear social meaning.

### In-strength and out-strength

**Meaning.** How much tie weight a member receives (in-strength) or gives (out-strength). In the symmetrised view, the total weight of the member's ties.

**Formula.** in-strength_i = Σ_j w_ji; out-strength_i = Σ_j w_ij; symmetrised strength_i = Σ_j w_ij.

**Caveats.** Uses 0–1 weights, so the maximum is n − 1. Out-strength reflects how the member answered the survey as much as their relationships: generous raters have high out-strength.

### Degree

**Meaning.** How many ties a member has, regardless of strength.

**Formula.** in-degree_i = number of j with w_ji > 0; out-degree_i = number of j with w_ij > 0; symmetrised degree_i = |N(i)|.

**Caveats.** A weak tie counts as much as a strong one. In the directed view in- and out-degree are reported separately and never added (NetworkX's `degree_centrality` on a directed graph adds them, giving values that can exceed 1).

### Betweenness

**Meaning.** How often a member lies on the shortest routes between other members. High betweenness marks someone who connects parts of the network that are otherwise far apart.

**Formula.** B_i = Σ over pairs s ≠ i ≠ t of σ_st(i) / σ_st, where σ_st is the number of shortest paths from s to t and σ_st(i) the number passing through i, with tie length 1/w. Normalised so values run from 0 to 1: divided by (n − 1)(n − 2) for ordered pairs in the directed view, and by (n − 1)(n − 2)/2 for unordered pairs in the symmetrised view.

**Caveats.** Assumes that things travel along shortest paths only. Sensitive to single ties: one extra tie can move a member's value a great deal. Paths of exactly equal length are compared by floating-point equality, so two paths whose lengths differ only by rounding are not both counted. A binary version (every tie length 1) is also computed, for centralisation.

### Harmonic closeness

**Meaning.** How easily a member can be reached from everyone else ("reachability from others"). The outgoing version measures how easily the member reaches everyone else.

**Formula.** H_i = (1 / (n − 1)) Σ_{j ≠ i} 1 / d_ji, where 1/d = 0 when there is no path. The outgoing version uses d_ij.

**Caveats.** Unlike classic closeness, it stays defined when the network is split into separate groups: unreachable members simply add nothing. Divided by (n − 1), so with 0–1 weights the value is at most 1. NetworkX's `harmonic_centrality` returns the undivided sum and uses incoming distances; Graticule follows its direction and divides.

### Eigenvector centrality

**Meaning.** A member is central if they are tied to members who are themselves central. It rewards being well connected to the well connected.

**Formula.** The principal eigenvector x of the weighted adjacency matrix: λ x_i = Σ_j w_ji x_j, found by power iteration (on A + I, which avoids oscillation), scaled so that Σ x_i² = 1. Converged when the summed change is below n × 10⁻¹².

**Where defined.** Only on the largest strongly connected group (directed view) or connected group (symmetrised view): a set of members who can all reach each other. Everyone outside it is "Not defined", because a member who cannot be reached from the core has no well-defined score. If two groups tie for largest, the one containing the earliest member in the member list is used. If the largest group has fewer than two members, or the iteration does not converge within 10,000 steps, the metric is not defined for anyone.

**Caveats.** Values are only comparable within one group and one layer. NetworkX returns values for a graph that is not strongly connected without warning; they are not meaningful there, and Graticule does not report them.

### Burt's constraint

**Meaning.** How much a member's contacts are tied to each other. High constraint means a closed, redundant network in which the member has few independent options; low constraint means contacts in separate circles.

**Formula.** With mutual weight M_ij = w_ij + w_ji and proportional tie p_ij = M_ij / Σ_k M_ik:

c_i = Σ_{j ∈ N(i)} (p_ij + Σ_{q ∈ N(i), q ≠ i, j} p_iq p_qj)².

**Caveats.** Ranges from about 0 to just over 1; members with few contacts score high by construction (one contact gives constraint 1). Not defined for a member with no ties. Directed ties in either direction count as contact.

### Effective size

**Meaning.** The number of a member's contacts who are not redundant: the size of their network after discounting contacts who are tied to each other.

**Formula.** With p as above and m_jq = M_jq / max_k M_jk (the tie from j to q relative to j's strongest tie):

ES_i = Σ_{j ∈ N(i)} (1 − Σ_{q ∈ N(i), q ≠ j} p_iq m_jq).

**Caveats.** At most the number of contacts. Not defined for a member with no ties. For unweighted undirected data this equals Borgatti's simpler formula, n − 2t/n. NetworkX 3.6.1's `effective_size` has a defect when SciPy is installed: its matrix code divides by the strongest tie of q instead of j, and disagrees with its own per-node code and its documentation by up to 0.74 on the reference cases. Graticule follows the documented formula, and the reference values are computed with NetworkX's per-node code (section 7).

### Local clustering

**Meaning.** How many of a member's contacts are tied to one another, weighted by the strength of those ties.

**Formula.** Weights are first divided by the largest weight in the layer, ŵ = w / max(w), and a = ŵ^(1/3).

- Symmetrised view (Onnela et al., 2005): C_i = Σ_{j,k} a_ij a_jk a_ki / (k_i (k_i − 1)), with k_i the degree.
- Directed view (Fagiolo, 2007): C_i = [(A + Aᵀ)³]_ii / (2 (d_i^tot (d_i^tot − 1) − 2 d_i^↔)), with d^tot = in-degree + out-degree and d^↔ the number of reciprocated ties.

A member with fewer than two contacts, or no closed triangle, has clustering 0 and is flagged "fewer than two contacts" where that applies.

**Caveats.** Because weights are divided by the layer's single largest weight, one unusually strong tie anywhere changes every member's value. On 0–5 ratings the largest weight is usually 1, so this rarely matters.

## 4. Network metrics

### Density

**Meaning.** The share of possible ties that exist.

**Formula.** Directed: m / (n (n − 1)); symmetrised: 2m / (n (n − 1)), with m the number of ties.

**Caveats.** Ignores strength. Not comparable across networks of very different size: large networks are sparser because people have limited time.

### Average clustering

**Meaning.** How clustered the network is overall: the mean of the members' local clustering.

**Formula.** (1/n) Σ_i C_i, counting members with clustering 0.

**Caveats.** Members with fewer than two contacts pull the average down.

### Components

**Meaning.** Groups of members connected by some chain of ties, with no ties to other groups.

**Formula.** Directed view: weakly connected groups (ties read in either direction) and strongly connected groups (every member can reach every other along the direction of the ties). Symmetrised view: connected groups. Reported as counts and sizes, largest first.

**Caveats.** An isolated member is a group of one.

### Communities (Louvain) and modularity

**Meaning.** Groups of members more densely tied to each other than to the rest, found automatically.

**Formula.** The Louvain method (Blondel et al., 2008) searches for the partition with the highest modularity:

Q = (1 / 2m) Σ_ij [w_ij − γ s_i s_j / 2m] δ(c_i, c_j),

with m the total tie weight, s_i the strength of i, and γ = 1 (the resolution). Communities are found on the symmetrised graph of the layer, combined by the chosen rule, in both views. The search visits members in a random order, so it is run ten times from one stream seeded with the project's random seed, and the partition with the highest modularity is kept; the same data and seed always give the same result. Each run uses classic local moving (every member is reconsidered on every sweep, as in NetworkX). Communities are numbered in order of their earliest member.

**Caveats.** Louvain is a heuristic: it finds a good partition, not necessarily the best, and a different node order or seed can give a different one of similar quality. Graticule uses graphology's implementation, whose partitions can differ from NetworkX's; on every reference case its modularity is equal to or higher than NetworkX's. With a single run, or with graphology's default fast local moving, it fell up to 0.015 short. Modularity around 0.3 or above is usually read as clear community structure; values near 0 mean none. The resolution γ = 1 is the same default as NetworkX; larger values find smaller communities.

### Centralisation

**Meaning.** How much the network is dominated by one member, compared with a star, the most centralised shape possible.

**Formula.** Freeman (1979): C = Σ_i (c_max − c_i) / (the same sum for a star of n members), computed for:

- degree (symmetrised): divided by (n − 1)(n − 2);
- in-degree and out-degree (directed): divided by (n − 1)²;
- binary betweenness (normalised): divided by (n − 1).

**Caveats.** Computed for binary degree and betweenness only, where the star-graph maximum is established. Not defined for fewer than three members. NetworkX has no centralisation function; the reference values are computed from NetworkX degree and betweenness.

### E-I index

**Meaning.** Whether ties stay within groups (such as teams) or cross between them.

**Formula.** EI = (E − I) / (E + I), with E the ties between members of different groups and I the ties within groups (Krackhardt & Stern, 1988). −1: all ties internal; +1: all ties external. A per-group value uses the ties with at least one end in that group.

**Caveats.** Counts ties, not strength. Larger groups have more internal opportunities, so their index is lower even when members mix freely; compare with cross-group density. Members with no value for the attribute are left out, and the number left out is reported.

### Cross-group density

**Meaning.** For every pair of groups, the share of possible ties between them that exist; on the diagonal, the density within each group.

**Formula.** D_AB = e_AB / (|A| |B|) for A ≠ B, where e_AB counts ties from A to B (directed) or between A and B (symmetrised); D_AA = e_AA / (|A| (|A| − 1)), halved in the denominator for the symmetrised view.

**Caveats.** A group of one has no internal density.

## 5. Signed layers

### Positive and negative in-valence

**Meaning.** How positively, and separately how negatively, a member is rated by others.

**Formula.** V_i⁺ = Σ_j w⁺_ji and V_i⁻ = Σ_j w⁻_ji on the −1..1 scale, with the number of members giving each. Always computed from the directed ratings.

**Caveats.** The two are shown side by side and never combined into a single score, which would read as a verdict on the person. Negative ratings describe relationships, not individuals.

### Structural balance

**Meaning.** Whether trios of members are in a stable pattern. Balance theory (Heider; Cartwright & Harary) holds that "my friend's friend is my friend" (+++) and "my enemy's enemy is my friend" (+−−) are stable, while a trio with one negative pair (++−) or three (−−−) is under strain.

**Formula.** On the signed layer symmetrised by the chosen rule, every trio whose three pairs all carry a sign is counted: balanced if the product of the three signs is positive (+++, +−−), unbalanced otherwise (++−, −−−). The balance ratio is balanced / (balanced + unbalanced).

**Caveats.** Trios with a neutral (0) or unrated pair are not counted. The dyad sign depends on the symmetrisation rule when the two directions disagree.

## 6. Multiplexity, resilience, composite and stability

### Multiplexity

**Meaning.** Whether the same pairs are tied on several layers.

**Formula.** For each pair (ordered in the directed view, unordered in the symmetrised view), the number of layers on which a tie exists; signed layers count their positive and negative sub-layers separately. Between each two layers, the Jaccard overlap J = |E_a ∩ E_b| / |E_a ∪ E_b|.

**Caveats.** Categorical layers (primary channel) are not included.

### Formal–informal comparison

**Meaning.** Classifies every pair as formal only, informal only, both, or neither, using the formal and informal collaboration layers.

**Formula.** Formal tie: formal collaboration weight > 0; informal tie likewise. A pair with either rating missing is "not classified" and counted.

**Caveats.** "Formal only" means the collaboration is required but not reported as happening outside formal channels; it is a prompt for inquiry, not evidence of a problem.

### Resilience

**Meaning.** What happens to the network if selected members leave.

**Formula.** The selected members are removed with their ties, and on the remaining members:

- components: the count (weak and strong in the directed view) and the size of the largest;
- reachability: the share of ordered pairs (u, v) with a path from u to v;
- average path length: the mean shortest-path length over reachable pairs only, both as distance (1/w) and in steps.

Each is reported before, after and as the change.

**Caveats.** Averages over reachable pairs only, so average path length can fall when the network falls apart (distant pairs become unreachable and leave the average). Read it with reachability. NetworkX's `average_shortest_path_length` refuses a disconnected network instead.

### Composite

**Meaning.** One combined relationship score per pair, weighting the layers by importance.

**Formula.** For each directed pair (i, j):

C_ij = Σ_l ω_l r_l(v_ijl) / Σ_l ω_l over the summed layers rated for (i, j),

with ω_l = W_l / Σ_k W_k (the slider weights, normalised to sum to 1). Summed layers are unsigned layers (r = rescaled rating) and signed layers treated as "positive only" (r = w⁺). Signed layers can instead be treated as:

- filter out negative ties: C_ij = 0 wherever the signed rating is negative;
- multiplier: C_ij × (1 + 0.5 s_ij), with s on −1..1, so a neutral rating leaves the composite unchanged, the most positive raises it by half and the most negative halves it.

The result is capped at 1. If a pair is rated on some summed layers but not others, the weights are re-normalised over the layers that are rated; if it is rated on none, it is missing. A missing signed rating leaves the composite unchanged. A layer with weight 0 is left out entirely. The symmetrised composite combines the two directed composites by the chosen rule.

The engine returns the formula as a structure (terms, weights, filters, multipliers, cap) together with the notation shown to the user, and computes the composite from that same structure.

**Caveats.** The composite is only as meaningful as the weights: it is a statement of priorities, not a measurement. Re-normalising over rated layers means a pair rated on one layer only is scored on that layer alone.

### Presets

**Meaning.** Starting points for the weights, named for the question being asked. Each names raw slider values for the layers it uses; every other enabled layer gets weight 0 and is left out. The engine normalises the summed layers' weights to 1, so only their proportions matter, and a layer a preset names but the project has not enabled is simply absent.

One rule applies to every preset: the layer that defines it has twice the raw weight of each supporting layer.

| Preset | Raw weights | Signed layers |
|---|---|---|
| Formal structure | formal collaboration 0.4, workflow dependency 0.2 | none used |
| Informal network | informal collaboration 0.4, advice 0.2, idea sharing 0.2 | none used |
| Relationship health | connection strength, benevolence-based trust, interpersonal safety and energy 0.2 each | valence as a multiplier, energy as positive ratings |
| Custom | the analyst's own slider values; a layer never moved uses its default weight (1) | as chosen |

Why these layers. Formal structure uses the ties created by role or process: formal collaboration (defined in spec §4.2 as required by role, process or reporting line) and workflow dependency. Informal network uses discretionary ties: informal collaboration, advice (the core informal relation in Cross & Parker, 2004) and idea sharing. Neither uses connection strength, so the two presets differ only in what defines them. Relationship health sums relational layers and lets valence, the overall affective quality of the relationship, scale the result, so a negative relationship lowers the composite (by up to half) instead of being scored like a neutral one. It leaves out competence-based trust, which concerns expertise rather than the relationship, and the conflict layers, which are frequencies that the composite could only add, so frequent conflict would raise the score.

With only the four core layers enabled, Formal structure is formal collaboration alone (1.00), Informal network is informal collaboration alone (1.00), and Relationship health is connection strength (1.00) scaled by valence.

**Caveats.** The presets are conventions chosen for this tool and approved by the owner, not published standards; the 2 : 1 ratio in particular is a convention. Moving a slider under a preset switches to Custom, starting from the preset's values.

### Shortest path

**Meaning.** The strongest route between two members: the chain of ties along which the total distance is smallest.

**Formula.** Dijkstra's algorithm with tie length 1/w in the current view (following tie direction in the directed view). The result gives the members along one shortest path, its distance (Σ 1/w), its number of steps, and how many different paths share that shortest distance. When several do, the one whose members, read back from the destination, come earliest in the member list is shown.

**Caveats.** A shortest path is one route among possibly several; the count of equally short paths says how many. Paths of equal length are detected by floating-point equality, as in NetworkX. Not computed on negative sub-layers.

### Subgroup density

**Meaning.** For a group of members chosen on the map (multi-select or lasso), how densely they are tied to each other compared with how densely they are tied to everyone else.

**Formula.** Binary ties (w > 0) of the layer the map draws, in the current view, among the members shown (after filters and the ego view). For a subgroup S of k members and the r other members shown:

- directed view: internal density = ties within S / (k (k − 1)); external density = ties from S to the rest and from the rest to S / (2 k r);
- symmetrised view: internal density = ties within S / (k (k − 1) / 2); external density = ties between S and the rest / (k r);
- E-I index = (E − I) / (E + I), with E the external and I the internal tie count.

**Caveats.** Counts ties, not their strength. A small subgroup has few possible internal ties, so one tie moves its internal density a great deal. Computed on the main thread from the weights the engine returned (`subgroupDensity` in `src/engine/metrics/subgroup.ts`), so it always uses the ties the map shows.

### Layer overlap (side-by-side comparison)

**Meaning.** How many ties two layers share.

**Formula.** For every pair (ordered in the directed view, unordered in the symmetrised view), whether it has a tie (w > 0) on the first layer, the second, or both; the share in common is the Jaccard overlap, both / (both + first only + second only), the same measure as in multiplexity above.

**Caveats.** A pair not rated on one of the layers counts as having no tie there. The formal–informal comparison, by contrast, sets such pairs aside as not classified.

### Data coverage

**Meaning.** The share of possible ratings that were given, per rater and overall.

**Formula.** coverage_i = (ratings given by i) / ((n − 1) × enabled layers), over wave 1, including categorical layers; overall coverage is the same ratio over all raters. A rating of 0 counts as given; declined and not entered are counted separately. Below the threshold (default 80 %) a warning states that whole-network metrics may be unreliable.

**Caveats.** Computed from the project on the main thread, because the engine's NaN cannot tell "declined" from "not entered"; the analysis result carries the same figures.

### Stability of rankings (bootstrap)

**Meaning.** How much a member's rank on a metric depends on exactly who took part.

**Formula.** B times (default 200), drop a random ⌊p·n⌋ members (default p = 0.1, seeded), recompute the metric on the remaining network and rank the members (1 = highest; tied values share the average rank). Ranks are rescaled to 1..n so replicates of different sizes compare. Each member's rank is reported as the interval from the 2.5th to the 97.5th percentile of their ranks across the replicates in which they were kept.

**Caveats.** Shows sensitivity to missing members, not statistical confidence about a population. Wide intervals mean a ranking should not be read precisely. Runs in the background with progress and can be cancelled.

## 7. Reference values and differences from NetworkX

`scripts/generate_fixtures.py` computes reference values with NetworkX and writes them to `tests/fixtures/`:

| File | Case |
|---|---|
| `karate-unweighted.json` | Zachary's karate club, every tie rated 1 in both directions |
| `karate-weighted.json` | Zachary's karate club with Zachary's interaction counts (1–7) as ratings on a 0–7 scale |
| `karate-directed.json` | Karate club ties with four deterministic, asymmetric layers (strength, valence, informal and formal collaboration), including rated zeros and missing directions |
| `demo.json` | The demo project's four core layers and the composite; the file's SHA-256 is recorded and checked |

Each case is computed in four views: directed, and symmetrised by mean, minimum and maximum. The fixtures record the NetworkX, SciPy, NumPy and Python versions (NetworkX 3.6.1, SciPy 1.17.1, NumPy 2.4.6, Python 3.11.15 at the time of writing). `tests/unit/engine.fixtures.test.ts` asserts that the engine matches them: within 10⁻⁹ absolute for every metric except eigenvector centrality (10⁻⁶, an iterative method), and exactly for counts.

Regenerate after changing the demo, the fixture script or a convention:

```
pip install -r scripts/requirements-fixtures.txt
npm run fixtures        # python3 scripts/generate_fixtures.py
```

CI uses the committed fixtures and does not need Python.

Conventions applied in the fixture script rather than taken from NetworkX:

| Metric | NetworkX | Graticule (and the fixture) |
|---|---|---|
| Rescaling, symmetrisation, composite | No equivalent | Computed in plain Python with the engine's operation order |
| Harmonic closeness | Undivided sum | Divided by (n − 1) |
| Eigenvector centrality | Computed on the whole graph, even when not strongly connected | Largest (strongly) connected group only; others not defined |
| Effective size | SciPy code path (used when SciPy is installed) divides by the wrong row maximum in 3.6.1 | Documented formula, via NetworkX's per-node code; a member with incoming ties only is not treated as isolated (NetworkX's per-node code checks outgoing ties only) |
| Degree (directed) | `degree_centrality` sums in and out | In and out reported separately, not normalised |
| Louvain | Different implementation and node order | Tested by the modularity of NetworkX's own partition (exact, 10⁻⁹) and by requiring Graticule's modularity to be no lower than NetworkX's (10⁻⁹), not by equal partitions |
| Negative sub-layers | — | Strength, degree and clustering only |
| Centralisation, E-I index, cross-group density, dyad reciprocity, signed in-valence and triads, multiplexity, resilience | No function (or it raises on disconnected graphs) | Plain Python from NetworkX components and shortest paths |

Shortest paths (distance and number of equal paths, via `dijkstra_path_length` and `all_shortest_paths`), betweenness (weighted and binary, directed and undirected, normalised), constraint, clustering, density, overall reciprocity, components and fixed-partition modularity need no adjustment: graphology and the custom code match NetworkX's own functions directly.

## 8. Insight rules

The insights panel (spec §9) lists rule-based observations. Each rule is a pure function in `src/engine/insights.ts`; its thresholds are the constants `INSIGHT_RULES` there, and the panel quotes them, so the rule shown is the rule that ran. Rules run on the analysis on screen (its view, symmetrisation rule and weights). Each observation is worded as a question for inquiry, never as a verdict on a person; `tests/unit/insightsCopy.test.ts` checks the wording against the banned list in `CLAUDE.md`. A rule that found nothing says so, and a rule that cannot run says why.

Quantiles use linear interpolation over the members whose value is defined (NumPy's default), as in the bootstrap.

| Rule | Reads | Observation when | Shows on the map |
|---|---|---|---|
| Potential brokers | Composite: weighted betweenness and constraint | Betweenness among the highest 10 % of members (at least one member; ties with the last included) and above 0, and constraint at or below the median; at most 5 members | Ties from the composite, size by betweenness, the members highlighted |
| Peripheral members | Received strength (strength when symmetrised) on every unsigned layer and the positive part of each signed layer | At or below the 20th percentile on more than half of those layers; a layer on which nobody receives a tie is not counted, and a member at a layer's highest value is never low | Ties from the composite, size by received strength, the members highlighted |
| Possible overload | Connections in (connections when symmetrised) on advice and workflow dependency | At or above the 90th percentile and at least twice the median, and above 0; at most 5 per layer | That layer, size by connections in |
| Silos | E-I index per team on the composite and each unsigned layer | A team of at least 3 members with E-I −0.50 or lower on any of them (at least three internal ties per external one); the lowest is quoted | That layer, grouped by team, the team highlighted |
| Negative clusters | Each signed layer's directed ratings | Pairs who rate each other negatively in both directions, joined through shared members into groups of at least 3 | The composite with valence colour on, the group highlighted |
| Formal ties with no informal counterpart | Formal–informal classes (multiplexity) | For a pair of teams, or one team: at least 50 % of formal ties are formal only, and at least 5 such ties | Formal collaboration, the two teams only, grouped, formal and informal line styles on; the 5 members in the most such ties highlighted |
| Informal ties with no formal counterpart | As above | The same, for informal only | Informal collaboration, as above |

**Caveats.** The thresholds are conventions chosen for this tool, not published standards; they are stated wherever a rule is shown so a reader can judge them. Every rule inherits the caveats of the metric it reads (sections 3 to 6): betweenness assumes shortest-path flow, the E-I index counts ties and favours larger groups, received strength depends on who answered. The rules describe positions in the network, which have many causes (role, tenure, location, workload, the survey itself); an observation is a reason to ask, not an answer. Below the coverage threshold the panel repeats the coverage warning.

**Demo.** On the demo the rules find the structures it was built with (scripts/generate-demo.ts): the Operations broker, Finance as a silo, the pocket of reciprocated negative valence, formal-only ties between Product and Sales and informal-only ties between People and Product. Possible overload does not apply, because the demo has no advice or workflow dependency ratings. `tests/unit/insights.test.ts` checks each threshold at its boundary and the demo findings.

## 9. Survey collection (respondent mode)

Graticule can run the survey itself (spec §15). Each participant opens a personal link, answers in the browser and returns an encrypted response, which the analyst imports. This section states what that arrangement protects and what it does not, and the conventions behind the completion-time estimate.

### What the encryption protects

- **Reading a response.** Each response is encrypted on the respondent's device to the survey's public key: a fresh ECDH P-256 key pair per response, HKDF-SHA-256 and AES-256-GCM (`src/survey/crypto.ts`). Only the survey's private key can decrypt it. That key is stored in the project file only in encrypted form, under a key derived from the analyst's passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations). Whoever carries or stores a response file (email providers, file-sharing services, the respondent's own mailbox) cannot read it.
- **Altering a response.** AES-GCM authenticates the whole response, and the unencrypted header (survey, version, key fingerprint) is bound to it. Any change makes the import reject the file as changed or damaged.
- **Mixing up surveys.** A response encrypted for another survey or key, or answering a version the survey does not have, is rejected with its reason.
- **Duplicates.** Every respondent has a random 128-bit token inside the encrypted response. Two responses with one token are duplicates: the one submitted latest (by the respondent's device clock) is kept and the event is logged. The same file imported twice changes nothing.

### What it does not protect

- **Who answered.** There is no server, so nothing proves identity. A respondent who forwards their link lets someone else answer as them. The token detects duplicates; it does not show who used it. The name check at the start of the survey ("This link was made for …") is a prompt, not authentication.
- **The link itself.** The survey travels in the link's fragment, which browsers do not send to the web server, but email and chat security services can rewrite, scan and log whole links (CLAUDE.md, "Research"). Anyone who can see a link can therefore read the roster and questions and answer as its recipient. Links hold nothing the organisation does not already hold, apart from the token.
- **Answers before submission.** While a respondent works, their answers are saved in the browser on their device, unencrypted, so they can resume. Anyone using that device and browser can see them until they are submitted or cleared. They are cleared automatically once the encrypted response has been copied or downloaded, and on request.
- **The analyst's side.** Once decrypted and imported, ratings are ordinary project data: the project file, exports and the analyst's device need the same care as any personal data. A lost key and passphrase cannot be recovered; the responses encrypted to it are then unreadable by anyone.
- **Timing.** The submission time comes from the respondent's device and can be wrong; it decides only which of two duplicates is kept.

Responses are confidential and carry the respondent's name: the analyst sees who gave which ratings, because a whole-network design needs it (section 1, spec §3). The respondent screens say so and never describe the survey as anonymous.

### Colleagues not selected

With "select colleagues, then rate them", a colleague the respondent did not select is recorded as the lowest point of each unsigned layer (0: "Never" or "No meaningful working connection"), and as not rated on signed and categorical layers, because 0 on a signed layer means neutral, a quality nobody reported (CLAUDE.md D88). The analyst can change this per layer, and respondents are told what is recorded before they select anyone. A consequence for coverage: signed layers are not rated for colleagues not selected, so a nomination survey with valence rarely reaches the coverage threshold on its own.

### Completion-time estimate

Estimated time = 60 s to read the introduction and agree + 5 s per rating + (with selection) 2 s per colleague considered, where ratings = colleagues × questions for a full roster, or the expected number of selections (default 12) × questions with selection. These are conventions, not measurements; the owner approved them as proposed (CLAUDE.md Q31). The warning limit defaults to 15 minutes.
