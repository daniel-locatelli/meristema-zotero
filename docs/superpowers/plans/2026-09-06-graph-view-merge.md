# Graph View Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Collection Graph / Explore view kind so every tab is one Graph that is seeded or not, with the intent carried by the menu entry instead of the tab.

**Architecture:** The graph view already tracks whether it is seeded through `focusProjection`; the `viewKind` flag and its `data-view-kind` attribute are replaced by a `data-seeded` attribute driven from that. The window service drops the kind from its instance record, tab data, and open options, and the instance policy names every new view "Graph". The item context menu grows a second anchor so "Show in …" and "Explore in …" are both offered for every open view, and the locale, item pane, README and CSS follow.

**Tech Stack:** Zotero 7 plugin, TypeScript, hand-built DOM, Fluent locale files, Node test runner with chai under `test/unit`.

Spec: `docs/superpowers/specs/2026-09-06-graph-view-merge-design.md`

## Global Constraints

- `npm run check` is the gate (prettier, eslint, typecheck, unit tests). It must be green at the end of every task. Never run `npm test`; the user's `npm start` holds the Zotero profile.
- Unit tests run in plain Node: `node --import ./test/nodeResolve.mjs --test <file>`. They must not touch `Zotero.*` or the DOM at load.
- Commit messages: sentence-case subject, no type prefix, body optional, and these two trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
  ```
- Prettier formats the Markdown under `docs/` too. Run `npx prettier --write <file>` on any doc you edit before committing.
- Branch: work on `graph-view-merge`, which already holds the spec and this plan and is rebased on `main` as of 2026-09-06.
- The view's user-facing name is "Graph". "Explore" names the act of seeding and its controls, never a kind of tab. "Collection Graph", "Explore view" and "Focus View" must not appear in any user-visible string after Task 4. Code comments may keep "Focus" as the internal name of the projection.

---

### Task 1: Drive the graph view from its seeds, not a kind flag

**Files:**

- Modify: `src/services/graphViewService.ts` (regions listed per step)
- Modify: `src/services/windowService.ts:335-338` and `:720-723` (the two `renderGraphView` calls)
- Modify: `addon/content/graph.css:770`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `GraphViewOptions` without `onViewKindChange` and `initialViewKind`; root attribute `data-seeded="true" | "false"`. Task 3 relies on the window service no longer passing those two options.

There is no unit test for this task: the graph view is DOM-bound and untested under Node. Typecheck is the test: after the edits, every remaining reference to `currentViewKind` or `setViewKind` is a compile error, which is what proves the flag is gone.

- [ ] **Step 1: Delete the kind from the options and the local state**

In `src/services/graphViewService.ts`, in `GraphViewOptions` (around line 186), delete these two lines:

```ts
  onViewKindChange?: (kind: "map" | "focus") => void;
  initialViewKind?: "map" | "focus";
```

Around line 239, delete this block:

```ts
const initialViewKind =
  options.initialViewKind ??
  (options.initialFocusItemID || options.initialFocusItemIDs?.length
    ? "focus"
    : "map");
let currentViewKind: "map" | "focus" = initialViewKind;
```

- [ ] **Step 2: Replace the root attribute**

Around line 381, change

```ts
root.dataset.viewKind = currentViewKind;
```

to

```ts
// Flipped by setSeeded. The Seeds and Explore buttons show only while the
// view is drawn from seeds; the CSS keys on this attribute.
root.dataset.seeded = "false";
```

- [ ] **Step 3: Fix the heading and the Add Node dialog name**

Around line 428, change the `viewTitle` creation so its text is a constant:

```ts
const viewTitle = text(document, "h1", "Graph", "cm-visually-hidden");
```

Around line 455, change the Add Node popup's `aria-label` from `"Add papers to Collection Graph view"` to `"Add papers to this graph"`.

- [ ] **Step 4: Replace `setViewKind` with `setSeeded`**

Around line 725, replace the whole `setViewKind` function:

```ts
const setViewKind = (kind: "map" | "focus", notify = true): void => {
  const changed = currentViewKind !== kind;
  currentViewKind = kind;
  root.dataset.viewKind = kind;
  viewTitle.textContent = kind === "focus" ? "Explore" : "Collection Graph";
  refreshButton.title =
    kind === "focus"
      ? "Refresh references and citing papers for the current Explore seeds."
      : "Refresh metadata and citation counts for the currently visible papers.";
  if (kind === "map") {
    refreshButton.removeAttribute("aria-busy");
    refreshButton.disabled = false;
  }
  if (changed && notify) options.onViewKindChange?.(kind);
};
```

with

```ts
const setSeeded = (seeded: boolean): void => {
  root.dataset.seeded = seeded ? "true" : "false";
  refreshButton.title = seeded
    ? "Refresh references and citing papers for the current Explore seeds."
    : "Refresh metadata and citation counts for the currently visible papers.";
  if (!seeded) {
    refreshButton.removeAttribute("aria-busy");
    refreshButton.disabled = false;
  }
};
```

Then change the two callers: around line 1701 in `applyFocusProjection`, `setViewKind("focus");` becomes `setSeeded(true);`. Around line 2230 in `exitFocus`, `setViewKind("map");` becomes `setSeeded(false);`.

- [ ] **Step 5: Reword the empty state and key it on the projection**

Around line 1293, replace the start of `updateEmptyState` and its two strings:

```ts
const updateEmptyState = (visibleCount: number): void => {
  // A seeded view fetches its own neighbours, so an empty projection there
  // is a transient loading state rather than a misunderstanding worth
  // explaining.
  if (focusProjection || visibleCount > 1) {
    emptyState.hidden = true;
    return;
  }
  emptyState.hidden = false;
  emptyStateTitle.textContent = visibleCount
    ? "Only one paper in this graph"
    : "This graph is empty";
  emptyStateBody.textContent = visibleCount
    ? "Without seeds, a graph shows how papers you already have cite each " +
      "other, so a single paper has nothing to connect to. Add more with " +
      "the + button in the toolbar, or select several papers in your " +
      "Zotero library, right-click, and choose “Show in” this graph. To " +
      "look beyond your library, right-click a paper and choose " +
      "“Explore in” this graph for its references and citing works."
    : "Without seeds, a graph shows how papers you already have cite each " +
      "other. Add papers with the + button in the toolbar, or select " +
      "several in your Zotero library and right-click → “Show in New " +
      "Graph”. To find work you do not have yet, right-click a paper and " +
      "choose “Explore in New Graph”.";
};
```

- [ ] **Step 6: Drop the "Explore tab without seeds shows nothing" rule**

Around line 3145 inside `inScope` in `applyFilters`, delete this line:

```ts
if (currentViewKind === "focus" && !focusProjection) return false;
```

- [ ] **Step 7: Route Add Node by the projection**

Around line 3675, change

```ts
addLibraryItemsToView = (itemIDs) =>
  currentViewKind === "focus"
    ? addFocusItems(itemIDs)
    : addMapItemsRespectingFilters(itemIDs);
```

to

```ts
addLibraryItemsToView = (itemIDs) =>
  focusProjection
    ? addFocusItems(itemIDs)
    : addMapItemsRespectingFilters(itemIDs);
```

- [ ] **Step 8: Rename the view in the remaining tooltips**

Five strings in `src/services/graphViewService.ts` still name a kind of view. Change each:

| Around line | From                                                                        | To                                                                      |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 284         | `"Add this paper to the current Explore view without adding it to Zotero."` | `"Add this paper as a seed of this graph without adding it to Zotero."` |
| 600         | `"Papers this Explore view was built from."`                                | `"Papers this graph was built from."`                                   |
| 680         | `"Direction, scope, ranking and limit for the current Explore view."`       | `"Direction, scope, ranking and limit for this graph's seeds."`         |
| 1583        | `` `Remove ${seed.title} from Focus View` ``                                | `` `Remove ${seed.title} from the seeds` ``                             |
| 3042        | `"Add this paper to the current Explore view without changing Zotero."`     | `"Add this paper as a seed of this graph without changing Zotero."`     |

- [ ] **Step 9: Stop the window service passing the deleted options**

In `src/services/windowService.ts`, delete these two lines from the `renderGraphView` call around line 335:

```ts
    initialViewKind: instance.kind,
    onViewKindChange: (kind) => setInstanceKind(host, instance, kind),
```

and the same two lines (with `win` in place of `host`) from the call around line 720. Leave `setInstanceKind` itself in place; Task 3 removes it.

- [ ] **Step 10: Key the CSS on the new attribute**

In `addon/content/graph.css` around line 770, change

```css
.meristema-root[data-view-kind="map"] .cm-focus-only {
```

to

```css
.meristema-root[data-seeded="false"] .cm-focus-only {
```

- [ ] **Step 11: Run the gate**

Run: `npm run check`
Expected: green. If typecheck reports `currentViewKind` or `setViewKind`, a reference was missed; grep for both and fix.

- [ ] **Step 12: Commit**

```bash
git add src/services/graphViewService.ts src/services/windowService.ts addon/content/graph.css
git commit -F - <<'EOF'
Show the Explore controls whenever a graph has seeds

The graph view no longer carries a map-or-focus kind. Whether it is
seeded is read from the projection it already tracks, and the root's
data-seeded attribute drives the toolbar.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 2: Carry the intent in the menus, not the tab

**Files:**

- Modify: `src/services/menuService.ts` (imports, `MENU_HINTS`, `openInExistingView`, `injectViewItems`, `itemMenus`, `collectionMenus`, `toolsSubmenu`)
- Modify: `src/services/windowService.ts:1012-1020` (delete `openNewFocusWindow`)
- Modify: `src/services/itemPaneService.ts:301-311`
- Modify: `addon/locale/en-US/mainWindow.ftl`

**Interfaces:**

- Consumes: `openGraphAndSelectItemsInView(instanceID, itemIDs, hostWindow)` and `openFocusItemsInView(instanceID, itemIDs, hostWindow)` from the window service, both existing. The graph view's `applyMapItems` and `openCollections` already call `exitFocus()` when a projection is active, which is what makes a Show intent clear seeds; nothing new is needed for that.
- Produces: `menuService.ts` no longer reads `OpenGraphViewInfo.kind`, and `openNewFocusWindow` no longer exists. Task 3 relies on both.

No unit test: the menu service registers XUL menus through the plugin toolkit and is untested under Node. The gate's typecheck and eslint cover the edits.

- [ ] **Step 1: Drop the focus-window import and the two-view hint comment**

In `src/services/menuService.ts`, remove `openNewFocusWindow,` from the `./windowService` import list.

Replace the `MENU_HINTS` comment and table (around lines 24-35) with:

```ts
// Menu labels do not convey what the two intents cost: showing papers only
// draws connections already in the library, while exploring fetches
// references and citing works from the providers. Tooltips cannot be used for
// this — Gecko does not render them over an open menupopup — so the hint goes
// in acceltext, the only secondary text a menuitem will draw.
const MENU_HINTS: Record<string, string> = {
  "show-items-new-tab-command": "library only",
  "collection-new-graph-command": "library only",
  "new-graph-view-command": "library only",
  "open-focus-view-new-tab-command": "fetches online",
};
```

- [ ] **Step 2: Split `openInExistingView` by intent**

Replace the `openInExistingView` function (around lines 156-171) with two:

```ts
async function showInExistingView(
  view: OpenGraphViewInfo,
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openGraphAndSelectItemsInView(
    view.instanceID,
    command.itemIDs,
    hostWindow,
  );
}

async function exploreInExistingView(
  view: OpenGraphViewInfo,
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openFocusItemsInView(view.instanceID, command.itemIDs, hostWindow);
}
```

- [ ] **Step 3: Let two anchors in one popup inject their own entries**

`injectViewItems` clears every injected entry in the popup before adding its own. With two anchors in the item menu, the second anchor's `onShown` would wipe the first's entries. Give each anchor a group. Replace the function (around lines 208-246) with:

```ts
function injectViewItems(
  context: any,
  group: string,
  views: readonly OpenGraphViewInfo[],
  hint: string | ((view: OpenGraphViewInfo) => string),
  run: (view: OpenGraphViewInfo) => void,
  label: (view: OpenGraphViewInfo) => string = (view) => view.title,
): void {
  const anchor = safeContextValue(context, "menuElem") as
    HTMLElement | undefined;
  const popup = anchor?.parentElement as HTMLElement | null | undefined;
  if (!anchor || !popup) return;

  // Two anchors share the item menu, so each clears only its own entries.
  const clear = (): void => {
    popup
      .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="${group}"]`)
      .forEach((node) => node.remove());
  };
  clear();
  if (!views.length) return;

  const document = popup.ownerDocument as any;
  let previous: HTMLElement = anchor;
  for (const view of views) {
    const item = document.createXULElement("menuitem");
    item.setAttribute(OPEN_IN_DYNAMIC_ATTR, group);
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("image", ICON);
    const text = label(view);
    item.setAttribute("label", view.active ? `✓ ${text}` : text);
    item.setAttribute(
      "acceltext",
      typeof hint === "function" ? hint(view) : hint,
    );
    item.addEventListener("command", () => run(view), { once: true });
    previous.after(item);
    previous = item;
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}
```

- [ ] **Step 4: Offer both intents for every open view in the item menu**

Replace the first two entries of the array returned by `itemMenus()` (the `show-items-new-tab-command` and `open-focus-view-new-tab-command` items, around lines 280-308) with:

```ts
    contextCommandItem(
      `${config.addonRef}-show-items-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewMap(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const hostWindow = contextWindow(context);
        injectViewItems(
          context,
          "show",
          getOpenGraphViews(hostWindow),
          "adds to graph",
          (view) => {
            void showInExistingView(
              view,
              itemCommand(context),
              hostWindow,
            ).catch(report);
          },
          (view) => `Show in ${view.title}`,
        );
      },
    ),
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const hostWindow = contextWindow(context);
        injectViewItems(
          context,
          "explore",
          getOpenGraphViews(hostWindow),
          "adds as seeds",
          (view) => {
            void exploreInExistingView(
              view,
              itemCommand(context),
              hostWindow,
            ).catch(report);
          },
          (view) => `Explore in ${view.title}`,
        );
      },
    ),
```

- [ ] **Step 5: Offer folders to every open view**

In the comment above `collectionMenus()` (around lines 320-329), delete the final paragraph:

```ts
//
// Explore views are left out. A focus view is seeded by item IDs and has no
// collection to re-scope, so there is nothing coherent to offer.
```

and append in its place:

```ts
//
// A seeded graph is offered too: showing a folder in it drops the seeds and
// draws the folder, which is what "Show in" promises.
```

Inside `collectionMenus()`, change the `injectViewItems` call (around line 372) so it passes a group and no longer filters by kind:

```ts
injectViewItems(
  context,
  "show",
  getOpenGraphViews(hostWindow),
  "replaces contents",
  (view) => {
    void openGraphForCollections(target.collectionIDs, hostWindow, {
      targetInstanceID: view.instanceID,
    }).catch(report);
  },
  (view) =>
    folders === 1
      ? `Show in ${view.title}`
      : `Show ${folders} folders in ${view.title}`,
);
```

- [ ] **Step 6: One New Graph entry in Tools**

In `toolsSubmenu()` (around line 400), delete:

```ts
      commandItem(`${config.addonRef}-new-focus-view-command`, (context) =>
        openNewFocusWindow(contextWindow(context), activeLibraryID(context)),
      ),
```

- [ ] **Step 7: Delete the focus-window opener**

In `src/services/windowService.ts` (around lines 1012-1020), delete:

```ts
export async function openNewFocusWindow(
  hostWindow?: _ZoteroTypes.MainWindow,
  libraryID?: number | null,
): Promise<void> {
  await openGraphWindow(hostWindow, libraryID, {
    newInstance: true,
    initialKind: "focus",
  });
}
```

- [ ] **Step 8: Rename the item pane buttons**

In `src/services/itemPaneService.ts` (around lines 301-311), replace the two actions:

```ts
    {
      label: "Graph",
      title: "Show this paper in a new graph.",
      action: () => openGraphAndSelectItemsInNewTab([itemID], hostWindow),
    },
    {
      label: "Explore",
      title: "Open a new graph with this paper as its seed.",
      action: () => openFocusItemsInNewTab([itemID], hostWindow),
    },
```

- [ ] **Step 9: Update the locale**

In `addon/locale/en-US/mainWindow.ftl`:

Change line 5 to `    .label = Open Graph (Current Library)`.

Delete the `show-items-command` and `open-focus-view-command` entries (lines 43-47); nothing in `src` references them.

Change the remaining four entries:

```ftl
show-items-new-tab-command =
    .label = Show in New Graph

open-focus-view-new-tab-command =
    .label = Explore in New Graph

new-graph-view-command =
    .label = New Graph
```

and delete the `new-focus-view-command` entry entirely.

- [ ] **Step 10: Run the gate**

Run: `npm run check`
Expected: green. eslint would flag an unused `openNewFocusWindow` import if Step 1 was missed.

- [ ] **Step 11: Commit**

```bash
git add src/services/menuService.ts src/services/windowService.ts src/services/itemPaneService.ts addon/locale/en-US/mainWindow.ftl
git commit -F - <<'EOF'
Offer Show in and Explore in for every open graph

The item menu carries the intent: every open view is listed under both
"Show in New Graph" and "Explore in New Graph". Folders can be shown in a
seeded graph, and Tools has a single New Graph entry.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 3: Drop the kind from the instance policy and the window service

**Files:**

- Modify: `src/services/graphInstancePolicy.ts:1-26` and `:73-84`
- Modify: `test/unit/architecture.test.ts:349-357` and `:431-443`
- Modify: `src/services/windowService.ts` (regions listed per step)

**Interfaces:**

- Consumes: Task 1 removed the two graph-view options; Task 2 removed every reader of `OpenGraphViewInfo.kind` and `openNewFocusWindow`.
- Produces: `nextGraphViewTitle(existingTitles: readonly string[], preferredBase?: string): string` and `GRAPH_VIEW_BASE_TITLE = "Graph"`. `GraphViewKind`, `graphViewBaseTitle`, `GraphInstanceState.kind`, `setInstanceKind`, `requestViewKind`, `OpenGraphOptions.initialKind`, `OpenGraphViewInfo.kind` and `tab.data.graphKind` no longer exist.

- [ ] **Step 1: Rewrite the title tests**

In `test/unit/architecture.test.ts`, replace the test at line 349:

```ts
it("assigns separate default names to Collection Graph and Explore views", function () {
  expect(nextGraphViewTitle("map", [])).to.equal("Collection Graph");
  expect(nextGraphViewTitle("map", ["Collection Graph"])).to.equal(
    "Collection Graph 2",
  );
  expect(nextGraphViewTitle("focus", ["Collection Graph", "Explore"])).to.equal(
    "Explore 2",
  );
});
```

with

```ts
it("names every new view Graph and numbers the rest", function () {
  expect(nextGraphViewTitle([])).to.equal("Graph");
  expect(nextGraphViewTitle(["Graph"])).to.equal("Graph 2");
  expect(nextGraphViewTitle(["Graph", "Graph 2"])).to.equal("Graph 3");
});
```

and in the test at line 431 change the four calls:

```ts
expect(nextGraphViewTitle([], "PhD Graph")).to.equal("PhD Graph");
expect(nextGraphViewTitle(["PhD Graph"], "PhD Graph")).to.equal("PhD Graph 2");
// A blank or whitespace folder name falls back to the generic base rather
// than titling a tab with nothing.
expect(nextGraphViewTitle([], "   ")).to.equal("Graph");
expect(nextGraphViewTitle([], "")).to.equal("Graph");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/architecture.test.ts`
Expected: the two title tests fail. The first argument is now an array where a kind string was expected, so the titles come out as "Collection Graph" or similar rather than "Graph".

- [ ] **Step 3: Drop the kind from the instance policy**

In `src/services/graphInstancePolicy.ts`, delete line 3:

```ts
export type GraphViewKind = "map" | "focus";
```

Replace `graphViewBaseTitle` (lines 24-26) with:

```ts
/** The name a view carries when nothing more specific names it. */
export const GRAPH_VIEW_BASE_TITLE = "Graph";
```

Replace the `nextGraphViewTitle` signature and its first body line (lines 73-78):

```ts
export function nextGraphViewTitle(
  existingTitles: readonly string[],
  preferredBase?: string,
): string {
  const base = preferredBase?.trim() || GRAPH_VIEW_BASE_TITLE;
```

The rest of the function is unchanged.

- [ ] **Step 4: Run the test to see it pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/architecture.test.ts`
Expected: all tests in the file pass.

- [ ] **Step 5: Drop the kind from the window service**

In `src/services/windowService.ts`:

Line 15: delete `type GraphViewKind,` from the import; add `GRAPH_VIEW_BASE_TITLE,` to the same import list (alphabetical order, before `graphInstanceShouldRender`).

In `GraphInstanceState` (line 34): delete `kind: GraphViewKind;`.

In `createGraphInstance` (lines 69-86), remove the `kind` parameter and its uses so the head reads:

```ts
function createGraphInstance(
  win: _ZoteroTypes.MainWindow,
  libraryID: number | null = null,
  titleBase?: string,
): GraphInstanceState {
  graphInstanceSequence += 1;
  const instanceID = `meristema-${Date.now().toString(36)}-${graphInstanceSequence.toString(36)}`;
  const state = graphState(win);
  const created: GraphInstanceState = {
    instanceID,
    title: nextGraphViewTitle(
      [...state.instances.values()].map((instance) => instance.title),
      titleBase,
    ),
    customTitle: false,
```

Line 455 (in the tab-data writer): delete `tab.data.graphKind = instance.kind;`.

Line 470 (in `syncInstanceTitle`): delete `tab.data.graphKind = instance.kind;`.

Delete the whole `setInstanceKind` function (lines 479-495).

In `instanceForTab` (around line 515), change the `createGraphInstance` call to:

```ts
const created = createGraphInstance(win, positiveInteger(tab?.data?.libraryID));
```

Line 611 (the `getTitle` tab hook): change `"Collection Graph"` to `GRAPH_VIEW_BASE_TITLE`.

In `OpenGraphOptions` (line 825): delete `initialKind?: GraphViewKind;`.

Delete the `requestViewKind` function (lines 835-840).

In `openGraphWindow` (around lines 908-919), replace

```ts
let instance = requestedInstance(win, options);
const requestedKind = options.initialKind ?? requestViewKind(options.request);
if (!instance) {
  instance = createGraphInstance(
    win,
    targetLibraryID,
    requestedKind ?? "map",
    options.titleBase,
  );
} else if (requestedKind) {
  setInstanceKind(win, instance, requestedKind);
}
```

with

```ts
let instance = requestedInstance(win, options);
if (!instance) {
  instance = createGraphInstance(win, targetLibraryID, options.titleBase);
}
```

Line 976 (the tab `data` object in `openGraphWindow`): delete `graphKind: instance.kind,`.

In `OpenGraphViewInfo` (line 1025): delete `kind: GraphViewKind;`. In `getOpenGraphViews` (line 1041): delete `kind: instance.kind,`.

- [ ] **Step 6: Confirm nothing else names the kind**

Run: `grep -rn "GraphViewKind\|graphKind\|initialKind\|setInstanceKind\|requestViewKind\|graphViewBaseTitle\|viewKind" src addon test`
Expected: no output.

- [ ] **Step 7: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/services/graphInstancePolicy.ts src/services/windowService.ts test/unit/architecture.test.ts
git commit -F - <<'EOF'
Name every view Graph and drop the tab's kind

A view is no longer created as a map or a focus view, saved with a kind,
or renamed when seeds come and go. Tabs saved by earlier versions with a
graphKind reopen as graphs of their library.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 4: Documentation

**Files:**

- Modify: `README.md:13-16`, `:42-48`, `:60-61`
- Modify: `docs/superpowers/specs/2026-09-06-graph-view-merge-design.md:4` and the `## Files` section

**Interfaces:** none.

- [ ] **Step 1: Update the README**

Replace lines 13-16:

```markdown
That is what this plugin does with a library: the Explore view grows outward
from seed papers, following references and citing works to the frontier of what
you already have.
```

with

```markdown
That is what this plugin does with a library: seed a graph with a paper and it
grows outward, following references and citing works to the frontier of what
you already have.
```

Replace the first two feature bullets (lines 42-48) with:

```markdown
- **See how the papers in your library are connected**
  Build an interactive citation graph for a library, collection, or selected papers. Search and filter the graph, inspect a paper, and return directly to its Zotero item, notes, or PDF.
  ![graph](docs/assets/FreeGraph.png)

- **Explore outward from one or more papers**
  Add "seed" papers to a graph and it shows their references, citing papers, or both. Add or remove seeds, include papers outside Zotero, rank and limit neighbours, and move backward or forward through previous seed states. Remove the last seed and the graph returns to your library.
  ![Explore](docs/assets/FocusView.png)
```

Replace the multiple-views bullet (lines 60-61) with:

```markdown
- **Work with multiple independent views**
  Open several Graph tabs at once. Rename views and use `Show in ›` or `Explore in ›` to create a new view or add papers to an existing one. Each view keeps its own scope, seeds, filters, selection, camera, and navigation history.
```

- [ ] **Step 2: Mark the spec implemented and correct its file list**

In `docs/superpowers/specs/2026-09-06-graph-view-merge-design.md`, change `**Status:** Draft` to `**Status:** Implemented`.

In the `## Files` section, replace the last bullet

```markdown
- `README.md`, new `test/unit/graphInstancePolicy.test.ts`.
```

with

```markdown
- `README.md`, `test/unit/architecture.test.ts` (the title tests already
  live there).
```

and in `## Testing`, replace

```markdown
- Unit tests in `test/unit` for `nextGraphViewTitle` without a kind: the
  first view is "Graph", the second "Graph 2", a preferred base wins, and a
  blank preferred base falls back to "Graph".
```

with

```markdown
- The `nextGraphViewTitle` tests in `test/unit/architecture.test.ts` lose
  their kind argument: the first view is "Graph", the second "Graph 2", a
  preferred base wins, and a blank preferred base falls back to "Graph".
```

- [ ] **Step 3: Format and run the gate**

Run: `npx prettier --write README.md docs/superpowers/specs/2026-09-06-graph-view-merge-design.md && npm run check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-06-graph-view-merge-design.md
git commit -F - <<'EOF'
Describe the graph as one view that can be seeded

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

## Manual verification (user, after the branch lands)

Run `npm start`, then in Zotero:

1. Tools › Meristema › New Graph opens the library graph, titled "Graph".
2. Right-click a paper › Explore in New Graph opens "Graph 2" with the paper as seed and the Seeds and Explore buttons visible.
3. In that tab, Seeds › remove the seed: the library graph appears, the buttons hide, the tab is still "Graph 2".
4. Right-click two papers › Show in Graph 2: they are selected in the seedless graph.
5. Right-click a paper › Explore in Graph 2 while seeded: it is added as a second seed.
6. Right-click a folder › Show in Graph 2 while seeded: seeds clear and the folder graph appears.
7. Explore paper A, then Explore paper B in the same tab, then press Back twice: the second press crosses into the seedless graph, the buttons hide, and Forward returns to the seeded state.
8. Restart Zotero with the tabs open, including one saved by the previous version as an Explore tab: every tab reopens as a graph of its library with no error in the debug output.
