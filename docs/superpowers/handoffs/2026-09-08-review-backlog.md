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

Settled 2026-09-10: the defect was in the case. A one-row selection does
select — decision 4 of the design, and Stage 2's adopt rule only governs the
`{ adopt: true }` apply a fresh render makes — and the pane does show the
paper. What the case asked was "is there any `.cm-placeholder` in the detail
body", and a selected paper with no metrics renders "No impact metrics for
this paper yet." as a placeholder of its own, which is every paper the
harness's corpus builds. The case reads the detail header now. Fixing it made
its own tail run for the first time, and that failed too: it expected
`addFocusItems` to report the selection to Zotero, on a spec sentence naming
six commands Stage 2 retired. The survivor selects through
`activateFocusState`, which suppresses by design, so the case asserts that and
uses Escape on the canvas as the gesture that proves the suppression is
scoped. No product code changed.

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

**Resolved by D3.** A folder no longer gets a fill colour at all — it left
the node and became a region, drawn as a hull behind the plot — and that
region's colour comes from a ledger keyed on the collection's own ID, which
hands out the lowest free palette index and holds it while the key lives.
Ticking or unticking a folder can no longer repaint another's colour, because
no folder's colour is a function of rank any more.
`docs/superpowers/specs/2026-09-09-graph-colour-system-design.md` is the
spec.

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
  **Decided 2026-09-09: the rows stay.** The user's first thought was to hide
  what has no value, and then not to: a dash is evidence that the plugin looked
  and found nothing, and hiding it would hide the reason as well — see F8, and
  F9, which is what actually fixes the dashes. So this entry is now the first
  half only: open the section, keep every row. If the dashes still read as noise
  once F9 lands, revisit it then, with the rows that are still empty as the
  evidence.

Pointers: `advancedMetrics` and `createOverviewMetrics` in
`src/services/paperDetailView.ts`; `METRIC_DEFINITIONS` and
`SUPPLEMENTARY_PROPERTY_DEFINITIONS` in `src/services/metricRegistry.ts`
carry the `itemPane: "advanced"` flags.

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

## B23. A deleted collection's ID can linger in a graph's saved `regions` — FIXED

Found finishing D3's Task 10. `regions` holds collection IDs, and nothing
prunes one whose collection has since been deleted from the library. The
rail's rows come from the library's current collections, so a deleted
folder gets no row and so no checkbox to untick it with, while its ID stays
in the saved state. `regionsForRenderer` still draws that ID a region — an
empty one, since no node carries a deleted collection's ID any more — and it
still occupies one of the four `MAX_GRAPH_REGIONS` slots, sitting there
until a fifth pick evicts it.

Fixing it means dropping an ID from `regions` the moment its collection is
gone, the same way `toggleRow` already drops one the moment it is unticked;
`snapshot.collections` is what already knows a collection no longer exists.

Pointers: `regions` and `regionsForRenderer` in
`src/services/graphViewService.ts`, `getState`/`applyState`'s `regions`
round-trip, `snapshot.collections`.

### Fixed 2026-09-11, branch `prune-deleted-regions`

Dropped at restore, as the entry proposed. `regionsStillInLibrary(regions,
collections)` in `graphScopeRailModel.ts` keeps the IDs whose collection the
snapshot still lists, in their order, and `applyState` restores `regions`
through it instead of copying `state.regions` whole. That is the one seam a
deletion can come through: a view's snapshot never changes underneath it, so
a deleted folder always arrives as a new snapshot and a fresh
`applyState(getState())`, and a graph opened from a folder has its IDs checked
by `openCollections` already. Once dropped, the ID is gone from the next
`getState`, draws no region and holds no slot. Unit tests: the ID is dropped,
the survivors keep their order, and the freed slot takes a fourth pick
without evicting anyone. Not walked in Zotero.

---

## B24. `regionsForRenderer` and `seedColorsFor` allocate on read, and the invariant that read is safe is already false

Found in the final whole-branch review of D3. Both readers are documented
(their own docstrings, updated in the "Fix the region's fill, its cost, and
its silent tooltip" pass) as allocating a swatch as a side effect of reading
one: a key not yet in the ledger claims a free index there and then, and the
claim is written back to the outer `swatches`/`seedSwatches` variable before
the function returns. The docstrings used to claim every caller reaches
`notifyStateChange()` in the same tick, so an allocation always persists.
That is already false in-tree — the search box's `input` listener reaches
both through `applyFilters` → `refreshKeyRail`/`refreshScopeRail` without
ever calling `notifyStateChange`.

It is not a correctness bug today only because reallocation is deterministic:
if the tab closes before a later state change persists the allocation, a
fresh ledger on the next load reallocates the same keys in the same order and
lands on the same colours. That is luck holding the invariant together, not
the invariant itself, and the next caller that reads either function from a
path with no later state change (a tooltip, an export preview) is the one
that breaks it.

The intended fix, named in both docstrings and not done in this pass: split
an `ensureSwatchesFor` out of each reader — the allocating half, called only
from paths that do reach `notifyStateChange` — leaving `regionsForRenderer`
and `seedColorsFor` themselves read-only, never mutating `swatches` or
`seedSwatches` for a caller that only wants to look.

Pointers: `src/services/graphViewService.ts`, `regionsForRenderer` (~line 3336) and `seedColorsFor` (~line 1819), both with the invariant's history in
their docstrings; `notifyStateChange` (~line 4072); the search box's `input`
listener that calls `applyFilters` without it.

---

## B25. The category assignment map the spec promises is not persisted; it lives on the renderer and dies with it

Found in the final whole-branch review of D3. The design spec
(`docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`, lines
137-144) says the category-to-swatch assignment is persisted with the graph,
the same way seed and folder swatches are. It is not: `state.swatches` (the
field the spec means) only ever receives stringified collection IDs, written
by `graphViewService.ts`. The actual category ledger — which swatch
"article", "OpenAlex" or "Retracted" holds — is `categorySwatchLedger` on
`CitationGraphRenderer`, plain instance state that is never read into or
written out of `GraphViewState`, and so it dies the moment the renderer is
torn down.

Effect: a category that came and went during one session (a publication type
present in an early filter, gone after a later one, back again) can land on a
different swatch after the graph is closed and reopened, even though nothing
about the library data changed — the ledger a fresh renderer builds starts
empty and reassigns from scratch. Seeds and folders do not have this problem
any more (B12's fix, and D3's region ledger); categories are the one swatch
family the spec's persistence promise does not hold for.

Fixing it means giving `GraphViewState.swatches` an actual category ledger —
or a second field alongside it — and wiring `categorySwatchLedger` to load
from and save into it the way `seedSwatches` already does for seeds. Doing
that without a hazard: `state.swatches` today holds a plain
key-to-index map keyed on stringified collection IDs, and a category key can
coincide with one (collection ID `12` and, say, provider value `"12"` are
both the string `"12"`) — the two ledgers cannot share one map without
namespacing their keys first (e.g. `collection:12` vs `provider:12`). See the
docstring on `GraphViewState.swatches` in `src/services/graphViewState.ts`
for the same hazard, recorded where the field is declared.

Pointers: `src/services/graphViewState.ts` (`GraphViewState.swatches`),
`src/services/citationGraphRenderer.ts` (`categorySwatchLedger`,
`categories()`), `src/services/graphCategoryAssignment.ts`
(`assignCategories`), the spec's persistence section.

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

## B27. An out-of-range ledger index draws `strokeStyle = undefined`, and canvas silently keeps the previous region's colour

Found in the final whole-branch review of D3. `swatchIndexFor` returns
whatever integer `swatches.assigned` holds for a key, with no bound against
the live palette size — a hand-edited saved state (`{"assigned": {"7": 99}}`
against an eight-swatch palette, or any palette after a hand-edit shrinks
`theme.categorical.swatches`) hands back index 99. `theme.categorical.
swatches[99]` is `undefined`, so the region (or category disc) built from it
gets `color: undefined`, and `context.strokeStyle = undefined` is not a
canvas error — the 2D context silently ignores an unassignable style
assignment and keeps whatever `strokeStyle` the previous draw call left
behind. The visible result is one region borrowing the border colour of
whichever region — or whatever else drew last with `stroke()` — happened to
run immediately before it, with nothing in the console to say why.

`GraphViewState.swatches`'s own docstring already notes that a live key
holding an index outside `[0, poolSize)` is carried forward unchanged when
the pool shrinks, "validating pool bounds is the caller's job" — this is
that caller never doing it. Fixing it means clamping or rejecting an
out-of-range index at the point a colour is read (`theme.categorical.
swatches[index] ?? theme.categorical.other`, or equivalent for regions), not
only at the point a ledger is parsed.

Pointers: `src/services/graphSwatchLedger.ts` (`swatchIndexFor`,
`SwatchLedgerState.assigned`'s docstring), `src/services/
graphCategoryAssignment.ts` (`color: theme.categorical.swatches[swatchIndexFor(...) ?? 0]`),
wherever `regionsForRenderer` resolves a region's colour the same way.

---

## B28. Selecting a folder blanks the plot; a folder graph opens blank — FIXED

Found in the user's walk of D3's manual batch (2026-09-10), on the XPI built
from `259cd17`. **The blocker: five of D3's eight checks cannot be walked
until this is fixed** — regions opening, the toggle and the cap, the
no-repaint rule, the four-seed colour check, and the zoom check.

Symptom, two faces of one bug:

- On a graph that is already drawn, clicking a folder's row body to select it
  as a region **blanks the plot** — the nodes go. Unselecting the folder and
  then "Fit graph to view" brings them back.
- Opening a graph **from a folder** (right-click the folder › New … Graph)
  shows **no nodes at all**, because such a graph opens with that folder
  already in `regions`. A graph started from one or more items opens
  normally, and the same recovery works: unselect the folder, fit to view.

- Opening a **saved** graph that was made from a folder blanks the same way,
  whether it was saved before this release (state version 2, regions restored
  by the migration) or after it. The user confirmed this on 2026-09-11 after
  first testing the migration on a non-folder graph, which opened fine.

So the trigger is a non-empty `regions`, not the click, and it does not matter
whether the selection came from a click, from `initialCollectionIDs`, from a
restored state or from the version 2 migration. Any one of those is a
reproduction; the cheapest is a graph opened from a folder.

### Fixed 2026-09-10. Root cause: `Path2D` off the wrong scope

The user's Error Console said it outright: **"Path2D is not defined"**, with
no axis frame and no tick numbers anywhere on the plot — which is the
signature of a throw in `drawRegions`, since the draw order is backdrop →
regions → edges → nodes → labels → axes and the catch runs after the panel
fill.

`Path2D` is a DOM constructor. The plugin's bundle runs in a scope that
carries none, so `new Path2D()` in `drawRegions` threw the moment a folder
had to be drawn. The renderer already knew this rule and follows it for
`ResizeObserver` (`const view = this.canvas.ownerDocument.defaultView`, line
~304); the region path was the one place that reached for a bare global.

The path is now built by `regionPathFor(view, loops, project)` in
`graphFolderRegion.ts`, from `canvas.ownerDocument.defaultView`, returning
null — and skipping that region rather than losing the whole frame — when the
window has no `Path2D`.

**Why every test was green while the live plugin was blank**, which is the
part worth carrying: `citationGraphRendererRegions.test.ts` polyfilled
`Path2D` onto `globalThis`, and the Zotero suite's scopes have a global
`Path2D` of their own. The tests were supplying the constructor in the one
place a plugin never has one. The unit double now attaches it to the fake
canvas's `defaultView` instead, and a unit test drives `regionPathFor` with a
fake window, so a regression fails on the constructor's source rather than on
a stroke that happens not to appear. A test that stood in for the plugin's
real scope by deleting the global was tried and does **not** work: the test
file's `globalThis` is not the bundle's scope, so the removal is invisible to
the renderer.

Two things were true and are worth keeping: `draw()` latches `canvasError`
after one throw, so any future throw blanks the plot permanently and the only
recovery is a new renderer — closing and reopening the graph tab, not "Fit".
And the error is logged exactly once per renderer, so the Error Console is
always the first place to look.

### What the 2026-09-10 investigation established

**The blank is permanent, and that is by design in `draw()`.** The frame is
wrapped in one try/catch: the catch sets `this.canvasError = true` and logs
**once** through `Zotero.logError`, and the method's first line is
`if (this.destroyed || this.canvasError) return;`. So a single throw anywhere
in a frame bricks that renderer for the rest of its life — every later frame
returns before painting. The catch also runs after the opening `clearRect`
and the panel `fillRect`, and the draw order is backdrop → **regions** →
edges → nodes → labels → **axes**, so a throw in `drawRegions` leaves a flat
panel fill with no axes and no nodes. That matches the report exactly, and it
means unselecting the folder cannot repaint the plot: only a new renderer can.
Closing and reopening the graph tab is the real recovery, not "Fit".

**It follows that the Error Console holds the stack**, logged exactly once per
renderer. Get that before anything else; it names the throw outright.

**Two hypotheses are already dead.** Neither the harness nor a real tab
reproduces it:

- `test/zotero/graphRegionBlank.test.ts` opens a graph with
  `initialCollectionIDs` and clicks a folder row through the window harness:
  the canvas draws, nothing throws.
- `graphFolderRegions.test.ts` gained a case that stubs `Zotero.logError`,
  clicks a folder row in a real **tab**, and reads the plot canvas back: it
  paints and logs nothing. (Both cases are worth keeping regardless — the
  original region test only ever read the rail's selected class, which is why
  it stayed green while the plot underneath it was blank.)
- The namespace asymmetry that suggested itself — `regionLayer` is the one
  bare `document.createElement("canvas")` in the renderer (line ~1315) while
  every other element goes through `element()`'s
  `createElementNS(HTML_NS, …)` — is therefore **not** the trigger on its
  own, since a tab exercises exactly that path and works. It is still worth
  tidying for consistency, but it is not the fix and must not be sold as one.

So the trigger needs something the fixtures do not have: real papers (missing
years, identical positions, papers in many folders), a folder with subfolders,
a folder with more papers than the swatch pool has colours (B27's
`strokeStyle = undefined`), a light theme, or a detached window. The user's
console output is what narrows this; ask before guessing again.

### The original hypothesis, superseded above

`drawRegions` throws, the frame aborts part-way,
and the nodes — drawn after the regions — never run. That fits every
observation, including why unselecting fixes it (`if (!this.regions.length)
return;` is the method's first line, so an empty selection never enters the
failing code) and why "Fit graph to view" alone does not. A non-terminating
contour walk fits the same observations; the Error Console separates the two
in one reproduction. Do not fix before reproducing — an exception and a hang
want different fixes, and D3's own review already filed three latent region
defects (B25, B26, B27) that could each produce a bad frame.

Suspects, in the order worth instrumenting:

- `citationGraphRenderer.ts` `drawRegions` (~line 1355): `dilation` from
  `baseNodeRadius()`, the offscreen `regionLayer(plot.width, plot.height)`
  sizing, `context.drawImage(this.regionLayerCanvas!, …)`, and
  `region.color` — B27 says an out-of-range ledger index yields
  `color: undefined` here.
- `regionsFor()` and `graphFolderRegion.ts` `folderRegionContours`: a contour
  walk that does not terminate on some arrangement of nodes.
- `graphViewService.ts` `regionsForRenderer` (~line 3336) and
  `refreshScopeRail`: whether the region handed over carries an empty
  `nodeKeys` or an `undefined` colour at the moment of the first paint.

Test: reproduce in Zotero with the Error Console open, then a unit test at
whichever boundary the reproduction names — `folderRegionContours` if it is
the contour walk, a renderer-level test if it is the draw.

---

## B29. Switching light → dark leaves the plot background light

Found in the same walk, on D3's check 8. With a folder selected as a region,
switching the Zotero theme from light back to dark repaints the rail but
leaves the graph's own background light. The rail's region legend reads
correctly in both themes, which is what check 8 asked; this is the surround.

Whether the region selection is part of the trigger or only what the user
happened to have on screen is unknown — reproduce with nothing selected
before assuming it is region-specific. A theme swap has to reach the
renderer's cached theme (`renderer.getTheme()`), the plot backdrop
(`drawPlotBackdrop`) and the cached regions' colours, so a partial repaint is
the likely shape.

---

## B30. A node whose paper is outside the open folder selects the wrong item in Zotero

Found in the same walk, on the B11 check. Selecting a node whose paper is not
in the collection Zotero currently has open still drives a Zotero selection —
and lands on some other, available item. The user's words: "that is deceiving
the user; if the item is not in the folder the Zotero selection should be
cleared."

The fix is what they say: when the selected paper is not present in the view
Zotero is showing, clear the selection rather than settle for a neighbour.
Silently selecting the nearest row is worse than selecting nothing, because
nothing then says the graph and the list disagree.

Pointers: `src/services/zoteroSelectionSync.ts`,
`src/services/zoteroPaneSync.ts` (whatever resolves a paper key to a row, and
what it does when the row is absent), `src/services/librarySelection.ts`.

---

## B31. The rail does not show subfolders clearly

Found in the same walk: "the UI now doesn't reflect subfolders really well."

`buildScopeRailModel` indents a row by four spaces per depth level
(`INDENT.repeat(collection.depth)`) inside the label string, and nothing else
marks the hierarchy — no rule, no disclosure triangle, no grouping. With a
proportional font and a right-aligned count, four spaces is a weak signal,
and a deep tree loses its shape entirely.

Needs the user's specific complaint before it is designed: whether nesting is
simply invisible, whether a subtree should collapse, whether the cascade
(ticking a parent ticks its whole subtree) is illegible from the row, or
whether a parent's count reads wrongly against its children's. Ask before
building.

Pointers: `src/services/graphScopeRailModel.ts` (`INDENT`, `depth`,
`cascadeIDs`), `src/services/graphKeyRail.ts` (the row body,
`cm-scope-row-label`).

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

## D6. The folder regions read as faceted polylines, and their offset does not follow the zoom

Raised by the user on 2026-09-10, after B28 made the regions visible for the
first time. Two complaints, and they are independent:

- **Faceting.** The contour is drawn with `lineTo` between marching-squares
  vertices, so a curve reads as a chamfered polygon. The grid is about 83
  cells across the data extent (`pitch: spread * 0.012`), which sets how
  coarse the facets are. `regionPathFor` in `graphFolderRegion.ts` is now the
  single place a path is built, so a curve fit has one seam to live at.
  NURBS specifically is the wrong tool: `Path2D` speaks lines, quadratic and
  cubic Béziers and arcs, so a NURBS would be evaluated down to one of those
  anyway, and the rational weights buy nothing without a conic to represent.
- **Zoom behaviour.** Zoomed in, the region stays enormous and swallows the
  viewport, so the reader cannot tell which papers make it. The user wants the
  offset to hold its size on screen, the way a node's radius does, so that
  zooming in separates the territory back into its members.

The second reverses D3's explicit decision. The spec computes the field in
**data space** precisely so the hull's topology is not a function of the zoom;
the reviewer offered "document splitting-on-zoom as intended" and the spec
called that indefensible, "B12's fault in another costume". The user is now
asking for exactly that splitting, for a good reason the review did not weigh:
at high zoom a data-space hull has its edge off-screen and stops telling the
reader anything. Reopening it is legitimate, but it is a decision to take
knowingly, and it costs the cache — a screen-space falloff means recomputing
contours on every zoom step rather than never.

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
