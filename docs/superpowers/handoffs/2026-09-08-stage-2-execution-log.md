# Stage 2 execution log: the Scope rail

One line per task of `docs/superpowers/plans/2026-09-08-graph-scope-rail.md`,
appended as it lands on branch `graph-scope-rail`. This file is the handoff:
nothing about a finished task is kept anywhere else.

- Task 1, b897e77: state version 2, its five new fields and the version 1
  migration; new pure `graphScopeModel.ts` (tick base/exceptions, cascade,
  descendant expansion, tri-state). `npm run check` green, 266 unit tests.
  Surprise: version 2's always-written `ticksNeedDescendants: false` made
  three existing deep-equal cases fail, so the round-trip literal, the
  savedGraphService seed helper and the "another version" literal (2 -> 4,
  since 2 is now current) were adjusted with it.
- Task 2, 5841af3: `computeGraphScope` — the visibility order as one pure
  function, plus the counts the rail prints. `npm run check` green, 275 unit
  tests. Surprise: the plan's own test asserted `shown === 4` for a case its
  own implementation scores 3 (an external paper no seed reached). The
  approved spec settles it — rule 2 admits **library** papers only, and Not
  in Zotero is rule 3, a removal — so the implementation stands verbatim and
  the test literal was corrected to 3 with a comment saying why.
- Task 3, 462e1bc: `graphScopeRailModel.ts` — the Scope section's rows as data
  (count line, Seeds heading, indented folder tree with counts, cascade ids
  and tri-state, Unfiled, Not in Zotero, hidden line). `npm run check`
  green, 283 unit tests. Surprise: the same four-paper fixture as Task 2, so
  the plan's "4 of 4 papers" expectation was corrected to "3 of 4 papers" for
  the same reason, with a comment pointing at Task 2's case.
- Task 4, 0ec0115: the projection carries `reachedBySeed`, plus pure
  `reachedKeysOf` and `additiveGraphModel`. `npm run check` green, 287
  unit tests. Two surprises: `focusGraphCacheService.cloneProjection` builds
  a projection literal the plan did not expect, so it deep-clones the new map
  too; and base edges are keyed `a>b` while projection edges are
  `a>b:focus`, so the merge's dedupe by `edge.key` cannot collapse a
  citation that both sides carry. Worth a look in the manual walk-through
  (doubled edge between two library papers a seed also reached).
- Task 5, 4b4052f: `seedColorAt` and `inLibraryRingColor` in the theme (with
  the new `inLibraryRing` token in both palettes and its custom property),
  and the renderer draws per-seed rings plus the in-library ring.
  `npm run check` green, 291 unit tests. Surprise: only two of the plan's
  lines needed rewrapping for `printWidth: 80`; the new token's two values
  are existing ramp stops, so the ring is not distinguishable from a
  ramp-coloured fill if a later stage needs that.
- Task 6, fd5019c: the rail grows a Scope section — its own host, seed rows with
  bullseye and remove, the folder tree, Unfiled, Not in Zotero, hidden line,
  Add seed, and a 132-line CSS block with no colour literals. One emphasis
  channel now carries `{ kind: "key" | "scope" }`. `npm run check` green,
  291 unit tests. Surprise: `test/zotero/graphVisual.test.ts` also builds a
  KeyRail, so `tsc -p test` forced the same signature fix there; the plan's
  file list did not mention it. Scope handlers are no-ops until Task 8.
- Task 7, b421a00: the focus projection is retired — `applySeedProjection`
  merges instead of replacing, `clearSeeds` replaces `exitFocus`, the four
  stash variables are gone, and `applyFilters` is now `computeGraphScope`.
  D1 is answered in code. `npm run check` green, 291 unit tests; Step 8's
  `npm test` deferred to the batch after Task 13, per the run's protocol.
  Three deviations: `collectionScopeIDs` returns a Set so it is spread into
  `onlyCollectionsTicked`; `mapScopeItemIDs`/`mapPinnedItemIDs` still
  have live callers and stay until Task 11 deletes them (as Task 11's brief
  expects), though `applyFilters` no longer consults them, so "Show in graph
  (replace)" stops narrowing the graph; and `lastScope` carries an eslint
  disable comment until Task 8 reads it — Task 8 must remove it.
- Task 8, f89c1ae: the Scope rail is live — `refreshScopeRail` draws from
  `lastScope`, the checkboxes cascade through `setCollectionTicks`, seed
  rows remove and hover, and one emphasis channel serves key, seed and
  collection rows. `npm run check` green, 291 unit tests. Notes: `addSeed`
  inlines the toolbar button's popover body until Task 9 replaces both with
  `openFocusSeedPopover` (the row's anchor is unused until then), and
  Scope draws through `refreshKeyRail`, so it needs a renderer.
- Task 9, 8445812: the seed panel opens from the rail's + Add seed through one
  `openFocusSeedPopover`; the toolbar's Seeds button and its swinging label
  are deleted, and the popover's rows lose the `!important` chain for
  `.meristema-root`-scoped rules. `npm run check` green, 291 unit tests.
  Notes: Escape now returns focus to the rail's anchor; the two one-property
  title/meta rules were kept, since the replacement block carries no
  `font-weight`/`color`, and `.cm-focus-seed-menu .cm-toolbar-button` is
  now dead CSS the plan did not list for deletion.
- Task 10, cb70343: Remove from graph replaces Explore from this paper in the
  node menu, the row action and the detail pane; pure `purgeHiddenKeys`
  spends a hide when the paper is seeded. That is D2. "view 12" updated in
  the same task. `npm run check` green, 293 unit tests. Surprise:
  `focusOnPaper` was the only caller of the single-seed `enterFocus`
  wrapper, so that went too — `enterFocusSeeds([node], options)` replaces
  it if a later stage wants one.
- Task 11, 6e489ff: the item scope, its pinned set and the whole show path are
  deleted; every added paper is a seed, and the filter popover loses its
  folder list. `npm run check` green, 290 unit tests (three architecture
  cases went with the deleted helpers). Surprises: the plan's grep expected
  no live callers of `openGraphAndSelectItems`, but `menuService.ts` had
  two — bridged to the seed functions, which is Task 13's premise anyway —
  and `itemPaneService.ts` had one, in an overview whose "Graph" and
  "Explore" buttons now do the same thing, so "Graph" was deleted. No task
  owns that file; the surviving button still says "Explore", which Stage 2
  otherwise retires. Worth a look in the walk-through, and it may change the
  known "view 10" failure, which was about that overview offering two
  actions.
