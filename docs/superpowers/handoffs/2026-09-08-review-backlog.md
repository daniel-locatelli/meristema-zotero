# Review backlog: the long form of the open entries

> Sequencing lives in `roadmap.md` next to this file. Start there; it says
> which entry is next. Read an entry here only when the roadmap sends you.

Each entry below is still open and is the detail behind a one-line item in
the roadmap: the report, the pointers into the code, and what to decide.
Entries filed after 2026-09-11 live in the roadmap alone. When an entry
ships, delete it; git keeps it. Trimmed 2026-09-17: the shipped entries (B1
to B6, B8 to B14, B16, B17, B19, B21 to B25, B27 to B33, B35, B37, D1 to D4,
D6, F1, F2, F14) and the deferred B38 are in
`git show 54f007f:docs/superpowers/handoffs/2026-09-08-review-backlog.md`.

---

## B7. New Graph on an empty library fails silently

Found 2026-09-08 while reproducing B6 in the Zotero suite: Tools ›
Meristema › New Graph in a library with no regular items opens no tab.
This is a deliberate guard, not a crash: `openGraphWindow` in
`src/services/windowService.ts` throws "<library> contains no regular
Zotero items for Meristema." before any tab exists, and the menu's
command handler only passes that to `Zotero.logError`, so the user sees
nothing unless the error console is open.

Decision needed (short brainstorm): either open the tab on the empty
library and let the view show its empty state, so seeds can be added from
outside Zotero straight away; or keep the guard and tell the user through
a toolbar status or a prompt. The design's Scope rail (Stage 2) leans
towards the first, since a graph is then a recipe that may start with no
library items at all.

Test: a Zotero test that runs the command from the Tools menu against a
library with no regular items (the suite starts with an empty one) and
expects whichever outcome is chosen.

---

## F3. Standards (ISO etc.) without a main author

Observation: items whose creators are committees or none at all are
handled poorly (matching, labels).

Pointers: `src/services/zoteroLibraryService.ts` `authors(item)` (~line 98) reads `getCreators()`; where an empty author list gates behaviour:
`batchEnrichmentService.ts` ~lines 192 and 206 (skips enrichment when
`!work.authors.length`), `citationGraphService.ts` ~line 405 (label
fallback), `citationMetricsStore.ts` ~lines 732 and 965.

Scope for the session: (1) node label falls back to the institution or
`item.getField("publisher")` / "ISO 1234" number when there are no
authors; (2) enrichment should not skip such items when a DOI or title
exists; (3) matching by title+year only. Brainstorm briefly, then a
small plan.

## F4. Show the selected paper's abstract in the graph

Symptom (user's words, alongside the F1 check): "would be nice to also
see the papers abstract directly in the graph when you select one."

The detail pane already holds the abstract for a selected paper; the ask
is to have it without leaving the plot. Decide with the user whether this
is the pane being opened or widened on selection, an addition to the
node's hover tooltip, or a new block in the Overview tab.

Pointers: `src/services/paperDetailModel.ts` and `paperDetailView.ts`
(the Overview tab and what it already reads), the tooltip in
`src/services/citationGraphRenderer.ts`, and the 6a design's tooltip,
which is specified in
`docs/design_handoff_citation_chain_depth/README.md` and gains a
`Make seed` button in stage 3.

Note the interaction with Stage 2: the graph scope rail spec
leaves the detail pane alone, so this can land before or after it.

Process: short brainstorm, then a small plan.

---

## B15. Adding a seed from the search panel takes two clicks

Found in the walk-through, check 5. A row in the seed search panel has to be
clicked and then its "+" pressed. The panel was opened from "+ Add seed", so
the reader has already said what they want: clicking the row should add the
seed. Check what the row's other affordances are before removing the "+" —
the panel is also how a paper is previewed.

Pointers: the seed popover rows in `src/services/graphViewService.ts`
(`focusSeedResults`, `seedPopoverPaperForNode`).

---

## B18. The view fits after it renders, so the graph jumps

Found in the walk-through, extra note. Opening a graph draws it, and then "fit
to view" moves everything. The fit should happen before the first frame the
reader sees.

`scheduleFocusFit` waits for the viewport and the node count to hold still for
a few frames before it fits, which is why it lands late. Consider fitting
invisibly — render the first frame already framed — rather than shortening the
settle, which is what makes the fit correct.

Pointers: `scheduleFocusFit` and `applySeedProjection` in
`src/services/graphViewService.ts`.

---

## B20. New Graph from a detached window gives no feedback

Found in the walk-through, check 6. Low priority, and the user said so. With
the graph in its own window, New Graph opens a tab in the main Zotero window,
which may be behind everything: nothing appears to happen.

Either bring the main window forward, or open the new graph as another
detached window when the command came from one.

Pointers: `openNewGraphWindow` in `src/services/windowService.ts`.

---

## F5. The node's context menu should offer what the detail pane offers

Found in the walk-through, extra note. Right-clicking a node offers the open
entry, the seed toggle and Remove from graph. The detail pane offers Add to
Zotero, Open DOI, Similar, the seed toggle and Update connections. The user
wants the same set in both places.

Decide as part of it whether every pane action makes sense at a right-click,
and keep the menu short enough to stay a menu.

For the record, because the user asked: **Refresh** in the toolbar re-fetches
references and citing papers for _every seed_ when the graph is seeded, and
metadata plus citation counts for _every visible paper_ when it is not.
**Update connections** in the pane does the same fetch, both directions, for
_the one paper the pane is showing_. Same operation, different scope; the
labels should probably say so.

Pointers: `openNodeMenu` in `src/services/graphViewService.ts` for the menu,
the overview actions in the same file and in `src/services/itemPaneService.ts`.

---

## F6. Seed a paper that is not in Zotero into a new graph

Found in the walk-through, check 9. A saved graph whose only seed is an
external paper reopens correctly, so the state supports it; what is missing is
a way in. Today an external paper can only become a seed from inside a graph
that already exists.

Pointers: the seed search panel's external results in
`src/services/graphViewService.ts`, `openNewGraphWindow` in
`src/services/windowService.ts`.

---

## F7. A new graph should tick what it was made from

Found in the walk-through, extra note. New Graph ticks every folder. Made from
a folder it already ticks only that folder and its subtree
(`onlyCollectionsTicked`), which is right; made from a paper it still ticks
everything, and the user wants only the folders that hold that paper. A plain
New Graph with no origin is the case to decide: everything, or nothing.

Pointers: the `collectionTicks` initialiser in
`src/services/graphViewService.ts`, `initialCollectionIDs` and
`initialFocusItemIDs` in `src/services/windowService.ts`.

---

## F8. Nothing says why a paper has no metrics, and most papers have none

The user's question from the walk-through: "why is it that most items do not
have so much information under Advanced?" There are four reasons, none of
them visible in the UI, and the first is the big one.

**1. Nothing the providers can name — the big one, but not as blunt as it
first looks.** The batch enrichment pass only builds a task for a work that
`openAlexIdentifierForWork` or `semanticScholarIdentifierForWork` can name:
OpenAlex wants a DOI or an OpenAlex ID already on the record, Semantic Scholar
a DOI, PMID, arXiv ID or ISBN. But the _core_ lookup that runs first has an
**exact-title fallback** (`getExactTitleFallbackEnabled`, pref
`exactTitleFallback`, default on), so a DOI-less item whose title matches a
provider record is resolved anyway and the record keeps that
`providerWorkID` — after which enrichment can name it and the rows fill.

So the papers that stay empty are the ones whose **exact title does not
match**: a different subtitle or capitalisation, a non-English title, an
ambiguous match, or a work simply not in the providers at all — books,
chapters, reports, theses, standards, grey literature. That is the same
population as F3. For those, refreshing genuinely cannot help; for a paper
whose title does match, it can.

**2. The fields come from two providers with different coverage.** FWCI,
citation percentile, top 1%/10% and citations-by-year are OpenAlex's;
influential citations are Semantic Scholar's; journal h-index, i10 and
two-year mean citedness come from OpenAlex's source record. Disable a
provider in settings and its rows can never fill, and nothing says so.

**3. Enrichment only runs where an update ran.** `citationUpdateService` calls
`enrichCitationMetricRecords` for the records that _changed_ in that run, and
the automatic coordinator only sweeps at startup for the libraries ticked in
Meristema's settings, plus items modified since. An item in an unticked
library, or one that has never been through an update, has no metric record
at all, and `citationGraphService` reads every Advanced value off that record.

**4. Some rows are computed, not fetched.** Reference coverage, mean reference
age, reference-age spread, estimated self-citations and connections in library
are derived from the item's reference list, so they stay null until the
references have been fetched — the Refresh or Update connections path.

What to build is a question for the design, not a given: a line saying why a
row is missing, a badge on papers no provider can identify, a prompt to add a
DOI, or simply a "Fetch metrics" action where the dashes are now. Decide it
with B22, because B22 hides exactly the rows this entry wants to explain.

Pointers: `providerTasks`, `needsOpenAlexEnrichment` and
`needsSemanticScholarEnrichment` in `src/services/batchEnrichmentService.ts`;
`semanticScholarIdentifierForWork` and `openAlexIdentifierForWork` in
`src/providers/providerIdentifiers.ts`;
`enrichCitationMetricRecords`'s caller in
`src/services/citationUpdateService.ts`;
`getSelectedCitationUpdateLibraryIDs` in
`src/services/automaticUpdateCoordinator.ts`.

---

## F9. A tool for adding a DOI — starting with the one the plugin already has

The user's call, 2026-09-09, after reading F8: "we should definitely have a
tool to help adding a DOI." The interesting part is how much of it already
exists.

**The plugin usually knows the DOI and never writes it down.** When the core
lookup resolves a library item — by identifier, or by the exact-title fallback
— the result is persisted as a `CitationMetricRecord` that carries `doi`,
`provider`, `providerWorkID`, `matchedBy`, `matchConfidence` and
`matchConfirmed`. The Zotero item's own DOI field is never touched: the only
`setField("DOI", …)` in the codebase is in `externalDiscoveryService`, when an
external work is imported as a _new_ item. So an item can sit there with an
empty DOI field while the plugin holds the DOI, the provider and a confidence
for it.

The first version is therefore small: where a paper has no DOI and the record
has one, offer to write it into the item. Two things have to be got right:

- **Confirmation.** A title match is not a certainty; that is exactly what
  `matchConfirmed` and the "Match needs confirmation" badge exist for. Writing
  a wrong DOI into someone's library is worse than leaving the field empty, so
  an unconfirmed match must be shown with its evidence — matched title,
  authors, year, `matchedBy`, confidence — and confirmed by the reader, not
  written silently.
- **Where it lives.** The item pane, the graph's detail pane, or a bulk action
  over a selection. A "Find DOI" that walks a folder is where the value is, but
  it multiplies the confirmation problem; the single-item case is the one to
  build first.

Beyond that first version: a lookup for items the exact-title fallback misses
— Crossref's bibliographic-relevance query already exists in
`crossrefDiscovery.ts` for a title-only item and returns candidates, which is
the shape a "search for this paper" chooser would need.

Pointers: the record built at the end of `citationUpdateService.ts` (`doi`,
`matchedBy`, `matchConfidence`, `matchConfirmed`);
`getExactTitleFallbackEnabled` in `src/services/citationPreferences.ts`;
`createBadges` in `src/services/paperDetailView.ts` for the existing
confirmation badge; `crossrefDiscovery.ts` for the relevance query;
`externalDiscoveryService.ts:2171` for the one place a DOI is written today.

---

## D5. One logo, on both themes, that says meristem

The user's note from the walk-through. There are two marks today: the blue
`favicon.png` the add-ons manager shows, and the white
`content/icons/network.svg` used across the UI and the tab. The white one does
not work on the light theme, which was already known.

Wanted: one mark, legible on both themes, that carries the meristem idea — the
growing tip, the thing that keeps branching — rather than a generic network
glyph. Brainstorm the idea before drawing anything.

Pointers: `addon/content/icons/`, `ICON` in `src/services/menuService.ts`,
`addon/content/tabIcon.css`, the manifest's icon entries.

---

## B26. Region membership follows the visible node set, so the search box can reshape or empty a selected folder's hull — and that is the opposite of the rule just decided for swatches

Found in the final whole-branch review of D3. A region's contour is built
from whichever of its folder's nodes are currently visible, so typing in the
search box — which narrows the visible set through `applyFilters` — can
shrink a selected region's hull mid-keystroke, or empty it to nothing if the
search excludes every node the folder held. This may be the right behaviour
(a region showing only what is actually on screen), but it was never decided
as a rule; it is what fell out of building the contour from
`getScopeNodes()`/the renderer's visible set.

It sits two functions away from a rule already made explicit for a related
concern: `seedColorsFor` and `regionsForRenderer` (B24) are being pulled
apart precisely so that _allocation_ survives a filter that temporarily hides
a key — a seed or a folder keeps its swatch even while filtered out of view.
Region _membership_, by contrast, is allowed to follow the filtered view
exactly, with no such survival. Whether that asymmetry is intended (a swatch
is an identity, a hull is a picture of what is on screen right now) or an
oversight is worth deciding on its own, not inheriting from whichever
function happened to be touched first.

Pointers: `src/services/graphViewService.ts` (`regionsForRenderer`'s node-set
computation, `getScopeNodes()`), `src/services/graphFolderRegion.ts`
(`folderRegionContours`, which only ever sees the points it is handed), the
search box's `input` listener and `applyFilters`.

---

## F10. Select nodes in the graph and have Zotero follow

Selection is one-way today: a selection in Zotero's list reaches the graph,
but a selection in the graph does not reach the list — and multiple nodes
cannot be selected on the canvas at all.

Wanted: multi-select on the plot (rubber band or shift-click) with the Zotero
list following it, so the graph can be used to _build_ a selection rather
than only to display one.

One open question from the walk, worth settling in the same pass: a one-row
library selection draws a white ring on the node, while a two- or three-row
selection instead makes the selected nodes opaque and everything else
transparent. The user asks whether the multi-row case should carry rings too.
Two visual languages for one concept is the kind of thing D3 has just spent a
branch removing.

B30 is the same seam from the other side; the two should probably land
together.

---

## F11. Clicking a Seeds row should select that seed, and selecting a seed node should light its row

Today a Seeds row in the rail emphasises its seed on hover and that is all:
clicking it does not select the seed, and selecting a seed's node on the plot
does not mark its row. The user wants both directions.

The rail already carries the machinery — `onEmphasise` with a `RailEmphasis`,
and the folder rows already have a real selected state with `aria-pressed` —
so this is mostly wiring a click and a reverse notification, not new
interaction design.

Pointers: `src/services/graphKeyRail.ts` (the seed row, `removeSeed`,
`onEmphasise`), `src/services/graphViewService.ts` (`applyEmphasis`, the
selection path).

---

## F12. Selecting a folder in Zotero should activate its region in the graph

The user's analogy: item selection is two-way between Zotero and the graph,
so the folder selection should be too — clicking a collection in Zotero's
left pane would draw, or activate, that folder's region on the open graph.

Design questions to settle first rather than guess at: whether it _adds_ to
the region selection or _replaces_ it; whether it also ticks the folder into
scope, as clicking the rail row does; whether it reaches every open graph or
only the focused one; and what happens at the four-region cap. There is a
real argument against it too — a graph is a recipe the reader composed, and
repainting it every time they browse their library in the next pane over
could be more disruptive than useful. Worth a brainstorm, not a patch.

---

## F13. Show a paper's full title in the graph

The label is ellipsised when the title is too long, and the user wants the
option to read the whole thing on the plot.

Not a one-line change: `graphLabelBudget.ts` exists because labels compete for
space, and a full title is several times the width the budget assumes. The
design question is which surface carries it — every label at full length (and
what that does to the budget and to overlap), the hovered or selected paper
only, or a wrapped label over two or three lines with a width cap. Decide that
before touching the budget.

Pointers: `src/services/graphLabelBudget.ts`, the renderer's `drawLabels`, and
the Label control in the gear panel (`graphViewControls.ts`,
`labelledLine("Label", labels)`), which is where an option would live.

---

## B34. Panning a 300+ paper folder at maximum zoom lags

Found walking D6's last check on 2026-09-11: "It has a delay to it. We can
try to optimize the render later." The user filed it for later, so it is
not urgent.

The roadmap's check already named the suspect, and the walk did not
contradict it: at maximum zoom the contour is cheap (a 300-paper folder is
about 5 k cells after the shapes round) and a pan recomputes nothing, so the
lag is the draw path. `drawRegions` rebuilds every folder's `Path2D` from
scratch on every frame, discs and Bézier loops alike, including shapes that
sit entirely off-screen — and maximum zoom is exactly where a folder is many
small loops. Measure before touching: a `performance.now()` bracket around
`drawRegions` and around the whole `draw()` says whether it is the path
build, the fill, or something else on the frame.

Two cheap candidates once measured: cache the `Path2D` per folder per
(bucket, transform) and translate on pan rather than rebuild, or cull shapes
whose data-space bounding box misses the viewport before emitting them.

Pointers: `drawRegions` and `draw()` in the renderer
(`src/services/citationGraphRenderer.ts` / `graphRendererScene.ts`);
`regionPathFor` in `src/services/graphFolderRegion.ts`; the contour cache
keyed on the zoom bucket.

---

## B36. "Uncaught (in promise) undefined" in the Error Console

Seen on 2026-09-11 while walking D6's console check. The console was
otherwise quiet of the plugin: every other line is Zotero's own locale,
devtools and reader noise, plus one warning that is ours and harmless (a
sectioned `h1` with no font-size, from the visually-hidden "Graph" heading
`graphViewService.ts` builds — `text(document, "h1", "Graph",
"cm-visually-hidden")`).

The one line that is not attributable is `Uncaught (in promise) undefined`,
with no file or stack. It appeared once, between two blocks of locale noise,
and nothing on screen went wrong. It is worth an entry because it is the
second sighting of a rejection whose value is `undefined`: the intermittent
`savedGraphMenu.test.ts` failure printed its error as "undefined" too.
Nothing says they are the same; nothing says they are not. Next time it
appears, note what was just done — the walk's steps were folder selection,
zoom, pan and theme swap — and whether the plugin's own windows were open.

Pointers: any `.then()` without a rejection handler, and any `reject()` or
`throw undefined` path in `src/`; the savedGraphMenu note in the roadmap's
Zotero suite section.

---
