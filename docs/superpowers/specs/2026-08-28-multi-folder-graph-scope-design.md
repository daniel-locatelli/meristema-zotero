# Scoping a Collection Graph to several folders

Date: 2026-08-28
Status: designed

## Context

`collection-context-menu` shipped the folder context menu. Right-clicking one
folder offers "New PhD Graph", and each open Collection Graph offers "Show in
PhD Graph". Selecting several folders and right-clicking offers nothing.

That gap was deliberate but not satisfying. The reason it was left open is
structural rather than cosmetic: the graph's collection filter holds exactly one
collection.

- `PaperListFilterState.collectionID` is `number | null`
  (`src/services/paperListViewService.ts:46`).
- The filter menu's Collection control is a single `<select>`
  (`src/services/paperListViewService.ts:815`).
- `collectionIDsForFilter()` expands that one collection to itself plus its
  descendants, and `matches()` keeps a paper whose `collectionIDs` intersect
  that set (`:1089`, `:1101`).
- `PaperFilterController.setCollectionID(number | null)` is the only way in,
  with five callers in `graphViewService.ts`.

So "add this folder too" cannot be expressed. The same limit is why the folder
menu's existing-graph entry says "Show in PhD Graph" and not "Add to PhD Graph":
a second folder displaces the first.

One thing this is *not*: a persistence problem. The collection filter is never
written to `tab.data` — the tab stores only `graphInstanceID`, `graphTitle`,
`graphKind` and friends (`src/services/windowService.ts:966`), and
`pendingCollectionID` is transient in-memory state consumed on open. There are
no saved graphs in the wild carrying a single collection ID that would need
migrating.

## Decision

The graph's collection scope becomes a **set of folders**, and every layer that
carries one collection carries a list instead.

`PaperListFilterState.collectionID: number | null` becomes
`collectionIDs: number[]`. **An empty list means the whole library** — the same
meaning `null` carried before, with one fewer state to reason about.

Membership is a **union**: a paper is in scope when it belongs to any selected
folder or any of that folder's descendants. This follows from what the feature
is for. Selecting PhD and Reading asks for both bodies of work in one graph, not
for the papers filed in both at once, which is usually empty.

The scope stays **live**. It remains the same collection filter the graph's own
dropdown drives, so papers added to any selected folder appear in the graph
without reopening it. That is the property that made the single-folder path
worth building, and the reason the cheaper item-ID snapshot was rejected: it
would have made one folder behave differently from three.

### What the user sees

- Right-clicking three selected folders offers **"New Graph from 3 Folders"**,
  and each open Collection Graph offers **"Show 3 folders in PhD Graph"**.
  One folder keeps its existing wording exactly.
- The graph's filter menu Collection control becomes multi-select. Selecting
  nothing means the whole library.
- A graph opened from several folders is titled **"PhD +2 Graph"** — named after
  the first folder, with a count of the rest, so the tab stays readable.

### Deliberate exclusions

- **A mixed selection is not a folder selection.** If any selected row is not a
  collection — My Library, Trash, Unfiled Items, a saved search, a group root —
  the menu offers nothing, rather than silently graphing the collections in the
  selection and ignoring the rest. This keeps the rule the user learned in the
  single-row case: the entry appears when what you right-clicked is folders.
- **Explore (focus) views remain out.** Unchanged from the previous spec: a
  focus view is seeded by item IDs and has no collection to re-scope.
- **The filter button keeps its count, not the folder names.** It reads
  "Filter papers (1 active)" today and continues to; the collection dimension is
  one active filter whether it holds one folder or five.
- **"Add to" still does not appear on the menu.** With a set scope it becomes
  expressible, but the folder menu's job is to say what the graph will show. A
  separate "add" verb alongside "show" doubles every entry for a gain that is
  better judged after this ships.

## Consequences

The awkward part is `graphViewService.ts:3697`. When a focus projection is open
and a collection filter is set, external neighbours — papers not in Zotero, so
in no collection — would be filtered out. The code exempts them by fabricating a
descriptor that claims membership of the active collection. With a set, that
becomes claiming membership of the first selected folder. It is the faithful
translation and preserves today's behaviour exactly, but it is a hack inherited,
not a hack introduced, and the final review should look at it.

Everything else is mechanical: one filter state field, one control, one
predicate, five call sites, the menu predicate, and the title rule.
