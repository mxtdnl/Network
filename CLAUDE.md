# Graticule

Graticule is a browser-only organisational network analysis (ONA) tool for teams of roughly 5–250 members. Analysts import or enter directed, multi-layer relationship ratings (connection strength, valence, formal and informal collaboration, plus optional layers), explore descriptive network metrics on an interactive map with linked matrix and table views, weight layers into a composite, and present captioned saved views to senior audiences. It is descriptive, not diagnostic: it never evaluates individuals. All processing happens client-side (React, TypeScript, Web Worker analysis engine on graphology), with no backend, telemetry or runtime third-party requests, and it is deployed to GitHub Pages.

## Source of truth

`spec.md` is the single source of truth. This file records decisions made during the build. If this file and `spec.md` conflict, stop and ask the owner; do not resolve the conflict silently.

Supporting documents: `docs/plan.md` (architecture, schema, metric definitions), `docs/design-system.md` (tokens and wireframes).

## Decisions

Status "Proposed" means awaiting owner approval at the end of Phase 0.

| # | Date | Decision | Status | Where |
|---|---|---|---|---|
| D1 | 2026-09-26 | Engine uses a hand-written typed `postMessage` RPC (no Comlink), with latest-wins cancellation and transferable buffers | Proposed | plan §1.2 |
| D2 | 2026-09-26 | Missing ratings are `null` in files and store, `NaN` inside the engine; conversion happens only in `engine/input.ts` | Proposed | plan §1.2 |
| D3 | 2026-09-26 | Every layer is rescaled to 0–1 before any metric, not only for the composite | Proposed | plan §3 |
| D4 | 2026-09-26 | Betweenness via graphology-metrics with `normalized: true`; verified identical to NetworkX (directed and undirected, weighted) | Proposed | plan §3.2 |
| D5 | 2026-09-26 | Harmonic closeness, constraint, effective size and clustering are custom implementations (not available, or unweighted, in graphology-metrics) following NetworkX formulas | Proposed | plan §3.2 |
| D6 | 2026-09-26 | Harmonic closeness normalised by (n−1); NetworkX fixtures divided accordingly | Proposed | plan §3.2 |
| D7 | 2026-09-26 | Louvain tested by fixed-partition modularity (exact) and a modularity floor, not by partition equality | Proposed | plan §3.3 |
| D8 | 2026-09-26 | Map renders to canvas from the start; SVG used for export only | Proposed | plan §4 |
| D9 | 2026-09-26 | Insight wording lives in `ui/copy/`; the engine emits structured observations | Proposed | plan §1.1 |
| D10 | 2026-09-26 | Type family Fira Sans + Fira Sans Condensed (OFL 1.1), tabular figures enabled explicitly | Proposed | design-system §3 |
| D11 | 2026-09-26 | Categorical palette Paul Tol "muted" (8 hues, reordered); diverging valence scale orange-brown / grey / blue, 7 steps | Proposed | design-system §2 |
| D12 | 2026-09-26 | The UI accent never appears on the map or in any data encoding | Proposed | design-system §1 |
| D13 | 2026-09-26 | Zustand store lives under `src/ui/state/` to stay within the suggested structure | Proposed | plan §1.1 |

## Open questions

Full wording and proposed defaults are in `docs/plan.md` §6.

- Q1 Distinguish "declined to rate" from "not yet entered"?
- Q2 Composite value when only some included layers are rated.
- Q3 Symmetrising when one direction is missing.
- Q4 Sign of a dyad whose two directions disagree (structural balance).
- Q5 Mapping for the signed-layer multiplier.
- Q6 Does the tie-strength threshold affect metrics or display only?
- Q7 Direction of harmonic closeness in the directed view.
- Q8 Eigenvector centrality where the graph is not (strongly) connected.
- Q9 Which layer and view community detection uses.
- Q10 Scope of centralisation.
- Q11 Path-based metrics on negative sub-layers.
- Q12 Rounding path lengths to stabilise tie-breaking.
- Q13 Anonymisation code format and small-group warning.
- Q14 PDF library.
- Q15 SheetJS distribution source.
- Q16 Is layout interpolation bound by the 250 ms UI transition limit?
- Q17 Status colour, or icon and wording only.
- Q18 Push the `phase-0` branch name to the remote as well?
- Design: acceptability of a flat indigo hue in the categorical palette (design-system §2.1).

## Phase status

| Phase | Content | Status | Accepted |
|---|---|---|---|
| 0 | Plan and design system proposal (no code) | Submitted for review | — |
| 1 | Scaffold, tooling, CI/CD, tokens, app shell | Not started | — |
| 2 | Data model, import and validation, matrix entry, project files, demo dataset | Not started | — |
| 3 | Analysis engine and fixtures | Not started | — |
| 4 | Map view, encodings, legend, member panel | Not started | — |
| 5 | Composite weighting, layouts, linked views, ego view, path, resilience, multi-select | Not started | — |
| 6 | Insights, saved views, presentation mode, anonymisation, ethics notice | Not started | — |
| 7 | Exports | Not started | — |
| 8 | Design, accessibility and performance pass | Not started | — |
| 9 | Documentation and release | Not started | — |
