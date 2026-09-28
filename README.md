# Graticule

Organisational network analysis that runs entirely in the browser.

**Live site: <https://mxtdnl.github.io/network/>**

> **Never commit real participant data to this repository.** It is public. Project files (`.ona.json`), survey responses, key backups, link lists and any spreadsheet of names or ratings are personal data. `.gitignore` excludes `*.ona.json` project files, `data/private/`, and any `.csv` or `.xlsx` outside `public/templates/`, but it is a safety net, not a guarantee: check `git status` before every commit. The only data committed here is fictional (the seeded demo, the test fixtures and the anonymised samples of the demo).

## What it does

Graticule maps working relationships in a team or organisation of about 5 to 250 people. Each member rates every other member on one or more relationship layers (connection strength, valence, informal and formal collaboration, and optional layers such as advice, trust, energy or conflict). Graticule then:

- runs the survey itself if you want: personal links, an encrypted response returned by email or file, and an import dashboard, with no server;
- imports CSV or XLSX files, with a validation report that lists every problem by row and never coerces a value silently, or takes ratings typed into a matrix;
- computes descriptive network metrics per layer and for a weighted composite, in a Web Worker, checked against NetworkX reference values;
- draws an interactive map with linked matrix, table and comparison views, ego view, shortest path, subgroups and a resilience simulation;
- lists rule-based insights, worded as questions for inquiry;
- saves captioned views and presents them full screen;
- exports the map (PNG, SVG), metrics (CSV) and a PDF summary report, with names hidden and negative-rating layers left out on request.

## What it does not do

- **It does not evaluate individuals.** It describes network structure. Results must not be used for performance evaluation or decisions about individuals, and the insights never label anyone.
- **It has no backend.** There is no server, account, analytics, telemetry or third-party request at runtime; fonts are self-hosted, and the Content Security Policy restricts `connect-src` to `'self'`. Nothing is stored in the browser unless the analyst turns local storage on.
- **It does not make responses anonymous.** Survey responses are confidential: the analyst sees who gave which ratings, because the whole-network method needs it.
- **It does not prove who answered a survey.** Tokens detect duplicates; without a server, a forwarded link can be answered by someone else (see `docs/method-notes.md`, section 9).
- **It does not estimate statistical networks** of psychological variables, and does not compare waves over time (ratings carry a wave number; only wave 1 is analysed in v1).
- **It does not host a collection service.** Responses travel as encrypted files or text; the transport is isolated so a server could be added later.

## Documentation

| Document | For |
|---|---|
| [`docs/user-guide.md`](docs/user-guide.md) | Analysts: preparing data, running a survey, importing, reading each metric, weighting, saved views and presentations, exports, ethics and consent |
| [`docs/method-notes.md`](docs/method-notes.md) | Every metric, rule and threshold, with formulas, caveats and the differences from NetworkX |
| [`docs/respondent-help.md`](docs/respondent-help.md) | A one-page guide for survey participants |
| [`spec.md`](spec.md) | The specification, the single source of truth |
| [`CLAUDE.md`](CLAUDE.md) | Decisions made during the build |
| [`docs/design-system.md`](docs/design-system.md), [`docs/design-audit.md`](docs/design-audit.md) | Design tokens and wireframes; the Phase 8 design, accessibility and performance audit |

The user guide, the method notes and the respondent help are also shown inside the app, under Help.

## Local development

Requires Node 22 (the version in `.nvmrc`, at least 22.12).

```sh
npm ci              # installs SheetJS from cdn.sheetjs.com (pinned by URL and integrity hash), so that host must be reachable
npm run dev         # development server at http://localhost:5173/network/ (the CSP is applied to builds only)
npm run lint        # ESLint and Prettier
npm run typecheck
npm test            # Vitest unit tests, including the NetworkX fixture comparison and the design-token check
npm run build       # production build in dist/
npm run preview     # serves dist/ at http://localhost:4173/network/ with the CSP in force
npm run test:e2e    # Playwright against the production build
```

Playwright needs Chromium: run `npx playwright install chromium` once, or set `PW_CHROMIUM_EXECUTABLE` to a Chromium already installed. Some end-to-end specs regenerate documentation when an environment variable names a directory:

```sh
GUIDE_DIR=docs/user-guide npx playwright test tests/e2e/guide.spec.ts          # user guide screenshots
SAMPLES_DIR=docs/samples npx playwright test tests/e2e/export.spec.ts          # anonymised sample exports
SCREENSHOT_DIR=docs/screenshots/phase-8 AUDIT_OUT=docs/screenshots/phase-8/axe \
  npx playwright test tests/e2e/audit.spec.ts                                   # design and accessibility audit
```

Code layout: `src/engine/` (pure analysis, run in a worker), `src/data/` (schema, import, validation, migrations, persistence), `src/survey/` (survey model, links, encryption), `src/respond/` (the respondent route), `src/ui/` (workspace, map, views, exports), `src/styles/` (`tokens.css` is the only source of design values), `scripts/`, `tests/`.

## Regenerating the demo data and fixtures

The demo is a seeded, fictional organisation of 40 people in five teams. Its generator and the reference fixtures are committed, and both are deterministic.

```sh
npm run demo        # writes src/demo/demo.ona.json from scripts/generate-demo.ts (seed 20260926)

python3 -m pip install -r scripts/requirements-fixtures.txt   # NetworkX 3.6.1, SciPy 1.17.1, NumPy 2.4.6
npm run fixtures    # python3 scripts/generate_fixtures.py: writes tests/fixtures/*.json

npm run templates   # rebuilds the XLSX import templates from the CSV ones in public/templates/
npm run fonts       # re-copies the self-hosted Fira files from @fontsource into src/assets/fonts/
```

Regenerate the fixtures whenever the demo, the fixture script or a metric convention changes: the demo fixture records the demo file's SHA-256, and a unit test fails if they disagree. CI uses the committed fixtures and does not need Python. A unit test also checks that `src/demo/demo.ona.json` is byte-identical to the generator's output.

## Deployment

The site is deployed to GitHub Pages by GitHub Actions.

- **`.github/workflows/deploy.yml`** runs on every push to `main` (and on demand from the Actions tab): `npm ci`, lint, type-check, unit tests and build, then `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. A failing check stops the deployment.
- **`.github/workflows/e2e.yml`** runs the Playwright tests on every pull request and uploads the screenshots and report.
- In the repository settings, Pages → Source must be set to **GitHub Actions** (a one-off manual step).
- Vite's `base` is `/network/`, matching the repository name; the app uses hash routes only (the survey links use `#/respond/…`), so Pages needs no rewrites.
- Releases are tagged on `main` (`v1.0.0` onwards), with release notes on GitHub.

To release: merge to `main`, wait for the deploy workflow to finish, check the live site (fresh load, first-run notice, demo, every view and export, with no console errors or CSP violations), then tag the merge commit.

## Licences

Graticule's own code has no licence file in this repository; until one is added, all rights are reserved by the owner.

**Fonts.** Fira Sans and Fira Sans Condensed 4.203 (Copyright 2012–2016, The Mozilla Foundation and Telefonica S.A.), self-hosted from @fontsource 5.3.0 under the SIL Open Font License 1.1; the licence is in `src/assets/fonts/OFL.txt`, and the fonts are embedded in exported SVG and PDF files under the same licence.

**Runtime dependencies** (shipped in the built site):

| Package | Version | Licence |
|---|---|---|
| react, react-dom, scheduler | 19.3.0, 19.3.0, 0.28.0 | MIT |
| zustand | 5.0.15 | MIT |
| d3-force, d3-zoom, d3-selection, d3-dispatch, d3-drag, d3-interpolate, d3-color, d3-quadtree, d3-timer, d3-transition | 3.x | ISC |
| d3-ease | 3.0.1 | BSD-3-Clause |
| graphology, graphology-metrics, graphology-communities-louvain, graphology-components, graphology-shortest-path, graphology-indices, graphology-utils, graphology-types | 0.26.0, 2.4.2, 2.0.2, 1.5.4, 2.1.0, 0.17.0, 2.5.2, 0.24.8 | MIT |
| mnemonist, obliterator, pandemonium, events, @yomguithereal/helpers | 0.39.8, 2.0.5, 2.4.1, 3.3.0, 1.1.1 | MIT |
| papaparse | 5.7.0 | MIT |
| xlsx (SheetJS Community Edition) | 0.20.3 | Apache-2.0 |
| pdf-lib, @pdf-lib/fontkit, @pdf-lib/standard-fonts, @pdf-lib/upng | 1.17.1, 1.1.1, 1.0.0, 1.0.1 | MIT |
| pako | 1.0.11 | MIT and Zlib |
| tslib | 1.14.1 | 0BSD |

The list is `npm ls --omit=dev --all` with each package's declared licence. Development tools (Vite, TypeScript, ESLint, Prettier, Vitest, Playwright, axe-core, pdfjs-dist, tsx and the type packages) are not shipped; their licences are in `node_modules/` after `npm ci`. The reference fixtures are produced with NetworkX (BSD-3-Clause), SciPy and NumPy (BSD-3-Clause), which are not shipped either.
