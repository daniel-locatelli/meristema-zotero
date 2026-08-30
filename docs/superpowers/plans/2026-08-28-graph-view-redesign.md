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

| File                                      | Responsibility                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/services/graphTheme.ts`              | **New.** Light/dark tokens, both palettes, the state grammar, CSS custom property mirroring.  |
| `src/services/graphCategoryAssignment.ts` | **New.** Rank-based category → swatch assignment and counts for all five categorical metrics. |
| `src/services/graphKeyModel.ts`           | **New.** Pure description of the active encoding, consumed by the rail and the export.        |
| `src/services/graphKeyRail.ts`            | **New.** The DOM rail, its sections, hover/pin emphasis, collapse persistence.                |
| `src/services/citationGraphRenderer.ts`   | Screen-space drawing, emphasis API, gridlines, gutters, edge curvature; loses `drawLegend`.   |
| `src/services/graphRendererScene.ts`      | Screen-space labels, the label budget, ghost drawing.                                         |
| `src/services/graphMetricScale.ts`        | Ramp moves to the theme; `categoricalColor` is deleted.                                       |
| `src/services/graphViewControls.ts`       | Command-bar reflow, `colorForCollection` deleted, legend checkbox removed.                    |
| `src/services/graphViewService.ts`        | Header/query-band collapse, rail mounting, control relocation.                                |
| `src/services/exportService.ts`           | Opaque background and a Key block in the PNG.                                                 |
| `src/services/windowService.ts`           | The `.cm-header-toolbar` selector follows the reflow.                                         |
| `addon/content/graph.css`                 | Command bar, rail, tokens, furniture; the decorative radial gradient goes.                    |
| `test/unit/*.test.ts`                     | **New.** Fast `node --test` suite for the four pure seams.                                    |
| `test/architecture.test.ts`               | Existing pure-seam tests migrate out to `test/unit/`; the file keeps only Zotero-bound tests. |

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

## Task 2: Draw in screen space — **NEXT**

The core change, and the one with the most blast radius.

`drawLegend()`, `setLegendVisible()`, `getLegendVisible()`, the `graphShowLegend`
pref and the appearance checkbox are **already gone** — they came forward with
Task 1. What remains is the coordinate change itself.

Two notes for whoever picks this up. The canvas is device-pixel backed, so
"screen space" here means canvas device pixels: every screen-space size needs the
`canvas.width / rect.width` ratio applied, the way `drawAxes` already does.
And `hitTest` compares against a radius — once radii are screen units, the
world-space hit test has to divide by `transform.scale` or it will drift.

Delete the `translate`/`scale` pair from `draw()`. Add
`projectToScreen(position): Position` and project every node position once per
frame into a `Map` the draw methods read. Convert, in order: node fills and
radii (radius becomes screen px, `MIN_NODE_RADIUS`/`MAX_NODE_RADIUS` reinterpreted
as screen units), node outlines, state marks, edges, arrowheads, labels
(`graphRendererScene.ts`), and the ghost preview.

Leave `screenToWorld`, `hitTest`, `fitView`, `fitKeys`, the drag handler and the
wheel handler working in world space — they already do the projection maths
themselves and must not change behaviour.

Delete `drawLegend()`, `setLegendVisible()`, `getLegendVisible()`, the
`graphShowLegend` pref reads and writes, and the legend checkbox in the
appearance panel.

Verify by zooming from fit to 8×: label size, outline weight and arrowhead size
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

## Task 4: Plot furniture

The decorative radial gradient is already off `.cm-graph-area`.

Gridlines at every tick, beneath the nodes, in the theme's grid token. A hairline
frame around the plot, and the plot painted in the paper tone. Dashed separators
and rotated `NO DATA` labels on the x and y gutters, drawn only when a node is
actually parked there. Remove the decorative radial gradient from
`.cm-graph-area`.

Apply the type scale: axis titles and gutter labels in uppercase with tracking,
ticks in tabular numerals, all sharing the chrome's font stack.

## Task 5: Edges and labels

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

## Task 6: The Key model and the rail

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

## Task 7: Command bar and control relocation

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
