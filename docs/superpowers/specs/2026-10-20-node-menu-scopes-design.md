# F5: the node menu offers the pane's actions, and the scopes are named

Roadmap F5: the node's context menu should offer what the detail pane
offers, and Refresh vs Update connections should say which scope each acts
on.

## Context

- The node menu (`cm-node-menu`, built in `graphViewService.ts` beside the
  toolbar) has three entries: the open entry (`openPaperEntry` in
  `nodeMenu.ts`), the seed toggle, and Remove from graph (hidden for a
  seed). Its comment ("Two items: the seed toggle and Explore-from") is
  stale.
- A right-click selects the node before the menu opens, and selection
  re-renders Paper details on the overview. So while the menu is open, the
  pane shows the menu's paper.
- The pane's overview actions:
  - library paper: Find similar papers and the seed toggle;
  - external paper: Show in Zotero (in the library) or Add to Zotero (with
    its collection picker), Open DOI or Open provider record, Similar, the
    seed toggle, and Update connections.
- The toolbar's Refresh reads "Refresh" in both modes; only its tooltip
  says which scope it acts on.

## The menu

Entries, top to bottom. The arrow keys walk only the entries shown.

| Library paper                             | External paper                                                |
| ----------------------------------------- | ------------------------------------------------------------- |
| Open PDF / Open attachment / Open online¹ | Open online¹                                                  |
| Show in Zotero                            | Show in Zotero (in the library) or Add to Zotero… (not in it) |
| Find similar papers                       | Find similar papers                                           |
|                                           | Update this paper's connections                               |
| separator                                 | separator                                                     |
| Add as seed / Remove seed                 | Add as seed / Remove seed                                     |
| Remove from graph (hidden for a seed)     | Remove from graph (hidden for a seed)                         |

¹ As today: hidden when the paper has nothing to open.

What each entry does. Every entry closes the menu first, with focus going
back to the canvas, except Add to Zotero…, which hands focus to the pane.

- **Show in Zotero:** `selectPaper(itemID)`. For a library paper the ID is
  `node.itemID`. For an external paper it is the local item that the pane's
  own Show in Zotero uses (found from `inLibraryItemKey` or
  `zoteroItemKey`).
- **Add to Zotero…:** the menu never imports. It focuses the overview's
  Add to Zotero button, where the reader picks a collection. The overview
  keeps a reference to that button when it renders. If the button is not
  connected (the pane moved on), the entry calls `renderOverview(node)`
  first. `renderOverview` is synchronous, so the button exists when the
  focus call runs, and no other selection can land in between.
- **Find similar papers:** `loadInlineSimilarResults([node])`, the pane's
  call. Errors go to `Zotero.logError`.
- **Update this paper's connections:** runs the shared routine below.
  The entry is disabled while that paper's update is running.
- **Seed toggle and Remove from graph:** unchanged.

The separator is a `div` with `role="separator"` and the class
`cm-node-menu-separator`. It is not a button, so `nodeMenuItems()` never
returns it. Both kinds always have Show in Zotero or Add to Zotero… and
Find similar papers above it, so it always shows.

The stale comment above the menu is rewritten to describe the entries.

### Entry list as a pure function

`nodeMenu.ts` gains `nodeMenuEntries(input): NodeMenuEntry[]`, which
returns the entries the menu shows, in order, each with its disabled state:

```ts
export type NodeMenuEntryId =
  | "open"
  | "show"
  | "add"
  | "similar"
  | "update"
  | "separator"
  | "seed"
  | "remove";

export interface NodeMenuInput {
  kind: "library" | "external";
  /** External papers only: a local Zotero item was found. */
  inLibrary: boolean;
  isSeed: boolean;
  /** This paper's connections update is running. */
  updating: boolean;
}

export interface NodeMenuEntry {
  id: NodeMenuEntryId;
  /** True only for "update" while `updating`. */
  disabled: boolean;
}
```

The view builds every button once. `openNodeMenu` builds the input, which
reads `updating` from the shared in-flight set described below, and shows
exactly the entries the function returns, in its order (re-appending them
in that order), applying each `disabled`. So reopening the menu on a paper
whose update is still running shows the entry disabled. "open" is always
listed; its visibility stays with `showOpenEntry`, because Zotero can
answer the attachment question after the menu opens. Each
entry's label is fixed except open (from `openPaperEntry`) and seed ("Add as
seed" / "Remove seed").

## Update connections, shared

The pane's Update connections loop moves into one function in the view,
`updatePaperConnections(node): Promise<void>`. It does what the pane's
click handler does today:

- both directions in turn, `references` then `cited-by`, with the same
  `refreshExternalRelationships` options and the same count updates;
- then `invalidateHopFragment`, `rebuildCurrentFocus()` when the hop model
  has the node, and `renderOverview(node)` unless the view is cleaned up
  or the pane no longer shows this paper's overview (an update started
  from the menu must not pull the pane back from another paper).

It keeps a `Set` of node keys being updated. A call for a key already in
the set returns the running promise, so it never starts a second fetch.
The pane button and the menu entry both read the set: the pane button
renders disabled while its paper is in it, and the menu entry is disabled
when the menu opens on a paper in it. When the run ends, successful or
not, the key leaves the set before the overview re-renders, so the
re-rendered pane button is enabled. Errors go to `Zotero.logError`, as
today.

## Scope names

- **Toolbar Refresh:** the label reads "Refresh visible" with no seeds and
  "Refresh seeds" once the graph has seeds. `setSeeded` sets the label
  where it already sets the tooltip, and the tooltips are kept as they are:
  - no seeds: "Refresh metadata and citation counts for the currently
    visible papers.";
  - seeds: "Refresh references and citing papers for the current Explore
    seeds.".
- **Pane button (external paper):** "Update this paper's connections",
  with the tooltip "Fetch this paper's references and citing papers again."
- **Menu entry:** the same label and tooltip.

Risk: the toolbar labels are up to 8 characters longer, so the narrow-window
toolbar squeeze (B111's context) starts a little sooner. The toolbar has no
narrow-width fallback today. Adding one (ellipsis, or icon-only buttons) is
D23's job, the narrow layout, not F5's. The manual check measures the
squeeze at a 320px graph width so D23 has a number.

## Tests

- **Unit** (the existing `test/unit/nodeMenu.test.ts`), for
  `nodeMenuEntries`:
  - a library paper, seed and not;
  - an external paper in the library: show, no add;
  - an external paper not in the library: add, no show, and update present;
  - a seed: no remove;
  - `updating`: the update entry is disabled, and every other entry is
    enabled;
  - the separator is always between the actions and the seed toggle.
- **Zotero suite:**
  - Existing assertions that name the menu's entries or the toolbar's
    "Refresh" label are updated to the new lists and labels. These are
    `graphViewVisual.test.ts` (the menu lists) and the `refreshButton()`
    finder in `graphCitationHops.test.ts`.
  - One new case: right-click an external paper and read the menu's entries;
    choose Update this paper's connections; while it runs, the pane's
    Update this paper's connections button is disabled, and reopening the
    menu on the same paper shows the entry disabled. The case drives the
    plugin's own menu, per memory.
- **Manual check** (roadmap): the menu for a library paper and an external
  paper, Add to Zotero… landing on the pane's picker, the two toolbar
  labels, and the toolbar at a 320px graph width.

## Out of scope

- The per-direction update buttons in `paperDetailView.ts`, a separate
  surface.
- Importing from the menu.
- Open DOI or Open provider record in the menu: the open entry already
  opens the same address.
