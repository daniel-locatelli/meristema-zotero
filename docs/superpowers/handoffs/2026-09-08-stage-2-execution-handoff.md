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

## Time-sensitive, and not Stage 2

The user applied for a Semantic Scholar API key on 2026-09-08. Checking the
code against the application's checkboxes turned up two things, filed as
backlog **B9** and **B10** and listed in Filler above:

- **B9, before the key arrives.** `providerExecutionPolicy.ts` treats a key as
  permission to speed up: keyless is 1 request in flight at ≥1100 ms apart,
  keyed is `requestParallelism: 2` at `minimumStartDelayMs: 150`, about six or
  seven requests a second. The standard authenticated plan is one per second.
  Nothing is wrong today; it goes wrong the moment the key is pasted in. Do
  this one **before** that happens.
- **B10, to match a commitment already made.** `http.ts` has
  `RETRY_DELAYS_MS = [1500]`: one retry, fixed, no backoff. The user ticked
  the application's "I will apply exponential backoff" box, so the code should
  match. `Retry-After` handling and the 15 s abandon rule are deliberate and
  stay.

Both are small and independent of Stage 2. One plan covers them, and if the
key arrives mid-Stage-2 they are worth interrupting for — B9 especially, since
its cost is 429s for the key's owner.

## Unexplained, worth a glance

Partway through this session, nineteen tracked files under
`docs/superpowers/plans/` and `docs/superpowers/specs/` — everything dated
2026-09-06 or earlier, plus three 2026-09-07 specs — showed as deleted in the
working tree. No delete was run from this session. They were restored with
`git checkout --` and the tree is clean. If it happens again, find out what is
touching the repo.
