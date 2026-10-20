# F5 Node Menu and Named Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The node's right-click menu offers what Paper details offers, and the toolbar's Refresh and the pane's Update connections say in their labels which scope they act on.

**Architecture:** A pure `nodeMenuEntries` in `src/services/nodeMenu.ts` decides which menu entries show, in what order, and which is disabled. `graphViewService.ts` builds every entry button once and shows what the function returns. A shared `updatePaperConnections` routine in the view, with a map of running updates by node key, serves both the pane button and the menu entry.

**Tech Stack:** TypeScript, Zotero 7 plugin (zotero-plugin scaffold), mocha + chai in Zotero (`npm test`), node:test + chai for unit tests (`npm run test:unit`).

Spec: `docs/superpowers/specs/2026-10-20-node-menu-scopes-design.md`.

## Global Constraints

- Menu order, library paper: open, Show in Zotero, Find similar papers, separator, seed toggle, Remove from graph.
- Menu order, external paper: open, Show in Zotero (in the library) or Add to Zotero… (not in it), Find similar papers, Update this paper's connections, separator, seed toggle, Remove from graph.
- Remove from graph is absent for a seed. The open entry is hidden when the paper has nothing to open, as today.
- The menu never imports. Add to Zotero… focuses the pane's Add to Zotero button.
- Labels, verbatim: "Show in Zotero", "Add to Zotero…" (with the single character `…`), "Find similar papers", "Update this paper's connections", "Refresh visible", "Refresh seeds".
- Tooltip for the pane button and the menu entry, verbatim: "Fetch this paper's references and citing papers again."
- Toolbar tooltips are unchanged: "Refresh metadata and citation counts for the currently visible papers." with no seeds; "Refresh references and citing papers for the current Explore seeds." with seeds.
- The separator is a `div` with `role="separator"` and class `cm-node-menu-separator`; the arrow keys never land on it.
- A second update request for a paper whose update is running starts no second fetch.
- Commits: sentence-case subject, no type prefix, stage by path, end with the two trailers:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8`.
- Gate every commit with `npm run check` (lint, prettier including docs, typecheck, unit tests). Do not run `npm test` (the Zotero suite) in Tasks 1–3; Task 4 runs it once.
- Never split an inline code span across lines in Markdown (prettier).

---

### Task 1: The menu's entry list as a pure function

**Files:**

- Modify: `src/services/nodeMenu.ts` (append after `paperURL`)
- Test: `test/unit/nodeMenu.test.ts`

**Interfaces:**

- Produces (exported from `src/services/nodeMenu.ts`):
  - `type NodeMenuEntryId = "open" | "show" | "add" | "similar" | "update" | "separator" | "seed" | "remove"`
  - `interface NodeMenuInput { kind: "library" | "external"; inLibrary: boolean; isSeed: boolean; updating: boolean }`
  - `interface NodeMenuEntry { id: NodeMenuEntryId; disabled: boolean }`
  - `function nodeMenuEntries(input: NodeMenuInput): NodeMenuEntry[]`
  - `const UPDATE_CONNECTIONS_LABEL = "Update this paper's connections"`
  - `const UPDATE_CONNECTIONS_TITLE = "Fetch this paper's references and citing papers again."`
  - `const FIND_SIMILAR_TITLE = "Find papers similar to this one using scholarly-data providers. Results are shown for review and are not added to Zotero automatically."`

- [ ] **Step 1: Write the failing tests**

In `test/unit/nodeMenu.test.ts`, extend the import:

```ts
import {
  clampMenuPosition,
  isContextMenuKey,
  nodeMenuEntries,
  openPaperEntry,
  type NodeMenuInput,
} from "../../src/services/nodeMenu";
```

Append at the end of the file:

```ts
describe("nodeMenuEntries", function () {
  const ids = (
    input: Partial<NodeMenuInput> & Pick<NodeMenuInput, "kind">,
  ): string[] =>
    nodeMenuEntries({
      inLibrary: false,
      isSeed: false,
      updating: false,
      ...input,
    }).map((entry) => entry.id);

  it("gives a library paper the pane's actions, a rule, then the seed entries", function () {
    expect(ids({ kind: "library" })).to.deep.equal([
      "open",
      "show",
      "similar",
      "separator",
      "seed",
      "remove",
    ]);
  });

  it("leaves Remove from graph out for a seed", function () {
    expect(ids({ kind: "library", isSeed: true })).to.deep.equal([
      "open",
      "show",
      "similar",
      "separator",
      "seed",
    ]);
  });

  it("shows an external paper that is in the library, and offers its update", function () {
    expect(ids({ kind: "external", inLibrary: true })).to.deep.equal([
      "open",
      "show",
      "similar",
      "update",
      "separator",
      "seed",
      "remove",
    ]);
  });

  it("offers to add an external paper that is not in the library", function () {
    expect(ids({ kind: "external", inLibrary: false })).to.deep.equal([
      "open",
      "add",
      "similar",
      "update",
      "separator",
      "seed",
      "remove",
    ]);
  });

  it("disables only the update entry while that paper's update runs", function () {
    const entries = nodeMenuEntries({
      kind: "external",
      inLibrary: false,
      isSeed: false,
      updating: true,
    });
    expect(
      entries.filter((entry) => entry.disabled).map((entry) => entry.id),
    ).to.deep.equal(["update"]);
  });

  it("disables nothing when no update runs", function () {
    const entries = nodeMenuEntries({
      kind: "external",
      inLibrary: true,
      isSeed: true,
      updating: false,
    });
    expect(entries.some((entry) => entry.disabled)).to.equal(false);
  });

  it("gives a library paper no update entry, running or not", function () {
    const entries = nodeMenuEntries({
      kind: "library",
      inLibrary: false,
      isSeed: false,
      updating: true,
    });
    expect(entries.map((entry) => entry.id)).to.not.include("update");
    expect(entries.some((entry) => entry.disabled)).to.equal(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `nodeMenuEntries` is not exported (TypeScript/import error or `nodeMenuEntries is not a function`).

- [ ] **Step 3: Implement**

Append to `src/services/nodeMenu.ts`:

```ts
/** The node menu's entries (F5). "separator" is the rule above the seed entries. */
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
  /** External papers only: a local Zotero item was found for the paper. */
  inLibrary: boolean;
  isSeed: boolean;
  /** This paper's connections update is running. */
  updating: boolean;
}

export interface NodeMenuEntry {
  id: NodeMenuEntryId;
  /** True only for "update" while the paper's update runs. */
  disabled: boolean;
}

export const UPDATE_CONNECTIONS_LABEL = "Update this paper's connections";
export const UPDATE_CONNECTIONS_TITLE =
  "Fetch this paper's references and citing papers again.";
export const FIND_SIMILAR_TITLE =
  "Find papers similar to this one using scholarly-data providers. Results are shown for review and are not added to Zotero automatically.";

/**
 * What the node menu shows, in order: what Paper details offers for the
 * paper, a rule, then the seed toggle and, for a paper that is not a seed,
 * Remove from graph. "open" is always listed; the view hides it while the
 * paper has nothing to open, because its entry can arrive after the menu
 * opens (`openPaperEntry` relabels it once Zotero answers). The menu never
 * imports: an external paper outside the library gets "add", which hands the
 * reader to the pane's collection picker.
 */
export function nodeMenuEntries(input: NodeMenuInput): NodeMenuEntry[] {
  const external = input.kind === "external";
  const ids: NodeMenuEntryId[] = [
    "open",
    external && !input.inLibrary ? "add" : "show",
    "similar",
  ];
  if (external) ids.push("update");
  ids.push("separator", "seed");
  if (!input.isSeed) ids.push("remove");
  return ids.map((id) => ({
    id,
    disabled: id === "update" && input.updating,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS, including the 7 new `nodeMenuEntries` cases.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` (expected exit 0; run `npx prettier --write` on the two files first if it reports formatting).

```bash
git add src/services/nodeMenu.ts test/unit/nodeMenu.test.ts
git commit -m "The node menu's entries come from one pure list: the pane's actions, a rule, then the seed entries (F5)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```

---

### Task 2: Named scopes and the shared connections update

**Files:**

- Modify: `src/services/graphViewService.ts`
  - the toolbar's `refreshButton` (search `iconButtonContent(document, "refresh", "Refresh")`)
  - `setSeeded` (search `const setSeeded = (seeded: boolean)`)
  - `renderOverview`'s external branch (search `update.textContent = "Update connections"`) and its library branch's similar tooltip (search `similar.title =`)
  - the `nodeMenu` import block (search `} from "./nodeMenu";`)
- Modify: `test/zotero/graphCitationHops.test.ts` (the `refreshButton()` finder, search `=== "Refresh");`)

**Interfaces:**

- Consumes: `UPDATE_CONNECTIONS_LABEL`, `UPDATE_CONNECTIONS_TITLE`, `FIND_SIMILAR_TITLE` from Task 1.
- Produces (inside the view closure, for Task 3):
  - `connectionUpdates: Map<string, Promise<void>>` — running updates by node key.
  - `function updatePaperConnections(node: CitationGraphNode): Promise<void>`
  - `function localItemFor(node: CitationGraphNode): Zotero.Item | null` — the local item an external paper resolves to (null for a library paper).
  - `let overviewUpdateButton: { key: string; button: HTMLButtonElement } | null` — the overview's Update button, set when the overview renders one; `renderOverview` resets it first.

- [ ] **Step 1: Import the constants**

Change the `./nodeMenu` import block to:

```ts
import {
  clampMenuPosition,
  FIND_SIMILAR_TITLE,
  openPaperEntry,
  UPDATE_CONNECTIONS_LABEL,
  UPDATE_CONNECTIONS_TITLE,
  type BestAttachmentType,
  type OpenPaperEntry,
} from "./nodeMenu";
```

(Task 3 adds `nodeMenuEntries` and `type NodeMenuEntryId` to this block.)

- [ ] **Step 2: The toolbar labels**

Replace:

```ts
refreshButton.append(iconButtonContent(document, "refresh", "Refresh"));
```

with:

```ts
// The label names the scope (F5): the visible papers, or the seeds once
// there are any. `setSeeded` switches it with the tooltip.
const refreshLabel = text(document, "span", "Refresh visible");
refreshButton.append(icon(document, "refresh"), refreshLabel);
```

In `setSeeded`, after the `refreshButton.title = seeded ? … : …;` statement, add:

```ts
refreshLabel.textContent = seeded ? "Refresh seeds" : "Refresh visible";
```

If `iconButtonContent` has no other use left in the file, remove it from its import (`npm run check`'s lint will say).

- [ ] **Step 3: `localItemFor`, the running-updates map, and `updatePaperConnections`**

Directly above `function renderOverview(node: CitationGraphNode | null): void {`, add:

```ts
/** The Zotero item an external paper resolves to; null for a library paper or one not in Zotero. */
function localItemFor(node: CitationGraphNode): Zotero.Item | null {
  if (node.kind !== "external" || !node.externalWork) return null;
  const work = node.externalWork as ExternalWork;
  const localKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
  if (!localKey) return null;
  return (
    ((Zotero.Items as any).getByLibraryAndKey?.(
      snapshot.libraryID,
      localKey,
    ) as Zotero.Item | false | null) || null
  );
}

/**
 * Running connection updates, by node key (F5). The pane's button and the
 * node menu's entry both start updates here and both read it, so the two
 * share one disabled state and a second request starts no second fetch.
 */
const connectionUpdates = new Map<string, Promise<void>>();
/** The overview's Update button, while the overview shows one. */
let overviewUpdateButton: { key: string; button: HTMLButtonElement } | null =
  null;
const paneShowsUpdateFor = (node: CitationGraphNode): boolean =>
  overviewUpdateButton?.key === node.key &&
  overviewUpdateButton.button.isConnected;

/** Fetch both directions of one paper's connections again, then redraw what depends on them. */
function updatePaperConnections(node: CitationGraphNode): Promise<void> {
  const running = connectionUpdates.get(node.key);
  if (running) return running;
  if (paneShowsUpdateFor(node)) overviewUpdateButton!.button.disabled = true;
  const run = (async () => {
    for (const direction of ["references", "cited-by"] as const) {
      await refreshExternalRelationships(node, libraryModel.nodes, direction, {
        maximum: RELATIONSHIP_VIEW_LIMIT,
        refreshMembership: true,
        silent: true,
        mode: "manual",
        queueBackgroundHydration: true,
        onMembershipResolved: (resolution) => {
          if (resolution.reportedCount === null) return;
          if (direction === "references") {
            node.referenceCount = resolution.reportedCount;
          } else {
            node.citationCount = resolution.reportedCount;
          }
        },
      });
      await new Promise<void>((resolve) => {
        scheduleFocusTask(resolve, 0);
      });
    }
  })().then(
    () => {
      // Out of the map first, so the re-rendered pane button is enabled.
      connectionUpdates.delete(node.key);
      invalidateHopFragment(snapshot.libraryID, node.key);
      if (hopModel?.entries.has(node.key)) rebuildCurrentFocus();
      // Only when the pane still shows this paper's overview: an update
      // started from the menu must not pull the pane back from another one.
      if (!cleaned && paneShowsUpdateFor(node)) renderOverview(node);
    },
    (error: unknown) => {
      connectionUpdates.delete(node.key);
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      if (paneShowsUpdateFor(node)) {
        overviewUpdateButton!.button.disabled = false;
      }
    },
  );
  connectionUpdates.set(node.key, run);
  return run;
}
```

- [ ] **Step 4: `renderOverview` uses them**

At the very top of `renderOverview`'s body (before `activeRelationshipView = null;`), add:

```ts
overviewUpdateButton = null;
```

In the external branch, replace the local-item lookup:

```ts
const localKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
const localItem = localKey
  ? ((Zotero.Items as any).getByLibraryAndKey?.(
      snapshot.libraryID,
      localKey,
    ) as Zotero.Item | null)
  : null;
```

with:

```ts
const localItem = localItemFor(node);
```

Replace the whole Update button block, from `const update = element(document, "button", "cm-secondary-button");` through `actions.appendChild(update);`, with:

```ts
const update = element(document, "button", "cm-secondary-button");
update.type = "button";
update.textContent = UPDATE_CONNECTIONS_LABEL;
update.title = UPDATE_CONNECTIONS_TITLE;
update.disabled = connectionUpdates.has(node.key);
update.addEventListener("click", () => {
  if (!update.disabled) void updatePaperConnections(node);
});
overviewUpdateButton = { key: node.key, button: update };
actions.appendChild(update);
```

In the library branch, replace the inline similar tooltip string:

```ts
similar.title =
  "Find papers similar to this one using scholarly-data providers. Results are shown for review and are not added to Zotero automatically.";
```

with:

```ts
similar.title = FIND_SIMILAR_TITLE;
```

`work` stays: `externalWorkURL(work)` and `createImportArea(document, work, …)` still use it.

- [ ] **Step 5: The hop suite finds the renamed Refresh**

In `test/zotero/graphCitationHops.test.ts`, the `refreshButton()` helper: replace

```ts
    ).find((candidate) => normalize(candidate.textContent) === "Refresh");
```

with

```ts
    ).find((candidate) =>
      /^Refresh (visible|seeds)$/.test(normalize(candidate.textContent)),
    );
```

- [ ] **Step 6: Gate and commit**

Run: `npm run check` (expected exit 0). Then:

```bash
git add src/services/graphViewService.ts test/zotero/graphCitationHops.test.ts
git commit -m "Refresh names its scope, and Update this paper's connections runs through one shared routine (F5)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```

---

### Task 3: The node menu offers the pane's actions

**Files:**

- Modify: `src/services/graphViewService.ts`
  - the menu's construction (search `// The node's right-click menu. Two items`)
  - `nodeMenuItems`, `openNodeMenu` and the menu's click listeners (search `const nodeMenuItems = (): HTMLButtonElement[] =>`)
  - the `./nodeMenu` import block
- Modify: `addon/content/graph.css` (the `[hidden]` list containing `.cm-node-menu-item[hidden],`, and the rules after `.cm-node-menu-item:focus-visible {…}`)
- Modify: `test/zotero/graphViewVisual.test.ts` (the node-menu walk; search `expect(shown()).to.deep.equal(["Remove seed"]);`)

**Interfaces:**

- Consumes: `nodeMenuEntries`, `NodeMenuEntryId` (Task 1); `connectionUpdates`, `updatePaperConnections`, `localItemFor`, `overviewUpdateButton`, `renderOverview`, `FIND_SIMILAR_TITLE`, `UPDATE_CONNECTIONS_LABEL`, `UPDATE_CONNECTIONS_TITLE` (Task 2); existing `selectPaper`, `loadInlineSimilarResults`, `closeNodeMenu`, `applyOpenEntry`, `hopModel`.

- [ ] **Step 1: Import the entry list, and keep the overview's Add to Zotero button**

Add `nodeMenuEntries,` and `type NodeMenuEntryId,` to the `./nodeMenu` import block (alphabetical among the values, types last, as the block already orders them).

Beside Task 2's `overviewUpdateButton` declaration, add:

```ts
/** The overview's Add to Zotero button, while the overview shows one. */
let overviewAddButton: { key: string; button: HTMLButtonElement } | null = null;
```

At the top of `renderOverview`'s body, under Task 2's `overviewUpdateButton = null;`, add `overviewAddButton = null;`. In the external branch, after `actions.appendChild(importArea.addButton);`, add:

```ts
overviewAddButton = { key: node.key, button: importArea.addButton };
```

- [ ] **Step 2: Build every entry once**

Replace the construction, from the comment `// The node's right-click menu. Two items: the seed toggle and Explore-from.` through `nodeMenu.append(nodeMenuOpen, nodeMenuSeed, nodeMenuRemove);`, with:

```ts
// The node's right-click menu (F5): what Paper details offers for the
// paper, a rule, then the seed toggle and Remove from graph. Every entry is
// built once; `nodeMenuEntries` says which show, in what order.
// It lives in the graph area so it is clamped to the plot, not the window.
const nodeMenu = element(document, "div", "cm-node-menu");
nodeMenu.hidden = true;
nodeMenu.setAttribute("role", "menu");
nodeMenu.setAttribute("aria-label", "Paper actions");
const nodeMenuButton = (label: string, title?: string): HTMLButtonElement => {
  const item = element(document, "button", "cm-node-menu-item");
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  if (title) item.title = title;
  return item;
};
const nodeMenuOpen = nodeMenuButton("");
nodeMenuOpen.hidden = true;
const nodeMenuShow = nodeMenuButton("Show in Zotero");
const nodeMenuAdd = nodeMenuButton(
  "Add to Zotero…",
  "Choose a collection in Paper details, then add this paper to Zotero.",
);
const nodeMenuSimilar = nodeMenuButton(
  "Find similar papers",
  FIND_SIMILAR_TITLE,
);
const nodeMenuUpdate = nodeMenuButton(
  UPDATE_CONNECTIONS_LABEL,
  UPDATE_CONNECTIONS_TITLE,
);
const nodeMenuSeparator = element(document, "div", "cm-node-menu-separator");
nodeMenuSeparator.setAttribute("role", "separator");
const nodeMenuSeed = nodeMenuButton("");
const nodeMenuRemove = nodeMenuButton("Remove from graph");
const nodeMenuElements: Record<NodeMenuEntryId, HTMLElement> = {
  open: nodeMenuOpen,
  show: nodeMenuShow,
  add: nodeMenuAdd,
  similar: nodeMenuSimilar,
  update: nodeMenuUpdate,
  separator: nodeMenuSeparator,
  seed: nodeMenuSeed,
  remove: nodeMenuRemove,
};
nodeMenu.append(...Object.values(nodeMenuElements));
```

- [ ] **Step 3: Show what the list says**

Replace `nodeMenuItems`:

```ts
const nodeMenuItems = (): HTMLButtonElement[] =>
  [nodeMenuOpen, nodeMenuSeed, nodeMenuRemove].filter((item) => !item.hidden);
```

with (DOM order is menu order, because `openNodeMenu` re-appends in order; a disabled entry cannot take focus, so the arrows skip it):

```ts
const nodeMenuItems = (): HTMLButtonElement[] =>
  (
    Array.from(
      nodeMenu.querySelectorAll(".cm-node-menu-item"),
    ) as HTMLButtonElement[]
  ).filter((item) => !item.hidden && !item.disabled);
```

In `openNodeMenu`, replace these two lines:

```ts
nodeMenuSeed.textContent = isSeed ? "Remove seed" : "Add as seed";
nodeMenuRemove.hidden = isSeed;
```

with:

```ts
nodeMenuSeed.textContent = isSeed ? "Remove seed" : "Add as seed";
const entries = nodeMenuEntries({
  kind: node.kind === "external" ? "external" : "library",
  inLibrary: localItemFor(node) !== null,
  isSeed,
  updating: connectionUpdates.has(node.key),
});
const listed = new Set<NodeMenuEntryId>();
for (const entry of entries) {
  const item = nodeMenuElements[entry.id];
  nodeMenu.appendChild(item);
  if (item !== nodeMenuSeparator) {
    (item as HTMLButtonElement).disabled = entry.disabled;
  }
  listed.add(entry.id);
}
for (const [id, item] of Object.entries(nodeMenuElements)) {
  // The open entry's visibility is `showOpenEntry`'s: it can arrive late.
  if (id !== "open") item.hidden = !listed.has(id as NodeMenuEntryId);
}
```

(`applyOpenEntry(node);` stays right after, and still decides the open entry.)

- [ ] **Step 4: The new entries' actions**

After the `nodeMenuRemove.addEventListener("click", …)` block, add:

```ts
nodeMenuShow.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (!node) return;
  const itemID =
    node.kind === "external" ? localItemFor(node)?.id : node.itemID;
  if (itemID !== undefined) void selectPaper(itemID);
});
nodeMenuAdd.addEventListener("click", () => {
  const node = nodeMenuTarget;
  // Focus goes to the pane, not back to the canvas: the reader picks the
  // collection there. `renderOverview` is synchronous, so the button exists
  // by the time it is focused.
  closeNodeMenu();
  if (!node) return;
  if (
    overviewAddButton?.key !== node.key ||
    !overviewAddButton.button.isConnected
  ) {
    renderOverview(node);
  }
  overviewAddButton?.button.focus();
});
nodeMenuSimilar.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (!node) return;
  void Promise.resolve(loadInlineSimilarResults([node])).catch(
    (error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  );
});
nodeMenuUpdate.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (node) void updatePaperConnections(node);
});
```

If `selectPaper`'s parameter type does not accept the `number` from `localItemFor(node)?.id`, check its signature (search `selectPaper = ` or `function selectPaper`) and match the pane's call, `selectPaper(localItem.id)`.

- [ ] **Step 5: The rule and the disabled entry in CSS**

In `addon/content/graph.css`, add `.cm-node-menu-separator[hidden],` to the `[hidden]` list, right after `.cm-node-menu-item[hidden],`.

After the `.cm-node-menu-item:hover, .cm-node-menu-item:focus-visible { … }` rule, add:

```css
.cm-node-menu-item:disabled {
  opacity: 0.5;
}
/* The rule between the paper's actions and the seed entries (F5). */
.cm-node-menu-separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--cm-border);
}
```

- [ ] **Step 6: The visual suite's menu walk**

In `test/zotero/graphViewVisual.test.ts`, the harness's papers are library papers, so both menus gain Show in Zotero and Find similar papers.

Replace the comment block and assertion ending in `expect(shown()).to.deep.equal(["Remove seed"]);` — the comment that begins `// The node the menu opened on is a seed, so the toggle removes it and` — with:

```ts
// The node the menu opened on is a seed, so the toggle removes it and
// Remove from graph stays out: no rule can hide a seed. The first paper
// has nothing to open, so that entry stays out of the menu too, rather
// than sitting there dead. Show in Zotero and Find similar papers are
// the pane's actions (F5). A non-seed node's menu — Add as seed and
// Remove from graph — is walked in `graphScopeRail.test.ts`, on a graph
// whose nodes are real Zotero items.
expect(shown()).to.deep.equal([
  "Show in Zotero",
  "Find similar papers",
  "Remove seed",
]);
```

Replace:

```ts
expect(shown()).to.deep.equal(["Open online", "Remove seed"]);
```

with:

```ts
expect(shown()).to.deep.equal([
  "Open online",
  "Show in Zotero",
  "Find similar papers",
  "Remove seed",
]);
```

Replace the message `"the arrows wrap around both",` with `"the arrows wrap around",` (ArrowUp from the first entry still lands on the last, "Remove seed").

- [ ] **Step 7: Gate and commit**

Run: `npm run check` (expected exit 0). Then:

```bash
git add src/services/graphViewService.ts addon/content/graph.css test/zotero/graphViewVisual.test.ts
git commit -m "The node menu offers what Paper details offers: Show in Zotero or Add to Zotero…, Find similar papers, and the update (F5)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```

---

### Task 4: The external paper's menu in Zotero, the manual check, and the suite

**Files:**

- Create: `test/zotero/nodeMenuExternal.test.ts`
- Modify: `docs/superpowers/handoffs/roadmap.md` (append to "Manual verification", after the D16 check; locate by content)

**Interfaces:**

- Consumes: everything from Tasks 1–3, through the plugin's own UI only. The Zotero test bundle is a second copy of the plugin: drive it through its menus and buttons, never import the view.

- [ ] **Step 1: Write the case**

Create `test/zotero/nodeMenuExternal.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createSavedGraph,
  deleteSavedGraph,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const ROW_ATTR = "data-meristema-saved-graph";
const GRAPH_NAME = "F5 external menu";
const TITLE = "F5 external menu fixture";
const UPDATE = "Update this paper's connections";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

function customMenu(popup: Element, l10nID: string): any {
  const menu = Array.from(popup.children).find(
    (child) => (child as HTMLElement).dataset?.l10nId === l10nID,
  );
  expect(menu, `menu ${l10nID}`).to.exist;
  return menu;
}

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

/**
 * F5: an external paper's right-click menu offers what Paper details offers
 * for it, and the update it starts is the pane's. A saved graph carrying one
 * external seed is opened from Tools › Meristema › Load; opening it selects
 * the seed, so the pane shows the paper and the ContextMenu key opens the
 * menu on it.
 */
describe("The node menu on an external paper (F5)", function () {
  let win: any;
  let tabID: string | null = null;
  let graphID: number | null = null;
  let fixtureID: number | null = null;

  before(async function () {
    this.timeout(30_000);
    win = Zotero.getMainWindows()[0];
    // A graph opens on a library; give it a paper to stand on.
    const fixture = new Zotero.Item("journalArticle");
    fixture.setField("title", "F5 library fixture");
    fixtureID = await fixture.saveTx();
    const work = {
      provider: "openalex" as const,
      providerWorkID: "W-f5-fixture",
      doi: "10.1000/f5.fixture",
      title: TITLE,
      year: 2022,
      authors: ["Ada Lovelace"],
    };
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      GRAPH_NAME,
      {
        ...emptyGraphViewState(),
        seeds: [
          { kind: "external", identityKey: "openalex:W-f5-fixture", work },
        ],
      },
    );
    graphID = summary.id;
  });

  after(async function () {
    this.timeout(90_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (graphID !== null) await deleteSavedGraph(graphID);
    if (fixtureID !== null) await Zotero.Items.erase(fixtureID);
  });

  it("offers the pane's actions, hands Add to Zotero… to the pane, and shares the update", async function () {
    this.timeout(120_000);
    const doc = win.document as Document;
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    const open = customMenu(
      tools.menupopup,
      `${config.addonRef}-load-saved-graph-submenu`,
    );
    showing = shown(open.menupopup);
    open.openMenu(true);
    await showing;
    const row = await waitFor(
      () =>
        Array.from(open.menupopup.children).find(
          (child: any) =>
            child.hasAttribute(ROW_ATTR) &&
            child.getAttribute("label") === GRAPH_NAME,
        ),
      3_000,
    );
    expect(row, "the saved graph's row").to.exist;
    command(row as Element);
    (toolsPopup as any).hidePopup();

    const tab = await waitFor(
      () =>
        (win.Zotero_Tabs._tabs as any[]).find(
          (t) => t.type === config.addonRef && t.title === GRAPH_NAME,
        ),
      20_000,
    );
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;
    const root = (await waitFor(
      () => doc.querySelector(".meristema-root"),
      20_000,
    )) as HTMLElement | null;
    expect(root, "the graph view mounted").to.exist;

    const paneButton = (label: string): HTMLButtonElement | null =>
      (
        Array.from(
          root!.querySelectorAll(".cm-detail-body .cm-detail-actions button"),
        ) as HTMLButtonElement[]
      ).find((button) => button.textContent?.trim() === label) ?? null;
    const paneUpdate = await waitFor(() => paneButton(UPDATE), 20_000);
    expect(paneUpdate, "the pane shows the seed, with the update").to.exist;
    expect(paneUpdate!.title).to.equal(
      "Fetch this paper's references and citing papers again.",
    );

    const menu = root!.querySelector(".cm-node-menu") as HTMLElement;
    const canvas = root!.querySelector("canvas") as HTMLCanvasElement;
    const openMenu = (): void => {
      canvas.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      );
    };
    const entries = (): HTMLButtonElement[] =>
      (
        Array.from(
          menu.querySelectorAll('[role="menuitem"]'),
        ) as HTMLButtonElement[]
      ).filter((item) => !item.hidden);
    const entry = (label: string): HTMLButtonElement => {
      const found = entries().find(
        (item) => item.textContent?.trim() === label,
      );
      expect(
        found,
        `menu entry ${label}; menu [${entries()
          .map((item) => item.textContent)
          .join(", ")}]`,
      ).to.exist;
      return found!;
    };

    openMenu();
    expect(menu.hidden, "the ContextMenu key opens the menu").to.equal(false);
    // A seed, so Remove from graph stays out; not in Zotero, so Add, not Show.
    expect(entries().map((item) => item.textContent?.trim())).to.deep.equal([
      "Open online",
      "Add to Zotero…",
      "Find similar papers",
      UPDATE,
      "Remove seed",
    ]);
    const rule = menu.querySelector('[role="separator"]') as HTMLElement;
    expect(rule, "the menu has a rule").to.exist;
    expect(rule.hidden, "and shows it").to.equal(false);
    expect(
      rule.previousElementSibling?.textContent?.trim(),
      "the rule sits under the paper's actions",
    ).to.equal(UPDATE);
    expect(
      rule.nextElementSibling?.textContent?.trim(),
      "and over the seed entries",
    ).to.equal("Remove seed");

    // Add to Zotero… imports nothing: it hands the reader to the pane.
    entry("Add to Zotero…").click();
    expect(menu.hidden, "the entry closes the menu").to.equal(true);
    const paneAdd = paneButton("Add to Zotero");
    expect(paneAdd, "the pane offers Add to Zotero").to.exist;
    expect(
      doc.activeElement === paneAdd,
      `focus lands on the pane's Add to Zotero; it is on ${
        (doc.activeElement as HTMLElement | null)?.outerHTML?.slice(0, 120) ??
        "nothing"
      }`,
    ).to.equal(true);

    // The menu's update is the pane's: starting it disables the pane button,
    // and the menu, reopened on the same paper, shows its entry disabled.
    openMenu();
    entry(UPDATE).click();
    expect(
      paneButton(UPDATE)?.disabled,
      "the pane's button is disabled while the update runs",
    ).to.equal(true);
    openMenu();
    const menuUpdate = (
      Array.from(
        menu.querySelectorAll('[role="menuitem"]'),
      ) as HTMLButtonElement[]
    ).find((item) => item.textContent?.trim() === UPDATE);
    expect(menuUpdate?.hidden, "the reopened menu lists the update").to.equal(
      false,
    );
    expect(menuUpdate?.disabled, "and shows it disabled").to.equal(true);
    menu.dispatchEvent(
      new win.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );

    // Whether the providers answer or fail, the update ends and the pane's
    // button comes back.
    const freed = await waitFor(() => {
      const live = paneButton(UPDATE);
      return live && !live.disabled ? live : null;
    }, 90_000);
    expect(freed, "the pane's button is enabled once the update ends").to.exist;
  });
});
```

- [ ] **Step 2: Lint the new file before spending a suite run**

Run: `npx prettier --write test/zotero/nodeMenuExternal.test.ts` then `npm run check`.
Expected: exit 0.

- [ ] **Step 3: The manual check**

In `docs/superpowers/handoffs/roadmap.md`, under "## Manual verification", right after the item that begins `- [ ] D16: save a view, then open View → Choose a view…`, add:

```markdown
- [ ] F5: right-click a library paper: Open PDF (when it has one), Show in
      Zotero, Find similar papers, a rule, the seed toggle, Remove from graph
      (not for a seed). Right-click an external paper: Open online, Add to
      Zotero… (or Show in Zotero once it is in the library), Find similar
      papers, Update this paper's connections, a rule, the seed toggle.
      Add to Zotero… lands on the pane's Add to Zotero button and adds
      nothing by itself. While an update runs, the pane's button and the
      menu entry are both disabled. The toolbar reads "Refresh visible"
      with no seeds and "Refresh seeds" with seeds. Narrow the window until
      the graph is about 320px wide and note where the toolbar starts to
      squeeze (for D23). In both themes.
```

Run: `npx prettier --check docs/superpowers/handoffs/roadmap.md` (expected: clean; if not, `--write` and re-read so no inline code span splits).

- [ ] **Step 4: Commit**

```bash
git add test/zotero/nodeMenuExternal.test.ts docs/superpowers/handoffs/roadmap.md
git commit -m "An external paper's menu is checked in Zotero, and F5 joins the manual checks" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```

- [ ] **Step 5: The full Zotero suite**

This is the controller's step, not the implementer's: the full `npm test` is due (D16's three code commits plus F5's). Run `npm test` once, wait for its task to end before anything else, and read the summary. Expected: everything passes, with the new F5 case, the visual suite's menu walk and the hop suite's Refresh cases among them. A failure in the new case's focus assertion alone means the main window was not focused: rerun that case with `describe.only` once before changing anything.
