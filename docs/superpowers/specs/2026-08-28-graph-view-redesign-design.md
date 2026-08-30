# Redesigning the graph view

Date: 2026-08-28
Status: designed

## Context

The graph is the plugin's product. Everything else — the item pane, the columns,
the discovery services — exists to feed it. It is also the least designed part of
the codebase: the canvas draws with hardcoded colour literals scattered across
three files, and the chrome around it grew one control at a time.

The concrete failures, in the order a user meets them.

### Nothing explains the colours

`citationPreferences.ts:195` sets the default node colour metric to
`"collection"`. Collection colours come from `colorForCollection()`
(`graphViewControls.ts:160`):

```ts
const hue = (id * 47 + depth * 19) % 360;
```

A paper in several collections is drawn as a pie of up to four of those hues
(`citationGraphRenderer.ts:565`). There is no legend for this, or for any other
categorical encoding. The only legend in the plugin is a numeric gradient bar,
and `graphViewControls.ts:631` reads:

```ts
showLegend.disabled = categoricalValues.has(colorMetric.value);
```

So on first open the one legend control is greyed out, explaining that "a numeric
legend is available when Color uses a numeric metric." The default view is
undecodable by construction.

The rest of the visual vocabulary is undocumented too:

| Mark                   | Meaning                           |
| ---------------------- | --------------------------------- |
| Yellow ring            | search match                      |
| Purple ring            | Explore seed                      |
| Dark-blue ring         | selected                          |
| Thick red outline      | retracted                         |
| Grey `hsl(220 7% 58%)` | missing value, _and_ unfiled      |
| Orange edge            | cites the selection               |
| Blue edge              | referenced by the selection       |
| Dashed outline         | ghost preview, _and_ filtered out |
| Node left of the plot  | the axis metric has no data       |

Four ring colours at similar weights, two greys that mean different things, two
dash treatments that mean different things.

### The renderer draws in the wrong coordinate space

`draw()` translates and scales the context, then draws everything inside that
transform. Only `drawAxes()` resets to identity. Consequences:

- **The legend pans away.** `drawLegend()` positions at world `x = WORLD_WIDTH - 250`.
  Pan right and it leaves the viewport; zoom in and it becomes a wall-sized
  gradient bar.
- **Labels shrink.** `graphRendererScene.ts:546` sets `11px sans-serif` inside the
  scaled context. Fit-view on a large graph lands near 0.3 zoom, giving 3px text.
- **Outlines and nodes go sub-pixel.** `lineWidth = 1.1` and
  `MIN_NODE_RADIUS = 4` are world units.

### Other renderer defects

- **The ramp is a rainbow.** `GRAPH_COLOR_GRADIENT_STOPS` runs blue → cyan →
  yellow → red. Non-monotone in lightness, so it reads as bands rather than an
  ordering; the yellow stop disappears on Zotero's light theme; not safe for
  common colour vision deficiencies.
- **Categorical hues are hashed.** `categoricalColor()` is
  `hsl(hash % 360, 58%, 52%)`. Two categories can land 3° apart, and fixed
  saturation and lightness across the hue circle makes yellow and blue read at
  very different weights.
- **No gridlines.** Ticks exist; nothing connects a node to them across the plot.
- **No-data nodes are dumped silently** at `MISSING_X = PLOT_LEFT - 35`, an
  unlabelled column outside the axis that reads as a glitch.
- **The label cliff.** Above 220 nodes every label vanishes except selected and
  hover (`graphRendererScene.ts:523`); below it they all compete at once.
- **Edges are a hairball.** Uniform 1px straight lines, no weight, no curvature,
  so `A → B` and `B → A` draw on exactly the same pixels.
- **PNG export has a transparent background.** `draw()` fills with
  `rgba(255,255,255,.001)` and `exportGraphPNG()` is a bare `canvas.toBlob()`.
  A dark-theme export pasted into a light document is near-invisible, and it
  carries no legend at all.

### The chrome spends space on nothing

About 101px of vertical chrome sits above the canvas before any filter opens: a
58px header holding back/forward, a logo, an `<h1>` reading "Collection Graph",
and a counts line; then a 43px query band. The `<h1>` repeats what the tab title
already says. Controls sit in four corners with no spatial logic — zoom top
right at `opacity: .8`, appearance gear bottom left, filters in a top-right
popover, export in the header. `.cm-graph-area` carries a decorative blue radial
gradient that tints the plot and serves nothing. Chrome is set in `font: menu`
while the canvas uses `sans-serif`: two fonts in one view.

## Decision

Three changes, in dependency order.

1. **One token layer** (`graphTheme.ts`) that both the canvas and the CSS read,
   replacing every colour literal.
2. **The renderer draws in screen space.** World coordinates survive for layout
   and hit-testing only; every draw call projects first.
3. **A Key rail** — a collapsible left rail that states the full active encoding,
   and a command bar that reclaims the vertical space to pay for it.

The governing rule: **the chrome stays quiet and native to Zotero; the boldness
goes on the canvas.** A plugin that redecorates its host looks broken. A plugin
whose plot looks like a considered scientific figure looks like a tool.

### The Key rail

The signature element. A left rail, collapsible to a 28px strip, that renders
only the sections currently in use:

```
┌──────────────────────────────────────────────────┐
│ ← →  Graph ▾  78 nodes · 185 links  [search] ⚙↧⟳ │ 40px
├────────┬────────────────────────┬────────────────┤
│ COLOR  │                        │  DETAIL        │
│ Coll.  │                        │                │
│ ▪ Fuel │        canvas          │                │
│ ▪ Blan.│                        │                │
│ ▪ Other│                        │                │
│ SIZE   │                        │                │
│ LINKS  │                        │                │
│ STATES │                        │                │
│ ────── │                        │                │
│ ⊕ ⊖ ⌖ ⚙│                        │                │
└────────┴────────────────────────┴────────────────┘
```

- **COLOR** — the metric name, then either labelled swatches with node counts
  (categorical) or the ramp with min/mid/max values (numeric). When a node
  belongs to several categories, a note says the disc is split between them.
- **SIZE** — three nested circles carrying the smallest and largest visible value.
- **LINKS** — arrow, references, cited by, in their actual colours.
- **STATES** — selected, seed, search match, retracted, filtered out, no data.
  Only the states currently present are listed.

**Hovering an entry emphasises it**: non-matching nodes and their edges drop to
25% opacity for as long as the pointer is there. **Clicking pins** that emphasis;
clicking again or pressing Escape releases it. Entries are buttons, focusable,
with `aria-pressed`.

**The Key does not filter.** Emphasis changes nothing about what is loaded,
counted, or exported. Filtering already has a home in the filter panel, where it
is reflected in the counts and in every export; a second, quieter way to hide
papers would make the two disagree. One element, one job.

### Command bar

Header and query band collapse into a single 40px bar: history, the view
switcher, the counts in tabular numerals, the search field, then filter, similar,
export and refresh. The `<h1>` becomes visually hidden but stays in the accessible
tree. This returns roughly 60px of canvas height, which is what pays for the rail.

Zoom, fit and appearance move out of the canvas corners into the Key rail's
footer, so every control that governs how the graph _looks_ sits in the rail and
every control that governs _what is in it_ sits in the bar.

### Palette

Named after the plant tissues the plugin is named for. The names live in code and
this document; they never appear in the product.

**Sequential ramp** — monotone in lightness, so it reads as an ordering on either
theme and survives greyscale printing:

| Stop | Light theme | Dark theme |
| ---- | ----------- | ---------- |
| 0.00 | `#0F3B33`   | `#1A4C42`  |
| 0.25 | `#1E6B52`   | `#1E6B52`  |
| 0.50 | `#4F9A5E`   | `#4F9A5E`  |
| 0.75 | `#96BF54`   | `#96BF54`  |
| 1.00 | `#E0C64A`   | `#E0C64A`  |

**Categorical** — ten fixed swatches, all mid-lightness so none dominates, chosen
for separation under deuteranopia and protanopia:

`#2F7D5B` moss · `#C2703D` bark · `#3C6E9F` water · `#B4495F` anthocyanin ·
`#7B6BAE` iris · `#C6A83C` carotene · `#4FA3A3` lichen · `#8C5E3C` humus ·
`#6E8F3A` olive · `#A45CA0` orchid

Assignment is **by rank, not by hash**: categories are ordered by node count
descending, ties broken by label, and the top nine take the first nine swatches.
Everything beyond collapses into one `#7E8A84` **Other** swatch, which the Key
labels with its count. Nodes in several categories still split into up to four
slices, ordered by the same rank, so the largest category is always the slice at
twelve o'clock.

**No value** is `#9AA5A0` at 55% opacity with a dotted outline — identifiable
without colour, and never confusable with a real category.

### Node state grammar

Four ring colours become one grammar. Where a state can be carried by shape it
is, so it never collides with the colour encoding:

| State        | Mark                                           |
| ------------ | ---------------------------------------------- |
| Selected     | 2px ink ring plus a soft halo; its edges lit   |
| Seed         | two concentric hairlines                       |
| Search match | four corner ticks, like a viewfinder crop mark |
| Retracted    | heavy outline plus a diagonal slash            |
| Filtered out | 40% opacity, dashed outline                    |
| No data      | dotted outline, parked in a labelled gutter    |

### Edges

Screen-space widths throughout. Base hairline at 1px in the muted ink at 20%,
scaled down as edge density rises so a dense graph does not turn into a grey
wash. On selection, outgoing references take `#3C6E9F` and incoming citations
take `#C2703D` at 2px, everything else drops to 6%. Every edge gets a quadratic
offset proportional to 8px of screen, so reciprocal pairs separate instead of
overprinting. Arrowheads are 6px screen-space and are drawn only above 0.5 zoom
or when lit.

### Plot furniture

Gridlines at every tick beneath the nodes; a hairline frame around the plot; the
plot painted in a paper tone one step off the panel background, which is the
classic scientific-figure inset and the canvas's only real identity move. The
no-data gutters get a dashed separator and a rotated `NO DATA` label in muted
small caps, so the parked nodes read as a category rather than an error.

### Typography

No bundled face. The chrome and the canvas share one system stack, so the two
halves of the view finally match. The identity comes from the scale, not from a
display font:

| Role            | Treatment                              |
| --------------- | -------------------------------------- |
| Axis tick       | 11px, tabular numerals                 |
| Axis title      | 11px uppercase, 0.08em tracking        |
| Node label      | 11px; 12px when selected or hovered    |
| Key heading     | 10px uppercase, 0.09em tracking, muted |
| Counts, metrics | tabular numerals everywhere            |

All canvas text is screen-space, so it is 11px at every zoom level.

### Labels

The 220-node cliff is replaced by a per-frame budget. Labels are placed in
importance order — selected, hovered, then by citation count — until either a
screen-area budget is exhausted or placements fail repeatedly. A dense graph
therefore labels its most important nodes rather than none of them, and the
transition as you zoom in is continuous.

### Export

The PNG stops being a bare `toBlob()`. It composites the theme's plot background
first, so an export is legible wherever it is pasted, and it draws a Key block in
the corner. The Key becomes a pure data model (`buildKeyModel()`) with two
renderers — DOM for the rail, canvas for the export — so the two can never
describe the encoding differently.

## Deliberate exclusions

- **The Key does not filter.** Reasoning above. If it should later, the path is
  to route its clicks through `PaperFilterController` so counts and exports stay
  truthful, not to add a second hide mechanism in the renderer.
- **No edge bundling.** Curvature plus selection dimming is enough at the sizes
  this plugin renders. Bundling would obscure the direction arrows that are the
  point of the view.
- **No layout changes.** Free-layout placement and the metric projection are
  untouched. This is a redesign of how the graph is drawn and explained, not of
  where nodes go.
- **No bundled webfont.** A display face for an `<h1>` we are deleting is the
  accessory to remove.
- **Minimal motion.** A 120ms opacity ease on emphasis, nothing else, and that
  disabled under `prefers-reduced-motion`.
- **`graphShowLegend` is retired, not migrated.** The canvas gradient legend is
  deleted along with `setLegendVisible`/`getLegendVisible`. The pref is left
  unread; a stale value in a profile is harmless. The rail's collapsed state
  persists under a new `graphKeyRailCollapsed`.

## Consequences

`citationGraphRenderer.ts` loses its transform-based drawing, which touches every
draw method. That is the largest single risk in the change and the reason it is
sequenced first, before anything visual depends on it. Hit-testing, `fitView`,
`fitKeys` and the pan/zoom pointer maths keep working in world space and are
unaffected as long as `projectToScreen()` is the only bridge.

Four pure seams fall out, all unit-testable without Zotero: theme resolution,
category assignment, screen projection, and the label budget. They go in
`test/architecture.test.ts` alongside the existing pure-seam tests.
