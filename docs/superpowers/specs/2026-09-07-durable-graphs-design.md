# Durable Graphs

**Date:** 2026-09-07
**Status:** Approved

## Problem

A graph's seeds, Explore settings, filters and camera live only inside the
closure of `renderGraphView`. Whenever an open view is refreshed, the tab is
rendered again from scratch and all of that is lost. The instance in
`windowService` remembers only the map scope and the pinned items.

Refreshes happen more often than they look. The automatic citation update
asks every open view to refresh after any update that touched up to three
items, and a new Zotero item triggers such an update. So the sequence "add a
seed, add it to Zotero from the detail pane" resets the graph a moment after
the import: the update finishes, the view refreshes, the seeds are gone.
Changing a preference refreshes the views the same way.

Beyond the bug, a graph is a throwaway. Closing the tab is the only end it
can have. There is no way to keep a graph you spent time on and come back to
it.

The item context menu also drifted. Since seeds became the way to explore,
"Explore in X" means "add as seed to X", and "Show in New Graph" no longer
says what it does.

## Design

One serializable `GraphViewState` describes a graph as a recipe: its seeds,
its Explore settings, its filters, its camera and its title. The view can
hand that state out and be rebuilt from it. The instance keeps the state
across refreshes, which fixes the reset. A saved graph is that same state
written to the plugin's database under a name, and opened again later.

Neighbours are never saved. On load they are recomputed from the current
citation data, as a refresh does today. A saved graph is a durable
configuration, not a frozen picture.

Global appearance (axes, colours, node size, labels) stays in preferences
and is not part of a graph, even though direction and scope share its panel. Map scope and pinned items stay on the instance as they
do now.

### `GraphViewState`

A new file `src/services/graphViewState.ts` holds the type, its version, its
JSON helpers and the seed resolution. Plain data only, no DOM, so it runs in
the unit tests.

```ts
export const GRAPH_VIEW_STATE_VERSION = 1;

export type GraphViewSeed =
  | { kind: "item"; itemKey: string }
  | { kind: "external"; identityKey: string; work: RelatedWorkMetadata };

export interface GraphViewState {
  version: 1;
  /** Ordered. The first entry is the primary seed. Empty means library graph. */
  seeds: GraphViewSeed[];
  explore: {
    direction: GraphFocusDirection;
    locality: GraphFocusLocality;
  };
  filters: PaperListFilterState;
  camera: GraphViewTransform | null;
  /** The custom tab title, or null when the title is derived. */
  title: string | null;
}
```

- Zotero seeds are stored by item key, not numeric ID. Keys survive sync and
  are stable across profiles that share a library; IDs are not.
- External seeds carry the work's metadata inline. The external work cache
  can be cleared from the preferences, and a saved graph must still open
  after that. `identityKey` is `stableExternalWorkIdentity(work)`; a work
  with no stable identity cannot be a saved seed and is dropped on
  serialization.
- `explore` is direction and scope only. Ranking and the per-seed limit
  are removed from the product (see below), so `GraphFocusState` keeps
  `maxPerDirection` as an internal field set to `Infinity` and `ranking`
  fixed at `relevance`, for the neighbour approach that follows this work.
- `filters` is the filter controller's state verbatim, collections included.
  A collection filter on a library graph is part of what the graph is.
- `camera` is the renderer transform. It is read on demand, never reported
  as a change.

Helpers:

- `emptyGraphViewState(): GraphViewState`: no seeds, default Explore
  settings (both directions, all known papers), default filters, null
  camera, null title.
- `serializeGraphViewState(state): string` and
  `parseGraphViewState(json): GraphViewState | null`. Parsing validates the
  shape, fills missing optional fields with defaults, and returns null for
  a different major version or malformed input. It never throws.
- `resolveGraphViewSeeds(seeds, snapshot): { nodes: CitationGraphNode[]; dropped: number }`:
  an item seed resolves through the snapshot's papers by key; an external
  seed resolves to a temporary external node built from the inline work
  (the same construction `addFocusSeeds` uses for external nodes today).
  Seeds whose item no longer exists are dropped and counted. Order is kept.

### The view hands its state out and accepts it

`GraphViewController` gains:

```ts
getState(): GraphViewState;
applyState(state: GraphViewState): GraphFocusResult;
```

`GraphViewOptions` gains:

```ts
initialState?: GraphViewState | null;
title?: string | null;
onStateChange?: (state: GraphViewState) => void;
```

- `getState()` reads the live view: seeds from the focus projection's
  ordered seed keys mapped through `focusSeedRegistry`, Explore settings
  from the two selects, filters from `graphFilter.state()`, camera from
  `renderer.getViewTransform()`, title from the `title` option that the
  window service passes in. With no projection, `seeds` is empty and
  `explore` still reports the selects.
- `applyState` sets the two selects and the filters first, then resolves
  the seeds and calls `addFocusSeeds` with them, then sets the camera when
  one is given and skips the fit. With no seeds it stays in, or returns to,
  the library graph. Dropped seeds are not an error; the Seeds count simply
  reflects what resolved.
- `initialState` is applied at the end of the render, after the initial
  request (selection, focus items, collections) has been consumed, so a
  refresh never loses an explicit "Show in" or "Add as seed" that arrived
  while the tab was dirty. When both a pending request and an initial
  state exist, the request wins for the parts it names.
- `onStateChange` fires, debounced by one animation frame, after any change
  to seeds, Explore settings, filters or title. It does not fire for camera
  moves. It fires with the same object `getState()` would return.

`PaperFilterController` gains `setState(state: PaperListFilterState)`, which
replaces the filter state, rebuilds the popup and calls `onChange` once.

### Explore settings move behind the gear

The toolbar's Explore button and its popover go. Direction and scope become
an "Explore" section at the top of the graph display settings panel that the
gear in the Key rail opens (`createAxesAppearance`), shown only while the
graph has seeds. The section is a settings section, not appearance: it is
saved with the graph, not in preferences. Ranking and the per-seed limit are
removed with the popover. The toolbar then reads Filter, Seeds, Similar,
Export, Graph, Refresh.

### Refresh restores instead of resets

`GraphInstanceState` gains `viewState: GraphViewState | null`.

- Every render path (`renderTab`, `renderDetachedWindow`) passes
  `instance.viewState` as `initialState` and `instance.title` when
  `customTitle` is set, and wires `onStateChange` to store the state on the
  instance.
- Before a refresh tears a view down, `refreshOpenGraphViews` and
  `refreshGraphInstance` read `getState()` from the live controller so the
  camera is current, and store it on the instance. Detaching a tab into a
  window and reattaching it do the same.
- "Show in", "Add as seed to" and "New Graph from" keep working through the
  pending request; the state only fills in what the request does not name.

With this, the sequence in the bug report keeps its seeds: the import
triggers the update, the update triggers the refresh, and the refresh
rebuilds the same graph. The imported paper's node changes from external to
local because the seed is re-resolved against the new snapshot.

### Saved graphs

A `savedGraphService.ts` stores graphs in the plugin's existing SQLite
database, the `meristema-external` connection that `externalWorkCacheService`
opens, in a new table:

```sql
CREATE TABLE IF NOT EXISTS saved_graphs_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libraryID INTEGER NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_graphs_v1_library ON saved_graphs_v1(libraryID, name);
```

The connection setup moves out of `externalWorkCacheService` into a small
`pluginDatabase.ts` that both services share, so the saved graph service
does not depend on the cache's lifecycle. Both are opened at startup and
closed at shutdown from `hooks.ts`, as the cache is now.

API, all returning promises:

```ts
export interface SavedGraphSummary {
  id: number;
  libraryID: number;
  name: string;
  created: string;
  modified: string;
}

listSavedGraphs(libraryID): SavedGraphSummary[]; // sorted by name, case-insensitive
loadSavedGraph(id): { summary: SavedGraphSummary; state: GraphViewState } | null;
createSavedGraph(libraryID, name, state): SavedGraphSummary;
updateSavedGraph(id, state): void; // bumps modified
renameSavedGraph(id, name): void;
deleteSavedGraph(id): void;
```

Names are trimmed and must be non-empty. Two graphs may share a name; the
list shows the modified date to tell them apart. Nothing syncs; the table is
local to the Zotero profile. A saved graph whose library no longer exists is
simply not listed.

### Save, Save as, Open

`GraphInstanceState` gains `savedGraphID: number | null`. The document model:
a graph is scratch until it is saved, and a saved graph saves itself.

The toolbar gets a **Graph** button between Export and Refresh, opening a
menu built like the Export menu, with three items:

- **Save.** On a scratch graph, prompts for a name with the current tab
  title as the default, using the same window prompt the tab rename uses.
  Creates the row, stores its id on the instance, sets the tab title to the
  name with `customTitle` on, and reports "Saved" in the toolbar status for
  a moment. On a saved graph, Save writes the current state at once,
  including the camera, which autosave does not track.
- **Save as.** Always prompts for a name, defaulting to the current title.
  Creates a new row and switches this instance to it: the tab is renamed and
  `savedGraphID` becomes the new id. The previous saved graph is left as it
  was at its last autosave.
- **Open.** A submenu listing the library's saved graphs by name with their
  modified date, and a small **×** per row that deletes after a confirm
  dialog. Choosing a graph that is already open in this window focuses
  that tab. Otherwise it opens a new tab with `initialState` set to the
  loaded state, `savedGraphID` set, and the title set to the name. If a
  graph's row was deleted between listing and opening, the menu reports
  "This graph was deleted." and rebuilds. The submenu says "No saved graphs
  yet." when empty.

Autosave: once `savedGraphID` is set, every `onStateChange` on the instance
writes through with `updateSavedGraph`, debounced by 500 ms and coalesced,
so a burst of seed additions is one write. A failed write is logged and the
status shows "Autosave failed"; the graph stays open and the next change
retries.

Renaming the tab, through the existing tab context menu, renames the saved
graph as well. Closing a tab does nothing to its saved graph. Opening the
same saved graph in two windows is allowed; last write wins.

The Tools › Meristema menu gains **Open Saved Graph…** with the same
submenu, so a saved graph can be opened when no graph tab is open.

### Item context menu wording

In `menuService.ts`:

- The new-view command reads "New Graph from item", or "New Graph from
  N items" for several, in the same place "Show in New Graph" is now.
- The per-view "Explore in X" entries read "Add as seed to X"; their
  description text stays "adds as seeds".
- "Show in X" and the collection commands are unchanged.

## Files

- Create `src/services/graphViewState.ts`, `src/services/savedGraphService.ts`,
  `src/services/pluginDatabase.ts`.
- Modify `src/services/graphViewService.ts` (Explore popover removal,
  controller methods, options, Graph menu), `src/services/graphViewControls.ts`
  (Explore section in the display settings panel),
  `src/services/graphFocusService.ts` (fixed ranking, no limit), `src/services/paperListViewService.ts` (`setState`),
  `src/services/windowService.ts` (instance fields, render paths, refresh,
  open saved graph), `src/services/externalWorkCacheService.ts` (shared
  connection), `src/services/menuService.ts` (wording, Open Saved Graph),
  `src/hooks.ts` (database lifecycle), `addon/content/graph.css`
  (Graph menu), `addon/locale/**` for the changed menu labels, `README.md`.
- Tests: `test/unit/graphViewState.test.ts`, `test/unit/savedGraphService.test.ts`
  (against a fake connection), `test/unit/paperFilterController.test.ts`
  (`setState`), `test/zotero/graphViewVisual.test.ts` (refresh keeps seeds;
  Save then Open).

## Phases

1. **Refresh preserves state.** Remove ranking and limit, move direction
   and scope behind the gear, `graphViewState.ts`, controller
   `getState`/`applyState`, options, filter `setState`, instance
   `viewState`, all render and refresh paths. Ships on its own and fixes
   the reported bug.
2. **Saved graphs and menu wording.** Database, service, Graph menu, Open
   from Tools, autosave, tab rename, context menu labels.

## Testing

Unit: state round-trips through JSON; parse rejects a wrong version and
malformed input without throwing; seeds resolve by key and drop missing
items with the count; external seeds resolve from inline metadata; the
saved graph service lists per library sorted by name, updates bump
`modified`, delete removes; filter `setState` replaces and fires `onChange`
once.

Zotero visual: the toolbar has no Explore button and the gear panel shows
the Explore section only in a seeded graph; a seeded tab refreshed through
`refreshOpenGraphViews` keeps its seed count, direction, scope and
collection filter; Save on a scratch
graph then Open from a fresh tab restores the same seeds and title.

Manual, the original report: New PhD Graph, add a seed, add a node that is
not in Zotero as a seed, Add to Zotero. The graph keeps both seeds and the
imported one turns local. Then Save, close the tab, Open it from the Graph
menu and from Tools.

## Out of scope

Sync across devices or profiles. Export or import of saved graphs as files.
Frozen node membership. Saved appearance per graph. Any replacement for
the per-seed limit. The relationship-row
"Add as seed" wording noted in the seed entry points spec.
