# Seed Entry Points

**Date:** 2026-09-07
**Status:** Approved

## Problem

The graph view has an Add Node button that does two things depending on
state. In a seeded graph it adds the chosen papers as seeds. In a seedless
graph it adds them to the library map, which the filters already do. The
name says neither.

Defining a seed, meanwhile, is hard to find. The detail pane's "Add as seed"
button renders only when the graph already has seeds, so in a seedless graph
the first seed can only come from "Explore from this paper" or from the
library's "Explore in" menu. Nothing in the graph itself says "add a seed".

## Design

Add Node goes. Seeds are added from three places: the Seeds popover in the
toolbar, the detail pane, and a right-click menu on a node. All three call
the existing `addFocusSeed` and `removeFocusSeed`; adding the first seed to a
seedless graph enters Explore with that paper, as "Explore from this paper"
does, and removing the last seed by any path returns the tab to the library
graph, as now.

### The Seeds popover adds seeds

The Seeds button is enabled in every state. At "0 seeds" it opens the same
popover; only the Explore button stays disabled while the graph is seedless.

The popover's search box searches the whole library, not just the seeds. It
reuses Add Node's library search unchanged: the Zotero quick search on
title, creator and year, the debounce (`LIBRARY_SEARCH_DEBOUNCE_MS`), the
scoring in `scoreLibraryPaperSearch`, and the 50-result cap.

- With an empty query the popover lists the current seeds, as it does today.
  In a seedless graph it shows a placeholder: "No seeds yet. Search the
  library to add one."
- With a query it lists matching library papers. A row that is already a
  seed keeps the × remove control it has now; any other row shows a +
  control that adds the paper as a seed. Clicking the row's main area
  selects the node in the graph when the paper is in the graph, and does
  nothing otherwise.
- Adding or removing a seed re-renders the list in place and keeps the
  query, so several seeds can be added in a row. The popover does not close
  on add.

The `cm-add-node-*` elements, their CSS rules, and the Add Node event
handlers are removed. `addLibraryItemsToView` loses its seedless branch;
`addMapItemsRespectingFilters` stays because the controller's `addMapItems`
still uses it.

The "search seeds" placeholder and aria-label become "Search seeds or
library" and "Search seeds and the Zotero library".

### The detail pane offers Add as seed in every state

The `focusProjection &&` guard on the detail pane's "Add as seed" button
goes. The button renders whenever the selected paper is not already a seed,
seedless graph included, placed directly after "Find similar papers". When
the selected paper is a seed the same slot shows "Remove seed" instead,
calling `removeFocusSeed`. "Explore from this paper" stays as the
replace-all-seeds action.

Both branches of the detail pane, library papers and external works, get
the same treatment.

### A right-click menu on a node

`CitationGraphRendererOptions` gains
`onNodeContextMenu?: (node: CitationGraphNode, clientX: number, clientY: number) => void`.
The renderer adds a `contextmenu` listener on the canvas that runs the
existing `hitTest`; when it lands on a node it prevents the default menu,
selects the node, and calls the callback with the pointer's client
coordinates. On the background it does nothing and the browser default is
left alone.

The graph view renders a `cm-node-menu` element, hidden until used,
positioned absolutely inside the plot pane at the pointer and clamped so it
stays within the pane. It holds two buttons:

1. "Add as seed" when the node is not a seed, "Remove seed" when it is.
2. "Explore from this paper".

Choosing an item runs the action and closes the menu. Escape, a pointer
down outside the menu, a scroll or wheel on the canvas, and a change of
selection all close it. The menu has `role="menu"`, its items
`role="menuitem"`, and focus moves to the first item when it opens.

## Files

- `src/services/graphViewService.ts`: remove Add Node; extend the Seeds
  popover; detail-pane buttons; node menu.
- `src/services/citationGraphRenderer.ts`: `onNodeContextMenu` and the
  `contextmenu` listener.
- `addon/content/graph.css`: drop `.cm-add-node-*`; add the + control in
  the seed row and the `.cm-node-menu` rules.
- `test/unit/architecture.test.ts` or a new unit file for any pure helper
  the popover rows need (a row-model function that decides seed / library /
  placeholder from the query and the seed set).
- `test/zotero/graphViewVisual.test.ts`: remove Add Node geometry
  assertions; assert the Seeds button is enabled while seedless.
- `README.md`: the Explore paragraph names the three ways to add a seed.

## Testing

- Unit: the seed-row model — empty query lists seeds; query lists library
  matches with seeds marked; seedless empty query yields the placeholder.
- `npm run check` green at the end of every task.
- Manual, in Zotero: from a seedless graph, Seeds › search › + seeds the
  graph and enables Explore; detail pane shows "Add as seed" on a
  non-seed and "Remove seed" on a seed; right-click on a node opens the
  menu, on the background does not; removing the last seed from the menu
  returns the library graph; no Add Node button remains.

## Out of scope

The Seeds popover rows currently overlap their title and metadata on some
displays. Touching those rows here may fix it, but that is not a goal of
this change and is tracked separately.
