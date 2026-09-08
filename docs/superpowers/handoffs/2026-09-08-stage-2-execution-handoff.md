# Handoff: Stage 2 is planned; execute it next

Written 2026-09-08, end of session. Read
`docs/superpowers/handoffs/2026-09-08-roadmap.md` first, as always. This file
says only what to pick up and what not to re-open.

## Where things stand

Stage 2's spec and plan boxes are both ticked. The plan is
`docs/superpowers/plans/2026-09-08-graph-scope-rail.md`, fifteen tasks against
the approved spec `2026-09-08-graph-scope-rail-design.md`. Both are on `main`
at `a7d8e1c`; the branch `graph-scope-rail` sits at the same commit and
nothing is pushed.

## Start here

The next unticked box is **Stage 2, implemented, reviewed, merged, XPI built,
pushed**. Check out `graph-scope-rail` and run the plan with
`superpowers:subagent-driven-development` — a fresh subagent per task, review
between — or `superpowers:executing-plans` inline. Tick the box and commit the
tick with the work.

Do not re-open the design. The spec's eight decisions and the plan's task
order are both settled.

## What the plan's order depends on

- **Task 1 is first for a reason.** `parseGraphViewState` returns `null` for
  any version it does not know, so version 2 without its migration destroys
  every saved graph. Do not reorder it behind anything.
- **Tasks 2 to 6 are pure modules and marks.** They are independent of each
  other and safe to hand to parallel subagents; 7 onwards touch
  `graphViewService.ts` and must run in order, one at a time.
- **Task 7 is the one that answers D1** and is where the churn is. It renames
  `applyFocusProjection` to `applySeedProjection` and `exitFocus` to
  `clearSeeds`, and deletes the four stash variables. Let `tsc` name the call
  sites rather than guessing at them.

## Two calls made while planning, so they are not re-litigated

- **The migration flag.** `parseGraphViewState` has no folder tree and must
  not acquire one, so a migrated recipe carries a non-persisted
  `ticksNeedDescendants`, stripped by `serializeGraphViewState`, and the view
  expands the ticks once. Expanding unconditionally would resurrect a child
  unticked under a ticked parent; not expanding would open every saved folder
  graph smaller than it was saved.
- **The in-library ring.** "A brighter tint of its own fill" needs colour
  maths, so `inLibraryRingColor` brightens `#rrggbb` fills and falls back to a
  new theme token for anything else. The no-colour-literals-outside-
  `graphTheme.ts` rule still holds.

## Watch these

- `npm run check` is the gate for every task. `npm test` may be run; the three
  known failures on `main` — "view 10", "view 15", and `savedGraphMenu.test.ts`
  "lists the saved graphs on the first showing" — are not regressions and are
  not fixed here.
- Task 10 changes the node menu, so `test/zotero/graphViewVisual.test.ts`
  "view 12" needs its expectations updated in that same task.
- Task 15 appends eight manual checks to the roadmap's batch. The last of them
  — a graph saved before this release opening on the same papers — is the one
  that matters most, because it is the one that would lose the user's work.

## Unexplained, worth a glance

Partway through this session, nineteen tracked files under
`docs/superpowers/plans/` and `docs/superpowers/specs/` — everything dated
2026-09-06 or earlier, plus three 2026-09-07 specs — showed as deleted in the
working tree. No delete was run from this session. They were restored with
`git checkout --` and the tree is clean. If it happens again, find out what is
touching the repo.
