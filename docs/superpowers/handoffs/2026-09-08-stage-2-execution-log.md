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
