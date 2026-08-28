# Opening a folder in a Collection Graph

Date: 2026-08-28
Status: implemented

## Context

Right-clicking a folder in Zotero's collection tree should offer to open that
folder's papers in a Collection Graph. Today it offers nothing.

An earlier attempt did register a `main/library/collection` menu, and it failed
in both directions at once. It appeared on rows that are not folders — My
Library, Trash, Duplicate Items, Unfiled Items, saved searches, group roots —
because its `selectedCollection()` walked a chain of candidates that ended in
`ZoteroPane.getCollectionTreeRow()` and `getSelectedCollection()`. When the
right-clicked row was not a collection, the chain fell through to whatever
collection happened to be selected elsewhere and reported the menu available.
And when the entries were clicked they did nothing useful, because they resolved
the folder to a flat list of item IDs through a code path that never earned its
keep.

That registration and its supporting code were removed on 2026-08-28. This spec
restores the feature deliberately.

The important discovery from that removal: `windowService.openGraphForCollection()`
already exists, at `src/services/windowService.ts:1194`, and has no callers. It
is not a wrapper around item-ID expansion. It drives the graph's own collection
filter. That function is the feature; almost everything below is wiring.

## Scope

In scope: one action on a folder, opening it in a new Collection Graph, plus
adding it to an already-open Collection Graph.

Out of scope, deliberately:

- **Explore (focus) views.** A focus view is seeded by item IDs and fetches
  references and citing works online for each seed. A folder of 300 papers would
  mean hundreds of provider calls and an unreadable graph. It has no collection
  concept to re-scope, either.
- **Refresh.** Updating citation data for every paper in a folder is a long
  network job. It may be worth adding later, behind a confirmation showing the
  paper count; it is not part of this change.
- **Library-level rows.** "New Collection Graph" in the Tools menu already opens
  the whole current library.

## What counts as a folder

A row is a folder if and only if:

```
context.collectionTreeRow?.isCollection?.() === true
```

The collection ID is then read off `row.ref`. There is no fallback to the pane's selection,
no chain of alternative candidate keys, and no attempt to recover a collection
from a row that is not one. `Zotero.CollectionTreeRow` distinguishes
`isCollection()` from `isLibrary()`, `isSearch()`, `isTrash()`, `isDuplicates()`,
`isUnfiled()`, `isPublications()`, `isFeed()` and the rest, so every non-folder
row fails the predicate and the menu stays hidden.

This mirrors the item menu's `contextRegularItems()`, which reads `context.items`
and nothing else. The rule for both: **the menu context is the only source of
truth about what was right-clicked.** Reading the pane's selection to answer a
question about the right-clicked row is what produced the original bug.

Group libraries work without special handling — `libraryID` is derived from the
collection itself.

## Menu entries

Registered on target `main/library/collection`.

| Entry | acceltext | Action |
| --- | --- | --- |
| Open in New Collection Graph | `library only` | `openGraphForCollection(id, win, { newInstance: true })` |
| *(one injected per open map view)* | `show this folder` | `openGraphForCollection(id, win, { targetInstanceID })` |

The injected entries are built while the popup is showing, because the number of
open views is only known then — the same technique the item menu already uses.
Open **Explore** views are filtered out of that list: a focus view cannot be
re-scoped to a collection, so offering it would be a lie.

The label reuses the existing `show-items-new-tab-command` string, "Open in New
Collection Graph". It is accurate in both menus, so no new `.ftl` entry is added.
Reusing the ID also picks up its `library only` hint from `MENU_HINTS` for free.

## Behaviour

`openGraphForCollection` resolves the collection, derives `libraryID` from it,
and then either:

- re-scopes an already-open instance through `activateGraphCollection()` →
  `controller.openCollection(collectionID)`, or
- opens a new one with `request.collectionID`, which reaches
  `initialCollectionID` and calls the same controller method.

`openCollection()` exits any active focus projection, clears the map scope and
pins, then calls `graphFilter.setCollectionID(collectionID)` — the same filter
the graph's own dropdown drives. `collectionIDsForFilter()` in
`paperListViewService.ts` expands the ID through `includedCollectionIDs`, so
**subcollections are included**, and the filter button displays the folder name.

Two consequences worth stating explicitly, because they are the reason this
approach was chosen over expanding the folder to item IDs:

- **It is live.** A paper added to the folder in Zotero later appears in the
  graph. An item-ID snapshot would not.
- **It replaces rather than merges.** Opening a folder in an existing graph
  clears that graph's current scope. Hence `show this folder` as the acceltext,
  not the item menu's `add to graph`.

An empty folder opens an empty but correctly scoped graph. Hiding the entry for
empty folders would require loading a library snapshot inside a synchronous
`onShowing` handler, which is not possible; an empty graph with the folder's name
in the filter button is a clear enough result.

`openGraphForCollection` throws if the collection is unavailable. That is caught
by the existing `report()` helper and logged, as with every other menu command.

## Structure

`menuService.ts` gains a second context menu that shares a pattern with the first
but carries a different payload. Rather than the five-parameter
`contextMenus(resolve, isAvailable, refresh)` generic that the removed code used,
two narrower seams:

- `contextCommandItem(l10nID, isAvailable, run, onShown?)` — `isAvailable`
  returns to being a parameter. It was hardcoded to the item predicate when the
  collection menu was removed.
- `injectViewItems(context, views, hint, run)` — the XUL sibling-building block,
  taking a pre-filtered view list, one acceltext for all of them, and a per-view
  handler.

`itemMenus()` and `collectionMenus()` then read as short lists of literals. No
generic type parameters; net growth around 40 lines.

The two context predicates move to a new `src/services/menuContext.ts`:
`contextRegularItems(context)` and `contextCollectionID(context)`. They are pure
functions of a menu context, they are where the bug lived, and separating them
keeps `menuService.ts` about menu construction.

`contextCollectionID` returns the numeric ID rather than a `Zotero.Collection`.
`openGraphForCollection` looks the collection up itself, so returning the ID
keeps `menuContext.ts` free of every Zotero global and leaves both predicates
unit-testable against plain object literals.

## Testing

`menuContext.ts` is unit-tested in `test/architecture.test.ts` with hand-built
fake contexts. The cases are the regression suite for "the menu showed up on
everything":

- `contextCollectionID` returns the ID for a row whose `isCollection()` is true,
  and `null` for a library row, a saved-search row, a trash row, a duplicates
  row, an absent `collectionTreeRow`, and a row whose `ref` carries no usable
  ID.
- `contextRegularItems` returns only regular, non-trashed items; `[]` for a note,
  an attachment, a trashed paper, an empty array, and a missing `items` key.
- Neither function consults `ZoteroPane`. The fake contexts carry no pane, so a
  reintroduced fallback would throw or return a wrong answer rather than pass.

The graph-opening path needs a live Zotero window and stays outside automated
tests. Manual verification after implementation:

1. Right-click a folder → the entry appears; it opens a new graph scoped to that
   folder, filter button showing its name.
2. A folder with subcollections includes their papers.
3. Right-click My Library, Trash, Unfiled, Duplicate Items, a saved search and a
   group root → no Meristema entries on any of them.
4. With a Collection Graph open, right-click a different folder → the injected
   entry re-scopes that graph.
5. With an Explore view open, right-click a folder → the Explore view is not
   offered.
6. The item context menu is unchanged: entries on papers, nothing on notes or
   attachments.
