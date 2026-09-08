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
