# Handoff: D3, the colour system, ready to execute

Written 2026-09-09 on `main` at `e271680`. Read
`docs/superpowers/handoffs/2026-09-08-roadmap.md` first — it is what gets
ticked. This file is the reasoning the roadmap has no room for, and the
warnings an executing session needs before it starts.

Nothing is implemented. This session brainstormed D3, wrote the spec, took a
review on it, corrected one factual error the review did not catch, and wrote
the plan. The only commits are documentation.

- Spec: `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`
- Plan: `docs/superpowers/plans/2026-09-09-graph-colour-system.md`
- Commits: `4ba8c8b` spec, `bb67388` review gaps, `ad90f91` the correction,
  `e271680` the plan.

## How to start

The user's instruction for the next session, in their words: execute the plan
**subagent-driven**. So:

1. Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`, then this file.
   You do not need to read the spec end to end before starting — the plan's
   task briefs carry what each task needs — but read the spec's **Design**
   section once, because the plan assumes it.
2. `git switch -c graph-colour-system` from `main` at `9386ac6`.
3. Invoke `superpowers:subagent-driven-development` on
   `docs/superpowers/plans/2026-09-09-graph-colour-system.md`. Ten tasks, in
   order. The ledger at `.superpowers/sdd/progress.md` has no entry for this
   plan yet; every task is outstanding.

Do not re-brainstorm and do not rewrite the spec. It was written, reviewed by
the user, corrected once, and approved.

## What was decided, and what the user chose

The user chose D3 over Stage 3, then made four calls in the brainstorm. They
are decisions, not proposals, and an executing session should not reopen them.

1. **A seed's centre is the seed's own colour**, and it **always wins** over
   the colour metric. Seeds are the anchor set the reader navigates by; a
   seed's metric value is read in the rail and the detail pane.
2. **Seeds get a dedicated palette**, not a reserved slice of the categorical
   swatches.
3. **A folder becomes a background region** — the user's own addition, and the
   largest thing in the design: a marching-squares hull with islands allowed,
   a solid border and a translucent fill. Their words: _"for the implementation
   make sure to use a proper marching square algorithm"_. Not a convex hull,
   not a blurred sprite, not a hand-rolled blob. The plan's Task 3 has the case
   table and the saddle disambiguation.
4. **Regions are toggled by selecting the folder's row**, not by a new control.
   The checkbox keeps meaning _in scope_; the rest of the row becomes a
   selection. Multi-select by plain click, cap of four, oldest released.

## The correction worth not re-deriving

The spec's first draft said almost every saved graph carries
`nodeColorMetric: "collection"` and would need migrating. **It does not.** The
colour metric lives in `GraphLayoutOptions`, inside the single
`graphAppearance` preference (`citationPreferences.ts`), shared by every graph.
No saved graph carries it.

The trap underneath that: `getGraphAppearance` treats a
`GRAPH_APPEARANCE_SCHEMA_VERSION` mismatch by writing `DEFAULT_GRAPH_LAYOUT`
over the **whole** record. Bumping the version is the obvious way to retire
`"collection"` and it would silently throw away the reader's axes, scales, size
metric and label mode to change one field. The plan coerces the one value on
read instead, and does not bump the version. Do not "tidy" that into a version
bump.

State version 3 therefore covers only what is genuinely per graph: the selected
regions, the swatch ledger, the seed ledger.

## Why the field is data space

The reviewer flagged that a screen-space field with a device-pixel falloff
makes hull topology a function of the zoom, and offered a choice: fix it, or
document splitting-on-zoom as intended. It is not defensible as intended — a
folder's territory would fragment as the reader zooms, which is B12's fault in
another costume.

So the contour is computed in **data space** and dilated at **draw time** by a
device-pixel amount, by stroking the path with a wide round-joined stroke under
the fill. Clearance from the node discs is constant on screen; the shape being
cleared does not move with the zoom. Pan and zoom then need no recomputation
at all — the cached path is transformed like everything else. Two unit tests
guard this: same nodes at two zoom levels give the same contour, and a folder
at the plot's extreme gives a closed contour rather than one clipped square by
the grid's edge.

## Two things the plan does deliberately that look wrong

- **Task 4 breaks the build.** Narrowing `GraphNodeColorMetric` breaks the
  renderer and the rail until Tasks 7 and 9. Its commit step runs the unit
  files rather than `npm run check`, and says so. Splitting it further would
  mean editing the renderer before the module it draws from exists. Do not
  "fix" this by reordering.
- **Task 1 measures before it asserts.** `graphTheme.ts` claims its palette was
  validated for lightness, chroma and CVD separation; nothing in the repo
  enforces that. Task 1 builds the validator, runs it against the **shipped**
  palette, and sets the floors from what the shipped palette actually achieves.
  The seed hexes in the spec are candidates and are expected to be nudged until
  they clear the same bar. Never lower a floor to make a seed pass.

## Warnings for the executing session

- **`npm test` deletes `.scaffold/build/meristema.xpi`.** It is run once, in
  Task 10, and the XPI is rebuilt after it. `.scaffold/build/meristema.xpi` is
  current as of `3ad1610` and nothing this session invalidated it.
- The Zotero suite's baseline is **37 passed, 1 failed** — view 15, which is
  backlog B11 and fails on `main` too. Any other failure in Task 10 is this
  branch's doing.
- `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
  known-intermittent; a single failure there is not evidence of a regression.
- A UI-path test drives the plugin's own menus and rows, not the model. The
  Zotero test bundle is a second copy of the source, so a stub must outlive an
  async `onCommand`.
- Branch `graph-colour-system`, off `main` at `e271680`.

## What this does not touch

Stage 3 (citation hops) and Stage 4 (the citation floor) are untouched, and the
spec leaves the **unfilled node outline** unspent because Stage 4 needs it for
papers below the floor. D4 (templates) and D5 (the logo) are untouched; D4 will
have something coherent to bundle once this lands.

## Visual companion

The brainstorm ran with the browser companion; its four screens are in
`.superpowers/brainstorm/108905-1788972397/content/` (gitignored) and show the
node-fill options, the region toggle designs, the selection model and the
palette candidates. The server auto-exits after four hours idle.
