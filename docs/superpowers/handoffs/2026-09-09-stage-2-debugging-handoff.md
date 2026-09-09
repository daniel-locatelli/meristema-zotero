# Handoff: Stage 2, debugging the four new Zotero failures

Written 2026-09-09. Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`
first, then `2026-09-08-stage-2-stopped-handoff.md` (why the run stopped) and
`2026-09-08-stage-2-execution-log.md` (one line per landed task). This file
replaces the stopped handoff's "what to do next" section with what the
debugging session found.

Branch `graph-scope-rail`, head `4fb15de`. Nothing pushed; `main` untouched.
`npm run check` is green. `npm test` is **28 passed, 6 failed**.

## What was fixed, with evidence

**The adopt pass was eating the restored seed selection.** Committed as
`4fb15de`.

Opening a saved graph restores its seed and selects it; the `adopt` pass that
runs right after the render (`windowService.ts`, both the tab path near line
1226 and the window path near line 739) then replaced that with whatever
Zotero's item list had selected. The old guard stood down only when the list's
row resolved to no node in the graph — a good proxy while the focus projection
_replaced_ the model, because a library row usually was not in the graph. Under
Task 7's additive model the graph holds the whole library, so the row always
resolves and the seed was always lost.

Evidence, from probes through `Zotero.logError` (the test captures it):

```
MERISTEMA-DIAG selectedKey=focus:openalex:w-b6-fixture inVisible=true inModel=true modelNodes=3
MERISTEMA-PANE  key=focus:openalex:w-b6-fixture kind=external hasWork=true itemID=0
MERISTEMA-PANE  key=FHR3BAV8                    kind=local    hasWork=false itemID=2
```

The seed is selected and the pane renders it — and is then re-rendered with the
library fixture. Disabling only the tab-path adopt call made the "Add to
Zotero" assertion pass, which is what confirmed it. (Disabling the _window_
path alone changed nothing; there are two call sites, and the test drives the
tab one. That cost a cycle — check both.)

The fix keeps the spec's stated purpose. `2026-09-07-selection-sync-design.md`
line 237 says "a fresh view adopts what it can show and otherwise keeps its own
selection"; read literally against an additive model the second half can never
happen, so the guard now asks _did the render restore a selection_ instead of
_can the graph show the row_. An emphasis from the list still applies, since an
emphasis is not a selection. **If you read that spec differently, this is the
one judgement call of the session to overturn** — but the literal reading means
every saved seeded graph opens on an unrelated library paper.

## Where `externalSeedImport` now stands

It fails **later**, on B6's actual behaviour rather than on the pane:

```
imports the item and the seed turns local: expected [ 'external' ] to deeply equal [ 'item' ]
```

So: the pane offers Add to Zotero, the collection chooser opens, the import
runs — and the seed does not turn local. That is the second layer of the same
regression and is **the next thing to work**. B6's original fix (commit
`5b2ae03` on main) routed the import back to the host, which writes the key
into the instance's recipe and the live view and refreshes; Task 7 rewrote
`applyState`/`getState` and Task 11 deleted the pending-selection plumbing
around them, so start by diffing that path against `main`:

```
git diff main..HEAD -- src/services/windowService.ts | grep -n workImported -B20 -A20
git diff main..HEAD -- src/services/graphViewService.ts | grep -n markExternalSeedImported -B10 -A10
```

`markExternalSeedImported` is pure and unit-tested, so the break is almost
certainly in the wiring around it, not in it.

## The other failures, unchanged

- **"view 13"** — still `undefined`. Note the runner **prints `undefined` for a
  thrown `Error`** and only renders chai assertion failures properly, so this
  case is throwing, not asserting. To see it, wrap the suspect line and
  re-throw through `expect(String(err)).to.equal("DIAG")`. That trick is how
  this session got anything out of the suite at all.
- **"view 5"** — stale by design: Task 9 deleted the toolbar's Seeds button.
  Rewrite it against the rail's "+ Add seed" anchor.
- **"view 12"** — expects `["Add as seed", "Remove from graph"]`, gets
  `["Remove seed"]`: the node it right-clicks is a seed, and `openNodeMenu`
  hides Remove from graph for a seed. Decide whether the case should drive a
  non-seed node or describe the seed menu.
- **"view 10"** and **"view 15"** — known on `main`, not regressions. view 10's
  shape moved: the overview now offers `["Find similar papers", "Remove seed"]`
  because Task 11 deleted its duplicate "Graph" action.

## How to run the suite without burning cycles

- `npm test` is ~3 minutes and there is **no way to run one file**: the
  scaffold's `test.entries` wants the directory, an array or a single path both
  silently match nothing (0 passed), and `zotero-plugin test` has no `--grep`.
  Do not repeat that experiment.
- `waitFor` in `externalSeedImport.test.ts` **returns `null` on timeout**, it
  does not throw, so a `.catch` on it never fires.
- Probes through `Zotero.logError` land in that test's `logged` array, which is
  the only reliable way to read plugin-side state from the suite. Remember the
  test later asserts `logged` is empty, so probes make that assertion fail —
  that is expected noise, not a new failure.

## Then

Once `externalSeedImport` is green and view 5, 12 and 13 are settled, run Tasks
14 and 15 of `docs/superpowers/plans/2026-09-08-graph-scope-rail.md` as
written, then `npm run check`, `npm test`, `npm run build`, tick Stage 2's
"implemented" box, and write the done-handoff. Do not re-open the design.

The three loose ends from the stopped handoff still stand: `itemPaneService.ts`
belongs to no task and its surviving overview button still says "Explore";
`additiveGraphModel` can add the same citation twice because base edges are
keyed `a>b` and projection edges `a>b:focus`; and "Show in graph (replace)" no
longer narrows the graph, which the spec intends.
