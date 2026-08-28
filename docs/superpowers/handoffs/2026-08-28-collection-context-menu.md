# Handoff: folder support in the collection context menu

Date: 2026-08-28
Branch: `collection-context-menu` (off `main` at `9a166d1`)
Status: planned, implementation not started

## Where this came from

The session opened with a bug report: "the right-click menu shows Meristema
options when right-clicking everything." Investigation found the cause and, in
fixing it, turned up an unused function that makes the folder feature mostly
wiring. The user then asked for the folder feature, which was designed, specced
and planned. Nothing of the feature is implemented yet.

## Commits on the branch

| Commit | What |
| --- | --- |
| `cfa7af2` | Spec: `docs/superpowers/specs/2026-08-28-collection-context-menu-design.md` |
| `9b0dc61` | The bug fix (see below) |
| `ecbb832` | Plan: `docs/superpowers/plans/2026-08-28-collection-context-menu.md` |

Working tree is clean apart from an untracked `prefs.js` in the repo root — a
dev-profile artifact, not part of this work. It breaks `npm run check` at the
Prettier step, so run `npx eslint .` and `npm run typecheck` separately. Worth
gitignoring at some point; deliberately left alone here.

## The bug that was fixed (`9b0dc61`)

`menuService.ts` decided whether its entries applied by walking a chain of
candidates that ended in `ZoteroPane.getSelectedCollection()`,
`getCollectionTreeRow()` and `getSelectedItems()`. When the right-clicked row
was not a collection, or held no regular items, the chain fell through to
whatever happened to be selected *elsewhere* and reported the entries
available. That is why they appeared on My Library, Trash, Unfiled Items,
Duplicate Items, saved searches and group roots.

Zotero 9's `MenuManager` hands the right-clicked rows in on the menu context
(`context.items`, `context.collectionTreeRow`). That is authoritative; the
fallbacks were overriding it with unrelated state.

The fix reads only the context. It also deleted the collection menu outright —
it registered on every collection-tree row and did nothing when clicked — along
with the `collectionID` branches through the command context and the newly
orphaned `windowService.openGraphInView`.

**This fix is unverified in a running Zotero.** `eslint` and `tsc --noEmit` are
clean; no menu has actually been opened. Its manual check is folded into Task 4
of the plan (check 6).

## The key discovery

`windowService.openGraphForCollection()` (`src/services/windowService.ts:1194`)
already exists and has no callers. It is not item-ID expansion — it drives
`graphFilter.setCollectionID()`, the same live filter the graph's own dropdown
drives, and `collectionIDsForFilter()` expands it through
`includedCollectionIDs` so subcollections come along. The folder feature is
wiring around that function.

## Decisions the user made

- **Folders get the graph action only.** No Explore (focus) entry — a focus view
  is seeded by item IDs and would fire hundreds of provider calls for a large
  folder. No Refresh entry.
- **Collection filter, not item-ID expansion.** Consequences, both accepted
  deliberately: the scope is *live* (papers added to the folder later appear),
  and opening a folder in an existing graph *replaces* that graph's scope rather
  than merging into it. Hence the injected entries read `show this folder`, not
  the item menu's `add to graph`.

## What is left to do

Execute `docs/superpowers/plans/2026-08-28-collection-context-menu.md` — four
tasks, each with complete code in the plan:

1. Extract `contextRegularItems` and `contextCollectionID` into
   `src/services/menuContext.ts`; unit-test both in `test/architecture.test.ts`.
   The fake contexts deliberately carry a `ZoteroPane` offering the *wrong*
   answer, so a reintroduced fallback fails the test.
2. Widen two seams in `menuService.ts`: `isAvailable` back as a parameter on
   `contextCommandItem`, and `injectOpenViewItems` → generic `injectViewItems`.
   Pure refactor.
3. Register `collectionMenus()` on `main/library/collection`.
4. Verify in a running Zotero (six checks listed in the plan), then flip the
   spec's `Status:` to `implemented`.

Execution method chosen: subagent-driven development, one implementer subagent
per task with a review gate between each.

## Gotchas for whoever picks this up

- `npm test` is `zotero-plugin test` — it launches a real Zotero. `npm start`
  (`zotero-plugin serve`) needs a desktop session. If neither can run, say so
  and leave Task 4 outstanding rather than reporting the feature as working.
- Commit messages here are sentence-case descriptions of the behaviour change,
  no `feat:`/`fix:` prefixes. Copy the two trailer lines from
  `git log -1 --format=%B HEAD`.
- The `.ftl` files carry several dead strings (`open-command`,
  `update-library-command`, `provider-*`, `show-items-command`,
  `open-focus-view-command`) left over from earlier menu restructuring. Out of
  scope for this branch, but they are dead.
