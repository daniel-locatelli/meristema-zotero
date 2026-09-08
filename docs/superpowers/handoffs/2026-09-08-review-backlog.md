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
