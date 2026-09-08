# Selection Sync

**Date:** 2026-09-07
**Status:** Implemented

## Problem

Zotero's item list and the graph each have a selection, and neither knows
about the other. Selecting an item in the library does nothing in the graph.
Clicking a node in the graph only selects it locally; reaching Zotero takes a
double-click or the detail pane's Show in Zotero, and both are a jump: they
switch to the library tab, may change the collection, clear the quick search
and move keyboard focus to the item list.

The user's words: "select items across Zotero and the Graph. Once I select an
item in the Zotero view, it gets selected also in the Graph view. This way I
can easily navigate between them as a mixed strategy."

## Decisions

These were settled in the brainstorm and are not open:

1. **Both directions.** Zotero's selection is mirrored into the graph and the
   graph's into Zotero, with loop guards so neither echoes back.
2. **Detached windows are live; tabs catch up.** A detached graph window
   follows the library live both ways. A graph tab applies the library's
   selection when it is switched to, and a click in the tab selects in
   Zotero so the row is waiting when the user switches back. A hidden tab
   does not react live.
3. **Highlight only what is present.** Sync never adds nodes to the graph.
   Adding stays an explicit Show in Graph or Add as seed.
4. **Multi-select emphasises, single select selects.** One selected item
   whose node is in the graph becomes the graph's selected node. Two or more
   emphasise every present node through the renderer's existing emphasis
   (non-matching nodes fade) and clear the graph's single selection. An empty
   library selection clears both.
5. **All live graphs follow.** Every detached window in a Zotero window
   follows live and every graph tab catches up. A graph click reaches Zotero
   from whichever graph was clicked.
6. **Camera pans only when the node is off-screen.** A single-node selection
   pans by the minimum to bring the node into view, without changing zoom.
   Multi-select and a visible node move nothing.
7. **A graph click selects only listed rows.** If the item is not among the
   rows Zotero currently lists (another collection, a quick search or tag
   filter), the click does nothing in Zotero. Double-click and Show in Zotero
   keep today's full jump.

## What Zotero offers

Verified in Zotero 10.0.1 (`chrome/content/zotero/libraryTree.js`,
`itemTree.js`, `zoteroPane.js`, `collectionTree.js` from the installed
`omni.ja`):

- `ZoteroPane.itemsView.onSelect` is an event binding with `addListener(fn)`
  and `removeListener(fn)`. It fires from the tree's `_onSelectionChange`
  after Zotero's own `ZoteroPane.itemSelected` has run. Keyboard navigation
  goes through Zotero's 100 ms debounce (`_onSelectionChangeDebounced`);
  mouse clicks fire at once. Listeners are awaited one after another, so a
  listener must be cheap and must not throw. The event also fires when the
  selection did not change (Zotero's own handler compares sorted IDs for
  that reason), and it carries no arguments: the listener reads
  `itemsView.getSelectedItems(true)` for the IDs.
- The items tree is created once per main window (`zoteroPane.js`, the
  `CollectionViewItemTree.init` call), not per collection, so one listener
  per window survives collection changes.
- `Zotero.Notifier` has no `select` trigger for items. It is not a
  candidate.
- `itemsView.selectItems(ids, noRecurse)` selects rows already in the tree's
  row map, expands a collapsed parent when needed, scrolls the rows into
  view and returns the number selected. With `noRecurse = true` it does not
  clear searches or filters, and it neither switches tabs nor moves focus.
  It returns 0 when no row is listed.
- `ZoteroPane.selectItems(ids, { noTabSwitch })` is the full jump: it may
  switch library or collection, clear the quick search, tag selection and
  advanced search, and it focuses the items tree. This stays the path for
  double-click and Show in Zotero and is not used by sync.

## Architecture

Three layers, each ignorant of the one above it.

### Binder: `src/services/zoteroSelectionSync.ts` (new)

One per Zotero main window, modelled on `zoteroPaneSync.ts`. It owns the
`onSelect` listener, turns Zotero's argument-less event into a published
`LibrarySelection`, and offers the tree-level select for the graph to call.

```ts
export interface LibrarySelection {
  /** Sorted ascending, no duplicates. Empty when nothing is selected. */
  itemIDs: number[];
}

export interface ZoteroSelectionBinding {
  /**
   * The list's selection when the binding attached, then the last published
   * set. Returns a copy.
   */
  current(): LibrarySelection;
  /** Tree-level select of listed rows only: no jump, no focus, no tab switch. */
  selectListed(itemIDs: readonly number[]): void;
  /** Listeners receive a copy. Returns the unsubscribe function. */
  subscribe(listener: (selection: LibrarySelection) => void): () => void;
  /** Removes the tree listener and drops every subscriber. */
  dispose(): void;
}

/** The subset of Zotero's items tree the binder touches. */
export interface ItemsTreeLike {
  onSelect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  getSelectedItems(asIDs: true): number[];
  selectItems(ids: number[], noRecurse: boolean): Promise<number>;
}

/** Injectable so the binder is unit tested without Zotero. */
export interface ZoteroSelectionSyncDeps {
  /** `ZoteroPane.itemsView`, or null while the pane is still starting. */
  itemsView(): ItemsTreeLike | null;
  debug(message: string): void;
}

export function bindZoteroSelection(
  host: Window,
  deps?: ZoteroSelectionSyncDeps,
): ZoteroSelectionBinding;
```

Behaviour:

- **Listener.** Synchronous, wrapped in try/catch. Reads the selected IDs,
  sorts and deduplicates them. If the set equals `current()`, it returns.
  If the set equals `mine` (see below), it becomes `current()`, `mine` is
  cleared, and nothing is published: that is the echo of a graph click.
  Otherwise it becomes `current()` and is published.
- **`selectListed`.** A no-op when the IDs already equal `current()`.
  Otherwise it stores the sorted IDs as `mine`, calls
  `selectItems(ids, true)` and does not await it. When the promise resolves
  with 0 (no row listed) or rejects, `mine` is cleared so a later user
  selection of those rows is not swallowed.
- **Publishing.** Each subscriber is called in its own try/catch with a copy
  of the array; a throwing subscriber is logged and the rest still run.
- **Late tree.** If `itemsView()` is null when bound, the binder logs once
  and retries the lookup on the next `current()` or `selectListed` call and
  on each later attempt; the listener is attached at the first success.
  Nothing waits on Zotero start-up.
- **`dispose`.** Removes the listener if attached and clears subscribers.

### Window service: `src/services/windowService.ts`

- `selectionBindingByWindow: Map<MainWindow, ZoteroSelectionBinding>`. The
  binding is created in `openGraphWindow` after `installGraphTabHooks`, when
  the window has no binding yet, and disposed in `closeGraphForWindow`.
- One subscriber per window fans a published selection out over the
  window's live instances:
  - detached window: `controller.applyLibrarySelection(itemIDs)` now;
  - the selected tab: the same, now;
  - a hidden tab: `instance.pendingLibrarySelection = itemIDs`, replacing
    any earlier value. Only the latest set is ever applied.
- `GraphInstanceState.pendingLibrarySelection: number[] | null`. The
  existing `tab-selection-change` handler in `prepareContainer` applies and
  clears it when the tab becomes selected.
- Both render paths (`renderTab`, `renderDetachedWindow`) pass a new view
  option `onGraphSelection` and, once the view has mounted, apply
  `binding.current()` so a fresh graph reflects the list at once.
- `onGraphSelection(itemID)` calls `binding.selectListed([itemID])`. A null
  (graph deselected, or an external node) calls nothing: deselecting in the
  graph does not clear Zotero's list.
- `selectPaper` (double-click, Show in Zotero) is unchanged.

### View: `src/services/graphViewService.ts`

- New option `onGraphSelection?: (itemID: number | null) => void`.
- New controller method `applyLibrarySelection(itemIDs: readonly number[]): void`.
  It never throws; with no renderer it is a no-op.
- A private `syncing` flag. `handleGraphSelection` always updates the
  overview; when `syncing` is false it also clears `libraryEmphasisKeys`,
  applies emphasis, and calls `onGraphSelection` with the node's item ID for
  a local node and null otherwise.
- Resolution, factored into a pure helper so it is unit tested:

  ```ts
  export function resolveLibrarySelection(
    itemIDs: readonly number[],
    nodeKeyForItem: (itemID: number) => string | null,
    visibleKeys: ReadonlySet<string>,
  ): { select: string | null; emphasise: ReadonlySet<string> | null };
  ```

  Present means: `nodeKeyForItem` returns a key (the view passes
  `libraryNodeForItem`, which also looks up items not yet in the model) and
  the key is in `visibleKeys`. Items from another library resolve to null.
  One present key: `{ select: key, emphasise: null }`. Two or more:
  `{ select: null, emphasise: keys }`. None: `{ select: null, emphasise: null }`.

- Applying, all under `syncing = true`: `select` set means
  `renderer.selectNode(key, false)` then `renderer.panToNodeIfOffscreen(key)`;
  otherwise `renderer.clearSelection()`. `libraryEmphasisKeys` becomes
  `emphasise` and emphasis is applied.
- Emphasis ownership. The Key rail today sets emphasis on hover and sets
  null on leave, which would wipe a library emphasis. One private
  `applyEmphasis()` hands the renderer the rail's hover set while the rail
  is hovering, else `libraryEmphasisKeys`, else null. The two rail call
  sites route through it.
- `applyFilters` and the model resync drop keys that are no longer visible
  from `libraryEmphasisKeys`, as they do for the pinned set, so a node hidden
  by a filter is never left emphasised.

### Renderer: `src/services/citationGraphRenderer.ts`

One new method, `panToNodeIfOffscreen(key: string): void`. It projects the
node's position with `projectToScreen`, tests it against the canvas size
with a margin of one node radius, and if outside shifts `transform.x` and
`transform.y` by the minimum needed to bring it inside, then draws. The
scale is untouched. The arithmetic lives in a pure function
(`offscreenPanDelta(point, radius, width, height)`) so it is unit tested.

## Data flow

Zotero to graph:

1. The user selects rows. Zotero runs its own handler, then the binder's
   listener, which dedupes and echo-checks as above and publishes.
2. The window service applies to every detached window and the selected
   tab, and stores the set on each hidden tab.
3. When a hidden tab is switched to, its stored set is applied and cleared.

Graph to Zotero:

1. A click selects a node. `handleGraphSelection` runs with `syncing`
   false, clears the library emphasis and calls `onGraphSelection`.
2. The window service calls `selectListed`. The binder marks the ID as
   `mine` and selects the row if listed. Zotero fires `onSelect`; the
   binder recognises `mine` and does not publish.

The user's own interactions always win: a click in the graph replaces a
library emphasis with the graph's single selection; a click in the list
replaces the graph's selection with the list's.

## Error handling

Every Zotero call sits inside the binder's try/catch. A failure is
debug-logged and sync degrades to nothing; the graph keeps working. The view
shows no status message for sync, which is passive. A subscriber that throws
does not stop the others.

## Testing

- `test/unit/zoteroSelectionSync.test.ts` over a fake `ItemsTreeLike`:
  equal sets are not republished; an own `selectListed` echo is not
  published; a different set arriving after `selectListed` is published;
  a zero-row select clears `mine`; `dispose` removes the listener;
  a throwing subscriber does not stop the next; `current()` returns copies;
  a null tree at bind time is retried later.
- `test/unit/graphViewService.test.ts` (or the file that holds the view's
  pure helpers): `resolveLibrarySelection` for one, many, none, an item
  whose node is filtered out, and an unknown item.
- Renderer: `offscreenPanDelta` for a point inside, past each edge, and
  past a corner.
- Visual harness view 15 (`test/zotero`): render a view, call
  `applyLibrarySelection` with one, several and no IDs; assert the selected
  node, the emphasis, that the harness's `selected` log stays empty (no
  `onSelectPaper` from sync), and that a synthetic node click reports
  through `onGraphSelection` exactly once.
- `npm run check` is the gate.

## Manual walk-through in Zotero

1. Open a graph in a detached window with a few seeds. Click items in the
   library list: present nodes select and pan into view when off-screen;
   absent items do nothing. Select three items: present nodes emphasise,
   the overview empties. Click empty list space: everything clears.
2. Click a node in the detached window: the library row selects and
   scrolls into view; the library tab does not come to the front; the
   quick search, if any, stays. Apply a quick search that hides the item and
   click the node again: nothing changes in Zotero.
3. In a graph tab: select an item in the library, switch to the tab; the
   node is selected. Click another node, switch back; that row is selected.
4. Two detached windows: both follow the list.
5. Double-click a node: today's full jump still happens.

## Out of scope

- Selecting in Zotero from a multi-node graph selection (the graph has none).
- Any change to what the graph shows: no nodes are added by sync.
- Selection in the Zotero reader tab or the collection tree.
