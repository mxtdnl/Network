# CLAUDE.md — Graticule

## Project

Graticule is a browser-only organisational network analysis tool for teams and organisations of
roughly 5–250 people. Members rate every other member on a configurable set of directed
relationship variables — connection strength, valence, formal and informal collaboration, and
optional layers such as advice seeking, trust, energy and workflow dependency — and the tool
computes node and network metrics, detects communities, compares formal against informal
structure, simulates the removal of members, and reports rule-based observations phrased as
questions for inquiry rather than verdicts on individuals. It has two modes: an analyst mode for
data entry, validation and exploration, and a presenter mode that steps through saved views for a
boardroom audience. There is no backend and no network traffic at runtime; everything is
processed in the browser, persistence is optional and local, and the application is served as a
static site from GitHub Pages at `/network/`.

## Source of truth

**`spec.md` is the single source of truth for this build.** Decisions taken during the build are
recorded below. If this file and `spec.md` conflict, stop and ask the owner; never resolve the
conflict silently.

Supporting documents, all subordinate to `spec.md`:

- `docs/plan.md` — architecture, worker interface, state shape, data flow, project file schema,
  the metric-by-metric definitions and NetworkX divergences, risks, open questions.
- `docs/design-system.md` — the approved token system. Once approved it is mirrored in
  `src/styles/tokens.css`, which becomes the only source of colour, type, spacing, radius,
  elevation and motion values. Hard-coded values are defects.
- `docs/method-notes.md` — not yet written. Generated from the engine's metric registry so a
  metric cannot be documented one way and computed another.

## Decisions

Every entry is **Proposed** until the owner approves Phase 0. Nothing here has been implemented.

| # | Decision | Rationale | Status |
|---|---|---|---|
| D1 | Add `src/state/` to the structure in `spec.md` §13 | The suggested structure has no home for the store. Putting it in `ui/` would let UI concerns leak into the layer that talks to the worker. `engine/` must stay pure. | Proposed |
| D2 | Zustand for state | Named in `spec.md` §13 as the example; no reason found to deviate | Proposed |
| D3 | graphology + graphology-metrics + graphology-communities-louvain + d3-force, with in-house implementations for what the libraries do not cover | Burt's constraint, effective size, Freeman centralisation, E-I index, cross-group density, structural balance, multiplexity, coverage, resilience, stability and harmonic closeness are implemented in `engine/` against hand-checked or NetworkX-derived fixtures. The library surface is verified in a Phase 1 spike before Phase 3 depends on it. | Proposed |
| D4 | Ties are stored sparse. Absence means unrated; a stored value is always a real response. `null` appears only in the dense grid the matrix editor materialises, and is never written to the project file | Keeps "rated 0" and "not rated" structurally impossible to conflate, which `spec.md` §4.2 requires | Proposed |
| D5 | One Web Worker. The project is uploaded once and cached; later jobs carry parameters only. Results are index-keyed `Float64Array`s transferred, not id-keyed objects cloned. Cancellation is cooperative at chunk boundaries | Makes the weight sliders live at 250 nodes and 10,000 edges without re-serialising the project on every drag | Proposed |
| D6 | Live node positions live in a renderer-owned `Float32Array`, not in the store. Positions enter the store only on pin or on save-view | Storing them would re-render every store subscriber at 60 fps | Proposed |
| D7 | Louvain is tested by modularity and determinism, never by partition identity | Louvain is stochastic and order-dependent; two correct implementations disagree. The UI states that community membership is a model output | Proposed |
| D8 | Type: IBM Plex Sans (SIL OFL 1.1), self-hosted WOFF2 subsets. IBM Plex Mono for formula display in the method notes only. Approved fallback if tabular figures prove unavailable in the subset: Source Sans 3 (OFL 1.1) | Not on the excluded list; drawn for technical documentation; unambiguous numerals; wide weight range for projector legibility. The tabular-figure availability is unverified and is a Phase 1 task | Proposed |
| D9 | Light-ground palette: six base tokens, one UI accent (`#0F5257`), eight categorical hues with a five-hue safe subset, and an orange–blue diverging valence scale with an achromatic midpoint | All figures in `docs/design-system.md` were computed — WCAG contrast, CIEDE2000, and dichromat simulation — rather than asserted. The categorical palette's worst-case separation under all three dichromacies is ΔE00 ≈ 9.9, against Okabe–Ito's 0.6 under tritanopia | Proposed |
| D10 | `--dur-layout` is 600ms, above the 250ms ceiling in `spec.md` §12 | That ceiling governs interface transitions; node interpolation is the §7 "see what moved" requirement and is illegible at 250ms across 250 nodes. **Flagged for the owner rather than assumed** — see Q15 | Proposed, needs owner ruling |
| D11 | Anonymisation and signed-layer exclusion are applied at a single export boundary, not inside each exporter | A new exporter then cannot forget them. Enforced by an end-to-end test asserting no member name appears in any export, including file names and embedded metadata | Proposed |
| D12 | Test fixtures carry a provenance block recording the NetworkX version, the exact call and keyword arguments, the direction convention and any post-processing. CI reads committed fixtures and never installs Python | `spec.md` §6 requires CI to run without Python; provenance is what makes a divergence visible rather than a mystery test failure | Proposed |

## Open questions

Awaiting the owner. Full statements are in `docs/plan.md` §6.

| # | Question | Blocks |
|---|---|---|
| Q1 | What does reciprocity mean in the symmetrised view? Proposal: always report directed reciprocity, plus a rating-agreement statistic | Phase 3 |
| Q2 | Symmetrising a one-sided pair: use the single rating, treat the missing side as 0, or treat the pair as unrated? | Phase 3 |
| Q3 | The signed "multiplier" treatment — confirm the mapping, in particular whether neutral valence should halve the composite | Phase 5 |
| Q4 | Confirm that a rated 0 is a response that produces no edge | Phase 2 |
| Q5 | Confirm the composite becomes the active edge weight and rankings follow the selected node metric — no separate per-member priority score | Phase 5 |
| Q6 | When eigenvector centrality does not converge: report it as unavailable, or substitute a documented alternative? | Phase 3 |
| Q7 | Confirm the categorical primary-channel layer is excluded from the composite and from multiplexity overlap | Phase 3 |
| Q8 | Confirm the conflict layer ships as two separate layer definitions sharing a group | Phase 2 |
| Q9 | E-I index at network, group and member level — all three, or group only? | Phase 3 |
| Q10 | Which phase owns stability, and is B = 100 with rank intervals sufficient? | unscheduled |
| Q11 | If the pinned XLSX reader cannot be installed from the registry CI uses, is switching readers a recordable decision or an ask-first? | Phase 2 |
| Q12 | Should the layer picker show the implied question count per respondent and warn above a threshold? | Phase 2 |
| Q13 | Confirm `docs/method-notes.md` starts at Phase 3 and is only polished at Phase 9 | Phase 3 |
| Q14 | Imported rows with `wave` ≠ 1: reject, or store and filter with a note in the validation report? | Phase 2 |
| Q15 | `--dur-layout` at 600ms versus holding the 250ms ceiling everywhere (D10) | Phase 5 |

## Phase status

| Phase | Content | Accept when | Status |
|---|---|---|---|
| 0 | Plan and design system proposal (no code) | Owner approves | **Awaiting approval** — `docs/plan.md` and `docs/design-system.md` written, 15 open questions raised |
| 1 | Scaffold, tooling, CI/CD, tokens, app shell | A placeholder shell deploys to Pages via Actions; lint, type-check and tests pass in CI | Not started |
| 2 | Data model, import and validation, matrix entry, project files, demo dataset | The validation report catches deliberately seeded errors; a project round-trips save/load with no loss | Not started |
| 3 | Analysis engine and fixtures | All metrics match the NetworkX fixtures within tolerance | Not started |
| 4 | Map view, encodings, legend, member panel | A 250-node synthetic graph pans, zooms and filters without visible lag; every encoding appears in the legend | Not started |
| 5 | Composite weighting, layouts, linked views, ego view, path, resilience, multi-select | All views stay in sync; the displayed formula matches the computed values | Not started |
| 6 | Insights, saved views, presentation mode, anonymisation, ethics notice | A full presentation runs from saved views; anonymisation applies everywhere | Not started |
| 7 | Exports | Every export respects anonymisation and signed-layer exclusion | Not started |
| 8 | Design, accessibility and performance pass | Zero serious or critical axe-core violations; full keyboard operation; performance targets met | Not started |
| 9 | Documentation and release | README, method notes and user guide are complete; release tagged | Not started |

### Phase 1 carried-forward tasks

Raised in Phase 0, to be done before the work that depends on them:

- Verify the actual exports, options and directed-graph support of the pinned graphology
  packages; record what is available and what must be implemented in-house (D3, `docs/plan.md` R1).
- Verify tabular figure availability in the IBM Plex Sans WOFF2 subsets; fall back to Source
  Sans 3 and record it if unavailable (D8).
- Verify that the `<meta>` CSP survives the Vite build and worker loading, with a Playwright test
  that fails on any console CSP violation (`docs/plan.md` R5).
- Confirm the XLSX reader installs from the registry CI uses (Q11, `docs/plan.md` R6).
- Confirm the chosen font's licence permits embedding in the client-generated PDF
  (`docs/plan.md` R10).

## Working rules

- Do not write values for colour, type, spacing, radius, elevation or motion anywhere except
  `src/styles/tokens.css`. A hard-coded value is a defect.
- `engine/` imports nothing from `ui/`, `state/` or `worker/`, and touches no DOM or worker
  global. It must run in plain Node so the fixture tests can exercise it.
- Never conflate a rated 0 with an unrated pair, at any point in the pipeline.
- Never pass a negative weight to a path-based algorithm; the engine asserts this rather than
  trusting the caller.
- Never commit real participant data. `.gitignore` excludes `*.ona.json`, `data/private/`, and
  any `.csv` or `.xlsx` outside `public/templates/`.
- Copy: sentence case, plain language, active verbs. A button's label and its confirmation share
  a verb. Errors state what went wrong and how to fix it. No member is ever labelled good or bad.
