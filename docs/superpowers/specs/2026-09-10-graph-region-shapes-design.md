# Region Shapes: An Exact Circle for a Lone Paper, a Smooth Blob for a Cluster

**Date:** 2026-09-10
**Status:** Draft, awaiting the user's review

The follow-up round to D6. D6 shipped
(`docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`), the user
walked it, and two complaints stayed open: the outline is better but **still a
bit wobbly**, and the offset **should be smaller still**. Handoff:
`docs/superpowers/handoffs/2026-09-10-d6-followup-handoff.md`, which argued the
two are one question. They are, and the seam turned out to be one level below
where the handoff put it.

This spec amends D6 rather than replacing it. D6's two decisions stand: the
outline is a curve rather than a polyline because a polyline in data space
re-facets as you zoom, and the falloff radius tightens past the fit zoom so the
halo holds its size on screen. What changes is what the curve is fitted to, and
what the grid is for.

Do not re-derive D6. Read it first; this spec assumes it.

## What the measurements said

Everything below was measured against the exact level set, not eyeballed. The
field is `1 − d²/R²` and the threshold is `0.5`, so a lone paper's contour is
the circle of radius `R·√(1−t)` = `R/√2` — an exact answer to compare against.

**Raising `DEVICE_WELD` is not the lever**, which is the cheap check the
handoff proposed and the first thing tried. On a lone paper, raising it from
1.5 to 6 device pixels changes nothing at all: that ring has no bunched
vertices to weld (spacing max/min = 1.2). On a real multi-paper folder it does
help — it deletes genuine near-duplicates — but at an equal final vertex count
arc-length resampling beats it by about a quarter on every smoothness measure.
The weld is a degeneracy guard that happens to smooth a little, not a
smoothness control.

**The handoff's diagnosis is right and D6's stated cause is wrong.** The two
candidates were isolated on the same ring, fed to the same shipping fit:

| ring                                                | vertices | curvature sd |
| --------------------------------------------------- | -------- | ------------ |
| raw — grid jitter _and_ uneven spacing (what ships) | 180      | 0.0511       |
| jitter removed, spacing left uneven                 | 180      | 0.0514       |
| spacing evened, jitter kept                         | 155      | 0.0416       |

Newton-refining every vertex onto the exact level set — removing grid
quantisation jitter **entirely** — improves smoothness by nothing at all.
Evening the spacing is what helps. So the wobble is a **parameterisation**
artefact, exactly as the handoff argued, and not the "grid jitter, averaged
away" story D6's spec and `graphFolderRegion.ts`'s docstring both tell. Those
two passages are wrong and are corrected in the same commit as the code.

That also settles the handoff's open choice between a non-uniform knot vector
and arc-length resampling. They are not two routes to one place with different
totality costs: resampling addresses the measured cause directly, and the
divisions live in a resampler where a degenerate ring falls back cleanly rather
than in the fit, which stays as total as it is today. That matters more than
elegance here, because `draw()` latches `canvasError`.

**`pitch = radius / 5` is buying almost nothing.** On a lone paper at 36 device
pixels of falloff — the size the halo holds at every zoom:

| divisor   | pitch   | raw vertex error | fitted curve error                 |
| --------- | ------- | ---------------- | ---------------------------------- |
| 5 (ships) | 7.2 px  | 0.14 px          | **0.51 px**, all of it inward bias |
| 4         | 9.0 px  | 0.30 px          | 0.90 px                            |
| 3         | 12.0 px | 0.59 px          | 1.60 px                            |

The approximating fit's own inward bias dominates the grid's error by three and
a half times at today's divisor. The grid is held to a seventh of a pixel
underneath a curve that misses by half of one. On a sixty-paper folder the
topology holds — one loop, no fragmentation — all the way down to divisor 1.5.

The bias is the fit's signature, not a defect: a uniform cubic B-spline's
on-curve points are `(p0 + 4p1 + p2)/6`, so on a circle of radius `r` with
control spacing `h` the curve sits about `h²/6r` inside. It therefore hurts
**most where the shape is smallest** — which is exactly the lone paper this
spec stops sending through the grid at all.

## Decision 1: a folder is a set of shapes, not a set of loops

`folderRegionContours` partitions the folder's papers into connected components
under "closer than `2R`", and treats the two kinds of component differently.

Papers in different components are at least `2R` apart, so their supports are
disjoint and neither contributes anything to the other's field anywhere. This
is a **decomposition, not an approximation**: the union of the components'
contours is the folder's contour, exactly.

**A singleton component becomes a disc.** Its contour is the circle of radius
`radius * Math.sqrt(1 - threshold)` centred on the paper — exact, `R/√2` at
today's threshold, derived rather than written as a constant so a future
threshold cannot silently break it. `regionPathFor` emits `arc()`, which
`Path2D` speaks natively. No grid, no fit, no wobble, no inward bias, and it is
right at every zoom for nothing.

**A multi-paper component gets a grid and a blob.** Same field, same threshold,
same marching squares, same stitching, same `evenodd` fill, same device-pixel
dilation stroke as today.

`2R` is deliberately conservative. The exact isolation radius is
`R(1 + √(1−t))` ≈ `1.707R` — past that, no other paper's bump reaches any point
of this paper's circle — so papers between `1.707R` and `2R` apart are grouped
even though each would in fact draw an exact circle. Using the tighter
threshold would classify more papers as discs, but it would also let a grouped
component's grid omit a neighbour whose support genuinely overlaps its domain,
and reasoning about what that does off the contour is not worth the handful of
extra discs. One threshold, provably safe, is the trade taken.

### One lattice, one allocation per component

All components share **one lattice**: the folder's pitch, anchored at the
folder's min corner exactly as today. Each component allocates only its own
bounding box, snapped outward to that lattice.

This is what makes the change a pure optimisation for clustered papers rather
than a repaint. A component sampled on the shared lattice sees the same cell
corners it sees today, so **at a given radius and pitch every surviving loop is
byte-identical to the one that ships**. (Decision 2 then moves the radius and
the pitch, which of course moves the loops; the two changes are separable, and
this claim is the one the unit suite pins.) Anchoring each component's grid at
its own min corner instead would shift the sampling lattice per component and
move every vertex slightly — a visible change nobody asked for, and one that
would have forced the contour golden to be re-recorded.

### What this does to the golden

The contour golden ("sums the field to the same contour however it is
accumulated") holds numbers recorded from a pre-refactor implementation on
purpose. **It survives, and its numbers do not move.**

Its fixture is `(0,0)`, `(14,3)`, `(7,16)` and `(40,40)` at `radius: 10`. The
first three are one component; `(40,40)` is a singleton. The isolated paper sits
at the domain's **max** corner and the grid is anchored at the min corner, so
running the cluster alone against current `main` reproduces the golden's first
loop exactly: `length = 68`, `x = 475.8592418546`, `y = 439.2057750520`. Under
this design that loop is unchanged, to the last bit. What changes is that the
second loop leaves the loop list and comes back as a disc, so the golden's
second triple moves to a disc assertion — centre `(40, 40)`, radius
`10/√2` — while the first triple stays as it is written today.

The rule stands unchanged for the numbers that remain: **if the first loop's
three numbers fail, the code is wrong, not the golden.**

### The return type

```ts
interface FolderRegionShapes {
  /** The falloff radius the shapes were built at, in data units. */
  radius: number;
  /** The lattice pitch they were built at, in data units. */
  pitch: number;
  discs: { centre: RegionPoint; radius: number }[];
  loops: RegionPoint[][];
}
```

`folderRegionContours` returns this instead of `RegionPoint[][]`, and
`regionPathFor` takes it plus the transform's `scale`. A disc's radius needs the
scale, and the projection only maps points; carrying `radius` and `pitch` on the
shapes themselves rather than passing them separately means the path builder
cannot be handed a pitch from a different frame than the loops it is drawing.

A disc can legitimately sit inside another component's hole — a lone paper
ringed at a distance by a cluster. `evenodd` gets that right without help: a
point inside the disc crosses the outer loop, the hole loop and the disc, an odd
count, so it fills. No winding rule is needed on the arc.

### Blob loops are resampled to even arc length before the fit

The resampler walks the projected ring and emits points at even spacing. The
spacing is the **projected lattice pitch** — `pitch * scale` — times
`RESAMPLE_PITCH_FACTOR`, which starts at 1.

Deriving it from the pitch rather than writing a pixel constant is what stops
the resampler from ever *up*sampling. Resampling finer than the source inserts
points along straight chords: it adds no information, but it adds control
points, which un-smooths the fit back toward the polyline it came from. Tied to
the pitch, the resampler can only ever even the spacing out, never sharpen it.

`RESAMPLE_PITCH_FACTOR` is the smoothness knob, and it is the honest one:
coarser is smoother and loses genuine detail. It is the number to turn if the
build still reads wobbly, and turning it is a one-character change with no
budget consequence.

The resampler runs after `ringOf` and before the fit, and it is total: a ring
of zero total length, or fewer than three points, is returned unchanged rather
than divided by. Every division it does have is guarded by that one check. The
fit itself keeps no denominator at all, which is the property that matters
against the `canvasError` latch and the reason a non-uniform knot vector was
rejected.

## Decision 2: the knobs stop being one knob

Today `pitch = radius / 5` sets contour accuracy **and** control-point spacing,
which is why the offset could not come down without a grid argument. After the
resampler they are separate.

- **`PITCH_DIVISOR` 5 → 3.** Data space; its only job is contour accuracy. It
  was buying 0.14 px of fidelity under a fit missing by 0.51 px, and the case
  where a coarse grid hurt most — a small lone lobe, where the inward bias is
  largest — no longer touches the grid at all.
- **`RESAMPLE_PITCH_FACTOR` 1.** Device space; its only job is smoothness.
- **`FALLOFF_FRACTION` 0.04 → 0.03.** The user's second complaint, paid for by
  the two above. **Judge this on a build, not on arithmetic** — the fit's inward
  bias means part of the perceived tightening at 0.04 already came free, and
  drawing lone papers as exact circles gives about half a pixel of that back.
  It is now a number the grid gets no vote on, so moving it again is cheap.
- **`MAX_GRID_CELLS` 1 200 000 → 250 000.** It was raised twice chasing this;
  the measured worst case across every bucket is now about 15 000 cells. The
  budget applies to the **sum** across a folder's components, and on exceeding
  it every component's pitch coarsens by the same factor, so the shared lattice
  survives. With these settings it cannot trigger; it stays as the guard that a
  later change coarsens rather than allocating.
- **`MAX_ZOOM_BUCKET` 18 → 30.** D6 recorded the 8× tightening floor as a
  concession to work and memory, with the acknowledged cost that past 8× the
  halo starts growing on screen again — the original complaint returning in the
  far corner of the zoom range. That concession was bought by a cost curve this
  design inverts. The viewport scale clamps at 8 while `fitScale` can sit well
  below 1, so a ratio in the twenties is reachable on an ordinary graph;
  `1.12 ** 30 ≈ 30` covers it, and the halo holds its size everywhere.

Measured cells for a 300-paper folder, by bucket:

|                                 | 0    | 6    | 12    | 18        |
| ------------------------------- | ---- | ---- | ----- | --------- |
| today (`0.04`, `R/5`), one grid | 12 k | 41 k | 141 k | **451 k** |
| per component, same settings    | 12 k | 31 k | 44 k  | **21 k**  |
| per component, `0.03`, `R/3`    | 7 k  | 15 k | 13 k  | **5 k**   |

The decomposition inverts the curve. Today cells grow monotonically with the
zoom, which is precisely why the offset was stuck; per component they peak in
the middle and collapse, because at high zoom nearly every paper is a singleton
drawn as an arc with no grid at all. **A smaller offset now costs less than
today's larger one**, and the regime D6's fifth manual check worries about — a
large folder at maximum zoom — is the cheapest one rather than the most
expensive.

## What changes, file by file

- **`src/services/graphFolderRegion.ts`** — `folderRegionContours` partitions
  its papers into `2R` components over a shared lattice and returns
  `FolderRegionShapes`; a new pure `regionComponents` does the partition
  through a spatial hash at cell size `2R`, so a large folder stays linear
  rather than quadratic; `regionPathFor` takes the shapes and the scale, emits
  an `arc()` per disc, and resamples each loop to even arc length before the
  existing B-spline fit; `PITCH_DIVISOR`, `FALLOFF_FRACTION`, `MAX_GRID_CELLS`
  and `MAX_ZOOM_BUCKET` take their new values, and
  `RESAMPLE_PITCH_FACTOR` joins them. The module docstring's claim that the fit
  exists to average away grid jitter is corrected to name parameterisation.
  `cellSegments` gets its three-line early return for the empty codes 0 and 15,
  which dominate a sparse field and today allocate four closures each before the
  switch — the handoff's second open item, closed here because it lives in the
  function this work already rewrites the caller of.
- **`src/services/citationGraphRenderer.ts`** — `regionsFor` returns
  `Map<number, FolderRegionShapes>`; `drawRegions` passes the transform scale
  to `regionPathFor` and skips a folder with neither discs nor loops. Nothing
  else in the draw path changes: same layer compositing, same `0.25` blend,
  same `1.6 * ratio` outline, same `evenodd` fill, same cache key.
- **`docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`** — the
  passage giving grid jitter as the reason for the approximating fit is
  corrected to parameterisation, with the measurement, and the 8× floor's
  paragraph gains a note that its cost argument no longer holds and why. The
  fit's choice does not change; only the reason recorded for it.
- **`docs/superpowers/handoffs/2026-09-08-roadmap.md`** — the two walked-and-
  changed D6 checks reset, the new checks appended, a Log line.

## Verification

**Unit — the decomposition** (`graphFolderRegion.test.ts`):

- Two papers `3R` apart give two discs and no loops; the disc radius is
  `R·√(1−t)` to 1e-12 and the centres are the papers.
- Two papers `1.2R` apart give one loop and no discs.
- Two papers just inside `2R` give one component — the conservative boundary,
  pinned so a later "tighten it to 1.707R" is a deliberate change and not a
  drift.
- A cluster plus a distant paper gives one loop and one disc, and **the loop's
  vertices are identical to what the whole set produces today** — the shared
  lattice, asserted rather than assumed.
- The golden keeps its first loop's three numbers unchanged and asserts the
  singleton as a disc.
- A folder of 400 papers partitions without the partition itself becoming the
  cost — the spatial hash is exercised, not just the union-find.
- Totality: no papers, one paper, coincident papers, and a non-finite
  coordinate each return shapes and throw nothing.

**Unit — the resampler**:

- An unevenly spaced ring comes back evenly spaced to within a percent, with a
  vertex count matching the ring's arc length over the spacing.
- Resampling never increases the vertex count beyond the source's, on a ring
  whose spacing is already at the pitch.
- **Wobble**, the property this exists for: a ring with marching-squares-like
  uneven spacing, fitted after resampling, deviates from the underlying smooth
  path less than the same ring fitted without it. This is the discriminating
  test — D6's existing jitter test is _not_, since the measurement above showed
  the shipping fit already handles jitter and fails on spacing. D6's test stays;
  this one joins it.
- Totality: a zero-length ring, a two-point ring, and a ring carrying a
  non-finite coordinate each return a ring and throw nothing.

**Unit — the path**:

- A shapes object with one disc emits one `arc()` at `centre * scale` and
  `radius * scale`, and no `bezierCurveTo`.
- Discs and loops in one shapes object emit both, on one path.
- A window without `Path2D` still returns `null` (B28's guarantee, unchanged).

**Unit — the knobs**: `regionGridPitch` is `radius / 3`;
`regionFalloffRadius` at bucket 0 is `spread * 0.03`; `regionZoomBucket` clamps
at 30. D3's zoom-invariance test and D6's bucket tests are updated to the new
constants, not deleted.

**Unit — the renderer** (`citationGraphRendererRegions.test.ts`): the cache
assertion D6's own review flagged as not testing what it claims is fixed here
rather than carried forward — **count `folderRegionContours` calls**, assert a
pan makes none and a zoom past a bucket edge makes one. "A pan recomputes
nothing" is the load-bearing performance claim of the bucket design and nothing
currently verifies it.

**The suite itself.** One `npm test` run on 2026-09-10 reported 42 passed / 1
failed, two later runs were 43/0, and the case was never identified — the
known-intermittent `savedGraphMenu` case passed in the failing run, so it was
something else. Before this branch's suite is called green, run it a few times
with the full log kept (`npm test 2>&1 | tee <file>`) and find out what it was.
An unclosed gap is not a cleared one, and this branch must not inherit it.

**Zotero** (`graphRegionZoom.test.ts`): unchanged in intent — a region survives
a zoom-in through the plugin's own gesture and its path changes. Driven through
the plugin's menus and canvas, since the test add-on is a second copy of `src`.

**Manual**, replacing D6's first two checks in the roadmap's batch:

- A folder graph at the fit zoom: the territory reads as a smooth blob, and its
  outline is a curve with no wobble and no facets.
- Zoom in until papers separate: a lone paper's halo is a clean circle at every
  zoom, and the territory pulls apart into those circles smoothly.
- The offset at `0.03` is right, or says which way to move.
- Park the zoom part-way into a tighten and jiggle it by a percent either way —
  D6's deadband check, still unwalked, and now cheaper to fail well.
- The Error Console stays quiet throughout. `draw()` latches `canvasError`, so
  one throw blanks the plot permanently; a quiet console is the check that the
  shape builder is total.
- Pan a folder of 300+ papers at maximum zoom: this is the check D6 appended
  and the regime this design makes cheapest, so a frame drop here means the
  draw path, not the contour.

## What this does not do

- **It does not touch region membership.** A region is still built from the
  folder's _visible_ nodes, so the search box still reshapes a hull
  mid-keystroke — backlog **B26**, still open.
- **It does not fix B25 or B27.** B27 will look like a regression: an
  out-of-range swatch index draws `strokeStyle = undefined` and canvas silently
  keeps the previous region's colour. Read both before editing the swatch
  lookup.
- **It does not reset `canvasError`.** Still nobody's decision.
- **It does not skip off-screen loops in `drawRegions`.** That is the handoff's
  third open item and the cheap mitigation if the pan check bites; it is a draw-
  path change with its own measurement, not part of this one.
- It does not change the threshold, the case table, the saddle rule or the
  stitching, and `stitch`'s silent force-close stays as its docstring warns.
