# Phase 8: design, accessibility and performance audit

Audit of the analyst workspace and presentation mode against spec §12 and `docs/design-system.md`, carried out on 2026-09-28. No features were added. Every issue found is listed with its fix and its before and after state.

**How it was done.** `tests/e2e/audit.spec.ts` drives the production build (under `/network/`, with the CSP in force) through 33 states at each of six sizes: 1280 × 800, 1440 × 900, 1920 × 1080, 2560 × 1440, tablet landscape 1024 × 768 and tablet portrait 768 × 1024. It adds 12 states at phone width (390 × 844), colour-vision simulations, a tab-stop focus check, a reduced-motion check and a keyboard walkthrough. Each state is screenshotted into `docs/screenshots/phase-8/` and scanned with axe-core (WCAG 2.0, 2.1 and 2.2 A and AA tags). The raw axe results are in `docs/screenshots/phase-8/axe/`. Every 1440 screenshot was read against the checklist below, and the other widths were read for layout. `tests/unit/contrast.test.ts` computes contrast from `tokens.css`.

```
SCREENSHOT_DIR=docs/screenshots/phase-8 AUDIT_OUT=docs/screenshots/phase-8/axe npx playwright test tests/e2e/audit.spec.ts
npx playwright test tests/e2e/perf.spec.ts        # writes test-results/perf.json
npx vitest run tests/unit/contrast.test.ts tests/unit/phase8.test.ts
```

The states captured at each width are:

- first-run notice;
- empty workspace;
- Project menu;
- Survey tab with no members;
- import dialog;
- validation report with seeded errors (error state);
- project file that cannot be opened (error state);
- loading ("Calculating the network…");
- 250-member map with coverage at 16 % (low-coverage state);
- demo map;
- member panel;
- Explore;
- Insights;
- an insight shown on the map;
- Views, empty and with two saved views;
- Coverage;
- grouped, circular and hierarchy layouts;
- adjacency matrix and rating entry;
- metrics table;
- both comparisons;
- Survey tab;
- Export dialog;
- anonymised map and table;
- presentation, its controls bar, and presentation anonymised;
- the notice reopened from Help.

Screenshots are JPEG at quality 85, so the set of 219 files stays at 40 MB. The colour-vision images are PNG.

## Summary

| Area | Before | After |
|---|---|---|
| axe, serious or critical | 1280, 1440, 2560: 0. 1024: 13 (`scrollable-region-focusable`, the map legend). 1920: 0 in the 31 states reached before a test-script timeout. 768: layout broken; the run stopped after 3 states because the Survey tab was covered by other content. Phone: not tested | 0 at every size and state (7 sizes, 210 states); 0 violations of any impact |
| Tablet (1024, 768) | Three fixed columns: the view is 344 px wide at 1024 and about 88 px at 768, and text is clipped | Two-column tablet layout (D112) |
| Phone (390) | Not read-only; the columns overlap, so it cannot be used | Read-only single column, no horizontal scrolling (D112) |
| Weight change, 250 members and 10,187 ties | Longest frame 450 ms (d3-force settling on the main thread) | Longest frame 50 ms; no frame over 50 ms (D111) |
| Workspace JavaScript on first load | 224 kB transferred; main chunk 502.5 kB (146.5 kB gzip) | 184 kB transferred; main chunk 324.9 kB (100.2 kB gzip) |
| Action names | 6 actions had two or more names | One name per action (list below) |

## Issues found and fixed

### Design

| # | Found (where) | Checklist item | Fix | Before → after |
|---|---|---|---|---|
| 1 | Map with a member selected or an insight highlighted, and presentation mode, at every width: names drawn twice. The faded picture kept each name where the full layout put it, while the highlighted copy was placed again and could land elsewhere (for example "Nikhil Furlong" above and below its member) | Data-ink | Highlighted names now keep the position they have in the cached picture (`labelAnchors`, `scene.ts`); only members without a name there are placed anew | Duplicate names on every highlight → none |
| 2 | First-run notice at 1280 × 800 and shorter: the whole dialog scrolled, with its title out of view and focus scrolled to Continue | Hierarchy, copy | The notice text scrolls inside the dialog under a fixed title and Continue; the text can take focus to scroll by keyboard, and focus still starts on Continue | Title hidden at 1280 × 800 → title and Continue always visible |
| 3 | Project menu: the checkbox item "Keep a copy in this browser" was indented, and wrapped onto two lines, so labels did not share an edge | Hierarchy (alignment) | Every item keeps the check column when a menu has a checkable item; items do not wrap | Two left edges and a wrapped label → one edge, one line |
| 4 | Import validation report (error state): no Cancel; the only ways out were "Choose other files", Import or Escape | Copy (errors say how to proceed) | Cancel added beside "Choose other files" | No visible way to leave → Cancel |
| 5 | Dialog action rows had no gap in the shell styles, so button spacing depended on padding | Token-only styling | `.dialog__actions` gets `gap: var(--s-3)` and wraps | Uneven → one token gap |
| 6 | Insights: member buttons had the chip radius (12 px), which the design system reserves for removable filter chips | Radius by role | `r-control`, as for other buttons | Chip radius on buttons → control radius |
| 7 | `respond.css` set `border-radius: 0` as a raw value | Token-only styling | `var(--r-none)` | Raw value → token |
| 8 | Tablet 1024 and 768: three fixed columns left the view 344 px and about 88 px wide; text was clipped, the Survey tab was covered, and the top bar actions overlapped | Screen sizes (spec §12) | Tablet layout from `--workspace-tablet` (720 px) to `--workspace-desktop` (1280 px): controls column beside the view, the view sticky while the controls scroll, details full width below; the top bar wraps; presentation mode moves its legend under the map | Unusable at 768, cramped at 1024 → map 448 px wide at 768 and 704 px at 1024 |
| 9 | Phone 390: the three columns overlapped and nothing was read-only | Screen sizes ("read-only on phone") | Phone layout below 720 px: one column (controls folded under "Weights and map settings", then the view, then details), and read-only, as listed under "Phone" below | Unusable → read-only, usable, no horizontal scroll |
| 10 | Map legend at tablet heights: a scrolling region that the keyboard could not reach (axe `scrollable-region-focusable`, serious, 13 states at 1024) | Accessibility | The legend region can take focus (`tabIndex=0`), so it scrolls by keyboard | 13 serious → 0 |
| 11 | Insight shown on the map: the legend gained a "Marks" line and covered members near the bottom (Gideon Northing, Wren Transect) | Data-ink | The view is fitted again once the legend has grown, whenever an insight or view highlights members | Members under the legend → all visible |
| 12 | Circular layout: names below the bottom of the circle ran under the legend | Data-ink | Fit to view leaves a line of text above and below the circle | Clipped → clear |
| 13 | Comparison mini maps: names at the left and right edges were clipped ("Xiomara Cadast") | Data-ink | Side padding raised from one label height to about ten characters | Clipped → whole names |
| 14 | Map: ties with no valence rating were drawn in `cat-other` (#B4B9BF), 1.92:1 against the map ground, below the 3:1 needed for data marks | Contrast of data marks | Drawn in `graphite` (7.14:1). It is at least ΔE00 9.7 from every valence step under normal vision and all three simulations (lowest: +3 under protanopia), so a missing rating is not read as neutral. Legend and exports follow. **For owner review (D113)** | 1.92:1 → 7.14:1 |
| 15 | Found while verifying the fixes: the layout followed every width change at once. Chromium briefly reported a 1 px viewport while saving a download, so the workspace switched to the phone layout and back, which removed and remounted the Survey tab and lost a survey being set up (the full-cycle survey test failed 2 of 4 runs) | Screen sizes | A new layout applies only once the width has held for `--workspace-settle` (300 ms) | 2 of 4 runs failed → 0 of 5 |

### Copy and action names

| # | Found | Fix | Before → after |
|---|---|---|---|
| 16 | Open project… and Load demo were confirmed with "Replace project" | The confirmation repeats the verb: "Open project" or "Load demo" | Mismatched verb → same verb |
| 17 | One import action had four names: "Import data…" (Project menu), "Import survey data" (empty state), "Import data" (dialog title), "Import members" (Survey tab) | "Import survey data" everywhere (spec §15.5 names it) | 4 names → 1 |
| 18 | "Show ego network" (member panel) and "Show ego view" (Explore) | "Show ego view" | 2 → 1 |
| 19 | The removal simulation started from "Remove in simulation", "Simulate their removal" and "Run simulation" | "Simulate removal" on all three; "End simulation" ends it | 3 → 1 |
| 20 | "Export member metrics", "Export network metrics" and "Export formal and informal ties" all reported "Table exported as …" | The status names what was exported: "Member metrics exported as …", and so on | Generic noun → button's noun |
| 21 | Rename a view: "Rename", then "Save name", with no status line (every other view action has one) | "Rename", then "Rename view", then "View renamed: …" | Verb changed and no confirmation → one verb, confirmed |

### Performance

| # | Found | Fix | Before → after |
|---|---|---|---|
| 22 | Weight changes on the 250-member map: one 450 ms frame. d3-force settled 300 ticks on the main thread (profiled: many-body, link and collide forces about 400 ms) | Force and grouped layouts with 1,500 or more attractions, after the first, are settled in `layoutWorker.ts` with the same forces and starting state. The result is identical to the main-thread one; a unit test compares them (D111) | Longest frame 450 → 50 ms; frames over 50 ms 1 → 0 |
| 23 | Each map redraw built number formatters per call (`toLocaleString` with options) for 250 members' accessible names: about 86 ms of profile | Formatters cached (`copy/map.ts`); a unit test checks the output is unchanged | About 86 ms → negligible |
| 24 | graphology, mnemonist and events (about 75 kB) were in the workspace bundle, only because the insight rules imported `percentile` from the bootstrap module | `percentile` moved to `engine/metrics/percentile.ts` | In the main chunk → worker only |
| 25 | Papa Parse (18 kB) and the survey tools (49 kB) loaded with the workspace | Loaded on first CSV import and first opening of the Survey tab, which shows "Loading the survey tools…" meanwhile | Eager → on demand |

## Checked and kept

These were reviewed against the checklist and kept, with the reason.

- **Avoid list.** No gradients, cream-and-serif, near-black-and-neon, broadsheet pastiche, identical cards with shadows, glass or blur, emoji or sparkle, hero stat blocks, middle-dot meta strings, arrows in button text, monospace labels, or entrance animations. The only "big number" is the coverage line ("Overall response rate 95%"), which is inline text at `t-0`. The flat indigo categorical hue was accepted in Phase 0.
- **Token-only styling.** `tests/unit/design-tokens.test.ts` (D16) passes. It scans every stylesheet and component. The Phase 8 layout widths are tokens (`--workspace-desktop`, `--workspace-tablet`) that script reads, because custom properties cannot be used in `@media`.
- **Radius by role.** 0 for regions, tabs, menu rows and matrix cells; 4 px for controls, the legend and map notes; 6 px for menus, the zoom group and the presentation controls; 8 px for dialogs; 12 px for filter chips and switch tracks.
- **Elevation.** Shadows appear only on menus, dialogs, the zoom group and the presentation controls.
- **Hierarchy.** Panel sections are separated by space and headings. The boxes that remain are functional: the legend and map notes need a boundary over the edges they sit on, and the mini maps need a frame.
- **The coverage warning appears three times** when coverage is low (top bar, status line, map note). Kept as decided in D57: the map note travels with the map into exports and presentation.
- **Attribute labels wrap** in the member panel ("Team or function") at the 96 px label column set in design-system §5.2. Kept; widening the column would also change the survey and import layouts that share the token.
- **The metrics table scrolls sideways** at 1440 and below, because it has 14 columns. The scroll is native and reachable by keyboard.
- **Faded map names** (members outside a highlight) are 1.89:1 by design (`--map-fade`). They are part of a picture, which WCAG 1.4.3 exempts, and every member is named at full contrast in the table behind the map and in the member panel.
- **"Run a survey" and "Set up a survey"** are two actions: the first opens the Survey tab, the second starts the setup form there.

## Items carried into Phase 8 from earlier reviews (CLAUDE.md)

- **Survey import plan headed "Ties file".** Fixed: headed "Survey responses" (`FileReportSection` takes a heading).
- **Respondent welcome shows the survey title twice** (header and heading). Kept: it is harmless, as the Phase 6R review noted, and removing the header on one screen would make the header inconsistent across the flow.
- **PDF report.** Kept for the owner, because each is a content choice rather than a defect:
  - implementation-level Louvain caveats in the method notes;
  - short pages where sections start on new pages;
  - the report map not being chosen from a saved view;
  - Greek and symbol characters written out.

## Action names

One name per action across its button, tooltip, confirmation, menu item and status line. Tooltips (`title`) exist only on the zoom buttons and the view order buttons, and repeat the button's name.

| Action | Button or menu item | Confirmation | Status line |
|---|---|---|---|
| Open a project file | Project → Open project… | "Replace the open project?" → **Open project** | Opened *title*. |
| Save the project | Project → Save project | — | Project saved as *file*. |
| Import survey data | Empty state, Project menu (Import survey data…), Survey tab | Dialog "Import survey data": Check files → Import *n* valid rows | Imported *n* rows. |
| Load the demo | Empty state, Project → Load demo | "Replace the open project?" → **Load demo** | Demo loaded. |
| Keep a copy in this browser | Project menu (checkbox item) | — | "A copy of this project is now kept…" / "…no longer keeps a copy" |
| Clear local data | Project → Clear local data… | "Clear local data?" → **Clear local data** | Local data cleared. |
| Hide names | Switch in the top bar, Export dialog and presentation controls | — | Names hidden (with the small-group note) |
| Present | Top bar, Views tab | — | — |
| Leave presentation | Controls bar, Escape | — | — |
| Export map / member metrics / network metrics / formal and informal ties / report | Export dialog | — | Map / Member metrics / Network metrics / Formal and informal ties / Report exported as *file*. |
| Export table | Table view | — | Table exported as *file*. |
| Save view | Views tab; Insights → Save as view | — | View saved: *name* |
| Show (a view) | Views tab | — | View shown: *name* |
| Update (a view) | Views tab | — | View updated: *name* |
| Rename (a view) | Views tab → **Rename view** | — | View renamed: *name* |
| Delete (a view) | Views tab | "Delete this view?" → **Delete view** | View deleted: *name* |
| Move up, Move down | Views tab (buttons and tooltips) | — | — |
| Show on the map (insight) | Insights | — | Shown on the map: *rule* |
| Clear highlight | Insights | — | — |
| Show ego view | Member panel, Explore | — | Map note "Ego view: …", exit **Show everyone** |
| Find path, Clear path | Explore; map note | — | Map note "Shortest path from … to …" |
| Add to subgroup, Take out of subgroup, Clear subgroup | Member panel, Explore, map tools | — | — |
| Simulate removal, End simulation | Member panel, Explore (subgroup and resilience), map note | — | Map note "Simulating the removal of *n* members" |
| Run resampling, Cancel | Table (rank stability) | — | Rank ranges for … / Resampling cancelled. |
| Lasso select | Map tools | — | — |
| Zoom in, Zoom out, Fit to view, Release pinned members | Map (buttons and tooltips) | — | — |
| Add filter, Remove filter *x* | Map controls | — | — |
| Edit (layer), Save layer, Delete layer, Add *layer* | Layers | "Delete *layer*?" → **Delete layer** | Layer saved / deleted / added: *label* |
| Enter ratings | Matrix mode | — | — |
| Set up a survey, Create the key, Download key backup, Choose the backup file, Create the survey | Survey tab | — | Survey created |
| Edit survey → Save changes | Survey dashboard | "Create a new version?" → Issue new links to everyone / Issue links only to people without one | Survey saved |
| Close survey, Reopen survey | Survey dashboard | "Close the survey?" → **Close survey** | Survey closed / reopened |
| Unlock, Lock | Survey dashboard | — | Responses can be decrypted… |
| Read responses → Import *n* responses | Survey dashboard | — | *n* responses imported, *m* ratings added |
| Copy link, Export links for mail merge, Export non-responders | Survey dashboard | — | Link copied for *name* / Exported *file* |
| Continue | First-run notice | — | — |

`tests/unit/phase8.test.ts` checks the pairs that had drifted: confirmations, import, ego view, removal simulation, and export statuses.

## Accessibility

**axe-core.** Zero serious or critical violations, and zero of any impact, in all 210 states: 33 at each of the 6 sizes plus 12 at phone width. The results are in `docs/screenshots/phase-8/axe/axe-*.json`.

**Keyboard walkthrough.** This was run as a Playwright script that uses only the keyboard, not by a person at a keyboard. The test "keyboard walkthrough: every analyst flow by keyboard alone" passes:

- Focus starts on Continue in the first-run notice, and Enter closes it.
- The Project menu opens with Enter; the arrow keys move through it, Escape returns focus to its button, and Enter on Load demo loads the demo.
- Centre tabs move and select with the arrow keys.
- On the map, a member takes focus; arrow keys move to a neighbour; Enter opens the member panel and Escape closes it; + zooms and 0 fits.
- In the adjacency matrix, arrow keys move and Enter selects the row's member.
- A table column sorts from its header button.
- A saved view is named and saved with Enter. Present starts with Enter, → steps and Escape leaves.
- The Export dialog opens with Enter and closes with Escape, returning focus to Export.
- The ego view starts from Explore with Enter.
- Help → Data and consent notice reopens the notice.

Earlier suites cover the remaining flows by keyboard:

- rating entry (typing, Delete, paste): `data.spec.ts`;
- subgroup with Shift+Enter, and the table checkboxes: `explore.spec.ts`;
- presentation keys Home, End, Page up, Page down and Space: `present.spec.ts`;
- the whole respondent flow by keyboard alone: `survey.spec.ts`.

**Visible focus.** On the demo workspace with a member selected, the test tabbed through all 87 stops. Every stop shows a visible indicator:

- the 2 px accent outline for controls;
- the outline on the label for segmented controls;
- the ink ring drawn on the canvas for map members;
- the active cell's ring in the rating grid.

**Reduced motion.** With `prefers-reduced-motion: reduce`, no element has a transition or animation duration above 0. A change of layout moves members at once: the canvas never reports a running transition.

**Contrast.** From `tokens.css`, by `tests/unit/contrast.test.ts`.

| Pair | Ratio | Needs |
|---|---|---|
| ink on field / paper | 14.05 / 15.76 | 4.5 |
| graphite on field / paper | 6.37 / 7.14 | 4.5 |
| accent (links, active tab) on field / paper | 6.15 / 6.90 | 4.5 |
| paper on accent (primary button) | 6.90 | 4.5 |
| ink on matrix shades 1–5 | 12.76, 10.21, 8.03, 6.25, 4.76 | 4.5 |
| ink on signed shades −3…+3 | 4.90, 6.18, 7.66, 8.35, 7.49, 6.08, 4.76 | 4.5 |
| Map names, ink on paper halo | 15.76 | 4.5 |
| stone boundaries on field / paper | 3.33 / 3.74 | 3 |
| accent focus ring on field / paper | 6.15 / 6.90 | 3 |
| Valence edges −3…+3 on paper | 8.47, 5.44, 3.66, 3.07, 3.79, 5.66, 8.93 | 3 |
| Valence not rated (graphite) on paper | 7.14 (was 1.92 with cat-other) | 3 |
| Ties with valence hidden (stone) on paper | 3.74 | 3 |
| Shortest path, node outline and selection ring (ink) on paper | 15.76 | 3 |
| Not-rated hatch (stone) on paper | 3.74 | 3 |

Categorical fills against paper range from 1.57 (sand) to 11.84 (indigo). Each node carries an ink outline at 15.76:1, which provides the 3:1 boundary. The group is also named in the member panel and the table.

**Colour-vision simulations.** The simulations use the Machado, Oliveira and Fernandes (2009) model at severity 1.0 in linear sRGB. They cover the demo map (team fill, valence edges) and the Relationship health preset on the circular layout: `docs/screenshots/phase-8/cvd-*-{normal,protanopia,deuteranopia,tritanopia}.png`. Reading them:

- The sign of valence (orange-brown against blue) stays clear under all three conditions.
- Teal, olive and green nodes move closer under deuteranopia and protanopia, as design-system §2.1 predicted. Grouped and circular layouts also carry the group by position.
- A simulation is not a test with people.

**Not done here.** Spec §14 asks for respondent mode to be checked on real iOS Safari and Android Chrome devices, and with VoiceOver and TalkBack. No devices or screen readers are available in this environment, so these checks remain for the owner. The phone-width checks here use Chromium's emulation only.

## Performance

Measured by `tests/e2e/perf.spec.ts` on the synthetic project: 250 members, 10,187 connection-strength ties, each also rated on formal, informal and valence. It runs in headless Chromium with software rendering, 4 CPUs and no GPU, at 1440 × 900 and DPR 1. Frame time is the interval between animation frames recorded in the page. The weight change is 12 slider steps followed by the re-analysis and the layout transition. After-figures are from two runs.

| Measure | Before | After (run 1 / run 2) |
|---|---|---|
| Pan, 60-step drag: median / p95 / longest frame | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 16.8; 16.7 / 16.7 / 16.8 ms |
| Zoom, 40 wheel steps: median / p95 / longest | 16.7 / 16.7 / 16.8 ms | 16.7 / 16.7 / 16.8; 16.7 / 16.8 / 16.8 ms |
| Weight change: median / p95 / longest / frames over 50 ms | 16.7 / 16.7 / **450** ms / 1 | 16.7 / 16.8 / **50** ms / 0 (both runs) |
| Worker, full analysis of the 250-member project | 1,831 ms | 1,824 / 1,825 ms |
| Worker, full analysis of the demo | 191 ms | 211 / 212 ms |
| Worker, weights-only re-analysis (D61) | 376 ms | 370 / 364 ms |
| Shell visible after navigation | 218 ms | 278 / 236 ms (single measurements; within run-to-run noise) |
| Demo loaded to 40 members on the map | 513 ms | 547 / 496 ms |
| 250-member file chosen to 250 members on the map | 4,691 ms | 3,842 / 3,924 ms |
| Script transferred for the empty workspace (compressed) | 224 kB | 184 kB |

The worker times did not change; the Phase 8 work was on the main thread. The longest weight-change frame that remains (50 ms) is React rebuilding the map model when the new analysis arrives.

**Bundle.** From `npm run build`; gzip sizes are Vite's.

| Chunk | Before | After | Loaded |
|---|---|---|---|
| Workspace (`start`) | 502.5 kB (146.5 gzip) | 324.9 kB (100.2 gzip) | Always |
| React and shared UI (`transport` before, `Dialog` after, as the bundler names it) | 230.3 kB | 219.8 kB | Always |
| Survey tools (`SurveyTab`) | in workspace | 49.3 kB (13.4 gzip) | First opening of the Survey tab |
| Papa Parse (`csv`) | in workspace | 18.9 kB (6.9 gzip) | First CSV import |
| SheetJS (`xlsx`) | 362.0 kB (122.3 gzip) | 362.0 kB | First XLSX import (already split in Phase 2) |
| PDF (pdf-lib, fontkit, `pdf`) | 1,142.5 kB (508.6 gzip) | 1,142.5 kB | First report export (already split in Phase 7) |
| Demo (`demo.ona`) | 853.0 kB (25.6 gzip) | 853.0 kB | Load demo |
| Analysis worker | 146.1 kB | 146.1 kB | Worker |
| Layout worker | — | 17.4 kB | Worker, from the first large re-layout |

Vite still warns about chunks over 500 kB. These are the PDF chunk and the demo text, both loaded only on demand.

## Phone

At 390 × 844 the workspace is read-only (D112), and `audit.spec.ts` checks each part of this:

- The empty state offers Load demo, and Open project from the Project menu. It does not offer Run a survey or Import survey data, and the Project menu has no import item.
- The Survey tab is absent. The Layers section (switches and Edit) is not shown. The matrix shows the adjacency matrix only, without "Enter ratings".
- Views can be shown and presented, not saved, updated, renamed, reordered or deleted. Captions are read-only, "Save as view" is absent from Insights, and the coverage threshold is read-only.
- Exploration is kept: weights, map settings (folded under "Weights and map settings"), the member panel, ego view, path, subgroup, simulation, table, comparisons, insights and export. These do not change the project.
- A line under the top bar says what the phone layout does and where to edit.
- No page-level horizontal scrolling occurs in any of the 12 states, and axe reports 0 violations.

The phone-width screenshots were read for layout and read-only behaviour. They are `phone-390-*.jpg`, taken as full-page screenshots.
