# Multi-folder Collection Graph scope — implementation plan

**Goal:** A Collection Graph can be scoped to several folders at once, live, and
the folder context menu offers that when several folders are selected.

**Spec:** `docs/superpowers/specs/2026-08-28-multi-folder-graph-scope-design.md`

**Architecture:** One state change propagates outward.
`PaperListFilterState.collectionID: number | null` becomes
`collectionIDs: number[]`, empty meaning the whole library. The predicate that
already builds a `Set` of allowed collection IDs unions several folders instead
of expanding one. Everything above it — the filter control, the five
`setCollectionID` callers, the pending-request plumbing, the menu predicate and
the title rule — follows.

**Tech Stack:** TypeScript, Zotero 9 `MenuManager`, XUL/HTML filter menu,
Mocha + Chai via `zotero-plugin test`.

## Global constraints

- Branch `multi-folder-graph-scope`, based on `5b24544`.
- Empty list means whole library. There is no second "no filter" representation;
  do not reintroduce `null` alongside it.
- The scope stays live. Nothing in this plan may resolve folders to item IDs.
- `npm run check` is unusable (Prettier fails on an untracked `prefs.js`). Run
  `npx prettier --check <touched files>`, `npx eslint .` and `npm run typecheck`
  separately. Prettier cannot parse `.ftl`; do not pass it one.
- `npm test` launches the real Zotero and takes minutes. Only one scaffold
  process may drive Zotero at a time.
- Commit messages: sentence-case subject, no `feat:`/`fix:` prefixes, ending with
  the two trailers from `git log -1 --format=%B HEAD`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/services/paperListViewService.ts` | Filter state, the union predicate, the multi-select control, `setCollectionIDs`. |
| `src/services/graphViewService.ts` | Five call sites, the focus exemption, `openCollections`. |
| `src/services/windowService.ts` | `pendingCollectionIDs`, the request field, `openGraphForCollections`, the title. |
| `src/services/graphInstancePolicy.ts` | The multi-folder title rule. |
| `src/services/menuContext.ts` | `contextCollectionIDs` — all right-clicked folders. |
| `src/services/menuService.ts` | Menu wiring and labels. |
| `addon/locale/en-US/mainWindow.ftl` | The plural label. |
| `test/architecture.test.ts` | Unit tests for every pure seam above. |

---

## Task 1: Widen the filter state to a set of folders

The core change. Nothing above it moves yet beyond keeping the build green.

**Files:** `src/services/paperListViewService.ts`, `test/architecture.test.ts`

- [ ] **Step 1: Write the failing tests**

Test the union predicate directly. It is the whole feature in one function:
a paper in any selected folder or any descendant is in scope; an empty list
admits everything; a paper in none of the selected folders is excluded.

- [ ] **Step 2: Change the state and the predicate**

`PaperListFilterState.collectionID: number | null` →
`collectionIDs: number[]`. `defaultFilterState()` returns `[]`.
`activeFilterCount()` counts the dimension when the list is non-empty.
`collectionIDsForFilter(collectionIDs: readonly number[]): Set<number>` unions
each folder's `includedCollectionIDs` (falling back to the folder itself).
`matches()` skips the dimension when the list is empty.

- [ ] **Step 3: Rename the entry point**

`PaperFilterController.setCollectionID(number | null)` becomes
`setCollectionIDs(readonly number[])`, normalising to unique positive integers.
Update the five callers in `graphViewService.ts` mechanically — a single ID
becomes a one-element array, `null` becomes `[]`. Behaviour is unchanged at
this point.

- [ ] **Step 4: Make the Collection control multi-select**

The `<select>` at `:815` gains `multiple`, drops the "Whole library" option, and
its label becomes "Collections". `commitCollection` reads every selected option.
Empty selection means the whole library, stated in the control's help text.

- [ ] **Step 5: Verify**

`npx prettier --check` on the touched files, `npx eslint .`,
`npm run typecheck`, then `npm test`.

- [ ] **Step 6: Commit**

---

## Task 2: Carry a set of folders through to opening a graph

**Files:** `src/services/windowService.ts`, `src/services/graphViewService.ts`,
`src/services/graphInstancePolicy.ts`, `test/architecture.test.ts`

- [ ] **Step 1: Write the failing title test**

`multiCollectionGraphTitle(names)` — one name gives "PhD Graph" (delegating to
`collectionGraphTitle`), several give "PhD +2 Graph", none gives null, and
blank names are ignored rather than counted.

- [ ] **Step 2: Add the title rule**

In `graphInstancePolicy.ts`, beside `collectionGraphTitle`.

- [ ] **Step 3: Thread the list through**

`PendingGraphRequest.collectionID` → `collectionIDs: number[]`;
`GraphInstanceState.pendingCollectionID` → `pendingCollectionIDs: number[]`;
`GraphViewController.openCollection(id)` → `openCollections(ids)`;
`openGraphForCollection(collectionID, …)` → `openGraphForCollections(collectionIDs, …)`.
The new view's `titleBase` comes from `multiCollectionGraphTitle`.

`activateGraphCollection` compares sets rather than a single ID when deciding
whether an open graph already shows the requested scope.

- [ ] **Step 4: Translate the focus exemption**

At `graphViewService.ts:3697`, the fabricated descriptor claims membership of
`collectionIDs[0]` instead of `activeCollectionID`. Preserve today's behaviour;
do not redesign it here. Leave a comment saying it is inherited.

- [ ] **Step 5: Verify and commit**

---

## Task 3: Offer several folders in the context menu

**Files:** `src/services/menuContext.ts`, `src/services/menuService.ts`,
`addon/locale/en-US/mainWindow.ftl`, `test/architecture.test.ts`

- [ ] **Step 1: Write the failing predicate tests**

`contextCollectionIDs(context): number[]` — every selected row must be a
collection with a usable ID. One folder gives one ID. Three give three, in
selection order. A mixed selection (a folder plus Trash, a library root, a
saved search) gives `[]`, not the folders it could find. No rows give `[]`.
The singular `collectionTreeRow` fallback for older builds still works.
`contextCollectionID` is replaced by this, not kept alongside it.

- [ ] **Step 2: Implement the predicate**

- [ ] **Step 3: Update the menu**

`collectionMenus()` uses the list. The label carries a count so Fluent can
select the plural form:

```
collection-new-graph-command =
    .label = { $count ->
        [1] New { $graph }
       *[other] New Graph from { $count } Folders
    }
```

The injected entries read `Show in <graph>` for one folder and
`Show N folders in <graph>` for several, built in JS as they are today.

- [ ] **Step 4: Verify and commit**

---

## Task 4: Verify in a running Zotero and close the spec

None of Tasks 1–3 opens a menu or draws a graph. This is the only evidence the
feature works.

- [ ] **Step 1: `npm start`**

- [ ] **Step 2: Walk the checklist**

Record the actual result of each, not the expected one.

1. Select two folders with different papers, right-click → "New Graph from 2
   Folders". The graph contains the papers of both.
2. That graph's filter menu shows both folders selected in the Collection
   control, and the filter button reads one active filter.
3. Add a paper to one of those folders in Zotero → it appears in the open graph
   without reopening it. **This is the live-scope claim; do not skip it.**
4. Select three folders where one has subcollections → the subcollections'
   papers are included.
5. Select a folder *and* Trash (or My Library) → **no** Meristema entry.
6. With that graph open, select two different folders and right-click → "Show 2
   folders in PhD +1 Graph"; clicking re-scopes the open graph rather than
   opening a tab.
7. Single-folder behaviour is unchanged: "New PhD Graph", tab titled
   "PhD Graph", "Show in PhD Graph" on an open graph.
8. Deselect everything in the filter menu's Collection control → the graph shows
   the whole library.
9. The item context menu is unchanged: three entries on a paper, none on a note
   or an attachment.

- [ ] **Step 3: Flip the spec to `implemented`** — only if all nine passed. If
  one failed, leave it `designed`, write down what actually happened, and stop
  for review rather than patching blind.

- [ ] **Step 4: Commit, then report which checks were run and by whom.**
