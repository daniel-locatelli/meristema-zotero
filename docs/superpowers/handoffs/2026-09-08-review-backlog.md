# Handoff: manual review backlog, one entry per session

> Sequencing lives in `2026-09-08-roadmap.md` next to this file. Start there; it says which entry is next and ticks progress.

Date: 2026-09-08. Branch `main` at `204bdf1`, pushed, tree clean.
XPI `.scaffold/build/meristema.xpi` built from `204bdf1`.

Source: the user's manual walk-through of saved graphs (phase 2) and
selection sync. Each entry below is self-contained: pick one, read only
its pointers, fix, gate, commit, push. Do not read the older handoffs
unless an entry says so. Working rules at the bottom.

Suggested order: B1, B2, B3, B4 (small bugs), then B6, then the design
items D1, D2 and the features F1, F2, F3.

Passed, no action: loading from the tab (3), delete keeps the tab (7b),
selection sync 8, 9, 11 to 17.

---

## B1. Dialogs show "[JavaScript Application]" with a question-mark icon

Symptom: Save as and Delete prompts are `window.prompt` / `window.confirm`,
so Gecko titles them "[JavaScript Application]". Delete's two sentences
also run together on one line.

Pointers: `src/services/windowService.ts` `askName` (~line 513,
`prompt("Save graph as", …)`) and the delete confirm (~line 551).
`dialogWindow()` picks the detached window or the main window.

Fix: use `Services.prompt.prompt(win, title, text, valueObj, null, {})`
and `Services.prompt.confirmEx` / `confirm(win, title, text)` with a
title such as "Meristema" and the second sentence after `\n`. Zotero
plugins reach it as `Services.prompt` (global `Services`). Keep the
return contract: `askName` returns the trimmed name or null; the confirm
returns boolean.

Test: no unit test possible; verify in Zotero (Graph › Save as…, and × on
a row in the Open list).

## B2. Tools › Meristema › Open Saved Graph shows an empty list the first time

Symptom: first open shows only "No saved graphs yet."; the second open
lists the graphs.

Pointers: `src/services/menuService.ts` `openSavedGraphSubmenu` (~line 463) calls `fillSavedGraphPopup` (~line 402) from `onShowing` without
awaiting; the fill is async (lists from SQLite), and the first showing
paints before it resolves. The submenu's static child is the disabled
"empty" item. Ledger (`.superpowers/sdd/progress.md`, saved graphs Task 5) noted "rapid reopen race on async fill".

Fix options: pre-warm the list when the parent Tools menu shows (its own
`onShowing`, `toolsSubmenu` ~line 494) so the submenu's fill is
synchronous from a cache; or in `fillSavedGraphPopup` keep the rows in
the popup after `popuphidden` instead of clearing them, and only
re-list in the background. Check whether MenuManager hands `menuElem`
as `<menu>` or `<menupopup>` on the first showing (both branches exist
~line 470).

Test: in Zotero, restart, open Tools › Meristema › Open Saved Graph once.

## B3. Renaming a tab does not rename the saved graph

Symptom: user renamed a tab of a saved graph; the Open list did not show
the new name. (My walk-through step 6 meant: a saved graph's row is
renamed when its tab is renamed. The spec promised this
"rename-through".)

Pointers: `src/services/windowService.ts` `renameGraphView` (~line
1495): sets `customTitle`, and if `instance.savedGraphID !== null` calls
`renameSavedGraph(id, normalized)`. `src/services/savedGraphService.ts`
`renameSavedGraph`. The tab rename UI lives in `menuService.ts`
(`rename-view-command`, ~line 552) and in the Zotero tab context menu.

Suspects: the rename path used (Zotero's own tab rename, or the title
edit in the view header) does not go through `renameGraphView`; or
`savedGraphID` is null on that instance because the graph was opened
from a saved row into a new instance but the id was not carried
(`openGraphWindow` sets it only when `options.savedGraph &&
options.newInstance`, ~line 1190); or the list was read before the
write. Add a debug line in `renameGraphView` and check which.

Test: unit test in `test/unit/savedGraphService.test.ts` already covers
`renameSavedGraph`; the gap is the wiring, verify in Zotero.

Outcome (2026-09-08): the wiring was sound; `test/zotero/savedGraphRename.test.ts`
drives the real Tools row and tab context menu and the row is renamed. The
user's case was a view that had never been saved: renaming it did nothing to
the list. Decision (user): renaming a scratch view saves it under that name.

## B4. Item context menu reads oddly: "New Graph from 3 items", "Show in new Graph", "Refresh"

Symptom: three entries that overlap in meaning sit next to each other.

Pointers: `src/services/menuService.ts` item menu entries (`commandItem`
calls ~lines 180 to 270); labels in `addon/locale/en-US/mainWindow.ftl`
(`new-graph-from-item`, `show-in-new-graph`, `refresh-command`);
`typings/i10n.d.ts` is generated, regenerate after FTL edits (see how
saved-graphs Task 5 did it in the ledger).

Design call for the session: propose a consolidated set before editing.
Candidate: "New Graph from N items" (seeds), "Show in ›" (existing
graphs), drop "Show in new Graph" (it is "New Graph from" without
seeds), and move "Refresh" under Tools › Meristema. Confirm with the
user before changing labels.

## B5. Clicking empty space in Zotero's list does not clear the graph selection

Observation: Zotero's items tree does not deselect on an empty-space
click; the selection only clears with Ctrl+click on the selected row or
by switching to a folder. The sync itself then clears correctly (the
user confirmed via Ctrl+click).

Action: none in code. Rewrite the spec's walk-through step ("Click empty
list space") to "Ctrl+click the selected row" in
`docs/superpowers/specs/2026-09-07-selection-sync-design.md`.

## B6. Adding a non-Zotero node as a seed, then Add to Zotero, fails

Symptom: seed an external node, press Add to Zotero from its detail
pane; the import does not complete or the seed does not turn local.

Pointers: `src/services/graphViewService.ts` detail pane actions around
line 2773 (`show.addEventListener("click", …selectPaper(localItem.id))`
and `imported.id`), the import path in `paperOverviewActionsService.ts`
/ `paperDetailView.ts`, and the seed identity in `graphViewState.ts`
(`resolveGraphViewSeeds` resolves external seeds via
`inLibraryItemKey`/DOI). The durable-graphs spec's phase 1 promised the
imported seed "turns local".

First step: reproduce with the Zotero error console open
(`Zotero.debug` lines start with "Meristema:"); capture the message,
then `superpowers:systematic-debugging`.

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

## D1. Focus mode hides the rest of the graph; "Show in Graph" drops seeds

Symptom (user's words): "When I create a graph from a folder, then in
that graph I add one of the nodes as seed, all the rest that is not
connected to the seed disappears. I would like to still see the other
papers, and delete nodes I don't need. Maybe removing the 'Add node'
feature was a mistake; we may need Add/Remove node. Also when there is a
graph with seeds and I select another paper from the folder and 'Show in
Graph', the seeds are removed and I see only the papers again."

This is a design question, not a bug: today a seed switches the view into
a focus projection (seeds plus their neighbours) and "Show in Graph"
replaces the map scope. The user wants an additive model: the folder's
papers stay, seeds add neighbours, nodes can be removed one by one.

Pointers: `src/services/graphFocusService.ts` (`buildGraphFocusProjection`),
`graphViewService.ts` `enterFocus`/`exitFocus`, `activateFocusState`
(~line 1750), `applyMapItems` with modes replace/add (~line 3690),
`replaceMapItems` used by `openGraphAndSelectItemsInView`
(`windowService.ts` ~line 1597, called from the item menu "Show in ›").
Specs: `docs/superpowers/specs/2026-09-06-graph-view-merge-design.md`
and `2026-09-07-seed-entry-points-design.md` record why Add node was
removed and why seeds replaced scope.

Process: `superpowers:brainstorming` first (a real design session), then
spec, plan, subagent-driven development. Do not start by patching
`replaceMapItems` to `addMapItems`; the user needs to decide the model.

## D2. Node context menu has both "Add as seed" and "Explore from this paper"

Symptom: the two entries do the same thing.

Pointers: `src/services/graphViewService.ts` node menu ~lines 347 to 360
(`label: "Explore from this paper"`, `label: "Add as seed"`), also the
detail pane ~line 2858 and ~line 2994 (`nodeMenuSeed`). Check
`nodeMenu.ts` for the menu model.

Fix: keep one. "Add as seed" / "Remove seed" is the newer wording (seed
entry points spec). Remove "Explore from this paper" unless it differs
(it may open focus with a fresh seed set rather than adding). Confirm
the difference by reading `enterFocus` callers before deleting. Depends
on D1's outcome; if D1 is done first, do this inside it.

---

## F1. Right-click a node: open the paper

Request: double-click already selects the item in Zotero; add a node
context-menu entry that opens the paper (the PDF attachment, or the
item's URL/DOI when there is no PDF).

Pointers: node menu in `graphViewService.ts` ~line 340 to 370; external
nodes already open a URL via `Zotero.launchURL(externalWorkURL(work))`
(~line 3008). For local items: `Zotero.Items.get(itemID)`, best
attachment via `item.getBestAttachment()` (async), then
`ZoteroPane.viewAttachment(attachmentID)` on the host window, else
`Zotero.launchURL` of the DOI/URL. Menu labels: "Open PDF" when an
attachment exists, else "Open online".

Test: visual harness view (node menu entries) plus manual.

## F2. Wheel zoom sensitivity

Request: "I have to scroll a lot to zoom in/out."

Pointers: `src/services/citationGraphRenderer.ts` `onWheel` (~line 1130):
`factor = Math.exp(-event.deltaY * 0.0012)`, clamp 0.15 to 8.

Fix: raise the coefficient (try 0.002 to 0.003) and normalise
`deltaMode` (lines mode on some mice: multiply `deltaY` by ~16 when
`event.deltaMode === 1`). Consider a preference later; start with a
constant. Verify with a mouse wheel and a trackpad; trackpads send small
deltas and must not become jumpy.

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

## B8. The saved-graph dialogs are cramped, and Delete paints white edges

Symptom (user's words, walking the 2026-09-08 verification batch): "The
dialogs should be more spacious (including rename and all the others).
Right now it is too tight, the content too close to one another: the
buttons, the text, the icon, the edge. Also, right now the delete is
loading with some errors in the colors. The right and bottom edges load
white lines as if there was an error."

Affects every dialog B1 introduced: Save as, Rename View, and the Delete
confirm.

Cause: B1 moved these to `Services.prompt` to get a real title and drop
the question-mark icon, and `Services.prompt` renders Firefox's own
`commonDialog`. Its padding is chrome we do not own, and the white right
and bottom edges are that dialog's frame failing to pick up Zotero's dark
theme. No stylesheet of ours reaches it. B1's assertions all passed; this
is the cost of how they were met.

Pointers: `src/services/windowService.ts:546` (`askName`, prompt) and
`:587` (`remove`, `confirmEx`, `DELETE_CANCEL_BUTTONS`);
`src/services/menuService.ts:550` (Rename View). Spec:
`docs/superpowers/specs/2026-09-07-durable-graphs-design.md`.

**Decided 2026-09-08: keep the native dialogs.** The alternative was to
replace all three with an in-window modal built from the plugin's own DOM
and `graph.css`, which would have given full control of spacing and
theme. The user chose the native ones, so the cramped padding and the
white edges in dark mode stand, and no work follows.

This entry stays as the record of why those dialogs look the way they do,
so a later session does not read it as an unfixed bug and re-open it. If
the look becomes intolerable, the in-window modal is the route, and
Rename View would need a window-level host because it is raised from
Zotero's tab context menu, outside the graph view.

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

Note the interaction with Stage 2: `2026-09-08-graph-scope-rail-design.md`
leaves the detail pane alone, so this can land before or after it.

Process: short brainstorm, then a small plan.

---

## B9. A Semantic Scholar key makes the plugin request faster than its plan allows

Found 2026-09-08 while checking the code against Semantic Scholar's API
key application, not from a user report. Nothing is broken today, because
nobody has a key yet; it breaks on the day one is pasted in.

`providerExecutionPolicy.ts` treats a key as permission to speed up. The
keyless path is one request in flight with at least 1100 ms between
starts; with a key, `STATIC_POLICY["semantic-scholar"]` applies —
`requestParallelism: 2`, `minimumStartDelayMs: 150` — which starts
roughly six or seven requests a second. Semantic Scholar's standard
authenticated plan is one request per second. So entering a key would
take the plugin from comfortably inside the limit to several times over
it, and the key's owner would see 429s where they saw none.

The keyed policy should match the plan the key actually grants rather
than assume a key means "go faster". Decide with the user which plan
theirs is before choosing the numbers; the same question applies to the
OpenAlex key, whose policy has the identical shape.

Pointers: `src/services/providerExecutionPolicy.ts` (`STATIC_POLICY` and
the two keyless overrides), `src/providers/http.ts` (the per-provider
queue that enforces them).

---

## B10. There is no backoff; one fixed retry is all a 429 gets

Found alongside B9, and the reason it matters more once B9 is fixed:
throttling keeps requests under a limit, backoff is what recovers when
the limit is hit anyway.

`http.ts` has `RETRY_DELAYS_MS = [1500]` — a single retry at a fixed
1.5 seconds, whatever the failure. It does honour `Retry-After`, capped
at `MAX_RETRY_AFTER_MS` (15 s), and abandons the request when the header
asks for longer, which is deliberate: a long wait used to freeze every
request queued behind one unavailable provider. That much should stay.

What is missing is exponential backoff with jitter across three or four
attempts for a 429 or a 5xx that carries no `Retry-After`. Semantic
Scholar's key application asks the applicant to commit to exactly this,
and the user has ticked that box, so the code should match the
commitment.

Watch the interaction with the queue: `postponeProvider` already delays
the whole provider rather than the one request, which is the right level
for a shared rate limit. Backoff should raise that delay, not add a
second, competing wait inside `requestJSON`.

Pointers: `src/providers/http.ts` (`RETRY_DELAYS_MS`, `parseRetryAfter`,
`postponeProvider`, the retry loop in `requestJSON`).

---

## B11. A one-row library selection does not open that paper's detail pane

The last red case in `npm test`, and the oldest: `graphViewVisual.test.ts`
"view 15" has failed on `main` since before B2, and Stage 2 changed nothing
about it. Selecting exactly one row in Zotero's list is meant to select that
paper's node, so the detail pane leaves its placeholder behind and shows the
paper; the placeholder is still there afterwards, which is what the case
catches as `expected HTMLParagraphElement{} to equal null`.

The rest of the case passes, so the selection does arrive and the graph does
act on it: what is unclear is whether a one-row selection is meant to select
or only to emphasise now, and the answer decides whether the defect is in the
pane or in the case. `2026-09-07-selection-sync-design.md` is the authority,
and Stage 2's adopt rule — a fresh view keeps a selection it restored, and a
list row only emphasises — is the thing to read it against.

Pointers: `applyLibrarySelection` in `src/services/graphViewService.ts`,
`applyLibrarySelectionToInstance` in `src/services/windowService.ts`,
`test/zotero/graphViewVisual.test.ts` "view 15".

---

## B12. Folder colours are dealt by rank, so ticking a folder repaints the others

Found in the 2026-09-09 walk-through of Stage 2, check 3. Tick PhD and it is
magenta; tick DOKwood as well and DOKwood takes magenta while PhD becomes
purple. Colour is the reader's handle on a folder, and it moves under them.

The cause is in `graphCategoryAssignment.ts`: the categories are ranked
"largest first, ties by label" and then `theme.categorical.swatches[index]` is
handed out by that rank. The sort was written so the order never depends on
input order, which it does not — but it does depend on the counts, and every
tick changes the counts.

The fix is to make a folder's swatch a function of the folder, not of its
rank: hash the collection key into the palette, or hold a per-view assignment
that only grows. Whatever is chosen has to survive a reopen, so it belongs in
the saved state or in something derivable from the collection ID alone. The
rank still decides which categories are named in the Key and which collapse
into "Other"; only the colour stops following it.

Pointers: `src/services/graphCategoryAssignment.ts` (the `ranked` sort and
`entries`), `test/unit/graphCategoryAssignment.test.ts`, the Key's colour
section in `src/services/graphKeyModel.ts`.

---

## B13. "+ Add seed" is too dark to read on the dark theme

Found in the walk-through, check 5. The link is blue on a dark ground and the
contrast is too low to pick out. It is the only way to add the first seed, so
it has to read at a glance in both themes.

Pointers: `.cm-scope-add-seed` in `addon/content/graph.css`, the theme's ink
tokens in `src/services/graphTheme.ts`.

---

## B14. The seed row's × grows an off-centre ellipse on hover

Found in the walk-through, extra note. Hovering the remove control on a Seeds
row paints a shape behind the × that is neither centred on it nor round. The
user's call: style the × itself rather than putting a shape behind it.

Pointers: `.cm-scope-seed-remove` in `addon/content/graph.css`, built in
`src/services/graphKeyRail.ts`.

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

## B16. The Open list centres the graph names

Found in the walk-through, check 6. Rows under File › Open and Tools ›
Meristema › Open are centred while every other menu entry is left-aligned.

Pointers: the graph menu list in `src/services/graphViewService.ts`, its CSS
in `addon/content/graph.css`.

---

## B17. Tools › Meristema repeats the Meristema icon on every row

Found in the walk-through, check 6. Open, Save and Save as… each carry the
plugin icon inside a submenu that is already labelled Meristema and already
carries it. Drop the icon from the rows inside the submenu; the submenu itself
keeps it.

Pointers: `ICON` and the `item.setAttribute("image", ICON)` calls in
`src/services/menuService.ts`.

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

## B19. A folder's context menu reads "New PhD Graph"

Found in the walk-through, extra note. Right-clicking a folder offers
"New { $graph }" for one folder. The user wants "Create a new graph".

Note the label was built this way so a folder already named like a graph does
not read "New PhD Graph Graph"; a flat label solves that too.

Pointers: `collection-new-graph-command` in
`addon/locale/en-US/mainWindow.ftl`.

---

## B20. New Graph from a detached window gives no feedback

Found in the walk-through, check 6. Low priority, and the user said so. With
the graph in its own window, New Graph opens a tab in the main Zotero window,
which may be behind everything: nothing appears to happen.

Either bring the main window forward, or open the new graph as another
detached window when the command came from one.

Pointers: `openNewGraphWindow` in `src/services/windowService.ts`.

---

## B21. File is fourth in the plot toolbar; it belongs first

Found in the 2026-09-09 walk-through of Stage 2, check 6. The user's rule:
"File always comes first in any UI." Today `toolbar.append` puts Filter,
Similar, Export, File, Refresh in that order, so the menu that owns the
document sits between two actions on it.

Move File to the head of the toolbar. The search box stays at the far right —
it is the only elastic item and it is what makes the bar match Zotero's
`#zotero-items-toolbar`.

Pointers: the `toolbar.append(...)` call in `src/services/graphViewService.ts`,
and "view 5" in `test/zotero/graphViewVisual.test.ts`, which asserts the bar
stays one row.

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

## B22. Advanced is collapsed, and pads itself with dashes

Found in the 2026-09-09 walk-through of Stage 2. Two things the user wants
changed about the detail pane's Advanced section:

- **It should not be collapsed.** Nothing in it is editable, so there is
  nothing to protect the reader from; hiding it behind a disclosure only
  hides what the plugin knows.
- **It should show what is known and hide the rest.** `advancedMetrics` walks
  every registry entry whose `itemPane` is `"advanced"` and prints `—` when
  the value is null, so the section is the same nineteen rows for every paper
  and most of them are dashes.

The one thing to decide before doing it: an unenriched paper would then have
an **empty** Advanced section, which hides the fact that the data exists and
could be fetched. See F8 — the honest version says which rows are missing
_because nothing has been fetched yet_ and offers the fetch, rather than
silently dropping them.

Pointers: `advancedMetrics` and `createOverviewMetrics` in
`src/services/paperDetailView.ts`; `METRIC_DEFINITIONS` and
`SUPPLEMENTARY_PROPERTY_DEFINITIONS` in `src/services/metricRegistry.ts`
carry the `itemPane: "advanced"` flags.

---

## F8. Nothing says why a paper has no metrics, and most papers have none

The user's question from the walk-through: "why is it that most items do not
have so much information under Advanced?" There are four reasons, none of
them visible in the UI, and the first is the big one.

**1. No identifier, no enrichment.** `providerTasks` only builds a task for a
work that `openAlexIdentifierForWork` or `semanticScholarIdentifierForWork`
can name. OpenAlex needs a DOI (or an OpenAlex ID already on the record);
Semantic Scholar needs a DOI, PMID, arXiv ID or ISBN. A paper with none of
those is never asked about, so FWCI, percentile, influential citations and
the journal indices stay null forever, however many times it is refreshed.
Books, chapters, reports, theses and standards are the usual casualties —
which is the same population as F3.

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

## D3. The colour system has four palettes that collide

Found in the walk-through, check 3 and an extra note; the largest finding of
the batch, and the reason B12 should not be fixed alone.

Four things colour the plot and they are not designed against each other:

- **Folder categories** take `theme.categorical.swatches` by rank (B12).
- **Seeds** take the _same_ swatch list by seed index (`seedColorAt`).
- **A numeric colour metric** takes `theme.ramp`, teal to yellow.
- **The in-library ring** is a fixed `#4f9a5e`, which _is_ ramp stop three.

So with four seeds and a citations colour metric, the user had a green seed
(`#039f6c`, swatch three) against a green-to-yellow ramp, with green rings on
the papers reaching it. Three different meanings, one colour.

Two questions to settle, not one:

1. **What does a seed node's centre mean?** Today it is the node's own fill —
   its folder — so a paper in several folders is drawn in slices, up to
   `MAX_SLICES_PER_NODE`. The user does not think the centre should be the
   folder at all. Decide what a seed's mark says: which seed it is, or where
   it lives.
2. **How do the palettes stay apart?** Options: reserve a slice of the
   swatches for seeds and never give it to folders; derive the ring from the
   node's own colour rather than a constant; suppress folder colour entirely
   while a numeric colour metric is on, which is arguably already true of the
   Key.

This is a brainstorm, then a spec. It touches `graphTheme.ts`,
`graphCategoryAssignment.ts`, `graphKeyModel.ts` and the renderer's seed and
ring drawing.

---

## D4. Graph templates: presets a beginner can start from

The user's own framing, from the walk-through: "There are multiple ways to
visualize the same graph. I like the flexibility, but it may be hard for users
that are just getting started." A template is a named bundle of view settings
— axes, scales, node size, node colour, labels, filters — with an icon that
says what it is for, swapped in one click.

Open questions for the brainstorm: which templates ("Impact over time", "What
cites what", "Reading map"…); where they live (the rail's Scope presets line
already exists and may be the place, or the gear panel, or the toolbar);
whether a template is a starting point or a mode the view stays in; whether a
reader can save their own; and how a template interacts with the state a saved
graph carries.

Note the rail already has a presets line from the Stage 2 spec — read that
first so templates do not become a second, competing control.

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

## Answers the user asked for

- Step 6 ("rename the tab; the Open list shows the new name") meant
  rename-through to the saved row; the user reports it does not work.
  That is B3.
- Step 16 "restore a tab": Zotero restores plugin tabs on restart via the
  `restoreState` tab hook (`installGraphTabHooks`); the graph is also
  re-rendered by `refreshGraphInstance` after library updates. The user
  reports it works.

## Working rules (unchanged)

`npm run check` is the gate; never `npm test`; never start or stop
Zotero. Commits: sentence-case subject, no type prefix, trailers
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
`Claude-Session: <session URL>`. Stage by path. Prettier on `docs/` and
`README.md`. Feature branch per change; merge fast-forward to main; `npm
run build`; push via `gh-daniel-locatelli`. Ledger:
`.superpowers/sdd/progress.md`.
