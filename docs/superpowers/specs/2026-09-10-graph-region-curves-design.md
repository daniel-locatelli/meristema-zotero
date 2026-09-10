# Region Curves: A Smooth Outline, and a Halo That Holds Its Size

**Date:** 2026-09-10
**Status:** Draft, awaiting the user's review

Backlog entry D6 (`docs/superpowers/handoffs/2026-09-08-review-backlog.md`),
raised on 2026-09-10 once B28 made the folder regions visible for the first
time. Design brainstormed and accepted in conversation the same day; the two
decisions below are settled and are recorded here, not reopened. Handoff:
`docs/superpowers/handoffs/2026-09-10-d6-region-curves-handoff.md`.

This spec amends `2026-09-09-graph-colour-system-design.md` (D3) rather than
sitting beside it. The second half **reverses** one of D3's explicit
decisions, knowingly and with a reason D3's own review never weighed. That is
the section "The reversal, and why it is allowed"; read it before reading D3
again, or the two specs will look like a flat contradiction.

## Problem

Two complaints, independent of each other, both about how a folder's region
looks rather than what it contains.

### 1. The outline reads as a chamfered polygon

`regionPathFor` walks a marching-squares contour with `lineTo` between
consecutive vertices. The grid pitch is `spread * 0.012`, about 83 cells
across the data extent, so the vertices are coarse and every one of them is a
visible corner. A shape meant to read as a territory reads as a faceted
polyline.

Making the grid finer is not the fix, and neither is Chaikin subdivision or
any other polyline smoother. **A polyline in data space re-facets as you zoom
in**: its segments are transformed with the nodes, so segments that are
sub-pixel at the fit view are tens of pixels long at 8×, and the facets come
straight back. Whatever the vertex count, there is a zoom at which it shows.

### 2. The halo swallows the viewport at high zoom

The falloff radius is `spread * 0.06` in data units and is not a function of
the zoom. Zoomed out that is right — the user said the zoomed-out view looks
fine. Zoomed in, the region's edge is off-screen and the plot is a flat wash
of one colour with a few nodes on it. A region that fills the viewport has
stopped saying which papers made it, which is the one thing it exists to say.

The user's ask: the offset should hold its size on screen, the way a node's
radius does, so that zooming in pulls the territory apart into its members.

## Decision 1: a uniform periodic cubic B-spline fit

The contour itself is untouched — same field, same threshold, same marching
squares, same stitching, same topology, same `evenodd` fill, same device-pixel
dilation stroke. What changes is how `regionPathFor` turns a loop of vertices
into a `Path2D`: the ring's vertices become the **control points** of a
uniform periodic cubic B-spline, converted exactly to **one cubic Bézier per
ring vertex**, wrapping around the ring because the loops are closed.
Consecutive segments share endpoints, so the whole ring is one continuous
loop, same as before.

The curve passes through **none** of the ring vertices, only near them — that
is not a side effect to tolerate, it is why this fit was chosen. A first pass
shipped an interpolating fit (centripetal Catmull-Rom, described below) that
threads a curve exactly through every vertex. Marching-squares vertices sit at
linearly-interpolated grid-edge crossings and jitter a little from one vertex
to the next as the grid quantises the true crossing point; an interpolating
fit is forced to reproduce that jitter exactly, and it read as visible wobble
on the user's manual walk of D6 on 2026-09-10. An approximating fit is pulled
toward the vertices instead of through them, so the sub-cell jitter averages
out while the contour it is fitted to — same points, same topology — is
untouched.

**Correction, 2026-09-10 (region shapes).** The cause named above is wrong, and
it was measured rather than argued. On the same ring, fed to the same fit:
removing grid quantisation jitter entirely by Newton-refining every vertex onto
the exact level set changes the curvature standard deviation from 0.0511 to
0.0514 — no improvement at all — while evening the vertex spacing takes it to
0.0416. The wobble is a **parameterisation** artefact: a uniform B-spline gives
every control point the same parameter interval, so unevenly spaced
marching-squares vertices vary the curvature for reasons that are not about the
shape. The fit itself is unchanged and stays for the reason it always had — it
carries no denominator that can vanish, and `draw()` latches `canvasError`.
What changed is that the ring is resampled to even arc length before it
(`resampleRing`). See
`docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.

A curve does not re-facet, because the rasterizer flattens it in **device**
pixels: at any zoom the browser subdivides until the error is sub-pixel _on
screen_. That is the whole reason a curve is the answer and a finer polyline
is not, and it holds for an approximating fit exactly as it did for an
interpolating one.

`regionPathFor` in `graphFolderRegion.ts` is the single place a region path is
built — B28 made it so — which is why the fit has exactly one seam to live at.

**NURBS was rejected on the wrong grounds the first time, and the correction
belongs here rather than being quietly dropped.** The rejection of the
_representation_ was right and still stands: `Path2D` speaks lines, quadratic
and cubic Béziers and arcs, not rational curves; a NURBS would be evaluated
down to Béziers anyway, and the rational weights buy nothing when there is no
conic to represent. But the user's opening suggestion was never about the
representation — it was about **interpolating versus approximating** a set of
points, which is exactly the axis the wobble turned out to live on, and on
that axis the user was correct. The fit now shipping is the approximating
one: a B-spline evaluated to the cubic Béziers `Path2D` already speaks.

### The convex-hull property, and why it replaces the centripetal argument

The first, interpolating fit needed **centripetal parameterisation** (knot
spacing `distance ** 0.5`, α = 0.5) specifically because marching-squares
vertices bunch tightly at grid corners — two vertices a hair apart, then a
long run across a cell — and a uniform knot spacing over spacing like that
overshoots badly and can loop an interpolating curve back through itself
exactly there, a self-intersecting fill in the one place the contour is most
detailed.

A uniform B-spline has **no knot-spacing division at all** — every blending
weight in `segmentControls` is a literal count of thirds and sixths, not a
function of distance between points — so that failure mode has no seam to
reopen through. What guarantees it instead is the **convex-hull property**: a
B-spline segment lies entirely within the convex hull of its four control
points, by construction, for any spacing of those points. Overshoot and
self-intersection within a segment are not merely unlikely, they are
impossible: the segment cannot leave the hull to loop back through itself.
The concern that made centripetal parameterisation load-bearing the first time
is still handled — it did not stop mattering, it moved to a stronger
guarantee that comes for free with the fit.

The construction, written out so it is not reinvented — this is what
`segmentControls` in `graphFolderRegion.ts` computes:

For a segment spanning ring vertices `p1 → p2` with neighbours `p0` and `p3`,
the segment's on-curve `start`, its two control points, and its on-curve `end`
are

```
start    = (p0 + 4*p1 + p2) / 6
control1 = (2*p1 + p2) / 3
control2 = (p1 + 2*p2) / 3
end      = (p1 + 4*p2 + p3) / 6
```

and the segment is `bezierCurveTo(control1, control2, end)`, having already
`moveTo`'d or landed on the previous segment's `end`, which equals this
segment's `start` exactly.

**The wrap reaches one step past each end of the segment, not one step past
the ring.** For the segment from ring vertex `i` to `i + 1`, `p0` is vertex
`i − 1` and `p3` is vertex `i + 2`, both taken modulo the ring length. The
minimum case is a three-vertex ring `[A, B, C]`, where the segment `A → B`
takes `p0 = C` (the predecessor of `A`) and `p3 = C` (the successor of `B`) —
the same vertex in both roles. That is correct, not a symptom of an
off-by-one, and it is the case a test should pin, because an implementation
that wraps against the wrong length produces it by accident on longer rings
too.

### Three traps the implementation must handle

**The loops arrive with a duplicated first point.** `stitch` ends every loop
with a point whose weld key equals `loop[0]` — either the walk arrived back at
the start, or line 218 force-closed it. A uniform B-spline has no
knot-spacing division to break on a zero-length final segment, but a
duplicated point is still a duplicated control point, which is a bunch of one
at the seam. Drop the trailing duplicate first, then treat the remainder as a
ring.

**Marching squares bunches vertices tightly at grid corners.** A uniform
B-spline weights every vertex equally regardless of how close it sits to its
neighbours, so a tight bunch — two vertices a hair apart, then a long run
across a cell — tugs the curve locally even though the fit approximates
rather than interpolates. This is not the self-intersection risk the
interpolating fit carried; the convex-hull property already rules that out.
It is a smoothness concern: a near-duplicate vertex is a control point that
adds almost nothing but still gets a full vote. `graphFolderRegion.ts` welds
ring vertices within `DEVICE_WELD` (1.5 device pixels) of the previously kept
one before fitting — a near-duplicate weld, not decimation, since it only
ever removes vertices that sit a fit-worthy distance apart, never ones that
are merely close together along a smooth run.

Both degeneracy traps are resolved before `segmentControls` ever runs, so the fit itself
has no denominator that can vanish and nothing left to guard: a finite ring
in guarantees a finite curve out. A `NaN` reaching `bezierCurveTo` would not
throw — the canvas silently drops the sub-path — but `draw()` latches
`canvasError` after a single throw anywhere in the frame, so a region bug
that _does_ throw blanks the plot permanently for that renderer's life. The
curve builder must be total: no exceptions, no `NaN` reaching
`bezierCurveTo`.

**Fit after projection, not before.** Project each loop point to screen first,
then build the curve in device-pixel coordinates. The projection is a uniform
similarity (translate plus one scale), so curve fitting commutes with it and
the shape is identical either way — but doing it after means the weld
threshold above is in device pixels, where "near-duplicate" actually means
"sub-pixel", rather than in data units where the right threshold depends on
the graph.

A loop with fewer than three unique points keeps today's `lineTo` path. There
is no curve to fit through two points, and the fallback keeps the builder
total.

## Decision 2: the falloff radius tightens past the fit zoom, and only past it

A pure `regionFalloffRadius(spread, scale, fitScale)` replaces the literal
`spread * 0.04`. The rule the user approved:

```
min(spread * 0.04, spread * 0.04 * fitScale / scale)
```

(The user's manual walk on 2026-09-10 found the first-shipped fraction, 0.06,
too large at every zoom bucket — right in direction, too loose in size — and
chose 0.04, a third tighter. That scales the halo at every bucket at once; the
tightening past the fit zoom described below is unchanged.)

At or below the fit zoom the second term is the larger, so the radius is
exactly today's value and the zoomed-out view the user called fine is
byte-identical. Past the fit zoom the data-space radius shrinks in inverse
proportion to the zoom, which is the same statement as **the halo holding a
constant size on screen**. The crossover sits at the fit zoom, so there is no
seam and no magic pixel constant anywhere in the formula.

The dilation stroke is unchanged: it stays device-pixel, so a folder keeps a
constant clearance around the node discs at every zoom, as D3 decided.

### Quantised, so the cache stays honest

The contour cache key today is `${layoutRevision}:${keySignature}` per folder,
and pan and zoom never invalidate it. Making the radius a function of `scale`
would invalidate it on every wheel notch. So the zoom enters through a
**quantised bucket** of about 12% per step:

```
ZOOM_STEP  = 1.12
bucket(scale, fitScale) = clamp(round(log(scale / fitScale) / log(ZOOM_STEP)), 0, MAX_BUCKET)
radius(spread, bucket)  = spread * 0.04 * ZOOM_STEP ** -bucket
```

Clamping the bucket at zero is what makes "at or below the fit is unchanged"
exact: every scale at or below the fit lands in bucket 0, and bucket 0's
radius is `spread * 0.04` to the last bit.

Deriving the radius **from the bucket** rather than from the raw scale is
deliberate. If the radius came from the raw scale while the cache key came
from the bucket, two frames sharing a bucket would draw a contour computed at
some other frame's radius — a cache that lies. Quantising the radius makes the
key exact. The cost is that the radius tracks the approved formula in 12%
steps rather than continuously; the two agree at every bucket boundary and are
never more than 6% apart between them — under a third of a grid cell, since
the pitch is a fifth of the radius.

The radius is therefore a function of `spread` and the bucket alone;
`fitScale` enters only through the bucket. So the cache key is

```
`${layoutRevision}:${bucket}:${keySignature}`
```

and that is exact: a pan does not change the bucket and recomputes nothing; a
slow zoom across the whole range recomputes a handful of times; a resize
changes `fitScale`, hence the bucket, hence the key, which is correct because
the fit zoom itself moved.

**No hysteresis, but the reason is not that a recompute is free.** A zoom
parked on a bucket boundary — a trackpad drifting by a percent either way —
recomputes on every crossing. Stamping bounds the _field_ build at
`O(nodes × ~100)`, but marching squares still walks every cell, and the cell
count grows quadratically as the pitch tightens: about 15 600 cells at bucket 0
and about 924 000 at the floor. So the flicker case is cheap where the reader
spends their time and is at its most expensive exactly where the boundaries
are closest together in screen terms. Adding a deadband is a change to the
bucket function alone and does not touch anything else in this spec, so it is
left out until the manual walk says whether a boundary is findable by hand.
The walk should look for it: park the zoom mid-tighten and jiggle.

### Where `fitScale` comes from

`fitScale` is computed, not remembered:

```
regionFitScale(plotWidth, plotHeight, extentWidth, extentHeight)
  = min(plotWidth / extentWidth, plotHeight / extentHeight)
```

over the plot rect in device pixels and the bounding box of **all** laid-out
positions — the same positions `dataSpread()` already walks, which gains a
sibling returning both extents rather than only the larger side. Zero or
non-finite extents fall back to today's constant radius.

The alternative — latching the scale of the last `fitView()` — is rejected. A
saved graph restores a transform and may never fit at all, so the latch would
be undefined at first paint; and pressing "Fit" would silently redefine where
the halo starts tightening, which is a viewport control quietly editing a
drawing rule.

On a whole-graph fit this definition is deliberately an **upper bound** on
`fitView`'s own scale: `fitView` divides a smaller available box (canvas minus
axis gutters) by a larger extent (positions plus label padding), so its scale
is the smaller of the two. The consequence is the safe one — after pressing
"Fit" the view sits at or below the crossover, in bucket 0, at today's radius.

Two cases sit above it, and both are right. `fitView` fits the **visible**
nodes, and `fitKeys` fits a named handful, so fitting a filtered graph or a
selection can land past the crossover — but that is genuinely a zoom into part
of the graph, and the halo tightening there is the behaviour being asked for.
The other is `fitView`'s lower clamp of 0.15 on a graph too large to fit at
all, where the plot is unreadable for reasons this spec does not touch.

### The grid must follow the radius, and the work must stay bounded

Two consequences fall out of a shrinking radius, and neither is optional.

**Pitch follows radius.** Today `pitch = spread * 0.008` is exactly
`radius / 5`. Holding the literal while the radius shrinks under-samples the
field: at 8× the falloff would be narrower than a cell and the contour would
break into rubble or vanish. `pitch = radius / 5` keeps the fidelity of the
contour relative to the falloff constant, and at bucket 0 it is
`spread * 0.008` exactly.

**The field build changes from per-cell to per-node stamping.** `fieldAt`
evaluates every node against every cell — `O(cells × nodes)`. Cells scale as
`(bbox / pitch)²`, so tightening by 8× multiplies them by 64, and a folder
spanning the plot would reach hundreds of millions of evaluations per bucket
change. Because each node's bump has **compact support** (it contributes
nothing beyond `radius`), the same sum can be accumulated by stamping each
node into the cells within its own footprint: `O(nodes × (radius/pitch)²)` =
`O(nodes × ~100)`, constant at every zoom. This is an exact refactor — the
same sum, in a different order — and the unit suite pins it against the
current evaluator on a fixture.

**The tightening is floored at 8×** (`MAX_BUCKET = 18`, since
`1.12 ** 18 ≈ 7.7`). This floor is about work and memory, not about looks: the
grid grows quadratically with the tightening and there is nothing to stop it
otherwise, since the viewport scale clamps at 8 while `fitScale` can sit well
below 1, so a ratio in the twenties is reachable on an ordinary graph. With
this floor and `pitch = radius / 5`, the grid never exceeds roughly 961 steps
across a folder's bounding box, about 924 000 cells. A hard cell budget
(1 200 000), held as one `Float64Array`, stays in the code as a guard; with
the floor in place it cannot trigger, and if a future change makes it trigger
it coarsens the pitch rather than allocating unboundedly.

The honest cost of the floor: past 8× beyond the fit, the halo starts growing
on screen again, which is the original complaint returning in the far corner
of the zoom range. It returns gradually rather than at full size, and the
alternative is an allocation cliff on a wheel notch. If the user finds that
corner reachable in practice, the floor is the number to revisit — not the
rule.

The field grid is worth holding as one flat `Float64Array` rather than an
array of arrays at these sizes; that is an implementation note, not a
requirement.

## The reversal, and why it is allowed

D3's spec, "Where the regions are computed", says:

> Data space, not screen space, and that is the load-bearing choice. […] In
> data space the topology is invariant under pan and zoom, and a folder
> fragments only when its papers genuinely are apart.

and D3's verification list requires that "the same nodes under two different
zoom levels produce the **same contour**". D3's review offered "document
splitting-on-zoom as intended" as a way out and the spec called that
indefensible — "B12's fault in another costume", a reader's handle on a folder
moving under them for reasons that are not about the papers.

**Decision 2 reverses that, knowingly.** The reason D3's review never weighed
is the one the user gave: zoomed in, a data-space hull has its edge off-screen
and stops telling the reader anything. The region swallows the viewport, and a
shape that covers everything identifies nothing. D3 traded a high-zoom failure
it had not seen for a low-zoom invariance it had — reasonably, before B28 made
any of it visible.

What makes the reversal defensible rather than a relapse is that it is
**scoped**:

- The topology is still invariant across the **entire zoomed-out range**, and
  through the fit view, and byte-identical there to what D3 shipped. The
  reader's handle on a folder does not move in the range they spend their time
  in.
- It only tightens **past the fit**, where the alternative is not a stable
  shape but an edge nobody can see.
- It is monotone in the zoom and moves in 12% steps, so pulling in splits a
  territory into its papers gradually. A step that small reads as the shape
  following the zoom, not as a jump — and the alternative, a continuous
  radius, is a cache that recomputes on every wheel notch.
- The device-pixel dilation D3 introduced for exactly this mirror problem is
  kept, not replaced. This is the second half of the same idea: D3 held the
  _clearance_ constant on screen; D6 holds the _halo_ constant on screen too.

**D3's spec must be amended in the same commit**, not left to contradict this
one: the "data space, not screen space" paragraph and the same-contour
verification bullet both get a note pointing here, saying the invariance now
holds at or below the fit zoom and why. The module docstring at the top of
`graphFolderRegion.ts` carries the same claim in the same words and gets the
same treatment. A later reader must find the reversal named, with the reason
attached, wherever they enter the story.

## What changes, file by file

- **`src/services/graphFolderRegion.ts`** — `regionPathFor` gains the
  uniform periodic cubic B-spline fit; new pure exports
  `regionZoomBucket(scale, fitScale)`, `regionFalloffRadius(spread, scale,
fitScale)` and `regionFitScale(plotWidth, plotHeight, extentWidth,
extentHeight)`; `folderRegionContours` builds its field by stamping each
  node's compact support rather than evaluating every cell against every node,
  and takes its pitch from the radius. Still DOM-free apart from the `Path2D`
  the caller's window supplies.
- **`src/services/citationGraphRenderer.ts`** — `regionsFor` takes the plot
  rect and the current transform scale, computes `fitScale` and the bucket,
  derives the radius and pitch from them, and adds the bucket to each folder's
  cache signature. `dataSpread()` gains a sibling returning both extents.
  `drawRegions` passes the plot rect through. Nothing else in the draw path
  changes: same layer compositing, same `0.25` blend, same `1.6 * ratio`
  outline, same `evenodd` fill.
- **`docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`** — the
  two amendment notes described above.
- **`docs/superpowers/handoffs/2026-09-08-roadmap.md`** — D6 ticked, the manual
  check appended to the batch, a Log line.

## Verification

**Unit — the curve builder** (`graphFolderRegion.test.ts`, against a fake
window carrying a recording `Path2D`):

- A square loop emits one `bezierCurveTo` per unique vertex, a single
  `moveTo`, and a `closePath` — the ring wraps, so the count is the vertex
  count, not the vertex count minus one. The `moveTo` lands on the first
  segment's `start`, which is an averaged point and not a ring vertex.
- A loop arriving with its duplicated first point (what `stitch` actually
  produces) emits the same commands as the same ring without the duplicate: no
  zero-length segment at the seam.
- The convex-hull property, on a four-point square: **every emitted point —
  both control points and every segment's end point — lies within the hull of
  the ring**, because each is a convex combination of ring vertices. The curve
  sits inside its control polygon rather than bulging past it, which is the
  approximating fit's signature and the inverse of what an interpolating one
  does. Pinned alongside hand-checked exact values for the first segment, so a
  swapped `control1`/`control2` or a `4` where a `2` belongs still fails — a
  "did it emit four curves" count does not.
- A three-vertex ring — the minimum curve case — emits three curves, and the
  segment `A → B` uses `C` as both `P0` and `P3`. This pins the wrap.
- Two vertices a hair apart — the grid-corner bunching case — produce finite
  control points, no `NaN`, no throw.
- Coincident vertices produce finite control points and no throw. There is no
  fallback to assert any more: the blending weights are literal thirds and
  sixths, so coincident control points are simply weighted like any others.
- **Radial jitter tolerance**: a ring whose vertices alternate by a small
  perpendicular jitter around a smooth path — the grid-quantisation case —
  produces a curve that deviates from that path by less than the raw
  vertices do. An interpolating fit cannot pass this, so the case is worth
  keeping. **Correction, 2026-09-10 (region shapes):** this is not the
  wobble's cause, and not the discriminating case either. The same
  measurement recorded at ~line 71 above found that removing this jitter
  entirely barely moves curvature smoothness (0.0511 → 0.0514), while evening
  the vertex spacing does (→ 0.0416) — the wobble is a parameterisation
  artefact, not a jitter one. The discriminating case is the uneven-spacing
  one, and it lives in the newer design,
  `docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.
- **Totality on abuse**: a zero-area loop (every vertex identical), a
  single-point loop, a loop carrying a non-finite coordinate, and an empty
  loop list each return a path or `null` and **throw nothing**. This is the
  direct guard on the `canvasError` latch: one throw here blanks the plot for
  the renderer's life, so the test asserts the absence of an exception, not
  the shape.
- A two-point loop still draws with `lineTo`.
- A window without `Path2D` still returns `null` (B28's guarantee, unchanged).

**Unit — the radius and the bucket**:

- `regionFalloffRadius` below, at and above the fit: below and at give
  `spread * 0.04` exactly; one bucket above gives `spread * 0.04 / 1.12`;
  far above saturates at the 8× floor.
- `regionZoomBucket` is 0 for every scale at or below the fit, rises in 12%
  steps, and clamps at `MAX_BUCKET`.
- `regionFitScale` on a known plot rect and extent, and its fallback on a zero
  extent. A zero-area bounding box, a zero or non-finite `scale`, and a
  zero `spread` each fall back to bucket 0 and today's constant radius rather
  than returning `NaN` — the same totality rule as the curve builder, on the
  other input.
- The cache signature changes when the bucket changes and **does not** change
  under a pan — asserted at the renderer's boundary
  (`citationGraphRendererRegions.test.ts`): pan the transform, assert
  `folderRegionContours` was not called again; zoom past a bucket edge, assert
  it was.
- The stamped field build reproduces the current evaluator's contour on a
  fixture, vertex by vertex to 1e-9.
- D3's zoom-invariance test is **rewritten, not deleted**: the same nodes at
  two scales at or below the fit still produce the same contour; past the fit,
  a higher scale produces a different and tighter one. Deleting it would erase
  the record that the invariance was ever a rule.

**Zotero** (`graphFolderRegions.test.ts` or a sibling): a region survives a
zoom-in through the plugin's own gesture — still painted afterwards, and its
path actually changed. Driven through the plugin's menus and canvas, not an
imported service, since the test add-on is a second copy of `src`.

**Manual**, appended to the roadmap's batch:

- Zoom into a folder graph: the territory pulls apart into its papers as you
  go in, smoothly at every step, and never fragments or jumps while zooming
  out through the fit view.
- A folder's outline reads as a curve at every zoom, including at maximum
  zoom on a folder's corner — no chamfered polygon at any step.
- Park the zoom part-way into a tighten and jiggle it by a percent either way:
  the region should not stutter or pulse. If it does, the bucket function
  wants a deadband — see "No hysteresis" above, which is why this check is
  here.
- The Error Console stays quiet throughout. (`draw()` latches `canvasError`,
  so one throw blanks the plot permanently; a quiet console is the check that
  the curve builder is total.)

## What this does not do

- **It does not touch region membership.** A region is still built from the
  folder's _visible_ nodes, so the search box still reshapes a hull
  mid-keystroke — backlog **B26**, still open, and deliberately not decided
  here.
- **It does not fix B25 or B27**, both of which live in the code this spec
  touches. B25: the category ledger is not persisted. B27: an out-of-range
  swatch index draws `strokeStyle = undefined` and canvas silently keeps the
  previous region's colour. Read both before editing `regionsForRenderer` or
  the swatch lookup, since a bad colour will look like a D6 regression.
- **It does not reset `canvasError`.** Whether the latch should clear on the
  next `setRegions`/`setModel` is an open design question nobody has taken;
  this spec only makes sure it is not tripped.
- It does not change what papers are on the plot, the scope model, the seed
  colours, the ramp, or the in-library ring.
- It does not change the threshold, the case table, the saddle rule or the
  stitching. The `stitch` force-close remains silent, as its docstring warns.
