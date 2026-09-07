# Seed Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Add Node button and let the user add a seed from the Seeds popover, the detail pane, and a right-click on a node.

**Architecture:** Two new pure modules carry the decisions (`seedPopoverRows.ts` decides what the Seeds popover lists; `nodeMenu.ts` decides where the node menu sits and which keys open it) and are unit-tested under Node. `graphViewService.ts` wires them to the DOM through the existing `addFocusSeed`, `removeFocusSeed` and `focusOnPaper` closures. `citationGraphRenderer.ts` gains one callback for a right-click or menu key on a node.

**Tech Stack:** TypeScript, hand-built DOM in a Zotero 7 chrome window, Node's test runner with chai for unit tests (`node --import ./test/nodeResolve.mjs --test <file>`), `test/zotero/*` runs only inside Zotero and is never run here.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-seed-entry-points-design.md`.
- Gate: `npm run check` green at the end of every task. Never run `npm test`. Never start or stop Zotero.
- Adding the first seed to a seedless graph enters Explore with that paper, as "Explore from this paper" does; removing the last seed by any path returns the tab to the library graph.
- The Seeds button is enabled in every state. Only the Explore button stays disabled while the graph is seedless.
- Seeds popover copy: placeholder "Search seeds or library"; aria-label "Search seeds and the Zotero library"; seedless empty-query placeholder "No seeds yet. Search the library to add one."
- With a query, the popover lists matching library papers only; seeds that do not match are not shown. A seed row shows ×; any other row shows +.
- Adding or removing a seed from the popover keeps the popover open, keeps the query, keeps the results' scroll position and leaves focus in the search box.
- Library search reuses the existing `searchLibraryPapers`, `LIBRARY_SEARCH_DEBOUNCE_MS`, `scoreLibraryPaperSearch`, the cooperative loop and the 50-result cap unchanged.
- Detail pane: "Add as seed" whenever the selected paper is not a seed, "Remove seed" when it is, directly after "Find similar papers" in both branches. "Explore from this paper" stays.
- Node menu: items "Add as seed" / "Remove seed" and "Explore from this paper"; `role="menu"`, items `role="menuitem"`; focus on first item when opened; ArrowDown/ArrowUp wrap; closes on Escape, pointer down outside, wheel on the canvas, window resize, selection change; closing returns focus to the canvas; clamped on all four edges of the graph area; positioned through `getBoundingClientRect()`.
- Shift+F10 and the ContextMenu key with a node selected open the same menu at the node's screen position. Right-click on the background does nothing and keeps the browser default.
- Commit messages: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa`. Run prettier on any `docs/` or `README.md` file before committing it.

---

## File Structure

- Create `src/services/seedPopoverRows.ts`: pure. Given the query, the seeds and the library search state, returns either rows (paper + `isSeed`) or a placeholder message. Also the two id helpers that let a seed node and a library paper be compared.
- Create `src/services/nodeMenu.ts`: pure. `clampMenuPosition` keeps the menu inside the graph area on all four edges; `isContextMenuKey` recognises Shift+F10 and ContextMenu.
- Create `test/unit/seedPopoverRows.test.ts`, `test/unit/nodeMenu.test.ts`.
- Modify `src/services/graphViewService.ts`: remove Add Node; the Seeds popover searches the library and adds; the detail pane toggles a seed; the node menu.
- Modify `src/services/citationGraphRenderer.ts`: `onNodeContextMenu`, `contextmenu` listener, keyboard trigger, `nodeClientPosition`.
- Modify `addon/content/graph.css`: drop `.cm-add-node-*`; add `.cm-focus-seed-result-add` and `.cm-node-menu`.
- Modify `test/zotero/graphViewVisual.test.ts`: Seeds enabled and Explore disabled while seedless; no Add Node.
- Modify `README.md`: the Explore bullet names the three ways to add a seed.

---

### Task 1: Pure helpers for the popover rows and the node menu

**Files:**

- Create: `src/services/seedPopoverRows.ts`
- Create: `src/services/nodeMenu.ts`
- Test: `test/unit/seedPopoverRows.test.ts`
- Test: `test/unit/nodeMenu.test.ts`

**Interfaces:**

- Consumes: nothing from the codebase.
- Produces:
  - `SeedPopoverPaper { id: string; title: string; authors: readonly string[]; year: number | null; sourceTitle: string | null }`
  - `SeedPopoverRow { paper: SeedPopoverPaper; isSeed: boolean }`
  - `LibrarySearchState = { status: "idle" } | { status: "searching" } | { status: "failed" } | { status: "done"; papers: readonly SeedPopoverPaper[] }`
  - `SeedPopoverList = { kind: "rows"; rows: SeedPopoverRow[] } | { kind: "placeholder"; message: string }`
  - `seedPopoverList(input: { query: string; seeds: readonly SeedPopoverPaper[]; library: LibrarySearchState }): SeedPopoverList`
  - `libraryPaperID(itemID: number): string` → `"item:<itemID>"`
  - `seedPaperID(node: { key: string; itemID: number }): string` → `libraryPaperID(itemID)` when `itemID > 0`, else `node.key`
  - Message constants `NO_SEEDS_MESSAGE`, `SEARCHING_MESSAGE`, `SEARCH_FAILED_MESSAGE`, `NO_MATCHES_MESSAGE`
  - `clampMenuPosition(input: { x: number; y: number; menuWidth: number; menuHeight: number; paneWidth: number; paneHeight: number }): { left: number; top: number }`
  - `isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean`

- [ ] **Step 1: Write the failing tests**

`test/unit/seedPopoverRows.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  NO_MATCHES_MESSAGE,
  NO_SEEDS_MESSAGE,
  SEARCHING_MESSAGE,
  SEARCH_FAILED_MESSAGE,
  libraryPaperID,
  seedPaperID,
  seedPopoverList,
  type SeedPopoverPaper,
} from "../../src/services/seedPopoverRows";

const paper = (id: string, title: string): SeedPopoverPaper => ({
  id,
  title,
  authors: ["Doe"],
  year: 2020,
  sourceTitle: null,
});

describe("seedPopoverList", function () {
  it("lists the seeds, all marked as seeds, when the query is empty", function () {
    const list = seedPopoverList({
      query: "",
      seeds: [paper("item:1", "A"), paper("item:2", "B")],
      library: { status: "idle" },
    });
    expect(list).to.deep.equal({
      kind: "rows",
      rows: [
        { paper: paper("item:1", "A"), isSeed: true },
        { paper: paper("item:2", "B"), isSeed: true },
      ],
    });
  });

  it("treats a whitespace query as empty", function () {
    const list = seedPopoverList({
      query: "   ",
      seeds: [paper("item:1", "A")],
      library: { status: "done", papers: [paper("item:9", "Z")] },
    });
    expect(list.kind).to.equal("rows");
    expect(list.kind === "rows" && list.rows[0].paper.id).to.equal("item:1");
  });

  it("shows the no-seeds placeholder for an empty query on a seedless graph", function () {
    const list = seedPopoverList({
      query: "",
      seeds: [],
      library: { status: "idle" },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: NO_SEEDS_MESSAGE,
    });
  });

  it("shows the searching placeholder while a query has no results yet", function () {
    for (const library of [
      { status: "idle" },
      { status: "searching" },
    ] as const) {
      const list = seedPopoverList({ query: "a", seeds: [], library });
      expect(list).to.deep.equal({
        kind: "placeholder",
        message: SEARCHING_MESSAGE,
      });
    }
  });

  it("shows the failed placeholder when the search failed", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [],
      library: { status: "failed" },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: SEARCH_FAILED_MESSAGE,
    });
  });

  it("shows the no-matches placeholder when the search returned nothing", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [paper("item:1", "A")],
      library: { status: "done", papers: [] },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: NO_MATCHES_MESSAGE,
    });
  });

  it("lists library matches only, marking the ones that are seeds", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [paper("item:1", "A"), paper("item:3", "C")],
      library: {
        status: "done",
        papers: [paper("item:1", "A"), paper("item:2", "B")],
      },
    });
    expect(list).to.deep.equal({
      kind: "rows",
      rows: [
        { paper: paper("item:1", "A"), isSeed: true },
        { paper: paper("item:2", "B"), isSeed: false },
      ],
    });
  });
});

describe("seed ids", function () {
  it("names a library paper by its item id", function () {
    expect(libraryPaperID(42)).to.equal("item:42");
  });

  it("gives a library seed the same id as the library paper", function () {
    expect(seedPaperID({ key: "node-42", itemID: 42 })).to.equal("item:42");
  });

  it("keeps an external seed's key as its id", function () {
    expect(seedPaperID({ key: "doi:10.1/x", itemID: 0 })).to.equal(
      "doi:10.1/x",
    );
    expect(seedPaperID({ key: "doi:10.1/y", itemID: -1 })).to.equal(
      "doi:10.1/y",
    );
  });
});
```

`test/unit/nodeMenu.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  clampMenuPosition,
  isContextMenuKey,
} from "../../src/services/nodeMenu";

describe("clampMenuPosition", function () {
  const pane = {
    paneWidth: 800,
    paneHeight: 600,
    menuWidth: 200,
    menuHeight: 80,
  };

  it("keeps the pointer position when the menu fits", function () {
    expect(clampMenuPosition({ x: 100, y: 100, ...pane })).to.deep.equal({
      left: 100,
      top: 100,
    });
  });

  it("pulls the menu back from the right and bottom edges", function () {
    expect(clampMenuPosition({ x: 700, y: 580, ...pane })).to.deep.equal({
      left: 600,
      top: 520,
    });
  });

  it("never goes past the left or top edges", function () {
    expect(clampMenuPosition({ x: -30, y: -10, ...pane })).to.deep.equal({
      left: 0,
      top: 0,
    });
  });

  it("prefers the top-left corner when the menu is larger than the pane", function () {
    expect(
      clampMenuPosition({
        x: 50,
        y: 50,
        paneWidth: 100,
        paneHeight: 50,
        menuWidth: 200,
        menuHeight: 80,
      }),
    ).to.deep.equal({ left: 0, top: 0 });
  });
});

describe("isContextMenuKey", function () {
  it("is true for Shift+F10 and the ContextMenu key", function () {
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).to.equal(true);
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).to.equal(
      true,
    );
  });

  it("is false for F10 alone and for other keys", function () {
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).to.equal(false);
    expect(isContextMenuKey({ key: "Enter", shiftKey: true })).to.equal(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/seedPopoverRows.test.ts test/unit/nodeMenu.test.ts`
Expected: both files fail to load with "Cannot find module" for the two new modules.

- [ ] **Step 3: Write the implementation**

`src/services/seedPopoverRows.ts`:

```ts
/**
 * What the Seeds popover lists. Pure, so the three states the popover can be
 * in — the seeds themselves, a library search in flight, a library search
 * done — are decided in one place and tested without a DOM.
 */
export interface SeedPopoverPaper {
  /** `libraryPaperID` for a library paper, the node key for an external one. */
  id: string;
  title: string;
  authors: readonly string[];
  year: number | null;
  sourceTitle: string | null;
}

export interface SeedPopoverRow {
  paper: SeedPopoverPaper;
  isSeed: boolean;
}

export type LibrarySearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed" }
  | { status: "done"; papers: readonly SeedPopoverPaper[] };

export type SeedPopoverList =
  | { kind: "rows"; rows: SeedPopoverRow[] }
  | { kind: "placeholder"; message: string };

export const NO_SEEDS_MESSAGE = "No seeds yet. Search the library to add one.";
export const SEARCHING_MESSAGE = "Searching library…";
export const SEARCH_FAILED_MESSAGE = "Library search failed.";
export const NO_MATCHES_MESSAGE = "No matching papers found.";

export function libraryPaperID(itemID: number): string {
  return `item:${itemID}`;
}

/**
 * A seed that is a library paper gets the library paper's id, so a library
 * search result can be recognised as a seed by id alone. An external seed has
 * no item and keeps its node key.
 */
export function seedPaperID(node: { key: string; itemID: number }): string {
  return node.itemID > 0 ? libraryPaperID(node.itemID) : node.key;
}

export function seedPopoverList(input: {
  query: string;
  seeds: readonly SeedPopoverPaper[];
  library: LibrarySearchState;
}): SeedPopoverList {
  if (!input.query.trim()) {
    if (!input.seeds.length) {
      return { kind: "placeholder", message: NO_SEEDS_MESSAGE };
    }
    return {
      kind: "rows",
      rows: input.seeds.map((paper) => ({ paper, isSeed: true })),
    };
  }
  const { library } = input;
  if (library.status === "idle" || library.status === "searching") {
    return { kind: "placeholder", message: SEARCHING_MESSAGE };
  }
  if (library.status === "failed") {
    return { kind: "placeholder", message: SEARCH_FAILED_MESSAGE };
  }
  if (!library.papers.length) {
    return { kind: "placeholder", message: NO_MATCHES_MESSAGE };
  }
  const seedIDs = new Set(input.seeds.map((seed) => seed.id));
  return {
    kind: "rows",
    rows: library.papers.map((paper) => ({
      paper,
      isSeed: seedIDs.has(paper.id),
    })),
  };
}
```

`src/services/nodeMenu.ts`:

```ts
/**
 * Where a node's right-click menu sits inside the graph area, and which keys
 * open it. Pure, so the clamping can be tested without a DOM.
 */
export interface MenuPlacementInput {
  /** Pointer position relative to the pane's top-left corner. */
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  paneWidth: number;
  paneHeight: number;
}

/**
 * The menu's top-left corner, kept inside the pane on all four edges. A menu
 * larger than the pane pins to the top-left so its first items stay reachable.
 */
export function clampMenuPosition(input: MenuPlacementInput): {
  left: number;
  top: number;
} {
  const maxLeft = Math.max(0, input.paneWidth - input.menuWidth);
  const maxTop = Math.max(0, input.paneHeight - input.menuHeight);
  return {
    left: Math.min(Math.max(0, input.x), maxLeft),
    top: Math.min(Math.max(0, input.y), maxTop),
  };
}

/** Shift+F10 and the dedicated ContextMenu key: the two keyboard ways to ask for a context menu. */
export function isContextMenuKey(event: {
  key: string;
  shiftKey: boolean;
}): boolean {
  return (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/seedPopoverRows.test.ts test/unit/nodeMenu.test.ts`
Expected: 16 passing, 0 failing.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: lint, typecheck and the unit suite all green.

```bash
git add src/services/seedPopoverRows.ts src/services/nodeMenu.ts test/unit/seedPopoverRows.test.ts test/unit/nodeMenu.test.ts
git commit -m "Decide the Seeds popover rows and the node menu placement in pure helpers"
```

(With the two trailers from Global Constraints.)

---

### Task 2: The Seeds popover searches the library and adds seeds; Add Node goes

**Files:**

- Modify: `src/services/graphViewService.ts` (Add Node construction ~407–459 and its `addNodeWrap` in the toolbar append ~673; `setSeeded` ~683; the Add Node state and handlers ~984–1249; the Seeds popover ~565–584, ~1452–1560, ~1589–1600; `addMapItemsRespectingFilters` ~3465 and `addLibraryItemsToView` ~3521; cleanup ~3667–3672)
- Modify: `addon/content/graph.css` (remove `.cm-add-node-*` ~268–390 and the two `.cm-add-node-popup` selectors at ~422 and ~772; add `.cm-focus-seed-result-add`)
- Modify: `test/zotero/graphViewVisual.test.ts` (view 5)
- Modify: `docs/superpowers/specs/2026-09-07-seed-entry-points-design.md`

**Interfaces:**

- Consumes: everything from Task 1.
- Produces: nothing new for later tasks. `libraryNodeForItem`, `addFocusSeed`, `removeFocusSeed`, `focusOnPaper` stay as they are.

- [ ] **Step 1: Add the visual assertion (runs only in Zotero; it documents the requirement)**

In `test/zotero/graphViewVisual.test.ts`, inside "view 5", after the `for (const gone of [...])` loop, add:

```ts
// A seedless graph has no seeds to show, but the Seeds button is how the
// first one is added, so it stays live. Explore has nothing to set yet.
const seeds = active.root.querySelector(
  'button[aria-controls="meristema-focus-seed-popover"]',
) as HTMLButtonElement;
const explore = active.root.querySelector(
  'button[aria-controls="meristema-focus-settings-popover"]',
) as HTMLButtonElement;
expect(seeds, "there is a Seeds button").to.not.equal(null);
expect(seeds.disabled, "and it is enabled while seedless").to.equal(false);
expect(explore.disabled, "while Explore waits for a seed").to.equal(true);
expect(
  active.root.querySelector(".cm-add-node-wrap"),
  "Add Node is gone",
).to.equal(null);
```

- [ ] **Step 2: Remove Add Node from `graphViewService.ts`**

Delete, in this order:

1. The block from `const addNodeWrap = element(document, "div", "cm-add-node-wrap");` through `addNodeWrap.append(addNodeButton, addNodePopup);` (~407–459).
2. `addNodeWrap,` from the `toolbar.append(` call (~673).
3. `let addLibraryItemsToView = (_itemIDs: readonly number[]): GraphFocusResult => "not-found";` and `const selectedLibraryItemIDs = new Set<number>();` (~984–987). Keep `libraryPaperByID`, `librarySearchGeneration` and `librarySearchTimer`.
4. `closeAddNodePopup` and `renderSelectedLibraryPapers` (~993–1030). Keep `searchLibraryPapers`.
5. Everything from `addNodeButton.addEventListener("click", () => {` through `renderSelectedLibraryPapers();` just before `const updateEmptyState` (~1179–1250).
6. `const addMapItemsRespectingFilters = (...)` (~3465–3467) and the `addLibraryItemsToView = (itemIDs) => ...` assignment (~3521–3524).
7. In `cleanup`, the two `document.removeEventListener` calls for `closeAddNodePopupOnOutsidePointer` and `closeAddNodePopupOnEscape`.

Then replace the whole `async function renderLibrarySearchResults(): Promise<void> { ... }` (~1080–1178) with a DOM-free ranker:

```ts
/**
 * The library papers that match `query`, best first, capped at fifty. Null
 * when the search failed. Resolves early and empty when a newer search has
 * started, so a stale result is never rendered over a fresh one.
 */
async function rankLibraryPapers(
  query: string,
  generation: number,
): Promise<ZoteroPaper[] | null> {
  const index = await searchLibraryPapers(query).catch((error) => {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    return null;
  });
  if (generation !== librarySearchGeneration) return [];
  if (!index) return null;
  const matches: Array<{
    entry: LibraryPaperSearchEntry;
    score: number;
  }> = [];
  const compareMatches = (
    left: { entry: LibraryPaperSearchEntry; score: number },
    right: { entry: LibraryPaperSearchEntry; score: number },
  ): number =>
    right.score - left.score ||
    left.entry.paper.title.localeCompare(right.entry.paper.title, undefined, {
      sensitivity: "base",
    });
  await mapCooperatively(
    index,
    (entry) => {
      if (generation !== librarySearchGeneration) return;
      const score = scoreLibraryPaperSearch(entry, query);
      const candidate = { entry, score };
      const insertion = matches.findIndex(
        (current) => compareMatches(candidate, current) < 0,
      );
      if (insertion < 0) matches.push(candidate);
      else matches.splice(insertion, 0, candidate);
      if (matches.length > 50) matches.pop();
    },
    { forceEvery: 100 },
  );
  return matches.map(({ entry }) => entry.paper);
}
```

- [ ] **Step 3: The Seeds button stays enabled; its copy changes**

In `setSeeded`, delete the line `focusSeedButton.disabled = !seeded;` and change the comment above the function to:

```ts
// The Seeds and Explore buttons stay in the toolbar on every path so the
// view keeps one shape. Seeds is how the first seed is added, so it is
// always live; Explore has nothing to set until there is one, so it is
// disabled rather than hidden.
```

In the popover construction (~576–579) change the two strings:

```ts
focusSeedSearch.placeholder = "Search seeds or library";
focusSeedSearch.setAttribute(
  "aria-label",
  "Search seeds and the Zotero library",
);
```

In `updateFocusBar`, in the `if (!focusProjection)` branch, replace `closeFocusSeedPopover();` with nothing (the popover may stay open on a seedless graph) and set:

```ts
focusSeedButtonLabel.textContent = "0 seeds";
focusSeedButton.title = "Add seeds from the library.";
```

Also at `focusSeedButton.title = "Papers this graph was built from.";` in the construction block (~561) use the same string `"Add seeds from the library."`.

- [ ] **Step 4: Rewrite the popover's rendering and search**

Add to the imports at the top of the file:

```ts
import {
  libraryPaperID,
  seedPaperID,
  seedPopoverList,
  type LibrarySearchState,
  type SeedPopoverPaper,
} from "./seedPopoverRows";
```

Directly above `const closeFocusSeedPopover = (restoreFocus = false): void => {` (~1454) add the forward declaration that the render needs before `libraryNodeForItem` exists:

```ts
// Assigned once libraryNodeForItem exists (below); a library search row
// needs the node for a paper so it can be seeded or selected.
let libraryNodeForSeedRow = (_itemID: number): CitationGraphNode | null => null;
let libraryState: LibrarySearchState = { status: "idle" };
/** The library paper behind each listed row, by `libraryPaperID`. */
const libraryPaperBySeedRowID = new Map<string, ZoteroPaper>();
/** The seed node behind each listed seed row, by `seedPaperID`. */
const seedNodeBySeedRowID = new Map<string, CitationGraphNode>();
```

Replace the body of `closeFocusSeedPopover` so it also resets the search:

```ts
const closeFocusSeedPopover = (restoreFocus = false): void => {
  focusSeedPopover.hidden = true;
  focusSeedButton.setAttribute("aria-expanded", "false");
  focusSeedSearch.value = "";
  librarySearchGeneration += 1;
  libraryState = { status: "idle" };
  clear(focusSeedResults);
  if (restoreFocus) focusSeedButton.focus();
};
```

(Keep any line the existing body has that is not listed here, such as a `focusSeedResults` reset, if present.)

Replace the whole `const renderFocusSeedResults = (): void => { ... };` with:

```ts
const seedPopoverPaperForNode = (
  node: CitationGraphNode,
): SeedPopoverPaper => ({
  id: seedPaperID(node),
  title: node.title || "Untitled paper",
  authors: node.authors,
  year: node.year,
  sourceTitle: node.sourceTitle,
});
const seedPopoverPaperForLibrary = (paper: ZoteroPaper): SeedPopoverPaper => ({
  id: libraryPaperID(paper.itemID),
  title: paper.title || "Untitled item",
  authors: paper.authors,
  year: paper.year,
  sourceTitle: paper.sourceTitle,
});

const renderFocusSeedResults = (): void => {
  // Adding or removing a seed re-renders the list; the reader's place in
  // it and the box they are typing in both survive.
  const scrollTop = focusSeedResults.scrollTop;
  clear(focusSeedResults);
  seedNodeBySeedRowID.clear();
  const seeds = focusProjection?.seeds ?? [];
  for (const seed of seeds) seedNodeBySeedRowID.set(seedPaperID(seed), seed);
  const list = seedPopoverList({
    query: focusSeedSearch.value,
    seeds: seeds.map(seedPopoverPaperForNode),
    library: libraryState,
  });
  if (list.kind === "placeholder") {
    focusSeedResults.appendChild(
      text(document, "p", list.message, "cm-placeholder"),
    );
    return;
  }
  for (const { paper, isSeed } of list.rows) {
    const row = element(document, "div", "cm-focus-seed-result");
    row.setAttribute("role", "listitem");
    const select = element(document, "button", "cm-focus-seed-result-main");
    select.type = "button";
    select.title = `Select ${paper.title} in the graph`;
    const title = text(
      document,
      "span",
      paper.title,
      "cm-focus-seed-result-title",
    );
    const metadata = [
      paper.authors.slice(0, 2).join(", "),
      paper.year === null ? "" : String(paper.year),
      paper.sourceTitle ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    select.append(title);
    if (metadata) {
      select.append(
        text(document, "span", metadata, "cm-focus-seed-result-meta"),
      );
    }
    const nodeForRow = (): CitationGraphNode | null => {
      const seed = seedNodeBySeedRowID.get(paper.id);
      if (seed) return seed;
      const libraryPaper = libraryPaperBySeedRowID.get(paper.id);
      return libraryPaper ? libraryNodeForSeedRow(libraryPaper.itemID) : null;
    };
    select.addEventListener("click", () => {
      const node = nodeForRow();
      // selectNode is false when the paper is not in the graph; nothing to do then.
      if (node && renderer?.selectNode(node.key, false))
        closeFocusSeedPopover();
    });
    row.appendChild(select);
    const toggle = element(
      document,
      "button",
      isSeed ? "cm-focus-seed-result-remove" : "cm-focus-seed-result-add",
    );
    toggle.type = "button";
    toggle.textContent = isSeed ? "×" : "+";
    toggle.title = isSeed
      ? `Remove ${paper.title} from the seeds`
      : `Add ${paper.title} as a seed`;
    toggle.setAttribute("aria-label", toggle.title);
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const node = nodeForRow();
      if (!node) return;
      if (isSeed) removeFocusSeed(node.key);
      else addFocusSeed(node);
      // The projection change re-rendered the list; the box keeps the query
      // and the focus so the next seed is one keystroke away.
      focusSeedSearch.focus();
    });
    row.appendChild(toggle);
    focusSeedResults.appendChild(row);
  }
  focusSeedResults.scrollTop = scrollTop;
};
```

`addFocusSeed` is declared with `const` further down the function; like `removeFocusSeed` it is only called from event handlers that run after the whole function body has executed, so the reference is safe. If the linter's `no-use-before-define` objects, forward-declare it the way `removeFocusSeed` is: `let addFocusSeedFromPopover = (_node: CitationGraphNode): boolean => false;` here, assign `addFocusSeedFromPopover = addFocusSeed;` right after `addFocusSeed` is defined, and call that.

Replace `focusSeedSearch.addEventListener("input", renderFocusSeedResults);` (~1599) with the debounced library search:

```ts
const runLibrarySearch = (): void => {
  const query = focusSeedSearch.value.trim();
  librarySearchGeneration += 1;
  if (!query) {
    libraryState = { status: "idle" };
    libraryPaperBySeedRowID.clear();
    renderFocusSeedResults();
    return;
  }
  const generation = librarySearchGeneration;
  libraryState = { status: "searching" };
  renderFocusSeedResults();
  void rankLibraryPapers(query, generation).then((papers) => {
    if (generation !== librarySearchGeneration || focusSeedPopover.hidden) {
      return;
    }
    libraryPaperBySeedRowID.clear();
    if (papers) {
      for (const paper of papers) {
        libraryPaperBySeedRowID.set(libraryPaperID(paper.itemID), paper);
      }
    }
    libraryState = papers
      ? { status: "done", papers: papers.map(seedPopoverPaperForLibrary) }
      : { status: "failed" };
    renderFocusSeedResults();
  });
};
focusSeedSearch.addEventListener("input", () => {
  if (librarySearchTimer !== null) {
    if (document.defaultView) {
      document.defaultView.clearTimeout(librarySearchTimer);
    } else {
      clearTimeout(librarySearchTimer);
    }
    librarySearchTimer = null;
  }
  const run = (): void => {
    librarySearchTimer = null;
    runLibrarySearch();
  };
  librarySearchTimer = document.defaultView
    ? document.defaultView.setTimeout(run, LIBRARY_SEARCH_DEBOUNCE_MS)
    : (setTimeout(run, LIBRARY_SEARCH_DEBOUNCE_MS) as unknown as number);
});
```

Directly after the definition of `libraryNodeForItem` (~3380–3395) add:

```ts
libraryNodeForSeedRow = libraryNodeForItem;
```

Check `enterFocusSeeds` / `enterFocus` and `exitFocus` (the paths behind adding the first seed and removing the last): neither may call `closeFocusSeedPopover()` on its own, or the popover would shut after the first add. `updateFocusBar` no longer closes it on the seedless branch after Step 3. Removing the last seed calls `exitFocus`, and the popover then shows the seedless placeholder; that is the intended result.

- [ ] **Step 5: CSS**

In `addon/content/graph.css` delete every rule whose selector starts with `.cm-add-node` (the block ~268–390), remove `.cm-add-node-popup[hidden],` from the grouped `display: none` rule (~422) and `.cm-add-node-popup.cm-popover-end` from the grouped end-anchor rule (~772), and turn the remove-button rule into a shared one:

```css
.cm-focus-seed-result-remove,
.cm-focus-seed-result-add {
  align-self: center;
  flex: 0 0 auto;
  min-width: 28px !important;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  padding: 0 !important;
  justify-content: center;
  border-color: transparent !important;
  border-radius: 50% !important;
  background: transparent !important;
  font-size: 16px;
}
```

Also update the comment in `graphViewService.ts` around line 868 that names "the Add-node popup's" closer: it should read "like the Focus seed popover's above".

- [ ] **Step 6: Correct the spec**

In `docs/superpowers/specs/2026-09-07-seed-entry-points-design.md` replace the sentence

`` `addLibraryItemsToView` loses its seedless branch; `addMapItemsRespectingFilters` stays because the controller's `addMapItems` still uses it. ``

with

`` `addLibraryItemsToView` and `addMapItemsRespectingFilters` are removed; Add Node was their only caller. ``

Run `npx prettier --write docs/superpowers/specs/2026-09-07-seed-entry-points-design.md`.

- [ ] **Step 7: Run the gate**

Run: `npm run check`
Expected: green. If the typecheck reports `focusSeedResults` or `LibraryPaperSearchEntry` unused or missing, fix the import list rather than the logic.

- [ ] **Step 8: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css test/zotero/graphViewVisual.test.ts docs/superpowers/specs/2026-09-07-seed-entry-points-design.md
git commit -m "Add seeds from the Seeds popover and retire Add Node"
```

---

### Task 3: The detail pane toggles a seed in every state

**Files:**

- Modify: `src/services/graphViewService.ts` (external-work branch ~2826–2842; library branch ~2955–2965)

**Interfaces:**

- Consumes: `addFocusSeed(node): boolean`, `removeFocusSeed(key): void`, `renderOverview(node)`.

- [ ] **Step 1: Extract one builder for the toggle**

Just above `function renderOverview(` (or the `const renderOverview =` it is defined as; keep the existing form), add:

```ts
/**
 * "Add as seed" or "Remove seed" for the paper the detail pane shows. One
 * button in one slot, so the pane reads the same on a library paper and on
 * an external work, seeded graph or not.
 */
const seedToggleButton = (node: CitationGraphNode): HTMLButtonElement => {
  const isSeed = Boolean(focusProjection?.seedKeys.has(node.key));
  const toggle = element(document, "button", "cm-secondary-button");
  toggle.type = "button";
  toggle.textContent = isSeed ? "Remove seed" : "Add as seed";
  toggle.title = isSeed
    ? "Remove this paper from the seeds of this graph."
    : "Add this paper as a seed of this graph without changing Zotero.";
  toggle.addEventListener("click", () => {
    if (isSeed) {
      removeFocusSeed(node.key);
      renderOverview(node);
      return;
    }
    if (addFocusSeed(node)) renderOverview(node);
  });
  return toggle;
};
```

- [ ] **Step 2: Use it in both branches**

External-work branch: delete the `if (focusProjection && !focusProjection.seedKeys.has(node.key)) { ... }` block that sits between the `focus` button and the `similar` button, and after `actions.appendChild(similar);` in that branch add `actions.appendChild(seedToggleButton(node));`.

Library branch: replace the `if (focusProjection && !focusProjection.seedKeys.has(node.key)) { ... }` block after `actions.appendChild(similar);` with `actions.appendChild(seedToggleButton(node));`.

Update the long comment in the library branch that begins "One button." so its last sentence reads: "What is left is the action that fetches something the reader cannot reach by clicking what is already on screen, and the seed toggle, which is one of the three ways to add a seed."

- [ ] **Step 3: Run the gate and commit**

Run: `npm run check`
Expected: green.

```bash
git add src/services/graphViewService.ts
git commit -m "Offer Add as seed and Remove seed in the detail pane on every path"
```

---

### Task 4: The renderer reports a right-click or menu key on a node

**Files:**

- Modify: `src/services/citationGraphRenderer.ts` (options ~96–105; fields ~166–168; constructor ~223–226; `installEvents` ~401–411; `onKeyDown` ~671–677; public methods near `selectNode` ~1498; `destroy` ~1759–1790)

**Interfaces:**

- Consumes: `isContextMenuKey` from Task 1; `projectToScreen` and `devicePixelScale` already imported from `./graphViewport`.
- Produces:
  - `CitationGraphRendererOptions.onNodeContextMenu?: (node: CitationGraphNode, clientX: number, clientY: number) => void`
  - `CitationGraphRenderer.nodeClientPosition(key: string): { x: number; y: number } | null`

- [ ] **Step 1: The option and field**

In `CitationGraphRendererOptions` add after `onBackgroundInteraction?`:

```ts
  /**
   * A right-click, Shift+F10 or the ContextMenu key on a node, after the node
   * has been selected. Client coordinates, so the caller can place a menu
   * with `getBoundingClientRect()` on whatever pane it lives in.
   */
  onNodeContextMenu?: (
    node: CitationGraphNode,
    clientX: number,
    clientY: number,
  ) => void;
```

Add the field next to `onBackgroundInteraction`:

```ts
  private readonly onNodeContextMenu: (
    node: CitationGraphNode,
    clientX: number,
    clientY: number,
  ) => void;
```

In the constructor, after the `onBackgroundInteraction` assignment:

```ts
this.onNodeContextMenu = options.onNodeContextMenu ?? (() => undefined);
```

Add the import `import { isContextMenuKey } from "./nodeMenu";` with the other `./` imports.

- [ ] **Step 2: The listener, the key, the position**

In `installEvents` add `this.canvas.addEventListener("contextmenu", this.onContextMenu);` and in `destroy` add `this.canvas.removeEventListener("contextmenu", this.onContextMenu);`.

Add the handler next to `onDoubleClick`:

```ts
  private onContextMenu = (event: MouseEvent): void => {
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    // The background keeps the browser's own menu.
    if (!node) return;
    event.preventDefault();
    this.selectedKey = node.key;
    this.onSelectionChange(node);
    this.draw();
    this.onNodeContextMenu(node, event.clientX, event.clientY);
  };
```

Replace `onKeyDown` with:

```ts
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLocaleLowerCase() === "f") this.fitView();
    if (event.key === "Escape") {
      this.clearSelection();
      this.onBackgroundInteraction();
    }
    if (isContextMenuKey(event) && this.selectedKey !== null) {
      const node = this.model.nodes.find(
        (candidate) => candidate.key === this.selectedKey,
      );
      const position = this.nodeClientPosition(this.selectedKey);
      if (!node || !position) return;
      event.preventDefault();
      this.onNodeContextMenu(node, position.x, position.y);
    }
  };
```

Add the public method after `selectNode`:

```ts
  /**
   * Where a node is on screen, in client coordinates, or null when the node
   * has no position. The inverse of `screenToWorld`, for a menu that opens
   * from the keyboard and has no pointer to sit under.
   */
  public nodeClientPosition(key: string): { x: number; y: number } | null {
    const position = this.positions.get(key);
    if (!position) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = devicePixelScale(this.canvas.width, rect.width);
    const screen = this.projectToScreen(position);
    return { x: rect.left + screen.x / ratio, y: rect.top + screen.y / ratio };
  }
```

- [ ] **Step 3: Run the gate and commit**

Run: `npm run check`
Expected: green. There is no Node-side test for the renderer (it needs a canvas); the typecheck is the test here, and Task 5's Zotero test exercises it.

```bash
git add src/services/citationGraphRenderer.ts
git commit -m "Report a right-click or menu key on a node from the renderer"
```

---

### Task 5: The node menu in the graph view, and the README

**Files:**

- Modify: `src/services/graphViewService.ts` (graph area construction ~703–740; `handleGraphSelection` ~2967; renderer construction ~2973–2988; cleanup ~3665–3710)
- Modify: `addon/content/graph.css` (after the `.cm-export-menu button` rules ~703–725)
- Modify: `test/zotero/graphViewVisual.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `clampMenuPosition` (Task 1); `onNodeContextMenu` and `nodeClientPosition` (Task 4); `addFocusSeed`, `removeFocusSeed`, `focusOnPaper`, `closeFocusSeedPopover`, `closeFocusSettingsPopover`.

- [ ] **Step 1: A Zotero test for the menu (documents the requirement; runs only in Zotero)**

Append to `test/zotero/graphViewVisual.test.ts`, inside the top-level `describe`, after the last `it`:

```ts
it("view 12 — a right-click on a node opens the seed menu, on the background it does not", async function () {
  this.timeout(60_000);
  const active = await open(60);
  const view = active.window as any;
  const menu = active.root.querySelector(".cm-node-menu") as HTMLElement;
  expect(menu, "the menu exists").to.not.equal(null);
  expect(menu.hidden, "and starts hidden").to.equal(true);

  const rect = active.canvas.getBoundingClientRect();
  const background = new view.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + 2,
    clientY: rect.top + 2,
  });
  active.canvas.dispatchEvent(background);
  expect(menu.hidden, "the background leaves it hidden").to.equal(true);
  expect(background.defaultPrevented, "and keeps the browser menu").to.equal(
    false,
  );

  const controller = getGraphViewController(active.root)!;
  const first = active.model.nodes[0];
  controller.revealItem(first.itemID);
  await settle(active.window, 4);
  const pointerdown = active.root.querySelector("canvas")!;
  expect(pointerdown).to.equal(active.canvas);
  // Where the renderer put the first node: ask it, rather than guess.
  const position = (active as any).renderer?.nodeClientPosition?.(first.key);
  if (position) {
    const onNode = new view.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: position.x,
      clientY: position.y,
    });
    active.canvas.dispatchEvent(onNode);
    expect(menu.hidden, "a node opens it").to.equal(false);
    expect(onNode.defaultPrevented, "and takes the event").to.equal(true);
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(items).to.deep.equal(["Add as seed", "Explore from this paper"]);
    const escape = new view.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Escape",
    });
    menu.dispatchEvent(escape);
    expect(menu.hidden, "Escape closes it").to.equal(true);
  } else {
    note("view 12: the harness exposes no renderer; node half skipped");
  }
});
```

If `ViewStage` has no `model` or `renderer` field, use `stage`'s existing fields to reach the model (the harness's `makeCorpus` result is what `open` passed in; keep a reference to it in `open`) and skip the renderer half with the `note` as written. Do not add fields to the harness for this.

- [ ] **Step 2: The menu element and its handlers**

Add the import `import { clampMenuPosition } from "./nodeMenu";` with the other `./` imports.

After `graphArea.appendChild(emptyState);` (~740) add:

```ts
// The node's right-click menu. Two items: the seed toggle and Explore-from.
// It lives in the graph area so it is clamped to the plot, not the window.
const nodeMenu = element(document, "div", "cm-node-menu");
nodeMenu.hidden = true;
nodeMenu.setAttribute("role", "menu");
nodeMenu.setAttribute("aria-label", "Paper actions");
const nodeMenuSeed = element(document, "button", "cm-node-menu-item");
nodeMenuSeed.type = "button";
nodeMenuSeed.setAttribute("role", "menuitem");
const nodeMenuExplore = element(document, "button", "cm-node-menu-item");
nodeMenuExplore.type = "button";
nodeMenuExplore.setAttribute("role", "menuitem");
nodeMenuExplore.textContent = "Explore from this paper";
nodeMenu.append(nodeMenuSeed, nodeMenuExplore);
graphArea.appendChild(nodeMenu);
let nodeMenuTarget: CitationGraphNode | null = null;
```

Directly before `renderer = new CitationGraphRenderer({` (~2973) add:

```ts
const closeNodeMenu = (restoreFocus = false): void => {
  if (nodeMenu.hidden) return;
  nodeMenu.hidden = true;
  nodeMenuTarget = null;
  if (restoreFocus) canvas.focus();
};
const openNodeMenu = (
  node: CitationGraphNode,
  clientX: number,
  clientY: number,
): void => {
  closeFocusSeedPopover();
  closeFocusSettingsPopover();
  nodeMenuTarget = node;
  const isSeed = Boolean(focusProjection?.seedKeys.has(node.key));
  nodeMenuSeed.textContent = isSeed ? "Remove seed" : "Add as seed";
  nodeMenu.hidden = false;
  // Measured after it is shown, so offsetWidth is the laid-out width.
  const pane = graphArea.getBoundingClientRect();
  const { left, top } = clampMenuPosition({
    x: clientX - pane.left,
    y: clientY - pane.top,
    menuWidth: nodeMenu.offsetWidth,
    menuHeight: nodeMenu.offsetHeight,
    paneWidth: pane.width,
    paneHeight: pane.height,
  });
  nodeMenu.style.left = `${left}px`;
  nodeMenu.style.top = `${top}px`;
  nodeMenuSeed.focus();
};
nodeMenuSeed.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (!node) return;
  if (focusProjection?.seedKeys.has(node.key)) removeFocusSeed(node.key);
  else addFocusSeed(node);
});
nodeMenuExplore.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (node) focusOnPaper(node);
});
nodeMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeNodeMenu(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  // Two items: either arrow moves to the other one.
  const active = document.activeElement;
  (active === nodeMenuSeed ? nodeMenuExplore : nodeMenuSeed).focus();
});
const closeNodeMenuOnOutsidePointer = (event: Event): void => {
  if (nodeMenu.hidden) return;
  const target = event.target as Node | null;
  if (target && nodeMenu.contains(target)) return;
  closeNodeMenu();
};
const closeNodeMenuOnWheel = (): void => closeNodeMenu();
const closeNodeMenuOnResize = (): void => closeNodeMenu();
document.addEventListener("pointerdown", closeNodeMenuOnOutsidePointer, true);
canvas.addEventListener("wheel", closeNodeMenuOnWheel, { passive: true });
document.defaultView?.addEventListener("resize", closeNodeMenuOnResize);
```

Change `handleGraphSelection` to close the menu on any selection change:

```ts
const handleGraphSelection = (node: CitationGraphNode | null): void => {
  closeNodeMenu();
  renderOverview(node);
};
```

(The renderer selects the node before it calls `onNodeContextMenu`, so this close runs first and the open that follows wins.)

In the renderer options add `onNodeContextMenu: openNodeMenu,` after `onBackgroundInteraction: appearance.close,`.

In `cleanup`, next to the other listener removals, add:

```ts
document.removeEventListener(
  "pointerdown",
  closeNodeMenuOnOutsidePointer,
  true,
);
canvas.removeEventListener("wheel", closeNodeMenuOnWheel);
document.defaultView?.removeEventListener("resize", closeNodeMenuOnResize);
```

- [ ] **Step 3: CSS**

After the `.cm-export-menu button` rule block in `addon/content/graph.css` add:

```css
/*
 * The node's right-click menu. Absolute inside `.cm-graph-area`, placed by
 * `clampMenuPosition` so it never leaves the plot; the same surface as the
 * export menu so the two read as one family.
 */
.cm-node-menu {
  position: absolute;
  z-index: 12;
  display: grid;
  min-width: 190px;
  padding: 5px;
  border: 1px solid var(--cm-border);
  border-radius: 7px;
  background: Canvas;
  box-shadow: 0 9px 28px color-mix(in srgb, black 23%, transparent);
}
.cm-node-menu[hidden] {
  display: none;
}
.cm-node-menu-item {
  justify-content: flex-start;
  border-color: transparent !important;
  background: transparent !important;
  text-align: left;
}
.cm-node-menu-item:hover,
.cm-node-menu-item:focus-visible {
  background: color-mix(in srgb, var(--cm-accent) 10%, Canvas) !important;
}
```

Check `.cm-graph-area` is `position: relative` (the zoom controls and empty state are absolute inside it, so it should be); if not, add it.

- [ ] **Step 4: README**

In `README.md`, in the "Explore outward from one or more papers" bullet, replace

`Add "seed" papers to a graph and it shows their references, citing papers, or both. Add or remove seeds, include papers outside Zotero, and rank and limit neighbours. Remove the last seed and the graph returns to your library.`

with

`Add "seed" papers to a graph and it shows their references, citing papers, or both. Add a seed from the Seeds button, from a paper's detail pane, or by right-clicking its node; include papers outside Zotero, and rank and limit neighbours. Remove the last seed and the graph returns to your library.`

Run `npx prettier --write README.md`.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: green.

```bash
git add src/services/graphViewService.ts addon/content/graph.css test/zotero/graphViewVisual.test.ts README.md
git commit -m "Open a seed menu on a node's right-click"
```

---

## Self-review

- Spec coverage: Seeds popover (Task 2), detail pane (Task 3), renderer callback and keyboard (Task 4), menu with clamping, dismissals, focus and README (Task 5), Add Node removal and CSS (Task 2), spec correction (Task 2), visual test assertions (Tasks 2 and 5), unit tests (Task 1).
- Names used across tasks: `seedPopoverList`, `libraryPaperID`, `seedPaperID`, `LibrarySearchState`, `SeedPopoverPaper` (Task 1 → 2); `clampMenuPosition`, `isContextMenuKey` (Task 1 → 4, 5); `onNodeContextMenu`, `nodeClientPosition` (Task 4 → 5).
- Manual checks owed to the user after merge, in Zotero: the spec's Testing section.
