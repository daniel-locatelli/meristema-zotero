# Handoff: D6's follow-up is specced and approved; next is the plan

Date: 2026-09-10. Branch `main` at `c1cee1c`, **two commits ahead of
`origin/main` (`cba8320`), both documentation** — ask before pushing. Tree clean
apart from an untracked `.claude/`.

The previous handoff said `main` was ten commits ahead and unpushed. That is
stale: `git ls-remote origin main` puts the remote at `cba8320`, so D6 and its
follow-up round are already on the remote and only this session's spec and
handoff are not. Checked, not assumed — the number had been copied forward
through two handoffs.

`npm run check`: not re-run this session; no product code changed. The XPI at
`.scaffold/build/meristema.xpi` is still the one built from `92178db` and is
**one commit stale only in documentation**, so it is still the right build to
walk D6's unwalked checks on.

Read `docs/superpowers/handoffs/2026-09-08-roadmap.md` first, as always.

## Where this sits

D6 shipped, was walked, and left two complaints open: the outline is better but
**still a bit wobbly**, and the offset **should be smaller still**. The previous
handoff (`2026-09-10-d6-followup-handoff.md`) argued they were one question. They
are. This session brainstormed them, measured the diagnosis rather than assuming
it, and the design is written and approved:

- **Spec:** `docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`
  (commit `4844663`). Approved by the user in conversation. **Do not re-derive
  it, and do not re-derive D6** — D6's spec is current and this one amends it.

The spec carries the measurements, the decisions and the verification list.
Everything below is what it cannot carry.

## What the next session does

Write the implementation plan (`superpowers:writing-plans`) into
`docs/superpowers/plans/2026-09-10-graph-region-shapes.md`, branch
`graph-region-shapes`, then execute it with
`superpowers:subagent-driven-development` — the repo's established process, the
same shape D6 itself followed.

The spec's "What changes, file by file" and "Verification" sections are the plan's
raw material. Two things worth deciding while planning rather than discovering
mid-execution:

1. **Task order.** The decomposition (Decision 1) and the constant changes
   (Decision 2) are separable, and the spec's byte-identical claim only holds
   _at a given radius and pitch_. Landing the decomposition first, with the
   constants untouched, makes that claim directly testable against the current
   contours; moving the constants afterwards is then a one-task change whose
   diff is four numbers. Doing it the other way round leaves nothing pinning the
   lattice.
2. **The return-type change ripples.** `folderRegionContours` stops returning
   `RegionPoint[][]`, which moves `regionsFor`'s map type in
   `citationGraphRenderer.ts` (line ~1297) and `drawRegions`' call to
   `regionPathFor` (line ~1405). Both are small, but every existing region unit
   test constructs or asserts on the old shape.

## What this session established that is not in the spec

The spec records the conclusions. These are the working facts behind them, in
case a number needs re-deriving:

- The measurement harnesses live in the session scratchpad, not the repo:
  `C:\Users\nunesd\AppData\Local\Temp\claude\C--repos-github-daniel-locatelli-meristema-zotero\c347ad6e-ff64-4808-a2cc-cdd974d2686f\scratchpad\`
  — `__wobble.ts` (lone-paper circle error vs `DEVICE_WELD` and vs resample
  spacing), `__wobble2.ts` and `__wobble4.ts` (the jitter-vs-spacing isolation,
  which is the discriminating experiment), `__wobble3.ts` (an abandoned kernel
  comparison — its C1/C2 rows are unreliable, ignore them), `__pitch.ts` (what
  `PITCH_DIVISOR` buys), `components.ts` (the cell-count table). They run with
  `node --import ./test/nodeResolve.mjs <file>` **from the repo root with the
  file copied into `test/unit/`**, since the import path is relative. They are
  scratch, deliberately not committed, and are not a substitute for the unit
  tests the spec asks for.
- `wobble3.ts` asked whether the _field_ is lumpy — whether the wobble is
  genuine geometry rather than artefact. It is not: the exact level set of the
  shipping kernel has zero inflections on the fixture measured. That is why the
  spec proposes no kernel change, and it is a dead end already walked.
- The golden's cluster numbers were re-derived from current `main` this session
  and are quoted in the spec (`length = 68`, `x = 475.8592418546`,
  `y = 439.2057750520`). They survive the decomposition because the grid is
  anchored at the domain's **min** corner and the fixture's isolated paper sits
  at the max corner. That is luck, not design — hence the spec's shared-lattice
  requirement, which turns the luck into a rule.

## Traps, carried forward

All of these are the user's own list plus what the last handoff recorded. None
have been retired.

- **Do not kill the user's Zotero.** Never `Stop-Process zotero` without asking.
  Try `npm test` first; only on an actual EBUSY failure, and ask first.
- `npm test` **deletes** `.scaffold/build/meristema.xpi`. Build the XPI **after**
  the last test run.
- `draw()` latches `canvasError` after a single throw and never paints again for
  that renderer's life; only a new renderer recovers it, not "Fit". This is why
  every function in `graphFolderRegion.ts` must be total, and it is the whole
  argument for putting the resampler's divisions in the resampler rather than
  reinstating them in the fit.
- The contour golden's numbers were recorded from pre-refactor code on purpose.
  **If the first loop's three numbers fail, the code is wrong, not the golden.**
  The spec explains precisely which of its assertions may move (the isolated
  paper's, which becomes a disc) and which may not.
- The Zotero test add-on is a second copy of `src`, so a UI-path test drives the
  plugin's own menus and controls, never an imported service.
- `describe.only` plus `npm test` is about a minute end to end. **Take the
  `.only` off** — `npm run check` does not run the Zotero suite.
- Backlog **B25, B26 and B27** are open and all live in this code. **B27 will
  look like a regression**: an out-of-range swatch index draws
  `strokeStyle = undefined` and canvas silently keeps the previous region's
  colour.
- **The unidentified test failure is still unclosed.** One `npm test` run on
  2026-09-10 was 42 passed / 1 failed with the case never named; two later runs
  were 43/0, and the known-intermittent `savedGraphMenu` case passed in the
  failing run, so it was something else. The spec makes logged repeat runs a
  gate on this branch. Do not inherit it silently.

## Open, and deliberately not in this spec

- `drawRegions` rebuilds every `Path2D` every frame, including loops entirely
  off-screen. Left out on purpose: it is a draw-path change wanting its own
  measurement, and this design makes its worst case the cheapest one. The
  roadmap's fifth D6 manual check is what would reopen it.
- `FALLOFF_FRACTION = 0.03` is reasoned, not measured. Drawing lone papers as
  exact arcs hands back about half a pixel of halo the fit's inward bias was
  removing, so the change is not simply "a quarter tighter". Judge it on a
  build; it is one character to move and the grid no longer gets a vote.

## Where the manual batch stands

Unchanged from the last handoff, and the roadmap is the record. D6's first two
checks are recorded as walked-and-changed and are **replaced** by this spec's
list — but only when its code lands, since the spec requires the roadmap edit in
the same commit. D3's six checks are still unwalked and need rewalking on
whatever ships next anyway. The migration check stays fragile: it needs a graph
still on state version 2, and the first save rewrites it, so it is walkable
exactly once per old graph.

## Suggested skills

- `superpowers:writing-plans` — the immediate next step. There is no
  brainstorming left to do; the design is approved and written.
- `superpowers:subagent-driven-development` to execute the plan, as D6 was.
- `superpowers:test-driven-development` inside the tasks. The spec's
  discriminating tests — the resampler's wobble test and the renderer's
  call-count assertion — must be watched red against the current code first, or
  they will pass for the wrong reason exactly as D6's pan assertion did.
- `superpowers:systematic-debugging` if the unidentified `npm test` failure is
  chased.
- Do **not** invoke `superpowers:brainstorming`. The design is settled.

## Prompt for the next session

> Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`, then
> `docs/superpowers/handoffs/2026-09-10-region-shapes-spec-handoff.md`, then the
> spec it points at,
> `docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.
>
> The spec is written, reviewed and approved — do not re-derive it, and do not
> re-derive D6, whose spec it amends and which is current. Go straight to
> `superpowers:writing-plans`: write the implementation plan to
> `docs/superpowers/plans/2026-09-10-graph-region-shapes.md` for branch
> `graph-region-shapes`, then execute it with
> `superpowers:subagent-driven-development`.
>
> Land the decomposition before the constant changes — the spec's
> byte-identical-loop claim only holds at a fixed radius and pitch, so that
> order is what makes it testable. Watch the two discriminating tests red first:
> the resampler's wobble test, and the renderer's `folderRegionContours`
> call-count assertion that replaces D6's pan check, which passes today whether
> or not the contour is recomputed.
>
> `main` is two commits ahead of `origin/main`, both documentation, and unpushed
> — ask me before pushing.
>
> Traps I do not want rediscovered: never kill my Zotero without asking;
> `npm test` deletes the XPI so build it afterwards; `draw()` latches
> `canvasError` after one throw, so any canvas error blanks the plot permanently
> and only a new renderer recovers it; the contour golden's numbers were
> recorded from pre-refactor code on purpose, so if its first loop fails the code
> is wrong, not the golden; and one `npm test` run last session was 42/1 with the
> case never identified — run it a few times with the log kept before calling
> this branch green.
