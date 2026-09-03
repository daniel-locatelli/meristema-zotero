# Keeping the graph's side panes in step with Zotero's

Date: 2026-09-03
Status: implemented

## Context

The graph view was drawn to look like Zotero's library: a left pane with its
own toolbar, a middle pane, a right pane, and a rule between each. The
Collection Graph and Explore are the same view in two modes
(`src/services/graphViewService.ts`), so both inherit the resemblance.

The resemblance holds only at Zotero's default widths. Zotero's left pane,
`#zotero-collections-pane`, and right pane, `#zotero-item-pane`, are resizable
by their splitters, and Zotero remembers the result. The graph's Key rail is a
fixed 200px from `--cm-sidepane-width` (`addon/content/graph.css:25`) with a
collapse toggle and no drag handle. The detail pane on the right has a drag
handle, but it saves to a Meristema pref of its own (`detailPanelWidth`) and
never looks at Zotero's pane. Once the user drags Zotero's splitters, the
library tab and the graph tab stop lining up, and there is nothing the user can
do about it from the graph side of the rail.

How Zotero stores its own layout, established by reading `zoteroPane.js`,
`zoteroPane.xhtml`, `standalone.js` and `collapsiblePane.mjs` from the
installed `omni.ja`:

- Both panes carry `zotero-persist="width"`. `ZoteroPane.serializePersist()`
  reads the `width` **attribute** of every persisted element into the
  `pane.persist` pref as JSON, keyed by element id. It runs on window unload.
  `unserializePersist()` runs on window load and sets both the attribute and
  `el.style.width`. During a session the pref is stale; the element is the
  truth.
- The left pane collapses when `#zotero-collections-splitter` has
  `state="collapsed"` and the pane has `collapsed="true"`. Zotero's own
  toggle (`ZoteroStandalone.onViewMenuItemClick`, case `collections-pane`)
  sets the splitter state, sets the attribute, then calls
  `ZoteroPane.updateLayoutConstraints()`.
- The right pane collapses through `ZoteroPane.itemPane.collapsed`, a setter in
  `collapsiblePane.mjs` that sets `collapsed="true"` on the pane, removes its
  `width` attribute, sets `#zotero-items-splitter` to `state="collapsed"`, and
  dispatches a window `resize` event. `ZoteroPane.toggleItemPane()` flips it.
- Zotero's minimums are 200px for the collections pane and 320px for the item
  pane (`updateLayoutConstraints`). The item pane re-asserts 337px when it
  reopens without a width.
- The graph has two hosts (`src/services/windowService.ts`): a tab in a Zotero
  main window, where Zotero's panes are in the same document, and a detached
  window opened from `graphWindow.xhtml`, where they are not.

## Decision

The graph's two side panes mirror Zotero's two side panes: **width and
collapse state, in both directions, live**. Dragging in the library tab moves
the graph; dragging in the graph moves the library. Zotero remains the owner of
the persisted value, so the Meristema prefs for pane width and collapse go
away.

### What the user sees

- The Key rail has a drag handle on its inner edge, like the detail pane's.
  Dragging it resizes the rail and, at the same time, Zotero's collections pane.
- Dragging Zotero's collections splitter resizes the Key rail in every open
  graph. Dragging Zotero's items splitter resizes every graph's detail pane.
- Collapsing either pane in Zotero, by splitter, View menu or toolbar button,
  collapses the matching graph pane. Collapsing a graph pane by its toggle,
  by double-clicking its handle, or by dragging its handle more than 60px past
  the minimum width and releasing, collapses Zotero's pane. The pane itself
  never draws narrower than the minimum during the drag.
- A collapsed graph pane still shows its narrow strip with the reopen toggle:
  28px for the rail, 36px for the detail pane. Zotero hides its panes fully.
  That difference stays; the graph keeps its toggles reachable.
- The rail never goes below 200px and the detail pane never below 320px while
  open. These are Zotero's minimums, so the graph never writes a width Zotero
  would refuse.
- A detached graph window follows the first open Zotero main window. With no
  main window open, it starts from the widths in `pane.persist` and keeps its
  changes to itself.

### Components

**`src/services/zoteroPaneSync.ts`** (new). One function,
`bindZoteroPane(side: "collections" | "item", host: Window): ZoteroPaneBinding`.

```ts
interface ZoteroPaneState {
  width: number; // the pane's open width; last known when collapsed
  collapsed: boolean;
}
interface ZoteroPaneBinding {
  read(): ZoteroPaneState;
  write(width: number): void; // clamps to the side's minimum
  setCollapsed(collapsed: boolean): void;
  subscribe(listener: (state: ZoteroPaneState) => void): () => void;
  dispose(): void;
}
```

Resolving the target window: `host` itself if it has `ZoteroPane` and the pane
element; otherwise the first window from `Zotero.getMainWindows()` that has
them; otherwise a **detached binding** with no element, whose `read()` comes
from `pane.persist` once and whose `write` and `setCollapsed` only update its
own state and notify subscribers.

Reading: a `ResizeObserver` on the pane element and a `MutationObserver` on its
`collapsed` and `width` attributes. Each fires the listeners with a fresh
state. Width is `getBoundingClientRect().width` while open; while collapsed
the binding reports the last open width it saw or wrote.

Writing: set the pane's `width` attribute and `style.width` to the rounded
pixel value, as `unserializePersist` does, then call
`ZoteroPane.updateLayoutConstraints()`.

Collapsing: for `collections`, set `#zotero-collections-splitter`'s `state` to
`collapsed` or `open`, set the pane's `collapsed` attribute to `"true"` or
`"false"`, then call `updateLayoutConstraints()`, exactly as Zotero's View menu
does. For `item`, assign `ZoteroPane.itemPane.collapsed`. When expanding
either side, write the last known width afterwards so a pane Zotero reset to
its minimum comes back at the width the graph had.

Echo suppression, two layers. First, the graph tells the binding when a drag
starts and ends (`beginLocalChange()` / `endLocalChange()`, called by the drag
helper); while a local change is open the binding performs writes but does not
notify. Second, outside a drag the binding drops an incoming observation within
0.5px of the last width it wrote, and does not re-notify a collapse it set
itself. Listeners therefore only hear about changes that came from Zotero or
from another graph. No animation-frame batching on the write side: pointer
moves already arrive at most once per frame, and Zotero's splitter writes the
same attribute the same way.

Last known width when the pane is already collapsed at bind time: the item pane
drops its `width` attribute on collapse, so there may be nothing to read. The
binding then takes the value in `pane.persist` for that element id, and if that
is absent too, Zotero's own reopen widths: 200 for the collections pane, 337
for the item pane. `read().width` is never 0 or undefined.

Zotero's persist step is untouched. Because the binding writes the `width`
attribute, `serializePersist` picks the graph's drags up on window close.

**Pane drag helper** in `src/services/graphViewControls.ts`:
`attachPaneResizer(options)`. It owns the pointer capture, the per-move
callback, the release callback that decides between "collapse" and "commit
width", and the double-click toggle. The detail pane's inline resizer code in
`graphViewService.ts` moves into it; the rail's new handle uses the same
helper. Its inputs: the handle element, an `edge` (`"start"` for the rail,
whose width grows as the pointer moves right, `"end"` for the detail pane),
the minimum open width, a function returning the maximum, the collapse
threshold in pixels past the minimum (60 for both panes), and the three
callbacks. The threshold is measured from the pointer, since the drawn width is
clamped and can never itself fall below the minimum.

**Key rail** (`src/services/graphKeyRail.ts`): gains a `resizer` element, a
`setWidth(px)` method that sets an inline width, and `setCollapsed(bool)` that
no longer touches a pref. `--cm-sidepane-width` stays as the width used before
the first sync arrives, then inline style overrides it.

**Detail pane** (`graphViewService.ts`): `setDetailCollapsed` and the width
commit call the item binding instead of the removed prefs. The clamp's lower
bound becomes 320. The collapsed strip stays `COLLAPSED_DETAIL_WIDTH`.

**Preferences** (`src/services/citationPreferences.ts`, `addon/prefs.js`):
`detailPanelWidth`, `detailPanelCollapsed` and `graphKeyRailCollapsed` are
removed along with their getters and setters. No migration: the values were
cosmetic and Zotero's own values take over.

### Data flow

```
Zotero splitter drag ──▶ pane element ──▶ observers ──▶ binding.subscribe
                                                          │
                                       rail.setWidth / detailShell.style.width
                                                          │
                                                 renderer.resizeViewport()

graph handle drag ──▶ attachPaneResizer.onMove ──▶ rail/detail inline width
                                             └──▶ binding.write(width)
                                                     └──▶ pane element (Zotero follows live)
```

Each graph view creates two bindings on mount and disposes them on cleanup.
Several open graphs each hold their own binding on the same element; a drag in
one reaches the others through the observers, not through any shared state.

Subscribers set the pane's width and nothing else. The renderer already
watches its own container with a `ResizeObserver` coalesced to one
`resizeViewport()` per animation frame (`citationGraphRenderer.ts`), so a
flood of observations during a drag in another window costs each graph one
resize per frame, and the explicit `renderer.resizeViewport()` calls in the
detail pane's drag code are dropped rather than duplicated.

### Failure handling

If the pane element, the splitter, `ZoteroPane`, or
`updateLayoutConstraints` is missing, the binding logs one debug line and
behaves as a detached binding: the graph pane stays resizable and collapsible
on its own, nothing throws, and nothing is written into Zotero. Every touch of
a Zotero method is wrapped so a Zotero-side exception cannot break a drag.

### Testing

Unit tests for `zoteroPaneSync.ts` against a fake window with fake pane and
splitter elements, a stub `ZoteroPane`, and hand-driven `ResizeObserver` and
`MutationObserver` doubles:

- `read()` reports the element's width and collapsed state.
- `write()` sets attribute and style, calls `updateLayoutConstraints`, and
  clamps below the minimum.
- An observation equal to the last written width does not notify.
- `setCollapsed(true)` on each side performs Zotero's own steps;
  `setCollapsed(false)` restores the last width.
- A `collapsed` mutation from outside notifies with `collapsed: true` and the
  last open width.
- A pane collapsed at bind time with no width attribute reads its width from
  `pane.persist`, then from Zotero's reopen default.
- Observations arriving between `beginLocalChange()` and `endLocalChange()`
  do not notify; the first one after does.
- With no pane element, `read()` comes from `pane.persist` and writes stay
  local.
- With `updateLayoutConstraints` missing, `write()` still sets the element and
  does not throw.
- `dispose()` disconnects both observers.

Unit tests for `attachPaneResizer`: width follows the pointer with the right
sign for each edge, clamps to min and max, releases below the threshold as a
collapse and above it as a commit, and double-click toggles.

Manual check in Zotero, in a tab and in a detached window: drag each Zotero
splitter and confirm the graph follows; drag each graph handle quickly back and
forth and confirm the library follows without jitter; collapse and reopen each
pane from both sides, including reopening from the graph's collapsed strip
while Zotero's pane is hidden; open two graphs and drag in one; close and
reopen Zotero and confirm both views come back at the same widths.

## Deliberate exclusions

- **Stacked layout.** When Zotero's layout pref is `stacked`, the item pane
  sits under the items list and its persisted `height` matters, not width.
  The item binding still mirrors width and collapse; the graph keeps its
  three-column layout. Following the stacked layout is a separate decision.
- **The tag selector and the context pane.** Neither has a counterpart in the
  graph.
- **Zotero's `pane.persist` written by the graph.** Zotero writes it on close
  from the attributes; the graph does not write the pref directly, so there is
  no second writer to race.

## Consequences

- The view has one fewer source of truth for layout, and three fewer prefs.
- The rail's width is no longer a CSS constant, so anything that assumed
  200px, such as the identity row's overflow rules in `graph.css`, is checked
  during implementation against widths down to 200px and up to a wide rail.
- The sync depends on two Zotero element ids, one splitter id per side, and
  `ZoteroPane.updateLayoutConstraints`, `ZoteroPane.itemPane.collapsed`. All
  exist in Zotero 7 and are referenced from Zotero's own markup; a rename
  degrades the graph to local resizing rather than breaking it.
