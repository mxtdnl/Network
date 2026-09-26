# Graticule design system

Status: approved by the owner on 2026-09-26. These values are transcribed into `src/styles/tokens.css` and become the only source of colour, type, spacing, radius, elevation and motion in the codebase (spec §12).

**Premise.** Graticule is a surveying instrument for organisations. The reference points are topographic maps and survey instruments rather than dashboards: a light, neutral ground on which the data carries all the colour; labels set in a legible humanist sans; structure expressed by position, size and weight. The name is the grid of latitude and longitude on a map, which is plotted but not decorative. The same discipline applies here, so there are no decorative grids.

**How the numbers were produced.** Contrast ratios use the WCAG 2.x relative-luminance formula. Colour-vision simulation uses Machado, Oliveira & Fernandes (2009) matrices at severity 1.0 (full dichromacy), applied in linear sRGB. Colour differences are CIEDE2000 (ΔE00) in CIELAB (D65), via colour-science 0.4.7. **Working thresholds, chosen by me and not a standard:** ΔE00 ≥ 15 "distinct at a glance"; 10–15 "distinct side by side, with care at small sizes"; below 10 "at risk". Simulation is a model; it is not a substitute for testing with people who have colour-vision deficiencies.

---

## 1. Base colours

| Token | Hex | Role |
|---|---|---|
| `ink` | `#1C2127` | Primary text, headings, node outlines, map selection ring, icon strokes |
| `graphite` | `#4E5761` | Secondary text: help text, axis and legend labels, metadata |
| `stone` | `#7A838E` | Non-text UI boundaries that must be perceivable: input borders, slider tracks, checkbox outlines, disabled text is **not** allowed in this colour (fails 4.5:1) |
| `field` | `#EDEFF1` | Panel ground (left and right columns, secondary views' chrome) |
| `paper` | `#FBFCFC` | Map canvas, dialogs, menus, inputs. Cool off-white, lower glare than #FFF on a projector |
| `accent` | `#1D5C8C` | The single UI accent: primary button fill, focus ring, active tab indicator, slider thumb, links. **Never used on the map or in any data encoding** |

Contrast ratios (WCAG, symmetric):

|  | ink | graphite | stone | field | paper | accent |
|---|---|---|---|---|---|---|
| **ink** | — | 2.21 | 4.22 | 14.05 | 15.76 | 2.28 |
| **graphite** | 2.21 | — | 1.91 | 6.37 | 7.14 | 1.04 |
| **stone** | 4.22 | 1.91 | — | 3.33 | 3.74 | 1.85 |
| **field** | 14.05 | 6.37 | 3.33 | — | 1.12 | 6.15 |
| **paper** | 15.76 | 7.14 | 3.74 | 1.12 | — | 6.90 |
| **accent** | 2.28 | 1.04 | 1.85 | 6.15 | 6.90 | — |

White text on `accent`: 7.09.

What the matrix permits:
- Text: `ink` and `graphite` on `field` or `paper` (all ≥ 6.37, AA for all sizes). `accent` as link text on `field`/`paper` (≥ 6.15). `paper` text on `accent` buttons (6.90).
- UI boundaries (WCAG 1.4.11, ≥ 3:1): `stone` on `field` (3.33) and `paper` (3.74).
- `field` against `paper` (1.12) is a tonal separation of regions only. It is never the sole indicator of a control's boundary.

Pairs below 3:1 (ink/graphite, graphite/accent, etc.) are never placed adjacent as foreground and background.

**Status colours.** None. Errors and warnings use an icon, explicit wording and `ink` text (spec §12 reserves colour for data; see plan Q17).

**Dark theme.** None in v1. The projector-first context favours a light ground, and "near-black with one neon accent" is on the avoid list.

---

## 2. Data colour

### 2.1 Categorical palette (node fill: attribute or community)

Paul Tol's "muted" qualitative scheme, eight hues, reordered by me so that the first k colours are maximally separated under the worst of the four vision conditions (greedy max–min on ΔE00). Groups are assigned colours in this order.

| # | Token | Hex | Contrast vs `paper` |
|---|---|---|---|
| 1 | `cat-1` teal | `#44AA99` | 2.74 |
| 2 | `cat-2` indigo | `#332288` | 11.84 |
| 3 | `cat-3` olive | `#999933` | 2.94 |
| 4 | `cat-4` green | `#117733` | 5.51 |
| 5 | `cat-5` sand | `#DDCC77` | 1.57 |
| 6 | `cat-6` rose | `#CC6677` | 3.56 |
| 7 | `cat-7` cyan | `#88CCEE` | 1.71 |
| 8 | `cat-8` wine | `#882255` | 8.49 |
| — | `cat-other` | `#B4B9BF` | 1.92. Used when there are more than 8 groups, labelled "Other (n groups)" in the legend, and for null attribute values, labelled "Not recorded". Worst-case ΔE00 against the palette is 10.3 (vs teal under simulation), so "Other" nodes also carry a dashed outline |

Worst-case minimum pairwise ΔE00 among the first k colours, taking the minimum over normal vision and all three simulations:

| k | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| min ΔE00 | 40.8 | 22.3 | 16.3 | 15.5 | 14.0 | 12.3 | 11.8 |

Distinguishability by condition (all 28 pairs of the full 8-colour set):

| Condition | Closest pair (ΔE00) | Next closest | Pairs below 15 |
|---|---|---|---|
| Normal vision | olive / sand 16.1 | cyan / teal 23.2 | 0 of 28 |
| Deuteranopia | teal / rose 14.3 | olive / rose 14.9 | 2 of 28 |
| Protanopia | indigo / wine 11.8 | teal / rose 14.0 | 2 of 28 |
| Tritanopia | cyan / teal 12.3 | olive / sand 17.1 | 1 of 28 |

Assessment: up to five groups are distinct at a glance under all three simulations; six to eight groups are distinguishable side by side, with the weakest pair being indigo/wine for protanopes. No pair falls below 10.

Mitigations, because colour is never the only channel:
- Every node carries a 1 px `ink` outline (15.76:1 against `paper`), so light fills (sand 1.57, cyan 1.71) still meet the 3:1 non-text contrast requirement at the mark's boundary.
- Hover, the member panel and the tabular alternative always name the group.
- In the "grouped" and "circular by team" layouts, position encodes group redundantly.
- Checked: `accent` vs the categorical palette has a worst-case ΔE00 of 9.1 (vs green); that is acceptable only because `accent` never appears on the map.

The palette contains an indigo. The avoid list targets indigo and blue-violet *gradients and decorative washes*; a flat categorical data hue is neither. Flagged for your judgement.

### 2.2 Diverging valence scale (edge colour)

Seven steps, one per scale point of valence (−3…+3); energy uses the same scale. Negative is a burnt orange-brown, positive a steel blue, and the neutral midpoint a mid grey. Unlike print diverging schemes with a near-white midpoint, the midpoint here is a visible grey, because edges are drawn on a near-white ground and a neutral tie must still be seen. Lightness therefore peaks at the midpoint and falls towards both ends.

| Value | Token | Hex | L* | Contrast vs `paper` |
|---|---|---|---|---|
| −3 | `val-n3` | `#833110` | 31.9 | 8.47 |
| −2 | `val-n2` | `#9D5524` | 43.9 | 5.44 |
| −1 | `val-n1` | `#A67B55` | 55.0 | 3.66 |
| 0 | `val-0` | `#919191` | 60.2 | 3.07 |
| +1 | `val-p1` | `#5188A1` | 54.0 | 3.79 |
| +2 | `val-p2` | `#156D8E` | 42.8 | 5.66 |
| +3 | `val-p3` | `#004D6E` | 30.5 | 8.93 |

Every step meets 3:1 against `paper`. Composite and symmetrised-mean valence values between steps are interpolated in CIELAB.

Distinguishability (ΔE00):

| Condition | Adjacent steps (−3→−2, …, +2→+3) | Smallest adjacent | Same magnitude, opposite sign (±1, ±2, ±3) | L* monotonic from ends to midpoint |
|---|---|---|---|---|
| Normal vision | 11.7, 13.6, 19.2, 17.0, 11.4, 11.0 | 11.0 | 34.1, 43.1, 41.6 | yes |
| Deuteranopia | 10.3, 11.3, 17.8, 16.0, 11.6, 10.0 | 10.0 | 34.8, 43.0, 41.8 | yes |
| Protanopia | 10.6, 13.4, 17.7, 12.8, 10.9, 11.0 | 10.6 | 30.7, 38.4, 36.6 | yes |
| Tritanopia | 10.4, 13.1, 21.1, 22.0, 9.5, 11.0 | 9.5 (+1/+2) | 43.5, 48.8, 46.5 | yes |

Assessment: the sign of a tie (the most important reading) is unambiguous under all conditions (≥ 30.7). Adjacent magnitudes are distinguishable side by side (≥ 10) except +1/+2 under tritanopia (9.5), which is at risk. Because edges are thin, magnitude is not read from colour alone: edge width carries strength, and the member panel and matrix give the exact rating.

### 2.3 Other data encodings

- **Edge style:** formal = solid, informal = dashed (4 px dash, 3 px gap at 1× width), both = solid with a parallel dashed offset only when both are shown. No colour change.
- **Matrix heat-coding:** sequential single-hue ramp derived from `val-p3` towards `paper` for unsigned layers; the diverging scale for signed layers. Missing cells use a diagonal hatch in `stone`, never a colour, so "not rated" cannot be mistaken for 0.
- **Selection and focus on the map:** 2 px `ink` ring outside a 2 px `paper` halo; non-selected members fade to 30 % opacity. No accent.

---

## 3. Type

### 3.1 Family

**Fira Sans**, with **Fira Sans Condensed** for map labels and dense tables (one superfamily). Licence: SIL Open Font License 1.1. Self-hosted as WOFF2 from the `@fontsource/fira-sans` and `@fontsource/fira-sans-condensed` packages, with the OFL text shipped alongside.

Verified in the WOFF2 files: OpenType `tnum` (tabular figures) and `pnum` are present in both widths. Fira's default figures are proportional (digit advances 393–541 units in the Regular), so tabular figures are switched on explicitly (`font-variant-numeric: tabular-nums`) for every numeric cell, axis, legend value and metric.

Rationale grounded in the subject:
- Map labelling puts many short names in a small area. A condensed width of the same design lets node labels fit without switching to a second typeface, so the map and the panels read as one instrument.
- Fira is a humanist sans with open apertures and distinct forms for similar glyphs, which helps at small label sizes and at projector distance.
- It avoids the fonts the spec rules out (Inter, Space Grotesk, Playfair Display) and does not use a display serif (see §7, avoid item 2).
- Alternatives considered: Source Sans 3 (no `tnum` feature in the distributed files I checked; default figures may already be tabular but that was not confirmed), IBM Plex Sans (no `tnum` in the checked files), Atkinson Hyperlegible Next (has `tnum`, strong legibility case, but no condensed width for map labels). Public Sans also qualifies and is a reasonable fallback.

### 3.2 Roles and weights

Weights used: 400 Regular, 500 Medium, 600 SemiBold. Nothing heavier; nothing lighter than 400 (thin strokes wash out on projectors).

| Role | Face | Weight | Step |
|---|---|---|---|
| Body, control labels, table cells | Fira Sans | 400 | `t-0` |
| Emphasis, active control labels, column headers | Fira Sans | 500 | `t-0` / `t--1` |
| Panel headings | Fira Sans | 600 | `t-1` |
| View titles, member name in panel | Fira Sans | 600 | `t-2` |
| Presentation caption | Fira Sans | 500 | `t-5` |
| Presentation view title | Fira Sans | 600 | `t-6` |
| Map node labels | Fira Sans Condensed | 500 | `t--1` (analyst), `t-1` (presentation) |
| Legend labels, help text, axis labels | Fira Sans | 400 | `t--1` |
| Numeric data anywhere | same as its role | same | always `tabular-nums` |

Sentence case throughout. No uppercase transforms, no letter-spaced small labels.

### 3.3 Modular scale

Ratio 1.2 (minor third), base 14 px (analyst desktop), rounded to whole pixels. Line heights on a 4 px grid.

| Step | Exact | Size | Line height | Use |
|---|---|---|---|---|
| `t--1` | 11.67 | 12 px | 16 px | Legend, help, map labels |
| `t-0` | 14 | 14 px | 20 px | Body, controls, tables |
| `t-1` | 16.8 | 17 px | 24 px | Panel headings |
| `t-2` | 20.16 | 20 px | 28 px | View titles, member name |
| `t-3` | 24.19 | 24 px | 32 px | Dialog titles |
| `t-4` | 29.03 | 29 px | 36 px | Empty-state headings |
| `t-5` | 34.84 | 35 px | 44 px | Presentation caption |
| `t-6` | 41.8 | 42 px | 52 px | Presentation title |

Presentation mode keeps the same steps; the canvas scales to the display, and captions sit at `t-5`/`t-6`. At 1920 px width on a typical projected image, `t-5` is the smallest text that carries meaning in presentation mode; legend text is raised to `t-1` there.

---

## 4. Spacing, radius, elevation, motion

### 4.1 Spacing (4 px base)

| Token | Value | Typical use |
|---|---|---|
| `s-1` | 4 px | Icon-to-label gap, dense table cell vertical padding |
| `s-2` | 8 px | Between a control and its value; between related rows |
| `s-3` | 12 px | Control vertical rhythm within a group |
| `s-4` | 16 px | Between groups inside a panel; phone gutter |
| `s-5` | 24 px | Panel inner gutter; between panel sections |
| `s-6` | 32 px | Between major regions; dialog padding |
| `s-7` | 48 px | Presentation-mode margins at 1280 px |
| `s-8` | 64 px | Presentation-mode margins at 1920 px and above |

Hierarchy comes from these gaps and from type: sections inside a panel are separated by `s-5` of space and a `t-1` heading, not by rules or boxes.

### 4.2 Radius, by component role

| Token | Value | Applies to | Reason |
|---|---|---|---|
| `r-none` | 0 | Panels and regions (flush to the window), matrix cells, table rows | Regions are areas of the instrument, not objects; matrix cells must tile without gaps |
| `r-control` | 4 px | Buttons, inputs, selects, segmented controls, tooltips | Small, firm; reads as a precise control |
| `r-chip` | 12 px | Filter chips and removable tokens (24 px tall, so fully rounded ends) | Distinguishes removable items from buttons |
| `r-overlay` | 6 px | Menus, popovers, the presentation step list | Separates floating surfaces from in-flow controls |
| `r-dialog` | 8 px | Dialogs, the first-run notice | Largest surface, largest radius |
| `r-focus` | component radius + 2 px | Focus ring (2 px `accent`, 2 px offset) | Ring stays concentric with its control |

Nodes are circles by definition; edges have round caps at widths ≥ 3 px only.

### 4.3 Elevation (overlays only)

| Token | Shadow | Use |
|---|---|---|
| `e-0` | none | Everything in flow, including panels and all data marks |
| `e-1` | `0 1px 2px rgb(28 33 39 / 0.12), 0 4px 12px rgb(28 33 39 / 0.10)` | Menus, popovers, tooltips, the map's zoom control group |
| `e-2` | `0 2px 4px rgb(28 33 39 / 0.12), 0 12px 32px rgb(28 33 39 / 0.16)` | Dialogs |
| `scrim` | `rgb(28 33 39 / 0.32)` | Behind modal dialogs; no blur |

Shadow colour is `ink` at low alpha. Data marks never receive shadows.

### 4.4 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `m-instant` | 0 ms | — | Selection, hover highlight, reduced motion |
| `m-fast` | 100 ms | `cubic-bezier(0.2, 0, 0, 1)` | Press feedback, toggle thumbs |
| `m-base` | 150 ms | `cubic-bezier(0.2, 0, 0, 1)` | Menus, popovers, tooltips (fade and 4 px travel) |
| `m-panel` | 200 ms | `cubic-bezier(0.2, 0, 0, 1)` in, `cubic-bezier(0.4, 0, 1, 1)` out | Panel open and close, secondary view switch |
| `m-max-ui` | 250 ms | as above | Dialogs; the ceiling for any UI transition |
| `m-layout` | 600 ms (proposed; plan Q16) | `cubic-bezier(0.4, 0, 0.2, 1)` | Node-position interpolation after weight or layout changes |

Rules: motion only follows a user action; nothing animates on load; `prefers-reduced-motion: reduce` sets every token to 0 ms and replaces layout interpolation with an instant change plus an optional, static "show previous positions" overlay.

---

## 5. Wireframes

### 5.1 Analyst workspace (1440 × 900)

In all wireframes, box-drawing lines mark the edges of regions for legibility of the sketch; in the interface those edges are tone changes (`field` vs `paper`), not drawn rules.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Graticule   Acme leadership team 2026          Coverage 86%   Hide names ○   Present   Help  ⋯ │ 48
├──────────────────────────────┬───────────────────────────────────────────┬─────────────────────┤
│ Layers                        │ Map   Matrix   Table   Compare             │ Member   Insights  │
│                               │ ─────                                      │ ────────            │
│ Preset  [Informal network  ▾] │                                           │                     │
│                               │        ●──────●                           │ (member panel,      │
│ Connection strength     0.30  │       ╱        ╲       ○                  │  see 5.2)           │
│ ├──────●───────────────┤      │   ●──●    ◉     ●─────●                   │                     │
│ Informal collaboration  0.40  │       ╲  ╱ ╲  ╱       ╲                  │                     │
│ ├──────────●───────────┤      │        ●    ●          ●                  │                     │
│ Formal collaboration    0.10  │                                           │                     │
│ ├──●───────────────────┤      │                                           │                     │
│ Valence                 0.20  │                                           │                     │
│ ├────●─────────────────┤      │                                           │                     │
│ Negative ties  [Multiplier ▾] │                                           │                     │
│                               │                                           │                     │
│ Composite =                   │                                           │                     │
│  0.30 × Strength              │                                           │                     │
│  + 0.40 × Informal            │                                           │                     │
│  + 0.10 × Formal              │ ┌───────────────────────────┐   ┌───┐     │                     │
│  × valence multiplier         │ │ Node size   Betweenness   │   │ + │     │                     │
│                               │ │  ○ low  ● mid  ⬤ high     │   │ − │     │                     │
│ Show                          │ │ Node fill   Team          │   │ ⤢ │     │                     │
│ Direction   (Directed|Mutual) │ │  ● Finance  ● Ops  ● Sales│   └───┘     │                     │
│ Tie strength at least   0.20  │ │ Edge width  Composite     │             │                     │
│ ├───●──────────────────┤      │ │ Edge colour Valence −3…+3 │             │                     │
│ Filter  [Team: Finance ×] [+] │ │  ▬▬▬▬▬▬▬ (7 steps)        │             │                     │
│ Search  [                   ] │ │ Arrows      Rater → rated │             │                     │
│                               │ └───────────────────────────┘             │                     │
└──────────────────────────────┴───────────────────────────────────────────┴─────────────────────┘
  320 px, field                    flexible, paper                             360 px, field
```

Alignment rationale:
- **Three columns, fixed–fluid–fixed.** The map takes all remaining width because it is the primary instrument; the two 320/360 px columns hold controls and detail, following the left-to-right order "set up → look → inspect".
- **One inner gutter.** Every panel uses `s-5` (24 px) inner padding; all labels in the left column share one left edge, and all numeric values share one right edge (tabular figures, right-aligned), so weights can be compared down a single column.
- **Sliders sit under their labels, spanning the column width minus the value column.** Track starts align with label starts. The value is placed on the label's line rather than after the track, so the track length is identical for every layer and positions are directly comparable.
- **Formula directly beneath the sliders** so the relationship between control and result is spatial (spec §7). It uses the same order as the sliders.
- **Legend overlaid inside the map at lower left, on `paper` without a box shadow** (`e-0`, 1 px `stone` boundary). It stays in view at every zoom level and is the same element composed into exports. Zoom controls at lower right, `e-1`, clear of the legend.
- **Tabs above the centre and right columns** are text with an `accent` underline for the active tab, aligned to the column gutters, not boxed.
- **Top bar, 48 px, no background change.** Coverage is stated as text; below the threshold it becomes a persistent warning line under the bar (icon plus wording) that cannot be dismissed while the condition holds.

### 5.2 Member panel (right column, 360 px)

```
┌─────────────────────────────────────────┐
│ Member   Insights                        │
│ ────────                                 │
│                                          │
│ Priya Raman                              │  t-2, 600
│ Operations lead                          │  t-0, graphite
│                                          │
│ Team        Operations                   │  label: graphite, value: ink
│ Level       L4                           │
│ Location    Leeds                        │
│ Manager     Sam Okafor                   │  link, selects that member
│                                          │
│ Position in the network      Composite ▾ │  t-1, 600
│                                          │
│                        Value   Rank      │  t--1, 500
│ Received strength       4.20    3–6      │
│ Given strength          3.10   11–19     │
│ Connections in             14    2–4     │
│ Connections out            11    9–15    │
│ Bridging (betweenness)  0.182    1–2     │
│ Reach from others       0.611    4–9     │
│ Constraint              0.214   30–36    │
│ Local clustering        0.37    22–31    │
│ Rank ranges from resampling, 95 %  ⓘ     │  t--1, graphite
│                                          │
│ Ties by layer                            │  t-1, 600
│                                          │
│ Connection strength       Given  Received│
│   Sam Okafor                 5       4   │
│   Lena Fischer               4       –   │  – = not rated (legend below)
│   Tom Reyes                  0       3   │
│ Informal collaboration  ▸                │
│ Valence                 ▸                │
│                                          │
│ Show ego network   Remove in simulation  │  text buttons
└─────────────────────────────────────────┘
```

Alignment rationale:
- **Name first, largest.** Identity is established by type size and weight, not by a card or avatar.
- **Attributes as a two-column definition list** (label column 96 px, graphite; value column ink). Each attribute on its own line, never joined with separators.
- **Metrics as a table, not stat tiles.** Values and ranks are right-aligned in tabular figures so magnitudes line up; ranks are intervals from the bootstrap (spec §6), or single ranks with a note when resampling has not been run. Metric labels use plain names; the technical name appears in the explanation popover (ⓘ), which also gives formula and caveats.
- **"Received" before "Given"** follows the reading of in-strength as how others describe the member; both are always shown together to avoid a one-sided reading.
- **Ties grouped by layer, collapsed except the active layer.** Given and received are columns so asymmetry is visible at a glance; a dash marks "not rated", distinct from 0.
- **No judgement words.** Nothing in the panel characterises the person; insights about this member appear only in the Insights tab, phrased as questions.

### 5.3 Presentation mode (1920 × 1080, full screen)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                │
│   Informal collaboration across the leadership team                                            │ t-6
│                                                                                                │
│                                                                                                │
│                          ●────────●                                   Node size                │
│                         ╱          ╲                                  Bridging                 │
│                  ●────●      ◉       ●─────────●                      ○ low  ⬤ high            │
│                         ╲   ╱  ╲   ╱            ╲                                              │
│                          ● ●     ●               ●                    Node fill                │
│                                                                       ● Finance                │
│                  ●────●                                               ● Operations             │
│                                                                       ● Sales                  │
│                                                                                                │
│                                                                       Edge colour              │
│                                                                       Valence −3 … +3          │
│                                                                       ▬▬▬▬▬▬▬                  │
│                                                                                                │
│   Three members connect Finance to the rest of the organisation.                               │ t-5
│   What happens if one leaves?                                                                  │
│                                                                                     3 of 7     │ t-1
└────────────────────────────────────────────────────────────────────────────────────────────────┘
   s-8 margins on all sides; controls hidden; ← → or click to step; Esc to exit
```

Alignment rationale:
- **Single left edge.** Title, map area and caption share the `s-8` left margin; the eye returns to the same line for each slide.
- **Title top, caption bottom, both left-aligned and ragged right**, with the caption limited to about 60 characters per line so it can be read from the back of a room.
- **Legend in a right-hand column** outside the map area, not overlaid, because projected maps are viewed from a distance and overlap costs legibility. Legend text is raised to `t-1`.
- **Step counter** ("3 of 7") bottom right in `graphite`; it is functional navigation information, not decorative numbering.
- **Nothing else.** No top bar, no controls, no cursor after two seconds of inactivity. Anonymisation, if on, applies to labels here as everywhere.

---

## 6. Accessibility notes that bind the tokens

- Focus ring: 2 px `accent` with 2 px offset on `paper`/`field` (≥ 6.15:1). On the map, focus uses the `ink`/`paper` double ring instead, so the accent stays out of the data.
- Minimum target size 24 × 24 px (WCAG 2.2 AA 2.5.8); analyst controls use 32 px height.
- Minimum text size 12 px (`t--1`), used only for secondary text; primary information is at least 14 px.

---

## 7. Self-review against spec §12 "Avoid"

| # | Avoid item | Clear? | Notes and revisions |
|---|---|---|---|
| 1 | Purple, indigo or blue-violet gradients; gradient washes as decoration | Clear | No gradients anywhere in the chrome. The categorical palette includes a flat indigo (`cat-2`) as a data hue; this is not a gradient or decoration, but it is flagged in §2.1 for your judgement. |
| 2 | Warm cream background, high-contrast serif display face, terracotta accent | Clear | No revision was needed. The grounds are cool neutrals (`paper` #FBFCFC, `field` #EDEFF1); no serif is used; the accent is a deep blue. The negative valence colour (`val-n3` #833110) is close to terracotta, so it is restricted to data marks and never appears in the chrome. |
| 3 | Near-black background with a single neon accent | Clear | Light ground; accent is a muted deep blue; no dark theme in v1. |
| 4 | Broadsheet pastiche: hairline rules, zero radius, dense newspaper columns | Clear, after revision | **Revised:** my first draft of the base set included a light divider colour (`#D5D9DE`) for hairlines between panel sections; I removed it, which also freed the slot for `stone` as a proper 3:1 boundary colour. Sections are now separated by `s-5` spacing and headings; regions are separated by the `field`/`paper` tone. Radius varies by role (0 / 4 / 6 / 8 / 12 px); zero is kept only where tiling or flush regions require it. Panels are single-column. The only 1 px lines are functional: control boundaries, node outlines and the legend boundary. |
| 5 | Identical rounded cards with the same soft grey shadow | Clear | No cards. Panels are flush regions without shadows (`e-0`); shadows exist only on overlays, at two distinct levels. The legend is not a card: no shadow, 1 px boundary for legibility over edges. |
| 6 | Glassmorphism, blurred backdrops, glows | Clear | Opaque surfaces; scrim has no blur; focus rings are solid. |
| 7 | Emoji, sparkle or "AI" iconography | Clear | Icons are limited to functional glyphs (info, warning, zoom, fit, close, expand). Insights are labelled "Insights", described as rule-based, and show their rule; no sparkle or assistant imagery. |
| 8 | Hero stat blocks (a big number with a small label) | Clear | No revision was needed. The member panel (§5.2) presents metrics as one table, each value at `t-0` beside its label and rank; coverage in the top bar is inline text. No view has a headline number. |
| 9 | Meta strings joined with middle dots; arrows appended to button text; monospace for small data labels | Clear | Attributes are a labelled list, one per line. Buttons use verbs only ("Present", "Export map"). Numbers use Fira's tabular figures, not a monospace face. The only arrow in the UI is the directed-edge legend entry, which describes arrowheads, and "Rater → rated" is a label, not a button. |
| 10 | Entrance animations on every panel | Clear | Nothing animates on load. Panels animate only when the user opens or closes them (`m-panel`, 200 ms) and not at all under reduced motion. |

Other revisions made during the proposal, not driven by the avoid list:
- **Categorical palette.** My first candidate was Okabe–Ito. Under simulated deuteranopia its closest pair (reddish purple vs grey) measured ΔE00 6.2, below my "at risk" threshold, and its yellow has 1.32:1 contrast on white. Tol "muted" has no pair below 11.8 under any simulation, so I switched.
- **`stone`.** First value `#858E98` gave 2.88:1 on `field`, below the 3:1 needed for input borders; darkened to `#7A838E` (3.33:1).
- **Valence scale.** The first version put `val-p2` and `val-p3` outside the sRGB gamut at the chroma I had targeted; I reduced their chroma. All reported figures are measured from the final hex values.
