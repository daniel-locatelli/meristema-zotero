# Roadmap

The single place that says what comes next. Read this file first; then read
only the entry or spec the current item points to. Every session that finishes
an item ticks it here and commits the tick with the work.

Every session pays for this file's length, so keep it short. An entry states
the defect or question, the evidence that cannot be re-derived, and the first
task. When an item ships, delete its entry rather than filing it; git keeps it.
Compacted 2026-09-17: the long form of every entry below, with the user's
verbatim reports and the full diagnoses, is
`git show 54f007f:docs/superpowers/handoffs/2026-09-08-roadmap.md`, and
`git log --diff-filter=D -- docs/superpowers/handoffs/2026-09-08-roadmap-archive.md`
names the commit that removed the older archive.

Inputs (do not re-derive them):

- Backlog: `docs/superpowers/handoffs/2026-09-08-review-backlog.md`, the long
  form of the open entries filed up to 2026-09-11 (B7, B15, B18, B20, B26,
  B34, B36, F3 to F13, D5). Read one only when you take that item.
- Design: `docs/design_handoff_citation_chain_depth/README.md` (option 6a;
  open `#6a` in `Citation Chain Depth.dc.html`).
- D8's evidence: `docs/superpowers/handoffs/2026-09-16-d8-evidence.md`.
- Settled decisions: `CONTEXT.md` and `docs/adr/` (0001 to 0018).
- Ledger of finished plans: `.superpowers/sdd/progress.md`.

## Next

1. The open bugs.

Working rules: a feature branch per change, `npm run check` as the gate
(prettier covers `docs/` and `README.md`), the full Zotero suite every 4 or 5
commits and not per change (see Zotero suite), fast-forward to main,
`npm run build` last, push via `gh-daniel-locatelli`. Commits: sentence-case
subject, no type prefix, staged by path. Design items are `superpowers:brainstorming`, then a spec in
`docs/superpowers/specs/`, a plan in `docs/superpowers/plans/`, then
subagent-driven development; delete the plan, and then the spec, once the
work has shipped and nothing open cites them.

## Stages

Stages 1 and 2 (independent bugs; the rail Scope and toolbar reduction) are
shipped and walked.

### Stage 3: citation hops on demand

Built and merged from `docs/superpowers/specs/2026-09-12-citation-hops-design.md`.

- [x] manual walk-through by the user (2026-10-07; D7 holds the progress
      numbers open, and the refusal checks wait under Manual verification)

### Stage 4: citation floor and shared citers

Depends on Stage 3 and D8. The floor is settled in ADR 0016 (its spec, retired,
is `git show cc42c4a:docs/superpowers/specs/2026-09-18-citation-floor-design.md`);
shared citers (`docs/superpowers/specs/2026-09-28-shared-citers-design.md`:
a Seeds linked colouring and a shared rule after the floor, not the design's
opacity grade).

- [x] floor: brainstorm, spec, plan, implemented, reviewed, merged
- [x] floor: manual walk-through by the user (2026-10-07; D21 asks about
      papers with no count)
- [x] shared citers: brainstorm and spec
- [x] shared citers: plan
- [x] shared citers: implemented, reviewed, merged, XPI built, pushed
- [x] shared citers: manual walk-through by the user (2026-10-07; B78 waits
      under Manual verification, D20 asks about the view's naming)

## The hop fill

- [ ] D7 the hop rail's numbers do not add up to a story. On screen:
      `Hop 3 1,557/1,557 of 2,726` over `expanding · 627 left · Stop`. Two
      units (papers, and parents queued to expand); `shown/available` is a
      tautology while a fill runs, `of {reported}` climbs like a target running
      away, and only the parent count converges, unlabelled. Spec-conformant,
      so a design question: probably one number that converges plus a plain
      statement of what is unknown. The user proposed a progress bar; the one
      version the spec's reasoning does not rule out is a bar over the parent
      count. The cut line (D8) is the plain statement; what remains is the
      progress numbers themselves
      2026-10-07 walk: the user still cannot read `Hop 2 182/182 of 394`
- [ ] D12 nothing says how complete a filled plot is. Three gaps are invisible
      and look like a paper with no citers: failed expansions (per session, not
      persisted), papers never reached because a cap or a Stop cut the plan,
      and papers drawn without metadata (D11). Wants one plain statement of
      what is missing and why, not another count; decide with D7. The cut line
      (D8) is the plain statement; what remains is the other two gaps
- [ ] D11 a reference fill lands many Unknowns. An expansion is membership
      first with summaries hydrated cooperatively, so an Unknown is an
      identifier whose summary has not hydrated or failed to. Two hypotheses:
      hydration starved behind membership requests at the fill's rate; and
      DOIs that were never resolvable — `10.1145/1201775.882296` has no year,
      and its references `10.5555/839277.840020` and `10.5555/826029.826529`
      answer "DOI Not Found", `10.5555` being the legacy ACM and DBLP prefix.
      Check the second first: if it holds, the fix is a fallback lookup (title
      and author, or the provider's own identifier), not more fetching. Also
      decide whether unresolved papers are drawn at all. Nothing is measured
- [ ] B47 during a fill the nodes jump far more than the new data warrants.
      Two claims to separate: the whole plot reshuffling on every landing (an
      axis rescale per fetch would do it; B18 is a neighbour), and a single
      paper drawn where its own values say it is not (0 citations in 2026 drawn
      near 100, then negative, its year drifting too). Not the No data lane:
      the jumping nodes are at the most recent and most cited corner, the
      pareto front the user reads the plot from. No diagnosis yet
- [ ] B48 a paper whose year is added in Zotero after the graph is drawn stays
      No data. First establish whether Refresh clears it. Possibly its own
      defect: the rail says such a paper is "parked in a lane off the plot",
      but they sit close to the axis origins and read as real low-low values
- [ ] B51 opening a deeper hop strands the shallower one. The progress line
      sits under the deepest open hop, as specified, so hop 3's Stop and Resume
      vanish once hop 4 opens (seen with 627 of 800 parents queued). Establish
      whether hop 3's queued parents are still in the plan or dropped, and
      whether the rail should hold two hops' progress. The user likes the skip
      itself, so the fix is not to forbid it
- [ ] B55 a graph saved while its fill is stopped reopens fetching. The spec
      deliberately does not persist the paused flag. The fix should answer
      whether a reopen should ever start fetching by itself, given hop 1 opens
      the moment a graph gains a seed
- [ ] B54 verify that reopening a filled graph does not refetch. The spec says
      expansion results persist in the relationship store and only derived
      bookkeeping is recomputed. Check that a graph filled to hop 3 reopens
      without fresh expansions, and that per-hop caps resetting each session
      does not restart the fill. Known leak: failed papers come back after
      every reopen
- [ ] B76 D8's keyless Zotero case is not written: the spec's second case (no
      key, the rail reads `First 50 ... in the provider's order`, today's
      provider order). The constraint is held by unit cases only
      (`fillProviderOrder`, `fillCutIntent`)
- [ ] B81 a hop node hydrated from another index keeps OpenCitations as its
      `citationCountProvider` over that index's count
      (`externalWorkToFocusNode`); B73 stopped the count bounding the list,
      but the label is still wrong. Nothing records which index a merged
      count came from
- [ ] D21 a paper with no citation count stays when the floor rises (user,
      2026-10-07). ADR 0016 and CONTEXT.md say it passes by design; the user
      read it as a bug. Decide whether the floor hides count-less papers, or
      the plot says why they stay

## The rail and the Key

- [ ] D10 hop depth is encoded as opacity, the wrong channel. The ramp
      `1, .9, .8, .7, .6, .5, .4` makes adjacent early hops untellable, and the
      spec applies it under every colouring, so under Citation hop one variable
      takes two channels and spends the one emphasis and search dimming use.
      Weigh a channel that separates adjacent hops (ring, stroke weight, size),
      opacity for emphasis alone, and no ramp when the colouring already says
      hop
- [ ] D9 under the Citation hop colouring the rail shows the hop colours
      twice, on the hop rows and in the Key's Color section. Both are
      specified; decide which yields
- [ ] D13 at ~1,500 papers the edges are a wash and carry no information.
      Weigh: no edges past a density threshold, edges only for what is hovered,
      selected or seeded, bundling, or an aggregate layer. The Key spends three
      rows (Link, Reference, Cited by) on a channel the reader cannot use
      2026-10-07 walk: a seed with many citers piles the nodes up into a mess
      that says nothing; the nodes need the same answer as the edges (B89)
- [ ] B89 pan and zoom lag badly on a seed with many citers (user,
      2026-10-07). Not measured. B34 is the region-path cost on folders; this
      is a seeded graph, so profile the node and edge draw first
- [ ] B86 the line joining sibling subfolders' checkboxes in the Scope rail
      shows on the laptop screen but not on the external HDMI screen, and
      where it shows it runs behind the checkboxes, visible through an
      empty one. Likely a sub-pixel width that rounds to zero at one DPI;
      check both monitors' scaling
- [ ] F11 clicking a Seeds row should select that seed, and selecting a seed
      node should light its row

## Views, gallery and menus

- [ ] D22 views that open in one neutral grey waste the colour channel
      (user, 2026-10-08): colour by citations, or whatever tells the reader
      something about the view. Overview's summary promises "all in one
      colour" on purpose, so decide per view, and for a new graph's default
- [ ] D17 a new seeded graph inherits the appearance the reader last edited
      (B41's design: a stored `focusGraphAppearance` overrides
      `getFocusGraphAppearance`'s defaults). The user wants a stable default,
      as Tools › Meristema › New Graph already behaves. Weigh a fixed default
      with per-graph edits against a remembered default with a reset, and
      whether a drifted graph should say so. A graph saved with a view applied
      does reopen on that view, so that path is not affected
- [ ] D15 transient confirmations ("Copied", "Saved") are too quiet. The
      toolbar status carries both the notices that must stay up and the ones
      that must pass. The user suggests a toast bottom-right, as sonner does:
      the toolbar keeps what persists, the toast takes what passes
- [ ] D16 the gallery offers only the shipped views, never the reader's saved
      ones, which live in the View dropdown alone. Decide between cards, a row
      beneath the columns, or a line on the last card. Until then the
      `view-user` icon has no 28px rendering to walk
- [ ] D14 the gallery's inset leaves a sliver showing an axis label and a
      tick. Either fill the full plot area or widen the margin until it reads
      as a card floating over a graph
- [ ] D18 the View dropdown (user, 2026-10-07): mark the active view with
      a style like the hover highlight rather than a check; the description
      and the status lines (`needs a seed`) sit in two columns and fight for
      width, so move the description under the name; more space above
      "Save current as view…"
- [ ] D19 the user did not understand what Folder map is for (2026-10-07).
      The gallery card and the tutorial card do not carry its goal
- [ ] D20 Who cites whom: the name is unclear, and `Shared by ≥ 2` is not
      intuitive (user, 2026-10-07)

## Seeds, selection and the detail surfaces

- [ ] F7 a graph made from selected papers should open scoped to those seeds,
      not over the whole library (its gallery asked about all 69 papers); the
      library comes in by a deliberate tick. It also decides what N the
      gallery's heading counts. 2026-10-07: the user wants any graph started
      with seeds to open with folders off
- [ ] B15 adding a seed from the search panel takes two clicks: the row
      itself should be the target, not the `+` icon. Reported twice
- [ ] B45 the seed search panel's title and author lines sit too close; this
      passed on 2026-09-08, so a regression or a re-judgement. Walk with B15,
      which touches the same rows
- [ ] F6 seed a paper that is not in Zotero into a new graph
- [ ] F10 select nodes in the graph and have Zotero follow: no canvas
      multi-select, no graph → list direction, and the one-row ring and the
      multi-row opacity are two visual languages for one idea
- [ ] F12 selecting a folder in Zotero activates its region in the graph
      (brainstorm: add or replace, tick or not, which window, the cap)
- [ ] F5 the node's context menu should offer what the detail pane offers, and
      Refresh vs Update connections should say which scope each acts on
- [ ] F4 show the selected paper's abstract; the user chose the Paper details
      pane (2026-10-07)
- [ ] F13 show a paper's full title in the graph; today it ellipsises. The
      user wants it at once on hover; a faster tooltip would already do
- [ ] B90 narrowing Zotero past some width makes the Paper details pane
      widen and take the plot's space, where the rail shrinks. It looks
      maxed out instead of compacting (user, 2026-10-07)
- [ ] F8 nothing says why a paper has no metrics; the exact-title fallback
      decides that for a paper with no DOI
- [ ] F9 a tool for adding a DOI, starting with the one a resolved match
      already carries and never writes back. Design the unconfirmed-match case

## Other

- [ ] D5 the logo: one mark on both themes that says meristem, replacing the
      blue installer icon and the white UI icon
- [ ] F3 standards without a main author (short brainstorm, small plan)
- [ ] B7 New Graph on an empty library fails silently (open the empty state,
      or tell the user; backlog entry B7)
- [ ] B18 the view fits after it renders, so the graph jumps
- [ ] B34 panning a 300+ paper folder at maximum zoom lags (D6's walk, failed
      2026-09-11). Measure before touching: `drawRegions` rebuilds every
      folder's `Path2D` every frame, off-screen loops included, and the zoom
      tightening fragments a large folder into many small loops. Later, the
      user said so
- [ ] B87 light theme (user, 2026-10-07): the plugin's text looks slightly
      scaled down with pixels out of place (check for a fractional transform
      or scale), and the fill behind the arrows of a selected seed is black,
      fine on dark, wrong on light
- [ ] B93 the plugin ignores Zotero's View › Font Size › Bigger/Smaller
- [ ] B26 region membership follows the visible node set, so the search box
      can reshape or empty a selected folder's hull, while a swatch survives
      the same filter (B24). Never decided as a rule: intended asymmetry or
      oversight (backlog entry B26)
- [ ] B36 one "Uncaught (in promise) undefined" in the Error Console, no
      stack, seen twice. Name it when it comes back
- [ ] B20 New Graph from a detached window gives no feedback (low priority)
- [ ] B38 the region border grows a tip toward a neighbour just before two
      regions merge. Deferred by the user on 2026-09-11 after three
      renderings; not to be reopened unless they do
- [ ] Architecture candidates 3 to 5 from the 2026-09-13 pass (state, then
      plot, then chrome; the rail's inputs from their owners; the focus
      vocabulary rename) wait for a decision; 3 is large and comes after Stage
      4's spec. Left from the same pass: M6 and M13 (behaviour, need a
      brainstorm), M12 (a service-path coverage gap), N2 (suite dependency)

## Manual verification (the user checks these in Zotero, in one batch)

Each session that merges an item appends its checks here instead of asking the
user to verify right away. Install the XPI from `.scaffold/build/meristema.xpi`
(built from the latest main), then walk the list; tick what passes, and turn
any failure into a new entry above.

- Refusals were not reached on 2026-10-07 (hop 3 ran without errors), so
  B50, B72 and B64 wait for a session where Semantic Scholar refuses.
- [ ] B50: on your own profile (no Semantic Scholar key), fill a seeded graph
      to hop 3 under Citers. While Semantic Scholar refuses, the hop counts
      keep climbing and the line reads `expanding · {n} left`. If it reads
      `… refusing · retry in …`, the countdown ticks without the rail
      flickering, Stop keeps focus under the keyboard, and Resume starts
      expanding at once. (The countdown half passed under the 2026-09-16
      probe.)
- [ ] B72: fill hop 3 on your own profile while
      Semantic Scholar is refusing. The progress line ends rather than
      alternating expanding and refusing — `n left` reaches zero. A 2026
      frontier paper reads as expanded with no citers, not re-asked; on
      2026-09-16 the same ~20 DOIs were fetched 10 to 16 times.
- [ ] B64: with Semantic Scholar refusing, press Refresh on a seed. The
      progress window closes in seconds, not after 15 s.
- [ ] B78: with an OpenAlex key, seed two papers that share a citer which made
      only one seed's cut of 50 (two seeds in one field with many citers).
      Under Seeds linked the citer reads `Cite all 2 seeds` and draws an edge
      to each seed in its colour; `Shared by ≥ 2` keeps it. Repeat under
      References. Close and reopen the graph: the grading is back with no
      check request. Clear the key in Settings with the graph open: the
      citer reads `Cite 1 seed` at once, no reopen; put it back and it reads
      `Cite all 2 seeds` again, with no check request (B79).
- [ ] B52: on a filled seeded graph, switch the colouring from Citation hop to
      Uniform in the gear: the Key drops the hop rows at once.
- [ ] B82: with the Key showing, switch Appearance between Light and Dark:
      the Key's swatches change with the plot. Colour by Journal h-index
      right after a library update fills in journal metrics: the Key's range
      matches the plot's.
- [ ] B91: on a hop row whose index reports more than it lists, the count and
      its total read `182/182 of 394`, one space apart.
- [ ] B92: the rail footer's zoom in, zoom out, fit and gear icons read
      larger in their buttons; drag the floor tag: its arrow is drawn, not a
      small character, and the tag still grabs. Both themes.
- B42 (the newer-version read-only notice) was skipped at the user's call on
  2026-09-13, unwalked: there is no newer version anywhere. Re-offer it when a
  second version exists in someone else's hands; `node:sqlite` can edit the
  row, and `test/zotero/graphViews.test.ts` covers the version-99 path.

## Zotero suite

`npm test` launches the dev Zotero and runs `test/zotero`; the user has said it
may be run from a session. Run it in full every 4 or 5 commits, not per change
(the user, 2026-09-17: per-change runs are unsustainable); a case under work
runs alone under a temporary `describe.only`. Last full run: 2026-10-08 at `0fa1139` (99/0),
so count with `git log 0fa1139..main --oneline`.
A clean run is 100 passed, 0 failed as of 2026-10-08 (B92's case added).

- The floor drag case ("hides under the floor…", the drag leaving the field at
  its floor) and B50's countdown case ("the line was rebuilt while counting
  down") each failed once on 2026-10-06 and passed on rerun. The floor case
  failed one of two runs of its file: treat a single failure as a flake and
  rerun before debugging. It failed once more in a full run on 2026-10-08
  (the field stayed at 5 the whole drag).
- One-offs on 2026-10-08, each gone on rerun: `graphVisual.test.ts` check 11
  (`selection` undefined right after `selectNode`), and one Citation hops
  block run where the save case threw with no message (the runner prints a
  thrown plain `Error` as `undefined`; use `expect.fail`), both version 4
  cases fell with it, and B50's line never read "refusing".
- A new graph tab mounted only on an animation frame, and a covered window
  gets none, so new tabs stayed empty while the test window was covered (1 to
  9 cases a run, "Scope section: expected null to exist"). Since `761b4e0` the
  mount falls back to a 250 ms timer (`createFrameOrTimer`), and
  `graphTabMountsCovered.test.ts` stubs frames away to hold it. Since B83
  (`6921bc9`) the renderer's resize and initial fit, and the view's camera,
  focus fit and focus rebuild, fall back the same way: a plot remounted on a
  covered window (a citation update landing) kept its unfitted view, so the
  D8 case's walk found only the outer fixture. Its second case erases a paper
  to remount the plot with frames stubbed.

- `graphCitationHops.test.ts` is served offline (B74): its outer `before`
  wraps `Zotero.HTTP.request` with a served index (`serveIndex`, Semantic
  Scholar and OpenCitations, every other provider host not-found, 400 ms per
  answer), and the nested blocks wrap that in turn. Its fixture DOIs carry the
  run's clock. A hop case reading `0/0` is now a regression, not a refusal.
- B72's drain case prints a timeline and a frame probe when it stalls. B75 was
  `frames DO NOT fire in 3 s, visibility hidden`: the test window was covered
  and the fill re-planned on a frame alone. Minimising the window in the case
  does not reproduce it (Firefox backs frames off gradually), so
  `test/unit/frameOrTimer.test.ts` is the regression test.
- A suite that moves Zotero's collection tree must put it back on the library
  before erasing its fixtures, or the Citation hops suite, which runs next,
  fails its version 4 sticky-notice case.
- A suite that clicks the plot of a fresh graph must Start blank first: D4's
  gallery covers the plot until dismissed.
- The test Zotero runs with its pane **locked** (`#zotero-pane-overlay` stays
  up while the database integrity check runs). Synthetic events never notice,
  but a real pointer (`windowUtils.sendMouseEvent`, the only way past
  `setPointerCapture`) lands on the overlay. Lower it first with
  `Zotero.hideZoteroPaneOverlays()`, as
  `graphSelectionOutsideFolder.test.ts` does; a detached window is not under
  it.
- One full run at `8ede40c` failed 8 Stage 3 cases at once: hop 1 read
  `0/0`, then the whole ladder (Seeds row too) vanished within 216 ms. It
  did not recur in the next six runs touching that block. Name it if it does.
- `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
  intermittent (a focus or popup timing race on the real Tools menu is the
  first suspect). One failure there is not a regression.
- The D8 case (`graphCitationHops.test.ts`, "with an OpenAlex key (D8)") sets
  a fake OpenAlex key pref for its own block and restores it in `after`; it
  answers every provider host itself (OpenAlex from a served set, the others
  not-found) and waits the outer fixture's automatic update out (`untilQuiet`,
  capped at 120 s, non-fatal) before counting requests. Its citers deliberately
  omit `cited_by_count`, so the expansion takes the unknown-count path (real
  data would make the total 2 requests, not 4).
- The floor's case (`graphCitationHops.test.ts`, "with a citation floor
  (Stage 4)") opens on Overview and asserts the Y axis reads citations first:
  a graph whose papers carry no count gets no citation axis
  (`normaliseLayoutFor`), and the floor is drawn only on one. Its fake answers
  from install, so the library's own update stores the seed's citer list; the
  case's clicks fetch the hop-2 pages. Seven isolated runs to get there.
- An unidentified 42-passed/1-failed run from 2026-09-10 never reproduced in
  twelve logged runs and its case was never named. Keep the full log
  (`npm test 2>&1 | tee <file>`) on any branch that touches the region code,
  and name the case the first time it comes back.

## Log

One line per session: date, what was ticked, commit range. Newest last. Older
entries are in git history.

- 2026-09-15: B62's detached-window follow-up; B50 built from its plan (ADR
  0013, CONTEXT.md gained Refused); B63 and B64 filed.
- 2026-09-16: B63 fixed (lookup moved to OpenCitations Meta, relation pages to
  the canonical host); four runner coverage cases; B65 to B70 filed; D8's
  evidence written. Afternoon: the hop-3 fill measured on the user's profile
  (numbers under D8); B72 found, specified and fixed (ADR 0014); B71 filed.
- 2026-09-17: B71 fixed on `b71-hop-row-gap`; the roadmap archive and the B38
  images deleted; B74 and B75 filed from two runs (88/1, then 80/5). Roadmap
  compacted and renamed to `roadmap.md`; the backlog trimmed to its open
  entries, B72's plan and B50's spec deleted, unused and duplicate images
  removed. Next: B75's second run, then D8.
- 2026-09-17, evening: B75 found and fixed on `b75-fill-wakes-without-frames`:
  the fill re-planned on `requestAnimationFrame` alone and stalled in a hidden
  window. Six isolated runs of the drain case; the full suite was not run (one
  attempt stopped: the Tools-menu hooks failed, the test window likely
  covered). Suite cadence set to every 4 or 5 commits. Next: D8.
- 2026-09-18: D8, B64, B67 shipped (ADR 0015); commits ee3d3d6..9bb70bc.
  Next: Stage 4.
- 2026-09-18, later: the citation floor shipped (ADR 0016); commits
  `dc0fa65..cc83d22` plus this log line. Next: shared citers.
- 2026-09-28: shared citers brainstormed and specified (the grade a
  colouring, Only a scope rule). Next: its plan.
- 2026-10-06: shared citers shipped (ADR 0017), with the fix for new graph
  tabs on a covered window; commits `aa4b429..761b4e0` plus this log line.
  Next: the open bugs.
- 2026-10-06, later: B78 shipped (ADR 0018): seed links checked against
  OpenAlex reference lists; commits `0d588c1..ec0c3f6` plus this log line.
- 2026-10-07: B79 fixed: a paper's stored check read across its aliases
  (`storedCheckOf`), the gate a pure `seedLinkCheckOpen`, a save refused while
  the store closes, the fixture tag the whole clock; a Zotero case clears the
  key on a live graph (it failed against a gate that ignored the key).
- 2026-10-07, later: B74 fixed: the Citation hops suite answers every
  provider from a served index, so back-to-back full runs both read 94/0.
- 2026-10-07, later: B77 fixed: OpenAlex's arrival references page reports
  `referenced_works_count` (never below the list's length), cached with the
  IDs; it agreed with the list on 75 sampled works.
- 2026-10-07, later: B65, B66 and B68 shipped in parallel worktrees
  (`2425de6..ca206aa`): a throwing `onTimeout` settles its call, one
  `providerHintFor` rule, the refresh's refusal composition under unit tests.
  Full suite 94/0 at `ca206aa`.
- 2026-10-07, later: batch 2 in parallel worktrees, `a9dd176..32542c5`: B53
  (File menu rule), B69 (a refused Meta lookup still pages the Index on the
  DOI by hand), B70 (Index v2), B52 (the Key follows the gear), B73 (a count
  OpenCitations cannot report no longer bounds its list). B80 to B83 filed;
  B83 bisected to before the batch.
- 2026-10-07, evening: batch 3, B80 (an Index fault rejects instead of reading
  as no citers; 404 stays a miss) and B82 (late source metrics and a theme flip
  rebuild the Key). B84 filed from B80. Full suite 97/0 at `cbe97e4`.
- 2026-10-08: B83 fixed (`6921bc9`): a covered window delivers no frames, and
  the plot a citation update remounted there never fitted. Reproduced by
  stubbing frames in the D8 case (only the outer fixture offered, 2/2), green
  with the fix; block 3/3. Full suite 97/1 (the floor drag flake), then
  98/0 at `6921bc9`.
- 2026-10-08: B91 fixed (`1d874af`): the reported total's margin stacked on
  the row's flex gap. Red at 10px against a 3px space, green alone.
- 2026-10-08: B84 fixed (`0fa1139`): the three summary-service pages the fill
  and refresh use stored a fault as complete whenever no total held it
  (hinted node, provider reporting none); they now throw through
  `relationPageBody`, 404 stays a miss. Semantic Scholar's native page only
  feeds the coupling recommender, which stores nothing; it takes the rule
  too. Left as is: a refused or faulted OpenAlex hydration batch drops a
  references page's untitled works, but that page carries its total, so the
  short list is never complete. Full suite 99/0 at
  `0fa1139`.
- 2026-10-08: B92 fixed (`a2675a9`), the user picking C for both on a design
  canvas: the rail footer's four icons at 20px (`RAIL_BUTTON_ICON_SIZE`), the
  floor tag's arrow drawn at 16px beside 12px text. The new footer case and
  the floor drag case green alone; the footer case was not seen red first.
