# Folder Changes Reach the Graph (B58) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A folder added, renamed, moved, trashed or deleted in Zotero reaches every open graph's Scope rail, every new graph, and a folder graph's default tab title, without a restart, a remount or a refetch.

**Architecture:** The folder-list builder moves out of `zoteroLibraryService.ts` into its own module, which gains `refreshSnapshotFolders(snapshot)`. The library snapshot observer in `hooks.ts` also listens for `collection` notifications. On one, it refreshes the cached snapshots' folder lists, publishes a payload-free event from a new `libraryFolderEvents.ts`, and asks the window service to retitle folder graphs. Each mounted graph subscribes to the event and refreshes its own snapshot's folders. It then refills its folder lookups in place, drops gone regions and redraws the rail.

**Tech Stack:** TypeScript, Zotero 7 plugin (zotero-plugin-scaffold), `node:test` + chai unit tests (`test/unit`), mocha Zotero suite (`test/zotero`).

**Spec:** `docs/superpowers/specs/2026-09-14-folder-changes-reach-graph-design.md` (approved 2026-09-14, with the tab title folded in at review).

## Global Constraints

- Relabel in place: a folder change must never remount a graph (`refreshOpenGraphViews` / `renderTab`). A remount is a reopen, and a reopen restarts a stopped hop fill (B55).
- `automaticUpdateCoordinator.ts` is not changed. Its observer queues citation fetches.
- A folder change must not invalidate the whole library snapshot, the citation graph snapshots or the focus caches.
- Refresh (the toolbar button) is not changed.
- Ticks are left as stored. A new folder follows the graph's base (`all` in a library graph, `none` in a folder graph).
- A `customTitle` view is never retitled.
- Zotero-suite cases drive the graph only through the plugin's own menus and rendered DOM. The test bundle is a second copy of the plugin, so importing a service from a suite reaches the wrong copy.
- Runtime unknowns (item notifications on a folder delete, trashed folders in `getByLibrary`, a `collection` notification's `extraData`) are recorded in the suite's output: `console.log` lines prefixed `B58 evidence:` and the assertion messages. `Zotero.debug` never reaches the runner log.
- `npm test` launches the dev Zotero. Wait for the task to exit before starting another run, or the next one hits `EBUSY` on `cert9.db`. Never stop a live Zotero without asking.
- Build the XPI after the last `npm test` run. The test run and the user's `serve` watcher both delete it.
- `npm run check` runs prettier over `docs/`. Run `npx prettier --write` on every doc edited before committing.
- Commits end with the session attribution lines given in the conversation.

## File Structure

| File                                              | Change | Responsibility                                                                                               |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `src/services/libraryFolders.ts`                  | create | Build a library's folder list from `Zotero.Collections`; refresh a snapshot's list in place. No paper reads. |
| `src/services/zoteroLibraryService.ts`            | modify | Use `libraryFolderFilters`; export `cachedWholeLibrarySnapshots()`.                                          |
| `src/services/libraryFolderEvents.ts`             | create | Payload-free "library folders changed" publish/subscribe.                                                    |
| `src/services/graphInstancePolicy.ts`             | modify | Pure `folderGraphRetitle` decision.                                                                          |
| `src/services/windowService.ts`                   | modify | Record `titleCollectionIDs` on folder-created views; `retitleFolderGraphs()`.                                |
| `src/services/graphViewService.ts`                | modify | Subscribe per view; refill lookups, prune regions, redraw rail; unsubscribe on cleanup.                      |
| `src/hooks.ts`                                    | modify | Observe `collection`; refresh cached folders, publish, retitle.                                              |
| `test/unit/libraryFolders.test.ts`                | create | Rename, move, delete, trash over a stubbed `Zotero.Collections`.                                             |
| `test/unit/libraryFolderEvents.test.ts`           | create | Subscribe, unsubscribe, a throwing listener.                                                                 |
| `test/unit/folderGraphRetitle.test.ts`            | create | The retitle decision's five cases.                                                                           |
| `test/zotero/folderChangesReachGraph.test.ts`     | create | The whole path through Zotero, with evidence.                                                                |
| `docs/superpowers/handoffs/2026-09-08-roadmap.md` | modify | Tick B58, add the manual check, suite count, log line.                                                       |

---

### Task 1: The folder list as its own module, with an in-place refresh

**Files:**

- Create: `src/services/libraryFolders.ts`
- Modify: `src/services/zoteroLibraryService.ts:188-305` (remove `CollectionInfo`, `allCollectionInfo`, `collectionFilters`), `:326` (call site), after `:73` (new accessor)
- Test: `test/unit/libraryFolders.test.ts`

**Interfaces:**

- Consumes: `LibrarySnapshot`, `LibraryCollectionFilter`, `ZoteroPaper` from `src/domain/types.ts`.
- Produces:
  - `libraryFolderFilters(libraryID: number, papers: readonly ZoteroPaper[]): LibraryCollectionFilter[]`
  - `refreshSnapshotFolders(snapshot: LibrarySnapshot): void`, which replaces `snapshot.collections`
  - `cachedWholeLibrarySnapshots(): LibrarySnapshot[]` (in `zoteroLibraryService.ts`)

- [ ] **Step 1: Write the failing test**

Create `test/unit/libraryFolders.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import type {
  LibraryCollectionFilter,
  LibrarySnapshot,
  ZoteroPaper,
} from "../../src/domain/types";
import { refreshSnapshotFolders } from "../../src/services/libraryFolders";

interface FakeFolder {
  id: number;
  key: string;
  name: string;
  parentID: number | null;
  deleted?: boolean;
}

let folders: FakeFolder[] = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  folders = [];
  (globalThis as Record<string, unknown>).Zotero = {
    Collections: {
      // Deliberately the worst case for trash: a trashed folder is listed.
      // Whether Zotero's own getByLibrary lists one is recorded by the suite.
      getByLibrary: () => [...folders],
      get: (id: number) => folders.find((folder) => folder.id === id) ?? false,
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

function folder(
  id: number,
  name: string,
  parentID: number | null = null,
): FakeFolder {
  const created = { id, key: `K${id}`, name, parentID };
  folders.push(created);
  return created;
}

/** Only `collectionIDs` is read by the folder builder. */
function paperIn(...collectionIDs: number[]): ZoteroPaper {
  return { collectionIDs } as unknown as ZoteroPaper;
}

function snapshotOver(papers: ZoteroPaper[]): LibrarySnapshot {
  const snapshot: LibrarySnapshot = {
    libraryID: 1,
    libraryName: "Test",
    generatedAt: "",
    papers,
    collections: [],
    tags: [],
    statistics: {
      totalPapers: papers.length,
      withoutYear: 0,
      withoutDOI: 0,
      withoutCitationData: 0,
      withoutReferenceData: 0,
    },
  };
  refreshSnapshotFolders(snapshot);
  return snapshot;
}

function entry(
  snapshot: LibrarySnapshot,
  id: number,
): LibraryCollectionFilter | undefined {
  return snapshot.collections.find((c) => c.collectionID === id);
}

describe("refreshing a snapshot's folders (B58)", function () {
  it("carries a rename into the folder's name and path, and its child's path", function () {
    const parent = folder(1, "PhD");
    folder(2, "Chapter 1", 1);
    const snapshot = snapshotOver([paperIn(2)]);
    expect(entry(snapshot, 2)?.path).to.equal("PhD / Chapter 1");

    parent.name = "Thesis";
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 1)?.name).to.equal("Thesis");
    expect(entry(snapshot, 1)?.path).to.equal("Thesis");
    expect(entry(snapshot, 2)?.path).to.equal("Thesis / Chapter 1");
  });

  it("carries a move into the parent, the depth and both parents' reach", function () {
    folder(1, "A");
    folder(2, "B");
    folder(3, "B2", 2);
    const moved = folder(4, "C", 1);
    const snapshot = snapshotOver([]);
    expect(entry(snapshot, 1)?.includedCollectionIDs).to.deep.equal([1, 4]);

    moved.parentID = 3;
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 4)?.parentCollectionID).to.equal(3);
    expect(entry(snapshot, 4)?.depth).to.equal(2);
    expect(entry(snapshot, 1)?.includedCollectionIDs).to.deep.equal([1]);
    expect(entry(snapshot, 2)?.includedCollectionIDs).to.deep.equal([2, 3, 4]);
    expect(entry(snapshot, 3)?.includedCollectionIDs).to.deep.equal([3, 4]);
  });

  it("drops a deleted folder even while a paper still names it", function () {
    folder(1, "Keep");
    folder(2, "Doomed");
    const snapshot = snapshotOver([paperIn(2)]);
    expect(entry(snapshot, 2)).to.exist;

    folders = folders.filter((f) => f.id !== 2);
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 2)).to.equal(undefined);
    expect(entry(snapshot, 1)?.name).to.equal("Keep");
  });

  it("drops a trashed folder, whether listed or reached through a paper", function () {
    folder(1, "Keep");
    const trashed = folder(2, "Trashed");
    const snapshot = snapshotOver([paperIn(2)]);

    trashed.deleted = true;
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 2)).to.equal(undefined);
  });

  it("reads no paper: the snapshot keeps its paper list", function () {
    folder(1, "PhD");
    const papers = [paperIn(1)];
    const snapshot = snapshotOver(papers);
    refreshSnapshotFolders(snapshot);
    expect(snapshot.papers).to.equal(papers);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/libraryFolders.test.ts`
Expected: FAIL. The module `src/services/libraryFolders` cannot be resolved.

- [ ] **Step 3: Create the module**

Create `src/services/libraryFolders.ts`. Move `CollectionInfo`, `allCollectionInfo` and `collectionFilters` here from `zoteroLibraryService.ts` (lines 188–305). The only changes are the export, the rename of `collectionFilters` to `libraryFolderFilters`, the `isLiveCollection` guard in both loops, and the refresh function:

```ts
import type {
  LibraryCollectionFilter,
  LibrarySnapshot,
  ZoteroPaper,
} from "../domain/types";

interface CollectionInfo {
  collectionID: number;
  key: string;
  name: string;
  parentID: number | null;
  orderIndex: number;
}

/**
 * A folder in Zotero's trash is not a folder a graph can show. The paper walk
 * below reaches folders through `paper.collectionIDs`, which a snapshot keeps
 * from before the folder was trashed, so the guard has to be on both paths.
 */
function isLiveCollection(collection: any): boolean {
  return Boolean(collection) && !collection.deleted;
}

function allCollectionInfo(
  libraryID: number,
  papers: readonly ZoteroPaper[],
): Map<number, CollectionInfo> {
  const info = new Map<number, CollectionInfo>();
  try {
    const collections =
      (Zotero.Collections as any).getByLibrary?.(libraryID, true) ?? [];
    collections.forEach((collection: any, index: number) => {
      if (!isLiveCollection(collection)) return;
      const id = Number(collection.id ?? collection.collectionID);
      if (!Number.isFinite(id)) return;
      const parent = Number(
        collection.parentID ?? collection.parentCollectionID ?? 0,
      );
      info.set(id, {
        collectionID: id,
        key: String(collection.key ?? id),
        name: String(collection.name ?? `Collection ${id}`),
        parentID: Number.isFinite(parent) && parent > 0 ? parent : null,
        orderIndex: index,
      });
    });
  } catch {
    // Collection enumeration may be unavailable for some library contexts.
  }
  const pending = new Set(papers.flatMap((paper) => paper.collectionIDs));
  while (pending.size) {
    const id = pending.values().next().value as number;
    pending.delete(id);
    if (info.has(id)) continue;
    try {
      const collection = Zotero.Collections.get(id) as any;
      if (!isLiveCollection(collection)) continue;
      const parent = Number(
        collection.parentID ?? collection.parentCollectionID ?? 0,
      );
      info.set(id, {
        collectionID: id,
        key: String(collection.key ?? id),
        name: String(collection.name ?? `Collection ${id}`),
        parentID: Number.isFinite(parent) && parent > 0 ? parent : null,
        orderIndex: info.size,
      });
      if (parent > 0 && !info.has(parent)) pending.add(parent);
    } catch {
      // Ignore inaccessible or deleted collection records.
    }
  }
  return info;
}

/** A library's folders as the graph reads them: tree order, paths, reach. */
export function libraryFolderFilters(
  libraryID: number,
  papers: readonly ZoteroPaper[],
): LibraryCollectionFilter[] {
  // (body of the old collectionFilters, unchanged from
  //  zoteroLibraryService.ts:251-304 — the children map, descendants,
  //  pathAndDepth and the final sort/map)
}

/**
 * Rebuilds a snapshot's folder list from Zotero and reads no paper (B58). A
 * folder change moves no paper and no citation, so relabelling the rail is
 * one walk of `Zotero.Collections`, not a library reload. Idempotent, and safe
 * on any snapshot, cached or not.
 */
export function refreshSnapshotFolders(snapshot: LibrarySnapshot): void {
  snapshot.collections = libraryFolderFilters(
    snapshot.libraryID,
    snapshot.papers,
  );
}
```

Copy `libraryFolderFilters`'s body verbatim from the old `collectionFilters`. It is the block from `const info = allCollectionInfo(libraryID, papers);` to the closing `});` of the final `.map`. The placeholder comment above marks where it goes. It is not new code to write.

- [ ] **Step 4: Point the library service at it and add the accessor**

In `src/services/zoteroLibraryService.ts`:

1. Delete lines 188–305 (`interface CollectionInfo` through the end of `collectionFilters`).
2. Add `import { libraryFolderFilters } from "./libraryFolders";` below the existing imports.
3. In `buildWholeLibrarySnapshot`, change `const collections = collectionFilters(libraryID, papers);` to `const collections = libraryFolderFilters(libraryID, papers);`.
4. After `clearWholeLibrarySnapshotCache` (line 73), add:

```ts
/**
 * The snapshots the cache holds right now, for a caller that refreshes them in
 * place (B58's folder observer) without reaching into the cache's maps.
 */
export function cachedWholeLibrarySnapshots(): LibrarySnapshot[] {
  return [...cachedLibrarySnapshots.values()];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/libraryFolders.test.ts`
Expected: 5 passing.

Run: `npm run typecheck`
Expected: exit 0. A leftover `collectionFilters` reference or an unused import fails here.

- [ ] **Step 6: Commit**

```bash
git add src/services/libraryFolders.ts src/services/zoteroLibraryService.ts test/unit/libraryFolders.test.ts
git commit -m "B58: a snapshot's folder list can be rebuilt without reading a paper"
```

---

### Task 2: The library-folders-changed event

**Files:**

- Create: `src/services/libraryFolderEvents.ts`
- Test: `test/unit/libraryFolderEvents.test.ts`

**Interfaces:**

- Produces:
  - `publishLibraryFoldersChanged(): void`
  - `subscribeLibraryFoldersChanged(listener: () => void): () => void`

- [ ] **Step 1: Write the failing test**

Create `test/unit/libraryFolderEvents.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import {
  publishLibraryFoldersChanged,
  subscribeLibraryFoldersChanged,
} from "../../src/services/libraryFolderEvents";

let logged: string[] = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  logged = [];
  (globalThis as Record<string, unknown>).Zotero = {
    debug: (message: string) => logged.push(message),
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the library-folders-changed event (B58)", function () {
  it("calls a subscriber and stops calling it once unsubscribed", function () {
    let calls = 0;
    const unsubscribe = subscribeLibraryFoldersChanged(() => {
      calls += 1;
    });
    publishLibraryFoldersChanged();
    expect(calls).to.equal(1);
    unsubscribe();
    publishLibraryFoldersChanged();
    expect(calls, "no call after unsubscribing").to.equal(1);
  });

  it("logs a throwing listener and still calls the next", function () {
    let reached = false;
    const first = subscribeLibraryFoldersChanged(() => {
      throw new Error("boom");
    });
    const second = subscribeLibraryFoldersChanged(() => {
      reached = true;
    });
    try {
      publishLibraryFoldersChanged();
    } finally {
      first();
      second();
    }
    expect(reached, "the second listener ran").to.equal(true);
    expect(logged.join("\n")).to.contain("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/libraryFolderEvents.test.ts`
Expected: FAIL. The module cannot be resolved.

- [ ] **Step 3: Write the module**

Create `src/services/libraryFolderEvents.ts`:

```ts
/*
 * A folder in a library was added, renamed, moved, trashed or deleted (B58).
 * It carries nothing: every open graph rebuilds its own snapshot's folder list,
 * which is one walk of Zotero.Collections, so there is nothing to filter on.
 * hooks.ts publishes it from the library snapshot observer, and each mounted
 * graph subscribes. It is a module of its own for the reason
 * relationshipEvents.ts's manual-relation ping is: hooks.ts reaching into
 * graphViewService would close an import cycle.
 */
type LibraryFoldersChangedListener = () => void;

const listeners = new Set<LibraryFoldersChangedListener>();

export function subscribeLibraryFoldersChanged(
  listener: LibraryFoldersChangedListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishLibraryFoldersChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      Zotero.debug(
        `Meristema: library-folders listener failed: ${String(error)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/libraryFolderEvents.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/libraryFolderEvents.ts test/unit/libraryFolderEvents.test.ts
git commit -m "B58: a payload-free event for a folder change"
```

---

### Task 3: The retitle decision

**Files:**

- Modify: `src/services/graphInstancePolicy.ts` (after `nextGraphViewTitle`, line 113)
- Test: `test/unit/folderGraphRetitle.test.ts`

**Interfaces:**

- Consumes: `nextGraphViewTitle(existingTitles, preferredBase)` (same file).
- Produces: `folderGraphRetitle(currentTitle: string, base: string | null, otherTitles: readonly string[]): string | null`. It returns the new title, or null to keep the current one.

- [ ] **Step 1: Write the failing test**

Create `test/unit/folderGraphRetitle.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { folderGraphRetitle } from "../../src/services/graphInstancePolicy";

describe("retitling a folder graph after its folder changes (B58)", function () {
  it("takes the folder's new name", function () {
    expect(folderGraphRetitle("PhD Graph", "Thesis Graph", [])).to.equal(
      "Thesis Graph",
    );
  });

  it("keeps a title already on the base", function () {
    expect(folderGraphRetitle("PhD Graph", "PhD Graph", [])).to.equal(null);
  });

  it("keeps a numbered title on the base rather than renumbering it", function () {
    expect(
      folderGraphRetitle("PhD Graph 2", "PhD Graph", ["PhD Graph"]),
    ).to.equal(null);
  });

  it("numbers past another tab already holding the new name", function () {
    expect(
      folderGraphRetitle("PhD Graph", "Thesis Graph", ["Thesis Graph"]),
    ).to.equal("Thesis Graph 2");
  });

  it("keeps the title when the folders name nothing", function () {
    expect(folderGraphRetitle("PhD Graph", null, [])).to.equal(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/folderGraphRetitle.test.ts`
Expected: FAIL. `folderGraphRetitle` is not exported (`undefined is not a function`).

- [ ] **Step 3: Write the function**

In `src/services/graphInstancePolicy.ts`, after `nextGraphViewTitle`:

```ts
/**
 * The title a folder graph's tab moves to once its folders have changed (B58),
 * or null to keep the one it has. `base` is what the folders make now, from
 * `multiCollectionGraphTitle`. A tab already on that base, numbered or not,
 * is left alone, so a change to some other folder never renumbers it.
 * Otherwise the tab takes the base the way a new graph would, numbered past
 * the other tabs' titles.
 */
export function folderGraphRetitle(
  currentTitle: string,
  base: string | null,
  otherTitles: readonly string[],
): string | null {
  if (!base) return null;
  const current = currentTitle.trim();
  if (current === base) return null;
  if (
    current.startsWith(`${base} `) &&
    /^\d+$/.test(current.slice(base.length + 1))
  ) {
    return null;
  }
  return nextGraphViewTitle(otherTitles, base);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/folderGraphRetitle.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphInstancePolicy.ts test/unit/folderGraphRetitle.test.ts
git commit -m "B58: decide a folder graph's title from its folders' current names"
```

---

### Task 4: The Zotero suite, red

**Files:**

- Create: `test/zotero/folderChangesReachGraph.test.ts`

**Interfaces:**

- Consumes: the plugin's Tools › Meristema › New Graph command (`${config.addonRef}-new-graph-view-command`), the collection context menu's `${config.addonRef}-collection-new-graph-command` in `#zotero-collectionmenu`, the rail DOM (`.cm-scope-row`, `[data-collection-id]`, `.cm-scope-row-label`, `.cm-scope-row-selected`), and `Zotero_Tabs._tabs[].title`.

- [ ] **Step 1: Write the suite**

Create `test/zotero/folderChangesReachGraph.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const FOLDER_NAME = "B58 fixture folder";
const RENAMED = "B58 renamed folder";
const DOOMED_NAME = "B58 doomed folder";
const TRASHED_NAME = "B58 trashed folder";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

/** A child of a popup by its l10n ID; the failure lists what was there. */
function customMenu(popup: Element, l10nID: string): any {
  const children = Array.from(popup.children) as HTMLElement[];
  const menu = children.find((child) => child.dataset?.l10nId === l10nID);
  expect(
    menu,
    `menu ${l10nID}; the popup offered ${children
      .map((child) => child.dataset?.l10nId ?? child.id ?? child.localName)
      .join(", ")}`,
  ).to.exist;
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
 * B58: a folder change reaches open graphs, new graphs and a folder graph's
 * tab title, without a restart and without remounting. Driven through the
 * plugin's own menus and read from the rendered DOM, since the test bundle is
 * a second copy of the plugin. The cases run in order and share the fixture:
 * the rename in the first is what the next two read.
 *
 * What only Zotero can answer is printed as `B58 evidence:` lines and carried
 * in the assertion messages: which notifications a folder change fires, and
 * whether a trashed folder is still listed by `getByLibrary`.
 */
describe("Folder changes reach the graph (B58)", function () {
  let win: any;
  let libraryTabID: string | null = null;
  let folderTabID: string | null = null;
  let folderID: number | null = null;
  let doomedID: number | null = null;
  let trashedID: number | null = null;
  let fixtureIDs: number[] = [];
  let notifierID: string | null = null;
  const notifications: string[] = [];

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  function tabTitle(tabID: string | null): string {
    return String(
      (win.Zotero_Tabs._tabs as any[]).find((tab) => tab.id === tabID)?.title ??
        "",
    );
  }

  function rootOf(tabID: string | null): HTMLElement {
    const root = (
      tabID
        ? (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null)
        : null
    )?.querySelector(".meristema-root") as HTMLElement | null;
    expect(root, `the graph in tab ${tabID} is rendered`).to.exist;
    return root as HTMLElement;
  }

  function rowBody(tabID: string | null, id: number): HTMLElement | null {
    return rootOf(tabID).querySelector(
      `.cm-scope-row [data-collection-id="${id}"]`,
    ) as HTMLElement | null;
  }

  function rowLabel(tabID: string | null, id: number): string {
    return (
      rowBody(tabID, id)
        ?.closest(".cm-scope-row")
        ?.querySelector(".cm-scope-row-label")
        ?.textContent?.trim() ?? ""
    );
  }

  function evidence(): string {
    return `notifications [${notifications.join(" | ")}]`;
  }

  async function waitForNewGraphTab(already: Set<string>): Promise<string> {
    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the new graph's tab").to.exist;
    const tabID = tab!.id as string;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        (
          win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
        )?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the new graph's Scope rail").to.exist;
    return tabID;
  }

  async function openLibraryGraph(): Promise<string> {
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    command(
      customMenu(tools.menupopup, `${config.addonRef}-new-graph-view-command`),
    );
    (toolsPopup as any).hidePopup();
    return waitForNewGraphTab(already);
  }

  async function openFolderGraph(id: number): Promise<string> {
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
    await win.ZoteroPane.collectionsView.selectCollection(id);
    const popup = doc.getElementById("zotero-collectionmenu")!;
    expect(popup, "Zotero's collection context menu").to.exist;
    const showing = shown(popup);
    (popup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    command(
      customMenu(popup, `${config.addonRef}-collection-new-graph-command`),
    );
    (popup as any).hidePopup();
    return waitForNewGraphTab(already);
  }

  before(async function () {
    this.timeout(120_000);
    win = Zotero.getMainWindows()[0];
    notifierID = Zotero.Notifier.registerObserver(
      {
        notify(
          event: string,
          type: string,
          ids: Array<number | string>,
          extraData?: unknown,
        ) {
          notifications.push(
            `${type}:${event}:${ids.join(",")}:${JSON.stringify(extraData ?? null)}`,
          );
        },
      },
      ["item", "collection", "collection-item"],
      "meristema-b58-evidence",
    );
    const libraryID = Zotero.Libraries.userLibraryID;
    const ids: number[] = [];
    for (const name of [FOLDER_NAME, DOOMED_NAME, TRASHED_NAME]) {
      const collection = new Zotero.Collection();
      collection.libraryID = libraryID;
      collection.name = name;
      const id = await collection.saveTx();
      ids.push(id);
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", `${name} paper`);
      item.setField("date", "2022");
      item.addToCollection(id);
      fixtureIDs.push(await item.saveTx());
    }
    [folderID, doomedID, trashedID] = ids;

    folderTabID = await openFolderGraph(folderID!);
    libraryTabID = await openLibraryGraph();
    for (const id of ids) {
      await waitFor(() => rowBody(libraryTabID, id), 10_000);
    }
    notifications.length = 0;
  });

  after(async function () {
    this.timeout(30_000);
    for (const tabID of [libraryTabID, folderTabID]) {
      if (tabID) win.Zotero_Tabs.close(tabID);
    }
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    for (const id of [folderID, doomedID, trashedID]) {
      if (id === null) continue;
      const collection = Zotero.Collections.get(id) as any;
      if (collection) await collection.eraseTx();
    }
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  });

  it("relabels an open graph's row when its folder is renamed, without remounting", async function () {
    this.timeout(30_000);
    expect(rowLabel(libraryTabID, folderID!)).to.equal(FOLDER_NAME);
    const rootBefore = rootOf(libraryTabID);

    const collection = Zotero.Collections.get(folderID!) as any;
    collection.name = RENAMED;
    await collection.saveTx();
    await waitFor(() => rowLabel(libraryTabID, folderID!) === RENAMED, 5_000);

    console.log(`B58 evidence: rename fired ${evidence()}`);
    expect(
      rowLabel(libraryTabID, folderID!),
      `the open graph's row; ${evidence()}`,
    ).to.equal(RENAMED);
    expect(rootOf(libraryTabID) === rootBefore, "the graph did not remount").to
      .be.true;
  });

  it("retitles the tab of a graph opened from that folder", async function () {
    this.timeout(15_000);
    const expected = `${RENAMED} Graph`;
    await waitFor(() => tabTitle(folderTabID).startsWith(expected), 5_000);
    expect(
      tabTitle(folderTabID),
      `the folder graph's tab; ${evidence()}`,
    ).to.match(new RegExp(`^${RENAMED} Graph( \\d+)?$`));
    expect(rowLabel(folderTabID, folderID!), "and its own rail row").to.equal(
      RENAMED,
    );
  });

  it("shows the new name in a graph opened after the rename", async function () {
    this.timeout(60_000);
    const tabID = await openLibraryGraph();
    try {
      await waitFor(() => rowBody(tabID, folderID!), 10_000);
      expect(
        rowLabel(tabID, folderID!),
        `a new graph reads the renamed folder; ${evidence()}`,
      ).to.equal(RENAMED);
    } finally {
      win.Zotero_Tabs.close(tabID);
      await delay(300);
    }
  });

  it("drops a deleted folder's row and region without remounting", async function () {
    this.timeout(30_000);
    const body = rowBody(libraryTabID, doomedID!);
    expect(body, "the doomed folder's row").to.exist;
    body!.click();
    await waitFor(
      () =>
        rowBody(libraryTabID, doomedID!)
          ?.closest(".cm-scope-row")
          ?.classList.contains("cm-scope-row-selected"),
      5_000,
    );
    const rootBefore = rootOf(libraryTabID);
    notifications.length = 0;

    await (Zotero.Collections.get(doomedID!) as any).eraseTx();
    await waitFor(() => rowBody(libraryTabID, doomedID!) === null, 5_000);

    const itemNotifications = notifications.filter((line) =>
      line.startsWith("item:"),
    );
    console.log(
      `B58 evidence: delete fired ${evidence()}; item notifications: ${itemNotifications.length}`,
    );
    expect(
      rowBody(libraryTabID, doomedID!),
      `the deleted folder's row is gone; ${evidence()}`,
    ).to.equal(null);
    expect(
      rootOf(libraryTabID).querySelectorAll(".cm-scope-row-selected").length,
      "no row is still drawn as a region",
    ).to.equal(0);
    expect(rootOf(libraryTabID) === rootBefore, "the graph did not remount").to
      .be.true;
  });

  it("drops a trashed folder's row", async function () {
    this.timeout(30_000);
    notifications.length = 0;
    const collection = Zotero.Collections.get(trashedID!) as any;
    collection.deleted = true;
    await collection.saveTx();
    await waitFor(() => rowBody(libraryTabID, trashedID!) === null, 5_000);

    const listed = (
      (Zotero.Collections as any).getByLibrary(
        Zotero.Libraries.userLibraryID,
        true,
      ) as any[]
    ).some((entry) => Number(entry.id) === trashedID);
    console.log(
      `B58 evidence: trash fired ${evidence()}; getByLibrary lists the trashed folder: ${listed}`,
    );
    expect(
      rowBody(libraryTabID, trashedID!),
      `the trashed folder's row is gone; getByLibrary lists it: ${listed}; ${evidence()}`,
    ).to.equal(null);
  });
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run, in the background, and wait for the task to exit before any further run:

```powershell
npm test 2>&1 | Tee-Object -FilePath "$env:TEMP\claude\...\scratchpad\b58-red.log"
```

(use the session's scratchpad path in full). Then search the log for `B58` and the summary line.

Expected: the first three cases FAIL. The row still reads `B58 fixture folder`, the tab title is unchanged, and a new graph still reads the old name. The delete and trash cases are likely red too. Any other suite's red is not this plan's and is noted, not chased. If the setup fails with `undefined`, the setup threw. The first suspect is `#zotero-collectionmenu`'s id or its child's `data-l10n-id`, and the `customMenu` message lists what the popup offered.

- [ ] **Step 3: Commit the red suite**

```bash
git add test/zotero/folderChangesReachGraph.test.ts
git commit -m "B58: Zotero suite for folder changes reaching the graph (red)"
```

---

### Task 5: Wire the observer, the open graph and the tab title

**Files:**

- Modify: `src/hooks.ts:46-50` (imports), `:56-63` (windowService import), `:166-211` (observer)
- Modify: `src/services/graphViewService.ts:404-416` (lookups), `:4581-4590` (subscription), `:5061` (cleanup), imports
- Modify: `src/services/windowService.ts:36-45` (import), `:71-112` (instance state), `:140-150` (create), `:1366-1388` (options), `:1454-1456` (open), `:1804-1815` (collections), new export near `renameGraphView`

**Interfaces:**

- Consumes: `refreshSnapshotFolders`, `libraryFolderFilters` (Task 1); `cachedWholeLibrarySnapshots` (Task 1); `publishLibraryFoldersChanged`, `subscribeLibraryFoldersChanged` (Task 2); `folderGraphRetitle` (Task 3); existing `collectionLabelsByID`, `regionsStillInLibrary`, `applyFilters`, `refreshScopeRail`, `multiCollectionGraphTitle`, `syncInstanceTitle`.
- Produces: `retitleFolderGraphs(): void` exported from `windowService.ts`.

- [ ] **Step 1: The open graph adopts the new folders**

In `src/services/graphViewService.ts`:

1. Add the imports:

```ts
import { subscribeLibraryFoldersChanged } from "./libraryFolderEvents";
import { refreshSnapshotFolders } from "./libraryFolders";
```

2. Replace lines 408–416 (the "built once: the snapshot's folders never move" comment and the `descendantsByID` construction) with:

```ts
/** Each folder's descendants, excluding itself, from the snapshot's list. */
const folderDescendants = (): Array<[number, readonly number[]]> =>
  snapshot.collections.map((collection) => [
    collection.collectionID,
    collection.includedCollectionIDs.filter(
      (id) => id !== collection.collectionID,
    ),
  ]);
/**
 * Folder tree lookups. A folder change refills these and `collectionLabels`
 * in place (B58) rather than replacing them, because the renderer holds
 * `collectionLabels` by reference for region legends and sees the new
 * labels without being told.
 */
const descendantsByID = new Map<number, readonly number[]>(folderDescendants());
```

3. Directly after the `unsubscribeRelationshipPublications` subscription (ends line 4590), add:

```ts
// B58: a folder was added, renamed, moved, trashed or deleted. This graph's
// snapshot may be older than the cached one (an item change since mount
// rebuilt the cache), so it is refreshed here rather than trusted. A gone
// folder's region goes at once, as B23 does on reopen; ticks stay as stored.
// Never a remount: a remount is a reopen, and a reopen restarts a stopped
// fill (B55). Done whether or not the view is active; it is a rail redraw.
const unsubscribeLibraryFolders = subscribeLibraryFoldersChanged(() => {
  if (cleaned) return;
  refreshSnapshotFolders(snapshot);
  collectionLabels.clear();
  for (const [id, label] of collectionLabelsByID(snapshot)) {
    collectionLabels.set(id, label);
  }
  descendantsByID.clear();
  for (const [id, descendants] of folderDescendants()) {
    descendantsByID.set(id, descendants);
  }
  regions = regionsStillInLibrary(regions, snapshot.collections);
  applyFilters();
  refreshScopeRail();
});
```

4. In the cleanup, after `unsubscribeRelationshipPublications();` (line 5061), add `unsubscribeLibraryFolders();`.

Check that `regionsStillInLibrary`'s first parameter accepts `number[]` (`graphScopeRailModel.ts:195`). `applyState` already calls it with `state.regions`, so the call shape is the same.

- [ ] **Step 2: The window service records and retitles folder graphs**

In `src/services/windowService.ts`:

1. Add `folderGraphRetitle,` to the `./graphInstancePolicy` import list, before `graphInstanceShouldRender,`.

2. In `interface GraphInstanceState`, after `pendingCollectionIDs: number[];`, add:

```ts
  /**
   * The folders this view's default title was taken from, so a folder rename
   * can retitle the tab (B58). Null for a view not titled after folders, and
   * ignored once `customTitle` is set.
   */
  titleCollectionIDs: number[] | null;
```

3. In `createGraphInstance`'s literal, after `pendingCollectionIDs: [],`, add `titleCollectionIDs: null,`.

4. In `interface OpenGraphOptions`, after `titleBase?: string;`, add:

```ts
  /** The folders `titleBase` names; kept on a newly created view (B58). */
  titleCollectionIDs?: readonly number[];
```

5. In `openGraphWindow`, change

```ts
if (!instance) {
  instance = createGraphInstance(win, targetLibraryID, options.titleBase);
}
```

to

```ts
if (!instance) {
  instance = createGraphInstance(win, targetLibraryID, options.titleBase);
  instance.titleCollectionIDs = options.titleCollectionIDs
    ? [...options.titleCollectionIDs]
    : null;
}
```

6. In `openGraphForCollections`, add `titleCollectionIDs: collectionIDs,` after the `titleBase:` property.

7. After `renameGraphView`, add:

```ts
/**
 * Retitles every folder graph whose tab still carries the default name taken
 * from its folders, after a folder change (B58). A title the user typed, a
 * saved graph's name and a restored tab's title are `customTitle` and never
 * touched. A graph with one of its folders gone or in the trash keeps its
 * title rather than being renamed after the folders that remain.
 */
export function retitleFolderGraphs(): void {
  for (const [win, state] of graphStateByWindow) {
    if (win.closed) continue;
    const instances = [...state.instances.values()];
    for (const instance of instances) {
      if (instance.customTitle || !instance.titleCollectionIDs?.length) {
        continue;
      }
      const collections = instance.titleCollectionIDs.map(
        (id) => Zotero.Collections.get(id) as any,
      );
      if (collections.some((collection) => !collection || collection.deleted)) {
        continue;
      }
      const title = folderGraphRetitle(
        instance.title,
        multiCollectionGraphTitle(
          collections.map((collection) => collection.name),
        ),
        instances
          .filter((other) => other !== instance)
          .map((other) => other.title),
      );
      if (!title) continue;
      instance.title = title;
      syncInstanceTitle(win, instance);
    }
  }
}
```

- [ ] **Step 3: The observer**

In `src/hooks.ts`:

1. Extend the `zoteroLibraryService` import with `cachedWholeLibrarySnapshots,`. Add `import { refreshSnapshotFolders } from "./services/libraryFolders";` and `import { publishLibraryFoldersChanged } from "./services/libraryFolderEvents";`. Add `retitleFolderGraphs,` to the `./services/windowService` import list.

2. Above `registerLibrarySnapshotInvalidation`, add:

```ts
/**
 * A folder added, renamed, moved, trashed or deleted (B58). Only folder lists
 * are rebuilt: a folder change moves no paper and no citation, so the library
 * snapshot and the citation caches stand. Every cached snapshot is refreshed
 * rather than the folder's own library, because a deleted folder may no longer
 * be there to ask, and the cache holds at most two. Open graphs refresh their
 * own snapshots on the event, and a folder graph's default tab title follows.
 * Not in automaticUpdateCoordinator: that observer queues citation fetches.
 */
function refreshLibraryFolders(): void {
  for (const snapshot of cachedWholeLibrarySnapshots()) {
    refreshSnapshotFolders(snapshot);
  }
  publishLibraryFoldersChanged();
  retitleFolderGraphs();
}
```

3. In the observer's `notify`, replace `if (type !== "item") return;` with:

```ts
if (type === "collection") {
  refreshLibraryFolders();
  return;
}
if (type !== "item") return;
```

4. Change the registration's types from `["item"]` to `["item", "collection"]`.

- [ ] **Step 4: Typecheck and the unit suite**

Run: `npm run check`
Expected: exit 0 (prettier, eslint, both tsconfigs, all unit tests including the 12 new cases).

- [ ] **Step 5: Run the Zotero suite to verify it passes**

Run in the background, as in Task 4, logging to `b58-green-1.log`. Wait for the task to exit.
Expected: every `Folder changes reach the graph (B58)` case passes, and the rest of the suite is as green as it was (72 passed before this branch; 77 expected). Read the `B58 evidence:` lines and keep them for the roadmap entry. If a case is timing-shaped (a `waitFor` that passed near its deadline), run the suite a second time (`b58-green-2.log`), per project practice.

- [ ] **Step 6: Commit**

```bash
git add src/hooks.ts src/services/graphViewService.ts src/services/windowService.ts
git commit -m "B58: folder changes relabel open graphs in place and retitle folder graphs"
```

---

### Task 6: Record it, verify, build

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md` (B58 entry at ~747, Manual verification section end at ~1471, Zotero suite paragraph at ~1477, Log)
- Modify: `.superpowers/sdd/progress.md` (append one line in its existing format)

- [ ] **Step 1: Tick B58 in the roadmap**

Change `- [ ] B58` to `- [x] B58`. Then append, indented to match the entry, a paragraph that starts `Fixed 2026-09-14.` and states:

- the decision: relabel in place, spec `2026-09-14-folder-changes-reach-graph-design.md`;
- that the entry's `automaticUpdateCoordinator.ts` suggestion was wrong and why;
- that the snapshot is not dropped on a folder change;
- that a folder graph's default tab title now follows, folded in at review in place of filing B62;
- what the `B58 evidence:` lines showed for the three runtime unknowns;
- the suite file that guards it.

- [ ] **Step 2: Add the manual check**

Append after the last B44/B59 check in `## Manual verification`:

```markdown
- [ ] B58: with a graph open on the real library, rename a folder in Zotero's
      collection tree. The rail shows the new name at once, without a reopen;
      if a hop fill was stopped, it stays stopped; and a graph opened after
      the rename shows the new name too. Open a graph from that folder's
      context menu and rename the folder again: the tab's title follows. Rename
      that tab yourself, rename the folder once more, and the tab keeps the
      name you typed.
```

- [ ] **Step 3: Update the suite count and the log**

In `## Zotero suite`, update the count to the green run's `passed`/`failed` figures. Append to `## Log`:

```markdown
- 2026-09-14: B58 ticked; folder changes rebuild only the folder lists, open graphs refill their lookups in place and folder graphs' default tab titles follow (folder-changes-reach-graph, commits after a5571ff). Zotero suite added.
```

- [ ] **Step 4: Format and full verification**

Run: `npx prettier --write docs/superpowers/handoffs/2026-09-08-roadmap.md docs/superpowers/specs/2026-09-14-folder-changes-reach-graph-design.md docs/superpowers/plans/2026-09-14-folder-changes-reach-graph.md`
Run: `npm run check`
Expected: exit 0.

- [ ] **Step 5: Commit, fast-forward main, build**

```bash
git add docs .superpowers/sdd/progress.md
git commit -m "B58: ticked, with the manual check and the suite's evidence"
git switch main
git merge --ff-only folder-changes-reach-graph
npm run build
```

Expected: `.scaffold/build/meristema.xpi` exists afterwards. Do not push; the user pushes.
