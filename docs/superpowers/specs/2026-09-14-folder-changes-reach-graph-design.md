# Folder changes reach the graph (B58)

Written 2026-09-14 on `main` at 9a0f1ac. Resolves backlog B58, "a folder
renamed in Zotero keeps its old name in the graph until Zotero restarts",
and settles the design question the entry left open: whether a rename drops
the whole library snapshot or only relabels.

## The complaint

"I updated a folder name in Zotero, but the graph did not pick the change.
Even after clicking Refresh at the top. Even new graphs don't pick the
renames. It only works once I close and open Zotero."

## What the code does today

Folder names are read live from `Zotero.Collections`, but only inside
`buildWholeLibrarySnapshot` (`zoteroLibraryService.ts`), whose result is a
process-wide cache. That cache is invalidated from one place, the notifier
in `hooks.ts`, which observes `["item"]` alone. A folder change fires a
`collection` notification that nothing observes.

That explains all three symptoms, and the gap is wider than renames:
creating, moving or deleting a folder is equally unseen.

- A new graph reads the same cached snapshot, so it shows the old name.
- An open graph builds its folder lookups once, at mount —
  `collectionLabels` and `descendantsByID` in `renderGraphView`, the second
  under a comment saying "the snapshot's folders never move". Invalidating
  the cache alone would therefore still leave an open tab stale.
- The toolbar's Refresh re-reads citation data and rebuilds the citation
  graph from the snapshot the view already holds. It never reloads folders.

Nothing persisted is stale. Saved graphs store folder IDs, never names, so
the old name lives only in memory.

## The decision

Asked with four options on 2026-09-14, the user chose **relabel in place**:
a folder change rebuilds only the folder list, and open graphs adopt it
without remounting.

The rejected options, and why:

- **Drop the whole snapshot on a folder change** (the entry's narrow fix).
  The next graph re-reads every paper to pick up one label, and open tabs
  stay stale.
- **Drop the snapshot and remount open graphs**, as item removal does
  through `refreshOpenGraphViews`. `renderTab` captures state and remounts
  the view, which is a reopen; by B55 a reopen restarts a stopped hop fill.
  A rename should not start fetching.
- **Rebuild folders in the cache only.** New graphs are right, but an open
  tab waits for a reopen, and Refresh still does not help — which was part
  of the complaint.

## The design

### Library side

`zoteroLibraryService.ts` gains `refreshSnapshotFolders(snapshot)`. It re-runs
the existing `collectionFilters(snapshot.libraryID, snapshot.papers)` and
replaces `snapshot.collections` with the result. No paper is re-read; the
cost is one walk of `Zotero.Collections` for the library. The function is
idempotent and safe to call on any snapshot, cached or not.

### The observer

The snapshot observer in `hooks.ts` registers for `["item", "collection"]`.
The item branch is unchanged. On any `collection` notification (add,
modify, move, delete, trash), it:

1. calls `refreshSnapshotFolders` on every cached library snapshot — at most
   two (`MAX_CACHED_LIBRARY_SNAPSHOTS`) — rather than resolving the folder's
   library, since a deleted folder may no longer be there to ask;
2. publishes the change (below).

`automaticUpdateCoordinator.ts` is **not** changed, although the B58 entry
named it. Its observer queues citation fetches for changed items; a folder
change there would start network work on a rename.

The service exports a small accessor for the cached snapshots so the
observer does not reach into the cache's maps.

### The event

A new module, `libraryFolderEvents.ts`, in the shape of
`relationshipEvents.ts` but without its batching:

- `publishLibraryFoldersChanged(): void`
- `subscribeLibraryFoldersChanged(listener: () => void): () => void`

The event carries no payload. Every open view refreshes its own snapshot's
folders, which is cheap, so there is nothing to filter on.

A listener that throws is logged with `Zotero.debug` and does not stop the
others, as in `relationshipEvents.ts`.

### The open graph

`renderGraphView` subscribes on mount and unsubscribes in its cleanup,
beside `unsubscribeRelationshipPublications`. On the event, unless the view
is already cleaned up, it:

1. calls `refreshSnapshotFolders(snapshot)` on the snapshot it holds. That
   object may be older than the cached one if the cache was rebuilt after an
   item change since the view mounted, so refreshing the cache is not enough;
2. refills `collectionLabels` and `descendantsByID` in place — clear, then
   set from the new list. The renderer holds `collectionLabels` by reference
   and reads it live for region legends, so it sees the new labels without
   being told. The "never move" comment is corrected;
3. sets `regions = regionsStillInLibrary(regions, snapshot.collections)`, so
   a deleted folder's region goes the moment the folder does, as B23 already
   does on reopen;
4. calls `applyFilters()`, then the existing `refreshScopeRail()`, which also
   pushes the regions to the renderer.

It never remounts and never touches the hop fill. It does the work whether
or not the view is active: it is a rail redraw, not a render.

**Ticks are left as stored.** A folder created later follows the graph's
base, as the comment on `collectionTicks` in `renderGraphView` already
says: ticked in a library graph (base
`all`), unticked in a folder graph (base `none`). A folder moved under a
ticked parent in a folder graph therefore shows its parent as mixed rather
than silently joining the scope, for the same reason.

The paper detail's folder chooser and the manual relationship picker take
`snapshot.collections` when they open, so one opened after the change shows
the new list without any change to them; one already open keeps the list it
was given until it closes.

Refresh is not changed. After this, a folder change no longer needs it.

## Not in scope

- **A folder graph's tab title** is taken from the folder name at open
  (`multiCollectionGraphTitle`) and keeps the old name. Retitling a tab the
  user may have renamed is a separate question; file it if it is wanted.
- **A snapshot load in flight** during a folder change may resolve with the
  old folders. The build reads folders after every paper, so the window is
  a few milliseconds; the next folder change or item change corrects it.

## What only Zotero can answer

These are settled in the Zotero suite, with the evidence in assertion
messages, not assumed here:

- whether deleting a folder also fires `item` notifications for its papers.
  If it does, the item branch drops the snapshot as well, which is correct
  and only heavier. If it does not, `paper.collectionIDs` keeps the deleted
  ID, which is harmless: `collectionFilters` skips an ID
  `Zotero.Collections.get` no longer resolves, and no rail row or region
  refers to it;
- whether `Zotero.Collections.getByLibrary` leaves out a folder in Zotero's
  trash. If it does not, `collectionFilters` must filter `deleted` itself;
- what `extraData` a `collection` notification carries. The design does not
  depend on it.

## Testing

**Unit** (`test/unit`): `refreshSnapshotFolders` over a stubbed
`Zotero.Collections`, covering a rename (the name and `path` change, and a
child's `path` with it), a move (`parentCollectionID`, `depth` and the old
and new parents' `includedCollectionIDs`), and a delete (the entry goes).
The event module: a subscriber is called, an unsubscribed one is not, and a
throwing one does not stop the next.

**Zotero suite** (`test/zotero`), driven through the plugin's own menus as
`graphScopeRail.test.ts` is, since the test bundle is a second copy of the
plugin:

1. Make a fixture folder with a paper in it and open a graph on it from the
   plugin's menu.
2. Rename it with `collection.name = …; await collection.saveTx()`. The
   Scope rail row shows the new name without a reopen.
3. Open a second graph. It shows the new name too.
4. Draw the folder as a region, then delete the folder. The region and the
   row both go, and the graph did not remount (a marker set on the mounted
   root survives).
5. Record whether the delete fired `item` notifications and whether a
   trashed folder is listed, in assertion messages.

**Manual check** for the next batch: with a graph open on the real library,
rename a folder in Zotero's collection tree. The rail shows the new name at
once, a stopped fill stays stopped, and a new graph shows the new name.
