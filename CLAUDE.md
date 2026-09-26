# Graticule

Graticule is a browser-only organisational network analysis (ONA) tool for teams of roughly 5–250 members. Analysts import or enter directed, multi-layer relationship ratings (connection strength, valence, formal and informal collaboration, plus optional layers), explore descriptive network metrics on an interactive map with linked matrix and table views, weight layers into a composite, and present captioned saved views to senior audiences. It is descriptive, not diagnostic: it never evaluates individuals. All processing happens client-side (React, TypeScript, Web Worker analysis engine on graphology), with no backend, telemetry or runtime third-party requests, and it is deployed to GitHub Pages.

## Source of truth

`spec.md` is the single source of truth. This file records decisions made during the build. If this file and `spec.md` conflict, stop and ask the owner; do not resolve the conflict silently.

Supporting documents: `docs/plan.md` (architecture, schema, metric definitions), `docs/design-system.md` (tokens and wireframes).

## Decisions

Phase 0 decisions D1–D13 were approved by the owner on 2026-09-26.

| # | Date | Decision | Status | Where |
|---|---|---|---|---|
| D1 | 2026-09-26 | Engine uses a hand-written typed `postMessage` RPC (no Comlink), with latest-wins cancellation and transferable buffers | Approved | plan §1.2 |
| D2 | 2026-09-26 | Missing ratings are `null` in files and store, `NaN` inside the engine; conversion happens only in `engine/input.ts` | Approved | plan §1.2 |
| D3 | 2026-09-26 | Every layer is rescaled to 0–1 before any metric, not only for the composite | Approved | plan §3 |
| D4 | 2026-09-26 | Betweenness via graphology-metrics with `normalized: true`; verified identical to NetworkX (directed and undirected, weighted) | Approved | plan §3.2 |
| D5 | 2026-09-26 | Harmonic closeness, constraint, effective size and clustering are custom implementations (not available, or unweighted, in graphology-metrics) following NetworkX formulas | Approved | plan §3.2 |
| D6 | 2026-09-26 | Harmonic closeness normalised by (n−1); NetworkX fixtures divided accordingly | Approved | plan §3.2 |
| D7 | 2026-09-26 | Louvain tested by fixed-partition modularity (exact) and a modularity floor, not by partition equality | Approved | plan §3.3 |
| D8 | 2026-09-26 | Map renders to canvas from the start; SVG used for export only | Approved | plan §4 |
| D9 | 2026-09-26 | Insight wording lives in `ui/copy/`; the engine emits structured observations | Approved | plan §1.1 |
| D10 | 2026-09-26 | Type family Fira Sans + Fira Sans Condensed (OFL 1.1), tabular figures enabled explicitly | Approved | design-system §3 |
| D11 | 2026-09-26 | Categorical palette Paul Tol "muted" (8 hues, reordered); diverging valence scale orange-brown / grey / blue, 7 steps | Approved | design-system §2 |
| D12 | 2026-09-26 | The UI accent never appears on the map or in any data encoding | Approved | design-system §1 |
| D13 | 2026-09-26 | Zustand store lives under `src/ui/state/` to stay within the suggested structure | Approved | plan §1.1 |
| D14 | 2026-09-26 | TypeScript pinned to 6.0.x and ESLint to 9.x: typescript-eslint 8.70 supports TypeScript < 6.1, and eslint-plugin-jsx-a11y 6.10 supports ESLint ≤ 9. Upgrade when the plugins do | Proposed | `package.json` |
| D15 | 2026-09-26 | Node 22 LTS pinned in `.nvmrc` (Vite 8 needs ≥ 22.12 on the 22 line) | Proposed | `.nvmrc` |
| D16 | 2026-09-26 | Token enforcement is a Vitest test (`tests/unit/design-tokens.test.ts`), not a stylelint rule: it scans every CSS, TS, TSX and HTML file except `tokens.css` for hex and functional colours, named colours, px/rem/em/ch/pt and ms/s values, requires font, line-height, radius and duration properties to use `var()`, and requires shadows to be a whole elevation token. The same file checks `tokens.css` against the design-system tables. ESLint bans the JSX `style` prop so styling cannot bypass the scan. Percent, `fr` and viewport units are allowed as layout proportions. Limit: unitless numbers in TypeScript (for example a `setTimeout` delay) cannot be detected and must be read from tokens by convention | Proposed | `tests/unit/` |
| D17 | 2026-09-26 | Tokens added beyond the design-system tables, all layout or line sizes: `--line-width` 1px, `--focus-width`/`--focus-offset` 2px (§6), `--indicator-width` 2px (active tab underline), `--bar-height` 48px, `--col-left` 320px, `--col-right` 360px, `--attr-label-width` 96px (§5), `--control-height` 32px, `--target-min` 24px (§6), `--measure` 60ch (§5.3), `--dialog-width` 560px and `--menu-min-width` 224px (new values), `--weight-*` 400/500/600 (§3.2), easing curves (§4.4). `r-focus` needs no token because outlines follow the control's radius | Proposed | `src/styles/tokens.css` |
| D18 | 2026-09-26 | Fonts self-hosted from @fontsource 5.3.0 (Fira 4.203), Latin and Latin Extended subsets only: Fira Sans 400/500/600, Fira Sans Condensed 400/500. `npm run fonts` re-copies them. The @fontsource LICENSE has a placeholder copyright line ("Google Inc."); `OFL.txt` replaces it with the notice embedded in the font files | Proposed | `src/assets/fonts/` |
| D19 | 2026-09-26 | The CSP `<meta>` lives in `index.html` exactly as plan §4; a serve-only Vite plugin strips it from the dev server, which needs inline scripts for hot reload. Builds keep it. Vite's `assetsInlineLimit` is 0 so no asset becomes a `data:` URI blocked by `font-src 'self'` | Proposed | `vite.config.ts` |
| D20 | 2026-09-26 | "First-run notice seen" is a UI flag stored in `localStorage` (key `graticule.firstRunNoticeSeen`), not project data. If storage is unavailable the notice shows on every load. The Phase 2 "clear all local data" action must remove this key | Proposed | `src/ui/state/noticeStorage.ts` |
| D21 | 2026-09-26 | `.gitignore` matches `.ona.json`, `.csv` and `.xlsx` case-insensitively (Git is case-sensitive on Linux). Exceptions: `public/templates/**/*.csv` and `*.xlsx` (lower-case extensions only), and `src/demo/*.ona.json` for the demo generator's output. Demo output must therefore be a `.ona.json` in `src/demo/`, not CSV | Proposed | `.gitignore` |
| D22 | 2026-09-26 | GitHub Actions pinned by major tag (checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5, upload-artifact v7; latest tags checked on 2026-09-26), not by commit SHA | Proposed | `.github/workflows/` |
| D23 | 2026-09-26 | E2E tests run against `vite preview` of the production build, so the CSP and `/network/` base path are exercised. `PW_CHROMIUM_EXECUTABLE` optionally points Playwright at a preinstalled Chromium. `SCREENSHOT_DIR=docs/screenshots/phase-1 npm run test:e2e` regenerates the documentation screenshots | Proposed | `playwright.config.ts` |
| D24 | 2026-09-26 | Shell details not fixed by the wireframe: the top bar uses the `field` ground (continuous with the side columns); the ⋯ overflow menu is omitted until it has actions; Present, Import data and Load demo are disabled with an explanatory line until later phases; Hide names toggles state only | Proposed | `src/ui/views/` |
| D25 | 2026-09-26 | The repository was renamed from `Network` to `network` so that the Pages path matches Vite `base` `/network/`: the first deploy served a blank page. `deploy.yml` also accepts `workflow_dispatch` for manual redeploys | Approved | `.github/workflows/deploy.yml` |

## Resolved questions

On 2026-09-26 the owner approved `docs/plan.md` §6 Q1–Q17 with their proposed defaults. Q18 is moot because Phase 0 was merged to `main` by pull request. The flat indigo hue in the categorical palette (design-system §2.1) is accepted as proposed.

## Open questions

None.

## Phase status

| Phase | Content | Status | Accepted |
|---|---|---|---|
| 0 | Plan and design system proposal (no code) | Complete | 2026-09-26 |
| 1 | Scaffold, tooling, CI/CD, tokens, app shell | Built; awaiting deployment and owner acceptance | — |
| 2 | Data model, import and validation, matrix entry, project files, demo dataset | Not started | — |
| 3 | Analysis engine and fixtures | Not started | — |
| 4 | Map view, encodings, legend, member panel | Not started | — |
| 5 | Composite weighting, layouts, linked views, ego view, path, resilience, multi-select | Not started | — |
| 6 | Insights, saved views, presentation mode, anonymisation, ethics notice | Not started | — |
| 7 | Exports | Not started | — |
| 8 | Design, accessibility and performance pass | Not started | — |
| 9 | Documentation and release | Not started | — |
