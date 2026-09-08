# The Scope Rail: an Additive Graph

**Date:** 2026-09-08
**Status:** Approved 2026-09-08, not implemented

Layer 1 of the citation chain depth design
(`docs/design_handoff_citation_chain_depth/README.md`, option 6a). Layer 2
(citation hops) and layer 3 (citation floor, shared citers) are stages 3 and
4 of `docs/superpowers/handoffs/2026-09-08-roadmap.md` and are not in this
spec. Resolves backlog entries D1 and D2, and decides B4's wording.

## Problem

A seed replaces the graph. `enterFocusSeeds` swaps `model.nodes` and
`model.edges` for a projection of the seeds and their neighbours, stashes the
collection filter and clears it, and `exitFocus` puts all of it back. So
adding one paper as a seed to a folder graph makes every unconnected paper in
that folder vanish, and "Show in" on a seeded graph drops the seeds to make
room for a new item scope. That is D1, in the user's words:

> When I create a graph from a folder, then in that graph I add one of the
> nodes as seed, all the rest that is not connected to the seed disappears. I
> would like to still see the other papers, and delete nodes I don't need.

The projection also forces two mechanisms that do the same job. A graph can be
scoped by `mapScopeItemIDs`, a set of item ids that "Show in" writes, and by
`filters.collectionIDs`, a list of folders. Focus ignores the first and
suspends the second. Three ways to say which papers are on screen, none of
them visible in the interface.

Meanwhile the controls that steer all this are scattered. Seeds are behind a
toolbar button, folders are inside the Filter popover, direction and scope are
behind the rail's gear, and the rail itself only explains colours.

## Design

There is one model at all times: the library graph, plus the external papers a
seed brought in. Nothing is swapped out. Whether a paper is drawn is decided
per paper by a pure function, and the controls that feed that function are
gathered into a Scope section at the top of the left rail.

### Visibility, in order

`src/services/graphScopeModel.ts` is new, DOM-free, and unit-tested. It takes
the graph's papers, the seed set, the reach of each seed, the ticks and the
hidden keys, and returns the visible set plus the counts the rail prints.

A seed is visible, always, and no later rule can hide one. Every other paper
is admitted by one rule and can then be removed by any of the rest.

Admitted when either holds:

1. Some seed reached it, whatever folder it is filed in.
2. It is a library paper and one of its folders is ticked, or it is filed in
   no folder and Unfiled is ticked.

Then removed when any of these holds:

3. It is not in Zotero and Not in Zotero is unticked.
4. Its key is in `hiddenKeys`.
5. The Filter popover's remaining facets reject it: tags, item type, year, or
   the data-quality switches.

The search box then narrows what is left, as it does today, without changing
any count the rail prints.

Rules 3 to 5 apply to a paper a seed reached, and folder ticks do not. That
looks inconsistent and is not. A folder is a fact about how you filed a paper,
so it says nothing about a paper you have never filed, and letting it hide a
citer would mean a fetched result vanishing for a reason that belongs to a
different paper. A year, an item type, a retraction and being outside Zotero
are facts about the paper itself, so they are true of a citer exactly as they
are of anything else. Setting the year range to 2020 onward and then seeing a
2015 citer would make the range a lie.

So a year filter does hide a seed's citers from outside the range, and the
tests assert it. Only a seed itself is beyond every rule.

Rule 1 sitting beside rule 2 rather than under it is the whole design. Adding a seed only
ever adds papers, and unticking a folder never removes a paper a seed brought
in. A citer you just fetched cannot disappear because of where it happens to
be filed.

The old focus view survives as a position rather than a mode: untick every
folder on a seeded graph and the seeds and their neighbours are all that is
left; tick them again and the rest returns. Nothing is stashed, so nothing has
to be restored.

Stages 3 and 4 insert the hop toggles, the citation floor and the shared-citer
filter into this same order, which is why it is a pure function with tests
rather than a sequence of early returns inside `applyFilters`.

### Seed reach

Rule 1 needs to know which papers a seed reached. In this stage that is what
`buildGraphFocusProjection` already computes: the references and citing papers
of each seed, in the direction the gear's Explore section names.

The projection is no longer the model. It becomes a lookup:
`reachedBySeed: Map<seedKey, Set<paperKey>>`, plus the external papers it
built, which are merged into the model as nodes rather than replacing it.
`GraphFocusProjection.nodes` and `.edges` stop being the graph and start being
the addition to it.

Direction and scope stay behind the gear for this stage, hidden while the
graph is seedless, exactly as `2026-09-07-durable-graphs-design.md` left them.
Stage 3 replaces both with the hop ladder, which is forward-only, and deletes
them. They are kept here so that nothing a reader can do today stops working
in the stage that only reorganises the interface.

### Items become seeds

`mapScopeItemIDs`, `mapPinnedItemIDs`, `replaceItemScope`, `extendItemScope`,
`applyMapItems`, `replaceMapItems`, `addMapItems`, `revealItems` and
`revealItem` are removed. A graph opened from selected papers seeds itself
with them; a graph told to show papers adds them as seeds. There is no longer
a way to put a paper in a graph without it being a seed, and therefore no
second, invisible scope rule.

`graphScopePolicy.ts` loses `replaceItemScope`, `extendItemScope` and
`appendUniqueScopeKeys`. `normalizedScopeItemIDs` stays; the openers still
normalise the ids they are handed.

### Removing a paper

D1 asks to delete nodes you do not need, and folders are too coarse for that.
The node context menu gains **Remove from graph**, which adds the paper's key
to `hiddenKeys`. A seed cannot be hidden; on a seed the entry is absent, since
the Seeds row's × is how a seed leaves. While anything is hidden the rail's
Scope section shows a line reading `{n} hidden · Show all`, whose link clears
the set. `hiddenKeys` travels with the saved graph.

Adding a paper as a seed deletes its key from `hiddenKeys`. Precedence alone
would draw it, since no rule can hide a seed, but the key would sit there
waiting: remove the seed later and the paper would vanish again, for a reason
taken weeks ago and shown nowhere. Seeding a paper is an instruction to look
at it, so the earlier instruction to hide it is spent. The same applies to a
paper restored by Show all, which empties the set outright.

### The rail

`graphKeyRail.ts` renders a Scope section above Key. Key is unchanged in this
stage: it still emphasises and never filters, and the shared-citer tiers it
gains are stage 4.

Scope is not the Key, and must not be built out of `KeySection`. A Key entry
emphasises on hover and carries no state; a Scope row owns a checkbox that
changes what is drawn. Conflating them would put a filtering control inside
the module whose header comment says it never filters. Scope therefore gets
its own model file, `graphScopeRailModel.ts`, pure and tested, returning the
rows the rail draws; `graphKeyRail.ts` renders both sections and owns the
column.

**One emphasis channel, one owner.** Scope adds a second source of hover to a
rail that had only the Key's, and two sources writing the same plot state is
how highlights get stranded when the pointer crosses quickly from a Seeds row
to a Key entry. The rail keeps a single current emphasis, whatever raised it,
so raising one clears the last. `onEmphasise` keeps its shape and gains the
seed and folder cases, rather than the Scope section growing a channel beside
it. The Key's existing pin still wins over hover, and a Scope row cannot be
pinned: a checkbox is already how a Scope row makes something stick.

**Count line.** `{shown} of {total} papers`. `total` is every paper the graph
holds, library and external together. `shown` is what survives every rule
above, before the search box, so typing in search does not make the line move.

**Seeds.** A header reading `Seeds · {n}` with an `+ Add seed` link at the
right. One row per seed: a bullseye swatch in that seed's colour, the label
`Author (year)` ellipsised, and a `×` at the right. Hovering a row emphasises
that seed and the edges into it on the plot, through the same channel the Key
uses. Seeds are ordered as they were added; the first is still the primary.

**Collections.** A checkbox tree of the library's folders, indented by depth
with `indentedCollectionLabel`, each row carrying a folder glyph, the name, a
count of that folder's papers currently in the graph, and a checkbox. A graph
opened on the library has every folder ticked; a graph opened on folders has
only those ticked. Two rows close the tree:

- **Unfiled**, covering library papers in no folder.
- **Not in Zotero**, covering papers that are not in the library.

Every paper on the plot is therefore accounted for by exactly one tick the
reader can find, which is what makes unticking read as subtraction.

**Subfolders cascade.** A tick means one folder's own papers, and a folder's
count is its own papers, but toggling a parent writes the same tick to every
descendant. Ticking "PhD" ticks everything under it; unticking it unticks them
all. Each child keeps its own checkbox, so a subfolder can then be unticked on
its own, and a parent whose descendants disagree draws in the mixed state.

This is not a free choice. `collectionScopeIDs` expands every selected folder
through `descendants()` today, unconditionally, so a graph scoped to a parent
folder already draws that whole subtree. A tree where a parent left its
children alone would quietly shrink every saved folder graph the first time it
was opened, and the reader would have no way to see why.

**Hidden line.** `{n} hidden · Show all`, present only while `hiddenKeys` is
non-empty.

Presets (Full, Balanced, Core) are not in this stage. They set the citation
floor and the hop depth, and neither exists yet, so they would be three chips
that move nothing. They arrive in stage 3 with the hops.

### The plot

One change. A paper a seed reached that is already in the library is drawn
with a thin ring in a brighter tint of its own fill colour, so a result you
already own is told from one you do not at a glance. Seeds keep their
bullseye, which is a wider ring with a gap and reads as a different mark.

Unfilled outlines are deliberately not used: stage 4 reserves them for papers
below the citation floor, and two outline meanings on one plot cannot be told
apart.

Per-seed colours are new. Each seed takes the next colour from a categorical
set, so the rail's bullseye and the plot's agree and hovering a row points at
something. The set and the ring's tint are added to `graphTheme.ts`, as every
colour literal in this codebase is.

### The toolbar and the File menu

The toolbar reads **Filter · Similar · Export · File · Refresh · search**.

- The Seeds button and its label go; seeds live in the rail.
- The Graph menu is renamed **File** and keeps its place before Refresh.
- Filter keeps tags, item type, year and the data-quality switches. Its
  collections list is removed, because the rail's tree replaces it.

File and Tools › Meristema offer the same four commands, in the same order,
under the same names:

1. **New Graph**
2. **Open** (submenu of the library's saved graphs, each row with a `×`)
3. **Save**
4. **Save as…**

In Tools, a separator then keeps the library commands and Settings. In Tools,
Save and Save as… are disabled when no graph tab is active. The locale entry
`open-saved-graph-submenu` changes from "Open Saved Graph…" to "Open", since
its parent now names the structure.

### The seed search panel

The panel's contents, its debounced library search, its scoring and its
fifty-result cap are unchanged. Two things about it change.

**Where it opens.** It is anchored to the rail's `+ Add seed` link instead of
the toolbar button, and floats over the left edge of the plot so it keeps its
430px width. The placement logic from
`2026-09-05-explore-toolbar-controls-design.md` survives: the `cm-popover-end`
flip and the inline `max-width` bound are still measured against the plot
pane's rect, which is the box that clips it.

**How its rows are drawn.** The rows currently read as broken: the title and
the metadata line touch, with no space between them. The cause is that
`.cm-focus-seed-result-main` is a `<button>` used as a grid container, so it
inherits Zotero's tight button line-height, and its two spans sit in grid rows
`2px` apart with no line-height of their own. The four `!important`
declarations already on that rule are the same fight, lost earlier.

The fix: give `.cm-focus-seed-result-title` and
`.cm-focus-seed-result-meta` an explicit `line-height: 1.4`, raise the row
gap to `4px`, and scope the rules under `.meristema-root` so they win on
specificity, dropping the `!important` chain. This was listed as out of scope
by `2026-09-07-seed-entry-points-design.md` and tracked nowhere; it is in
scope here because the panel is being re-anchored anyway.

### The item context menu

Two entries, resolving B4:

1. **New Graph from item**, or **New Graph from 3 items**, opening a new graph
   seeded with the selection.
2. **Add to**, a submenu listing every open graph by title. Choosing one adds
   the selection to that graph as seeds.

`Show in New Graph`, the flat injected `Show in {title}` entries, and the flat
`Add as seed to {title}` entries all go: the first two because showing and
seeding are now the same act, the third because the submenu groups them.

**Refresh** moves out of the item menu to Tools › Meristema, below the
separator with the other library commands.

Locale: `show-items-new-tab-command` is deleted, `open-focus-view-new-tab-command`
keeps its plural forms and its label, a new `add-to-submenu` reads "Add to",
and `open-existing-view-command` stays as the per-graph row.

The folder context menu is unchanged: it opens new graphs only, as
`2026-09-07-graph-view-followups-design.md` decided.

### The detail pane and the node menu

- The detail pane keeps **Add as seed** and **Remove seed** in every state.
- **Explore from this paper** is deleted from the detail pane and the node
  menu. That is D2. With seeding additive, an action that replaces every seed
  has no meaning; adding is what the reader wants and Add as seed does it.
- The node menu keeps the F1 open entries and gains **Remove from graph**,
  absent on a seed.

### State

`GraphViewState` gains four fields and goes to version 2:

```ts
export interface GraphViewState {
  version: 2;
  seeds: GraphViewSeed[];
  explore: GraphViewExploreSettings;
  filters: PaperListFilterState;
  collections: GraphViewCollectionTicks;
  /** Papers in no folder are drawn. */
  includeUnfiled: boolean;
  /** Papers outside Zotero are drawn. */
  includeExternal: boolean;
  /** Papers the reader removed one by one. */
  hiddenKeys: string[];
  camera: GraphViewTransform | null;
  title: string | null;
}
```

The ticks are stored as a base and its exceptions, never as a list of ticked
folders:

```ts
export type GraphViewCollectionTicks =
  /** Every folder is ticked except these. A folder made later is ticked. */
  | { base: "all"; except: number[] }
  /** No folder is ticked except these. A folder made later is not. */
  | { base: "none"; except: number[] };
```

Both halves are needed, and each is the right default for one kind of graph. A
library graph is `all`, so a folder you create next week has its papers on the
plot, as the rest of the library does. A graph opened on two folders is
`none`, so that same new folder does not quietly appear in a graph that was
never about it.

Switching between the two is the rail's job, not the reader's: unticking
enough rows never flips the base, and the base is set once when the graph is
created.

This shape also lets the migration stay pure. Computing "every folder except
these" from a version 1 recipe would need the library's folder list, which
`parseGraphViewState` has no access to and must not acquire.

`PaperListFilterState.collectionIDs` stays in that type, because the
relationship lists in the detail pane still filter by folder through the same
controller. The graph view stops reading and writing it: the rail's ticks are
where a graph's folders live now. The graph's `PaperFilterController` is
constructed without `collections`, so the popover renders no folder list, and
`setCollectionIDs` is deleted along with the two places that called it.

`parseGraphViewState` currently returns `null` for any version but the
current one, which would silently drop every saved graph on upgrade. It gains
a migration instead. A version 1 recipe becomes a version 2 one with Unfiled
and Not in Zotero on and nothing hidden, and its `filters.collectionIDs`
decides the ticks. Empty gives `{ base: "all", except: [] }`. A non-empty list
gives `{ base: "none", except: those }`.

Version 1 stored the folders a graph was scoped to, a whitelist, so that
mapping is the right shape. It is only exact because subfolders cascade: a
version 1 graph scoped to a parent drew the whole subtree through
`collectionScopeIDs`, and under the cascade rule ticking that parent still
does. Without the cascade this migration would need the library's folder tree
to expand the list, which `parseGraphViewState` has no access to and must not
acquire, and every saved folder graph would open smaller than it was saved.

The parser still returns `null` for malformed input and for a version it does
not know, and it still never throws.

The rail's collapsed state is not part of this: it is bound to Zotero's
collections pane and stays there.

## What survives, moves, or goes

The roadmap requires this to be explicit, so that approved work is not
silently dropped.

From `2026-09-05-explore-toolbar-controls-design.md`:

| Behaviour                            | Outcome                                          |
| ------------------------------------ | ------------------------------------------------ |
| `.cm-focus-bar` removal              | Already done, stays done                         |
| Seeds toolbar button                 | **Deleted**; seeds live in the rail              |
| Seed popover, contents and search    | **Survives**, re-anchored to the rail            |
| Popover edge flip and width bound    | **Survives**, still measured on the plot pane    |
| Explore settings popover             | Already deleted by durable graphs, stays deleted |
| `.cm-focus-only` hiding by view kind | Already gone with the view kind                  |

From `2026-09-07-seed-entry-points-design.md`:

| Behaviour                                            | Outcome                               |
| ---------------------------------------------------- | ------------------------------------- |
| Add Node removal                                     | Stays removed                         |
| Popover searching the whole library, `+` rows        | **Survives**, moved                   |
| Detail pane Add as seed / Remove seed in every state | **Survives**                          |
| "Explore from this paper"                            | **Deleted** (D2)                      |
| Node right-click menu, roles and keyboard            | **Survives**, gains Remove from graph |
| Popover row overlap, listed out of scope             | **Fixed here**                        |

From `2026-09-07-refresh-preserves-state.md` and
`2026-09-07-durable-graphs-design.md`:

| Behaviour                                                | Outcome                                     |
| -------------------------------------------------------- | ------------------------------------------- |
| `GraphViewState` recipe, `getState` / `applyState`       | **Survives**, extended to version 2         |
| Instance `viewState`, refresh restores instead of resets | **Survives**                                |
| Explore section behind the gear, hidden while seedless   | **Survives** this stage, deleted in stage 3 |
| Direction and scope sticky within a view                 | **Survives**                                |
| Saved graphs, autosave, tab rename saves a scratch graph | **Survives**                                |
| Graph menu                                               | **Renamed** File, mirrored in Tools         |
| Item menu wording "Add as seed to X"                     | **Replaced** by the Add to submenu          |

## Files

- Create `src/services/graphScopeModel.ts` (visibility order, counts),
  `src/services/graphScopeRailModel.ts` (the rows the Scope section draws).
- Modify `src/services/graphViewService.ts`: retire the projection swap, drop
  the item scope, wire the rail's ticks into `applyFilters`, move the seed
  popover's anchor, File menu, node menu entry.
- Modify `src/services/graphKeyRail.ts`: render Scope above Key.
- Modify `src/services/graphFocusService.ts`: return reach and additions
  rather than a replacement model.
- Modify `src/services/graphViewState.ts`: version 2, new fields, migration.
- Modify `src/services/graphScopePolicy.ts`: drop the item-scope helpers.
- Modify `src/services/paperListViewService.ts`: drop the collections list
  and `setCollectionIDs`.
- Modify `src/services/windowService.ts`: openers seed instead of scoping.
- Modify `src/services/menuService.ts`: the Add to submenu, Refresh moved.
- Modify `src/services/citationGraphRenderer.ts` and
  `src/services/graphTheme.ts`: per-seed colours, the in-library ring.
- Modify `addon/content/graph.css`: Scope rows, the tree, the popover anchor,
  the result-row line-heights.
- Modify `addon/locale/en-US/mainWindow.ftl`, regenerate `typings/i10n.d.ts`.
- Modify `README.md`: the Explore paragraph describes seeds as additive.

## Testing

Unit, in `test/unit`:

- The visibility order: a seed's neighbour in an unticked folder stays; an
  unticked folder's paper goes; a hidden paper goes; a seed survives both a
  hidden key and an unticked folder; Not in Zotero hides external papers but
  not an external seed.
- A paper filed in two folders stays while either is ticked, and goes only
  when both are unticked.
- A year range hides a seed's citer published outside it, proving the facets
  reach a paper the seed brought in, while the same citer filed in an unticked
  folder stays.
- A paper in `hiddenKeys` that is then seeded is drawn, and its key is gone
  from the set, so removing the seed afterwards leaves it drawn.
- Toggling a parent folder writes the same tick to every descendant, and a
  descendant unticked afterwards leaves the parent in the mixed state.
- The counts the rail prints: `shown` ignores the search box, folder counts
  count only papers in the graph.
- The Scope rail model: tree indent and order, Unfiled and Not in Zotero last,
  the hidden line present only when something is hidden.
- State version 2 round-trips; a version 1 recipe with no folder filter
  migrates to `base: "all"`, and one naming two folders to `base: "none"` with
  those two; malformed input still returns null without throwing.
- The ticks resolve correctly for a folder invented after the recipe was
  written: ticked under `all`, unticked under `none`.
- A version 1 recipe scoped to a parent folder opens showing that folder's
  whole subtree, the same papers it drew before the upgrade.

Zotero, in `test/zotero`:

- D1 directly: open a graph on a folder, add one of its papers as a seed, and
  assert the folder's unconnected papers are still drawn.
- Untick a folder on a seeded graph: its papers go, the seed's neighbours
  stay.
- The toolbar has no Seeds button, has File, and Add seed in the rail opens
  the search panel.
- Remove from graph hides a paper, and Show all brings it back.

`npm run check` is the gate for every task.

## Manual verification

Appended to the roadmap's batch when this ships, per the working rules:

- A folder graph plus a seed keeps the folder's other papers on screen.
- Unticking every folder on a seeded graph leaves the seeds and their
  neighbours; ticking them back restores the rest.
- A seed's citer that is already in the library wears a ring; one that is not
  does not.
- Hovering a Seeds row lights that seed and its edges.
- The seed search panel's rows have clear space between title and metadata.
- File and Tools › Meristema offer the same four commands in the same order.
- Right-clicking papers offers New Graph from N items and an Add to submenu,
  and no Refresh.

## Out of scope

Citation hops and their fetching, the citation floor, shared citers, the
presets, and the Key's shared-citer tiers: stages 3 and 4. F3, standards
without a main author. B7, New Graph on an empty library. Any change to how
neighbours are fetched or cached.
