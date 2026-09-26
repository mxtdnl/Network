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

with m the total tie weight, s_i the strength of i, and γ = 1 (the resolution). Communities are found on the symmetrised graph of the layer, combined by the chosen rule, in both views. The search is seeded (the project's random seed), so the same data and seed give the same result. Communities are numbered in order of their earliest member.

**Caveats.** Louvain is a heuristic: it finds a good partition, not necessarily the best, and a different node order or seed can give a different one of similar quality. Graticule uses graphology's implementation, whose partitions differ from NetworkX's; on the reference cases its modularity is within 0.016 of NetworkX's (sometimes higher). Modularity around 0.3 or above is usually read as clear community structure; values near 0 mean none. The resolution γ = 1 is the same default as NetworkX; larger values find smaller communities.

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
| Louvain | Different implementation and node order | Tested by the modularity of NetworkX's own partition (exact, 10⁻⁹) and by requiring Graticule's modularity to be no more than 0.02 below NetworkX's, not by equal partitions |
| Negative sub-layers | — | Strength, degree and clustering only |
| Centralisation, E-I index, cross-group density, dyad reciprocity, signed in-valence and triads, multiplexity, resilience | No function (or it raises on disconnected graphs) | Plain Python from NetworkX components and shortest paths |

Betweenness (weighted and binary, directed and undirected, normalised), constraint, clustering, density, overall reciprocity, components and fixed-partition modularity need no adjustment: graphology and the custom code match NetworkX's own functions directly.
