# Citation Hops: One Direction, Fetched Lazily

**Date:** 2026-09-12
**Status:** Approved in the brainstorm of 2026-09-12; not yet planned

Stage 3 of `docs/superpowers/handoffs/2026-09-08-roadmap.md`, layer 2 of the
citation chain depth design
(`docs/design_handoff_citation_chain_depth/README.md`, option 6a, item 2).
Depends on Stage 2 (`2026-09-08-graph-scope-rail-design.md`) and on B6. Layer 3
(the citation floor, shared citers, the presets) is Stage 4 and is not in this
spec.

## Problem

A seed today reaches one hop: the papers it cites and the papers that cite it,
both at once, up to 200 each. There is no way to go further without making a
neighbour a seed, no way to tell a paper two hops out from one hop out, and the
gear's Explore section (direction, locality) is the only control over what a
seed brings in. The design's answer is a ladder of hops in the rail, each
fetched on demand and each toggleable, with `{shown}/{available}` per row.

Fetching is the constraint. Hop 2 is the union of the citers of every hop-1
paper; with 200 hop-1 papers and the providers' one request per second
(`2026-09-10-provider-rate-limits-design.md`), one press of a whole-hop button
runs for minutes and can bring tens of thousands of nodes. The user's answer,
taken in the brainstorm, is a lazy fill with a priority queue rather than a
batch.

## Decisions taken in the brainstorm (2026-09-12)

| question                                                  | decision                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hops forward, backward, or both                           | **One direction at a time**: citers of citers, or references of references, never both. To see the references of a citer, make the citer a seed.                |
| Where the direction lives                                 | **One direction for the whole graph**, a switch in the rail's Citation hops block. Not per seed.                                                                |
| What fetches automatically                                | **Hop 1 is automatic** the moment a graph has a seed, as today. Hops 2 to 6 are opened by the Fetch hop N button.                                               |
| Whole hop per press, or bounded, or lazy                  | **Lazy fill with a priority queue.** The selected paper first, then the hovered one, then papers on screen, then the rest of what is shown.                     |
| Where the fill stops                                      | **It fills only what is shown**, then idles; a change of scope or a new selection wakes it. Hidden papers are never expanded until shown.                       |
| Whether the camera gates the fill                         | **Scope gates, the camera orders.** Panning changes the order of the queue, never its contents. The plot grows only because of things the reader clicked.       |
| The presets Full, Balanced, Core                          | **Deferred to Stage 4.** Two of the three set only the floor, which does not exist yet.                                                                         |
| How a hop shows on the plot                               | **Citation hop is a categorical colouring** in the gear, like publication type; hop opacity fades under every colouring. The design's hop-painted fill is not.  |
| Architecture                                              | **One hop model replaces the focus projection.** The per-seed projection is a one-hop special case of a breadth-first walk.                                     |
| The study branch `worktree-connectedpapers-feature-study` | Its order (Prior/Derivative works first) is noted and not adopted; its own verdict says Derivative works needs the citer lists hop fetching builds. Not merged. |

Smaller calls made by the spec: the default direction is Citers; a paper
reached at several depths sits at its shallowest hop and keeps every parent;
six hops maximum; each expansion takes up to 200 works per paper, the seed's
limit today.

## Design

### Vocabulary

- **Direction**: `cited-by` (Citers in the rail: who cites this) or
  `references` (References: what this cites). One per graph.
- **Hop**: a paper's distance from the nearest seed along the direction. Seeds
  are hop 0. Hop 1 is the direct citers (or references) of the seeds; hop k+1
  is the direct citers (or references) of hop k.
- **Depth**: the deepest hop the reader has opened, 1 to 6. Hops past the depth
  are not walked and not fetched.
- **Expanded**: a paper whose own list in the current direction has been
  fetched and stored. Derived from the relationship store, never persisted.
- **Parents**: the papers one hop shallower that link to a paper. A hop paper
  keeps all of them, so chains, downstream hiding and, in Stage 4, shared-citer
  counts read the whole picture.

### The hop model

A new pure module, `src/services/graphHopModel.ts`, DOM-free and Zotero-free.

Input: the seed nodes, the direction, the depth, and a lookup from a paper key
to the works its stored list in that direction names (each with its key and
summary metadata, the shape the seed refresh publishes today). Output, per
paper reached:

```ts
interface HopEntry {
  key: string;
  hop: number; // 0 for seeds, 1..depth otherwise
  parents: string[]; // every paper one hop shallower that links here
  expanded: boolean; // its own list in this direction is stored
}
```

plus the nodes and edges the plot draws: a hop paper the library holds is the
library's own node; one it does not hold becomes an external node carrying its
cached summary metadata, the way `externalWorkToFocusNode` builds one today.
Every parent link is an edge citer → cited (so under References, the edge runs
from the parent to the child; under Citers, from the child to the parent).

The walk is breadth first from the seed set. A paper already assigned keeps its
hop and gains a parent; a seed is never reassigned, so promoting a hop-2 paper
to a seed recomputes every hop from the new seed set. The walk reads the
stored lists only; it never fetches. The model stamps `hop` on each node it
emits, where the projection stamped the focus role, so the Citation hop
colouring and the renderer's opacity ramp read it from the node.

`buildGraphFocusProjection`, `GraphFocusState`'s direction, locality, ranking
and `maxPerDirection`, `reachedBySeed`, and the focus projection cache in
`focusGraphCacheService.ts` are deleted. `additiveGraphModel` survives with the
hop model's nodes and edges as its second argument: the library's own node
still wins.

### Visibility, in order

`computeGraphScope` keeps its order and gains three rules between "a seed is
always visible" and the folder rule:

1. A seed is visible, always.
2. The paper's hop is at most the depth.
3. The paper's hop is enabled.
4. At least one parent is visible.
5. Admitted by folder ticks (library papers) — unchanged from Stage 2. A hop
   paper is admitted by rule 4 the way a reached paper was admitted by seed
   reach, beside the folder rule rather than under it.
6. External papers only while Not in Zotero is ticked; hidden keys; the Filter
   popover's facets — unchanged.

Rule 4 is what makes disabling hop 2 hide hops 3 to 6 with no special case:
their parents are hidden. It is also why unticking a folder that holds the
only parent of a hop-3 paper hides that paper: the chain to it is gone. The
function walks papers in hop order so a parent's visibility is settled before
its children are read. Its result gains, per hop, `shown` (survived every
rule) and `available` (reached by the walk at that hop), which the rail prints.

### The fill

Two parts: a pure planner and a runner.

**Planner**, `src/services/graphHopFillModel.ts`. Input: the hop entries, the
scope result's visible keys, the selected key, the hovered key, the keys inside
the camera, the depth, and the keys that failed this session. Output: the
ordered list of papers to expand, and per hop the number still to expand.

A paper is in the list when its hop is below the depth, it is visible, it is
not expanded, and it has not failed this session. Order: the selected paper,
then the hovered paper, then papers inside the camera, then the rest; ties by
citation count descending, then key. Hidden papers are absent: that is the
gate. The camera never changes membership, only order.

**Runner**, in `graphViewService.ts`. It recomputes the plan whenever scope,
selection, hover, camera, depth or direction changes, and keeps one request in
flight through the existing serial refresh queue. An expansion is
`refreshExternalRelationships` for that paper in the current direction with
the seed's limits (200 works, membership first, summaries hydrated
cooperatively), so results land in the relationship store, survive a direction
switch and a reopen, and are the same records a seed's refresh writes. When a
result lands the hop model is rebuilt, the scope recomputed, the plan
re-sorted. A request already in flight for a paper that has left the plan
finishes and stores; it is not cancelled. A provider failure is logged, marks
the paper failed for the session, and the runner moves on. The runner pauses
while the tab is inactive and resumes on return, the way the seed refresh
already defers.

**Controls.** Fetch hop N sets the depth to N and enables hop N; the runner
starts because hop N−1's shown papers are now below the depth. Stop, on the
progress line, sets a session-only paused flag; the line then reads Resume.
Fetch hop N+1 clears the flag. Hop 1 opens the moment a graph gains its first
seed, so a new seed fills the plot as it does today; the seed's own refresh
remains the automatic path it is now and the runner takes over from hop 1's
papers onward.

**Direction switch.** Switching keeps the seeds, the depth and the toggles,
rebuilds the walk from the stored lists in the new direction, and the runner
fills whatever is shown and not yet expanded that way. Nothing fetched in the
old direction is discarded; switching back finds it.

**Refresh** (the toolbar button) forces the seeds' lists as today and marks
every expanded paper in the current direction stale for this session, so the
runner refills the open hops in priority order.

### The rail

The Scope section gains a **Citation hops** block under Collections, in
`graphKeyRail.ts` with its rows from `graphScopeRailModel.ts`.

- A two-cell segmented switch, **Citers** | **References**, above the rows.
  Same family as the presets' segmented control in the design (11px, radius
  5, active cell on the hairline fill).
- Rows **Seeds**, **Hop 1** … **Hop 6**: a 13px swatch, the label, the count
  in tabular figures, a checkbox on every row but Seeds. The count is
  `{shown}/{available}` for a hop at or below the depth, and **not fetched**
  past it. Rows past the depth or unticked draw at 0.45 opacity.
- The first row past the depth carries the **Fetch hop N** button in place of
  its count. It is absent when the depth is 6.
- While the runner has work in the current plan, the deepest open hop's row
  is followed by a progress line: `expanding · {n} left` with a **Stop** link,
  which reads **Resume** while paused. The line disappears when the plan is
  empty.
- The swatch is the hop's category colour only while the colour binding is
  Citation hop; otherwise a neutral dot from the theme, so the rail never
  suggests a colour the plot is not using.
- A hop's checkbox toggles `enabled[hop]`. Ticking a hop past the depth does
  nothing: the row is inert there, as the design draws it.

### The plot

- **Citation hop** joins `SUPPLEMENTARY_PROPERTY_DEFINITIONS` as a categorical
  property, group Explore, `graph: { nodeColor: true, filter: true }`, value
  the node's hop, formatted `Seed`, `Hop 1` … `Hop 6`. It draws through the
  category swatch ledger like publication type, and the Key's category section
  explains it. It is not a column.
- Hop opacity: the design's ramp `[1, .9, .8, .7, .6, .5, .4]` by hop, applied
  to fill and label under every colouring, before the renderer's existing
  dimming for hover, search and emphasis, so those still read. The ramp lives
  in `graphTheme.ts`.
- The Stage 2 ring on a hop paper the library already holds keeps working: the
  renderer's in-library set is now every hop paper with a library node.
- The node menu's **Add as seed** is the design's Make seed; no tooltip button
  is added.

### The gear

The Explore section (direction, locality) is deleted, with the two selects and
their persistence. Nothing else in the gear changes.

### Views (D4)

`GraphView.explore` becomes `{ direction: "cited-by" | "references"; hops: 1..6 } | null`.
Applying a view with a non-null `explore` writes the direction and the depth
through the same setters the rail uses and enables every hop up to the depth;
"(edited)" compares the field like any other. The tutorial card's chips gain
`hops 2 · references`.

- **Cornerstones** lights up: `explore: { direction: "references", hops: 2 }`,
  `availability: "ready"`. Its summary becomes "Seeds, 2 hops of references,
  colour citations. What the field rests on." The floor clause returns in
  Stage 4, when `explore` gains `floor`.
- **Who cites whom** stays greyed on shared citers.
- A view whose `requires` is unmet on a seedless graph opens the Add seed panel
  with the view queued; when the seed lands, the view is applied. This is the
  behaviour the D4 spec deferred to "that stage's spec".

The wire form keeps its schema version: `explore` was already a field, a null
becomes an object, and an older reader that ignores it still parses the view.

### State

`GRAPH_VIEW_STATE_VERSION` becomes 5. `explore` is removed and replaced by:

```ts
hops: {
  direction: "cited-by" | "references";
  depth: number; // 1..6
  enabled: boolean[]; // by hop; index 0 is always true
}
```

A version 4 record migrates: direction `"references"` → `"references"`,
`"both"` and `"cited-by"` → `"cited-by"`; depth 1; every hop enabled;
locality dropped. Versions 1 to 3 pass through the existing migrations and
then the same mapping. `emptyGraphViewState` uses Citers, depth 1, all
enabled.

Not persisted: which papers are expanded (derived from the store), the paused
flag, the failed set, the plan. The design's `loadedDepth` does not exist:
under a lazy fill "loaded" is a fact per paper, not per hop.

## What survives, moves, or goes

| Today                                               | After                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| Seed fetches references and citers, 200 each        | **Changed**: fetches the current direction only; the other on switch     |
| Gear's Explore section (direction, locality)        | **Deleted**; direction moves to the rail, locality goes                  |
| `buildGraphFocusProjection`, focus projection cache | **Deleted**, replaced by the hop model                                   |
| `GraphFocusState` ranking, `maxPerDirection`        | **Deleted**; both were fixed at "everything"                             |
| `reachedKeys` in the scope input                    | **Replaced** by hop entries                                              |
| In-library ring on a reached paper                  | **Survives** on every hop paper the library holds                        |
| Add as seed on the node menu and detail pane        | **Survives**; it is the design's Make seed                               |
| Refresh button                                      | **Survives**, also restales expanded papers                              |
| `GraphViewState.explore`                            | **Replaced** by `hops`, version 5                                        |
| D4 `explore: null` on every view                    | **Cornerstones** gets `{ references, 2 }` and becomes ready              |
| Design's presets, `loadedDepth`, hop-painted fill   | **Not built**: presets in Stage 4, the other two superseded by decisions |

## Files

- Create `src/services/graphHopModel.ts` (the walk, nodes and edges).
- Create `src/services/graphHopFillModel.ts` (the planner).
- Modify `src/services/graphScopeModel.ts` (rules 2 to 4, per-hop counts).
- Modify `src/services/graphScopeRailModel.ts` and `graphKeyRail.ts` (the
  block, the switch, the rows, the button, the progress line).
- Modify `src/services/graphViewService.ts` (the runner, the direction and
  depth setters, wiring; deletion of the Explore section and the projection
  path).
- Modify `src/services/graphViewState.ts` (version 5, migration).
- Modify `src/services/graphFocusService.ts` (delete the projection; keep
  `externalWorkToFocusNode`, `synchronizeExternalFocusNode`,
  `additiveGraphModel`).
- Delete `src/services/focusGraphCacheService.ts` if nothing else uses it.
- Modify `src/services/metricRegistry.ts` (Citation hop property),
  `graphTheme.ts` (hop opacity ramp, neutral swatch), `citationGraphRenderer.ts`
  (hop opacity), `graphViews.ts` (the `explore` shape, Cornerstones, the
  queued view), `graphViewsMenu.ts` (chip text for the queued view).
- Modify `addon/content/graph.css` (the block, the switch, the dimmed rows,
  the progress line).
- Tests as below.

## Testing

Unit (`test/unit`):

- `graphHopModel.test.ts`: a seed with two citers gives two hop-1 entries; a
  paper cited by two hop-1 papers has two parents and hop 2; a paper reachable
  at hops 1 and 3 sits at hop 1; a seed reached from another seed stays hop 0;
  the walk stops at the depth; direction `references` runs the edges the other
  way; an external work becomes an external node with its summary.
- `graphScopeModel.test.ts`: disabling hop 2 hides a hop-3 paper; unticking
  the folder of the only parent hides the child; a paper with one visible
  parent among two stays; per-hop shown and available.
- `graphHopFillModel.test.ts`: hidden papers are absent; the selected paper is
  first, the hovered second, on-screen before off-screen; the camera does not
  add or remove; expanded and failed papers are absent; papers at the depth
  are absent; per-hop remaining counts.
- `graphViewState.test.ts`: version 4 `explore` migrates to `hops` with each
  direction mapping; version 5 round-trips; an out-of-range depth clamps.
- `graphViews.test.ts`: Cornerstones is ready and carries its `explore`;
  applying a view writes direction and depth; "(edited)" notices a depth
  change; the wire form round-trips `explore`.

Zotero suite (`test/zotero`): seed a graph from a library item, wait for
Hop 1 to fill and the row to read `n/n`, find the Fetch hop 2 button, press
it, wait for the hop-2 row's count to change, untick Hop 1 and assert hop-2
nodes are gone, switch to References and assert the ladder rebuilt, save,
reopen and assert the direction and depth are back. Evidence in assertion
messages; timing-shaped cases run twice.

## Manual verification

Appended to the roadmap's batch:

- The dimmed hop rows' contrast in both themes.
- The progress line under a fast fill (a seed with a handful of citers).
- The Citation hop colouring with the Key in both themes.
- The Cornerstones view on a real seed: the direction switch reads
  References, Hop 2 opens, the tutorial card lists `hops 2 · references`.
- Panning during a fill: the plot does not grow because of the pan.

## Out of scope

The citation floor, shared citers, the presets and the Key's shared-citer
tiers (Stage 4). Per-seed direction. Cancelling an in-flight request. A
"more" control for a paper with more than 200 works in a direction. Prior and
Derivative works (the study branch). Any change to the providers' limits or
backoff.
