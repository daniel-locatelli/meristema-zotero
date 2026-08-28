# Handoff: folder support in the collection context menu

Date: 2026-08-28 (updated after Task 2)
Branch: `collection-context-menu` (off `main` at `9a166d1`)
Status: Tasks 1 and 2 done and reviewed. Task 3 next. Task 4 needs a human at a
desktop.

## Where this came from

The session opened with a bug report: "the right-click menu shows Meristema
options when right-clicking everything." Fixing it turned up an unused function
that makes the folder feature mostly wiring. The feature was then designed,
specced, planned, and is now half implemented.

## Commits on the branch

| Commit | What |
| --- | --- |
| `cfa7af2` | Spec |
| `9b0dc61` | The visibility bug fix |
| `ecbb832` | Plan |
| `d04e097` | This handoff, first version |
| `ad2e543` | **Task 1** — `menuContext.ts` + regression tests |
| `f09b911` | **Task 2** — widened the two menu seams |
| `d690cce` | Test harness fix (out of plan, see below) |

Working tree clean apart from an untracked `prefs.js` at the repo root — a
dev-profile artifact, not part of this work. It breaks `npm run check` at the
Prettier step, so run `npx eslint .` and `npm run typecheck` separately, plus
`npx prettier --check` on the files you touched. Worth gitignoring some day.

## Read these first

- Spec: `docs/superpowers/specs/2026-08-28-collection-context-menu-design.md`
- Plan: `docs/superpowers/plans/2026-08-28-collection-context-menu.md`
- Progress ledger: `.superpowers/sdd/progress.md` — the authoritative record of
  which tasks are done. Trust it and `git log` over anything else, including
  this file.

## The test harness bug (`d690cce`) — read this before running anything

`zotero-plugin test` defaults to watch mode. It runs the suite, prints the
results, and then sits there with Zotero open, watching for file changes. **The
process never exits**, so `npm test` never returns and the only way to end a run
was to close Zotero by hand.

Setting `test.watch` in `zotero-plugin.config.ts` does **not** fix it. The CLI
computes `watch: !options.exitOnFinish && options.watch` and passes it as an
override on every invocation; commander defaults `options.watch` to true, so the
config value is always discarded. The flag is the only lever.

`npm test` is now `zotero-plugin test --no-watch` and exits on its own — measured
at reported-and-exited within the same second, Zotero cleaned up behind it.
`npm run test:watch` keeps the old loop for interactive work.

This also explains something that looked like agent misbehaviour: Task 1's
implementer stalled twice waiting on its own test run. It was parked on a command
that genuinely never returns.

A run takes several minutes and launches the real Zotero desktop app. Only one
scaffold process can drive Zotero at a time, so runs must be serialised — never
start a second while one is going.

## The bug that was fixed (`9b0dc61`)

`menuService.ts` decided whether its entries applied by walking a chain of
candidates ending in `ZoteroPane.getSelectedCollection()`,
`getCollectionTreeRow()` and `getSelectedItems()`. When the right-clicked row was
not a collection, or held no regular items, the chain fell through to whatever
happened to be selected *elsewhere* and reported the entries available — hence
their appearing on My Library, Trash, Unfiled, saved searches and group roots.

Zotero 9's `MenuManager` hands the right-clicked rows in on the menu context
(`context.items`, `context.collectionTreeRow`). That is authoritative; the
fallbacks were overriding it. The fix reads only the context, and deleted the
collection menu outright — it registered on every row and did nothing when
clicked.

**Still unverified in a running Zotero.** Its manual check is Task 4, check 6.

## The key discovery

`windowService.openGraphForCollection()` (`src/services/windowService.ts`)
already existed with no callers. It is not item-ID expansion — it drives
`graphFilter.setCollectionID()`, the same live filter the graph's own dropdown
drives, and `collectionIDsForFilter()` expands it through `includedCollectionIDs`
so subcollections come along. The folder feature is wiring around it.

## Decisions the user made

- **Folders get the graph action only.** No Explore entry — a focus view is
  seeded by item IDs and would fire hundreds of provider calls for a large
  folder. No Refresh entry.
- **Collection filter, not item-ID expansion.** Two accepted consequences: the
  scope is *live* (papers added to the folder later appear), and opening a folder
  in an existing graph *replaces* that graph's scope rather than merging. Hence
  the injected entries read `show this folder`, not `add to graph`.

## What is done

**Task 1 (`ad2e543`)** — `src/services/menuContext.ts` holds `contextRegularItems`
and `contextCollectionID`, pure functions of a menu context with no Zotero
globals. 85 lines of regression tests in `test/architecture.test.ts`; the fake
contexts deliberately carry a `ZoteroPane` offering the *wrong* answer, so a
reintroduced fallback fails the test. 65/65 passing, independently confirmed.
Review clean.

**Task 2 (`f09b911`)** — `contextCommandItem` regained its `isAvailable`
parameter; `injectOpenViewItems` became a general
`injectViewItems(context, views, hint, run)`. Item menu behaviour unchanged.
Review clean, including an independent check that the deliberate
`clear()`-before-early-return reordering is correct: the old code left stale
injected entries in the DOM on a reopen with no views, and re-armed no listener
to remove them.

## What is left

**Task 3** — add `collectionMenus()` and register it on `main/library/collection`,
routing through `openGraphForCollection`, with open Explore views filtered out of
the injected list. Complete code is in the plan. Base is `d690cce`.

**Task 4** — the six manual checks in a running Zotero (`npm start`), then flip
the spec's `Status:` to `implemented`. This is the *only* evidence the feature
works: Tasks 2 and 3 touch XUL menu glue that the automated suite does not
exercise at all. Do not report the feature as working on the strength of a green
`npm test`.

Then: final whole-branch review, then `superpowers:finishing-a-development-branch`.

## Open question for Task 4

Zotero's `MenuManager` may or may not call `onShowing` more than once per popup
show — not determinable from static reading. If it can, `injectViewItems` queues
more than one `popuphidden` listener per show. Each is a harmless no-op `clear()`,
so this is not a leak, but watch for duplicated menu entries during the manual
check.

## Conventions

Commit messages are sentence-case descriptions of the behaviour change, no
`feat:`/`fix:` prefixes. Copy the two trailer lines from
`git log -1 --format=%B HEAD`.

The `.ftl` files carry dead strings (`open-command`, `update-library-command`,
`provider-*`, `show-items-command`, `open-focus-view-command`) left from earlier
menu restructuring. Out of scope here, but they are dead.
