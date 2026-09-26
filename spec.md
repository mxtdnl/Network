# Specification: organisational network analysis (ONA) tool

Product name: Graticule. Repository: `network`, served at `https://<username>.github.io/network/`.

This document is the single source of truth for the build. Decisions made during the build are recorded in `CLAUDE.md`. If the two conflict, stop and ask; do not resolve the conflict silently.

---

## 1. Purpose and audience

- Maps relationships within teams and organisations of roughly 5–250 members.
- Two user modes:
  - **Analyst:** data entry, validation, metrics, exploration.
  - **Presenter:** clean, captioned views shown to C-suite and senior HR.
- The output must be credible in a boardroom: precise, restrained, legible on a projector.

## 2. Scope boundaries

- **Descriptive, not diagnostic.** The tool reports network structure; it does not evaluate individuals. No member is ever labelled good or bad.
- **No backend.** All data is processed in the browser. No analytics, telemetry, or third-party requests at runtime; fonts are self-hosted.
- **Out of scope for v1:** survey distribution and response collection, multi-wave comparison over time. The data model must allow both to be added later: include a `wave` field on ties, defaulting to 1.

## 3. Methodological basis

- **Design:** whole-network (roster) design. Each member rates every other member on each active relationship variable.
- **Direction:** ties are directed. A's rating of B may differ from B's rating of A.
- **Reference:** Hevey, D. (2018). Network analysis: a brief overview and tutorial. *Health Psychology and Behavioral Medicine*. Use it for general concepts only: nodes, weighted and directed edges, centrality, community structure and stability. Much of that paper concerns networks of psychological variables estimated statistically. Those estimation methods do not apply here, because ties are directly observed ratings between people.

## 4. Data model

### 4.1 Members
Each member has an `id` and a `display_name`, plus attributes the user can define. The default attributes are:
- team/function
- level
- location
- tenure band
- formal manager id

### 4.2 Relationship variables (layers)
Each layer is a configurable definition:

```
{ key, label, question_wording, scale_type, min, max, signed, default_weight, enabled }
```

Store unrated pairs as `null`. "Rated 0" and "not rated" must never be conflated anywhere in the pipeline.

Core layers (enabled by default):

| Layer | Scale | Meaning |
|---|---|---|
| Connection strength | 0–5 | 0 = no meaningful working connection, 5 = very strong |
| Valence | −3 to +3, signed | Overall affective quality of the relationship; 0 = neutral |
| Informal collaboration | 0–5 frequency, never → daily | Collaboration outside formal roles, processes or reporting lines |
| Formal collaboration | 0–5 frequency, never → daily | Collaboration required by role, process or reporting line |

Optional layers (disabled by default). Each ships with the suggested question wording below, which the user can edit.

| Layer | Suggested question | Notes |
|---|---|---|
| Advice / information seeking | Who do you go to for work-related information or advice? | Directed. A core ONA relation (Cross & Parker, 2004, *The Hidden Power of Social Networks*) |
| Competence-based trust | I rely on this person's expertise and judgement. | Kept separate from benevolence-based trust. Conceptually drawn from Mayer, Davis & Schoorman (1995) |
| Benevolence-based trust | This person would look out for my interests. | As above |
| Energy | Interactions with this person typically leave me energised / drained. | Signed. Cross & Parker (2004) |
| Decision influence | This person's input materially affects my decisions. | Directed |
| Workflow dependency | I cannot complete my work without this person's output. | Directed |
| Knowledge awareness | I understand what this person knows and can do. | |
| Idea sharing | I would take a new or untested idea to this person. | |
| Interpersonal safety | I can raise a concern or admit a mistake with this person without fear of negative consequences. | A one-to-one (dyadic) adaptation of psychological safety, which Edmondson (1999) defined at team level. Label it as an adaptation in the method notes |
| Conflict | How often do you experience task disagreement / personal friction with this person? | Two sub-layers. Distinct from valence |
| Primary channel | In person / video / chat / email | Categorical, not weighted |

### 4.3 Project file
- A whole project is saved as a single JSON file with extension `.ona.json`.
- It holds a `schema_version`, members, layer definitions, ties, attribute definitions, saved views and settings.
- Loading an older `schema_version` runs an explicit migration function. Unknown future versions are refused with a clear message.

## 5. Input

- **Import.** CSV and XLSX import, with downloadable templates:
  - a members file;
  - a ties file in long format: `rater_id, ratee_id, variable, value[, wave]`.
- **Validation report.** Lists problems with row numbers. It covers:
  - unknown ids;
  - self-ratings;
  - out-of-range values;
  - duplicates;
  - unknown variables;
  - non-numeric values.

  Nothing is coerced silently. The user can import valid rows and skip invalid ones, and the report states how many were skipped.
- **Matrix entry.** A rater × ratee grid for each layer. It is keyboard-navigable and accepts paste from spreadsheets.
- **Local persistence.** Optional IndexedDB persistence, off by default, with a visible indicator when it is on. A single action clears all locally stored data.
- **Demo dataset.** About 40 obviously fictional people across 5 teams. It is built to contain:
  - a broker;
  - a siloed team;
  - a pocket of reciprocated negative valence;
  - a clear mismatch between formal and informal ties.

  The generator is a deterministic script (seeded) committed to the repo.

## 6. Analysis engine

- The engine is a pure TypeScript module with no UI imports. It runs in a Web Worker so the interface stays responsive.
- Every metric has an in-app explanation giving its plain-English meaning, its formula and its caveats.

**Tie aggregation.**
- The user chooses a directed view or a symmetrised view.
- The symmetrised view combines the two directions by mean, minimum or maximum.
- Reciprocity is reported in both views.

**Node metrics.** Computed per layer and for the composite:
- in-strength and out-strength;
- degree;
- betweenness;
- harmonic closeness, which handles disconnected graphs;
- eigenvector centrality, where defined;
- Burt's constraint and effective size;
- local clustering.

For path-based metrics, weight is converted to distance as 1/w. The method notes state this.

**Network metrics.**
- density and reciprocity;
- average clustering;
- components;
- community detection (Louvain) with modularity;
- centralisation;
- E-I index and cross-group density, by any attribute.

**Signed layers (valence, energy).**
- Negative weights are never passed to path-based algorithms.
- Each signed layer is split into positive and negative sub-layers, which are computed separately.
- Report positive and negative in-valence per member.
- Count balanced and unbalanced signed triads (structural balance).

**Multiplexity.**
- Per-pair overlap between layers.
- A dedicated formal–informal comparison classifies each tie as formal-only, informal-only, or both.

**Resilience.** Remove a selected member or set of members and report the change in:
- components;
- reachability;
- average path length.

**Data coverage.**
- Response rate per rater and overall.
- A configurable threshold, default 80%. Below it, a persistent warning states that whole-network metrics may be unreliable.

**Stability (optional).** A node-dropping bootstrap shows how stable the centrality rankings are. Rankings are displayed as intervals, not single ranks.

**Correctness.**
- A committed Python script uses NetworkX to generate reference values for the demo dataset and for Zachary's karate club graph. It writes JSON fixtures to `tests/fixtures/`.
- Vitest asserts that the TypeScript engine matches these values within a stated tolerance.
- CI uses the committed fixtures and does not need Python.
- Document every metric where library conventions differ, for example betweenness normalisation.

## 7. Prioritisation (composite weighting)

- The weight panel has one slider per active layer.
- Each layer is rescaled to 0–1 before combining. Weights are normalised to sum to 1.
- Signed layers offer three treatments, and the user picks one:
  - include the positive component only;
  - filter out negative ties;
  - use the layer as a multiplier on the composite.
- The live formula is shown in plain notation beneath the sliders.
- Presets: Formal structure, Informal network, Relationship health, Custom.
- The composite drives:
  - layout attraction;
  - edge width;
  - the node-size metric;
  - all rankings.
- Weight changes animate node positions by interpolation, so users can see what moved.

## 8. Interactive network map

The network map is an interactive node-link diagram of members and their weighted ties.

**Layouts.**
- Force-directed (d3-force), with attraction proportional to the selected layer or the composite.
- Grouped by attribute.
- Circular by team.
- Formal hierarchy, if manager ids exist, with informal ties overlaid.

**Encodings.** Each visual channel carries one variable, and every encoding is explained in a persistent legend.

| Channel | Variable |
|---|---|
| Node size | Chosen metric |
| Node fill | Chosen attribute or detected community |
| Edge width | Strength or composite |
| Edge colour | Valence, on a diverging scale that is safe for colour-vision deficiencies and has a neutral midpoint |
| Edge style | Formal versus informal, when both are shown |
| Arrowheads | Directed view only |

**Interaction.**
- Layer toggles, a tie-strength threshold slider, attribute filters and search.
- Hovering highlights a member's neighbourhood. Clicking opens a member panel with metrics, ranks, and ties by layer.
- Ego view at 1- or 2-step depth.
- Shortest path between any two members.
- Lasso or multi-select to define a subgroup, showing its internal versus external tie density.
- Drag to pin nodes; zoom, pan, and fit to view.
- Resilience simulation.

**Linked secondary views.** Selection stays in sync across all views.
- Adjacency matrix, sortable by attribute, community or metric, and heat-coded.
- Metrics table, sortable and exportable.
- Side-by-side comparison of two layers.

**Saved views.** A saved view captures weights, filters, layout, positions and selection. Views are named and can be restored.

**Presentation mode.** Full screen with controls hidden. Steps through saved views, with a short caption for each.

**Anonymisation.** A global toggle replaces names with role/team codes. It applies to every view and export.

**Performance.**
- The map stays interactive at 250 nodes and about 10,000 edges.
- Render to canvas if SVG performance degrades. SVG export is always available.

## 9. Insights panel

The panel lists rule-based observations. Each one shows the rule that produced it and links to the view that shows it. Examples:
- **Potential brokers:** high betweenness with low constraint.
- **Peripheral members:** low in-strength across most layers.
- **Possible overload:** highest in-degree on advice or workflow dependency.
- **Silos:** groups with low cross-group density (E-I index).
- **Negative clusters:** clusters of reciprocated negative valence.
- **Formal/informal gaps:** formal ties with no informal counterpart, and informal ties with no formal counterpart.

Wording is neutral and framed as questions for inquiry, never as verdicts on individuals. For example: "Three members connect Finance to the rest of the organisation. What happens if one leaves?"

## 10. Ethics and data protection

- **First-run notice.** It states that:
  - data stays in the browser;
  - participants should give informed consent and be told how results will be used;
  - results should not be used for individual performance evaluation;
  - processing named employee data is likely to engage data protection law, so appropriate advice should be sought.

  The notice can be reopened from the help menu.
- **Signed-layer exclusion.** An option excludes signed layers (valence, energy, conflict) from all exports.
- **Anonymisation.** Available in one click from any view.
- **Content Security Policy.** Set via a `<meta>` tag, because GitHub Pages cannot set headers. The policy restricts `connect-src` to `'self'`, so the claim that data stays in the browser is enforced rather than asserted.

## 11. Exports

- PNG and SVG of the current map view, including the legend and caption.
- CSV of node metrics and network metrics.
- A PDF summary report generated client-side, containing:
  - the map;
  - key metrics;
  - insights;
  - method notes;
  - data coverage.
- Every export respects the anonymisation and signed-layer exclusion settings.

## 12. Design language

The audience is C-suite and senior HR. The tool should read as a precise analytical instrument, not a marketing site or a generic dashboard. Ground visual choices in the subject (mapping, organisational diagnosis), not in generic SaaS conventions.

The approved token system lives in `docs/design-system.md` and `src/styles/tokens.css`. The approved tokens are the only source of colour, type, spacing, radius, elevation and motion values in the codebase. Hard-coded values are defects.

**Requirements.**
- **Type:** one type family, or two clearly distinct ones, self-hosted under an open licence, with tabular figures for all numeric data. Do not default to Inter, Space Grotesk or Playfair Display.
- **Case:** sentence case everywhere. No all-caps labels, no eyebrow labels above headings, no decorative numbering.
- **Colour:** reserved primarily for data. UI chrome is neutral, with a single UI accent that does not compete with data colours. The categorical palette has at most 8 hues.
- **Hierarchy:** carried by type size, weight and spacing rather than boxes and borders. Elevation is used only for overlays (menus, dialogs, popovers). Radius varies by component role rather than using one value everywhere.
- **Motion:** only in response to user action, such as layout transitions and panels opening. UI transitions are 250 ms or less, and `prefers-reduced-motion` is respected.
- **Data-ink discipline:** no 3D, no shadows or gradients on data marks, no decorative gridlines.
- **Accessibility:** WCAG 2.2 AA. The map is fully keyboard-operable: nodes are focusable, and arrow keys move between neighbours. A tabular alternative is available for screen readers.
- **Screen sizes:** desktop-first (1280–2560 px) and projector-legible. Usable on tablet; read-only on phone.

**Avoid.** These are common signs of a generated interface:
- purple, indigo or blue-violet gradients, and gradient washes used as decoration;
- a warm cream background with a high-contrast serif display face and a terracotta accent;
- a near-black background with a single neon accent;
- broadsheet pastiche: hairline rules, zero radius, dense newspaper columns;
- identical rounded cards with the same soft grey shadow;
- glassmorphism, blurred backdrops and glows;
- emoji, sparkle or "AI" iconography;
- hero stat blocks (a big number with a small label);
- meta strings joined with middle dots, arrows appended to button text, and monospace for small data labels;
- entrance animations on every panel.

**Copy.**
- Use plain language and active verbs.
- Name labels by what users understand: "Connection strength", not "edge weight". Technical terms live in the method notes.
- A button's label and its confirmation use the same verb: "Export map" → "Map exported".
- Errors state what went wrong and how to fix it.
- Empty states tell the user the next action.

## 13. Technical stack and repository

**Stack.**
- React and TypeScript (strict mode), built with Vite. Node version pinned in `.nvmrc`.
- d3 (force, scales, zoom), plus graphology with graphology-metrics and graphology-communities-louvain. Equivalents are allowed if the choice is justified in `CLAUDE.md`.
- A lightweight state store, such as Zustand.
- Papa Parse and SheetJS for import.
- Vitest for unit tests, Playwright for end-to-end tests and screenshots, and axe-core for accessibility checks.
- ESLint and Prettier, with a `lint` script.

**Hosting (GitHub Pages).**
- Set Vite `base` to `/network/`.
- No client-side routes that need server rewrites. Use hash-based routing or none.
- Deploy with a GitHub Actions workflow triggered on push to `main`. It installs dependencies, runs lint, type-check and unit tests, builds, then deploys using the official Pages actions: `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. A failing check blocks deployment.
- In the repository settings, set Pages source to "GitHub Actions". This is a manual step for the owner.
- Run the Playwright tests in a separate workflow on pull requests.

**Data safety in a public repository.**
- `.gitignore` excludes the following, with explicit exceptions for the templates and demo generator:
  - `*.ona.json`;
  - `data/private/`;
  - any `.csv` or `.xlsx` outside `public/templates/`.
- The README warns never to commit real participant data.

**Suggested structure.**

```
src/
  engine/        pure analysis (worker entry, metrics, aggregation, composite)
  data/          schema, validation, import, migrations, persistence
  ui/            components, views, map renderer
  styles/        tokens.css, global styles
  demo/          seeded demo generator output
scripts/         demo generator, NetworkX fixture generator (Python)
tests/           unit, fixtures, e2e
docs/            design-system.md, method-notes.md, screenshots/
public/templates/
```

## 14. Phases

| Phase | Content | Accept when |
|---|---|---|
| 0 | Plan and design system proposal (no code) | Owner approves |
| 1 | Scaffold, tooling, CI/CD, tokens, app shell | A placeholder shell deploys to Pages via Actions; lint, type-check and tests pass in CI |
| 2 | Data model, import and validation, matrix entry, project files, demo dataset | The validation report catches deliberately seeded errors; a project round-trips save/load with no loss |
| 3 | Analysis engine and fixtures | All metrics match the NetworkX fixtures within tolerance |
| 4 | Map view, encodings, legend, member panel | A 250-node synthetic graph pans, zooms and filters without visible lag; every encoding appears in the legend |
| 5 | Composite weighting, layouts, linked views, ego view, path, resilience, multi-select | All views stay in sync; the displayed formula matches the computed values |
| 6 | Insights, saved views, presentation mode, anonymisation, ethics notice | A full presentation runs from saved views; anonymisation applies everywhere |
| 7 | Exports | Every export respects anonymisation and signed-layer exclusion |
| 8 | Design, accessibility and performance pass | Zero serious or critical axe-core violations; full keyboard operation; performance targets met |
| 9 | Documentation and release | README, method notes and user guide are complete; release tagged |
