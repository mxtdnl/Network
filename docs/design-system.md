# Graticule — design system

Status: proposal. Nothing here is binding until the owner approves it.
Source of truth for requirements: `spec.md` §12. When approved, these values become
`src/styles/tokens.css` and are the only source of colour, type, spacing, radius, elevation and
motion in the codebase.

**How the numbers in this document were produced.** Contrast ratios are WCAG 2.x relative
luminance ratios. Colour differences are CIEDE2000 (ΔE00) computed in CIELAB under D65. Colour
vision deficiency figures come from a dichromat simulation of the Viénot–Brettel–Mollon type:
sRGB is linearised, converted to LMS, the missing cone's response is reconstructed from the
other two, and the result is converted back and clipped to sRGB. The ΔE00 implementation was
verified against eight published reference pairs before any palette was scored. Two honest
caveats: the tritan model is the least reliable of the three, and dichromat simulation models
the severe case, so anomalous trichromats will see more separation than these figures suggest.

---

## 1. Base colours

Six. The ground is a cool, faintly green-grey paper — the tone of a survey sheet rather than of
an editorial page or a dashboard. Chroma is kept low everywhere in the chrome so that the only
saturated things on screen are data.

| Token | Hex | Role |
|---|---|---|
| `--c-canvas` | `#FAFBFA` | The map ground and the ground of any surface that carries data. The lightest surface, so data marks sit at maximum separation. |
| `--c-paper` | `#EFF1F0` | Application chrome: app bar, docked panel backgrounds, table header band. Recedes behind the canvas. |
| `--c-rule` | `#D5DAD8` | Separators, matrix axis lines, disabled control outlines. Used in three places only (§8). |
| `--c-ink-muted` | `#5A6764` | Secondary text, axis labels, control borders, inactive icons. |
| `--c-ink` | `#10201D` | Primary text, node outlines, focus ring core. |
| `--c-accent` | `#0F5257` | The single UI accent: focus rings, selected control state, active tab marker, links. Never used on a data mark. |

### Contrast ratios against each other

| | canvas | paper | rule | ink-muted | ink | accent |
|---|---|---|---|---|---|---|
| **canvas** | — | 1.09 | 1.36 | 5.69 | 16.24 | 8.56 |
| **paper** | 1.09 | — | 1.25 | 5.20 | 14.85 | 7.83 |
| **rule** | 1.36 | 1.25 | — | 4.17 | 11.91 | 6.28 |
| **ink-muted** | 5.69 | 5.20 | 4.17 | — | 2.86 | 1.50 |
| **ink** | 16.24 | 14.85 | 11.91 | 2.86 | — | 1.90 |
| **accent** | 8.56 | 7.83 | 6.28 | 1.50 | 1.90 | — |

What this buys, and where it does not:

- Body text (`ink` on `canvas` 16.24, on `paper` 14.85) and secondary text (`ink-muted` on
  `canvas` 5.69, on `paper` 5.20) both clear AA for normal text at every size in the scale.
- The accent clears AA as text on both surfaces (8.56 / 7.83) and as a 2px focus ring.
- `rule` against `canvas` is 1.36. That is deliberate and it is why rules are decorative only.
  **Any border that conveys meaning — a control's edge, a focusable element's boundary — uses
  `ink-muted` (5.69 on canvas, 4.17 against `rule`), never `rule`.** This is a lint-checkable
  rule, not a convention.
- `accent` on `ink` is 1.90, so the accent is never placed on dark. There is no dark surface in
  the system; see §9 on presentation mode.

### Status colours

Three, outside the data palette, used only in validation reports and confirmations.

| Token | Hex | On canvas | On paper | Role |
|---|---|---|---|---|
| `--c-error` | `#99331C` | 7.12 | 6.51 | Rejected rows, blocking errors |
| `--c-warning` | `#7A5A0A` | 6.15 | 5.62 | Coverage below threshold, skipped rows |
| `--c-ok` | `#2E6B4F` | 6.08 | 5.56 | Completed actions |

All three carry an icon and a word as well as a colour; none is the sole carrier of meaning.

---

## 2. Categorical palette

Eight hues, the maximum the spec allows. They were chosen by anchoring on a cartographic
register — slate, sienna, moss, ochre, plum, verdigris, rose, graphite — and then moving each
anchor by at most ΔE00 9 under a search that maximised the *worst* pairwise separation across
normal vision and all three dichromacies simultaneously, subject to chroma ≤ C\*46 and contrast
≥ 3.0 against the canvas.

| Token | Hex | L\* | Contrast vs canvas |
|---|---|---|---|
| `--c-cat-slate` | `#04589E` | 37 | 6.99 |
| `--c-cat-sienna` | `#8F4425` | 38 | 6.70 |
| `--c-cat-moss` | `#69774F` | 48 | 4.65 |
| `--c-cat-ochre` | `#A07F31` | 55 | 3.63 |
| `--c-cat-plum` | `#673461` | 30 | 9.04 |
| `--c-cat-verdigris` | `#5A9C9A` | 60 | 3.04 |
| `--c-cat-rose` | `#DB7174` | 60 | 3.06 |
| `--c-cat-graphite` | `#6D778B` | 50 | 4.34 |

Assignment is by position in this list, so a five-team project gets slate, sienna, moss, ochre,
plum — the five with the widest separation appear first.

### Distinguishability under simulation

Minimum pairwise ΔE00 across all 28 pairs, and the pair that produces it:

| Condition | Min ΔE00 | Worst pair | 2nd worst | 3rd worst |
|---|---|---|---|---|
| Normal | 18.0 | slate / graphite | 18.8 moss / ochre | 22.0 verdigris / graphite |
| Deuteranopia | 9.9 | verdigris / graphite | 10.0 sienna / moss | 11.6 ochre / rose |
| Protanopia | 9.9 | moss / ochre | 10.4 moss / rose | 12.1 verdigris / rose |
| Tritanopia | 10.1 | ochre / rose | 11.0 moss / graphite | 11.4 sienna / plum |

For reference, the same measurement applied to the Okabe–Ito palette — the usual benchmark for
colour-vision-safe categorical colour — gives 21.7 normal, 11.6 deuteranopia, 12.3 protanopia
and **0.6 tritanopia**, where its vermilion and reddish-purple become effectively the same
colour. This palette is slightly tighter than Okabe–Ito under the two red-green deficiencies and
very much better under tritanopia, which is the trade I want for a tool whose colours identify
named teams in front of an audience of unknown vision.

A minimum of about ΔE00 10 means adjacent categories are reliably *different*, not that they are
easy to name from memory. Two mitigations, both required, not optional:

1. **Colour is never the only channel.** Every view that uses categorical fill also offers the
   grouped or circular layout, in which position carries the same variable, and the legend is
   persistent. The adjacency matrix and metrics table carry the group as text.
2. **A five-hue safe subset** — slate, sienna, ochre, plum, verdigris — is offered as a palette
   option and is used automatically when a project has five or fewer groups. Its minimum ΔE00
   is 26.0 normal, 14.2 deuteranopia, 12.4 protanopia, 11.4 tritanopia.

### The accent does not compete

The nearest data hue to `--c-accent` `#0F5257` is slate at ΔE00 21.7, then graphite 23.9, moss
25.2, verdigris 27.8. Verdigris is the nearest in hue but sits 29 L\* points lighter. The accent
is additionally constrained by role: it appears only on chrome — focus rings, the active tab
marker, selected control state — at stroke widths of 1–2px, never as a fill on the map.

### Labels on a categorical fill

Node labels are drawn on the canvas beside the node, never inside the fill, so fill contrast does
not gate legibility. Where a fill must carry text — a legend chip, a filter tag — the chip uses a
15% tint of the hue over `--c-canvas` with `--c-ink` text and a 1px border in the full-strength
hue. This avoids the case of ochre, whose best label contrast in either direction is 4.47 and so
clears no threshold at full strength.

---

## 3. Diverging valence scale

Seven steps for −3…+3. Warm (sienna-orange) for negative, cool (blue) for positive, with a
neutral, genuinely achromatic midpoint. Orange–blue is the most robust diverging pair under
red-green deficiency because the two arms differ along the yellow–blue axis, which all three
common deficiencies preserve to some degree.

| Value | Token | Hex | L\* | Contrast vs canvas |
|---|---|---|---|---|
| −3 | `--c-valence-n3` | `#88401A` | 36 | 7.24 |
| −2 | `--c-valence-n2` | `#A25E38` | 47 | 4.83 |
| −1 | `--c-valence-n1` | `#B18163` | 58 | 3.27 |
| 0 | `--c-valence-0` | `#999596` | 62 | 2.85 |
| +1 | `--c-valence-p1` | `#678FB8` | 58 | 3.27 |
| +2 | `--c-valence-p2` | `#3773AD` | 47 | 4.80 |
| +3 | `--c-valence-p3` | `#005898` | 37 | 7.10 |

### Distinguishability under simulation

| Condition | Min adjacent step ΔE00 | −1/+1 | −2/+2 | −3/+3 |
|---|---|---|---|---|
| Normal | 9.7 | 33.5 | 40.3 | 41.8 |
| Deuteranopia | 9.8 | 40.8 | 51.0 | 54.3 |
| Protanopia | 9.9 | 36.1 | 44.7 | 47.3 |
| Tritanopia | 7.7 | 67.9 | 70.4 | 68.2 |

The property that matters most for this scale is not step resolution but **sign**: a viewer must
never mistake a negative tie for a positive one. The two arms are separated by ΔE00 ≥ 33 in every
condition tested, and ≥ 40 under deuteranopia. The scale is monotone in lightness within each
arm, so it also survives greyscale printing as magnitude, though not as sign — the PDF report
therefore carries a signed numeric legend, not only the swatch strip.

The midpoint sits at contrast 2.85 against the canvas, the lowest-contrast mark in the system.
That is intentional: a neutral relationship should be the quietest thing on the map. Exact values
are always available in the member panel and the adjacency matrix, which are the accessible
equivalent for this encoding.

---

## 4. Type

### Family

**IBM Plex Sans**, SIL Open Font License 1.1, self-hosted as subsetted WOFF2. One family for
everything. **IBM Plex Mono**, same licence, is admitted for one purpose only: displaying
formulae in the method notes and the metric explanations. It is never used for data labels,
small labels, or anything in the interface chrome — the spec names that as a tell, and it is.

Rationale, grounded in the subject rather than in taste:

- A map is read at two distances at once. Node labels are read at 11–13px at arm's length while
  the same screen is read from six metres on a projector. That needs a family with a large
  x-height relative to cap height, open apertures, and a weight range wide enough to separate
  label from ground without resorting to boxes. Plex was drawn for technical documentation and
  interface work and has eight weights with matching italics.
- Numerals are the product. Metric tables, matrix cells, weight values and rank intervals are
  all numeric, and they must align in columns. Plex's numerals are unambiguous at small sizes —
  in particular the one, the lowercase l and the capital I remain distinct, which matters when a
  member code reads `L1-07`.
- It is not on the excluded list and it is not the current default. Inter, Space Grotesk and
  Playfair Display are excluded by the spec; Plex reads as an instrument face rather than a
  marketing face, and its slight squareness suits a grid-derived product.

**Confidence note.** I am confident about the licence (OFL 1.1) and the weight range. I am *not*
fully confident that the shipped WOFF2 exposes a `tnum` feature rather than tabular figures by
default, and that difference changes how the numeric utility is written. Phase 1 must verify
this in the actual font files before any table is built. If tabular figures turn out not to be
available in the subset, the approved fallback is **Source Sans 3** (also OFL 1.1), and the
substitution is recorded in `CLAUDE.md` rather than made silently.

### Roles

| Token | Size | Line height | Weight | Used for |
|---|---|---|---|---|
| `--type-micro` | 11px | 16px | 450 | Matrix row and column heads, axis ticks, legend value labels |
| `--type-small` | 13px | 20px | 400 / 500 | Table cells, control labels, secondary panel text, validation rows |
| `--type-body` | 15px | 24px | 400 | Body copy, question wording, method notes, insight text |
| `--type-lead` | 18px | 26px | 500 | Panel headings, member name in the member panel |
| `--type-title` | 22px | 28px | 500 | View title |
| `--type-display` | 26px | 32px | 400 | Presentation caption |
| `--type-display-lg` | 31px | 38px | 450 | Presentation view title |
| `--type-projector` | 37px | 44px | 450 | Presentation title on displays ≥ 2560px only |

### Scale

Modular, ratio **1.2** (minor third), anchored at 15px. Computed then rounded to whole pixels;
line heights are snapped to the 4px spacing rhythm so type and space share one grid.

```
step  computed  used   line-height  ratio
 -2    10.42     11        16        1.45
 -1    12.50     13        20        1.54
  0    15.00     15        24        1.60
 +1    18.00     18        26        1.44
 +2    21.60     22        28        1.27
 +3    25.92     26        32        1.23
 +4    31.10     31        38        1.23
 +5    37.32     37        44        1.19
```

Line height falls as size rises, which is what keeps a 31px presentation title from looking
loose beside a 15px paragraph.

### Numerals

`font-variant-numeric: tabular-nums lining-nums` is applied to every numeric context: all table
cells, all matrix cells, weight readouts, rank intervals, coverage percentages, legend values.
It is set once on the table and matrix elements and exposed as a `.num` utility for inline
figures. Proportional figures are used for running prose only.

### Case and hierarchy

Sentence case everywhere, including table headers, buttons, tabs and legend titles. No all-caps,
no letter-spaced small caps, no eyebrow labels, no numbered sections in the interface.
Hierarchy comes from size, weight and space: a panel heading is 18/500 with 24px of space above
and 12px below, and it has no rule, no box and no background tint.

---

## 5. Spacing

4px base. Used for padding, gaps and margins; line heights snap to the same rhythm.

| Token | px | Typical use |
|---|---|---|
| `--space-1` | 2 | Icon-to-label inside a dense control |
| `--space-2` | 4 | Matrix cell padding; chip inner padding |
| `--space-3` | 8 | Table cell padding; gap between a label and its control |
| `--space-4` | 12 | Gap between related controls; below a panel heading |
| `--space-5` | 16 | Panel inner padding; gap between control groups |
| `--space-6` | 24 | Above a panel heading; gutter between panel and canvas; legend inset |
| `--space-7` | 32 | Between major sections within a panel |
| `--space-8` | 48 | Presentation caption inset from the frame |
| `--space-9` | 64 | Presentation title block top margin |
| `--space-10` | 96 | Empty-state block vertical centring offset |

Panel widths are fixed, not fluid: left rail 280px, right panel 320px, app bar 48px tall,
secondary drawer 320px tall when open. The map takes what is left. Fixed rails mean the map
never reflows when a panel's content changes length.

---

## 6. Radius

Varies by component role, which is a spec requirement and also the honest answer: a data mark and
a dialog are not the same kind of object.

| Token | px | Applies to | Why |
|---|---|---|---|
| `--radius-mark` | 0 | Matrix cells, legend swatches, bars, heat cells | Data marks are measured; a rounded corner removes area and misreports it |
| `--radius-chip` | 2 | Filter chips, layer tags, member codes | Just enough to read as interactive |
| `--radius-control` | 3 | Buttons, inputs, selects, slider track ends | The working radius of the interface |
| `--radius-float` | 5 | Floating member card, toast | Reads as detached from the grid |
| `--radius-overlay` | 6 | Menus, popovers, tooltips | Matches the overlay elevation |
| `--radius-dialog` | 8 | Modal dialogs, the first-run notice | The largest object gets the largest radius |

Docked panels have no radius. They are regions of the window, not cards floating on it.

---

## 7. Elevation

Overlays only. There are exactly three levels and two of them are shadows.

| Token | Value | Applies to |
|---|---|---|
| `--elev-0` | `none` | Every docked surface: panels, tables, the map, the legend, the app bar |
| `--elev-1` | `0 1px 2px rgba(16,32,29,.10), 0 6px 16px rgba(16,32,29,.08)` plus a 1px `--c-rule` border | Menus, popovers, tooltips, the floating member card |
| `--elev-2` | `0 2px 6px rgba(16,32,29,.12), 0 20px 48px rgba(16,32,29,.16)` over a `rgba(16,32,29,.32)` scrim | Modal dialogs, the first-run notice |

Forbidden, and checkable in review: any shadow on a node, an edge, a table row, a panel, a
legend or a chip. No `filter: blur()`, no `backdrop-filter`, no glow, no gradient — there is no
gradient token in the system, so a gradient in the codebase is a hard-coded value and therefore
a defect by the spec's own rule.

---

## 8. Rules and borders

Three permitted uses of `--c-rule`, listed so the list can be checked:

1. A 1px underline beneath a table header row.
2. A 1px edge where a docked panel meets the canvas.
3. The matrix's axis lines and its every-fifth-row guide.

Everywhere else, separation is space. Control borders use `--c-ink-muted`, not `--c-rule`, so
that a focusable boundary always clears 3:1.

Focus: a 2px `--c-accent` ring offset 2px from the element, plus a 1px `--c-canvas` inner ring so
the focus state survives on a coloured fill. Never `outline: none`.

---

## 9. Motion

| Token | Duration | Applies to |
|---|---|---|
| `--dur-1` | 120ms | Hover and focus tint, tooltip appearance |
| `--dur-2` | 180ms | Control state change, menu open |
| `--dur-3` | 250ms | Panel open and close, secondary view switch — the ceiling for UI transitions |
| `--dur-layout` | 600ms | Node position interpolation when weights or layout change |

| Token | Curve |
|---|---|
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` |
| `--ease-exit` | `cubic-bezier(.4, 0, 1, 1)` |
| `--ease-layout` | `cubic-bezier(.35, 0, .2, 1)` |

`--dur-layout` exceeds the spec's 250ms ceiling deliberately and I want this noted rather than
assumed. That ceiling governs *interface* transitions. Node interpolation is not chrome moving;
it is the spec §7 requirement that "users can see what moved", and at 250ms a 250-node
rearrangement is a flicker rather than a motion anyone can follow. If you would rather hold the
250ms line everywhere, say so and I will drop it and rely on the before/after toggle below.

Motion occurs only in response to a user action. Nothing animates on load, on data arrival, or on
panel mount. There are no entrance animations.

Under `prefers-reduced-motion: reduce`, every duration becomes 0 and layout changes apply
instantly. Because that removes the "see what moved" affordance, reduced-motion users get a
**Show what moved** toggle instead, which draws the previous positions as hollow rings until
dismissed. The affordance is replaced, not removed.

---

## 10. Wireframes

### 10.1 Analyst workspace (1440 × 900 reference)

```
+--------------------------------------------------------------------------------------------+
| Graticule                                          Analyst | Presenter                      |
| Northfield pilot                                                  Import   Save   Export    |  48
+--------------------------+-------------------------------------------+---------------------+
| 280                      | fluid                                     | 320                 |
|                          |                                           |                     |
| Search members           |            .                              | Insights            |
| [______________________] |         .     o---o                       |                     |
|                          |        .     /     \      o               | Three members       |
| Layers and weight        |             o       o----/ \              | connect Finance to  |
|                          |            / \     /      \ \             | the rest of the     |
| Connection strength      |           o   O===O         o             | organisation. What  |
| |=========-------|  0.40 |            \ / \  \\       /              | happens if one      |
| Informal collaboration   |             o   o  \\     o               | leaves?             |
| |======----------|  0.25 |                  \  O====O                | Rule: betweenness   |
| Formal collaboration     |                   \  \  /                 | at or above the     |
| |====------------|  0.20 |                    o--o                   | 90th percentile     |
| Valence                  |                                           | with constraint at  |
| |===-------------|  0.15 |                                           | or below the 25th.  |
| Signed layer treatment   |                                           | Show on map         |
| ( ) Positive only        |                                           |                     |
| (o) Filter out negative  |                                           | Finance and Legal   |
| ( ) Use as multiplier    |                                           | share few ties.     |
|                          |                                           | E-I index 0.71.     |
| composite =              |                                           | Show on map         |
|   0.40 connection        |                                           |                     |
| + 0.25 informal          |                                           | ----------------    |
| + 0.20 formal            |                                           | Coverage 74%        |
| + 0.15 valence+          |                                           | Below the 80%       |
|   rescaled to 0-1        |                                           | threshold. Whole-   |
|                          |                                           | network metrics may |
| Preset  [Informal    v]  |                                           | be unreliable.      |
|                          |                                           |                     |
| Filters                  |                                           |                     |
| Team     [All        v]  |                                           |                     |
| Level    [All        v]  |                                           |                     |
| Tie strength  |==----|   | +---------------------------------------+ |                     |
|                          | | Legend                                | |                     |
| Layout   [Force      v]  | | Size    Betweenness    o  o  O  O     | |                     |
| Colour   [Team       v]  | | Fill    Team           # # # # #      | |                     |
| Size     [Betweenness v] | | Width   Composite      - = =          | |                     |
|                          | | Colour  Valence -3 [#####] +3         | |                     |
|                          | | Style   Formal --- Informal ...       | |                     |
|                          | | Arrows  Directed view                 | |                     |
+--------------------------+-+---------------------------------------+-+---------------------+
| Matrix | Metrics table | Compare layers                              Directed | Symmetrised |
+--------------------------------------------------------------------------------------------+
```

**Alignment rationale.** The window divides into three columns on fixed rails (280 / fluid /
320) so the map never reflows when panel content changes length. Everything in the left rail
aligns to a single 24px left margin — labels, slider tracks and the formula block share one
optical edge, so the eye reads a column of controls rather than a set of boxes. Slider tracks
all begin and end at the same x, which makes their fill lengths directly comparable; that
comparison is the point of the panel, and it is the reason the weight readouts are right-aligned
in tabular figures at a fixed column. The live formula sits directly beneath the sliders it
describes, indented to the same margin, with the operator characters aligned in a column so the
expression reads as one block rather than four lines. The legend is anchored to the canvas's
bottom-left with a 24px inset, inside the map rather than beside it, because it describes what is
on the canvas and must appear in the PNG and SVG exports — which are canvas-region captures. The
insights panel is a single scrolling column with no cards; each insight is a 15px paragraph, its
rule at 13px in `ink-muted`, and a text action, separated from the next by 24px of space and
nothing else. The coverage warning sits at the foot of the same column, above the fold at every
supported height, and is the only element in the rail allowed a `--c-warning` mark. The secondary
view tabs run along the bottom edge because opening the matrix or the metrics table takes
horizontal width, not vertical, and a bottom drawer preserves the map's aspect ratio better than
a side panel would.

### 10.2 Member panel

Opens in the right column, replacing insights, at 320px. Anchored to the top of the column.

```
+---------------------+
| 320                 |
|                     |
| Priya Raman         |  18/500
| Finance · analyst   |  -- see note below
|                     |
| Betweenness         |  13 ink-muted
|            0.184    |  15 tabular, right
| rank 3 of 42        |  11 ink-muted
| interval 2-5        |
|                     |
| In-strength         |
|            18.0     |
| rank 7 of 42        |
|                     |
| Constraint          |
|            0.312    |
| rank 38 of 42       |
|                     |
| Harmonic closeness  |
|            0.641    |
| rank 5 of 42        |
|                     |
| Rated 39 of 41      |
| people (95%)        |
|                     |
| ------------------- |
|                     |
| Ties by layer       |  18/500
|                     |
| Connection strength |  13/500
| to    J. Okafor  5  |  13 + tabular
| to    M. Silva   4  |
| from  J. Okafor  5  |
| from  A. Weiss   3  |
| 12 more             |
|                     |
| Informal collab.    |
| to    M. Silva   4  |
| from  M. Silva   4  |
| 8 more              |
|                     |
| Valence             |
| positive in   2.4   |
| negative in   0.6   |
|                     |
| ------------------- |
| Show ego network    |
| Path to...          |
| Remove in simulation|
+---------------------+
```

**Note on the meta line.** "Finance · analyst" is written here with a middle dot only to show the
two fields in an ASCII sketch. The implemented panel sets team and level as two 13px lines in
`ink-muted`, stacked, with no separator glyph — the spec names middle-dot meta strings as
something to avoid, and §11 records the correction.

**Alignment rationale.** One column, one left margin at 16px, no boxes. Each metric is a
three-line unit: label at 13px `ink-muted`, value at 15px tabular and **right-aligned to the
panel's right margin**, rank and interval at 11px `ink-muted` back on the left. Right-aligning
the values puts every decimal point in one column, so four metrics of different magnitudes can be
scanned vertically without a table, a border or a background tint. The rank line sits under the
value rather than beside it so the value column stays clean. Ties are grouped by layer with the
layer name at 13/500; within a group, direction (`to` / `from`), name and value occupy three
fixed columns, with the value right-aligned to the same margin as the metric values above, so the
whole panel has exactly two vertical alignment lines — left at 16px and right at 304px. Truncated
groups end with a "12 more" text action rather than a scroll region, so the panel's length is
predictable. The three actions at the foot are plain text actions in the accent, separated from
the ties by 24px and a single rule, which is the one rule permitted in this panel.

### 10.3 Presentation mode (full screen, 1920 × 1080 reference)

```
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|                                                                                            |
|                                        .                                                   |
|                                   .   / \     .                                            |
|                              o---o       o---o                                             |
|                             /     \     /     \                                            |
|                            o       O===O       o                                           |
|                             \     / \   \     /                                            |
|                              o---o   o   o---o                                             |
|                                       \ /                                                  |
|                                        o                                                   |
|                                                                                            |
|                                                                                            |
|   Legend                                                                                   |
|   Size  Betweenness   Fill  Team   Width  Composite   Colour  Valence -3 [#####] +3        |
|                                                                                            |
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|   Where the work actually flows                                                            |  31/450
|                                                                                            |
|   Formal reporting lines run through two managers. Informal collaboration does not.        |  26/400
|                                                                                            |
|                                                                        3 of 7              |  13
+--------------------------------------------------------------------------------------------+
```

**Alignment rationale.** The frame has no chrome: no app bar, no rails, no visible controls.
Navigation is keyboard (left and right arrows, Escape to exit) and a control strip that fades in
on pointer movement and out after two seconds, drawn at the bottom-right in `ink-muted` — it is
the only element in the system that appears without a user action, and pointer movement is a
user action. The map occupies the upper region with a 48px inset on every side; the caption block
is a fixed 200px band at the foot so the map does not resize between steps, which would make
positions incomparable across a sequence and defeat the purpose of stepping through saved views.
The caption is left-aligned to the same 48px margin as the map's inset rather than centred,
because a centred caption's start position moves with its length and the eye has to re-find it on
every step. The title is 31/450 and the caption 26/400: one step apart on the scale, distinguished
by weight rather than by colour or case. The step counter is right-aligned to the opposite margin
in 13px `ink-muted`, low enough in contrast to be ignorable but present for the presenter. The
legend stays inside the map region at 48px from the bottom-left of that region, because it must
appear in exported frames. Node and label sizes are scaled by a projector factor (1.25× by
default, adjustable) applied to stroke widths and type sizes only — positions are not rescaled,
so a view saved in the workspace projects identically.

---

## 11. Self-review against spec §12 "Avoid"

| # | Item | Verdict | Notes |
|---|---|---|---|
| 1 | Purple, indigo or blue-violet gradients; gradient washes as decoration | **Clear** | There is no gradient token, so any gradient in the codebase is by definition a hard-coded value and a defect. The hue band 268°–300° (indigo / blue-violet) was excluded from the palette search entirely. Plum `#673461` sits at hue 331° and is one flat fill among eight. |
| 2 | Warm cream background, high-contrast serif display face, terracotta accent | **Clear after revision** | *Revised.* My first background draft was `#F7F6F3`, a warm off-white. With sienna in the categorical palette it drifted towards precisely this combination. I moved the ground to a cool green-grey (`#FAFBFA` / `#EFF1F0`), which also reads as survey paper rather than editorial stock. There is no serif in the system, and the accent is a deep teal, not terracotta. |
| 3 | Near-black background with a single neon accent | **Clear** | The system is light-ground throughout. There is no dark surface. Presentation mode raises contrast and stroke weight rather than inverting. The highest chroma of any token is C\*46, which is not within reach of neon. |
| 4 | Broadsheet pastiche: hairline rules, zero radius, dense newspaper columns | **Clear after revision** | *Revised.* An earlier draft separated every region with a 1px rule. Rules are now restricted to three named uses (§8) and everything else is separated by space. Radius is deliberately non-zero and varies across six values by component role; zero radius survives only on data marks, where it is a measurement decision. Column widths are 280 and 320px at 13–15px type — reading measures, not newspaper measures. |
| 5 | Identical rounded cards with the same soft grey shadow | **Clear** | There is no card component. Panels are regions with no radius, no border and no shadow; `--elev-0` is `none` and applies to every docked surface. Insights are paragraphs separated by 24px of space. |
| 6 | Glassmorphism, blurred backdrops, glows | **Clear** | No `blur` or `backdrop-filter` token exists and neither property is permitted; §7 names this explicitly so it is reviewable. |
| 7 | Emoji, sparkle or "AI" iconography | **Clear** | No emoji in any string, including validation messages and export file names. The icon set is 16/20px line icons drawn from map and instrument vocabulary — a crosshair, a pin, a ring for ego depth, a funnel for filters. |
| 8 | Hero stat blocks: a big number with a small label | **Clear after revision** | *Revised.* An early sketch put a four-up row of network metrics — density, reciprocity, modularity, coverage — above the map at 31px. I removed it. Network metrics now appear as a definition list in the metrics table and in the report at `--type-body` with right-aligned tabular figures. The largest type in the workspace is the 22px view title; 26px and above exist only in presentation mode, where the type is a caption rather than a number. |
| 9 | Meta strings joined with middle dots; arrows appended to button text; monospace for small data labels | **Clear after revision** | *Revised.* My first app-bar draft read "Graticule · Northfield pilot". It is now a two-line title block: product name at 13px `ink-muted`, project name at 15px `ink`. The member panel's team and level are two stacked lines, not a dotted string — noted at §10.2 because the ASCII sketch cannot show stacking. No button label contains an arrow; "Show on map" and "Path to…" are the wordings. Plex Mono is confined to formula display in the method notes, and small data labels are set in Plex Sans at 11px with tabular figures. |
| 10 | Entrance animations on every panel | **Clear** | Nothing animates on mount, on load or on data arrival. Panels transition only when the user opens or closes them, at 180–250ms. The one element that appears without a click — the presentation control strip — appears in response to pointer movement, which is still a user action, and is suppressed entirely under `prefers-reduced-motion`. |

### Requirements check

| Spec §12 requirement | Where it is met |
|---|---|
| One type family, open licence, self-hosted, tabular figures | §4 — IBM Plex Sans, OFL 1.1, subsetted WOFF2, with the `tnum` verification task flagged for Phase 1 |
| Not Inter, Space Grotesk or Playfair Display | §4 |
| Sentence case everywhere, no eyebrow labels, no decorative numbering | §4 |
| Colour reserved primarily for data; neutral chrome; one UI accent; ≤ 8 categorical hues | §1, §2 — six near-neutral base tokens, one accent, exactly 8 hues |
| Hierarchy by type and spacing, not boxes; elevation only for overlays; radius varies by role | §4, §6, §7 |
| Motion on user action only; UI transitions ≤ 250ms; `prefers-reduced-motion` respected | §9, with the `--dur-layout` exception stated openly for your decision |
| No 3D, no shadows or gradients on data marks, no decorative gridlines | §7; the matrix's every-fifth-row guide is a reading aid on a dense grid, not a decorative gridline, and it is the only line on any data surface |
| WCAG 2.2 AA; keyboard-operable map; tabular alternative | §1 contrast figures; focus ring in §8; the metrics table and adjacency matrix are the tabular alternative and are first-class views, not fallbacks |
| Desktop-first 1280–2560, projector-legible, tablet usable, phone read-only | §5 fixed rails; §10.3 projector scale factor; below 1280 the rails collapse to overlays, below 768 the app is read-only |
