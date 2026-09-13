# Citation Hops: One Direction, Fetched Lazily

**Date:** 2026-09-12
**Status:** Built 2026-09-13; manual checks queued (revised 2026-09-12 after
an adversarial review of 24 findings, folded in below)

Stage 3 of `docs/superpowers/handoffs/2026-09-08-roadmap.md`, layer 2 of the
citation chain depth design
(`docs/design_handoff_citation_chain_depth/README.md`, option 6a, item 2).
Depends on Stage 2 (`2026-09-08-graph-scope-rail-design.md`) and on B6. Layer 3
(the citation floor, shared citers, the presets) is Stage 4 and is not in this
spec.

## Problem

A seed today reaches one hop: the papers it cites and the papers that cite it,
both at once, 50 each when fetched automatically and up to 200 each after a
manual Refresh. There is no way to go further without making a neighbour a
seed, no way to tell a paper two hops out from one hop out, and the gear's
Explore section (direction, locality) is the only control over what a seed
brings in. The design's answer is a ladder of hops in the rail, each fetched on
demand and each toggleable, with `{shown}/{available}` per row.

Fetching is the constraint. Hop 2 is the union of the citers of every hop-1
paper; with 50 hop-1 papers per seed and the providers' one request per second
(`2026-09-10-provider-rate-limits-design.md`), one press of a whole-hop button
runs for minutes and can bring thousands of nodes. The user's answer, taken in
the brainstorm, is a lazy fill with a priority queue rather than a batch, and
the review added a hard bound on how far one press can go.

## Decisions taken in the brainstorm (2026-09-12)

| question                                                  | decision                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hops forward, backward, or both                           | **One direction at a time**: citers of citers, or references of references, never both. To see the references of a citer, make the citer a seed.                |
| Where the direction lives                                 | **One direction for the whole graph**, a switch in the rail's Citation hops block. Not per seed.                                                                |
| What fetches automatically                                | **Hop 1 is automatic** the moment a graph has a seed, as today. Hops 2 to 6 are opened by the Fetch hop N button.                                               |
| Whole hop per press, or bounded, or lazy                  | **Lazy fill with a priority queue.** The selected paper first, then the hovered one, then papers on screen, then the rest.                                      |
| Where the fill stops                                      | **It fills only what is shown**, then idles; a change of scope or a new selection wakes it. Hidden papers are never expanded until shown.                       |
| Whether the camera gates the fill                         | **Scope gates, the camera orders.** Panning changes the order of the queue, never its contents. The plot grows only because of things the reader clicked.       |
| The presets Full, Balanced, Core                          | **Deferred to Stage 4.** Two of the three set only the floor, which does not exist yet.                                                                         |
| How a hop shows on the plot                               | **Citation hop is a categorical colouring** in the gear, like publication type; hop opacity fades under every colouring. The design's hop-painted fill is not.  |
| Architecture                                              | **One hop model replaces the focus projection.** The per-seed projection is a one-hop special case of a breadth-first walk.                                     |
| The study branch `worktree-connectedpapers-feature-study` | Its order (Prior/Derivative works first) is noted and not adopted; its own verdict says Derivative works needs the citer lists hop fetching builds. Not merged. |

Smaller calls made by the spec: the default direction is Citers; a paper
reached at several depths sits at its shallowest hop and keeps every parent;
six hops maximum; each expansion stores up to 50 works per paper, the
automatic limit a seed has today.

## Decisions taken in the review (2026-09-12)

Five findings needed a call the brainstorm had not made. Taken on the review's
recommendation; the section "Review 2026-09-12" at the end lists every other
change.

| question                                               | decision                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do hop rules ever hide a folder-admitted library paper | **No.** The hop rules gate only papers the folder ticks do not admit. A seed still only ever adds; unticking a hop never removes a paper you filed and ticked.                                                                                                              |
| How far one press can go                               | **A cap of 500 expansions per hop per session.** Past it the progress line reads `500 expanded · {n} waiting` with a Fetch more link that raises the cap by 500. The isolated-node count becomes linear; the per-paper fragment cache stays, keyed by the store's revision. |
| What the Refresh button refreshes                      | **Seeds only, as today.** An expanded paper is refreshed one at a time from the detail pane's Citers or References list, the manual path that already exists. Nothing is marked stale in bulk.                                                                              |
| What a saved `both` graph becomes                      | **Citers**, with a one-time toolbar status, "Directions are now one at a time; showing Citers", through the `setStatus` path B42's read-only notice uses.                                                                                                                   |
| How many providers an expansion asks                   | **One.** Hop papers refresh with `providerStrategy: "native-first"` and `providerLimit: 1`, the provider that holds the paper's own identifier first; the seed's aggregate strategy is not used past hop 0. The cap above bounds the day's budget.                          |

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
  fetched and stored: a stored relationship summary with a `fetchedAt` exists
  for it in this direction (`getStoredRelationshipSummary`). A stored empty
  list counts; the works count does not decide it. Derived from the
  relationship store, never persisted.
- **Failed**: a paper whose expansion this session resolved nothing: the
  resolution came back `complete: false` with no identified works, or the
  refresh returned without storing (discovery stopped, no usable identifier,
  no provider produced a snapshot, the signal cancelled). Failed papers leave
  the plan for the session and come back after a reopen.
- **Parents**: the papers one hop shallower that link to a paper. A hop paper
  keeps all of them, so chains, downstream hiding and, in Stage 4, shared-citer
  counts read the whole picture.

### The hop model

A new pure module, `src/services/graphHopModel.ts`, DOM-free and Zotero-free.

Input: the seed nodes, the direction, the depth, and a lookup from a paper key
to the works its stored list in that direction names (each with its key and
summary metadata, the shape the seed refresh publishes today) together with
whether that list is stored at all. Output, per paper reached:

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
stored lists only; it never fetches. It reads each paper's list through the
fragment cache in `focusGraphCacheService.ts`, whose entry becomes one list
for one paper in one direction (today an entry holds a seed's references and
citers together; the shape splits, not just the key). An entry is dropped by
that paper's own `membership-published` and `metadata-published`; today only
`metadata-published` drops one, so the publication handler gains the
membership case. A rebuild after one landing then re-reads one list, not
every expanded list.

The model still computes the seed-relative **citation sequence**, the default
X axis of a seeded graph: it calls `assignFocusCitationSequence` on its nodes
and edges with the primary seed, exactly where the projection called it, and
stamps `focusRole` on the nodes it clones, `"seed"` for a seed and
`"reference"` or `"cited-by"` by the graph's direction, which is the fallback
that service reads for a paper not directly linked to the primary seed. The
role `"both"` can no longer occur and `mergeRole` goes with the projection.

**How `hop` reaches the plot.** `additiveGraphModel` keeps the library's own
node object and drops the hop model's copy, so a value stamped on the model's
node never reaches a library paper (today's `focusRole` is lost the same way).
The hop entries are therefore the source of truth: `graphViewService` derives a
`hopByKey: ReadonlyMap<string, number>` from them and hands it to the renderer
through a setter of the `setSeedColors` kind, re-applied after every rebuild
of the walk and every `replaceLibraryGraph`, which swaps every library node
object on each snapshot invalidation. `assignCategories` and `nodeCategory`
take a resolver for the Citation hop metric rather than reading a node field,
and the Key, the tooltip and the ghost preview read the same map. The model
still stamps `hop` on the external nodes it creates, for the fixtures and the
tests, but nothing on the plot depends on the stamp.

`buildGraphFocusProjection`, `GraphFocusState`'s direction, locality, ranking
and `maxPerDirection`, and `reachedBySeed` are deleted. `additiveGraphModel`
survives with the hop model's nodes and edges as its second argument: the
library's own node still wins. `applySeedProjection`'s isolated-node count,
today a filter over the nodes with a search over the edges per node, becomes
one pass that collects every edge endpoint into a set and counts the nodes
outside it.

### Visibility, in order

`computeGraphScope` keeps its order: a seed is always visible; every other
paper is admitted by one of two rules that sit beside each other; the later
rules then remove. The seed-reach rule becomes the hop rule. The algorithm
does change: today's single pass over a static reached set becomes a pass in
hop order, because the hop rule reads a parent's final visibility.

1. A seed is visible, always.
2. **Admitted by folder ticks** (library papers), unchanged from Stage 2.
3. **Admitted by hop**, beside rule 2: the paper has a hop entry, its hop is at
   most the depth, its hop is enabled, and at least one parent is visible.
4. External papers only while Not in Zotero is ticked; hidden keys; the Filter
   popover's facets, unchanged.

Rules 2 and 3 are an OR, exactly as seed reach and folder ticks are today. The
consequences, in the order they matter:

- A seed still only ever adds. A library paper in a ticked folder is on the
  plot whatever its hop, and unticking a hop never removes it. The hop
  toggles reach only papers the folders do not admit: external papers, and
  library papers filed nowhere you have ticked.
- Disabling hop 2 hides every hop-3 to hop-6 paper that is not
  folder-admitted, because their only parents are hidden. A folder-admitted
  hop-3 paper stays, and so does a hop-4 child of it that has it as a visible
  parent: the chain runs through a paper you filed.
- Unticking the folder that holds the only parent of a hop-3 paper hides
  that paper: the chain to it is gone.
- A library paper no hop reaches has no hop entry: rule 3 does not apply to
  it and it is admitted or not by the folder rule alone, exactly as today.

The function walks papers in hop order so a parent's visibility is settled
before its children are read. Its result gains, per hop, `shown` (survived
every rule) and `available` (reached by the walk at that hop), which the rail
prints.

### The fill

Two parts: a pure planner and a runner.

**Planner**, `src/services/graphHopFillModel.ts`. Input: the hop entries, the
scope result's visible keys, the selected key, the hovered key, the keys inside
the camera, the depth, the keys that failed this session, the per-hop count of
expansions made this session, the per-hop cap, and a lookup from a key to the
paper's reported count in the direction (`citationCount` under Citers,
`referenceCount` under References, null when unknown). Output: the ordered
list of papers to expand, per hop the number still to expand, and per hop the
number held back by the cap.

A paper is in the list when its hop is below the depth, it is visible, it is
not expanded, it has not failed this session, and its hop's cap is not
reached. Seeds are in the list like any other paper: hop 0 is below every
depth, so a new seed and a seed whose list in the new direction is not stored
are expanded by the runner and by nothing else. Order: seeds, then the
selected paper, then the hovered paper, then papers inside the camera, then
the rest; ties by the parent's reported count in the direction descending
(the child's own count is mostly unknown at plan time, since membership
fetches hydrate no metadata), then key. Hidden papers are absent: that is the
gate. The camera never changes membership, only order.

**The cap.** 500 expansions per hop per session, counted by the runner as
results land. When a hop's cap is reached and papers at that hop still
qualify, the progress line for that hop reads `500 expanded · {n} waiting`
with a **Fetch more** link that raises that hop's cap by 500. The cap is not
persisted. With 50 works per expansion this bounds one press of Fetch hop N to
25,000 new nodes in the worst case and, with one provider per expansion, to
500 list requests plus hydration.

**Runner**, in `graphViewService.ts`. It recomputes the plan whenever scope,
selection, hover, camera, depth or direction changes, or a result lands, and
keeps one request in flight. It has its own serial queue, its own epoch and
its own in-flight counter, none shared with the seed Refresh path: the
toolbar's Refresh button reads the seed counter alone and stays enabled
during a fill; a seed change bumps the seed epoch alone, so the runner's
callbacks survive it; the runner's epoch bumps on a direction switch and on
graph close.

An expansion is `refreshExternalRelationships` for that paper in the current
direction, automatic mode, `maximum` 50 (`AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT`,
one OpenAlex page), `providerStrategy: "native-first"`, `providerLimit: 1`,
`silent: true`, no background progress window, membership first, summaries
hydrated cooperatively. Results land in the relationship store, survive a
direction switch and a reopen, and are the same records the manual paths
write. When a result lands the runner marks the paper expanded or failed by
the definitions above, rebuilds the hop model, recomputes the scope and
re-sorts the plan. A request already in flight for a paper that has left the
plan finishes and stores; it is not cancelled. A thrown provider error is
logged, marks the paper failed for the session, and the runner moves on.

**Publications during a fill.** Each landing publishes `membership-published`
for the expanded paper, which today refreshes every item-tree column and
invalidates the library graph snapshot. Runner-originated publications carry
a `source: "hop-fill"` mark; for those, the column refresh and the snapshot
invalidation are coalesced to at most one every ten seconds while the runner
has work and one more when its plan empties. The walk rebuild is not
coalesced: it re-reads one fragment and runs on every landing.

A `membership-published` for any paper with a hop entry rebuilds the walk,
whether or not the paper is a seed, in every open tab of the same library. On
an inactive tab the rebuild defers until the tab returns, as the seed rebuild
does today; `reconcileInactiveView` marks the walk dirty instead of re-reading
the seeds' lists. A `metadata-published` for a hop paper updates its node as
it updates a seed's neighbour today.

**Inactive tab.** The runner starts no new request while its tab is
inactive; the request in flight finishes and stores; the plan resumes on
return. This is the runner's own rule, not inherited: the seed refresh keeps
fetching on an inactive tab and defers only the rebuild.

**Controls.** Fetch hop N sets the depth to N and enables hop N; the runner
starts because hop N−1's shown papers are now below the depth. Stop, on the
progress line, sets a session-only paused flag; the line then reads Resume.
Fetch hop N+1 and Fetch more clear the flag. Hop 1 opens the moment a graph
gains its first seed, so a new seed fills the plot as it does today; the
runner is the one automatic fetcher from hop 0 onward. The seed's own refresh
path (`refreshFocusSeedConnections`) survives as the manual path behind the
toolbar's Refresh button only, in the current direction, with today's manual
limits (200 works, aggregate strategy, progress window).

**Direction switch.** Switching keeps the seeds, the depth and the toggles,
bumps the runner's epoch, rebuilds the walk from the stored lists in the new
direction, and the runner fills whatever is shown and not yet expanded that
way, seeds first. Nothing fetched in the old direction is discarded;
switching back finds it. The per-hop expansion counts and caps are per
direction.

**Refresh** (the toolbar button) forces the seeds' lists in the current
direction as today, through the manual path. It touches no expanded paper. A
manual refresh of a seed replaces its stored list, so a seed whose citers
have changed may lose a hop-1 paper and that paper's subtree; this is the
store's existing replacement semantics and is accepted. One expanded paper is
refreshed from the detail pane's Citers or References list, the manual
per-paper refresh that exists today, with its limits.

### The rail

The Scope section gains a **Citation hops** block under Collections, in
`graphKeyRail.ts` with its rows from `graphScopeRailModel.ts`.

- A two-cell segmented switch, **Citers** | **References**, above the rows.
  Same family as the presets' segmented control in the design (11px, radius
  5, active cell on the hairline fill).
- Rows **Seeds**, **Hop 1** … **Hop 6**: a 13px swatch, the label, the count
  in tabular figures, a checkbox on every row but Seeds. The count is
  `{shown}/{available}` for a hop at or below the depth, and **not fetched**
  past it. `available` is what the walk reached from the stored lists, which
  are capped at 50 per automatic expansion and 200 per manual one. When the
  expanded parents of a hop report more in the direction than is stored (the
  `reportedCount` a membership resolution returns, kept per paper and
  direction for the session), a muted `of {reported}` follows the count, so
  `50/50 of 1,200` never reads as complete. Rows past the depth or unticked
  draw at 0.45 opacity.
- The first row past the depth carries the **Fetch hop N** button in place of
  its count. It is absent when the depth is 6. The design's `≈ {estimate}`
  on the button is dropped: under a lazy fill there is no whole-hop number to
  estimate before the parents are expanded.
- While the runner has work in the current plan, the deepest open hop's row
  is followed by a progress line: `expanding · {n} left` with a **Stop** link,
  which reads **Resume** while paused; at the cap, `500 expanded · {n}
waiting` with a **Fetch more** link. The line disappears when the plan is
  empty and nothing waits. The design's percentage progress bar is dropped
  with the estimate, for the same reason.
- The swatch is the hop's category colour only while the colour binding is
  Citation hop; otherwise a neutral dot from the theme, so the rail never
  suggests a colour the plot is not using.
- A hop's checkbox toggles `enabled[hop]`. Ticking a hop past the depth does
  nothing: the row is inert there. This departs from the design's README,
  where a hop row click raises the depth; the Fetch hop N button is the one
  way to open a hop, so a fetch is never a side effect of a tick.

### The plot

- **Citation hop** is a categorical colouring, `citation-hop` in the
  `GraphNodeColorMetric` union, wired the way Open Access and Retracted are,
  by hand, at each of their touch points: the union in `graphTypes.ts`; the
  gear's colour list in `graphViewControls.ts` (group Explore, available while
  the graph has a seed); `colourOptionHasData`; `nodeCategory` and
  `assignCategories`, through the hop resolver; `CATEGORICAL_COLOR_LABELS`;
  the ghost preview in `graphRendererScene.ts`; the view decoder's
  `COLOUR_METRICS`, or a saved view with this colouring fails to decode; and
  the tooltip's metric switch. Categories `Seed`, `Hop 1` … `Hop 6`, drawn
  through the category swatch ledger like publication type, explained by the
  Key's category section. It is not a supplementary property in
  `metricRegistry.ts`, so it is not a column and puts no row in the item pane,
  and it is not a Filter facet.
- Hop opacity: the design's ramp `[1, .9, .8, .7, .6, .5, .4]` by hop, applied
  to fill and label under every colouring, before the renderer's existing
  dimming for hover, search and emphasis, so those still read. The ramp lives
  in `graphTheme.ts`. `drawNode` already multiplies `globalAlpha` by the
  emphasis factor and the hop factor multiplies in beside it; labels today
  carry only a ghosted alpha, so the scene gains a per-node label alpha that
  the hop factor and the emphasis both feed. An edge takes the citer's
  opacity (its source node under the citer → cited convention), not the
  minimum of its ends. A hop-6 node under emphasis dimming lands near 0.05
  alpha; whether that still reads is a manual check.
- The Stage 2 ring on a hop paper the library already holds keeps working:
  the renderer's in-library set is now every hop paper with a library node.
- The node menu's **Add as seed** is the design's Make seed; no tooltip button
  is added.

### The gear

The Explore section (direction, locality) is deleted, with the two selects and
their persistence. The colour list gains Citation hop. Nothing else in the
gear changes.

### Views (D4)

`GraphView.explore` becomes `{ direction: "cited-by" | "references"; hops: 1..6 } | null`.
Applying a view with a non-null `explore` writes the direction and the depth
through the same setters the rail uses and enables every hop up to the depth.
`GraphViewLiveInput` gains `hops: { direction, depth, enabled }`; "(edited)"
is true when the live direction or depth differs from the view's, or when any
hop up to the view's depth is disabled, since the view's claim is about what
is on the plot. The tutorial card's chips gain `hops 2 · references`.

Applying a view with an `explore` causes provider traffic: the runner fills
the opened hops for what is shown, under the cap. The view's card says so in
its footnote.

A user-saved view captures `explore` from the live direction and depth, and
`enabled[]` does not travel on a view. The save panel's "Explore (hops, floor,
shared citers) — not yet available" line goes; the panel lists the direction
and depth it will save, as it lists the layout.

- **Cornerstones** lights up: `explore: { direction: "references", hops: 2 }`,
  `availability: "ready"`. Its summary becomes "Seeds, 2 hops of references,
  colour citations. What the field rests on." The floor clause returns in
  Stage 4, when `explore` gains `floor`.
- **Who cites whom** stays greyed on shared citers. The D4 spec asked this
  stage to fill its `explore` too; it is left as it is because its `requires`
  is two seeds and its meaning is the shared-citer tiers, which are Stage 4.
- The `GraphViewNeeds` value `"citation-hops"` and its "Arrives with citation
  hops" line have no user left once Cornerstones is ready; both are deleted.
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

Every saved graph today defaults to `both`, so nearly every reopen after the
upgrade drops the references on the plot. The migration reports that it
mapped a `both`, and the graph shows a one-time toolbar status, "Directions
are now one at a time; showing Citers", through the `setStatus` path B42's
read-only notice uses. Once the state is saved again as version 5 the notice
does not recur.

Not persisted: which papers are expanded (derived from the store), the paused
flag, the failed set, the plan, the per-hop expansion counts and caps, the
reported counts. The design's `loadedDepth` does not exist: under a lazy fill
"loaded" is a fact per paper, not per hop.

**Store keys.** A hop node's `key` is `focus:<lookupIdentity>` of the parent's
stored work and never changes; the relationship store is keyed by `itemKey`,
which `synchronizeExternalFocusNode` promotes from `focus:candidate:` to a
stable identity once metadata identifies the work. A list stored under
the promoted key must be found by a walk that rebuilds the node from the
parent's unhydrated work; the hop model's lookup resolves a key through the
same promotion before reading the store, and a unit case proves a list stored
under the promoted key is found from the candidate key.

## What survives, moves, or goes

| Today                                                | After                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Seed fetches references and citers, 50 each          | **Changed**: the runner fetches the current direction only; the other on switch  |
| Gear's Explore section (direction, locality)         | **Deleted**; direction moves to the rail, locality goes                          |
| `buildGraphFocusProjection`                          | **Deleted**, replaced by the hop model                                           |
| Focus projection cache (`focusGraphCacheService.ts`) | **Survives** as the per-paper, per-direction fragment cache, re-keyed            |
| `GraphFocusState` ranking, `maxPerDirection`         | **Deleted**; both were fixed at "everything"                                     |
| `reachedKeys` in the scope input                     | **Replaced** by hop entries                                                      |
| `refreshFocusSeedConnections`                        | **Survives** as the manual Refresh path only; automatic fetching is the runner's |
| In-library ring on a reached paper                   | **Survives** on every hop paper the library holds                                |
| Add as seed on the node menu and detail pane         | **Survives**; it is the design's Make seed                                       |
| Refresh button                                       | **Survives**, seeds only, current direction                                      |
| Detail pane's per-paper list refresh                 | **Survives**; it is how one expanded paper is refreshed                          |
| `GraphViewState.explore`                             | **Replaced** by `hops`, version 5                                                |
| D4 `explore: null` on every view                     | **Cornerstones** gets `{ references, 2 }` and becomes ready                      |
| Design's presets, `loadedDepth`, hop-painted fill    | **Not built**: presets in Stage 4, the other two superseded by decisions         |
| Design's `≈ {estimate}` and progress bar             | **Not built**: no whole-hop number exists under a lazy fill                      |
| Design's hop row click raising the depth             | **Not built**: only Fetch hop N opens a hop                                      |

## Files

- Create `src/services/graphHopModel.ts` (the walk, nodes and edges).
- Create `src/services/graphHopFillModel.ts` (the planner, the cap).
- Modify `src/services/graphScopeModel.ts` (the hop rule beside the folder
  rule, per-hop counts).
- Modify `src/services/graphScopeRailModel.ts` and `graphKeyRail.ts` (the
  block, the switch, the rows, the button, the progress line, Fetch more).
- Modify `src/services/graphViewService.ts` (the runner with its own queue,
  epoch and counter; the direction and depth setters; `hopByKey` to the
  renderer; the linear isolated count; the migration notice; deletion of the
  Explore section and the projection path; the seed path narrowed to manual).
- Modify `src/services/graphViewState.ts` (version 5, migration, the `both`
  report).
- Modify `src/services/graphFocusService.ts` (delete the projection, the
  ranking and `mergeRole`; keep `externalWorkToFocusNode`,
  `synchronizeExternalFocusNode`, `additiveGraphModel`; export the
  local-matching helpers the hop lookup needs).
- Modify `src/services/focusGraphCacheService.ts` (one list per paper and
  direction; drop the projection cache).
- Modify `src/services/relationshipRefreshPolicy.ts`:
  `relationshipProviderPolicyForSize` honours an explicit strategy and limit
  instead of discarding them. This reverses a documented rule ("size must not
  silently reduce the provider set") on purpose and narrowly: size still
  never reduces it; a caller may, and only the hop runner does. The
  architecture test that asserts overrides are discarded is rewritten to
  assert they are honoured.
- Modify `src/services/relationshipEvents.ts` and
  `src/services/itemTreeColumnService.ts` or wherever the coalescing lands
  (the `source: "hop-fill"` mark and the ten-second batching).
- Modify `src/domain/graphTypes.ts`, `graphViewControls.ts`,
  `graphLayoutAvailability.ts`, `graphCategoryAssignment.ts`,
  `graphKeyModel.ts`, `graphRendererScene.ts`, `graphViews.ts`
  (`COLOUR_METRICS`, the `explore` shape, Cornerstones, `GraphViewLiveInput`,
  the queued view), `dataSourceTooltipService.ts` (the Citation hop
  colouring), `graphTheme.ts` (hop opacity ramp, neutral swatch),
  `citationGraphRenderer.ts` (`setHops`, hop opacity, edge alpha from the
  citer, label alpha), `graphViewsMenu.ts` (chip text, the save panel's
  explore line).
- Modify `addon/content/graph.css` (the block, the switch, the dimmed rows,
  the progress line).
- Tests as below.

## Testing

Unit (`test/unit`):

- `graphHopModel.test.ts`: a seed with two citers gives two hop-1 entries; a
  paper cited by two hop-1 papers has two parents and hop 2; a paper reachable
  at hops 1 and 3 sits at hop 1; a seed reached from another seed stays hop 0;
  the walk stops at the depth; direction `references` runs the edges the other
  way; an external work becomes an external node with its summary; a paper
  with a stored empty list is expanded; a list stored under a promoted
  `focus:` key is found from the candidate key.
- `graphScopeModel.test.ts`: disabling hop 2 hides a hop-3 external paper;
  disabling hop 2 keeps a hop-3 library paper in a ticked folder and its
  hop-4 child (a seed still only adds); unticking the folder of the only
  parent hides the child; a paper with one visible parent among two stays;
  per-hop shown and available; the Stage 2 cases still pass with hop entries
  in place of reached keys.
- `graphHopFillModel.test.ts`: hidden papers are absent; seeds first, the
  selected paper next, the hovered next, on-screen before off-screen; the
  camera does not add or remove; expanded and failed papers are absent;
  papers at the depth are absent; ties by the parent's reported count; a hop
  at its cap contributes nothing and reports what waits; raising the cap
  readmits them; per-hop remaining counts.
- `graphViewState.test.ts`: version 4 `explore` migrates to `hops` with each
  direction mapping and reports a `both`; the v4 fixtures move to v5; version
  5 round-trips; an out-of-range depth clamps.
- `graphViews.test.ts`: Cornerstones is ready and carries its `explore`;
  applying a view writes direction and depth; "(edited)" notices a depth
  change, a direction change and a disabled hop within the depth; a saved
  view captures the live direction and depth; the wire form round-trips
  `explore`; `citation-hop` decodes as a colouring.
- `graphScopeRailModel.test.ts`: the block's rows, counts, `of {reported}`,
  the button's position, the progress line's three states.
- `graphFocusService.test.ts`: the projection cases go; `additiveGraphModel`
  and the promotion cases stay.
- `graphHopModel.test.ts` also proves the seed-relative citation sequence: the
  primary seed at 0, a hop-1 citer positive, a hop-1 reference negative.
- `focusGraphCacheService.test.ts` (new): one entry per paper and direction;
  invalidating a paper drops both directions.
- `architecture.test.ts`: the provider-policy case flips to "an explicit
  override is honoured".
- A runner case at the service level, DOM-stubbed as the seed refresh cases
  are: a paper whose refresh resolves nothing is marked failed and not
  re-planned; a landing on the runner's queue does not touch the Refresh
  button's state; a seed change does not drop a runner callback.

Zotero suite (`test/zotero`): seed a graph from a library item, wait for
Hop 1 to fill and the row to read `n/n`, find the Fetch hop 2 button, press
it, wait for the hop-2 row's count to change, untick Hop 1 and assert the
external hop-2 nodes are gone, switch to References and assert the ladder
rebuilt, save, reopen and assert the direction and depth are back; open a
version 4 record with `both` and assert the toolbar status. Evidence in
assertion messages; timing-shaped cases run twice.

## Manual verification

Appended to the roadmap's batch:

- The dimmed hop rows' contrast in both themes.
- The progress line under a fast fill (a seed with a handful of citers), and
  the Fetch more state on a seed with hundreds.
- The Citation hop colouring with the Key in both themes.
- A hop-5 or hop-6 node under emphasis dimming still reads in both themes.
- The Cornerstones view on a real seed: the direction switch reads
  References, Hop 2 opens, the tutorial card lists `hops 2 · references`.
- Panning during a fill: the plot does not grow because of the pan.
- The item tree stays responsive during a fill (column refreshes coalesced).
- The migration notice on a graph saved before the upgrade.

## Out of scope

The citation floor, shared citers, the presets and the Key's shared-citer
tiers (Stage 4). Per-seed direction. Cancelling an in-flight request. A
"more" control for a paper with more than 50 works in a direction beyond the
detail pane's manual refresh. Prior and Derivative works (the study branch).
Any change to the providers' limits or backoff (the provider policy change
above narrows which providers one expansion asks; it touches no limit).

## Review 2026-09-12

A fresh-context adversarial review of the brainstorm's spec against the code
found 24 items; the five that needed a decision are in the table above. The
rest changed the spec as follows.

- **Numbers.** The seed's automatic limit is 50, not 200; 200 is the read cap
  and the manual limit. Expansions take 50, one OpenAlex page. Every "200" in
  the reasoning was corrected.
- **Termination.** "Expanded" is a stored summary with `fetchedAt`, not a
  works count, so an empty list terminates; a refresh that resolves nothing
  marks the paper failed for the session. Both are unit cases.
- **`hop` on the node.** `additiveGraphModel` drops the model's copy of a
  library node, so the renderer takes a `hopByKey` map and the category
  assignment a resolver, re-applied after every `replaceLibraryGraph`.
- **Colouring.** A supplementary property does not make a colouring; the
  seven hand-wired touch points are listed. `filter: true` and the item-pane
  row are gone with the registry entry.
- **Runner isolation.** Its own queue, epoch and counter; silent, no progress
  window; runner-originated column refreshes and snapshot invalidations
  coalesced to one per ten seconds.
- **Publications.** Any paper with a hop entry rebuilds the walk, in every
  tab; the inactive path marks the walk dirty. The runner's pause on an
  inactive tab is its own rule, not the seed refresh's.
- **One fetcher.** The runner expands seeds too; the seed refresh path is the
  manual Refresh button only.
- **Views.** A saved view captures direction and depth; `enabled[]` feeds
  "(edited)" but does not travel; applying a view causes traffic; Who cites
  whom stays greyed, a stated departure from the D4 follow-up.
- **Renderer.** Labels gain an alpha channel; edges take the citer's opacity;
  the deep-hop contrast check joins the manual batch.
- **Rail wording.** The inert tick past the depth departs from the design;
  the estimate and the progress bar are dropped knowingly; `available` is the
  stored count with `of {reported}` beside it; ties by the parent's reported
  count.
- **Tests.** The deleted projection's tests, the v4 fixtures, the rail model's
  tests and the `focus:candidate:` promotion case are on the list.
- **Cache.** `focusGraphCacheService.ts` was already used by the publication
  handler, so it survives re-keyed rather than deleted.

### Second pass, same day

A second fresh-context review of the folded spec found eight items, none of
which overturned a decision.

- **Citation sequence.** `assignFocusCitationSequence` had one caller, the
  deleted projection, and it feeds the default X axis of a seeded graph. The
  hop model calls it and stamps `focusRole` by direction; `"both"` and
  `mergeRole` go.
- **Provider policy.** `relationshipProviderPolicyForSize` discards the
  overrides it is handed, by design and by test, so "one provider per
  expansion" needs that function changed and the test flipped; stated as a
  deliberate, narrow reversal.
- **Fragment cache.** The entry shape splits per direction, and the handler
  gains membership-published invalidation, which today only metadata has.
- **Wording.** The scope function keeps its order, not its algorithm; the
  promoted key is `itemKey`, not `key`; the dead `"citation-hops"` needs value
  is deleted.
