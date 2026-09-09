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

| meaning                        | channel                        | palette                                |
| ------------------------------ | ------------------------------ | -------------------------------------- |
| where a paper lives (folder)   | a **region** behind the nodes  | one categorical swatch per folder      |
| how it scores (metric)         | the node's **fill**            | `theme.ramp`, or a categorical swatch  |
| whether it is a seed           | the node's fill, **overriding** | new `theme.seeds`, six hues            |
| whether the library holds it   | a thin **ring**                | a tint of the node's own fill          |

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

- **The checkbox** still means *in scope or not*, with the mixed state for a
  partly-ticked subtree. Nothing about scope changes. It grows, because it
  stops being the whole row, and gains a keyboard path of its own.
- **The rest of the row** becomes a **selected** state, which draws that
  folder's region. The selected row is bordered in the folder's own colour, so
  the rail says which hull on the plot is which — no separate colour chip.

Selection is multi, by plain click, toggling; no modifier keys, because seeing
two folders' territories at once is the comparison a hull is best at. A cap of
**four** regions holds; selecting a fifth releases the oldest. Selecting an
unticked folder ticks it first, since an out-of-scope folder has no papers on
the plot and its region would be empty. A parent's region covers its whole
subtree, matching how scope already cascades through `collectionScopeIDs`.

This is new behaviour on an existing control: the row is a `<label>` wrapping
its checkbox today, so clicking the name currently ticks it. After this, only
the box ticks.

### Where the regions are computed

`src/services/graphFolderRegion.ts` is new, DOM-free and unit-tested. It takes
node positions in screen space, a set of keys for one folder, and a grid pitch,
and returns closed contours.

- A scalar field on a fixed-pitch grid: each node contributes a radial falloff
  over a radius in device pixels, summed.
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

State version **3**. New in the saved graph: the selected-region set, the
colour assignment map, and seed colours as identity rather than position.

`"collection"` is today's **default** colour metric, so almost every saved graph
carries it, and it is being removed. Such a graph migrates to `Uniform` fill
**plus regions selected for its top-ranked folders, up to the cap of four** —
so it opens looking like it did in spirit, its folders visible in colour,
rather than opening grey. A graph already on a numeric or other categorical
metric keeps its metric; it gains an assignment map seeded from its current
rank order, so nothing repaints on the upgrade itself.

## Verification

- `graphFolderRegion` unit tests: a known field to a known contour, an island
  case, a hole case, a saddle case, an empty folder and a single-node folder.
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
