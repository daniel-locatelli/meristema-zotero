# Handoff: Stage 2 is specified and approved; write the plan next

Written 2026-09-08, end of session. Read
`docs/superpowers/handoffs/2026-09-08-roadmap.md` first, as always; this
file only says what the next session should pick up and what it must not
re-litigate.

## Where things stand

Stage 1 is finished and ticked. Stage 2's first box, brainstorm and spec,
is ticked. The spec is
`docs/superpowers/specs/2026-09-08-graph-scope-rail-design.md`, marked
**Approved 2026-09-08, not implemented**.

## Start here

The next unticked box is **Stage 2, plan**. Invoke
`superpowers:writing-plans` against the approved spec and write
`docs/superpowers/plans/2026-09-08-graph-scope-rail.md`. Then tick the
box and commit the tick with the plan.

Do not re-open the design. Eight decisions were taken with the user this
session and are recorded in the spec with their reasons. Re-deciding them
is the one way this handoff fails.

## The eight decisions, so they are not reopened

1. **Items become seeds.** "New Graph from N items" seeds; "Add to" adds
   seeds. The whole item-scope mechanism is deleted.
2. **Both citation directions in Stage 2**, forward-only in Stage 3. The
   gear's direction and scope settings survive this stage and die in the
   next.
3. **Every folder ticked**, plus Unfiled and Not in Zotero rows, so every
   paper on the plot answers to a tick the reader can find.
4. **Folder ticks govern library papers only.** A paper a seed reached
   stays whatever its folder. The property facets, year and item type and
   retraction and being outside Zotero, do reach it; the spec explains
   why the two differ.
5. **A ring marks a hop result already in the library.** Unfilled
   outlines stay reserved for Stage 4's citation floor.
6. **The toolbar's Graph menu becomes File**, mirrored in Tools ›
   Meristema with the same four commands in the same order.
7. **The seed search panel floats beside the rail**, anchored to
   "+ Add seed", keeping its width and its existing search.
8. **The item menu is two entries**: "New Graph from N items" and an
   "Add to" submenu grouping open graphs. Refresh moves to Tools.

Three further calls made while writing, also in the spec: presets are
deferred to Stage 3 because they set a floor and a depth that do not
exist yet; "Remove from graph" is in, answering D1's second half; and
folder ticks are stored as a base plus exceptions so a library graph
picks up folders made later and a folder graph does not.

## What the spec review caught, and why it matters to the plan

The user reviewed the spec and found four gaps, all closed in commit
`6ff7442`. One of them changed the design, and the plan must carry it:

**Subfolders cascade.** `collectionScopeIDs` already expands every
selected folder through `descendants()`, unconditionally, so a graph
scoped to a parent folder draws that whole subtree today. The spec first
said a parent's tick does not reach its children, which would have opened
every saved folder graph smaller than it was saved, silently. Toggling a
parent now writes the same tick to every descendant; each child keeps its
own checkbox; a parent whose descendants disagree draws mixed. This is
also what makes the version 1 migration exact and keeps
`parseGraphViewState` pure.

The other three: the property facets reach a seed's neighbours and the
spec now says why; seeding a paper purges its key from `hiddenKeys`, or
removing that seed later would resurrect a hide decided weeks earlier;
and the rail keeps one emphasis whatever raised it, so Scope and Key
cannot strand each other's highlights.

## Watch these while planning

- **State version 2 with a migration.** `parseGraphViewState` returns
  `null` for any version but the current one, so shipping version 2
  without the migration silently destroys every saved graph. Put it in an
  early task with its tests, not a late one.
- **`graphViewService.ts` is 4,289 lines** and this stage touches the
  projection, the filters, the toolbar, the menus and the seed popover
  inside it. The two new pure modules, `graphScopeModel.ts` and
  `graphScopeRailModel.ts`, are where the logic should land so the tests
  can reach it.
- **`npm run check` is the gate for every task.** The Zotero suite is the
  user's to run, though they have said `npm test` may be run from a
  session for reproduction and verification.

## Verification results from this session

Nine of the eleven manual checks pass and are ticked in the roadmap. B2,
B3, F2 and F1 all pass. B1's two checks pass exactly as written.

**B6's two checks are not walked yet.** They are the external seed
import, and they matter more than the rest because B6 was a data bug
rather than a cosmetic one. The XPI at `.scaffold/build/meristema.xpi`,
built from main at version 0.5.3, still covers them.

Two entries came out of the walk-through:

- **B8**, the saved-graph dialogs being cramped and the Delete confirm
  painting white right and bottom edges. **Decided: keep the native
  dialogs.** `Services.prompt` renders Firefox's own common dialog, whose
  padding and frame no stylesheet of ours reaches, so this is the cost of
  how B1 was met. No work follows. The entry stays as the record, so a
  later session does not read it as an unfixed bug.
- **F4**, showing the selected paper's abstract in the graph. Open, in
  Filler. The question is which surface carries it: the detail pane on
  selection, the hover tooltip, or a block in the Overview tab. The
  tooltip gains a Make seed button in Stage 3, so it is getting busy.

## Still open elsewhere

`npm test` had two failures on main before this session and they are
unchanged: "view 10" expects one action where the overview offers two,
and "view 15" leaves a paragraph element where null is expected. A third,
`savedGraphMenu.test.ts` "lists the saved graphs on the first showing",
is intermittent and drives the real Tools menu, so a focus or popup
timing race is the first suspect. None are triaged into the backlog yet.
