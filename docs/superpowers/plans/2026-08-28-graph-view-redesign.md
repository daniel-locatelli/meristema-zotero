# Graph view redesign — implementation plan

**Goal:** The graph view states its own encoding, draws crisply at every zoom
level, and spends its chrome on the plot rather than on a title.

**Spec:** `docs/superpowers/specs/2026-08-28-graph-view-redesign-design.md`

**Architecture:** Bottom-up, in dependency order. A token module lands first and
every colour literal moves into it. The renderer then stops scaling its context
and projects to screen space instead, which fixes text size, stroke width and
the drifting legend in one move. Category assignment becomes rank-based and
returns a data model. Only then does the Key rail — the thing the user actually
asked for — get built on top of that model, and the chrome reflows to make room.

**Tech stack:** TypeScript, Canvas 2D, HTML/CSS inside a Zotero tab. Pure logic
tested with `node --test` + Chai; anything touching `Zotero.*` or the DOM tested
with Mocha + Chai via `zotero-plugin test`.

## Global constraints

- Branch `graph-view-redesign`, based on `b79f1ff`.
- `npm run check` works again (`fd48e72`) and now runs prettier, eslint,
  typecheck and the unit suite. The untracked `prefs.js`, the `.env` backup and
  `.superpowers/` are ignored; five committed markdown files that had been
  failing CI are formatted.
- `npm test` launches the real Zotero and takes minutes. Only one scaffold
  process may drive Zotero at a time. `npm run test:unit` (Task 0) runs in under
  a second and is the loop to work in; reach for `npm test` at task boundaries.
- Anything under `test/unit/` must be importable by plain Node: no `Zotero.*`, no
  DOM, **erasable-only TypeScript** (no `enum`, no namespaces, no parameter
  properties), and relative imports written with their `.ts` extension. A seam
  that cannot meet this belongs in `test/architecture.test.ts` instead.
- **No colour literal may be added to a `.ts` file outside `graphTheme.ts`.**
  The ESLint guard is in place, scoped to the graph's drawing files rather than
  all of `src/services` — the rest of the tree has long-standing literals in
  tooltips and pickers that are not part of this work.
- World coordinates stay the layout and hit-testing space. `projectToScreen()`
  is the only bridge; no draw call may read `this.transform` directly after
  Task 2.
- The Key emphasises, it never hides. Nothing in this plan may route Key
  interaction into `PaperFilterController` or `setVisibleKeys`.
- Commit messages: sentence-case subject, no `feat:`/`fix:` prefixes, ending with
  the two trailers from `git log -1 --format=%B HEAD`.

## File structure

| File                                      | Responsibility                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/services/graphTheme.ts`              | **New.** Light/dark tokens, both palettes, the state grammar, CSS custom property mirroring.     |
| `src/services/graphCategoryAssignment.ts` | **New.** Rank-based category → swatch assignment and counts for all five categorical metrics.    |
| `src/services/graphKeyModel.ts`           | **New.** Pure description of the active encoding, consumed by the rail and the export.           |
| `src/services/graphKeyRail.ts`            | **New.** The DOM rail, its sections, hover/pin emphasis, collapse persistence.                   |
| `src/services/citationGraphRenderer.ts`   | Screen-space drawing, emphasis API, gridlines, gutters, edge curvature; loses `drawLegend`.      |
| `src/services/graphRendererScene.ts`      | Screen-space labels, the label budget, ghost drawing.                                            |
| `src/services/graphMetricScale.ts`        | Ramp moves to the theme; `categoricalColor` is deleted.                                          |
| `src/services/graphPlotFrame.ts`          | **New.** Plot insets, the fit gutters that must not undercut them, the type scale, tracked text. |
| `src/services/graphViewport.ts`           | **New.** World/screen projection and the lengths that must survive the round trip.               |
| `src/services/graphEdgeStyle.ts`          | **New.** Reciprocal curvature, count-scaled opacity, the arrowhead visibility rule.              |
| `src/services/graphLabelBudget.ts`        | **New.** The label budget, the spatial index behind it, and the measured-width cache.            |
| `src/services/graphViewControls.ts`       | Command-bar reflow, `colorForCollection` deleted, legend checkbox removed.                       |
| `src/services/graphViewService.ts`        | Header/query-band collapse, rail mounting, control relocation.                                   |
| `src/services/exportService.ts`           | Opaque background and a Key block in the PNG.                                                    |
| `src/services/windowService.ts`           | The `.cm-header-toolbar` selector follows the reflow.                                            |
| `addon/content/graph.css`                 | Command bar, rail, tokens, furniture; the decorative radial gradient goes.                       |
| `src/services/citationPreferences.ts`     | The Key rail's collapse state.                                                                   |
| `test/zotero/visualHarness.ts`            | **New.** Opens a chrome window, builds the view shell, builds corpora, writes frames to disk.    |
| `test/zotero/graphVisual.test.ts`         | **New.** The twelve checks, driven against the real renderer inside Zotero.                      |
| `test/zotero/graphViewVisual.test.ts`     | **New.** The view as `renderGraphView` builds it: chrome, rail wiring, command bar.              |
| `test/unit/*.test.ts`                     | **New.** Fast `node --test` suite for the four pure seams.                                       |
| `test/architecture.test.ts`               | Existing pure-seam tests migrate out to `test/unit/`; the file keeps only Zotero-bound tests.    |

---

## Task 0: A fast unit suite — **DONE** (`b905214`)

Prerequisite for every `**Test:**` line below, and a repo-wide convention change
rather than a graph concern — land and commit it on its own.

**What actually shipped.** Node 24 strips TypeScript natively, so this needed no
new dependency — but the plan missed two gaps that only appear once a test
imports `src/`. Relative imports there carry no file extension, which Node's ESM
resolver rejects, and `package.json` is imported for named bindings, which Node's
JSON modules do not provide. Rewriting 528 imports across 100 files was the
alternative; instead `test/nodeResolve.mjs` closes both with module hooks and
leaves every source file untouched. `verbatimModuleSyntax` is now on so a
type-only import written as a value import cannot break the stripper again.

All sixty-eight tests turned out to be free of `Zotero.*` and the DOM, so the
whole file moved and only the startup test stayed behind — in `test/zotero/`,
which the scaffold's `test.entries` now points at so it does not try to bundle
the unit suite. `typecheck` covers the test tree for the first time.

Original sketch, kept for the reasoning:

```json
"test:unit": "node --test test/unit/",
```

and a `test/unit/` directory. Tests import `describe`/`it` from `node:test` and
keep `expect` from `chai`, so the only thing that changes for a migrated test is
the import line. Verified: a trivial `.ts` test runs in ~180ms.

Migrate the existing pure-seam tests out of `test/architecture.test.ts` — the
domain modules it covers (`workIdentity`, `valueNormalization`,
`relationshipDescriptors`, `relatedWorkMetadata`, `serializedTaskQueue`) are all
Zotero-free. Anything that touches `Zotero.*` or the DOM stays behind. Leaving
both conventions live was considered and rejected: two homes for the same kind of
test is how a fast suite quietly stops being used.

Update `npm run check` to include `test:unit`, and the README's contributing
notes if they name the test command.

**Verify:** `npm run test:unit` passes and finishes in under a second;
`npm test` still passes with the reduced file.

## Task 1: The token layer — **DONE** (`1595d22`)

**The pre-flight is answered, and the answer changed the design** (`b0efd5f`).
Zotero's Appearance control is bound to `browser.theme.toolbar-theme`, and the
override does reach `prefers-color-scheme` in a chrome document. But setting the
pref triggers **no restyle of an open document**, so a `MediaQueryList` held
across the change keeps its stale `matches` and never fires `change`. The
listener at `citationGraphRenderer.ts:149` that this task was meant to ride on
had never fired, and `isDarkMode()` was frozen at construction time. The scheme
is now re-resolved from scratch on every draw, and re-application hangs off a
**pref observer**. `test/zotero/colorScheme.test.ts` records the behaviour.

**The palette was replaced.** Validated with the `dataviz` skill's checker, the
spec's ten swatches failed four gates: four below the chroma floor (they read
grey), moss/bark 5.1 apart under protanopia against a floor of 6, olive/humus
14.5 apart under normal vision against a floor of 15, and carotene outside the
dark lightness band. On the all-pairs test — the right one, since any two nodes
can touch — the spec's palette caps at **one** colour. What shipped is the
spec's own eight surviving hue families, re-stepped in OKLCH and re-ordered by
exhaustive search: every gate passes, worst adjacent ΔE 16.9 light / 19.3 dark.
The green-to-gold ramp is kept as specced; it is monotone in lightness, which is
the property that matters.

**The category cap is five, not nine.** No palette carries nine distinguishable
node colours on a scatter; the best of the three caps at five. Assignment gives
the five largest categories a swatch and collapses the rest into Other. The Key
rail, the labels and hover emphasis are therefore the encoding's _required_
second channel, not a convenience.

**Two later pieces came forward**, because they were what still held colour
literals: the canvas gradient legend and its greyed-out checkbox are deleted
(from Task 2), and the decorative radial gradient is off `.cm-graph-area` (from
Task 4). **Task 3 landed with this task** for the same reason — deleting
`categoricalColor` and `colorForCollection` is what removed the last of them.

**Not yet verified:** the visual check below. Nothing has been looked at running.

Original brief:

Create `graphTheme.ts` exporting a `GraphTheme` for each of light and dark:
surfaces (panel, plot paper, hairline, grid), inks (primary, muted, emphasis),
the five-stop sequential ramp, the ten categorical swatches plus `other` and
`noValue`, edge colours, and the state marks. Add
`applyGraphThemeToDocument(root, theme)` writing each token as a CSS custom
property on `.meristema-root` so `graph.css` reads the same values.

Move `GRAPH_COLOR_GRADIENT_STOPS` out of `graphMetricScale.ts` and repoint
`numericColor()` at the theme's ramp.

Then sweep every colour literal out of `citationGraphRenderer.ts`,
`graphRendererScene.ts` and `graphViewControls.ts` into token lookups, and add an
ESLint `no-restricted-syntax` rule banning hex, `rgb(`, `rgba(` and `hsl(`
literals in `src/services/*.ts` with `graphTheme.ts` exempted.

**Re-apply on theme change, through the listener that already exists.** Both the
canvas and `graph.css:665` currently theme off one `prefers-color-scheme` media
query, and `citationGraphRenderer.ts:149-152` already registers a `change`
listener on it that calls `draw()`. `applyGraphThemeToDocument` rides on that same
event. Ownership moves to `graphViewService.ts` rather than the renderer, because
the custom properties are a view-level concern and several renderer instances can
share one document.

Do **not** add a `MutationObserver` for this. Nothing on the theme path mutates a
DOM attribute, so it would never fire.

**Pre-flight, before writing any token:** confirm that Zotero's explicit
Light/Dark appearance override actually propagates `prefers-color-scheme` into a
chrome-privileged HTML document, by setting the override against the OS theme and
watching `isDarkMode()`. If it does not, the plugin is _already_ mis-theming for
anyone who overrides their OS setting, `matchMedia` is the wrong source, and the
theme resolver must read Zotero's appearance pref instead. Settle this first —
the whole token layer inherits whatever this answers.

Nothing looks different yet except the ramp. Verify by opening a graph with a
numeric colour metric: the rainbow is gone and the scale reads as an ordering,
then switch Zotero's theme with the graph open and confirm both canvas and chrome
follow in one step.

**Test:** theme resolution returns distinct, complete token sets for both modes;
every key present in one is present in the other.

## Task 2: Draw in screen space — **DONE**, verified

The coordinate change shipped. `draw()` no longer touches the canvas transform:
it projects every world position into `screenPositions` once per frame through
`projectToScreen`, and every size — radii, stroke widths, dashes, arrowheads,
label text and gaps, the ghost — is authored in CSS pixels and multiplied by the
frame's device pixel scale.

**A new pure module carries the maths.** The plan's `**Test:**` line wanted a
round-trip against `screenToWorld`, which is a private renderer method needing a
canvas. `src/services/graphViewport.ts` holds `projectToScreen`,
`projectToWorld`, `devicePixelScale` and `screenLengthToWorld` instead; the
renderer delegates to all four, and `test/unit/graphViewport.test.ts` pins the
round-trip across the full 0.15–8 zoom range.

**Two consequences the plan flagged, both handled.** `hitTest` still works in
world space, so it now converts through `worldLengthForScreen()` — a node's
world reach shrinks as the view zooms in. Its ranking floor changed from
`Math.max(1, radius)` to an epsilon: a world radius is no longer bounded below
by `MIN_NODE_RADIUS`, and at 8x the old floor flattened the ordering between
overlapping nodes.

**`withinLabelBounds` became a projected rectangle.** It compared screen-space
label rectangles against world constants; it now takes the plot bounds projected
through `projectToScreen`, which preserves the previous behaviour exactly.

**`drawAxes` no longer reads `this.transform`.** It projects its ticks through
`projectToScreen` like everything else, and its `setTransform(1,0,0,1,0,0)` is
gone — nothing applies a transform for it to reset.

**Layout was not touched.** `relaxAnchoredNodes` still spaces nodes by
`nodeRadius` in _world_ units, and `projectRendererPositions`, `fitView`,
`fitKeys`, `screenToWorld`, the drag handler and the wheel handler are unchanged.
`MIN_NODE_RADIUS`/`MAX_NODE_RADIUS` are therefore read two ways — CSS pixels
when drawn, world units when packed — which is why nodes may overlap slightly
more at fit than before. This is the trade the task asks for.

**Found, not fixed:** `fitView` reserves flat device-pixel gutters
(`screenLeft = 64`) while `drawAxes` draws its axis at `58 * ratio`. On a HiDPI
display the fit under-reserves and nodes can land beneath the y-axis labels.
This is pre-existing and predates the task; it was left alone because the plan
says fit behaviour must not change, and altering what a fitted view looks like
would muddy the visual pass below. Worth folding into Task 4 or 7.

**Not yet verified:** the visual check below, and Task 1's — see the note there.

Original brief:

`drawLegend()`, `setLegendVisible()`, `getLegendVisible()`, the `graphShowLegend`
pref and the appearance checkbox are **already gone** — they came forward with
Task 1. What remains is the coordinate change itself.

Two notes for whoever picks this up. The canvas is device-pixel backed, so
"screen space" here means canvas device pixels: every screen-space size needs the
`canvas.width / rect.width` ratio applied, the way `drawAxes` already does.
And `hitTest` compares against a radius — once radii are screen units, the
world-space hit test has to divide by `transform.scale`.

Delete the `translate`/`scale` pair from `draw()`. Add
`projectToScreen(position): Position` and project every node position once per
frame into a `Map` the draw methods read. Convert, in order: node fills and
radii (radius becomes screen px, `MIN_NODE_RADIUS`/`MAX_NODE_RADIUS` reinterpreted
as screen units), node outlines, state marks, edges, arrowheads, labels
(`graphRendererScene.ts`), and the ghost preview.

Leave `screenToWorld`, `hitTest`, `fitView`, `fitKeys`, the drag handler and the
wheel handler working in world space — they already do the projection maths
themselves and must not change behaviour.

Verify by zooming from fit to 8x: label size, outline weight and arrowhead size
stay constant, and node radii stay legible at fit.

**Test:** `projectToScreen` round-trips against `screenToWorld` across a range of
transforms.

## Task 3: Rank-based categories — **DONE**, landed with Task 1 (`1595d22`)

Create `graphCategoryAssignment.ts` with
`assignCategories(nodes, metric): CategoryAssignment` — categories ordered by node
count descending, ties by label, the top nine taking the first nine swatches and
the remainder collapsing into `other` with its own count. It covers all five
categorical metrics, replacing both `categoricalColor()` and
`colorForCollection()`, and it returns the labels and counts the Key will need.

`buildCollectionVisuals()` becomes a thin caller: it still produces up to four
slices per node, now ordered by the assignment's rank so the largest category is
always the slice at twelve o'clock.

Delete `categoricalColor` from `graphMetricScale.ts` and `colorForCollection`
from `graphViewControls.ts`.

**Test:** assignment is stable across reorderings of the input; the tenth-largest
category and beyond land in `other`; counts sum to the node total; a node with no
value gets `noValue` rather than a swatch.

## Task 4: Plot furniture — **DONE**, verified

The plot is now an inset figure rather than an edge-to-edge canvas: `draw()`
fills the surround with `surfaces.panel`, fills the plot rectangle with
`surfaces.paper`, lays a gridline at every tick in `surfaces.grid` beneath the
nodes, and closes the figure with one hairline `strokeRect` on top.

**The frame replaced the two bare axis lines.** `drawAxes` used to stroke an L
in `inks.muted`; a full rectangle in `surfaces.hairline` says the same thing and
reads as a figure. Ticks still hang outside it and keep their muted ink.

**`src/services/graphPlotFrame.ts` is new**, and it is where the "found, not
fixed" item from Task 2 got fixed. `fitView` reserved flat device-pixel gutters
(`screenLeft = 64`) while `drawAxes` drew its axis at `58 * ratio`, so on a
scaled display the fit under-reserved and nodes landed beneath the y-axis
labels. The module now owns both: `axisInsets()` is what the furniture occupies,
`fitInsets()` is that plus a margin, both in CSS pixels times the ratio.
`test/unit/graphPlotFrame.test.ts` pins that a fit can never reserve less than
the furniture at any ratio, and that at ratio 1 the fit lands on exactly the old
literals — so fit behaviour is unchanged on a standard-DPI display, which is
what the plan asked for.

**A free axis now gets its gutter back.** `axisInsets` reserves 18 CSS pixels
instead of 58/42 on a side that draws no ticks and no title. When _both_ axes
are free there is no plot to inset at all, so the paper stays edge to edge and
nothing is framed — a rectangle around a force layout would mean nothing.

**The no-data lanes are drawn from `MISSING_X`/`MISSING_Y`**, which
`graphRendererScene.ts` now exports so the separator and the parking decision
cannot drift apart. `hasParkedNodes()` mirrors that decision exactly — a null
value, or a non-positive one on a log scale — so a lane appears only when
something is in it. Each lane gets a dashed hairline separator at the midpoint
between the lane and the data, and a `NO DATA` label at the far end, away from
the corner where the two lanes meet.

**Only the x lane's label is rotated**, against the plan's "rotated `NO DATA`
labels" for both. The x lane is a narrow vertical strip and has to be; the y
lane is a wide horizontal one, and rotating its label would cost legibility for
nothing.

**Typography.** `resolveChromeFontStack()` reads the stack off the canvas's
computed style rather than hard-coding one, so the canvas is set in whatever
face Zotero's chrome is using; it is re-read on resize, not per frame, because
`getComputedStyle` forces a reflow. `graphRendererScene.ts`'s three `ctx.font`
assignments follow it through `RendererSceneContext.fontStack`. Axis titles and
gutter labels go through `fillTrackedText()`, which uppercases and applies
tracking via `ctx.letterSpacing`, compensating for the trailing step a centred
run would otherwise pick up.

**Tabular numerals were not applied to the canvas, because they cannot be.**
Canvas 2D exposes `fontKerning`, `fontStretch`, `fontVariantCaps`,
`letterSpacing` and `wordSpacing` — there is no `font-variant-numeric`. The tick
labels are individually centred (x) and right-aligned (y), which is what the
tabular setting would have bought here. `graph.css` keeps its `tabular-nums` for
the DOM chrome.

**Not yet verified:** the visual check below, and Tasks 1 and 2's — nothing has
been looked at running for three tasks now.

Original brief:

The decorative radial gradient is already off `.cm-graph-area`.

Gridlines at every tick, beneath the nodes, in the theme's grid token. A hairline
frame around the plot, and the plot painted in the paper tone. Dashed separators
and rotated `NO DATA` labels on the x and y gutters, drawn only when a node is
actually parked there. Remove the decorative radial gradient from
`.cm-graph-area`.

Apply the type scale: axis titles and gutter labels in uppercase with tracking,
ticks in tabular numerals, all sharing the chrome's font stack.

Verify by opening a graph with a metric on each axis: the plot reads as an inset
figure on the panel, gridlines sit under the nodes rather than over them, and a
collection containing a paper with no year shows the `NO DATA` lane — which
disappears once every paper on screen has one. Check a scaled display: a fitted
view must keep every node clear of the y-axis labels.

## Task 5: Edges and labels — **DONE**, verified, with two defects fixed

Both halves shipped, each behind a pure module so the decisions are testable
without a canvas.

**`src/services/graphEdgeStyle.ts` is new.** `reciprocalEdgeKeys` finds the
edges that have a partner running the other way, and only those curve —
`curveSign` compares the two keys so `A>B` and `B>A` always bow to opposite
sides. A lone edge stays straight: drawing it as an arc would say something the
graph does not mean, which is a **deviation** from the plan's flat "quadratic
curvature offset of 8px screen". The apex is 8 CSS pixels, so `curveControlPoint`
places the control at twice that; `arrivalDirection` gives the arrowhead the
curve's tangent at the target rather than the chord's direction.

`edgeBaseOpacity` falls from 1 at 240 edges to a floor of 0.3 at 3200, linear in
log space. **A lit edge bypasses it** and keeps full strength however dense the
graph is — lighting it is the whole point of the selection. `shouldDrawArrowhead`
drops an unlit head below 0.5 zoom. The arrowhead is now a flat 6 CSS px; the
old 6.25/5 split between connected and ordinary edges is gone, since the
connected edge already reads through colour, weight and shadow.

**`src/services/graphLabelBudget.ts` is new**, and it carries both label changes.
`createLabelBudget` replaces the `nodes.length > 220` cliff with two independent
stops: an area share of the plot (18%), which catches a sparse graph whose
labels would tile it, and a consecutive-failure count (14), which catches a
dense cluster where the loop would grind through hundreds of buried candidates
to place nothing. The area is measured against the plot **actually on screen**,
which is what makes zooming in reveal more labels continuously.

`createRectangleIndex` is the complexity fix. Node rectangles and placed labels
go into one spatial hash keyed by 64px cells, so a candidate only meets the
rectangles in its own cells instead of the concatenated array of all of them.
A rectangle is filed under every cell it covers, so the query de-duplicates by
index before summing — `test/unit/graphLabelBudget.test.ts` pins both that the
index agrees with the brute-force sum across three cell sizes and that a
rectangle spanning a hundred cells is counted once. `createTextWidthCache`
memoizes `measureText` across frames keyed by font _and_ string, so a resize that
changes the device pixel ratio starts a new generation rather than returning
stale widths.

**The `ctx.font` guard stays rejected**, as the plan says. It is set once per
`drawRendererLabels` call, and that same string is now the cache key.

**Not yet verified:** the visual check below — a 500-node graph, and a pan held
long enough to judge frame rate. This is code and unit tests only, like Tasks
1, 2 and 4.

Original brief:

Edges: screen-space widths, base opacity scaled down as edge count rises,
quadratic curvature offset of 8px screen so reciprocal pairs separate, arrowheads
at 6px drawn only above 0.5 zoom or when lit. Keep the existing selection
colouring, repointed at the theme.

Labels: replace the `nodes.length > 220` cliff with a budget — place in
importance order until the occupied area exceeds a fraction of the viewport or
placements fail repeatedly. Selected and hovered labels are always placed.

**Fix the placement loop's complexity in the same pass.** `graphRendererScene.ts:599`
currently reads `[...nodeRectangles, ...occupied].reduce(...)`, which allocates a
fresh array of every node plus every placed label **per candidate position**,
eight candidates per label, every frame — roughly 1,600 allocations and 480k
overlap tests per pan frame at 200 nodes, plus a `measureText` per label per
frame. This is the renderer's real hot spot and it is why the 220-node cliff was
introduced in the first place; a budget alone would leave the quadratic cost in
place for whatever it does draw.

Reuse the spatial hash already in this file — `gridCoordinate()` and `gridKey()`
at `:162`, currently used only by `relaxAnchoredNodes` — to index occupied and
node rectangles by cell, so a candidate tests only its own neighbourhood. Memoize
measured label widths by string across frames; the font is fixed screen-space
after Task 2, so a width is valid until the string changes.

Do **not** add a `ctx.font` assignment guard. The font is set eight times per
frame in total, not per node, and screen-space text at a fixed 11px hits the
glyph cache that today's matrix-scaled text misses.

Verify on a 500-node graph: the most-cited papers are labelled, the rest are not,
zooming in reveals more continuously, and a sustained pan holds frame rate.

**Test:** the budget labels a bounded number of nodes and always includes the
selected key; the grid-indexed overlap test returns the same placements as the
brute-force one on a fixed fixture.

## The visual pass on Tasks 1–5 — **DONE**

Five tasks had landed without anyone looking at the graph running. All twelve
checks have now been run, and they found three defects that every unit test in
the repo was happy with.

**They were run by machine, not by eye.** `test/zotero/visualHarness.ts` opens
the plugin's own chrome window, mounts a canvas in it, and drives the real
`CitationGraphRenderer` over a deterministic synthetic corpus;
`test/zotero/graphVisual.test.ts` puts it through each check and writes every
frame to `.scaffold/visual` as a PNG. The frames are the evidence — the
assertions only pin what a number can pin. `npm test` runs the whole thing, and
the frames are gitignored along with the rest of `.scaffold`.

### What the frames showed

| Check                 | Outcome                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2 — the ramp          | Passes. Dark green to gold, monotone in luminance, no rainbow.                                                         |
| 3 — the theme         | Passes on the canvas, in one step, both directions.                                                                    |
| 4 — the zoom          | Passes. Text, outlines and radii are identical on screen at fit and at 8x.                                             |
| 5 — the pointer       | Passes. A synthesised click at 8x selects the node drawn under it.                                                     |
| 6 — the figure        | Passes. Hairline frame, gridlines under the nodes, ticks outside.                                                      |
| 7 — the lanes         | Passes, per axis: the x lane goes when every paper has a year, and the y lane stays while a log axis has zeroes in it. |
| 8 — HiDPI             | Passes at a real 2x. No node reaches the tick labels.                                                                  |
| 9 — the free axes     | Passes. One free axis widens the plot; two drop the frame entirely.                                                    |
| 10 — reciprocal edges | **Failed.** Fixed below.                                                                                               |
| 11 — the arrowheads   | Passes. Unlit heads go below half scale; a selection's stay.                                                           |
| 12 — the labels       | **Failed on the label count.** Fixed below. Frame rate passes: 17.4 ms per draw at 500 nodes.                          |

### Defect 1: the reciprocal pair still overdrew

Task 5's whole point, and it never worked. `curveControlPoint` offsets along the
chord's _own_ left-hand normal, which reverses when the chord does, and
`curveSign` multiplied that by a sign derived from comparing the two keys. The
two negations cancelled: both halves bowed the same way and lay exactly on top
of each other, as they had before Task 5.

The unit test passed throughout, because it asserted
`curveSign("a", "b") === -curveSign("b", "a")` — the sign in isolation, never
composed with the geometry it feeds. `curveSign` is deleted; a positive apex on
each half's own normal separates the pair by construction. The test now takes
two control points from `curveControlPoint` and asserts they fall on opposite
sides of the chord.

### Defect 2: the label budget stopped almost immediately

A 500-node graph drew **one** label at fit, with two thirds of the plot empty.
The area share was nowhere near spent; the stop that fired was the limit of 14
consecutive placement failures. Labels are tried in citation order, and the
most-cited papers are exactly the ones heaped together at the top of a citations
axis, so the first fourteen candidates were all buried and the pass ended there.
A run of misses in one dense corner is not evidence that the sparse corners are
full.

`LABEL_FAILURE_LIMIT` becomes `LABEL_ATTEMPT_LIMIT` — 600 candidates considered,
placed or not. That keeps the bound the consecutive count was really there for,
since the loop is O(attempts) either way, and lets the walk reach the open space
behind the crowd. The same graph now labels about seventy papers, and the labels
cost 2.4 ms of the 17.4 ms frame.

### Defect 3: `colorScheme.test.ts`'s known flake, now frequent

It failed five runs in seven. As the handoff predicted, the fix was to assert
what the renderer actually depends on — that a query created after the pref flip
reports the new value — and to stop asserting the negative, that the cached
query has _not_ been restyled yet. A negative about a restyle that has not
happened is only true until the machine is slow enough to let it happen. The
cached query's behaviour is logged instead of asserted.

### One thing tried and reverted: batching the edge draws

An early reading blamed the edge loop for a 45 ms frame, so the loop was
rewritten to bucket edges by style and stroke each bucket as a single path.
Measured properly it was **five times slower** — 86 ms against 17 ms — and it
was reverted whole. Two lessons worth keeping:

- Cross-process timings on this graph swing by a factor of three. The only
  comparison worth making is interleaved, in one process, taking the minimum of
  several runs. Every conclusion drawn from separate `npm test` runs was wrong.
- Gecko strokes many small paths faster than one path with many subpaths. Do not
  reach for that batching again without an in-process A/B.

The per-edge draw is not the bottleneck it looked like: 500 nodes and 900 edges
come to 17.4 ms a frame, which is the 57 fps the check wanted.

### Harness notes for whoever runs it next

- `requestAnimationFrame` does not fire in an occluded window, so every frame
  wait is raced against a deadline and `mount()` calls `fitView()` itself. An
  unraced wait let mocha time out and start the next case into the same canvas.
- Zoom through the harness's `zoomTo`, never by setting `scale` alone — that
  leaves the pan offset behind and flings the graph off screen. The first `8x`
  frame it produced was blank.
- `browsingContext.overrideDPPX` is a no-op here. Shadow
  `window.devicePixelRatio` instead, and assert the canvas actually grew.

### Still not verified

The chrome _around_ the canvas. The harness mounts a bare canvas, so check 3
covers the canvas half of "canvas and chrome must follow in one step" and not
the DOM half. That needs the real `renderGraphView`, which needs a real library
snapshot; Task 6 builds DOM chrome and is the natural place to close it.

## Task 6: The Key model and the rail — **DONE**, verified

The task that answers the original complaint, and it does: on the default
collection colouring every swatch on the canvas now has a name and a count
beside it. `13-key-rail.png` from the harness is the evidence.

**`src/services/graphKeyModel.ts`** describes the active encoding as data, with
no DOM in it, so the rail and later the PNG export read the same description.
`buildKeyModel` takes an options object rather than the plan's four positional
arguments — it also needs the theme and the edge count.

The colour section takes its assignment from the renderer rather than assigning
again (`getCategoryAssignment()` is new), because the rail agreeing with the
canvas is the whole point; a rail that computed its own would name the right
colours only for as long as the two computations stayed identical. Swatches are
assigned across the whole graph so they never shuffle, but counts are recounted
over the nodes handed in and a category with nothing left under it is dropped:
"every colour on screen is named" has to hold in both directions.

**`src/services/graphKeyRail.ts`** renders it. **`setEmphasis()`** on the
renderer drops non-matching nodes _and their edges_ to 25% over a 120ms ease,
skipped under `prefers-reduced-motion`. An edge counts as matching if either end
does, so an emphasised group keeps its connections out into the graph.

**The Key still only emphasises.** Nothing here touches `visibleKeys` or
`PaperFilterController`; the harness pins it by checking the drawn edge count is
identical before and after an emphasis.

### Deviations

- **Only an entry that stands for a set of papers is a button.** The plan says
  entries are buttons with `aria-pressed`; a ramp stop and a link colour
  describe how the graph draws rather than which papers it drew, so they render
  as plain rows. A focusable control that does nothing when pressed is worse
  than no control. Every entry that _can_ emphasise is a button with
  `aria-pressed`, as specified.
- **The ramp and size rows carry their range as the label**, not as a trailing
  detail. The section subheading already names the metric, and repeating it
  pushed the numbers off the end of a 194px rail — visible in the first frame of
  the rail, which is what caught it.
- **`No data` explains itself in the section note**, not in the row. Same reason.
- The rail's collapse persists under `extensions.zotero.meristema.graphKeyRailCollapsed`.
- Zotero's chrome paints a raised chip and a border on a bare `button`, which
  made the pressable rows look like a different kind of thing from the static
  ones. `graph.css` suppresses both and carries the affordance on hover and
  `aria-pressed` instead.
- A rebuild of the model releases any pinned emphasis: the entries are new
  objects even when they describe the same thing, so a kept pin would leave the
  canvas emphasising something the rail could no longer show as pressed.

### Still not verified

The rail was driven in the harness against the real renderer, real `graph.css`
and the real theme, but mounted by hand rather than by `renderGraphView`. The
wiring in `graphViewService.ts` — the rail rebuilding from `updateSummary`, the
background click releasing a pin — is typechecked and lint-clean but has not
been watched running in a real library. That is the same gap as check 3's chrome
half, and it wants a snapshot-backed harness.

## Task 6 brief (original)

`graphKeyModel.ts`: `buildKeyModel(layout, assignment, nodes, states)` returning
the sections the spec lists — colour, size, links, states — with only the active
ones present, each entry carrying its label, mark, count and the predicate that
matches nodes to it.

`graphKeyRail.ts`: renders that model into the DOM. Sections as `<section>` with
uppercase headings; entries as buttons with `aria-pressed`. Hover calls a new
renderer `setEmphasis(keys | null)` that drops non-matching nodes and their edges
to 25%; click pins it; Escape and a background click release it. Collapse state
persists under `graphKeyRailCollapsed`.

Add `setEmphasis()` to the renderer with a 120ms opacity ease, skipped under
`prefers-reduced-motion`.

This is the task that answers the original complaint. Verify by opening a graph
on the default collection colouring: every colour on screen is now named.

**Test:** the model omits sections whose encoding is inactive; a numeric colour
metric produces a ramp section with the visible domain, a categorical one
produces swatches summing to the node count.

## The view harness — **DONE** (`a16aced`)

Task 6 left three things typechecked and unwatched, all for the same reason: the
harness built its own shell beside the canvas, so nothing `renderGraphView`
wires was ever running. `openViewStage` calls the product's entry point instead.
The substitution is the graph and only the graph — `storeCitationGraphSnapshot`
seeds the shared cache so a corpus reaches a view whose papers were never saved
to a library, and every other path stays in the product's hands. All three gaps
are now covered: the rail rebuilding from `updateSummary`, a background click
releasing a pinned entry, and the DOM half of check 3.

### What it found

- **A ResizeObserver feedback loop.** The renderer reassigned the canvas bitmap
  inside the observer callback, which is layout-affecting, so the observer
  delivered a second notification for the same frame and Gecko put an uncaught
  error on the window. Coalescing onto a frame ends it. It was invisible before
  because it takes the real chrome in the layout to provoke.
- **Check 12's budget was measuring the machine.** An absolute 33 ms sat either
  side of the line with nothing changed — it was 17 ms when written. It now
  compares against the labels-off run beside it, in the same process, which is
  the discipline the earlier reverted optimisation should have used.

### What it cannot see, and why

**The arriving camera.** The initial fit waits on animation frames, and Gecko
does not service `requestAnimationFrame` in an occluded window, so it never
lands in the harness — deterministically, not flakily. The stage presses the
view's own Fit button to get a comparable frame. A first version of this read the
un-fitted frame as a product defect; it is not, and the same starvation stops
`ResizeObserver` firing at all, which is why the canvas in the narrow-width
frames keeps its old bitmap and looks squashed. Do not chase either.

**Uncaught errors are read, not ignored.** Mocha blames whichever test is running
when one arrives and reports it with no message, so a real fault shows up as a
silently red test. The suite collects them from the view's window and from the
host, and asserts there were none. Both faults above surfaced only that way.

## Task 7: Command bar and control relocation — DONE, verified

`.cm-header` and `.cm-query-band` are one 40px `.cm-command-bar`, measured at
1200, 900, 720 and 560px and in tab mode: one row, 40px, at every width. The
`<h1>` is `.cm-visually-hidden` — out of the flow, still in the tree, checked by
computed style rather than by reading the class name. The zoom and appearance
controls sit in a new `.cm-key-footer`, and the harness proves they still work
there rather than merely that they moved. `windowService.ts` follows the rename
to `.cm-command-actions`.

### Deviations, so they are not "fixed" back

- **There is no view switcher.** The plan's bar order names one, and no such
  control exists in the view; map and focus are entered through the graph, not
  through a switch. The identity block — logo, hidden heading, counts — took its
  place. Building a switcher is a feature, not a relocation, and it is not here.
- **Add Node was not in the plan's list** and has not been dropped; it sits with
  the other actions.
- **The rail no longer hides itself when the Key is empty**, because it now
  carries the view's controls: `render()` empties the body and leaves the column.
- **A narrow bar drops the counts** rather than wrapping. Below 760px the counts
  are `display: none`; the search absorbs every other narrowing, since it is the
  bar's only elastic item.
- **`.cm-overlay-button` is deleted.** Both floating controls left the plot, so
  the frosted-glass treatment had no callers; the appearance button takes the
  rail's `.cm-rail-button`.

### Not verified

The focus bar. It is hidden outside Explore, and the harness has no way to seed a
focus projection over a synthetic library. Its own row is untouched by this task.

### The original brief

Collapse `.cm-header` and `.cm-query-band` into one 40px `.cm-command-bar`:
history, view switcher, counts in tabular numerals, search, then filter, similar,
export and refresh. The `<h1>` becomes visually hidden but stays in the
accessible tree.

Move the zoom and appearance controls out of the canvas corners into the rail
footer; delete `.cm-zoom-controls` and `.cm-appearance-control` positioning.

Update `windowService.ts:265`, which finds the filter button by querying
`.cm-header-toolbar button` — repoint it at the new container. This selector is
the one silent breakage in the reflow; check it before claiming the task done.

Verify in both a tab and a window, at narrow widths, that nothing wraps into a
second row and the focus bar still fits.

## From the first real run — DONE, verified

The author opened a graph from a folder's context menu and reported three
things. All three came from the same place: **a folder graph is the whole
library with a filter over it**, and everything that asked "what is in this
graph" asked the model instead of the filter.

- **The Key named folders that were not on screen.** `refreshKeyRail` was handed
  `model.nodes`, and `CitationGraphRenderer.categories()` ranked
  `assignCategories` over `model.nodes` too — so a graph of one folder handed
  its swatches to whichever folders were largest _library-wide_, and the rail
  listed them. Both now read `getScopeNodes()`.
- **The rail was 194px on `--cm-surface-raised`.** Zotero's
  `#zotero-collections-pane` is **200px** on `--material-sidepane`
  (`--color-sidepane`: `#f2f2f2` / `#303030`), divided by `--color-panedivider`
  (`#dadada` / `#404040`). The rail now uses those, via
  `var(--material-sidepane, …)` so the graph _tab_ inherits Zotero's own token
  and the standalone window — which loads only `chrome://global/skin/` — falls
  back to the same values. The detail panel matches, because Zotero paints
  `#zotero-item-pane-content` with the same token.

### The scope is the filter, not the search

`applyFilters` builds two sets now. `scopeKeys` is what the filter admits and is
what the graph is a graph _of_; `visibleKeys` narrows it further by the search
box. The colour assignment and the Key are built from the first, because
building them from the second would reshuffle every swatch on screen as the
reader typed.

### What deliberately did not change

The canvas still derives its axes, its radii and its numeric ramp from the whole
model, so filtering moves nothing — that is `setVisibleKeys`'s stated contract.
The Key therefore reads its _ranges_ from the model (`KeyModelInput.scaleNodes`)
and its _counts_ from the scope, and the two differ on purpose. A visible
consequence: a one-folder graph still shows the library's citation range under
SIZE while counting only the folder's papers. Worth an author's decision, not a
silent fix.

### Verified by

`view 7 — the Key names the folders in scope and no others` and `view 8 — the
rail is Zotero's own left pane`, both in `test/zotero/graphViewVisual.test.ts`.
View 7 asserts every one of the other six harness folders is absent after
`openCollections([3])`; view 8 asserts 200px and a painted, distinct sidepane.

## From the second real run: the bar goes — DONE, verified

The reader's complaint was that the command bar "doesn't exist in the normal
Zotero UI" and that switching to the graph felt like a layout shift.

**Zotero has no toolbar spanning its window.** Every pane carries a toolbar
inside it: `#zotero-toolbar-collection-tree` is a child of
`#zotero-collections-pane`, `#zotero-toolbar-item-tree` a child of
`#zotero-items-pane-container`. What looks like one band across the library is
two toolbars cut by the pane splitter — and it means the collections tree
begins _below_ its own pane's toolbar, at the same y as the items tree.

Task 7's single full-width bar broke that. The Key rail began under the bar
rather than at the top of the window, so the left column's top edge moved when
you switched into the graph. That is the shift, and it was real.

The bar is now two: `.cm-rail-toolbar` inside the rail, `.cm-plot-toolbar` at
the top of a new `.cm-plot-pane` that also holds the focus bar and the canvas.

### Zotero's numbers, from `omni.ja`

| Thing                                     | Value                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `.toolbar`                                | `height: 41px !important; min-height: 41px; padding: 0 8px`                       |
| `#zotero-layout-switcher .zotero-toolbar` | `background: var(--material-toolbar); border-bottom: var(--material-panedivider)` |
| `#zotero-collections-toolbar`             | `border-bottom: 1px solid rgba(0,0,0,0)` — and no background rule at all          |
| `--color-toolbar`                         | `#f9f9f9` light, `#272727` dark                                                   |
| toolbar buttons                           | `width: 28px; height: 28px; padding: 0 4px`                                       |
| `#zotero-items-toolbar` order             | buttons, `<spacer flex="1"/>`, `quick-search-textbox`                             |

The search therefore sits at the far right of the plot's toolbar, with the
history and action buttons gathered left. The identity — logo and counts — went
to the rail's toolbar, beside the collapse toggle, which is the shape of the
collections toolbar (a control, a spacer, a control).

### The toolbars are not painted alike, and that is Zotero

Read the selector: the `--material-toolbar` fill is scoped to
`#zotero-layout-switcher .zotero-toolbar`, and `#zotero-collections-pane` sits
**outside** the layout switcher — it is a sibling of it inside `#zotero-trees`.
So the fill never reaches the collections toolbar. It keeps `--material-sidepane`
from the pane around it, and Zotero cancels its bottom edge outright with
`border-bottom: 1px solid rgba(0,0,0,0)`. The left column is one unbroken block
of colour from the top of the window to the bottom; only the items toolbar is a
toolbar to look at.

Painting both with `--cm-toolbar` was wrong and the reader saw it immediately —
the rail grew a header in a colour Zotero does not use there. `.cm-rail-toolbar`
is `--cm-sidepane` with a transparent bottom border; `.cm-plot-toolbar` keeps
`--cm-toolbar` and its divider.

### The glyphs are drawn now

"←", "→", "‹" and "›" were button text. A text glyph sits on its font's
baseline — the arrows ride the maths axis, the chevrons are shorter than their
line box — so all four read a pixel or two high inside a centred button, and no
amount of `align-items: center` fixes it, because the line box _is_ centred.
`uiIconService.ts` gained `arrow-left`, `arrow-right`, `chevron-left` and
`chevron-right`, centred on the 24-unit viewBox. View 9 asserts the drawn
glyph's centre is within 0.6px of its button's, **on both axes**.

Both axes, because the horizontal one had a second cause. The shared button
rule is `.meristema-root button` — a class _and_ a type, so it outranks a bare
`.cm-key-toggle`, and the toggle silently kept `padding: 4px 9px` with no
`justify-content`: a 14px glyph in a 6px content box, flush against the left
edge. `.cm-history-controls button` matched the shared rule's specificity but
came earlier in the file and lost the same way. Any square icon button here has
to be written `.meristema-root .whatever`, or the padding comes back.

The toggle also says **"Collapse sidebar"**, not "Hide the key": since Task 7 the
rail carries the view's zoom and appearance controls too, so the button takes
more than the Key with it.

### The specificity trap, which bit three times

The stylesheet has broad rules written as `.meristema-root button` and
`.meristema-root input[type="search"]`. Both are _more_ specific than a
one-class component rule, and the second is more specific than a two-class one.
Everything a component tries to override there loses silently:

| The component said                             | What actually applied | What it looked like                                   |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------- |
| `.cm-key-toggle { padding: 0 }`                | `padding: 4px 9px`    | chevron against the left edge                         |
| `.cm-history-controls button { padding: 0 }`   | same, by source order | 16px glyph in a 6px box                               |
| `.cm-plot-toolbar .cm-search { height: 28px }` | `min-height: 30px`    | field 30px in a 28px slot, hanging 4px below its wrap |

The last one was reported as "the magnifier is aligned to the top". It was not:
the icon was centred in its wrap to the pixel, and the _field_ had grown past
the wrap and taken the text down with it. Measuring the DOM said so in one run —
`icon 12.1..28.1 h16 | wrap 6.1..34.1 h28 | field 8.1..38.1 h30` — after two
wrong guesses from the rendered pixels.

**Anything overriding those shared rules must be written
`.meristema-root .name`, and must repeat `min-height` as well as `height`.**

### A bug this uncovered

`--material-panedivider` is **not a colour**. It is `1px solid
var(--color-panedivider)`, a whole border shorthand. The previous session wrote
`--cm-panedivider: var(--material-panedivider, #dadada)` and used it in
`border-right: 1px solid var(--cm-panedivider)`, which expands to `1px solid 1px
solid #dadada` — invalid, so the declaration is dropped. It only bit inside a
**tab**, where the token resolves; the standalone window fell back to the
literal and looked correct. The token is now `--color-panedivider`.

### Not done, deliberately — done in the fourth run, below

The detail panel on the right is the third pane and has no toolbar, so its
heading still sits level with the top of the window rather than with the two
toolbars. Zotero does give its item pane a header row
(`#zotero-item-pane-header`, same 28px buttons). Aligning it is the obvious next
step but it redesigns that panel's top, which is more than a relocation.

### What pins it

`view 9 — the toolbars are Zotero's, one per pane` asserts both toolbars are
41px, share a top edge with each other **and with the rail itself**, that the
rail's toolbar is the rail's width less its divider, that both carry the same
painted background, that all three dividers survive, and that the search is the
rightmost thing in the plot's toolbar. `view 5` moved from `.cm-command-bar` to
`.cm-plot-toolbar` and now also asserts no window-spanning bar of any of the
three historical classes exists.

Note for anyone writing a border assertion here: Gecko snaps a hairline to the
device pixel grid, so a 1px border computes to **0.8px** at 1.25 dppx. Assert it
is non-zero, not that it is `1px`.

## From the third real run: the rail's buttons — DONE, verified

Two reports, one about drawing and one about behaviour.

### The last four typed glyphs

The rail's buttons were `+`, `−`, `⌘`‑adjacent `⌖` and `⚙` set as
`textContent`, which is the same defect the navigation arrows had: a text glyph
sits on its font's baseline, not in the middle of the button around it. The
crosshair and the gear are worse than the arrows, because no two interface fonts
agree on their size or side bearings at all. All four are drawn now
(`zoom-in`, `zoom-out`, `fit`, `settings` in `uiIconService.ts`).

The gear needed two things the others did not:

- **Even-odd fill.** Separate `<path>` elements cannot punch a hole in each
  other, so the bore has to be a second subpath of the same path, and the fill
  rule has to make a nested subpath a hole regardless of winding.
  `createIcon` now sets `fill-rule="evenodd"` on every path. The magnifier's
  lens already relied on opposite winding to be hollow and is unchanged by this;
  nothing else in the set has nested subpaths.
- **Generating it rather than writing it.** The first gear was hand-written path
  data and came out visibly lopsided — the user saw it before any test could.
  The shipped one is emitted from a polar sweep (eight teeth, 10.4 tip radius,
  8.0 root, 3.4 bore) and was rasterised and looked at _before_ being pasted in.
  Write the generator, look at the picture, then paste.

### The menus close on an outside click

The appearance panel and the export menu both closed only by pressing their own
button again. Neither is how a menu behaves anywhere else in Zotero.

The appearance panel did have a closer, `onGraphAreaPointerDown` — but Task 7
moved the control into the rail's footer, and that handler is bound to the graph
area, so a click on the rail, on either toolbar or on the detail pane never
reached it. The export menu never had one.

Both now use the shape the Add-node popup and the Focus seed popover already
used: a `pointerdown` listener on the _document_, in the capture phase, that
closes when the target is outside the control's wrapper, plus an `Escape`
handler that closes and returns focus to the button. Both pairs are removed in
`cleanup`. `onGraphAreaPointerDown` is down to its one real job, releasing a
pinned Key entry when the canvas itself is hit.

### What pins it

`view 6 — the zoom and appearance controls live in the rail` grew two parts: all
four rail buttons draw an `svg` centred on both axes within 0.6px of the
button's centre, and each menu is opened and then dismissed with a synthesised
pointer on the plot toolbar's padding — outside both wrappers and on no button.

## Task 8: Export

`exportGraphPNG()` composites the theme's plot background before the graph
instead of shipping a near-transparent canvas, and draws the Key model into a
corner block via a canvas renderer sharing `graphKeyModel.ts`. Verify a
dark-theme export pasted into a light document: readable, with its legend.

## Task 9: Verification pass

- `npx prettier --check` on every touched file, `npx eslint .`, `npm run typecheck`.
- `npm run test:unit`, then `npm test`.
- Open both view kinds in a tab and a window, in Zotero's light and dark themes,
  at a narrow and a wide width.
- Walk every colour metric and confirm the rail names every mark on screen.
- Refresh the screenshots in `docs/assets/` — they still show the pre-rename
  "Citation Map" chrome — and update the README figures.

## From the fourth real run: the detail panel — DONE, verified

Three reports about the pane on the right, all of them true, and all three had
the same root: the panel was the one part of the view never made to be Zotero's.
It was a scrolling `<aside>` with a 17px web heading, a rule under every metric
row, and a margin picked per block.

### The panel is a header over a body

`item-pane-header` is `padding: 8px`, `min-height: 41px`, `max-height: 25%`,
`overflow-y: auto`, with a rule under it — the same 41px the two toolbars are.
The panel is now that header over `.cm-detail-body`, which is the only thing
that scrolls, and the paper's title sits on the line the Key and the search sit
on. `renderGraphView` builds both; `detailHeader` is written only through
`setDetailHeader`, so a view that clears the body (the overview, a relationship
list, the graph-wide similar results) has to name its own header rather than
leave the last paper's title over someone else's content.

The title is `font-weight: 600` at the pane's own size, as Zotero's is. At 17px
it was the largest type anywhere in the view and the only piece of it Zotero
does not draw.

### The tab labels fit because they are two things

"Cited by (1284 reported)" was one string in a `repeat(3, 1fr)` grid. A `1fr`
column has an `auto` minimum, so the longest label sized all three columns and
then wrapped to three lines inside its own button — the overflow the reader saw.
The columns are `minmax(0, 1fr)` and the buttons `min-width: 0` now, and the
label is a name span the pane may clip beside a count span it may drop whole:

```css
@container (max-width: 320px) {
  .cm-detail-tab-count {
    display: none;
  }
}
```

`.cm-detail-panel` carries `container-type: inline-size` for that query. At the
pane's 260px minimum each tab has about 76px, which "Cited by" fills on its own,
so the tab keeps its name and loses the number rather than clipping both. The
whole phrasing — which says what the count is a count of — is on the tooltip.

### One rhythm, and Zotero's own table

`.cm-detail-section` is 8px above and below with a hairline between it and the
block before it, which is how the item pane divides its sections
(`:not(:last-child) > collapsible-section`). The metric list is Zotero's
`#info-table`: `grid-template-columns: max-content 1fr`, `column-gap: 8px`,
`row-gap: 2px`, the label right-aligned in `--fill-secondary` beside its value.
The rule under every row was the loudest thing in the panel and Zotero draws
none.

Two tokens carry the item pane's inks: `--cm-fill-secondary` and
`--cm-fill-quinary`, each `var(--fill-*, <the same value as a CanvasText mix>)`
so the tab resolves Zotero's and the standalone window falls back to it.

### The action bar's second group

`createPaperOverviewActionBar` held its two groups apart with
`justify-content: space-between`, which does nothing once they stop sharing a
line. In a 260px pane the Similar/refresh group came to rest at the left of its
own row, reading as a third group. It has `margin-inline-start: auto` now, so it
ends the bar on whichever line it lands on. Both the graph's panel and the item
pane section use that builder, so both were fixed by the one line.

### What pins it

`view 10 — the detail panel is Zotero's item pane` selects a paper through the
view's own controller, asserts the header shares a top edge with the toolbars
and is at least as tall as one, that no control in the pane has text wider than
itself or stands outside the pane, and that no tab is taller than 28px — at
360px and again at 260px. It captures the overview, a relationship list and the
whole thing in the light scheme.

The light capture opens a **second stage** after the pref is set rather than
flipping the appearance under the open one: a live flip repaints the plot, since
the renderer redraws from the new theme, but the chrome around it kept the
scheme it was built with and the capture came out light inside dark. `view 4` is
where the live flip is checked; this one wants a window that has one scheme
throughout, which is what a user's window has.

## From the fifth real run: the detail panel again — DONE, verified

The fourth run gave the panel Zotero's item pane. Looked at next to the other
two panes, three things were still wrong, and all three were about the pane's
_structure_ rather than its paint.

### The band across the top

The header carried the 41px floor, so the third pane's top edge was the header's
— which grew to 68px the moment a title wrapped, and the line the other two
panes' toolbars draw stopped two thirds of the way across the window. The pane
has a **toolbar of its own** now, `.cm-detail-toolbar`, painted from the same
two tokens `.cm-plot-toolbar` uses, and the header hangs under it with no floor
at all. Zotero's item pane has no toolbar because it sits under the window's,
which runs past the items pane to the right edge; this view split that band per
pane in the fourth run, which left the right pane owing the window a toolbar.

`view 10` measures all three toolbars now, not the header against one of them:
`band 0.0–41.0 0.0–41.0 0.0–41.0 header top 41.0`.

### The tabs are navigation, so they are chrome

Overview / Cited by / References moved out of the body into that toolbar. They
no longer scroll away under a 57-item reference list, they no longer sit
between the badges and the metrics as though they were content, and the body
lost a block — which is a gap that no longer has to be justified.

Below 320px the counts already dropped; the toolbar's side padding and the
tabs' own padding go with them, because "References" needed 70px and a 260px
pane was leaving each tab 65 — the tab said "Referenc…".

The collapse toggle at the toolbar's far end mirrors the rail's, and the
collapsed pane keeps a 36px strip (the 8px splitter and a 28px toolbar) rather
than vanishing to the splitter alone: a pane that could only be reopened by
finding an 8px target and double-clicking it was a pane most people would not
get back.

### The badges belong to the title

They say what the paper _is_ — open access, retracted, top 1% — so they are in
the header with the creator line, not in the first section of the body where
they read as a row of the metrics table.

### The rules between sections

The item pane's `--fill-quinary` is 5% ink. On the dark sidepane that is not a
divider, it is nothing, and the blocks it was meant to separate read as one
drift of content — which is what "the spacing between the sections seems off"
was describing. The sections use `--cm-border-soft`, the rule the Key rail
already draws between _its_ sections, so the eye reads one divider in this
window rather than two.

### A related work is a row, not a card

Every citing paper was a bordered, raised, rounded box: boxes inside a box, and
the loudest thing in a window whose subject is the plot. `.cm-external-card` is
a flat row now, bled to the pane's edges with the body's own -8px, divided by
the same hairline, its controls 11px chips under the title rather than
full-size buttons competing with it. A retracted work keeps a mark of its own
as an inset bar down the start edge, since there is no border left to colour.
Six works fit where three did.

Three cuts went with it. **"No DOI or URL"** — an empty field is not a fact
about the paper, and thirty of them is a column of nothing. **"In Zotero"** —
the row's first button already says "Show in Zotero" on exactly those works and
"Add to Zotero" on the rest, so the badge was one fact said twice, on nearly
every row. **"1 citations"** — `externalWorkMetadataText` counts singular and
plural now.

The overview's action bar takes `groupAlignment: "flow"`, so its five controls
wrap as one left-aligned group. The split the item pane wants — actions at the
start, Similar/Refresh at the end — is still the default and still what
`itemPaneService` gets; in a 300px graph panel the bar never fits on one line,
and a split bar there is not two ends of a row but a left-aligned row and a
right-aligned one.

`Provider` reads "OpenAlex" through `citationDataSourceLabel`, not the
"openalex" the record is keyed by.
