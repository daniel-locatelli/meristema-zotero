# Handoff: Stage 2 stopped after Task 13, on four new Zotero failures

Written 2026-09-08. Read
`docs/superpowers/handoffs/2026-09-08-roadmap.md` first, then
`docs/superpowers/handoffs/2026-09-08-stage-2-execution-log.md`, which carries
one line per landed task. This file says only why the run stopped and what to
do about it.

## Where the run got to

Tasks 1 to 13 of `docs/superpowers/plans/2026-09-08-graph-scope-rail.md` are
implemented, reviewed and committed on branch `graph-scope-rail`, each with
its plan checkboxes ticked and a log line. `npm run check` passed on every one
of them and passes at the branch head (290 unit tests). Nothing is pushed and
`main` is untouched.

Tasks 14 (the new `test/zotero/graphScopeRail.test.ts`) and 15 (docs, roadmap,
manual batch) are **not** done.

## Why it stopped

The protocol's first `npm test` after Task 13: **28 passed, 6 failed**. Three
failures were known on `main` and are not regressions; the run's stop rule is
a fourth. There are four new ones. The exact messages:

1. **`externalSeedImport.test.ts` — "imports the item and the seed turns
   local, the detail pane offers Add to Zotero"**
   `(logged: ): expected null to exist`.
   This is B6's own regression test, which passed on `main` and whose two
   manual checks the user walked and ticked on 2026-09-08. **Treat this as the
   serious one**: something in Tasks 7 to 13 broke a Stage 1 fix. The detail
   pane changed in Task 10 (the "Explore from this paper" secondary button was
   deleted) and Task 11 (`rowActions` now carries only "Add as seed"), so
   start there.

2. **`graphViewVisual.test.ts` "view 13" — a view rebuilt from its own state
   keeps its seeds, settings and filters**
   Reported with `undefined` for both expected and received, which means the
   case threw rather than asserted. It drives `controller.addFocusItems`, then
   `.cm-explore-section select`, then `getState()` and reopens the stage with
   that state. `.cm-explore-section` still exists (`graphViewService.ts:752`),
   so the throw is elsewhere; state version 2 (Task 1) and the `initialState`
   branch Task 7 collapsed are the first suspects. **This one guards saved
   graphs, so it must be understood before the branch merges.**

3. **`graphViewVisual.test.ts` "view 5" — the plot toolbar … there is a Seeds
   button**: `expected null to not equal null`. Stale by design: Task 9
   deleted the toolbar's Seeds button and moved seeding to the rail's
   "+ Add seed". The test needs rewriting to assert the rail's anchor instead.
   The plan never says to touch view 5 — that is a gap in the plan, not a
   defect in the code.

4. **`graphViewVisual.test.ts` "view 12" — the node menu**: expected
   `["Add as seed", "Remove from graph"]`, received `["Remove seed"]`. Task 10
   updated this case's expectations as the plan told it to, but the node the
   case right-clicks is evidently a seed, and `openNodeMenu` now hides
   "Remove from graph" for a seed. Either the case should drive a non-seed
   node, or its expectations should describe the seed menu. Decide which the
   spec means before editing it.

The three known failures for comparison: "view 10" (unchanged in kind, though
its shape moved — the overview now offers `["Find similar papers", "Remove
seed"]` after Task 11 deleted its duplicate "Graph" action), "view 15"
(unchanged), and `savedGraphMenu.test.ts` "lists the saved graphs on the first
showing", which **passed** this run.

## What to do next

In this order:

1. Diagnose 1 and 2 with `superpowers:systematic-debugging`. They are the two
   that could mean the code is wrong rather than the test being stale.
2. Decide 3 and 4 against the approved spec
   (`docs/superpowers/specs/2026-09-08-graph-scope-rail-design.md`) and rewrite
   those two cases. They are plan gaps: no task in the plan owns them.
3. Then run Tasks 14 and 15 as written, re-run `npm test`, `npm run check` and
   `npm run build`, tick Stage 2's "implemented" box in the roadmap and write
   the done-handoff.

Do not re-open the design. Everything above is about making the suite describe
the behaviour the spec already settled.

## Loose ends the run recorded, worth folding into the same pass

- **`itemPaneService.ts` belongs to no task.** Task 11 found its overview's
  "Graph" and "Explore" buttons doing the same thing once showing became
  seeding, and deleted "Graph". The survivor is still labelled "Explore",
  which Stage 2 otherwise retires. That is also what "view 10" is looking at.
- **Doubled edges.** Base edges are keyed `a>b` and projection edges
  `a>b:focus`, and `additiveGraphModel` dedupes by key, so a citation both
  sides carry is now added twice. Harmless to the model, possibly visible on
  the plot; worth a look in the walk-through.
- **"Show in graph (replace)" no longer narrows the graph** (Task 7): the
  additive model does not consult the map scope, which Task 11 then deleted.
  This is intended by the spec; noting it so it is not read as a bug later.
