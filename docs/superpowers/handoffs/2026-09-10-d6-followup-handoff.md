# Handoff: D6 shipped and was walked; two complaints remain open

Date: 2026-09-10. Branch `main` at `92178db`, **ten commits ahead of
`origin/main` and not pushed**. Tree clean apart from an untracked `.claude/`.
XPI `.scaffold/build/meristema.xpi` built from `92178db`, after the last
`npm test` run.

`npm run check`: green, 371 unit tests. `npm test`: 43 passed, 0 failed — but
read "The loose end" below before trusting that number.

Read `2026-09-08-roadmap.md` first; it is still the single place that says what
comes next. This file carries what it cannot: why the two remaining complaints
are one design question rather than two tuning knobs.

## What landed

D6 in full, then a follow-up round from the user's manual walk. Ten commits,
`488af31..92178db`. The design documents are the record and are current — do
not re-derive them:

- `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md` (D6, amended
  twice on 2026-09-10 to match what actually shipped)
- `docs/superpowers/plans/2026-09-10-graph-region-curves.md` (executed in full)
- `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md` (D3, carries
  D6's reversal notes)

The roadmap's Log entries for 2026-09-10 carry the per-change detail.

## The two open complaints, and why they are one question

The user walked the build and reported: **the outline is better but still a bit
wobbly**, and **the offset could be smaller still**. Both are real. They meet at
one line of code, which is why they should be designed together rather than
tuned separately.

### Why it is still wobbly

What shipped is a **uniform** cubic B-spline. "Uniform" means the knot vector
assumes the control points are evenly spaced in parameter. Marching-squares
vertices are emphatically not: a contour crossing a cell near its corner emits
two vertices a hair apart, while a crossing straight across a cell emits a long
span. A uniform knot vector gives every one of those the same parameter
interval, so the curve travels fast through the long spans and slow through the
short ones. Curvature varies for reasons that have nothing to do with the shape,
and that reads as wobble.

This is precisely what the **"non-uniform"** in NURBS refers to, and it is what
Rhino's NurbsCurve actually builds — a chord-length or centripetal knot vector.
The first fit was interpolating and wrong for that reason; this one approximates
correctly but parameterises naively. The user has now been right about the same
component twice, on two different axes.

Two ways out:

1. **A genuinely non-uniform knot vector.** Compute chord-length (or
   centripetal) spacing and build a non-uniform cubic B-spline. Still converts
   exactly to cubic Béziers, but the blending weights stop being literal thirds
   and sixths and become functions of the knot intervals. **Cost: it reinstates
   data-dependent divisions**, so the entire family of near-zero-denominator
   guards that `0f59ff6` deleted comes back, and with it the `NaN`-into-canvas
   risk the `canvasError` latch makes so expensive.
2. **Resample the ring to even arc length, then keep the uniform fit.** Even
   spacing is exactly what the uniform knot vector assumes, so this reaches the
   same place. The divisions move into the resampler, where a degenerate ring can
   fall back cleanly, and the fit itself stays division-free.

**Recommendation: option 2.** It keeps the totality win, it is simpler, and the
resample spacing becomes a direct smoothness knob — which is also the honest
lever for "too many control points". Coarser resampling is smoother and loses
genuine detail; that trade is the thing to put in front of the user.

`DEVICE_WELD` (1.5 device pixels, in `ringOf`) is the crude version of this
already present. Raising it is the cheapest experiment available and worth
trying first to confirm the diagnosis before building a resampler.

### Why the offset cannot simply be lowered again

`FALLOFF_FRACTION` is `0.04`. Lowering it further is one character, but
`pitch = radius / PITCH_DIVISOR` (5) ties the grid to the radius, so cells scale
as the inverse square of the fraction. `0.04 → 0.03` is about 1.78×, taking the
worst case from ~924 000 cells to ~1 640 000 — past the `MAX_GRID_CELLS`
budget of 1 200 000, which would start silently coarsening the pitch and
degrading the contour. Raising the budget again means a ~16 MB `Float64Array`
per folder recompute, up to four folders.

**The question worth asking is whether `pitch = radius / 5` is still the right
coupling.** It was chosen when the radius was `0.06` and the outline was a raw
polyline, where grid fidelity was the only thing standing between the user and
a visible facet. If the ring is going to be resampled and smoothed anyway, a
coarser grid may cost nothing visible and would pay for a smaller offset
directly. That is the seam where the two complaints are actually one decision.

Note also that the B-spline sits slightly inside the old outline on its own, so
part of the perceived tightening at `0.04` came free. Judge any new value on a
build, not on arithmetic.

## The loose end

One `npm test` run in this session reported **42 passed / 1 failed**. Two
subsequent runs were 43/0, and the known-intermittent
`savedGraphMenu.test.ts` case ("lists the saved graphs on the first showing")
**passed** in the failing run, so it was something else. The output was not
captured and the case was never identified. That is an unclosed gap, not a
cleared one. Before treating the suite as green, run it a few times with the
full log kept (`npm test 2>&1 | tee <file>`) and find out what it was.

## Still open from D6's own final review

None of these block the work above; all three are recorded here because they
will otherwise be lost.

1. **The pan assertion does not test what it claims.** D6's spec asked for
   "pan the transform, assert `folderRegionContours` was not called again". The
   plan substituted a check that every coordinate shifted by the pan delta,
   which passes whether or not the contour was recomputed, because
   `folderRegionContours` is deterministic and takes no viewport. "A pan
   recomputes nothing" is the load-bearing performance claim of the whole
   bucket design and nothing currently verifies it. Fix by counting calls.
2. **`cellSegments` was never adapted to the larger grid.** The field build is
   bounded per node, but segment extraction still walks every cell — and the
   cell count grew by a large factor. It allocates four closures per cell
   _before_ its switch, including for the empty codes 0 and 15 that dominate a
   sparse field. Hoisting `if (code === 0 || code === 15) return [];` above them
   is three lines.
3. **Nothing has measured the draw path.** `drawRegions` rebuilds every
   `Path2D` every frame, including loops entirely off-screen — which is exactly
   the regime the tightening creates. A fifth manual check for this is already
   appended to the roadmap's batch. The cheap mitigation, if it bites, is to
   skip loops whose projected bounding box misses the plot rect.

## Traps

- **Do not kill the user's Zotero.** Do not run `Stop-Process zotero`. Try
  `npm test` first; only on an actual EBUSY failure, and **ask first**.
- `npm test` **deletes** `.scaffold/build/meristema.xpi`. Build the XPI **after**
  the last test run.
- `draw()` latches `canvasError` after a single throw and never paints again for
  that renderer's life — closing and reopening the graph tab is the only
  recovery, not "Fit". This is why every function in `graphFolderRegion.ts` must
  be total, and it is the main argument against reintroducing data-dependent
  divisions into the curve fit.
- The Zotero test add-on is a second copy of `src`, so a UI-path test drives the
  plugin's own menus and controls, never an imported service.
- `describe.only` plus `npm test` is about a minute end to end. **Take the
  `.only` off** — `npm run check` does not run the Zotero suite and will not
  catch it.
- Backlog **B25, B26 and B27** are still open and all live in the code this work
  touches. **B27 will look like a regression**: an out-of-range swatch index
  draws `strokeStyle = undefined` and canvas silently keeps the previous
  region's colour. B26 is a hull reshaping mid-keystroke in the search box.
  Neither is yours unless someone decides so.
- The contour golden test ("sums the field to the same contour however it is
  accumulated") holds numbers recorded from a pre-refactor implementation on
  purpose. **If it fails, the code is wrong, not the golden.**

## Where the manual batch stands

D6's four checks plus the fifth performance one are in the roadmap's batch. The
first two are recorded as **walked and changed** rather than passed — they
produced this session's follow-up round and need rewalking on the current XPI.
Checks 3 (the bucket-boundary jiggle) and 4 (a quiet Error Console) are
unwalked.

Note on check 3: a mouse wheel cannot perform it. One notch is roughly
1.13–1.30× and a bucket step is 1.12×, so every notch jumps about a whole
bucket. It needs a trackpad pinch, which moves in 1–4% steps.

**D3's six checks are still unwalked** and need rewalking on this build anyway,
since D6 changed what a region looks like at every zoom. The migration one stays
fragile: it needs a graph still on state version 2, and the first save after
opening rewrites it, so it is walkable exactly once per old graph.

## Suggested skills

- `superpowers:brainstorming` **first** — the wobble fix is a design decision
  (non-uniform knots versus arc-length resampling) with a real trade-off in
  totality, and the offset is coupled to it through `PITCH_DIVISOR`. Do not go
  straight to code.
- Then a spec in `docs/superpowers/specs/` and a plan in
  `docs/superpowers/plans/`, per this repo's established process
  (`superpowers:writing-plans`).
- `superpowers:subagent-driven-development` to execute the plan.
- `superpowers:systematic-debugging` if the unidentified test failure is chased.

## Prompt for the next session

> Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`, then
> `docs/superpowers/handoffs/2026-09-10-d6-followup-handoff.md`, then D6's spec,
> `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`.
>
> D6 shipped and I walked it. Two complaints are still open and the handoff
> argues they are one question: the region outline is better but still a bit
> wobbly, and the offset should be smaller still. Start with
> `superpowers:brainstorming` on those two together — in particular whether the
> fix is a non-uniform knot vector or resampling the ring to even arc length
> before the existing uniform fit, and whether `pitch = radius / 5` is still the
> right coupling now that the outline is smoothed. Try raising `DEVICE_WELD`
> first as a cheap check on the diagnosis before building anything. Then spec,
> then plan, then subagent-driven development.
>
> Do not re-derive D6's design; the spec is current and was amended to match
> what shipped. `main` is ten commits ahead of `origin/main` and unpushed — ask
> me before pushing.
>
> Traps I do not want rediscovered: never kill my Zotero without asking;
> `npm test` deletes the XPI so build it afterwards; `draw()` latches
> `canvasError` after one throw, so any canvas error blanks the plot
> permanently and only a new renderer recovers it; and the contour golden test's
> numbers were recorded from the pre-refactor code on purpose — if it fails, the
> code is wrong, not the golden.
