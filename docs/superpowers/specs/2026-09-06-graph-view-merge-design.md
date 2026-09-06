# One Graph View, Seeded or Not

**Date:** 2026-09-06
**Status:** Draft

## Problem

Meristema offers two views, Collection Graph and Explore, and treats them as
different kinds of tab: separate menu entries create them, the tab is titled
after its kind, the kind is saved with the tab, and the item context menu
offers a different action depending on which kind of tab is open.

They are the same view. Both are drawn by `createGraphView`, on the same
canvas, with the same toolbar, filters, appearance panel, search, export,
refresh and history. The only thing Explore has that Collection Graph lacks
is a set of seed papers, and the four Explore settings (direction, scope,
ranking, limit) are properties of those seeds. Leaving Explore is literally
"clear the seeds and flip the kind flag", and entering it from a collection
graph already remembers the collection filter and restores it on the way
back.

The kind flag therefore buys nothing and costs a duplicated vocabulary:
"Collection Graph" versus "Explore view", "New Collection Graph" versus "New
Explore View", "Open in New Collection Graph" versus "Open in New Explore
View", and an Explore tab that shows nothing at all until it is given a
seed.

## Design

There is one view, called a **Graph**. A graph has a scope (the library, one
or more folders, or a set of items) and an optional set of **seeds**. With no
seeds the graph shows how the papers in its scope cite each other. With seeds
it shows the papers around those seeds, walked outward by the Explore
settings, and the scope's folder filter is set aside until the seeds are
gone. This is the behaviour the code has today; the change is to stop
pretending it is two views.

"Explore" survives as the name of the act and of its controls: the Explore
button in the toolbar, the "Explore in …" menu entries. It is no longer the
name of a kind of tab.

### Model

- `GraphViewKind` and every value derived from it are removed:
  `currentViewKind`, `setViewKind`, `onViewKindChange`, `initialViewKind` in
  the graph view; `kind`, `setInstanceKind`, `requestViewKind`,
  `OpenGraphOptions.initialKind` and `OpenGraphViewInfo.kind` in the window
  service; `graphViewBaseTitle(kind)` and the `kind` parameter of
  `nextGraphViewTitle` in the instance policy.
- Whether a view is seeded is `focusProjection !== null`, which the graph view
  already tracks. Nothing new is stored.
- The root element's `data-view-kind` attribute becomes `data-seeded`, set
  to `"true"` while a projection is active and `"false"` otherwise. The CSS
  rule that hides `.cm-focus-only` in map tabs keys on
  `[data-seeded="false"]` instead. The attribute is updated wherever
  `setViewKind` was called: on entering seeds, on `exitFocus`, and in the
  history back handler that leaves the first seed state.
- The rule in `applyFilters` that hides every node when the view is an
  Explore tab without a projection is removed. A view without seeds shows its
  scope.
- The remembered-and-restored folder filter, the item-set scope being ignored
  while seeded, the seed history, and the back button's return to the
  seedless graph all stay as they are.

### What the reader sees

- The hidden `<h1>` reads "Graph". The refresh button's title still depends
  on whether seeds are present, now keyed on the projection.
- The toolbar is unchanged from the current Explore layout: the Seeds and
  Explore buttons appear when the view is seeded and are hidden otherwise.
- Removing the last seed, or pressing Back from the first seed state, leaves
  the view showing its scope again with the folder filter restored. Same as
  today; the tab no longer changes its name when this happens.
- The empty-state text for a seedless graph with fewer than two papers no
  longer says "switch to Explore". It says to add papers with the + button,
  or to select papers in the library and choose "Show in New Graph", and
  that "Explore in New Graph" on a paper shows its references and citing
  works.

### Titles

- The default title of a new view is "Graph", numbered "Graph 2", "Graph 3"
  when the base is taken. A view opened from folders is still titled after
  them ("PhD Graph", "PhD +1 Graph"); `collectionGraphTitle` and
  `multiCollectionGraphTitle` are unchanged.
- Seeding or unseeding a view never renames its tab. `setInstanceKind`, which
  renamed non-custom titles between "Collection Graph" and "Explore", is
  deleted with the kind.

### Menus

The intent moves from the tab to the menu entry. Every open view accepts both
intents.

Item context menu, in this order:

1. **Show in New Graph** — opens a new graph scoped to the selected items
   (today's "Open in New Collection Graph"). Followed by one injected entry
   per open view, labelled "Show in {title}" with the hint "adds to graph".
   On a seeded view this first clears the seeds, then adds the items; the
   Show intent always yields a seedless graph.
2. **Explore in New Graph** — opens a new graph with the selected items as
   seeds (today's "Open in New Explore View"). Followed by one injected entry
   per open view, labelled "Explore in {title}" with the hint "adds as
   seeds". On an unseeded view this enters seeds from the library graph; on a
   seeded view it appends them. Both are today's `openFocusItemsInView`.
3. Refresh, unchanged.

Collection context menu: the injected "Show in {title}" entries are offered
for every open view, not only map views. Showing folders in a seeded view
clears its seeds first, then applies the folder scope.

Tools submenu: one entry, **New Graph**, opening the library graph.
"New Explore View" and `openNewFocusWindow` are removed; a new graph is
seeded by exploring a paper in it.

Locale: `show-items-new-tab-command` becomes "Show in New Graph",
`open-focus-view-new-tab-command` becomes "Explore in New Graph",
`new-graph-view-command` becomes "New Graph", and `new-focus-view-command`
is deleted. `show-items-command` and `open-focus-view-command` are defined
but referenced nowhere in `src`; they are deleted too. The "Open Collection
Graph (Current Library)" label becomes "Open Graph (Current Library)".

### Persistence

- `tab.data.graphKind` is no longer written. On restore it is ignored, so a
  tab saved by an earlier version as an Explore tab reopens as a graph of its
  library. Seeds were never persisted, so nothing is lost that was kept
  before.
- `PendingGraphRequest.focusItemIDs` keeps its meaning: items to enter as
  seeds once the view is ready.

### Documentation

- README: the two feature bullets stay, retitled "See how the papers in your
  library are connected" and "Explore outward from one or more papers", with
  the second describing seeds as something you add to a graph rather than a
  separate view. The multiple-views bullet says "several Graph tabs".
- The redesign spec and the Explore toolbar spec are left as history; this
  spec supersedes their two-kind vocabulary.

## Out of scope

- Persisting seeds and Explore settings with the tab.
- Any change to how the projection is built, ranked or limited.
- Any change to the toolbar layout beyond the attribute rename.

## Testing

- `npm run check` is the gate. Type checking enforces the removal: every
  reference to `GraphViewKind`, `kind`, `graphKind`, `initialViewKind` and
  `onViewKindChange` must be gone or the build fails.
- Unit tests in `test/unit` for `nextGraphViewTitle` without a kind: the
  first view is "Graph", the second "Graph 2", a preferred base wins, and a
  blank preferred base falls back to "Graph".
- Manual walk-through in Zotero after `npm start`:
  1. Tools › Meristema › New Graph opens the library graph, titled "Graph".
  2. Right-click a paper › Explore in New Graph opens "Graph 2" with the
     paper as seed and the Seeds and Explore buttons visible.
  3. In that tab, Seeds › remove the seed: the library graph appears, the
     buttons hide, the tab is still "Graph 2".
  4. Right-click two papers › Show in Graph 2: they are selected in the
     seedless graph.
  5. Right-click a paper › Explore in Graph 2 while seeded: it is added as a
     second seed.
  6. Right-click a folder › Show in Graph 2 while seeded: seeds clear and the
     folder graph appears.
  7. Restart Zotero with the tabs open: every tab reopens as a graph.

## Files

- `src/services/graphInstancePolicy.ts` — drop the kind, base title "Graph".
- `src/services/windowService.ts` — drop kind from the instance, tab data,
  options, view info and the focus-window opener.
- `src/services/graphViewService.ts` — drop the kind and its callbacks,
  `data-seeded`, the `applyFilters` rule, title, refresh title, empty state.
- `src/services/menuService.ts` — two item-menu anchors with injected views,
  unfiltered collection-menu views, one Tools entry.
- `addon/locale/en-US/mainWindow.ftl` — labels above.
- `addon/content/graph.css` — `[data-seeded="false"] .cm-focus-only`.
- `README.md`, new `test/unit/graphInstancePolicy.test.ts`.
