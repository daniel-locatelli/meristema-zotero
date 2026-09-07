# Handoff: saved graphs (phase 2) and Zotero ↔ Graph selection sync

Date: 2026-09-07
Branch: `main` at `b49c7ea`, pushed. Working tree clean.
Status: phase 1 of durable graphs is merged and manually verified by the user.
Two pieces of work are next: phase 2 of the durable graphs spec, and a new
feature, selection sync between Zotero's item list and the graph, which has
not been brainstormed yet.

## Where this came from

The session started with a bug: adding a paper to Zotero from the graph's
detail pane reset the whole graph. Root cause: every view refresh rebuilt the
view from nothing. The fix became phase 1 of a larger design, durable graphs,
whose state object is now in place. A second bug, the graph not noticing a
deleted item, was fixed on top. The user then asked for selection sync and
this handoff.

## Read these first

- Spec (both phases): `docs/superpowers/specs/2026-09-07-durable-graphs-design.md`
  (Status: Phase 1 implemented). Phase 2 is the "Saved graphs", "Save, Save
  as, Open" and "Item context menu wording" sections.
- Phase 1 plan, for the shape and conventions a phase 2 plan should follow:
  `docs/superpowers/plans/2026-09-07-refresh-preserves-state.md`
- Progress ledger: `.superpowers/sdd/progress.md` (git-ignored). The section
  "2026-09-07 refresh preserves state" lists every task, review finding and
  the follow-ups the final review left. Trust it and `git log` over memory.
- The previous feature's spec, for how seeds are added today:
  `docs/superpowers/specs/2026-09-07-seed-entry-points-design.md`

## What phase 1 left in place, for phase 2 to build on

- `src/services/graphViewState.ts`: `GraphViewState` (seeds by item key or
  external identity key with the work inline, Explore direction and
  locality, filters, camera, title), `serializeGraphViewState`,
  `parseGraphViewState` (never throws), `resolveGraphViewSeeds(seeds,
{ nodeForItemKey, nodeForDOI })`, `seedFromNode`. Nothing in `src/` calls
  `parseGraphViewState` yet; phase 2's load path is its first consumer.
- `GraphViewController.getState()` / `applyState()`, options `initialState`,
  `title`, `onStateChange` in `src/services/graphViewService.ts`.
- `GraphInstanceState.viewState` and `discardViewState` in
  `src/services/windowService.ts`; `captureViewState` and
  `viewStateOptions` above `renderDetachedWindow`. Every render path passes
  the state; `renameGraphView` patches its title.
- The plugin's SQLite connection is opened inside
  `src/services/externalWorkCacheService.ts` (`initExternalWorkCache`,
  `new Zotero.DBConnection(`${config.addonRef}-external`)`). The spec asks
  to lift that into a shared `pluginDatabase.ts` before adding the
  `saved_graphs_v1` table.
- The toolbar reads Filter, Seeds, Similar, Export, Refresh. The Export menu
  (`cm-export-menu`, built around `exportButton` in graphViewService) is the
  pattern the spec names for the new Graph menu.
- Item context menu labels live in `src/services/menuService.ts`
  (`injectViewItems` calls with "Show in X" / "Explore in X", and the
  new-view command near `open-focus-view-new-tab-command`). Locale strings
  are under `addon/locale/`.

## Decisions already made (do not re-open)

- Document model (Save, Save as, Open); a graph is scratch until named, then
  autosaves. Recipe, not frozen membership. Seeds by Zotero key, not ID.
- Ranking and per-seed limit removed; direction and scope behind the gear.
  The 30-day automatic relationship re-check on seed add is kept as is.
- Within one view, direction and scope persist across Explore sessions
  (spec notes this).
- "Explore in X" becomes "Add as seed to X"; "Show in New Graph" becomes
  "New Graph from item" / "New Graph from N items".

## Follow-ups the final review left (from the ledger)

- `applyState` echoes `onStateChange` to the host on open; harmless, but
  phase 2's autosave must not treat that first echo as a change to write.
- `applyState` returns `"selected"` for an empty-seed state; every caller
  ignores the result.
- `PaperFilterController.setState` fires `onChange` even when unchanged.
- A seed known only by PMID, arXiv id, ISBN or provider id stays external
  after import (spec says so now).
- Opening a view from a request plus a state can let the state's collection
  filter override the request's collections (`openCollections` path).
- `windowService`'s capture and restore wiring has no automated test; only
  the view's re-render seam (visual test view 13) is covered.
- Restoring an item from the trash does not re-add it until the next
  refresh; `scheduleRemovalRefresh` in `src/hooks.ts` handles only "trash"
  and "delete". Adding "restore" there is a one-liner if wanted.

## The new feature: selection sync (not designed yet)

User's words: "select items across Zotero and the Graph. Once I select an
item in the Zotero view, it gets selected also in the Graph view. This way I
can easily navigate between them as a mixed strategy."

What exists today:

- Graph → Zotero is one-shot: `selectPaper(itemID)` in graphViewService
  calls `options.onSelectPaper`, which the window service maps to
  `ZoteroPane.selectItem(itemID)` after switching to the library tab
  (`selectPaper` in windowService, ~line 318). Used by the "Show in Zotero"
  buttons in the detail pane.
- Zotero → graph is one-shot too: the item context menu's "Show in X" calls
  `revealItem` / `revealItems` on the controller. Nothing follows the live
  selection.
- The graph's own selection flows through `handleGraphSelection` (renderer
  `onSelectionChange`) and `renderer.selectNode(key, fit?)`.
- `src/services/zoteroPaneSync.ts` binds the graph's side panes to
  Zotero's pane widths; it is a precedent for "follow Zotero's UI live",
  not selection.

Questions to settle in brainstorming, one at a time:

1. Direction: Zotero → graph only, or both ways? Both ways needs loop
   guards (a selection the graph caused must not bounce back).
2. Host: a graph tab hides the library pane, so live sync mostly matters
   for the detached window, or means "when I switch to the graph tab, it
   shows what I last selected". Which does the user want?
3. Items not in the current graph: ignore, reveal (add to the map as "Show
   in" does), or only highlight when present?
4. Multi-select in Zotero: first item, all items, or the graph's own
   multi-select if it has one.
5. Which graph when several are open: the active or most recent instance
   (`activeOrRecentInstance` in windowService already exists for this).
6. Zotero 7 API to observe selection: verify whether
   `ZoteroPane.itemsView.onSelect.addListener` or a notifier `select` event
   is the right hook; the `using-zotero` skill and Zotero's source are the
   references. Check the cost on large libraries and debounce.

## Working rules the user has set

- `npm run check` is the gate (lint, typecheck, unit tests). Never run
  `npm test`. Never start or stop Zotero; `npm start` is the user's, and
  `test/zotero/*` runs only inside Zotero.
- Commit messages: sentence-case subject, no type prefix, trailers
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: <the session's URL>`. Keep commits scoped; stage by
  path, never `git add -A`.
- Prettier on `docs/` and `README.md` before committing.
- Git remotes by SSH alias (`gh-daniel-locatelli`).
- Build with `npm run build`; the XPI lands at `.scaffold/build/meristema.xpi`.
- Workflow that has worked: brainstorm → spec → plan → subagent-driven
  development with a review per task, a final whole-branch review on the
  most capable model, one fix wave, merge to main, build, push.

## Suggested skills

- `superpowers:brainstorming` for selection sync, then
  `superpowers:writing-plans` for it and for phase 2 (the spec for phase 2
  is done; go straight to the plan).
- `superpowers:subagent-driven-development` to execute either plan.
- `superpowers:systematic-debugging` for any bug the user reports.
- `using-zotero` (user skill) for Zotero 7 API questions such as the
  selection hook and `Zotero.DBConnection`.
