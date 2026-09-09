# Handoff: Stage 2 is done and on `main`

Written 2026-09-09. Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`
first; this file only says what the closing session did. It replaces
`2026-09-09-stage-2-debugging-handoff.md`, whose "next thing to work" is now
finished.

`main` carries the branch, fast-forwarded and pushed, and
`graph-scope-rail` points at the same commit. `532ec85` is the last commit
that changes code; everything after it is this handoff. `npm run check` is green. `npm test` is **37 passed, 1
failed**; the one is "view 15", which fails on `main` too and is now backlog
**B11**. `.scaffold/build/meristema.xpi` is the production build of that
commit — **rebuild it if you run `npm test` again**, because the test run
overwrites `.scaffold/build` with its own test-mode bundle and deletes the
XPI.

What is left of Stage 2 is the user's: the manual walk-through, nine checks
appended to the roadmap's batch.

## What the session did

**The imported seed stayed external in the recipe.** Root cause, found with a
ring-buffer probe on the Zotero global rather than `Zotero.logError` (which
this test asserts is empty): the refreshed view _did_ resolve the imported
item and re-seed on it, but `notifyStateChange` coalesced on
`requestAnimationFrame`, and Gecko runs no frame callback while the window is
not painting. The probe showed the frame scheduled and still pending 1.5 s
later, view alive, seed local — so the host never heard, and the autosave kept
the seed before it. It now coalesces on the window's timer (`5754d3f`): a
recipe is not a paint. This is a real defect beyond the test — a graph in a
background tab or an occluded window had the same hole.

**Four view cases described the pre-rail product** (`2f879ca`):

- view 5 looked for the toolbar's Seeds button; it asserts the bar carries
  nothing about seeds and the rail's "+ Add seed" is live while seedless.
- view 12 seeds a node to select it, so the menu it opens is a seed's:
  "Remove seed", and Remove from graph stays out because no rule can hide a
  seed. The non-seed menu is covered in `graphScopeRail.test.ts`.
- view 13 threw rather than failed, on the missing Seeds button. It reads the
  rail's `Seeds · 2` heading and its rows now. (The runner prints `undefined`
  for a thrown `Error` and only renders chai failures properly — that is what
  "undefined" meant.)
- view 10 expected one overview action. Task 11 deleted the duplicate Graph
  entry that made it two on `main`, and the seed toggle is the second one now.

**Task 14** (`6cb271c`), `test/zotero/graphScopeRail.test.ts`: D1 directly, the
folder untick, File-and-no-Seeds, and Remove from graph / Show all. Two things
the plan did not anticipate:

- Right-clicking the centre of the plot hits no node. The walk finds one the
  way a reader would: the plot puts a paper's tooltip on the canvas while it
  is hovered, so the helper moves the pointer over the plot and right-clicks
  every point that names a paper it has not tried, until a menu offers the
  entry the case wants. No test-only hook.
- Asking the document for `.meristema-root` sometimes answered with the
  previous suite's graph, still closing (`532ec85`). The suite notes which
  graph tabs existed before it presses New Graph and reads only its own.

**Task 15** (`69de464`): README, spec status, roadmap tick, the manual batch,
the log line, and B11 filed. The ledger line is written to
`.superpowers/sdd/progress.md`, which is gitignored, so it is not in a commit.

`.prettierignore` gained `.claude/` (`ce0d5e0`): a worktree under
`.claude/worktrees/` is a second checkout of this repo, and prettier was
reporting style issues in that copy's docs.

## The judgement call from the previous session, unchanged

The adopt guard now asks _did the render restore a selection_ rather than _can
the graph show the row_ (`4fb15de`). The user agreed with it on 2026-09-09.

## Loose ends, none of them Stage 2's contract

- **B11 / "view 15"**: a one-row library selection leaves the detail pane's
  placeholder up. Fails on `main`; the entry says what to decide first.
- `itemPaneService.ts` belongs to no task and its surviving overview button
  still says "Explore".
- `additiveGraphModel` can add the same citation twice: base edges are keyed
  `a>b` and projection edges `a>b:focus`.
- "Show in graph (replace)" no longer narrows the graph, which the spec
  intends it to.

## Then

The roadmap's next item is Stage 3 (citation hops on demand), which depends on
the user's manual walk-through of Stage 2 first. Install
`.scaffold/build/meristema.xpi` and walk the nine Stage 2 checks in the
roadmap's Manual verification section; the last one — a graph saved before
this release drawing the same papers, in particular one scoped to a parent
folder still drawing the whole subtree — is the migration, and it is the check
that would lose saved work.
