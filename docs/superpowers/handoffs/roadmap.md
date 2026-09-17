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
- Settled decisions: `CONTEXT.md` and `docs/adr/` (0001 to 0014).
- Ledger of finished plans: `.superpowers/sdd/progress.md`.

## Next

1. B75: a second run of B72's drain case, once Semantic Scholar's throttle
   window has passed (B74). B72 is pushed (2026-09-17) with this still open.
2. D8's brainstorm, on the measured fill. It comes before Stage 4's spec.

Working rules: a feature branch per change, `npm run check` as the gate
(prettier covers `docs/` and `README.md`), `npm test` when the change needs
the Zotero suite, fast-forward to main, `npm run build` last, push via
`gh-daniel-locatelli`. Commits: sentence-case subject, no type prefix, staged
by path. Design items are `superpowers:brainstorming`, then a spec in
`docs/superpowers/specs/`, a plan in `docs/superpowers/plans/`, then
subagent-driven development; delete the plan, and then the spec, once the
work has shipped and nothing open cites them.

## Stages

Stages 1 and 2 (independent bugs; the rail Scope and toolbar reduction) are
shipped and walked.

### Stage 3: citation hops on demand

Built and merged from `docs/superpowers/specs/2026-09-12-citation-hops-design.md`.

- [ ] manual walk-through by the user (part-walked 2026-09-13; what is left
      is under Manual verification, and D7 holds the progress-line check open)

### Stage 4: citation floor and shared citers

Depends on Stage 3, and on D8 being settled, since it builds on the fill.
Floor line on the plot with drag handle and outline rendering below the floor;
Shared citers Off, Dim, Only with the grading formula and Key tiers; visibility
order of evaluation as a pure function with unit tests; label routing through
`graphLabelBudget.ts`.

- [ ] brainstorm and spec
- [ ] plan
- [ ] implemented, reviewed, merged, XPI built, pushed
- [ ] manual walk-through by the user

## The hop fill

- [ ] B75 B72's stubbed case "drains the plan instead of re-asking papers with
      no citers" failed once on 2026-09-17: the line read `expanding · 1 left`,
      hop 1 `2/2`, hop 2 `0/0`. Not rate limiting: the case wraps
      `Zotero.HTTP.request` (`graphCitationHops.test.ts:1480`) and its host
      pattern covers all 55 requests in its ledger. It passed on 2026-09-16
      with only a CSS selector changed since, and the deferral ladder runs on
      real timers, so intermittent is the first suspect and a second run is the
      first task. Do not tick B72's manual check until this is settled
- [ ] D8 the fill fetches far more than the reader needs. The rail offers
      depth 6 but wall clock caps it at 3 ("another 2 hours just to start Hop
      4"). Zotero's own panes stay responsive and only the plot lags, so that
      cost is the graph's rebuild and redraw per landing. In the citers
      direction the chain also runs out against the present (hop 5 is already
      2026), so deep rows are structurally empty yet read the same as
      `not fetched`: derive the offered depth from the data. Weigh: expanding
      only what the reader asked for, most-cited parents first and stopping, a
      reader-set budget, reusing the store before any request, whether hops
      past 3 are offered at all. Measured 2026-09-16 on the user's profile
      (B50+B63 code, 29.6 min, 432 requests, probe JSON
      `%TEMP%\Zotero\meristema-fill-probe-2026-09-16T12-23-24-909Z.json`):
      OpenCitations 393 requests, zero refusals, 13.5/min, avg 912 ms, 309
      relation pages to 84 Meta lookups, so expansion and not hydration is
      where requests go; Semantic Scholar asked 15 times (11 × 429), so B50's
      sit-out works; OpenAlex answered 20 of 20, the user's key being live,
      unlike the test profile; 50.5% of wall clock refusing to 46.4% expanding
      over 6 windows; reached hop 3 at 401/401 of 820, never opened hop 4.
      B64 and B67 are decided with it
- [ ] D7 the hop rail's numbers do not add up to a story. On screen:
      `Hop 3 1,557/1,557 of 2,726` over `expanding · 627 left · Stop`. Two
      units (papers, and parents queued to expand); `shown/available` is a
      tautology while a fill runs, `of {reported}` climbs like a target running
      away, and only the parent count converges, unlabelled. Spec-conformant,
      so a design question: probably one number that converges plus a plain
      statement of what is unknown. The user proposed a progress bar; the one
      version the spec's reasoning does not rule out is a bar over the parent
      count
- [ ] D12 nothing says how complete a filled plot is. Three gaps are invisible
      and look like a paper with no citers: failed expansions (per session, not
      persisted), papers never reached because a cap or a Stop cut the plan,
      and papers drawn without metadata (D11). Wants one plain statement of
      what is missing and why, not another count; decide with D7
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
- [ ] B73 a citer total attributed to one index truncates another index's
      list, still marked complete. `reportedCount`
      (`externalDiscoveryService.ts:1300-1309`) falls back to the node's stored
      count when the asking provider is its `citationCountProvider`; `target`
      (`:1351-1354`) and `requested` (`:1374-1376`) then bound the fetch,
      `fetchLinks` slices the raw array before parsing
      (`openCitationsProvider.ts:92-95`), and `reachedReportedCount`
      (`:1432-1435`) marks it complete. Armed by OpenCitations stamping itself
      owner of a null `citationCount` (`openCitationsProvider.ts:176-179`)
      while declaring `citationCount: false` (`:109-111`). Signature: a bare
      `1/1` in the rail where a dedupe would read `1/1 of 2`. Found building
      B72's case, the only one pinning an exact hop-1 count. NOT confirmed at
      runtime — a fresh item has no citation-metrics record, so the fallback
      should not arm. First task: a test pinning `reportedCount` at runtime
- [ ] B64 a manual Refresh waits out the 15 s
      `RELATIONSHIP_PROVIDER_TIMEOUT_MS` while Semantic Scholar answers 429 and
      OpenCitations answers in ~50 ms. Seed Refresh keeps its retries by B50's
      design (only "a refused snapshot is never stored": no windows, no
      provider switching) and nothing on its path feeds the 60 s provider register.
      Traced by two probe runs, not measured on pre-B50 code. Decide with D8
- [ ] B69 since B50 a refused OpenCitations lookup throws before its
      DOI-fallback page on manual paths (`externalDiscoveryService.ts:1202`);
      it used to fall through and still page on the DOI. The spec named only
      the skipped title search. B63's fix makes this live, so decide now
- [ ] B70 the OpenCitations relation pages still use Index v1, which
      OpenCitations calls legacy. v2 (`/index/v2/citations/doi:{doi}`) answers
      today and its composite `citing`/`cited` strings already parse through
      `normalizeDOI`, so the migration is small
- [ ] B74 the Zotero suite throttles itself against Semantic Scholar and
      reports the damage as failures: two full runs an hour apart on 2026-09-17
      gave 88/1 then 80/5, the hop cases reading `0/0`.
      `zotero-plugin.config.ts` sets only `visualOutDir` in `test.prefs`, so
      every run is keyless; ten Citation hops cases run live
      (`graphCitationHops.test.ts:789-1178`) and re-seed the same DOI; and one
      expansion is 55 requests across 16 URLs (B72's ledger), the batch
      endpoint 10 times. Only B50's and B72's cases stub the providers. Weigh:
      stubbing the ten live cases the same way, a key in the test profile, or
      one cache across cases
- [ ] B67 the fill is inferred from `retryRefusals === false`. One caller
      today; an explicit `fill` option stops the two meanings drifting. Decide
      with D8, which may add fill-only paths
- [ ] B68 the refresh's composition has no automated test: switching on a
      refusal, the no-candidate return publishing nothing, the
      `refusedBy`/`skipped`/`answeredBy` population, and a refused snapshot
      dropped from an aggregate manual refresh are exercised only by probe runs
- [ ] B66 `providerSupportsPaper` duplicates the hint logic in
      `externalDiscoveryService.ts`; extract one
      `providerHintFor(node, hints, provider)`
- [ ] B65 `withTimeoutScope` (`src/services/cancellationScope.ts`): a throwing
      `onTimeout` leaves the timeout promise unsettled, and a late rejection
      from an abandoned operation is unhandled. Unreachable from today's
      callers; add a no-op `.catch` when the file is next touched

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
- [ ] B52 the Key keeps the hop colours after the colouring changes away from
      Citation hop, so the rail states a colouring the plot is not using.
      Distinct from D9
- [ ] D13 at ~1,500 papers the edges are a wash and carry no information.
      Weigh: no edges past a density threshold, edges only for what is hovered,
      selected or seeded, bundling, or an aggregate layer. The Key spends three
      rows (Link, Reference, Cited by) on a channel the reader cannot use
- [ ] F11 clicking a Seeds row should select that seed, and selecting a seed
      node should light its row

## Views, gallery and menus

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
- [ ] B53 the File menu runs Open's saved-graph rows into Save and Save as…
      with no separator

## Seeds, selection and the detail surfaces

- [ ] F7 a graph made from selected papers should open scoped to those seeds,
      not over the whole library (its gallery asked about all 69 papers); the
      library comes in by a deliberate tick. It also decides what N the
      gallery's heading counts
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
- [ ] F4 show the selected paper's abstract in the graph (decide the surface)
- [ ] F13 show a paper's full title in the graph; today it ellipsises
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

- [ ] B31: click a folder's name to draw it as a region, then switch
      Appearance to Dark. The whole row fills with the accent blue, the label
      and count are white, and the square is the region's swatch with a white
      edge; a second folder's row reads as the same blue with a different
      square. Walkable since B59; walk every clause, on both themes.
- [ ] D4: open the View dropdown. Five rows with icon, name, one-liner; the
      two greyed ones (Reading plan, Who cites whom) read "Arrives with reading
      state / shared citers" in muted text and do nothing on click; contrast is
      readable on both themes. Walkable since B44.
- [ ] D4: apply Overview. The chip and the 300px tutorial card passed on
      2026-09-13. What is left is the narrow case, since B56: the card holds
      300px down to a 328px plot, and below that it is compact by design (the
      view's name, × and "Don't show for this view again"); widening brings the
      whole card back. Both themes.
- [ ] Stage 3: the progress line. Passed: the line under the deepest open hop,
      Stop and Resume, and the fast fill, where the line appears, counts down
      and disappears. Left: the Fetch more state on a seed with hundreds, never
      reached at the fill's rate, and D7. An unjudged wart: paused, the line
      still reads `expanding · 627 left · Resume`.
- [ ] B44: open a graph from a folder's context menu so the gallery greets it
      **in a tab, not a detached window**. Every card's icon, name, paragraph
      and note sit inside its own rounded container, and "Start blank" and
      "Import view JSON…" sit in their own cell rather than over the third
      card.
- [ ] B44: on that same graph open the View dropdown. All five rows read
      inside their own boxes and the pointer lands on the row it is over:
      hovering Folder map highlights Folder map, and clicking it applies it.
- [ ] B59: tick a folder in the Scope rail. The accent blue runs behind the
      whole row, through the name and the count, not around a box containing
      them. The hover is a neutral grey tint, not blue.
- [ ] B44/B59 together: walk the plot toolbar, the rail's buttons and the
      detail pane's tabs once. The fix lifted a height clamp from every plugin
      button, so watch for a control grown taller than its 28px slot.
- [ ] B58: with a graph open on the real library, rename a folder in Zotero's
      collection tree. The rail shows the new name at once; a stopped hop fill
      stays stopped; a graph opened after the rename shows the new name. Open
      a graph from that folder's context menu and rename the folder again: the
      tab's title follows. Rename the tab yourself, rename the folder once
      more, and the tab keeps the name you typed.
- [ ] B60, closed as Zotero's own state: in a folder, click a paper, then
      Ctrl+click it so it deselects, and note the dotted ring left on the row.
      Repeat B30's walk — select a paper in the list, click a graph node whose
      paper is outside the folder, click back into the list. The row keeps the
      same dotted ring, no more, and ↑/↓ move from it in both cases. If the two
      look different, B60 reopens.
- [ ] B46: on both themes, point at "+ Add seed", at Stop or Resume on a
      running fill, at Show all, and at the tutorial card's "Don't show for
      this view again". Each underlines and paints no box behind it; the ×
      beside a seed still goes to full ink and heavier.
- [ ] B57: open Save current as view… and type a shipped view's name, such as
      Overview. The refusal reads at the same size as "Name" above it, amber in
      light and a lighter amber in dark, easy to read on both.
- [ ] B61: on both themes, point at an entry in the Key rail: a faint grey
      tint, not blue. Click to pin: a light blue tint while pinned, gone when a
      click on the graph releases the pin. The rows keep their height.
- [ ] B62: open a graph whose toolbar shows "Directions are now one at a time;
      showing Citers" (one saved before Stage 3 with direction `both`). While
      the notice shows, trash any paper: the graph redraws and the notice
      stays. Then right-click the tab › Move › Move to New Window: the new
      window shows the notice, and trashing another paper keeps it.
- [ ] B50: on your own profile (no Semantic Scholar key), fill a seeded graph
      to hop 3 under Citers. While Semantic Scholar refuses, the hop counts
      keep climbing and the line reads `expanding · {n} left`. If it reads
      `… refusing · retry in …`, the countdown ticks without the rail
      flickering, Stop keeps focus under the keyboard, and Resume starts
      expanding at once. (The countdown half passed under the 2026-09-16
      probe.)
- [ ] B72 (not before B75 is settled): fill hop 3 on your own profile while
      Semantic Scholar is refusing. The progress line ends rather than
      alternating expanding and refusing — `n left` reaches zero. A 2026
      frontier paper reads as expanded with no citers, not re-asked; on
      2026-09-16 the same ~20 DOIs were fetched 10 to 16 times.
- [ ] B71: open a seeded graph. Every hop row reads with a space between label
      and count — `Hop 1` then `73/173`, and `Seeds` then its number — and so
      does a row carrying `of {reported}`. A folder row in the same rail is
      unchanged, still filling with the accent blue when selected (B59).
- B42 (the newer-version read-only notice) was skipped at the user's call on
  2026-09-13, unwalked: there is no newer version anywhere. Re-offer it when a
  second version exists in someone else's hands; `node:sqlite` can edit the
  row, and `test/zotero/graphViews.test.ts` covers the version-99 path.

## Zotero suite

`npm test` launches the dev Zotero and runs `test/zotero`; the user has said it
may be run from a session. A clean run is 89 passed, 0 failed as of 2026-09-17
(B71's case added); the last full green of all cases was 87 on 2026-09-16.

- Ten Citation hops cases run against live providers on Semantic Scholar's
  keyless pool. When it answers 429 each expansion lands `0/0` after exactly
  15 s and those cases fail: the provider, not a regression. A second full run
  inside the same hour poisons them (B74), so a re-run confirms nothing until
  the window has passed. B72's stubbed drain case failing is B75, not this.
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
- `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
  intermittent (a focus or popup timing race on the real Tools menu is the
  first suspect). One failure there is not a regression.
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
