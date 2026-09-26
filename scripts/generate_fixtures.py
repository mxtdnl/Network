#!/usr/bin/env python3
"""NetworkX reference values for the Graticule analysis engine (spec §6).

Writes tests/fixtures/{karate-unweighted,karate-weighted,karate-directed,demo}.json.
The Vitest suite (tests/unit/engine.fixtures.test.ts) asserts that the TypeScript
engine reproduces every value within the tolerances recorded in each file. CI
uses the committed fixtures and does not run Python.

Regenerate (after changing the demo, this script or a convention):

    pip install -r scripts/requirements-fixtures.txt
    npm run fixtures            # or: python3 scripts/generate_fixtures.py

The engine's conventions are mirrored here, not delegated to NetworkX, wherever
NetworkX has no function or a different convention (docs/method-notes.md):

* every layer is rescaled to 0-1 before any metric: r = (v - min) / (max - min);
  signed layers are scaled to -1..1 (s = v / max for v >= 0, v / |min| otherwise)
  and split into a positive (max(s, 0)) and a negative (max(-s, 0)) sub-layer;
* a tie exists when its weight is > 0; a missing rating is no tie;
* symmetrised views combine w_ij and w_ji by mean, min or max; when one
  direction is missing the other is used; signed layers are symmetrised before
  they are split;
* path metrics use distance = 1 / w;
* harmonic closeness is divided by (n - 1);
* eigenvector centrality is computed on the largest strongly connected
  (directed) or connected (undirected) component only; ties in size go to the
  component holding the lowest member index; other members are null;
* negative sub-layers get strength, degree and clustering only (plan Q11);
* the composite renormalises weights over the layers rated for each pair
  (plan Q2); the arithmetic order below matches src/engine/composite.ts so the
  two produce bit-identical weights.

Functions that NetworkX lacks (centralisation, E-I index, cross-group density,
dyad reciprocity, signed in-valence and triads, multiplexity, resilience
reachability) are computed in plain Python from NetworkX primitives; each
fixture section records its source.
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
from itertools import combinations
from pathlib import Path

import networkx as nx
import numpy
import scipy

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures"
DEMO = ROOT / "src" / "demo" / "demo.ona.json"

SEED = 1  # project default random_seed (src/data/defaults.ts)
VIEWS = ["directed", "mean", "min", "max"]
NAN = float("nan")

# Largest gap between nx.effective_size's scipy path and the reference used here.
FAST_PATH_GAP = {"max_abs_difference": 0.0}

TOLERANCES = {
    "default": 1e-9,
    "eigenvector": 1e-6,
    "modularity_fixed_partition": 1e-9,
    "louvain_modularity_floor": 1e-9,
}

# ---------------------------------------------------------------- helpers


def isnan(x):
    return isinstance(x, float) and math.isnan(x)


def clean(x):
    """JSON-safe: NaN and infinities become null."""
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, (numpy.floating,)):
        return clean(float(x))
    if isinstance(x, (numpy.integer,)):
        return int(x)
    return x


def rescale(v, lo, hi):
    return (v - lo) / (hi - lo)


def signed_scale(v, lo, hi):
    return v / hi if v >= 0 else v / (-lo)


def combine(a, b, rule):
    if isnan(a) and isnan(b):
        return NAN
    if isnan(a):
        return b
    if isnan(b):
        return a
    if rule == "mean":
        return (a + b) / 2
    if rule == "min":
        return min(a, b)
    return max(a, b)


def symmetrise(m, n, rule):
    out = [[NAN] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            v = combine(m[i][j], m[j][i], rule)
            out[i][j] = out[j][i] = v
    return out


def matrix(n):
    return [[NAN] * n for _ in range(n)]


# ------------------------------------------------------------ case inputs


class Layer:
    def __init__(self, key, lo, hi, signed=False, role=None, weight=1):
        self.key, self.lo, self.hi, self.signed, self.role, self.weight = (
            key,
            lo,
            hi,
            signed,
            role,
            weight,
        )

    def as_json(self):
        d = {"key": self.key, "min": self.lo, "max": self.hi, "signed": self.signed}
        if self.role:
            d["role"] = self.role
        return d


class Case:
    """n members, layers, raw ratings[layer][i][j] (NaN = missing), attributes."""

    def __init__(self, name, description, ids, layers, ratings, attributes, removals):
        self.name = name
        self.description = description
        self.ids = ids
        self.n = len(ids)
        self.layers = layers
        self.ratings = ratings
        self.attributes = attributes  # {key: {"categories": [...], "values": [...]}}
        self.removals = removals  # list of lists of member indices


def karate_cases():
    G = nx.karate_club_graph()
    n = G.number_of_nodes()
    ids = [f"K{i:02d}" for i in range(n)]
    club = [G.nodes[i]["club"] for i in range(n)]
    attrs = {"club": {"categories": ["Mr. Hi", "Officer"], "values": club}}
    removals = [[0], [0, 33]]
    edges = sorted((min(u, v), max(u, v)) for u, v in G.edges())

    unweighted = matrix(n)
    weighted = matrix(n)
    for u, v in edges:
        unweighted[u][v] = unweighted[v][u] = 1
        w = G[u][v]["weight"]
        weighted[u][v] = weighted[v][u] = w

    # Directed, multi-layer variant with a deterministic weighting over the
    # karate edges. Some directions are rated 0 (a rated non-tie) and some are
    # missing, so symmetrisation, reciprocity and the one-direction rule are
    # all exercised; the valence layer has both signs.
    strength, valence, informal, formal = matrix(n), matrix(n), matrix(n), matrix(n)
    for u, v in edges:
        strength[u][v] = 1 + (3 * u + 5 * v) % 5
        back = (u * v + u) % 6
        strength[v][u] = NAN if (u + v) % 7 == 0 else back
        valence[u][v] = (3 * u + 7 * v) % 7 - 3
        valence[v][u] = NAN if (u * v) % 11 == 0 else (5 * u + 2 * v) % 7 - 3
        informal[u][v] = (u + 2 * v) % 6
        informal[v][u] = (2 * u + v) % 6
        formal[u][v] = (u * 3 + v) % 4
        formal[v][u] = NAN if (u + v) % 9 == 0 else (u + v * 5) % 5

    return [
        Case(
            "karate-unweighted",
            "Zachary's karate club, unweighted: every edge rated 1 on a 0-1 scale in both directions",
            ids,
            [Layer("tie", 0, 1)],
            {"tie": unweighted},
            attrs,
            removals,
        ),
        Case(
            "karate-weighted",
            "Zachary's karate club with Zachary's interaction counts (1-7) as ratings on a 0-7 scale, both directions",
            ids,
            [Layer("tie", 0, 7)],
            {"tie": weighted},
            attrs,
            removals,
        ),
        Case(
            "karate-directed",
            "Karate club edges with four deterministic, asymmetric layers (see karate_cases in the script)",
            ids,
            [
                Layer("strength", 0, 5),
                Layer("valence", -3, 3, signed=True),
                Layer("informal", 0, 5, role="informal"),
                Layer("formal", 0, 5, role="formal"),
            ],
            {"strength": strength, "valence": valence, "informal": informal, "formal": formal},
            attrs,
            removals,
        ),
    ]


def demo_case():
    project = json.loads(DEMO.read_text(encoding="utf-8"))
    members = project["members"]
    ids = [m["id"] for m in members]
    index = {m: i for i, m in enumerate(ids)}
    n = len(ids)
    layers = [
        Layer(l["key"], l["min"], l["max"], l["signed"], l.get("role"), l["default_weight"])
        for l in project["layers"]
        if l["enabled"] and l["scale_type"] != "categorical"
    ]
    keys = {l.key for l in layers}
    ratings = {l.key: matrix(n) for l in layers}
    for t in project["ties"]:
        if t["wave"] != 1 or t["variable"] not in keys or t["value"] is None:
            continue
        ratings[t["variable"]][index[t["rater_id"]]][index[t["ratee_id"]]] = t["value"]
    attrs = {}
    for a in project["attribute_definitions"]:
        if a["type"] == "member_ref":
            continue
        attrs[a["key"]] = {
            "categories": a.get("categories", []),
            "values": [m["attributes"].get(a["key"]) for m in members],
        }
    broker = index["OPE04"]
    removals = [[broker], [broker, index["FIN03"]]]
    return Case(
        "demo",
        "Demo project src/demo/demo.ona.json, enabled core layers, wave 1",
        ids,
        layers,
        ratings,
        attrs,
        removals,
    )


# ------------------------------------------------------ weights per view


def directed_weights(case, layer):
    """Directed weights before symmetrisation. Unsigned: r in 0..1; signed: s in -1..1."""
    n = case.n
    raw = case.ratings[layer.key]
    out = matrix(n)
    for i in range(n):
        for j in range(n):
            v = raw[i][j]
            if i == j or isnan(v):
                continue
            out[i][j] = (
                signed_scale(v, layer.lo, layer.hi) if layer.signed else rescale(v, layer.lo, layer.hi)
            )
    return out


def composite_directed(case, treatments):
    """Mirror of src/engine/composite.ts (same operation order)."""
    n = case.n
    total = 0
    for l in case.layers:
        if l.weight > 0 and (not l.signed or treatments.get(l.key, "positive") == "positive"):
            total += l.weight
    sum_layers = []
    filters = []
    multipliers = []
    for l in case.layers:
        if l.weight <= 0:
            continue
        t = treatments.get(l.key, "positive") if l.signed else "sum"
        if t in ("sum", "positive"):
            sum_layers.append((l, l.weight / total))
        elif t == "filterNegative":
            filters.append(l)
        else:
            multipliers.append(l)
    dw = {l.key: directed_weights(case, l) for l in case.layers}
    out = matrix(n)
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            num = 0.0
            den = 0.0
            for l, omega in sum_layers:
                x = dw[l.key][i][j]
                if isnan(x):
                    continue
                r = max(x, 0.0) if l.signed else x
                num += omega * r
                den += omega
            if den == 0:
                continue
            c = num / den
            for l in filters:
                x = dw[l.key][i][j]
                if not isnan(x) and x < 0:
                    c = 0.0
            for l in multipliers:
                x = dw[l.key][i][j]
                if not isnan(x):
                    c = c * (1 + 0.5 * x)
            if c > 1:
                c = 1.0
            out[i][j] = c
    return out


def refs_for(case):
    """[(ref, kind, source)], kind in unsigned | positive | negative | composite."""
    refs = []
    for l in case.layers:
        if l.signed:
            refs.append((l.key + "+", "positive", l))
            refs.append((l.key + "-", "negative", l))
        else:
            refs.append((l.key, "unsigned", l))
    refs.append(("composite", "composite", None))
    return refs


def ref_directed(case, kind, layer, composite):
    """Directed tie weights of a ref (>= 0; NaN = missing)."""
    n = case.n
    if kind == "composite":
        return composite
    base = directed_weights(case, layer)
    if kind == "unsigned":
        return base
    out = matrix(n)
    for i in range(n):
        for j in range(n):
            x = base[i][j]
            if isnan(x):
                continue
            out[i][j] = max(x, 0.0) if kind == "positive" else max(-x, 0.0)
    return out


def ref_view(case, kind, layer, composite, view):
    """Weights of a ref in a view (NaN = missing). Signed layers symmetrise s, then split."""
    n = case.n
    if view == "directed":
        return ref_directed(case, kind, layer, composite)
    if kind in ("unsigned", "composite"):
        return symmetrise(ref_directed(case, kind, layer, composite), n, view)
    s = symmetrise(directed_weights(case, layer), n, view)
    out = matrix(n)
    for i in range(n):
        for j in range(n):
            x = s[i][j]
            if isnan(x):
                continue
            out[i][j] = max(x, 0.0) if kind == "positive" else max(-x, 0.0)
    return out


def build_graph(n, w, directed):
    G = nx.DiGraph() if directed else nx.Graph()
    G.add_nodes_from(range(n))
    for i in range(n):
        for j in range(n) if directed else range(i + 1, n):
            if i == j:
                continue
            x = w[i][j]
            if not isnan(x) and x > 0:
                G.add_edge(i, j, weight=x, distance=1 / x)
    return G


# ------------------------------------------------------------ metrics


def largest_component(G):
    comps = nx.strongly_connected_components(G) if G.is_directed() else nx.connected_components(G)
    best = None
    for c in comps:
        key = (-len(c), min(c))
        if best is None or key < best[0]:
            best = (key, c)
    return best[1]


def eigenvector(G, n):
    comp = largest_component(G)
    values = [None] * n
    if len(comp) < 2:
        return values, "no_component"
    sub = G.subgraph(comp)
    try:
        ev = nx.eigenvector_centrality(sub, weight="weight", max_iter=10000, tol=1e-14)
    except nx.PowerIterationFailedConvergence:
        return values, "not_converged"
    for v, x in ev.items():
        values[v] = x
    return values, None


def node_metrics(G, n, kind):
    directed = G.is_directed()
    out = {}
    if directed:
        out["in_strength"] = [G.in_degree(i, weight="weight") for i in range(n)]
        out["out_strength"] = [G.out_degree(i, weight="weight") for i in range(n)]
        out["in_degree"] = [G.in_degree(i) for i in range(n)]
        out["out_degree"] = [G.out_degree(i) for i in range(n)]
    else:
        out["strength"] = [G.degree(i, weight="weight") for i in range(n)]
        out["degree"] = [G.degree(i) for i in range(n)]
    cl = nx.clustering(G, weight="weight")
    out["clustering"] = [cl[i] for i in range(n)]
    if kind == "negative":
        return out
    bt = nx.betweenness_centrality(G, weight="distance", normalized=True)
    out["betweenness"] = [bt[i] for i in range(n)]
    bb = nx.betweenness_centrality(G, weight=None, normalized=True)
    out["betweenness_binary"] = [bb[i] for i in range(n)]
    h = nx.harmonic_centrality(G, distance="distance")
    out["harmonic_in"] = [h[i] / (n - 1) for i in range(n)]
    if directed:
        hr = nx.harmonic_centrality(G.reverse(copy=True), distance="distance")
        out["harmonic_out"] = [hr[i] / (n - 1) for i in range(n)]
    ev, reason = eigenvector(G, n)
    out["eigenvector"] = ev
    out["eigenvector_reason"] = reason
    c = nx.constraint(G, weight="weight")
    out["constraint"] = [c[i] for i in range(n)]
    out["effective_size"] = [effective_size(G, i) for i in range(n)]
    fast = nx.effective_size(G, weight="weight")
    for i in range(n):
        a, b = fast[i], out["effective_size"][i]
        if not (isnan(a) or isnan(b)):
            FAST_PATH_GAP["max_abs_difference"] = max(FAST_PATH_GAP["max_abs_difference"], abs(a - b))
    return out


def effective_size(G, v):
    """Burt's effective size of v from NetworkX's own building blocks.

    nx.effective_size(G, weight=...) with scipy installed takes a sparse-matrix
    path that, in NetworkX 3.6.1, divides each mutual weight m_jq by the largest
    mutual weight of q instead of j (a (n,) array broadcast over columns), so it
    disagrees with the function's docstring and with its own per-node path
    (by up to 0.28 on the weighted karate club). The per-node path is used
    instead, via the same helper NetworkX uses, with one change: a member with
    incoming ties only is not treated as isolated (the per-node path checks
    successors only; constraint and the matrix path use both directions).
    """
    nbrs = set(nx.all_neighbors(G, v)) - {v}
    if not nbrs:
        return NAN
    nmw = nx.algorithms.structuralholes.normalized_mutual_weight
    total = 0.0
    for u in nbrs:
        r = sum(
            nmw(G, v, w, weight="weight") * nmw(G, u, w, norm=max, weight="weight")
            for w in set(nx.all_neighbors(G, v))
        )
        total += 1 - r
    return total


def reciprocity(w_directed, n):
    """Overall (nx.overall_reciprocity) and dyad reciprocity on the directed tie set."""
    D = build_graph(n, w_directed, True)
    m = D.number_of_edges()
    overall = nx.overall_reciprocity(D) if m > 0 else NAN
    mutual = asym = 0
    for i in range(n):
        for j in range(i + 1, n):
            a, b = D.has_edge(i, j), D.has_edge(j, i)
            if a and b:
                mutual += 1
            elif a or b:
                asym += 1
    dyad = mutual / (mutual + asym) if mutual + asym > 0 else NAN
    return {"overall": overall, "dyad": dyad, "mutual_dyads": mutual, "asymmetric_dyads": asym}


def centralisation(G, n, nm):
    out = {}
    if G.is_directed():
        for key in ("in_degree", "out_degree"):
            k = nm[key]
            out[key] = sum(max(k) - x for x in k) / ((n - 1) ** 2) if n >= 2 else NAN
    else:
        k = nm["degree"]
        out["degree"] = sum(max(k) - x for x in k) / ((n - 1) * (n - 2)) if n >= 3 else NAN
    if "betweenness_binary" in nm:
        b = nm["betweenness_binary"]
        out["betweenness"] = sum(max(b) - x for x in b) / (n - 1) if n >= 3 else NAN
    return out


def group_order(spec):
    order = list(spec["categories"])
    for v in spec["values"]:
        if v is not None and v not in order:
            order.append(v)
    present = [g for g in order if g in set(v for v in spec["values"] if v is not None)]
    return present


def mixing(G, spec):
    values = spec["values"]
    groups = group_order(spec)
    gi = {g: k for k, g in enumerate(groups)}
    size = [0] * len(groups)
    for v in values:
        if v is not None:
            size[gi[v]] += 1
    excluded = sum(1 for v in values if v is None)
    k = len(groups)
    e = [[0] * k for _ in range(k)]
    internal = external = 0
    per_int = [0] * k
    per_ext = [0] * k
    for u, v in G.edges():
        a, b = values[u], values[v]
        if a is None or b is None:
            continue
        ga, gb = gi[a], gi[b]
        if G.is_directed():
            e[ga][gb] += 1
        else:
            e[ga][gb] += 1
            if ga != gb:
                e[gb][ga] += 1
        if ga == gb:
            internal += 1
            per_int[ga] += 1
        else:
            external += 1
            per_ext[ga] += 1
            per_ext[gb] += 1
    ei = (external - internal) / (external + internal) if external + internal > 0 else NAN
    density = []
    for a in range(k):
        row = []
        for b in range(k):
            if a != b:
                row.append(e[a][b] / (size[a] * size[b]))
            else:
                pairs = size[a] * (size[a] - 1)
                if not G.is_directed():
                    pairs = pairs / 2
                row.append(e[a][a] / pairs if pairs > 0 else NAN)
        density.append(row)
    per_group = []
    for g in range(k):
        t = per_int[g] + per_ext[g]
        per_group.append(
            {
                "group": groups[g],
                "size": size[g],
                "internal": per_int[g],
                "external": per_ext[g],
                "ei": (per_ext[g] - per_int[g]) / t if t > 0 else NAN,
            }
        )
    return {
        "groups": groups,
        "excluded": excluded,
        "internal": internal,
        "external": external,
        "ei": ei,
        "per_group": per_group,
        "density": density,
    }


def components(G):
    if G.is_directed():
        return {
            "weak": sorted((len(c) for c in nx.weakly_connected_components(G)), reverse=True),
            "strong": sorted((len(c) for c in nx.strongly_connected_components(G)), reverse=True),
        }
    return {"connected": sorted((len(c) for c in nx.connected_components(G)), reverse=True)}


def communities(G_sym):
    if G_sym.number_of_edges() == 0:
        return None
    parts = nx.community.louvain_communities(G_sym, weight="weight", resolution=1, seed=SEED)
    parts = sorted((sorted(p) for p in parts), key=lambda p: p[0])
    q = nx.community.modularity(G_sym, parts, weight="weight", resolution=1)
    return {"partition": parts, "modularity": q, "resolution": 1, "seed": SEED}


def resilience(G, removed):
    keep = [v for v in G.nodes() if v not in set(removed)]
    H = G.subgraph(keep)
    n2 = len(keep)
    if G.is_directed():
        comp = {
            "weak": nx.number_weakly_connected_components(H),
            "strong": nx.number_strongly_connected_components(H),
            "largest": max((len(c) for c in nx.weakly_connected_components(H)), default=0),
        }
    else:
        comp = {
            "connected": nx.number_connected_components(H),
            "largest": max((len(c) for c in nx.connected_components(H)), default=0),
        }
    reach = 0
    total_d = 0.0
    total_h = 0
    dist = dict(nx.all_pairs_dijkstra_path_length(H, weight="distance"))
    hops = dict(nx.all_pairs_shortest_path_length(H))
    for u in keep:
        for v in keep:
            if u == v or v not in dist[u]:
                continue
            reach += 1
            total_d += dist[u][v]
            total_h += hops[u][v]
    pairs = n2 * (n2 - 1)
    return {
        "removed": removed,
        "members": n2,
        "components": comp,
        "reachable_pairs": reach,
        "reachability": reach / pairs if pairs > 0 else NAN,
        "average_distance": total_d / reach if reach > 0 else NAN,
        "average_hops": total_h / reach if reach > 0 else NAN,
    }


def path_pairs(n):
    return [(0, n - 1), (n - 1, 0), (1, n // 2), (2, n // 3)]


def shortest_paths(G, n):
    """Weighted shortest paths (distance 1/w) for fixed pairs, with every equally short path."""
    out = []
    for s, t in path_pairs(n):
        if not nx.has_path(G, s, t):
            out.append({"from": s, "to": t, "distance": None, "paths": []})
            continue
        paths = sorted(nx.all_shortest_paths(G, s, t, weight="distance"))
        out.append(
            {
                "from": s,
                "to": t,
                "distance": nx.dijkstra_path_length(G, s, t, weight="distance"),
                "count": len(paths),
                "paths": paths[:200],
            }
        )
    return out


def signed_results(case, layer, view):
    n = case.n
    s = directed_weights(case, layer)
    pos = [0.0] * n
    neg = [0.0] * n
    pos_n = [0] * n
    neg_n = [0] * n
    for i in range(n):
        for j in range(n):
            x = s[j][i]
            if isnan(x) or i == j:
                continue
            if x > 0:
                pos[i] += x
                pos_n[i] += 1
            elif x < 0:
                neg[i] += -x
                neg_n[i] += 1
    out = {
        "in_positive": pos,
        "in_negative": neg,
        "in_positive_count": pos_n,
        "in_negative_count": neg_n,
    }
    if view != "directed":
        sym = symmetrise(s, n, view)
        counts = [0, 0, 0, 0]  # number of negative dyads in the triad
        for i, j, k in combinations(range(n), 3):
            signs = [sym[i][j], sym[j][k], sym[i][k]]
            if any(isnan(x) or x == 0 for x in signs):
                continue
            counts[sum(1 for x in signs if x < 0)] += 1
        balanced = counts[0] + counts[2]
        unbalanced = counts[1] + counts[3]
        out["triads"] = {
            "ppp": counts[0],
            "ppn": counts[1],
            "pnn": counts[2],
            "nnn": counts[3],
            "balanced": balanced,
            "unbalanced": unbalanced,
            "balance_ratio": balanced / (balanced + unbalanced) if balanced + unbalanced else NAN,
        }
    return out


def multiplex(case, view, composite):
    n = case.n
    refs = [(r, k, l) for r, k, l in refs_for(case) if k != "composite"]
    ties = {}
    for ref, kind, layer in refs:
        w = ref_view(case, kind, layer, composite, view)
        pairs = set()
        for i in range(n):
            for j in range(n) if view == "directed" else range(i + 1, n):
                if i != j and not isnan(w[i][j]) and w[i][j] > 0:
                    pairs.add((i, j))
        ties[ref] = pairs
    names = [r for r, _, _ in refs]
    jac = []
    for a in names:
        row = []
        for b in names:
            u = ties[a] | ties[b]
            row.append(len(ties[a] & ties[b]) / len(u) if u else NAN)
        jac.append(row)
    dist = [0] * (len(names) + 1)
    for i in range(n):
        for j in range(n) if view == "directed" else range(i + 1, n):
            if i == j:
                continue
            dist[sum(1 for r in names if (i, j) in ties[r])] += 1
    out = {"refs": names, "jaccard": jac, "overlap_distribution": dist}

    formal = next((l for l in case.layers if l.role == "formal"), None)
    informal = next((l for l in case.layers if l.role == "informal"), None)
    if formal and informal:
        f = ref_view(case, "unsigned", formal, composite, view)
        g = ref_view(case, "unsigned", informal, composite, view)
        counts = {"formal_only": 0, "informal_only": 0, "both": 0, "neither": 0, "not_classified": 0}
        for i in range(n):
            for j in range(n) if view == "directed" else range(i + 1, n):
                if i == j:
                    continue
                a, b = f[i][j], g[i][j]
                if isnan(a) or isnan(b):
                    counts["not_classified"] += 1
                elif a > 0 and b > 0:
                    counts["both"] += 1
                elif a > 0:
                    counts["formal_only"] += 1
                elif b > 0:
                    counts["informal_only"] += 1
                else:
                    counts["neither"] += 1
        out["formal_informal"] = counts
    return out


def composite_matrices(case):
    signed = [l for l in case.layers if l.signed]
    if len(case.layers) < 2 or not signed:
        return None
    out = {}
    for t in ("positive", "filterNegative", "multiplier"):
        m = composite_directed(case, {l.key: t for l in signed})
        out[t] = [x for row in m for x in row]
    return out


def run_case(case):
    n = case.n
    composite = composite_directed(case, {})
    layer_refs = [r for r in refs_for(case) if r[1] != "composite"]
    views = {}
    for view in VIEWS:
        directed = view == "directed"
        refs = {}
        for ref, kind, layer in refs_for(case):
            w = ref_view(case, kind, layer, composite, view)
            G = build_graph(n, w, directed)
            nm = node_metrics(G, n, kind)
            entry = {
                "kind": kind,
                "ties": G.number_of_edges(),
                "weights": [x for row in w for x in row],
                "node": nm,
                "network": {
                    "density": nx.density(G),
                    "reciprocity": reciprocity(ref_directed(case, kind, layer, composite), n),
                    "average_clustering": nx.average_clustering(G, weight="weight"),
                    "components": components(G),
                    "centralisation": centralisation(G, n, nm),
                    "mixing": {a: mixing(G, spec) for a, spec in case.attributes.items()},
                },
            }
            if not directed:
                entry["network"]["communities"] = communities(G)
            if kind != "negative":
                entry["resilience"] = [resilience(G, r) for r in case.removals]
                entry["shortest_paths"] = shortest_paths(G, n)
            refs[ref] = entry
        views[view] = {
            "refs": refs,
            "signed": {l.key: signed_results(case, l, view) for l in case.layers if l.signed},
            "multiplex": multiplex(case, view, composite) if len(layer_refs) > 1 else None,
        }
    return views


def case_input(case):
    return {
        "ids": case.ids,
        "layers": [l.as_json() for l in case.layers],
        "ratings": {
            k: [x for row in m for x in row] for k, m in case.ratings.items()
        },
        "attributes": case.attributes,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "generator": "scripts/generate_fixtures.py",
        "networkx": nx.__version__,
        "scipy": scipy.__version__,
        "numpy": numpy.__version__,
        "python": platform.python_version(),
        "seed": SEED,
        "tolerances": TOLERANCES,
    }
    for case in karate_cases() + [demo_case()]:
        doc = {
            "meta": meta,
            "case": case.name,
            "description": case.description,
            "removals": case.removals,
            "sources": {
                "networkx": "strength, degree, betweenness, harmonic closeness, eigenvector, "
                "constraint, effective size, clustering, density, overall reciprocity, "
                "average clustering, components, Louvain and modularity",
                "python": "symmetrisation, rescaling, composite, dyad reciprocity, centralisation, "
                "E-I index, cross-group density, signed in-valence and triads, multiplexity, "
                "resilience reachability and averages (from networkx shortest paths); "
                "shortest paths use nx.all_shortest_paths and nx.dijkstra_path_length",
            },
            "views": run_case(case),
        }
        doc["networkx_effective_size_fast_path_gap"] = FAST_PATH_GAP["max_abs_difference"]
        FAST_PATH_GAP["max_abs_difference"] = 0.0
        if case.name == "demo":
            doc["demo_sha256"] = hashlib.sha256(DEMO.read_bytes()).hexdigest()
            doc["composite_matrices"] = composite_matrices(case)
        else:
            doc["input"] = case_input(case)
            cm = composite_matrices(case)
            if cm:
                doc["composite_matrices"] = cm
        path = OUT / f"{case.name}.json"
        path.write_text(json.dumps(clean(doc), separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
