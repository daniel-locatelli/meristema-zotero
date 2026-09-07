# Selection Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting items in Zotero's item list highlights them in every open graph, and clicking a node in a graph selects that row in Zotero, without either side echoing back.

**Architecture:** A new DOM-free binder, `zoteroSelectionSync.ts`, owns one listener on Zotero's items tree per main window, publishes the selected item IDs, and offers a tree-level select for the graph to call; its loop guard is unit tested over a fake tree. The window service subscribes once per window and applies the selection live to detached windows and the selected tab, deferring it for hidden tabs until they are switched to. The view gains `applyLibrarySelection` and an `onGraphSelection` option; a pure `resolveLibrarySelection` decides select-versus-emphasise, and the renderer gains a pan that only moves when the node is off-screen.

**Tech Stack:** TypeScript, Zotero 10 plugin (`ZoteroPane.itemsView.onSelect`, `itemsView.selectItems`), hand-built DOM, canvas renderer, `node --test` with chai for unit tests, the Zotero visual harness for view tests.

Spec: `docs/superpowers/specs/2026-09-07-selection-sync-design.md`. Read it first; the seven numbered decisions there are fixed.

## Global Constraints

- `npm run check` (lint, typecheck, unit tests) is the gate for every task. Never run `npm test` and never start or stop Zotero; `test/zotero/*` runs only inside Zotero and is the user's to run. Before this plan, `npm run test:unit` reports 215 passing tests.
- Commit messages: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa`. Stage by path, never `git add -A`.
- Run `npx prettier --write` on any `docs/` or `README.md` file you change before committing.
- `test/unit` has no DOM shim and must stay free of `Zotero.*`; a module imported by a unit test may reference `Zotero` only inside functions the test never calls. DOM behaviour is tested in `test/zotero/graphViewVisual.test.ts`.
- Sync never adds nodes to a graph and never calls `onSelectPaper`. Only the tree-level `itemsView.selectItems(ids, true)` is used by sync; `ZoteroPane.selectItems` stays reserved for double-click and Show in Zotero (`selectPaper` in `windowService.ts`), which are unchanged.
- One item present: select the node, pan only if off-screen, no zoom change. Two or more present: emphasise them all, clear the node selection. None, or an empty selection: clear emphasis and selection. Items from another library count as not present.
- A graph click selects a listed row only; deselecting in the graph (background click, external node) does nothing in Zotero.
- The binder's listener is synchronous, wrapped in try/catch, and never throws into Zotero.

---

### Task 1: The selection binder

**Files:**

- Create: `src/services/zoteroSelectionSync.ts`
- Test: `test/unit/zoteroSelectionSync.test.ts`

**Interfaces:**

- Consumes: nothing from this plan. Reads `ZoteroPane.itemsView` off the host window at runtime.
- Produces, exported from `src/services/zoteroSelectionSync.ts`:

```ts
export interface LibrarySelection {
  itemIDs: number[];
}
export interface ItemsTreeLike {
  onSelect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  getSelectedItems(asIDs: true): number[];
  selectItems(ids: number[], noRecurse: boolean): Promise<number>;
}
export interface ZoteroSelectionSyncDeps {
  itemsView(): ItemsTreeLike | null;
  debug(message: string): void;
}
export interface ZoteroSelectionBinding {
  current(): LibrarySelection;
  selectListed(itemIDs: readonly number[]): void;
  subscribe(listener: (selection: LibrarySelection) => void): () => void;
  dispose(): void;
}
export function normalizeItemIDs(itemIDs: readonly number[]): number[];
export function sameItemIDs(
  a: readonly number[],
  b: readonly number[],
): boolean;
export function bindZoteroSelection(
  host: Window,
  deps?: ZoteroSelectionSyncDeps,
): ZoteroSelectionBinding;
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/zoteroSelectionSync.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  bindZoteroSelection,
  normalizeItemIDs,
  sameItemIDs,
  type ItemsTreeLike,
  type LibrarySelection,
  type ZoteroSelectionSyncDeps,
} from "../../src/services/zoteroSelectionSync";

/** The part of Zotero's items tree the binder touches, driven by hand. */
class FakeTree implements ItemsTreeLike {
  listeners = new Set<() => void>();
  selected: number[] = [];
  /** Every `selectItems` call: the ids and the noRecurse flag. */
  selectCalls: { ids: number[]; noRecurse: boolean }[] = [];
  /** What the next `selectItems` resolves with; null makes it reject. */
  nextSelectResult: number | null = 1;
  onSelect = {
    addListener: (listener: () => void): void => {
      this.listeners.add(listener);
    },
    removeListener: (listener: () => void): void => {
      this.listeners.delete(listener);
    },
  };
  getSelectedItems(_asIDs: true): number[] {
    return [...this.selected];
  }
  selectItems(ids: number[], noRecurse: boolean): Promise<number> {
    this.selectCalls.push({ ids: [...ids], noRecurse });
    if (this.nextSelectResult === null) {
      return Promise.reject(new Error("tree gone"));
    }
    return Promise.resolve(this.nextSelectResult);
  }
  /** What Zotero does after a selection: fire every listener. */
  fire(selected: number[]): void {
    this.selected = selected;
    for (const listener of [...this.listeners]) listener();
  }
}

function deps(
  tree: ItemsTreeLike | null,
): ZoteroSelectionSyncDeps & { messages: string[] } {
  const messages: string[] = [];
  return {
    itemsView: () => tree,
    debug: (message) => messages.push(message),
    messages,
  };
}

const host = {} as Window;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Zotero selection sync", function () {
  it("normalises ids: sorted, deduplicated, finite positives only", function () {
    expect(normalizeItemIDs([5, 3, 5, 0, -1, NaN, 3.5, 3])).to.deep.equal([
      3, 5,
    ]);
    expect(sameItemIDs([1, 2], [1, 2])).to.equal(true);
    expect(sameItemIDs([1, 2], [2, 1])).to.equal(false);
    expect(sameItemIDs([], [])).to.equal(true);
  });

  it("publishes a new selection and not the same one twice", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: LibrarySelection[] = [];
    binding.subscribe((selection) => seen.push(selection));
    expect(binding.current().itemIDs).to.deep.equal([]);

    tree.fire([7, 3]);
    expect(seen.map((s) => s.itemIDs)).to.deep.equal([[3, 7]]);
    expect(binding.current().itemIDs).to.deep.equal([3, 7]);

    tree.fire([3, 7]);
    expect(seen.length, "an equal set is not republished").to.equal(1);

    tree.fire([]);
    expect(seen.map((s) => s.itemIDs)).to.deep.equal([[3, 7], []]);
  });

  it("does not publish the echo of its own selectListed", async function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    binding.subscribe((selection) => seen.push(selection.itemIDs));

    binding.selectListed([42]);
    expect(tree.selectCalls).to.deep.equal([{ ids: [42], noRecurse: true }]);
    await flush();
    tree.fire([42]);
    expect(seen, "the echo is swallowed").to.deep.equal([]);
    expect(binding.current().itemIDs).to.deep.equal([42]);

    tree.fire([42, 43]);
    expect(seen, "a different set after it is published").to.deep.equal([
      [42, 43],
    ]);
  });

  it("selectListed is a no-op when the ids are already current", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    tree.fire([9]);
    binding.selectListed([9]);
    expect(tree.selectCalls).to.deep.equal([]);
  });

  it("forgets its own selection when no row was listed, so the user's later click is published", async function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    binding.subscribe((selection) => seen.push(selection.itemIDs));

    tree.nextSelectResult = 0;
    binding.selectListed([5]);
    await flush();
    tree.fire([5]);
    expect(seen).to.deep.equal([[5]]);

    tree.nextSelectResult = null;
    binding.selectListed([6]);
    await flush();
    tree.fire([6]);
    expect(seen, "a rejected select is forgotten too").to.deep.equal([
      [5],
      [6],
    ]);
  });

  it("keeps publishing past a subscriber that throws", function () {
    const tree = new FakeTree();
    const d = deps(tree);
    const binding = bindZoteroSelection(host, d);
    const seen: number[][] = [];
    binding.subscribe(() => {
      throw new Error("bad subscriber");
    });
    binding.subscribe((selection) => seen.push(selection.itemIDs));
    tree.fire([1]);
    expect(seen).to.deep.equal([[1]]);
    expect(d.messages.some((m) => m.includes("bad subscriber"))).to.equal(true);
  });

  it("hands out copies", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    let received: number[] = [];
    binding.subscribe((selection) => {
      received = selection.itemIDs;
    });
    tree.fire([2, 1]);
    received.push(99);
    binding.current().itemIDs.push(98);
    expect(binding.current().itemIDs).to.deep.equal([1, 2]);
  });

  it("unsubscribes and disposes", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    const unsubscribe = binding.subscribe((s) => seen.push(s.itemIDs));
    tree.fire([1]);
    unsubscribe();
    tree.fire([2]);
    expect(seen).to.deep.equal([[1]]);
    expect(tree.listeners.size).to.equal(1);
    binding.dispose();
    expect(tree.listeners.size, "dispose removes the tree listener").to.equal(
      0,
    );
  });

  it("attaches later when the tree is not there at bind time", function () {
    let tree: FakeTree | null = null;
    const d = deps(null);
    d.itemsView = () => tree;
    const binding = bindZoteroSelection(host, d);
    expect(d.messages.length, "logged once").to.equal(1);
    expect(binding.current().itemIDs).to.deep.equal([]);
    expect(d.messages.length, "and not again").to.equal(1);

    tree = new FakeTree();
    const seen: number[][] = [];
    binding.subscribe((s) => seen.push(s.itemIDs));
    binding.selectListed([4]);
    expect(tree.selectCalls).to.deep.equal([{ ids: [4], noRecurse: true }]);
    expect(tree.listeners.size, "attached on first success").to.equal(1);
    tree.fire([8]);
    expect(seen).to.deep.equal([[8]]);
  });

  it("never throws out of the tree listener", function () {
    const tree = new FakeTree();
    const d = deps(tree);
    bindZoteroSelection(host, d);
    tree.getSelectedItems = () => {
      throw new Error("tree exploded");
    };
    expect(() => tree.fire([1])).to.not.throw();
    expect(d.messages.some((m) => m.includes("tree exploded"))).to.equal(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit 2>&1 | tail -20`
Expected: failures mentioning `zoteroSelectionSync` cannot be resolved.

- [ ] **Step 3: Write the binder**

Create `src/services/zoteroSelectionSync.ts`:

```ts
/// <reference lib="dom" />
/**
 * Keeps Zotero's item-list selection and the graph's in step.
 *
 * Zotero's items tree fires `onSelect` after every selection change, and after
 * some non-changes, with no arguments. This binding turns that into a stream
 * of item-ID sets that only moves when the set moves, and offers the graph a
 * way to select a listed row without the jump `ZoteroPane.selectItems` makes
 * (collection switch, quick-search reset, focus to the list).
 *
 * The loop guard is symmetric. A set the binding itself selected comes back
 * once as Zotero's echo and is swallowed; a set equal to the current one is
 * never republished. Everything Zotero is asked for happens inside a try, so
 * a failure here is a debug line and no sync, never a broken item list.
 */

export interface LibrarySelection {
  /** Sorted ascending, no duplicates. Empty when nothing is selected. */
  itemIDs: number[];
}

/** The subset of Zotero's items tree the binding touches. */
export interface ItemsTreeLike {
  onSelect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  getSelectedItems(asIDs: true): number[];
  selectItems(ids: number[], noRecurse: boolean): Promise<number>;
}

/** Injectable so the binding is unit tested without Zotero. */
export interface ZoteroSelectionSyncDeps {
  /** `ZoteroPane.itemsView`, or null while the pane is still starting. */
  itemsView(): ItemsTreeLike | null;
  debug(message: string): void;
}

export interface ZoteroSelectionBinding {
  /** The last published set; empty before the first event. Returns a copy. */
  current(): LibrarySelection;
  /** Tree-level select of listed rows only: no jump, no focus, no tab switch. */
  selectListed(itemIDs: readonly number[]): void;
  /** Listeners receive a copy. Returns the unsubscribe function. */
  subscribe(listener: (selection: LibrarySelection) => void): () => void;
  /** Removes the tree listener and drops every subscriber. */
  dispose(): void;
}

export function normalizeItemIDs(itemIDs: readonly number[]): number[] {
  return [
    ...new Set(itemIDs.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((left, right) => left - right);
}

export function sameItemIDs(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function defaultDeps(host: Window): ZoteroSelectionSyncDeps {
  return {
    itemsView: () => {
      const pane = (host as unknown as { ZoteroPane?: { itemsView?: unknown } })
        .ZoteroPane;
      const view = pane?.itemsView;
      return view && typeof view === "object" ? (view as ItemsTreeLike) : null;
    },
    debug: (message) => Zotero.debug(message),
  };
}

export function bindZoteroSelection(
  host: Window,
  deps: ZoteroSelectionSyncDeps = defaultDeps(host),
): ZoteroSelectionBinding {
  const listeners = new Set<(selection: LibrarySelection) => void>();
  let current: number[] = [];
  /** The set this binding asked Zotero for, whose echo is still to come. */
  let mine: number[] | null = null;
  let tree: ItemsTreeLike | null = null;
  let loggedMissing = false;
  let disposed = false;

  const publish = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener({ itemIDs: [...current] });
      } catch (error) {
        deps.debug(
          `Meristema: selection sync subscriber failed: ${String(error)}`,
        );
      }
    }
  };

  const onSelect = (): void => {
    try {
      if (!tree) return;
      const next = normalizeItemIDs(tree.getSelectedItems(true));
      if (sameItemIDs(next, current)) return;
      current = next;
      if (mine && sameItemIDs(next, mine)) {
        mine = null;
        return;
      }
      mine = null;
      publish();
    } catch (error) {
      deps.debug(
        `Meristema: reading the item selection failed: ${String(error)}`,
      );
    }
  };

  /** The tree, attaching the listener the first time it is there. */
  const attach = (): ItemsTreeLike | null => {
    if (tree || disposed) return tree;
    let found: ItemsTreeLike | null = null;
    try {
      found = deps.itemsView();
    } catch (error) {
      deps.debug(`Meristema: items tree lookup failed: ${String(error)}`);
    }
    if (!found) {
      if (!loggedMissing) {
        loggedMissing = true;
        deps.debug("Meristema: items tree not ready; selection sync waits.");
      }
      return null;
    }
    try {
      found.onSelect.addListener(onSelect);
      tree = found;
    } catch (error) {
      deps.debug(`Meristema: items tree listener failed: ${String(error)}`);
      return null;
    }
    return tree;
  };

  attach();

  return {
    current() {
      attach();
      return { itemIDs: [...current] };
    },
    selectListed(itemIDs) {
      const target = attach();
      if (!target) return;
      const ids = normalizeItemIDs(itemIDs);
      if (!ids.length || sameItemIDs(ids, current)) return;
      mine = ids;
      let selecting: Promise<number>;
      try {
        selecting = target.selectItems([...ids], true);
      } catch (error) {
        mine = null;
        deps.debug(`Meristema: selecting listed rows failed: ${String(error)}`);
        return;
      }
      selecting.then(
        (count) => {
          if (count === 0 && mine && sameItemIDs(mine, ids)) mine = null;
        },
        (error) => {
          if (mine && sameItemIDs(mine, ids)) mine = null;
          deps.debug(
            `Meristema: selecting listed rows failed: ${String(error)}`,
          );
        },
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (tree) {
        try {
          tree.onSelect.removeListener(onSelect);
        } catch (error) {
          deps.debug(
            `Meristema: removing the selection listener failed: ${String(error)}`,
          );
        }
        tree = null;
      }
    },
  };
}
```

Note on the echo rule: when the echo arrives, `current` is updated first and the echo is then dropped, so `current()` reflects Zotero at all times. When a single-row select finds the row already selected, Zotero still fires `onSelect`; `sameItemIDs(next, current)` drops it before `mine` is consulted, and `mine` is cleared on the next real event.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: `ℹ pass 225` and `ℹ fail 0` (215 existing plus 10 new).

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: exit 0.

```bash
git add src/services/zoteroSelectionSync.ts test/unit/zoteroSelectionSync.test.ts
git commit -m "Add a binding that follows Zotero's item selection and selects listed rows" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 2: Resolution helper and off-screen pan

**Files:**

- Create: `src/services/librarySelection.ts`
- Test: `test/unit/librarySelection.test.ts`
- Modify: `src/services/graphViewport.ts` (append)
- Modify: `test/unit/graphViewport.test.ts` (append a describe block)
- Modify: `src/services/citationGraphRenderer.ts` (import block ~line 45; add a method after `selectNode`, ~line 1556)

**Interfaces:**

- Consumes: `projectToScreen` and `ViewportPoint` from `graphViewport.ts`; the renderer's private `positions`, `transform`, `canvas`, `nodeRadius`, `draw`.
- Produces:

```ts
// src/services/librarySelection.ts
export interface LibrarySelectionResolution {
  select: string | null;
  emphasise: ReadonlySet<string> | null;
}
export function resolveLibrarySelection(
  itemIDs: readonly number[],
  nodeKeyForItem: (itemID: number) => string | null,
  visibleKeys: ReadonlySet<string>,
): LibrarySelectionResolution;

// src/services/graphViewport.ts
export function offscreenPanDelta(
  point: ViewportPoint,
  margin: number,
  width: number,
  height: number,
): ViewportPoint;

// src/services/citationGraphRenderer.ts (CitationGraphRenderer)
public panToNodeIfOffscreen(key: string): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/librarySelection.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { resolveLibrarySelection } from "../../src/services/librarySelection";

const keyFor = (itemID: number): string | null =>
  itemID === 404 ? null : `item-${itemID}`;
const visible = new Set(["item-1", "item-2", "item-3"]);

describe("Library selection resolution", function () {
  it("selects the one present node", function () {
    expect(resolveLibrarySelection([1], keyFor, visible)).to.deep.equal({
      select: "item-1",
      emphasise: null,
    });
  });

  it("emphasises two or more present nodes and selects none", function () {
    const result = resolveLibrarySelection([3, 1, 404], keyFor, visible);
    expect(result.select).to.equal(null);
    expect([...result.emphasise!].sort()).to.deep.equal(["item-1", "item-3"]);
  });

  it("clears both when nothing is present", function () {
    expect(resolveLibrarySelection([], keyFor, visible)).to.deep.equal({
      select: null,
      emphasise: null,
    });
    expect(resolveLibrarySelection([404], keyFor, visible)).to.deep.equal({
      select: null,
      emphasise: null,
    });
  });

  it("treats a filtered-out node as absent", function () {
    expect(
      resolveLibrarySelection([1, 9], keyFor, visible),
      "item-9 exists but is not visible: one present, so select it",
    ).to.deep.equal({ select: "item-1", emphasise: null });
  });

  it("collapses duplicates to one present node", function () {
    expect(resolveLibrarySelection([2, 2], keyFor, visible)).to.deep.equal({
      select: "item-2",
      emphasise: null,
    });
  });
});
```

Append to `test/unit/graphViewport.test.ts` (inside the file, after the existing `describe`), adding `offscreenPanDelta` to the import at the top:

```ts
describe("Off-screen pan", function () {
  const width = 800;
  const height = 600;
  const margin = 10;

  it("moves nothing for a point inside the margin", function () {
    expect(
      offscreenPanDelta({ x: 400, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: 0 });
    expect(
      offscreenPanDelta({ x: 10, y: 590 }, margin, width, height),
      "on the margin line counts as inside",
    ).to.deep.equal({ x: 0, y: 0 });
  });

  it("moves by the minimum past each edge", function () {
    expect(
      offscreenPanDelta({ x: -50, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: 60, y: 0 });
    expect(
      offscreenPanDelta({ x: 850, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: -60, y: 0 });
    expect(
      offscreenPanDelta({ x: 400, y: -20 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: 30 });
    expect(
      offscreenPanDelta({ x: 400, y: 700 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: -110 });
  });

  it("moves on both axes past a corner", function () {
    expect(
      offscreenPanDelta({ x: 900, y: -100 }, margin, width, height),
    ).to.deep.equal({ x: -110, y: 110 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit 2>&1 | tail -20`
Expected: `librarySelection` cannot be resolved; `offscreenPanDelta` is not exported.

- [ ] **Step 3: Write the helpers**

Create `src/services/librarySelection.ts`:

```ts
/**
 * What a Zotero selection becomes in a graph.
 *
 * One present node is selected; two or more are emphasised through the Key's
 * emphasis so the rest of the graph fades; none clears both. "Present" means
 * the item has a node and the node is visible under the current filters. The
 * view supplies both lookups so this stays a pure decision.
 */

export interface LibrarySelectionResolution {
  select: string | null;
  emphasise: ReadonlySet<string> | null;
}

export function resolveLibrarySelection(
  itemIDs: readonly number[],
  nodeKeyForItem: (itemID: number) => string | null,
  visibleKeys: ReadonlySet<string>,
): LibrarySelectionResolution {
  const present = new Set<string>();
  for (const itemID of itemIDs) {
    const key = nodeKeyForItem(itemID);
    if (key && visibleKeys.has(key)) present.add(key);
  }
  if (present.size === 1) {
    return { select: [...present][0], emphasise: null };
  }
  if (present.size > 1) {
    return { select: null, emphasise: present };
  }
  return { select: null, emphasise: null };
}
```

Append to `src/services/graphViewport.ts`:

```ts
/**
 * How far to shift the view so a screen point sits inside the canvas with
 * `margin` to spare, or zero on an axis where it already does. Used to bring
 * a node selected elsewhere into view without changing the zoom.
 */
export function offscreenPanDelta(
  point: ViewportPoint,
  margin: number,
  width: number,
  height: number,
): ViewportPoint {
  const shift = (value: number, extent: number): number => {
    if (value < margin) return margin - value;
    if (value > extent - margin) return extent - margin - value;
    return 0;
  };
  return { x: shift(point.x, width), y: shift(point.y, height) };
}
```

- [ ] **Step 4: Add the renderer method**

In `src/services/citationGraphRenderer.ts`, add `offscreenPanDelta` to the `./graphViewport` import block (~line 45):

```ts
import {
  devicePixelScale,
  offscreenPanDelta,
  projectToScreen,
  projectToWorld,
  screenLengthToWorld,
} from "./graphViewport";
```

Add this method right after `selectNode` (which ends ~line 1556):

```ts
  /**
   * Bring a node into view without changing the zoom. Returns true when the
   * view moved. A node already inside the canvas, with one node radius to
   * spare, leaves the camera where the user put it.
   */
  public panToNodeIfOffscreen(key: string): boolean {
    const node = this.model.nodes.find((candidate) => candidate.key === key);
    const position = node ? this.positions.get(key) : undefined;
    if (!node || !position) return false;
    const margin = this.nodeRadius(node) * this.pixelRatio() * 2;
    const delta = offscreenPanDelta(
      this.projectToScreen(position),
      margin,
      this.canvas.width,
      this.canvas.height,
    );
    if (delta.x === 0 && delta.y === 0) return false;
    this.markViewAdjusted();
    this.transform.x += delta.x;
    this.transform.y += delta.y;
    this.draw();
    return true;
  }
```

`nodeRadius(node)` returns CSS pixels for the default domain; the margin is twice that in device pixels so the label under the node also lands inside. `markViewAdjusted` is the existing private method the pointer handler calls before it pans; use it so the view's own fit logic knows the camera was moved.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: `ℹ pass 233` and `ℹ fail 0` (225 plus 5 plus 3).

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check`
Expected: exit 0.

```bash
git add src/services/librarySelection.ts test/unit/librarySelection.test.ts src/services/graphViewport.ts test/unit/graphViewport.test.ts src/services/citationGraphRenderer.ts
git commit -m "Resolve a library selection into a node to select or a set to emphasise, and pan only when off-screen" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 3: The view applies a library selection and reports its own

**Files:**

- Modify: `src/services/graphViewService.ts`:
  - imports (~line 20, next to the `./citationGraphRenderer` import);
  - `GraphViewController` (~line 193, add `applyLibrarySelection`);
  - `GraphViewOptions` (~line 233, add `onGraphSelection`);
  - the view closure: state near `let viewActive = true;` (~line 406); the Key rail's `onEmphasise` (~line 995); `handleGraphSelection` (~line 2996); `applyFilters` (~line 3112); the controller object (~line 3811).
- Test: `test/zotero/graphViewVisual.test.ts` (append view 15 after view 14, which ends ~line 1320).

**Interfaces:**

- Consumes: `resolveLibrarySelection` from Task 2; `renderer.panToNodeIfOffscreen`, `renderer.selectNode(key, false)`, `renderer.clearSelection()`, `renderer.setEmphasis(keys | null)`; the closure's `libraryNodeForItem(itemID)` (~line 3589, returns a `CitationGraphNode | null`, creating a library node for an unknown regular item of this library) and `visibleKeys`.
- Produces:

```ts
// GraphViewOptions
onGraphSelection?: (itemID: number | null) => void;
// GraphViewController
applyLibrarySelection(itemIDs: readonly number[]): void;
```

`applyLibrarySelection` never throws and never calls `onSelectPaper` or `onGraphSelection`. `onGraphSelection` fires once per user-driven selection change in the graph, with the local node's item ID, or null for a deselect or an external node.

- [ ] **Step 1: Write the failing harness test**

Append to `test/zotero/graphViewVisual.test.ts`, directly after the view 14 `it(...)` block, inside the same `describe`:

```ts
it("view 15 — a library selection lands on present nodes and never echoes", async function () {
  this.timeout(60_000);
  const reported: (number | null)[] = [];
  const first = await open(30);
  stage = await openViewStage(first.model, {
    onGraphSelection: (itemID) => reported.push(itemID),
  });
  first.close();
  const view = stage;
  await settle(view.window, 6);
  (
    view.root.querySelector(
      '.cm-zoom-controls button[data-action="fit"]',
    ) as HTMLButtonElement
  ).click();
  await settle(view.window, 6);

  const controller = getGraphViewController(view.mount)!;
  const local = view.model.nodes.filter((node) => node.kind !== "external");
  expect(local.length).to.be.greaterThan(2);
  const [a, b, c] = local.map((node) => node.itemID);
  const placeholder = (): Element | null =>
    view.root.querySelector(".cm-detail-body .cm-placeholder");

  controller.applyLibrarySelection([a]);
  await settle(view.window, 4);
  expect(placeholder(), "one item: its node is selected").to.equal(null);
  expect(reported, "sync never reports back").to.deep.equal([]);
  expect(view.selected, "and never selects a paper").to.deep.equal([]);
  await shot("view-15-single");

  controller.applyLibrarySelection([a, b, c]);
  await settle(view.window, 4);
  expect(placeholder(), "many: the selection is cleared").to.not.equal(null);
  expect(reported).to.deep.equal([]);
  await shot("view-15-many");

  controller.applyLibrarySelection([]);
  await settle(view.window, 4);
  expect(placeholder(), "none: still cleared").to.not.equal(null);
  await shot("view-15-cleared");

  controller.applyLibrarySelection([-1]);
  await settle(view.window, 2);
  expect(reported).to.deep.equal([]);

  // A selection the view makes on its own behalf is reported exactly once.
  controller.revealItem(b);
  await settle(view.window, 4);
  expect(reported).to.deep.equal([b]);
  expect(placeholder()).to.equal(null);
});
```

`getGraphViewController` is already imported in this test file (line 19). `view.selected` is the harness's `onSelectPaper` log. `.cm-detail-body` is the class of the view's `detailBody` (graphViewService.ts line 973), the element `renderOverview` appends the placeholder into.

- [ ] **Step 2: Confirm it does not compile yet**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: errors that `onGraphSelection` is not in `GraphViewOptions` and `applyLibrarySelection` is not on the controller.

- [ ] **Step 3: Add the option, the controller method and the state**

In `src/services/graphViewService.ts`:

Import, next to the `./citationGraphRenderer` import (~line 20):

```ts
import { resolveLibrarySelection } from "./librarySelection";
```

In `GraphViewController` (~line 193), after `revealItems`:

```ts
  /**
   * Mirror Zotero's item selection: select the one present node, emphasise
   * several, clear on none. Never adds nodes, never reports back.
   */
  applyLibrarySelection(itemIDs: readonly number[]): void;
```

In `GraphViewOptions` (~line 233), after `onSelectPaper`:

```ts
  /**
   * The graph's own selection changed by the user's hand: the local node's
   * item, or null on a deselect or an external node. Not fired for
   * selections `applyLibrarySelection` makes.
   */
  onGraphSelection?: (itemID: number | null) => void;
```

In the view closure, right after `let viewActive = true;` (~line 406):

```ts
/** True while a library selection is being applied, so it is not reported back. */
let syncingLibrarySelection = false;
/** The nodes a multi-item library selection emphasises, until the user moves on. */
let libraryEmphasisKeys: ReadonlySet<string> | null = null;
/** What the Key rail is emphasising (hover or pinned), or null. */
let railEmphasisKeys: ReadonlySet<string> | null = null;
/** The rail wins while it is emphasising; otherwise the library selection shows. */
const applyEmphasis = (): void => {
  renderer?.setEmphasis(railEmphasisKeys ?? libraryEmphasisKeys);
};
```

`renderer` is declared later in the closure with `let`; `applyEmphasis` only reads it when called, which is after the renderer exists, so the reference is fine. If TypeScript complains about use before declaration, move the three declarations and `applyEmphasis` to just above `const keyRail = createKeyRail({` (~line 994) instead.

- [ ] **Step 4: Route the Key rail through `applyEmphasis`**

Replace the `onEmphasise` handler of `createKeyRail` (~line 995):

```ts
    onEmphasise: (entry) => {
      if (!entry?.matches) {
        railEmphasisKeys = null;
      } else {
        const matches = entry.matches;
        railEmphasisKeys = new Set(
          model.nodes.filter((node) => matches(node)).map((node) => node.key),
        );
      }
      applyEmphasis();
    },
```

- [ ] **Step 5: Report user-driven selections and swallow synced ones**

Replace `handleGraphSelection` (~line 2996):

```ts
const handleGraphSelection = (node: CitationGraphNode | null): void => {
  closeNodeMenu();
  renderOverview(node);
  if (syncingLibrarySelection) return;
  if (libraryEmphasisKeys) {
    libraryEmphasisKeys = null;
    applyEmphasis();
  }
  options.onGraphSelection?.(
    node && node.kind !== "external" ? node.itemID : null,
  );
};
```

`kind` is optional on `CitationGraphNode` (`src/domain/graphTypes.ts` line 59) and local nodes may leave it unset, so test for "not external", never for `"local"`.

- [ ] **Step 6: Prune the library emphasis with the filters**

In `applyFilters` (~line 3112), after `renderer?.setVisibleKeys(visibleKeys, false);`:

```ts
if (libraryEmphasisKeys) {
  const kept = new Set(
    [...libraryEmphasisKeys].filter((key) => visibleKeys.has(key)),
  );
  libraryEmphasisKeys = kept.size ? kept : null;
  applyEmphasis();
}
```

- [ ] **Step 7: Implement `applyLibrarySelection`**

Add to the controller object (~line 3811), after `revealItems,`:

```ts
    applyLibrarySelection(itemIDs) {
      if (!renderer) return;
      const active = renderer;
      let resolution;
      try {
        resolution = resolveLibrarySelection(
          itemIDs,
          (itemID) => {
            const libraryNode = libraryNodeForItem(itemID);
            if (!libraryNode) return null;
            return model.nodes.some((node) => node.key === libraryNode.key)
              ? libraryNode.key
              : null;
          },
          visibleKeys,
        );
      } catch (error) {
        Zotero.debug(
          `Meristema: resolving the library selection failed: ${String(error)}`,
        );
        return;
      }
      syncingLibrarySelection = true;
      try {
        if (resolution.select) {
          active.selectNode(resolution.select, false);
          active.panToNodeIfOffscreen(resolution.select);
        } else {
          active.clearSelection();
        }
        libraryEmphasisKeys = resolution.emphasise;
        applyEmphasis();
      } finally {
        syncingLibrarySelection = false;
      }
    },
```

`libraryNodeForItem` creates a library-model node for a regular item of this library that the model has not seen, which is why the key is then checked against `model.nodes` (the rendered model): only nodes the graph shows count as present, and the `visibleKeys` check inside `resolveLibrarySelection` then applies the filters. If `libraryNodeForItem` is declared after the controller object in the closure order, it is still safe to call here because the controller method runs later; if TypeScript flags it, reference `libraryNodeForSeedRow` (the same function stored in a `let` declared earlier) instead.

- [ ] **Step 8: Run the gate**

Run: `npm run check`
Expected: exit 0, unit tests still `ℹ pass 233`. The harness test (view 15) runs only inside Zotero and is the user's to run; do not run `npm test`.

- [ ] **Step 9: Commit**

```bash
git add src/services/graphViewService.ts test/zotero/graphViewVisual.test.ts
git commit -m "Let the view mirror a library selection and report its own" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 4: The window service wires the two together

**Files:**

- Modify: `src/services/windowService.ts`:
  - imports (~line 10, next to the `./graphViewService` import);
  - `GraphInstanceState` (~line 55, add `pendingLibrarySelection`) and `createGraphInstance` (~line 120, initialise it);
  - module state after `savedGraphWrites` (~line 52);
  - `prepareContainer`'s `tab-selection-change` handler (~line 948);
  - `renderTab` (~line 993, `renderGraphView` options and after it);
  - `renderDetachedWindow` (~line 626, `renderGraphView` options and after it);
  - `openGraphWindow` (~line 1178, after `installGraphTabHooks(win);`);
  - `closeGraphForWindow` (~line 1650, before `graphStateByWindow.delete(win);`).
- Modify: `docs/superpowers/specs/2026-09-07-selection-sync-design.md` (Status line).
- Modify: `README.md` (one sentence in the graph-view feature list, near line 61 where saved graphs are described).

**Interfaces:**

- Consumes: `bindZoteroSelection`, `ZoteroSelectionBinding` from Task 1; `applyLibrarySelection` and `onGraphSelection` from Task 3.
- Produces: nothing exported. Behaviour: one binding per main window while any graph is open in it; live apply to detached windows and the selected tab; deferred apply to hidden tabs on `tab-selection-change`; graph clicks reach `selectListed`.

- [ ] **Step 1: Add the binding registry and the instance field**

Import, next to the `./graphViewService` import:

```ts
import {
  bindZoteroSelection,
  type ZoteroSelectionBinding,
} from "./zoteroSelectionSync";
```

In `GraphInstanceState`, after `autosaveTimer: number | null;`:

```ts
  /**
   * The library selection that arrived while this tab was hidden, applied
   * when the tab is switched to. Only the latest one is kept.
   */
  pendingLibrarySelection: number[] | null;
```

In `createGraphInstance`, after `autosaveTimer: null,`:

```ts
    pendingLibrarySelection: null,
```

After `const savedGraphWrites = new Set<Promise<void>>();`:

```ts
/** One selection binding per main window, alive while any graph is open in it. */
const selectionBindingByWindow = new Map<
  _ZoteroTypes.MainWindow,
  ZoteroSelectionBinding
>();
```

- [ ] **Step 2: Add the per-window fan-out**

Add these functions after `activeOrRecentInstance` (~line 858):

```ts
/** Whether the instance's view is on screen: a detached window, or the selected tab. */
function instanceIsShowing(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): boolean {
  if (instance.detachedWindow && !instance.detachedWindow.closed) return true;
  return instance.tabID !== null && tabs(win).selectedID === instance.tabID;
}

function applyLibrarySelectionToInstance(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  itemIDs: readonly number[],
): void {
  const mount = instanceMount(win, instance);
  const controller = mount ? getGraphViewController(mount) : null;
  if (!controller) return;
  try {
    controller.applyLibrarySelection(itemIDs);
  } catch (error) {
    Zotero.debug(
      `Meristema: applying the library selection failed: ${String(error)}`,
    );
  }
}

/**
 * The window's selection binding, created on first use. Detached windows and
 * the selected tab follow the library live; a hidden tab keeps the latest
 * selection and applies it when it is switched to.
 */
function selectionBinding(
  win: _ZoteroTypes.MainWindow,
): ZoteroSelectionBinding {
  const existing = selectionBindingByWindow.get(win);
  if (existing) return existing;
  const binding = bindZoteroSelection(win as unknown as Window);
  binding.subscribe(({ itemIDs }) => {
    for (const instance of liveInstances(win)) {
      if (instanceIsShowing(win, instance)) {
        instance.pendingLibrarySelection = null;
        applyLibrarySelectionToInstance(win, instance, itemIDs);
      } else {
        instance.pendingLibrarySelection = [...itemIDs];
      }
    }
  });
  selectionBindingByWindow.set(win, binding);
  return binding;
}

/** A click in the graph selects the row in Zotero's list, if it is listed. */
function reportGraphSelection(
  win: _ZoteroTypes.MainWindow,
  itemID: number | null,
): void {
  if (itemID === null) return;
  selectionBinding(liveHostWindow(win)).selectListed([itemID]);
}
```

`liveHostWindow(win)` is the existing helper `selectPaper` uses to reach a still-open main window; `instanceMount` and `liveInstances` exist already. `getGraphViewController` is already imported.

- [ ] **Step 3: Create the binding when a graph opens, dispose it when the window's graphs close**

In `openGraphWindow`, right after `installGraphTabHooks(win);`:

```ts
selectionBinding(win);
```

In `closeGraphForWindow`, right before `graphStateByWindow.delete(win);`:

```ts
selectionBindingByWindow.get(win)?.dispose();
selectionBindingByWindow.delete(win);
```

- [ ] **Step 4: Apply a deferred selection when a tab is switched to**

In `prepareContainer`'s `tab-selection-change` listener, inside `if (selected) {` after `hideGlobalContextPane(win, container);`:

```ts
if (instance.pendingLibrarySelection) {
  const pending = instance.pendingLibrarySelection;
  instance.pendingLibrarySelection = null;
  getGraphViewController(container)?.applyLibrarySelection(pending);
}
```

- [ ] **Step 5: Pass `onGraphSelection` and seed the current selection in both render paths**

In `renderTab`, inside the `renderGraphView(...)` options, right after the `onSelectPaper` entry:

```ts
      onGraphSelection: (itemID) => reportGraphSelection(win, itemID),
```

Immediately after the `renderGraphView(...)` call in `renderTab` (before `getGraphViewController(container)?.setActive(`):

```ts
const current = selectionBinding(win).current().itemIDs;
if (tabs(win).selectedID === instance.tabID) {
  instance.pendingLibrarySelection = null;
  getGraphViewController(container)?.applyLibrarySelection(current);
} else {
  instance.pendingLibrarySelection = current;
}
```

In `renderDetachedWindow`, inside its `renderGraphView(...)` options, right after the `onSelectPaper` entry:

```ts
    onGraphSelection: (itemID) => reportGraphSelection(host, itemID),
```

Immediately after that `renderGraphView(...)` call (before `installGraphLibraryFilter(`):

```ts
instance.pendingLibrarySelection = null;
getGraphViewController(mount)?.applyLibrarySelection(
  selectionBinding(host).current().itemIDs,
);
```

- [ ] **Step 6: Documentation**

In `docs/superpowers/specs/2026-09-07-selection-sync-design.md`, change `**Status:** Approved` to `**Status:** Implemented`.

In `README.md`, the feature list uses bold-titled bullets with a paragraph under each. Append this sentence to the end of the paragraph under **Work with multiple independent views** (line 61):

```
Selection follows you both ways: selecting items in Zotero's list selects or emphasises their nodes in every open graph, and clicking a node selects that row in Zotero without leaving the graph.
```

Run `npx prettier --write README.md docs/superpowers/specs/2026-09-07-selection-sync-design.md`.

- [ ] **Step 7: Run the gate and commit**

Run: `npm run check`
Expected: exit 0, `ℹ pass 233`.

```bash
git add src/services/windowService.ts README.md docs/superpowers/specs/2026-09-07-selection-sync-design.md
git commit -m "Follow Zotero's item selection in every open graph and select listed rows from a node click" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

## Manual walk-through (the user's, in Zotero, after merge and build)

From the spec, section "Manual walk-through in Zotero":

1. Detached window with a few seeds. Click items in the library list: present nodes select and pan into view when off-screen; absent items do nothing. Select three items: present nodes emphasise, the overview empties. Click empty list space: everything clears.
2. Click a node in the detached window: the library row selects and scrolls into view; the library tab does not come to the front; the quick search, if any, stays. Apply a quick search that hides the item and click the node again: nothing changes in Zotero.
3. Graph tab: select an item in the library, switch to the tab; the node is selected. Click another node, switch back; that row is selected.
4. Two detached windows: both follow the list.
5. Double-click a node: today's full jump still happens.

Also still owed from the saved-graphs plan: its walk-through in `C:\Users\nunesd\AppData\Local\Temp\meristema-handoff-2026-09-07-selection-sync.md`.
