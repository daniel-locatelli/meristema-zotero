# Handoff: D6 designed and approved, spec not yet written

Date: 2026-09-10. Branch `main` at `364ccda`, tree clean apart from an
untracked `.claude/`. **Not pushed** — five commits sit ahead of the remote,
and the user has not been asked yet.

XPI `.scaffold/build/meristema.xpi` built from `cb27278`, after the last
`npm test` run. `npm run check`: green, 354 unit tests. `npm test`: 42 passed,
0 failed.

Read `2026-09-08-roadmap.md` first; it is still the single place that says
what comes next. This file carries what that one cannot: what B28 turned out
to be, and the two design decisions D6 has already taken.

## How to start

D6 has been brainstormed and its design was presented and accepted in
conversation. **Do not re-brainstorm it and do not reopen the two decisions
below.** The next step is the one brainstorming stops at:

1. Read `2026-09-08-roadmap.md`, then this file, then D6's entry in
   `2026-09-08-review-backlog.md`.
2. Write the spec to
   `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md` from the
   design recorded below, self-review it, and ask the user to review it.
3. Then `superpowers:writing-plans`, then subagent-driven execution on a
   branch off `main`.

## What D6 is, and the two decisions

The folder regions became visible for the first time when B28 was fixed, and
the user raised two complaints about how they look. Both were put to them as a
choice, and both are settled:

**1. The outline is smoothed with a centripetal Catmull-Rom → cubic Bézier
fit.** One `bezierCurveTo` per contour segment, control points from each
vertex's two neighbours, wrapping because the loops are closed. Centripetal
(knot spacing by `√distance`) is not a detail to swap out: marching-squares
vertices bunch tightly at grid corners, and a uniform parameterisation
overshoots and can loop back on itself exactly there. The contour is untouched
— same points, same topology, same `evenodd` fill, same dilation stroke — and
the fit lives inside `regionPathFor` in `graphFolderRegion.ts`, which B28 made
the single place a region path is built.

The alternatives were rejected for one shared reason: **a polyline in data
space re-facets as you zoom in**, because its segments grow on screen with
everything else. Chaikin subdivision and a finer grid both look smooth at the
fit view and go faceted again at 8x. A curve does not, because the rasterizer
flattens it in device pixels. NURBS was the user's opening suggestion and is
the wrong tool: `Path2D` speaks lines, quadratics, cubics and arcs, so a NURBS
would be evaluated down to one of those anyway, and the rational weights buy
nothing without a conic to represent.

**2. The falloff radius tightens past the fit zoom, and only past it.** A pure
`regionFalloffRadius(spread, scale, fitScale)` returns
`min(spread * 0.06, spread * 0.06 * fitScale / scale)`. At or below the fit
zoom this is exactly today's value, so the zoomed-out view the user said looks
fine is byte-identical; past it the data-space radius shrinks in inverse
proportion to the zoom, which is the same thing as holding the halo at a
constant size on screen. The crossover sits at the fit zoom, so there is no
seam and no magic pixel constant.

The contour cache key (`layoutRevision:nodeKeys` today) gains a **quantised
zoom bucket** — the scale rounded to steps of about 12% — so a slow zoom
recomputes a handful of times rather than once per wheel notch, and a pan
still never recomputes. The dilation stays device-pixel, so a folder keeps a
constant clearance around the node discs at every zoom.

### The reversal this carries, and why it is allowed

Decision 2 reverses D3 knowingly. D3's spec computes the field in **data
space** precisely so a folder's topology is not a function of the zoom; the
reviewer offered "document splitting-on-zoom as intended" and the spec called
that indefensible, "B12's fault in another costume". The user asked for the
splitting anyway, with a reason the review never weighed: **zoomed in, a
data-space hull has its edge off-screen and stops telling the reader
anything** — the region swallows the viewport and no longer says which papers
made it.

What makes it defensible now is that it is scoped: the topology is stable
through the entire zoomed-out range and only tightens past the fit, where the
alternative is an edge nobody can see. The spec must record this as a reversal
with the user's reason attached, not slide it in as an implementation detail.
Anyone re-reading D3's spec later will otherwise find a flat contradiction.

### Testing the spec should require

- Unit: the curve builder against a fake window (Béziers emitted, loop closed,
  no cusp at a right-angle turn); `regionFalloffRadius` below, at and above
  the fit; the cache key changing with the bucket but not with a pan.
- Zotero: a region survives a zoom-in — still painted, and its path actually
  changed.
- Manual: appended to the roadmap's batch — zoom into a folder graph and watch
  the territory pull apart into its papers, smooth at every step.

## What happened this session

The user walked D3's manual batch. Two checks passed; six were blocked by one
regression, now fixed.

**B28, fixed (`cb27278`).** A non-empty region selection blanked the plot: a
graph opened from a folder drew no nodes, a saved folder graph the same, and
selecting a folder's row on any graph lost the plot. Root cause: `drawRegions`
built its path with a bare `new Path2D()`, and the plugin's bundle runs in a
scope with no DOM constructors on it, so the live plugin threw "Path2D is not
defined" on the first frame with a region on it. `draw()` catches, latches
`canvasError` and never paints again, which is why the blank was permanent and
why unselecting could not repaint it. The renderer already took
`ResizeObserver` from `canvas.ownerDocument.defaultView`; the region path was
the one place reaching for a global. It now goes through `regionPathFor`.

The user confirmed the fix works in the installed plugin.

**Why the whole suite was green while the live plugin was blank** — worth
carrying, because it will happen again with the next DOM constructor:
`citationGraphRendererRegions.test.ts` polyfilled `Path2D` onto `globalThis`,
and every Zotero test scope has a global `Path2D` of its own. The tests were
supplying the constructor in the one place a plugin never has one. That double
now attaches it to the fake canvas's `defaultView`. **A test that deletes the
global does not work** and was tried: the test file's `globalThis` is not the
bundle's scope, so the renderer never notices. The only honest test is a pure
function handed a fake window.

**Filed from the walk:** B29 (light → dark leaves the plot background light),
B30 (a node outside Zotero's open folder selects some other item rather than
clearing), B31 (the rail does not show subfolders clearly), F10 (graph →
Zotero multi-select, carrying the question of whether multi-row selection
should ring nodes as one-row does), F11 (seed row ↔ seed node, both
directions), F12 (a Zotero folder selection activating its region — needs its
own brainstorm), F13 (show a paper's full title; today it ellipsises), and D6
itself.

## Where the manual batch stands

B28's own check is ticked. **Six D3 checks are unblocked and unwalked** —
regions opening, the toggle and the cap, the no-repaint rule, the four-seed
colour check, the migration check and the zoom check. The migration one is
the fragile one: it needs a graph still on state version 2, and the first save
after opening rewrites it to version 3, so it is walkable exactly once per old
graph.

Those six do not block D6. They will need rewalking after D6 lands anyway,
since D6 changes what a region looks like at every zoom.

## Traps

- **Do not kill the user's Zotero.** This session ran
  `Get-Process zotero | Stop-Process -Force` to clear the test profile and
  closed the session they were working in. Try `npm test` first; only kill on
  an actual EBUSY failure, and ask before doing it.
- `npm test` deletes `.scaffold/build/meristema.xpi`. Build the XPI **after**
  the last test run.
- The Zotero test add-on is a second copy of `src`, so a UI-path test drives
  the plugin's own menus and rows, never an imported service.
- A whole `npm test` run is not the reproduction loop: `describe.only` plus
  `npm test` is about a minute end to end. Take the `.only` off — `npm run
check` does not run the Zotero suite and will not catch it.
- `draw()` latches `canvasError` after a single throw, so **any** future
  canvas error blanks the plot permanently and only a new renderer recovers
  it — closing and reopening the graph tab, not "Fit". Whether that latch
  should reset on the next `setRegions`/`setModel` is an open design question
  nobody has taken.
- Region defects B25, B26 and B27 are still open from D3's own review and are
  all in the code D6 touches. Read them before editing `regionsForRenderer`
  or the swatch lookup.

## Not pushed

`259cd17..364ccda` is five commits ahead of `origin/main`: the walk's
findings, the two test commits, the B28 fix, and the D6 and F13 filings. Push
via `gh-daniel-locatelli` once the user says so.

## Prompt for the next session

> Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`, then
> `docs/superpowers/handoffs/2026-09-10-d6-region-curves-handoff.md`, then
> D6's entry in `docs/superpowers/handoffs/2026-09-08-review-backlog.md`.
>
> D6 is already brainstormed and its design is approved: the two decisions in
> the handoff are settled, so do not re-brainstorm and do not reopen them.
> Pick up at the step brainstorming stops at — write the spec to
> `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`, covering
> the Catmull-Rom → cubic Bézier fit inside `regionPathFor`, the
> `regionFalloffRadius(spread, scale, fitScale)` rule, the quantised zoom
> bucket on the contour cache key, and the reversal against D3's data-space
> decision with the reason that justifies it. Read D3's spec
> (`docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`) before
> writing that section so the contradiction is named rather than left for a
> later reader to find.
>
> Self-review the spec, then ask me to review it before you write the plan.
> After I approve: `superpowers:writing-plans`, then subagent-driven execution
> on a branch off `main`.
>
> Traps the handoff spells out and I do not want rediscovered: never kill my
> Zotero without asking, `npm test` deletes the XPI so build it afterwards,
> and `draw()` latches `canvasError` after one throw so any canvas error
> blanks the plot permanently.
