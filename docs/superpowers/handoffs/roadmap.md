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
  form of the open entries filed up to 2026-09-11 (B26,
  B36, F3 to F12, D5). Read one only when you take that item.
- Design: `docs/design_handoff_citation_chain_depth/README.md` (option 6a;
  open `#6a` in `Citation Chain Depth.dc.html`).
- D8's evidence: `docs/superpowers/handoffs/2026-09-16-d8-evidence.md`.
- Settled decisions: `CONTEXT.md` and `docs/adr/` (0001 to 0021).
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

- [ ] D11 a reference fill lands many Unknowns ("Unknown" is the
      author-year label of a node with no authors). Measured 2026-10-09: the
      dead-DOI hypothesis does not hold. S2 elides ACM reference lists
      (`data: null`), so a fill's membership comes from OpenCitations, whose
      rows carry a DOI and an OpenAlex ID but no metadata: every reference
      lands Unknown until hydration. OpenCitations never lists a `10.5555`
      DOI (they come only from Crossref's embedded list, which a fill never
      asks). On three ACM papers, the S2 batch resolved 22/23, 22/23 and
      11/13 DOIs; OpenAlex and Crossref resolve the misses. The seed
      `10.1145/1201775.882296` has a year (2003) in S2, OpenAlex and Crossref,
      so a missing year there means its own summary never hydrated. What is
      left is starvation, from code reading. Fixed: the queue published only
      on drain; it now publishes a batch while work is queued, at most once
      a second (`hydrationPublisher.ts`). Left: the queue still waits
      whenever `activeRelationshipMembershipRefreshes > 0`, and a fill runs
      expansions a frame apart, so hydration runs only in the gaps. Decide
      (user, it changes provider request rates, ADR 0013 to 0015): let
      hydration interleave with fill membership, or keep the gaps. Measure
      first, after the manual check below.
      2026-11-01, code reading after the failed check: a paper can stay
      "Title unavailable" until the next Refresh, not just wait. One queue
      run (`runRelationshipMetadataHydrationQueue`) shares a budget of 12
      one-by-one lookups (`RELATIONSHIP_SUMMARY_BACKGROUND_FALLBACK_LIMIT`)
      across every batch; past it, a paper the S2 and OpenAlex batches miss
      is marked attempted and is not queued again this session (only a
      membership refresh clears the mark). The OpenAlex batch runs only with
      an API key (`applyOpenAlexBatches`), and an S2 batch's 429 turns off
      S2's one-by-one lookups, so without a key, or under a 429, Crossref's
      12 are all that is left for the run. Ask the user: is an OpenAlex key
      set? Decide: lift the budget for a fill's queue run, or leave a missed
      paper unmarked so a later run retries it (more requests, ADR 0013).
      2026-11-01, later: the user's profile has an OpenAlex key, so the
      OpenAlex batch runs. Narrower than a miss: the queue marks every key it
      takes as attempted before the fetch (`markRelationshipMetadataAttempted`
      in the batch loop), and `applyOpenAlexBatches` drops a batch whose
      response is not ok, so one 429 or failed batch (up to 50 papers) stays
      Title unavailable until Refresh. Proposal: unmark only the works of a
      batch that failed (no answer), not those a provider answered without;
      that retries what was never asked, within ADR 0013's one request per
      batch. Unverified hypothesis: an OpenAlex ID merged into another work
      comes back under the new ID, which `byIdentity` keys and the candidate
      then misses; check a Title unavailable node's ID against OpenAlex
      Only the attempted mark blocks a retry: a record missing its title
      skips the failure cache's `nextRetryAt` (`basicMetadataMissing` in
      `hydrateExternalWorksMetadata`). But a retry also needs the paper
      queued again, which only `queueRelationshipMetadataHydration` does;
      whether a fill or a view rebuild re-queues it is the measurement to
      take on the user's profile before choosing the fix
      The smallest fix is built on branch `d11-second-hydration-attempt`
      (not merged): two attempts per paper per session
      (`mayQueueHydration`), the session mark now a count. Hops suite 23/0,
      so no request-count case moved. Its check, with the measurement: on
      your profile, fill a References graph, note the Title unavailable
      nodes, wait a minute without Refresh, and count them again

## The rail and the Key

- [ ] D10 hop depth is encoded as opacity, the wrong channel. The ramp
      `1, .9, .8, .7, .6, .5, .4` makes adjacent early hops untellable, and the
      spec applies it under every colouring, so under Citation hop one variable
      takes two channels and spends the one emphasis and search dimming use.
      Weigh a channel that separates adjacent hops (ring, stroke weight, size),
      opacity for emphasis alone, and no ramp when the colouring already says
      hop
      Canvas (2026-11-01): https://claude.ai/artifact/WZFVakcUYU4H2StpiJJEVU,
      Now beside A (no hop channel; the Citation hop colouring tells it), B
      (size by hop), C (fill, thick ring, thin ring; but a ring already
      means not in Zotero), D (a steeper ramp, 1, .55, .25)
      A is built on branch `d10-no-ramp-under-hop-colouring` (not merged):
      `hopOpacityUnder`, unit-tested; graphVisual 12/0. Its check: colour by
      Citation hop on a filled graph, and every hop draws at full ink
- [ ] D13 at ~1,500 papers the edges are a wash and carry no information.
      Weigh: no edges past a density threshold, edges only for what is hovered,
      selected or seeded, bundling, or an aggregate layer. The Key spends three
      rows (Link, Reference, Cited by) on a channel the reader cannot use
      2026-10-07 walk: a seed with many citers piles the nodes up into a mess
      that says nothing; the nodes need the same answer as the edges (B89)
      Canvas (2026-11-01): https://claude.ai/artifact/Y5C4TfGMGbNh4ZP9YQ8o9U,
      Now beside A (no edges past a density, focus edges only), B (every
      edge at the dimmed strength, focus at full), C (the seeds' edges and
      focus only)
      Found (2026-11-01): the mesh already fades with the count
      (`edgeBaseOpacity`: full below 240 edges, a 0.3 floor above 3,200, on
      a base ink at .32), so B is close to what ships. A is built on branch
      `d13-hide-unlit-edges-when-dense` (not merged): past 3,200 edges only
      the selection's and the seed links draw. Its check: on a graph that
      big, the mesh is gone and clicking a paper draws its edges

## Seeds, selection and the detail surfaces

- [ ] F6 seed a paper that is not in Zotero into a new graph
      2026-11-01 reading: the seed search searches the library only
      (`seedPopoverList` over `libraryState`), so a blank graph has no way to
      a paper outside Zotero. Proposal: a query that parses as a DOI and
      matches no library paper gets one row, "Look up 10.…", which resolves
      it (OpenAlex, then Crossref) and adds it as an external seed; New
      Graph › Start blank plus that row is F6, and F9 can share the parser.
      Title search across providers stays out (request rates, ADR 0013)
      Built on branch `f6-doi-seed-lookup` (not merged, 2026-11-01): the
      row, a unit model (`doiQuery`, the `lookup` list kind) and a Scope rail
      case that seeds a served DOI; Scope rail suite 8/0 twice. Merge on the
      user's yes; its manual check: on a blank graph, + Add seed, paste a
      DOI not in Zotero, press Look up, and the paper becomes the seed
- [ ] F10 select nodes in the graph and have Zotero follow: no canvas
      multi-select, no graph → list direction, and the one-row ring and the
      multi-row opacity are two visual languages for one idea
      Proposal (2026-11-01): shift-click and a drag box add to a canvas
      selection; a multi-selection selects the same rows in Zotero's list
      (the one direction it lacks), and the plot marks every selected paper
      with the one ring a single selection uses, dropping the opacity
      Built on branch `f10-multi-select-follows-zotero` (not merged): a
      Shift-, Ctrl- or Cmd-click toggles a paper in the graph's
      multi-selection (from the selected one), drawn with the existing
      multi-row emphasis, and Zotero's list selects the set; a plain click
      ends it. No drag box, and the ring-versus-opacity question stays open.
      Selection suite 2/0 three times (one run lost the first, older case
      to a pointer outside the window). Its check: with the library shown,
      click a paper in the graph, Shift-click two more, and Zotero's list
      holds all three
- [ ] F12 selecting a folder in Zotero activates its region in the graph
      (brainstorm: add or replace, tick or not, which window, the cap)
      Proposed defaults (2026-11-01): add, as a toggle, since a region
      selection already holds several (F14); tick the folder in Scope so the
      graph shows what is lit; no cap, as F14 chose. Corrected: the tree
      lives in the library tab, so no graph tab shows while a folder is
      picked; detached graph windows are what can answer. Built on branch
      `f12-folder-selection-lights-region` (not merged): a pick adds the
      region in every detached graph of that main window. Unit tests and a
      Zotero case, 1/0 twice. Its check: move a graph to its own window,
      pick a folder in Zotero, and the graph lights that folder's region
- [ ] F9 a tool for adding a DOI, starting with the one a resolved match
      already carries and never writes back. Design the unconfirmed-match case
      Proposal (2026-11-01): a library paper with no DOI whose match carries
      one shows "Add DOI 10.…" in Paper details; a confirmed match (DOI or
      provider ID) writes it on one click, an unconfirmed one (title and
      year) shows both titles side by side first and writes only on
      confirm. A typed DOI goes through F6's parser
      Built on branch `f9-add-matched-doi` (not merged): `doiOffer` (unit
      tests) and the Paper details section, written only on the reader's
      press. No Zotero case: seeding a match record the plugin's own copy
      reads needs a served citation update. Selection and visual suites
      13/0. Its check: a library paper with an empty DOI field that the
      plugin matched shows "This item has no DOI"; Add (or Confirm and add)
      writes it, and Zotero's Info pane shows the DOI
- [ ] D23 the graph has no narrow layout (user agreed, 2026-10-09): after B90
      Paper details keeps its side width, so a 650px window leaves the plot
      about 99px. Brainstorm: shrink Paper details towards Zotero's 320px
      minimum, auto-collapse it, or stack it
      Canvas (2026-11-01): https://claude.ai/artifact/Rrdd91oRmMdLewy1pJqsna,
      a 650px tab: Now (plot 99), A (pane to 320, plot 130), B (pane folds
      below a plot floor), C (pane stacked under the plot, as Zotero does),
      D (pane as a drawer over the plot), E (the rail folds first)
      B is built on branch `d23-fold-details-below-plot-floor` (not
      merged): under a 320px plot the pane folds to its strip without
      folding Zotero's item pane, its toggle reopens it, and a 40px band
      stops flicker. Zotero will not shrink its window below ~930px, so the
      case narrows the graph's root; 2/0 twice. Its check: narrow the graph
      tab (a detached graph window) until the plot is thin, and the pane
      folds; Zotero's item pane stays as it was

## Other

- [ ] D5 the logo: one mark on both themes that says meristem, replacing the
      blue installer icon and the white UI icon
      Canvas (2026-11-01): https://claude.ai/artifact/VvZtSZNZCjRY3AUQtqn57w,
      A (the shoot apex between two leaf primordia), B (a citation tree
      that sprouts), C (phyllotaxis dots), each at 96, 32 and 16px on both
      themes
      A is built on branch `d5-apex-mark` (not merged) for the UI icons
      (`network.svg`, `network-section.svg`: menus, tab, pane section,
      settings). The installer PNGs wait for the pick; this machine has no
      SVG rasteriser. Its check: the Tools menu, the graph tab and the item
      pane section show the apex mark on both themes
- [ ] F3 open, for the user: whether matching may use title+year alone
      Recommendation (2026-11-01): yes for display, never for writes. A
      title and year match may join a library paper to its node on the plot
      (marked unconfirmed, as F9's case), but nothing is written to Zotero
      from it without the reader's confirm
- [ ] B36 one "Uncaught (in promise) undefined" in the Error Console, no
      stack, seen twice. Name it when it comes back
- [ ] B38 the region border grows a tip toward a neighbour just before two
      regions merge. Deferred by the user on 2026-09-11 after three
      renderings; not to be reopened unless they do
- [ ] Architecture candidates 3 to 5 from the 2026-09-13 pass (state, then
      plot, then chrome; the rail's inputs from their owners; the focus
      vocabulary rename) wait for a decision; 3 is large and comes after Stage
      4's spec. Left from the same pass: N2 (suite dependency, a note for triage)

## From the 2026-11-01 walk

- [ ] D36 the Key's States (B107): the Seed ring split into the seed colours
      looks wrong with several seeds; redesign it (a design question: the
      user picks on a canvas). The Selected row is gone (2026-11-01).
      Canvas: https://claude.ai/artifact/TQnib58fxDn67dxpiVKJiA, Now beside
      A (one neutral ring), B (a row per seed, by name), C (a neutral ring
      and a dot per seed colour)
      A is built on branch `d36-neutral-seed-ring` (not merged); unit tests
      only, as no Zotero case reads the ring. Its check: seed three papers,
      and the Key's Seed row shows one dark ring, not three arcs
- [ ] D40 failed hop papers are invisible and stay failed (B94's walk): after
      a fetch offline, reconnecting and Resume, the user could not tell which
      papers had been tried or failed, and wants them retried once the
      network is back. Brainstorm against ADR 0014 and B94, which chose not
      to ask again
      Proposal (2026-11-01, for the brainstorm): record why a paper failed,
      offline (no answer at all) or answered (a provider said nothing usable,
      ADR 0014). Offline failures retry once the window's `online` event
      fires, and Resume takes them back too; answered ones stay out as B94
      chose. The hop line's `n failed` becomes a toggle that rings the failed
      papers on the plot, so which ones were tried can be seen
      The visible half is built on branch `d40-show-failed-papers` (not
      merged): the hop line's `n failed` is a control that lights the failed
      papers while hovered or focused (the model's new `failed` field); the
      line's text is unchanged. Hops suite 23/0. Its check: after a fill
      offline, point at "n failed" and the failed papers stand out
      The retry half is on branch `d40-retry-after-reconnect` (not merged):
      on the window's `online` event, unless the fill is stopped, every
      failed paper is asked again (`retryAfterReconnect`, unit-tested);
      this reverses B94 for failures, so it is the user's call. Hops suite
      23/0. Its check: fill offline, reconnect, and without pressing
      anything the failed count falls as the papers fill
- B81's check retires: Paper details no longer shows a Citations row, only
  the Cited by tab (`Cited by (n reported)`), so the count's source is shown
  nowhere there. Reopen only if the user wants the source on that tab.
- D11's check failed on 2026-11-01: a References fill still leaves nodes as
  "Title unavailable" beside the resolved ones. Measure under D11.

## Manual verification (the user checks these in Zotero, in one batch)

Each session that merges an item appends its checks here instead of asking the
user to verify right away. Install the XPI from `.scaffold/build/meristema.xpi`
(built from the latest main), then walk the list; tick what passes, and turn
any failure into a new entry above.

- Refusals were not reached on 2026-10-07 or 2026-11-01, so B50, B72 and
  B64 wait for a session where Semantic Scholar refuses.
- Offline cover, 2026-11-01: the Citation hops suite serves refusals for B50
  ("under provider refusals"), B72 (its drain case), B64 (a Refresh seeds
  under refusals ends in 1.3 s; with the fix reverted, 16.2 s, red) and
  B78/B79 (Seeds linked tiers, the key cleared live). What only the live
  walk adds is real provider timing; retire any of the four on your call.
- [ ] B50: on your own profile (no Semantic Scholar key), fill a seeded graph
      to hop 3 under Citers. While it runs, the hop line shows only Stop and
      the hop counts keep climbing. If it reads `… refusing · retry in …`,
      the countdown ticks without the rail flickering, Stop keeps focus under
      the keyboard, and Resume starts expanding at once. (The countdown half
      passed under the 2026-09-16 probe.)
- [ ] B72: fill hop 3 on your own profile while Semantic Scholar is refusing.
      The hop line ends at rest (`n not expanded`, `n failed`, with Resume)
      rather than switching between Stop and refusing for good. A 2026
      frontier paper reads as expanded with no citers, not re-asked; on
      2026-09-16 the same ~20 DOIs were fetched 10 to 16 times.
- [ ] B64: with Semantic Scholar refusing, press Refresh seeds. The progress
      window closes in seconds, not after 15 s.
- [ ] B78: with an OpenAlex key, seed two papers that share a citer which made
      only one seed's cut of 50 (two seeds in one field with many citers).
      Set Colour to Seeds linked: the Key lists the tiers, and the citer is in
      `Cite all 2 seeds`, with an edge to each seed in its colour;
      `Shared by ≥ 2` keeps it. Repeat under References, where the tier reads
      `Cited by all 2 seeds`. Close and reopen the graph: the grading is back
      with no check request. Clear the key in Settings with the graph open:
      the citer moves to `Cite 1 seed` at once, no reopen; put it back and it
      is in
      `Cite all 2 seeds` again, with no check request (B79).
- [ ] B114: right-click a paper that is not in the library, choose Add to
      Zotero…: Paper details opens its collection chooser, with the cursor in
      Search collections and the chooser in view.
- [ ] B116: start a graph from one paper an earlier graph had filled: the
      gallery asks "How do you want to look at this paper and its N citers?"
      (N matching the rail's hop 1); switch the rail to References on a
      fresh one and it reads "references".
- [ ] B119: on a seeded graph, the Fetch hop N button reads at full ink
      while its row's tick, swatch and "Hop N" stay grey.
- [ ] D37: open the view gallery on a blank graph: each card's description
      and its "Needs a seed" tag read at a size close to the card's name.
- [ ] D36: on a seeded graph, the Key's States list Seed but no Selected row,
      and selecting a paper still rings it on the plot.
- [ ] D35: open View: under a rule it offers Graph display settings…,
      Reset this graph and Use these for new blank graphs (Restore built-in
      too once a default is stored). Graph display settings… opens the gear,
      also with the rail collapsed (the rail opens first); Reset this graph
      undoes a gear edit. The gear's own foot buttons still work.
- [ ] B112: on an external paper, press Update this paper's connections, and
      while it runs delete any item in the library: the graph redraws, and
      the button stays disabled until the update ends.
- B42 (the newer-version read-only notice) was skipped at the user's call on
  2026-09-13, unwalked: there is no newer version anywhere. Re-offer it when a
  second version exists in someone else's hands; `node:sqlite` can edit the
  row, and `test/zotero/graphViews.test.ts` covers the version-99 path.

## Zotero suite

`npm test` launches the dev Zotero and runs `test/zotero`; the user has said it
may be run from a session. Run it in full every 4 or 5 commits, not per change
(the user, 2026-09-17: per-change runs are unsustainable); a case under work
runs alone under a temporary `describe.only`. Last full run: 2026-11-01 at `855e7fd` (135/0), so count with the commits since `855e7fd`. A clean run is 135 cases as of 2026-11-01. B28's case deselects the folder the case before it left
selected, so it does not test what its name says.

- The floor drag case's full-run failures (2026-10-06 to 2026-10-18) were
  B111: Zotero's tab hooks focus `.cm-search`, and in the 1000px test window
  the plot pane is narrower than its toolbar, so the focus scrolled the pane
  104px and the floor's tag sat under the rail, hoverable by the case's
  synthetic walk but not pressable by `sendMouseEvent`. The plot's
  containers now use `overflow: clip`; `graphPlotPaneNeverScrolls.test.ts`
  holds it.
- A library change (a fixture saved or erased) refreshes an open graph tab,
  and the refresh remounts its view. A case that holds the view's root across
  an await can read a detached copy; look the root up again (F5's case).
- One-off on 2026-10-21: `graphTabRestore.test.ts` "keeps a record of an open
  graph tab" found no record within 10 s; the next two full runs passed it.
- One-off on 2026-10-19: `graphViews.test.ts` D17 case read the label
  select as the edit just after Restore built-in (no wait between the click
  and the read); its file then ran 14/0.
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
- 2026-10-08: B81 fixed (`c191308`): a hop node's count labels now read the count's own
  `propertySources` (`countProviderForNode` in `graphFocusService.ts`). The
  work's provider wins when it reported the count too, and a record with no
  sources falls back to it. Red, then green, in `graphFocusService.test.ts`.
  B73's case now arms through a record with no sources.
- 2026-10-08: B76 done: D8's keyless case ("without an OpenAlex key (D8)" in
  `graphCitationHops.test.ts`) clears the key, serves Semantic Scholar and a
  sorted OpenAlex page for its own seed, and asserts Semantic Scholar's page
  comes first, no OpenAlex list, and the `First 50` cut line. Seen red under
  two mutations (OpenCitations first in `fillProviderOrder`; `cutOrderFor`
  always `most-cited`). Treating OpenAlex as paging when keyless is NOT
  caught: `requestOpenAlex` refuses without a key, so the fill only loses
  ~17 s. Full suite 101/0 with it. D8 is closed, so its spec is deleted.
- 2026-10-08: F13 done, the user choosing the hovered label over an instant
  hover card: the hovered paper's label is its whole title, wrapped at 280px
  (`wrapLabel` in `graphRendererScene.ts`), under either label mode; others
  keep the 42-character cut. Red, then green, in `graphHoverLabel.test.ts`.
- 2026-10-08: B93 done. Zotero writes View › Font Size onto registered roots
  only (`#zotero-pane`, `#zotero-context-pane`) as `font-size: <pref>rem` and
  `--zotero-font-size`; the graph tab sits outside both, and the plugin sized
  text in px. `followZoteroFontSize` (`src/services/zoteroFontSize.ts`)
  registers the graph root and the update popup, and redraws the canvas on
  `UIPropertiesChanged`. CSS text is `calc(N * var(--cm-font-unit))`, N px at
  the default; ×/+ glyph buttons stay px (`glyph:` marker). The canvas reads
  its scale off its computed font size; the labelled plot gutters grow with
  it. Red, then green, in `zoteroFontSize.test.ts` and
  `test/zotero/graphFontSize.test.ts`.
- 2026-10-08: F11 done. A Seeds row's swatch and label are one button
  (`cm-scope-seed-body`, `aria-pressed`) that selects the seed through the
  node click's path, so it reports to the list; `buildScopeRailModel` marks
  the row whose key is `selectedKey`, and every graph selection refreshes the
  Scope rail. Red, then green, in `graphScopeRailModel.test.ts` and the Scope
  rail suite. The suite's first try failed falsely: the items tree fires no
  `onSelect` while its tab is hidden, so a list pick made milliseconds after
  showing the tab reads the old row; the case now waits 500ms as a reader
  would, and passes with no binding change.
- 2026-10-09: B15 and B45 done, the user choosing to add on a row click over
  keeping the preview: in the seed search panel a non-seed row's button
  (`cm-focus-seed-result-main`) adds the seed and keeps the panel and query;
  its + is an `aria-hidden` hint inside the button. A seed row selects, with
  ×. The title and metadata sit in `cm-focus-seed-result-text` with a 6px
  gap; the 4px gap measured exactly 4px in the main window, so B45 was a
  re-judgement, not host CSS. Red, then green, in the Scope rail suite.
- 2026-10-09: B90 done. Below ~950px Zotero stacks the item pane under the
  items list (`#zotero-layout-switcher` `orient="vertical"`), where it spans
  the window, and `bindZoteroPane` copied that width to Paper details (727px
  at an 850px window, plot 78px). While stacked the item binding keeps its
  last side width, as while collapsed. Red, then green, in
  `zoteroPaneSync.test.ts` and `graphStackedItemPane.test.ts`.
- 2026-10-09: B54 and B55 done; the user chose that a reopen never starts
  fetching on its own after a Stop. B54 was a real refetch: a reopened graph's
  first walk asked `hopSubject` for hop papers the merged model did not hold
  yet, read them unexpanded and re-asked their lists. The walk now hands the
  lookup the node it reached each paper by. B55: the stop is saved with the
  graph (`fillStopped`, state version 8). Found on the way: `parseHops` read
  `hops` only at the current version, so version 5 and 6 rows reopened on
  Citers at depth 1; it reads them from version 5 on. Red, then green, in the
  Citation hops suite (the served index gains r5 so hop 3 has a request).
  B94 filed for the failed set and the caps; D23 filed for the narrow layout.
- 2026-10-09: B7 done; the user chose to open the empty graph. Two things
  stopped it: the "contains no regular Zotero items" guard in
  `openGraphWindow`, and the new tab's `itemID` read from the library's first
  paper. Red, then green, in `graphEmptyLibrary.test.ts`.
- 2026-10-09: B94 done; the user chose to save the failed papers, not the
  caps. The runner hands out its ordinary failures (`failures`, the deferral
  limit's left out, as Resume would ask them) and takes them back on reopen
  (`restoreFailures`); state version 9 carries `failedKeys`. Red, then green,
  in the runner and state units and the Citation hops suite (r6 added so
  Fetch hop 4 has a list to fail; a 404 stores an empty list, so the case
  answers lists with 500).
- 2026-10-09: B86 done. The user's laptop screenshot (125%) showed a second
  guide through each child's square: the guides' strip ended at the indent's
  width, where the next period's line starts, and the mid-pixel edge leaked
  it. The strip now ends just past the last ancestor's line. Red, then green,
  in `graphScopeTree.test.ts`, whose case waits for graph.css first (it ran
  before the sheet applied twice). The HDMI screen showing no guide at all is
  unexplained; the manual check asks again.
- 2026-10-09: B95 done. The gallery is anchored at the top with a
  `max-height` of the plot less its margins, so it ends at its cards and a
  short plot scrolls it. Red, then green, in `graphViews.test.ts` (the case
  grows the plot, since the runner's is shorter than the cards). The full run
  that followed failed B7's case: `externalSeedImport.test.ts` assigned over
  the ids it erases and leaked "B6 direct import fixture"; it now pushes.
  The user then asked for the gallery centred over a mask on the graph: the
  section is now a full-area scrim of the theme's `Canvas` at 95%, and a
  `.cm-view-gallery-panel` inside it carries the cards, centred.
  The shipped views' paragraphs were cut to 21 to 24 words (from 35 to
  54), each without the "untouched" sentence the footnote already says; a
  unit case holds them at 25 words or fewer, within 5 of each other.
- 2026-10-09, late: full run at `0efe291` 109/1 (view 3 clicked the
  gallery mask; fixed in `1246ea2`). B87 closed on the user's word; D14 closed
  by the full-area mask (`5f43ba1`). Next: D7 with D12.
- 2026-10-09, evening: D7 and D12 shipped on `d7-hop-rail-story`. The hop
  rows read `n papers · from N` with a spinner while their parents are
  planned, the line is Stop alone while running and one gaps line at rest
  (`not expanded`, `failed`, Resume or Fetch more) plus `without details`.
  Full run at `211b49d` 110/0. B51 narrowed.
- 2026-10-09 night, unattended, with subagents per item: B18, B20, B51
  (correct by design, a regression test), F4, D18 and the rail's bare Resume
  shipped; B34 shipped (culling) and B89 eased (culling, a draw a frame);
  B47's edge crossing, B48's Refresh, D11's per-second publish, D15's
  sticky notice and F3's committee label fixed, each entry rewritten to the
  decision it waits on; the gear no longer saves axes it fell back to. Full
  run at `da2b54d` 111/0. Not pushed.
- 2026-10-11: the user decided eleven open entries; B26, D9, D15, D17, D19,
  D20, D21, D22, F7, B47 and B48 shipped in parallel worktrees, and F4's folds
  keep their state across selections (ADR 0019 for D17). The full run found
  the floor tag covering B48's band; a paper under the tag now wins. Full run
  at `2b25538` 117/0. Not pushed.
- 2026-10-15: the user walked the 2026-10-11 build; most checks passed. Fixed
  from the walk: B96 to B103, D24 to D27, D15's notice case; built from the
  user's calls: F14 (ADR 0020), F15 (ADR 0021), F16, D28, D29, D30, F3's
  labels. Full run at `96d3963` 121/2, both in the test, fixed. Not pushed.
- 2026-10-16: the user walked the 2026-10-15 build. Fixed from the walk: B104
  to B108, D31 to D33, F17. Full run at `192ccd7` 124/1, in the test, fixed.
- 2026-10-19: B111 found and fixed (the plot pane scrolled when Zotero's tab
  hooks focused the search box in a narrow pane; `overflow: clip`). Full run
  129/0. Not pushed.
- 2026-11-01: the user walked the 2026-10-21 build. Passed: B86, B104,
  B106, B108 to B111, D16, D31 to D34 as built, F5 but for Add to Zotero…,
  F17. Filed B113 to B119 and D35 to D40; B81's check retired, D11's failed.
- 2026-11-01: B118 fixed: the overlap relaxation may move a node 1% of a
  count axis's range, not a quarter of a tick (125 citations on 0..1500),
  and the view zooms to 32x, not 8x. Not pushed.
- 2026-11-01, later: B118's walk found the real cause: the axes fit the
  whole model, and a seeded graph keeps the whole library in it, so a
  5,249-citation paper the graph did not show set the Y axis. The axes now
  fit the frame, what the folders and hops admit (`setFrameKeys`). Not pushed.
- 2026-11-01, later: D41 shipped: the Overview leads with the citation and
  reference counts, and every metric row carries one hover, meaning then
  sources, read off the paper shown rather than matched by title. B81's
  question (where the count's source shows) is answered by it. Not pushed.
- 2026-11-01, later: the user walked B118 and D41; both passed.
- 2026-11-01, later: D38 shipped: the Cornerstones view is named References;
  its id stays, since saved graphs reference it.
- 2026-11-01, later: D39 shipped: Advanced starts collapsed, and stays as
  the reader leaves it across papers.
- 2026-11-01, later: full suite 130/0 at `96578b4`; D39's cases pass. B113
  measured on the user's profile (the stores take 1.45 s, and the graph tabs
  waited for them) and fixed: the tabs go up with Zotero's, and a graph's
  draw waits at a gate for the stores.
- 2026-11-01, later: the user walked B113; it passed.
- 2026-11-01, later: the user walked D38 and D39; both passed. B114 shipped:
  the node menu's Add to Zotero… opens the pane's collection chooser.
- 2026-11-01, later: full suite 131/0 at `da42a98`; B114's case passes.
- 2026-11-01, later: B115 closed, by design. A probe in the suite read
  `prefers-reduced-motion: reduce` in Zotero on the user's machine (Windows'
  Animation effects off, `MinAnimate` 0), and the camera took the jump branch
  of `glideTo`. With animations on, the glide runs as B105 shipped it.
- 2026-11-01, later: B116 shipped. The count was true (hop 1 is automatic,
  and a stored list draws at once); the gallery's heading now names the seeds
  and what the hops brought (`galleryHeading`), citers or references by the
  direction.
- 2026-11-01, later: B117 shipped. The Scope folder rows lose their own
  `max-height: 40vh` scroll; the rail body is the one box that scrolls.
- 2026-11-01, later: the user walked B117; it passed, and its check retires.
- 2026-11-01, later: B119 shipped. The unfetched row's 0.45 opacity sat on
  the whole row, button included; it now greys the tick, swatch and words.
- 2026-11-01, later: D37 shipped. The gallery card's description rises from
  11 to 12 and its tag from 10.5 to 11, beside the 13 of its name.
- 2026-11-01, later: D36's Selected row is dropped from the Key's States
  (and the heavy ring it alone used); the Seed ring's redesign stays open.
- 2026-11-01, later: D35 shipped. View gains a second group with the gear's
  actions (`GraphDisplayActions`); the gear keeps its foot buttons.
- 2026-11-01, later: B112 shipped. Running connection updates live outside
  the view (`connectionUpdates.ts`), by library and node key; a remounted
  view reads them and redraws when the update ends.
- 2026-11-01, later: M12 closes by structure. The stored list is looked up by
  `RelationshipStoreSubject`, which has no `key`, only `itemKey` and the
  library, so a promoted candidate (`itemKey` rewritten, `key` kept) finds the
  resolved paper's list; no test can ask it by the candidate key.
- 2026-11-01, later: M6 closes as obsolete. D12's at-rest line counts what
  is `not expanded` and never prints the cap, so Fetch more's raised cap has
  no literal 500 left to contradict.
- 2026-11-01, later: full suites 133/0 (before D36) and 135/0 at `855e7fd`.
  D36's Seed ring has a canvas of three directions. Not pushed.
- 2026-11-01, later: M13 closes as obsolete. D12 folded the per-hop cap line
  into one block-wide line, which `ScopeHopsProgress.afterHop` documents as
  following the deepest open hop. Canvases for D10, D13 and D23 linked from
  their entries, and a proposal for D40.
- 2026-11-01, later: B64 gains a Zotero case: Refresh seeds under served
  refusals comes back in 1.3 s, and red at 16.2 s with `retryRefusals: true`.
  Canvases for D5; proposals for F6, F10 and F12.
