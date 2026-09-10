# The Colour System: Four Meanings, Four Channels

**Date:** 2026-09-09
**Status:** Approved 2026-09-09

Backlog entry D3, which subsumes B12. Found in the 2026-09-09 walk-through of
Stage 2 (`docs/superpowers/handoffs/2026-09-09-walkthrough-findings-handoff.md`).
Stage 3 (citation hops) and Stage 4 (citation floor, shared citers) are not in
this spec, but this spec reserves the channels they need and says so.

## Problem

Four things colour the plot, and they were never designed against each other.

| what            | where it comes from                             |
| --------------- | ----------------------------------------------- |
| folder          | `theme.categorical.swatches`, **by rank**       |
| seed            | `theme.categorical.swatches`, **by seed index** |
| metric colour   | `theme.ramp`, teal → yellow                     |
| in-library ring | the constant `states.inLibraryRing`, `#4f9a5e`  |

`#4f9a5e` **is** ramp stop three. Swatch three is `#039f6c`. So a graph with
four seeds coloured by citations — the user's, on 2026-09-09 — had a green seed
against a green-to-yellow ramp, with green rings on the papers reaching it.
Three meanings, one colour.

Two structural faults sit under that.

**Colour is dealt by rank.** `assignCategories` orders categories "largest
first, ties by label" and hands out `swatches[index]` by that rank. The sort
was written so the order never depends on input order, which it does not — but
it depends on the counts, and every tick changes them. Tick PhD and it is
magenta; tick DOKwood as well and DOKwood takes magenta while PhD becomes
purple. That is **B12**. Colour is the reader's handle on a folder and it moves
under them.

**Seed colour is dealt by position.** `seedColorsFor` maps
`state.seedKeys.map((key, index) => seedColorAt(index, theme))`. Remove the
first seed and every remaining seed is repainted. The same fault as B12, on the
other palette, and nobody had filed it.

**Folder membership is squeezed into the node's fill.** A paper filed in three
folders is drawn as three pie slices, capped at `MAX_SLICES_PER_NODE`; and
because the fill can only say one thing at a time, choosing a numeric metric
silently takes folder membership off the plot altogether. The user's own
verdict on the centre of a seed: it should not be the folder at all.

## Design

One meaning per channel, and no palette shared between two channels.

| meaning                      | channel                         | palette                               |
| ---------------------------- | ------------------------------- | ------------------------------------- |
| where a paper lives (folder) | a **region** behind the nodes   | one categorical swatch per folder     |
| how it scores (metric)       | the node's **fill**             | `theme.ramp`, or a categorical swatch |
| whether it is a seed         | the node's fill, **overriding** | new `theme.seeds`, six hues           |
| whether the library holds it | a thin **ring**                 | a tint of the node's own fill         |

Reserved, not used here: the **unfilled outline** belongs to Stage 4's citation
floor, and nothing in this spec may spend it. That is why the in-library mark
stays a thin coloured ring rather than becoming an outline.

### Folder membership becomes a region

`"collection"` leaves the node-colour dropdown. A folder is drawn as a shape
behind the nodes: a marching-squares contour over the folder's papers, filled
in the folder's colour at 75% transparency with its border solid at full
strength. Islands are allowed and are not a special case — a folder split
across the plot simply yields more than one closed contour.

This is what pays for the rest. Set membership gets a channel of its own, so
the fill is free for the metric, a paper in three folders sits inside three
shapes instead of being cut into three wedges, and folder colour and the ramp
can no longer meet on the same mark.

Consequences, all of them deletions:

- `MAX_SLICES_PER_NODE` and the multi-slice arc drawing in `drawNode` go. Every
  surviving categorical metric — publication type, provider, open access,
  retraction — is single-valued per node, so `colorsFor` returns one colour and
  its return type narrows from `string[]` to `string`.
- The `"collection"` case leaves `nodeCategories` and the colour dropdown.
  `collectionLabelsByID` stays: the region legend needs the same labels.
- A `"Uniform"` colour option joins the dropdown and becomes the default
  (`citationPreferences.ts`), painting every non-seed node one neutral tone
  from a new `states.uniformFill` token. It is not `categorical.noValue`: "no
  value for the metric" is a different statement from "no metric chosen", and
  a reader must not be told the first when the second is true.

### The seed's mark

A seed's fill is its own colour, from a dedicated palette, and it **always
wins** — whatever the colour metric, a seed is its own colour. Seeds are the
fixed anchor set the reader navigates by; their metric values are read in the
rail and the detail pane, not off the plot. The seed's ring stays, in the same
colour, so a seed still reads as a bullseye.

`theme.seeds` is a new token list of six hues drawn from the half of the wheel
the ramp cannot reach — crimson, orange, purple, indigo, magenta, violet — with
lighter variants on the dark theme. A seed can never be mistaken for a metric
value because no metric value is ever that hue. The palette overlaps the
categorical swatches in hue territory, which is acceptable and deliberate: a
swatch now appears only as a large translucent hull, never as a small disc, so
the two can never be confused as marks even where the hues are neighbours.

Candidate values, to be adjusted by the validator below before they land:

```
light: #d0104c  #d55f00  #8a2be2  #1544c4  #b0006e  #5b3bb8
dark:  #f2447c  #f07a1a  #b47bff  #5a8cff  #e04a94  #8f6ae0
```

A seed's colour is a property of the seed, not of its position: it is allocated
when the seed is added and held until the seed is removed, so removing seed 1
leaves the others alone.

Past six seeds the palette is exhausted and two seeds must share a hue. The
seventh takes the **longest-released** colour, or, if all six are held, the one
held by the oldest live seed — never `index % 6`, which would repaint on every
removal and reintroduce the fault this replaces. Two seeds of one colour are
told apart in the rail, whose row hover already lights one seed and its edges;
the plot is not asked to carry a distinction it has no channel for. Six is well
past the seed counts in use, so this is a guard, not a working mode.

### The in-library ring

`inLibraryRingColor` already derives from the node's fill — a 45% brightening —
and that stays; a ring that is a tint of its own node is relational and cannot
collide with anything. Only its fallback is wrong: `states.inLibraryRing` is
`#4f9a5e`, which is ramp stop three, so an unparseable fill produces a ring
that reads as a metric value. It becomes a neutral tone in both themes.

### Colours stop being dealt by rank

`assignCategories` keeps ranking — rank still decides which categories are
named in the Key and which collapse into `other` — but stops deriving colour
from it. A **per-graph assignment map**, category key → swatch, is allocated
first-come from the lowest unused swatch and persisted with the graph. A key
holds its swatch for as long as it is present, across ticks, metric changes and
reopens. When the eight are exhausted, the longest-released swatch is reused.

The same mechanism serves folder-region colours and the four remaining
categorical metrics, so B12 is fixed once, in one place, for both. A folder's
swatch is allocated when it is first selected, and a categorical metric's when
its category is first named; the two draw from the same pool, and may land on
the same swatch, which is safe for the same reason the seed palette may overlap
it — a region is a large translucent hull and a category is a small solid disc,
so they are never confusable as marks.

Assignment is keyed by category key, never by label: two folders can share a
name, which is why `keysFor` exists.

### The rail

The scope row splits into two hit zones.

- **The checkbox** still means _in scope or not_, with the mixed state for a
  partly-ticked subtree. Nothing about scope changes. It grows, because it
  stops being the whole row, and gains a keyboard path of its own.
- **The rest of the row** becomes a **selected** state, which draws that
  folder's region. The selected row is bordered in the folder's own colour, so
  the rail says which hull on the plot is which — no separate colour chip.

Selection is multi, by plain click, toggling; no modifier keys, because seeing
two folders' territories at once is the comparison a hull is best at. A cap of
**four** regions holds; selecting a fifth releases the oldest. A parent's
region covers its whole subtree, matching how scope already cascades through
`collectionScopeIDs`.

Scope and selection stay consistent in both directions. Selecting an unticked
folder ticks it first, since an out-of-scope folder has no papers on the plot
and its region would be empty; and unticking a selected folder clears its
selection, for the same reason — a region with nothing inside it is a shape
that says nothing. Ticking it again does not bring the region back: the reader
asks for a region by selecting it.

This is new behaviour on an existing control: the row is a `<label>` wrapping
its checkbox today, so clicking the name currently ticks it. After this, only
the box ticks.

### Where the regions are computed

`src/services/graphFolderRegion.ts` is new, DOM-free and unit-tested. It takes
node positions **in data space**, a set of keys for one folder, and a grid
pitch, and returns closed contours in data space.

Data space, not screen space, and that is the load-bearing choice. A field
built from screen positions with a falloff in device pixels makes the contour a
function of the zoom: zoom in and a folder's territory fragments into islands,
zoom out and separate islands merge, because the nodes move apart and together
on screen while the papers do not. The reader's handle on a folder would move
under them again, in a new way. In data space the topology is invariant under
pan and zoom, and a folder fragments only when its papers genuinely are apart.

> **Amended 2026-09-10 by D6**
> (`2026-09-10-graph-region-curves-design.md`). This still holds at and below
> the fit zoom, and the contour there is byte-identical to what this spec
> shipped. Past the fit zoom the falloff radius tightens in inverse proportion
> to the zoom, so a folder's topology _is_ a function of the zoom there. That
> reverses this paragraph knowingly, on a reason this spec's review never
> weighed: zoomed in, a data-space hull has its edge off-screen and stops
> telling the reader which papers made it. Read D6's "The reversal, and why it
> is allowed" before treating the rule above as current.

The mirror problem — a node's disc is a constant size in device pixels, so a
data-space hull is a vast halo around small marks at high zoom and sits inside
them at low zoom — is solved at draw time, not in the field: the contour is
**dilated by a device-pixel amount** equal to the node radius plus a gap, by
stroking the path with a wide, round-joined stroke beneath the fill. Clearance
from the marks is then constant on screen while the shape being cleared is not
a function of zoom.

Pan and zoom therefore need no recomputation at all: the cached path is
transformed by the same viewport transform the nodes use. The field is rebuilt
only when node positions or the selected set change.

- A scalar field on a fixed-pitch grid: each node contributes a radial falloff
  over a radius in data units, summed. The grid's domain extends at least one
  and a half falloff radii beyond the bounding box of the folder's nodes, so
  the field reaches its threshold inside the grid and the contour tapers
  closed instead of being clipped square at the edge.
- **Marching squares** at a threshold, with the full case table and saddle
  cases disambiguated by the cell's mean value, so a contour never
  self-intersects. Linear interpolation along cell edges places each vertex.
- Contours are closed and lightly smoothed. Islands need no special case: a
  disconnected folder yields several contours, a hole yields a contour wound
  the other way, and filling with the even-odd rule draws both correctly.

It returns paths only — no canvas calls — so it tests on fixtures without a
renderer. The renderer draws them beneath the nodes and above the grid, and
recomputes only when node positions, the viewport or the selected set change,
cached against a revision the way `categoryAssignment` already is.

### State and migration

Two stores are involved, and they are not the one store an earlier draft of
this spec assumed.

**The colour metric is a preference, not part of a graph.** `nodeColorMetric`
lives in `GraphLayoutOptions`, held in the single `graphAppearance` preference
(`citationPreferences.ts`) and shared by every graph. So no saved graph carries
`"collection"` and none needs migrating for it. `DEFAULT_GRAPH_LAYOUT`'s
`nodeColorMetric` becomes `"uniform"`, and `getGraphAppearance` coerces a
stored `"collection"` — now a value that no longer exists — to `"uniform"` on
read, leaving every other option untouched.

The appearance schema version is deliberately **not** bumped.
`GRAPH_APPEARANCE_SCHEMA_VERSION` is a blunt instrument: a mismatch makes
`getGraphAppearance` write `DEFAULT_GRAPH_LAYOUT` over the whole record, which
would throw away the reader's axes, scales, size metric and label mode to
change one field. The coercion above does the same job and costs them nothing.

**State version 3** covers what is genuinely per graph: the selected-region
set (ordered oldest first, capped at four), the swatch assignment map, and each
seed's colour index.

A version 2 graph is migrated by its ticks, because `parseGraphViewState` has a
recipe and no nodes — it cannot rank folders by how many papers they hold, and
must not pretend to.

- Ticks of `{ base: "none", except: [...] }` — a graph made from folders — take
  those folders as their regions, in ascending ID order, capped at four. The
  graph opens showing the folders it was made from, which is what it looked
  like when folder colour was the default fill, and is the same rule F7 asks
  for on a new graph.
- Ticks of `{ base: "all", ... }` — a whole-library graph — take no regions.
  Choosing four folders out of a library the reader never singled out would be
  noise dressed as continuity.

Neither case can repaint anything on upgrade, since a version 2 graph has no
recorded assignments to disagree with; the map fills as folders are selected.

## Verification

- `graphFolderRegion` unit tests: a known field to a known contour, an island
  case, a hole case, a saddle case, an empty folder and a single-node folder.
  Two more that guard the choices above: the same nodes under two different
  zoom levels produce the **same contour** (the field is data-space, so zoom
  cannot fragment a folder), and a folder whose nodes sit at the extreme of the
  plot produces a **closed** contour, not one clipped by the grid's edge.
  (Amended by D6, 2026-09-10: this now reads "two zoom levels **at or below
  the fit** produce the same contour", and a second case, at the renderer's
  boundary in `test/unit/citationGraphRendererRegions.test.ts`, asserts that a
  zoom past the fit produces a tighter one.)
- A **palette validator** as a unit test over the ramp, the eight swatches and
  the six seed colours together, in both themes: lightness band, chroma floor,
  CVD-simulated separation and normal-vision separation. This is new. Nothing
  in the repo currently enforces what `graphTheme.ts`'s comment claims was
  validated, and the seed hexes above will be adjusted to pass it. It also
  locks the existing values against a careless edit.
- Assignment stability: ticking a folder repaints nothing; removing seed 1
  leaves seeds 2..n; a reopen reproduces every colour.
- Visibility and cap: selecting a fifth folder releases the oldest; selecting
  an unticked folder ticks it.
- Zotero suite: a case that selects two folders and asserts two regions, and a
  version 2 → 3 migration case built on a graph saved with `"collection"`.
- Manual checks appended to the roadmap's batch, for the user's next walk.

## What this does not do

- It does not touch the citation floor or shared citers (Stage 4), and it
  leaves the unfilled outline unspent for them.
- It does not add graph templates (D4). Templates would set colour metric,
  region selection and the rest as a bundle; this spec gives them something
  coherent to set.
- It does not change what papers are on the plot. Scope, seeds and the
  visibility order from the Scope rail spec are untouched.
