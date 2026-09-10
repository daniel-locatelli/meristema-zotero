# Handoff: D6's spec and plan are written and approved; execution has not started

Date: 2026-09-10. Branch `main` at `0975565`, **pushed**. Tree clean apart
from an untracked `.claude/`. No product code was written this session; the
commit is four documents:

- `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md` (new)
- `docs/superpowers/plans/2026-09-10-graph-region-curves.md` (new)
- `docs/superpowers/handoffs/2026-09-10-d6-plan-written-handoff.md` (this
  file, new)
- `docs/superpowers/handoffs/2026-09-08-roadmap.md` (one Log line appended)

D6 itself is **not** ticked in the roadmap yet — the plan's Task 6 does that,
with the manual checks.

The previous handoff's "five commits ahead of `origin/main`" was already
stale when it was written: `259cd17..df94fca` had been pushed. `main` and
`origin/main` are level at `0975565`. Nothing is waiting to go out.

XPI `.scaffold/build/meristema.xpi` built from `cb27278`, after the last
`npm test` run. `npm run check`: green, 354 unit tests. `npm test`: 42 passed,
0 failed. Nothing this session touched either number.

Read `2026-09-08-roadmap.md` first; it is still the single place that says
what comes next. This file carries what that one cannot: that D6's design
step is finished and reviewed, and what the plan expects of whoever runs it.

## How to start

The spec was self-reviewed, reviewed by the user across two rounds, and
**approved**. The plan was written from it with `superpowers:writing-plans`
and its self-review is in the plan's own last section.

**Do not re-brainstorm D6, do not reopen its two decisions, and do not rewrite
the spec or the plan.** The next step is execution.

1. Read `2026-09-08-roadmap.md`, then this file.
2. Read `docs/superpowers/plans/2026-09-10-graph-region-curves.md` in full.
   Read the spec it points at before Task 1 — the plan assumes it.
3. `superpowers:subagent-driven-development`, one fresh subagent per task,
   review between tasks. The plan is written for a worker with no context:
   every code step carries its code, every command carries its expected
   output.

## What the plan does, in eight tasks

Two independent changes behind one module, `graphFolderRegion.ts`.

| #   | Deliverable                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Branch `graph-region-curves` off `main`; spec and plan as its first commit                                                                                               |
| 1   | The centripetal Catmull-Rom → cubic Bézier fit in `regionPathFor` — regions draw as curves, still at today's radius                                                      |
| 2   | `regionFitScale`, `regionZoomBucket`, `regionFalloffRadius`, `regionGridPitch` — pure, tested, unwired                                                                   |
| 3   | The field is stamped per paper instead of evaluated per cell, plus a grid cell budget                                                                                    |
| 4   | The zoom bucket joins the contour cache key in the renderer, **and** the reversal is recorded in D3's spec and in `graphFolderRegion.ts`'s docstring, in the same commit |
| 5   | A Zotero case: a folder region survives a zoom-in                                                                                                                        |
| 6   | Roadmap ticked, four manual checks appended, Log line                                                                                                                    |
| 7   | Gate, `npm test`, fast-forward to `main`, XPI built **after** the last test run, stop without pushing                                                                    |

**Task order is a dependency order.** Task 3 must land before Task 4: Task 4
is what shrinks the grid pitch, and without Task 3's stamped field build that
makes the field build quadratically slower at high zoom.

## The two decisions the spec records

Settled in the previous session's brainstorm, unchanged.

**1. The outline is a centripetal Catmull-Rom → cubic Bézier fit**, one
`bezierCurveTo` per contour segment, wrapping because the loops are closed.
The contour is untouched: same field, same threshold, same marching squares,
same stitching, same `evenodd` fill, same device-pixel dilation. A polyline in
data space re-facets as you zoom in whatever its vertex count; a curve does
not, because the rasterizer flattens it in device pixels. Centripetal
(α = 0.5) is not swappable for uniform — marching-squares vertices bunch at
grid corners, and a uniform parameterisation overshoots and can loop back on
itself exactly there.

**2. The falloff radius tightens past the fit zoom, and only past it.**
`min(spread * 0.06, spread * 0.06 * fitScale / scale)`, realised through a
quantised 12% bucket so the per-folder contour cache stays exact: `bucket =
clamp(round(log(scale / fitScale) / log(1.12)), 0, 18)` and `radius = spread *
0.06 * 1.12 ** -bucket`. Bucket 0 is byte-identical to what D3 shipped. A pan
still recomputes nothing.

**Decision 2 reverses D3 knowingly.** D3's spec builds the field in data space
precisely so a folder's topology is not a function of the zoom, and its review
called splitting-on-zoom indefensible. The reason that review never weighed is
the user's: zoomed in, a data-space hull has its edge off-screen and stops
telling the reader which papers made it. What makes it defensible is that it
is scoped — the topology is invariant through the whole zoomed-out range and
through the fit view. **Task 4 must land the D3 spec amendment and the module
docstring rewrite in the same commit as the code.** A later reader must find
the reversal named wherever they enter the story, not a flat contradiction.

## Three things this session verified, so they are not re-derived

- **Task 3's golden numbers are real**, recorded by running the current
  `folderRegionContours` on the fixture in the plan: two loops, 68 and 26
  vertices, coordinate sums to ten decimals. The stamped rewrite is an exact
  refactor and so has no red to watch — the golden is the guard. **Do not
  adjust it to match new output.** If it fails, the stamp's footprint is
  wrong, most likely `reach` one cell too small.
- **Every exact-equality assertion in Task 2 holds in floating point.**
  `1000 * 0.06 * 1.12 ** -0 === 60`, `60 / 5 === 12`, and
  `Math.log(1.12 ** 18) / Math.log(1.12)` is exactly `18`, so the floor clamp
  lands on the boundary rather than one below it. These were checked in node,
  not assumed.
- **Task 4's test fixture is three papers, deliberately.** An earlier draft
  used one and proved nothing: a lone paper's contour is _self-similar_ under
  the tightening, because the pitch follows the radius, so both the vertex
  count and the normalised shape survive a zoom unchanged. The fixture is now
  two papers 30 apart and one at 1000, so the assertion is that the region
  goes from two loops to three — the territory pulling apart, which no
  re-projection can fake.

## Traps

Carried forward from the last handoff, all still live.

- **Do not kill the user's Zotero.** Do not run `Stop-Process zotero`. Try
  `npm test` first; only kill on an actual EBUSY failure, and **ask first**.
- `npm test` **deletes** `.scaffold/build/meristema.xpi`. Build the XPI
  **after** the last test run. Task 7 is ordered for this.
- `draw()` latches `canvasError` after a single throw and never paints again
  for that renderer's life — closing and reopening the graph tab is the only
  recovery, not "Fit". This is why the plan demands every new function be
  total: no exceptions, no `NaN` reaching a canvas call. Whether the latch
  should reset on the next `setRegions`/`setModel` is still an open design
  question nobody has taken.
- The Zotero test add-on is a second copy of `src`, so a UI-path test drives
  the plugin's own menus and rows, never an imported service. Task 5's case
  uses the zoom-in button, `.cm-zoom-controls button[data-action="in"]`, one
  click of which is `zoomBy(1.22)`.
- A whole `npm test` run is not the reproduction loop: `describe.only` plus
  `npm test` is about a minute end to end. **Take the `.only` off** — `npm run
check` does not run the Zotero suite and will not catch it. Task 5 has the
  `grep` that does.
- `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
  known intermittent. One failure there is not a regression; re-run before
  treating it as one.
- Region defects **B25, B26 and B27** are still open from D3's own review and
  all live in the code D6 touches. B27 in particular will look like a D6
  regression: an out-of-range swatch index draws `strokeStyle = undefined` and
  canvas silently keeps the previous region's colour. Read all three before
  editing `regionsForRenderer` or the swatch lookup. The spec's "What this
  does not do" says explicitly that none of them is in scope.

## Where the manual batch stands

Unchanged from the last handoff. **Six D3 checks are unblocked and unwalked** —
regions opening, the toggle and the cap, the no-repaint rule, the four-seed
colour check, the migration check and the zoom check.

They do not block D6, and they will need rewalking after D6 lands anyway,
since D6 changes what a region looks like at every zoom. The migration one
stays the fragile one: it needs a graph still on state version 2, the first
save after opening rewrites it to version 3, so it is walkable exactly once
per old graph.

Task 6 appends four D6 checks to the same batch: the zoom-in pull-apart, the
curve at every zoom, a jiggle at a bucket boundary (the deadband question the
spec deliberately left open), and a quiet Error Console throughout.

## Prompt for the next session

> Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`, then
> `docs/superpowers/handoffs/2026-09-10-d6-plan-written-handoff.md`, then
> `docs/superpowers/plans/2026-09-10-graph-region-curves.md` in full, and the
> spec it points at, `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`.
>
> D6's spec and plan are both written and approved. Do not re-brainstorm it,
> do not reopen its two decisions, and do not rewrite the spec or the plan.
> Start at the plan's Task 0 and execute it with
> `superpowers:subagent-driven-development` — one fresh subagent per task,
> review between tasks, one commit each. Stop after Task 7 without pushing.
>
> Traps I do not want rediscovered: never kill my Zotero without asking,
> `npm test` deletes the XPI so build it afterwards, `draw()` latches
> `canvasError` after one throw so any canvas error blanks the plot
> permanently, and Task 3's golden numbers were recorded from the current code
> on purpose — if they fail, the stamp is wrong, not the golden.
