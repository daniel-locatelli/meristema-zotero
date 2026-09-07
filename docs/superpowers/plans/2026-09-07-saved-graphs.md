# Saved Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A graph can be saved under a name, autosaves once it has one, and is opened again later from the graph's own toolbar or from Tools › Meristema; the item context menu says what its entries do.

**Architecture:** The plugin's SQLite connection moves into a shared `pluginDatabase.ts`. A DOM-free `savedGraphService.ts` stores `GraphViewState` recipes in a `saved_graphs_v1` table, with its SQL logic in a store factory that unit tests drive through Node's built-in SQLite. The view gets a Graph menu (Save, Save as, Open) that talks to a small host interface; the window service implements that host on the instance, owns `savedGraphID`, prompts for names, autosaves debounced writes, and opens saved graphs into new tabs. The menu service adds Open Saved Graph… under Tools and reworks the item context menu labels.

**Tech Stack:** TypeScript, Zotero 7 plugin, hand-built DOM, `Zotero.DBConnection`, `node --test` with chai and `node:sqlite` for unit tests, the Zotero visual harness for view tests.

This is phase 2 of `docs/superpowers/specs/2026-09-07-durable-graphs-design.md`. Phase 1 (`docs/superpowers/plans/2026-09-07-refresh-preserves-state.md`) is merged; every task below builds on `GraphViewState`, `getState`/`applyState`, `initialState`, `onStateChange` and `GraphInstanceState.viewState` from it.

## Global Constraints

- `npm run check` (lint, typecheck, unit tests) is the gate for every task. Never run `npm test` and never start or stop Zotero; `test/zotero/*` runs only inside Zotero and is the user's to run. Before this plan, `npm run test:unit` reports 202 passing tests.
- Commit messages: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa`. Stage by path, never `git add -A`.
- Run `npx prettier --write` on any `docs/` or `README.md` file you change before committing.
- `test/unit` has no DOM shim and must stay free of `Zotero.*`; a module imported by a unit test may reference `Zotero` only inside functions the test never calls. DOM behaviour is tested in `test/zotero/graphViewVisual.test.ts`.
- Table and connection names are fixed: the connection is `` `${config.addonRef}-external` `` (the existing `meristema-external` database), the table is `saved_graphs_v1` with the index `saved_graphs_v1_library`.
- Names are trimmed and must be non-empty; two graphs may share a name. Nothing syncs; the table is local to the profile.
- Autosave is debounced by 500 ms and coalesced; the first `onStateChange` echo after a view opens must not write. A failed write is logged and the toolbar status reads "Autosave failed"; the graph stays open and the next change retries.
- Wording: the Graph menu items are "Save", "Save as…", "Open"; the empty list reads "No saved graphs yet."; a row deleted between listing and opening reports "This graph was deleted."; the item context menu reads "New Graph from item" / "New Graph from N items" and "Add as seed to X"; "Show in X" and "Show in New Graph" are unchanged.
- Toolbar order after this plan: Filter, Seeds, Similar, Export, Graph, Refresh.

---

### Task 1: Shared plugin database connection

**Files:**

- Create: `src/services/pluginDatabase.ts`
- Modify: `src/services/externalWorkCacheService.ts` (imports, `initExternalWorkCache` ~line 300, `closeExternalWorkCache` ~line 356)
- Modify: `src/hooks.ts` (imports, `onShutdown` ~line 349)

**Interfaces:**

- Consumes: `config.addonRef` from `package.json`; `Zotero.DBConnection`.
- Produces, exported from `src/services/pluginDatabase.ts`:

```ts
export function openPluginDatabase(): Promise<_ZoteroTypes.DBConnection>;
export function getPluginDatabase(): _ZoteroTypes.DBConnection | null;
export function closePluginDatabase(): Promise<void>;
```

`openPluginDatabase` is idempotent: it returns the same connection on every call and coalesces concurrent first calls. `closePluginDatabase` closes it and forgets it; a later `openPluginDatabase` opens a fresh one.

- [ ] **Step 1: Write the module**

Create `src/services/pluginDatabase.ts`:

```ts
import { config } from "../../package.json";

/**
 * The plugin's one SQLite file, `meristema-external.sqlite` in the profile.
 * The external work cache and the saved graphs share it, so neither depends
 * on the other's lifecycle: hooks open it before either store initialises
 * and close it after both have let go.
 *
 * `Zotero.DBConnection` opens the file lazily on the first query, so the
 * constructor here is cheap and cannot fail on a missing file.
 */
let connection: _ZoteroTypes.DBConnection | null = null;
let opening: Promise<_ZoteroTypes.DBConnection> | null = null;

export function openPluginDatabase(): Promise<_ZoteroTypes.DBConnection> {
  if (connection) return Promise.resolve(connection);
  if (opening) return opening;
  opening = Promise.resolve()
    .then(() => {
      const created = new Zotero.DBConnection(`${config.addonRef}-external`);
      connection = created;
      return created;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

export function getPluginDatabase(): _ZoteroTypes.DBConnection | null {
  return connection;
}

export async function closePluginDatabase(): Promise<void> {
  if (opening) await opening.catch(() => undefined);
  const current = connection;
  connection = null;
  if (current) await current.closeDatabase(true).catch(() => undefined);
}
```

- [ ] **Step 2: Make the external work cache use it**

In `src/services/externalWorkCacheService.ts`:

Add the import after the `config` import:

```ts
import { openPluginDatabase } from "./pluginDatabase";
```

In `initExternalWorkCache`, replace

```ts
const connection = new Zotero.DBConnection(`${config.addonRef}-external`);
```

with

```ts
const connection = await openPluginDatabase();
```

and replace the `catch` at the end of the same async function,

```ts
    } catch (error) {
      await connection.closeDatabase(true).catch(() => undefined);
      throw error;
    }
```

with

```ts
    } catch (error) {
      // The connection is shared; hooks close it at shutdown.
      throw error;
    }
```

(Keep the `try` body as it is. If lint prefers, drop the `try`/`catch` entirely and let the error propagate; the behaviour is the same.)

In `closeExternalWorkCache`, delete the last line `if (connection) await connection.closeDatabase(true).catch(() => undefined);` and the `const connection = db;` line above it; the function now ends after `relationshipDependencyIndex.clear();`. The `db = null;` assignment stays.

If `config` is no longer used in the file after this, remove its import.

- [ ] **Step 3: Close it from hooks after both stores**

In `src/hooks.ts`, add the import:

```ts
import { closePluginDatabase } from "./services/pluginDatabase";
```

In `onShutdown`, after the `closeCitationMetricsStore()` await and before `delete (Zotero as any)[config.addonInstance];`, add:

```ts
await closePluginDatabase().catch((error: unknown) =>
  Zotero.logError(error instanceof Error ? error : new Error(String(error))),
);
```

Startup needs no change: `initExternalWorkCache` opens the connection on demand, and the saved graph service (Task 2) does the same.

- [ ] **Step 4: Run the gate**

Run: `npm run check`
Expected: lint clean, typecheck clean, 202 unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/pluginDatabase.ts src/services/externalWorkCacheService.ts src/hooks.ts
git commit -F - <<'MSG'
Share the plugin's SQLite connection through pluginDatabase

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 2: Saved graph service

**Files:**

- Create: `src/services/savedGraphService.ts`
- Test: `test/unit/savedGraphService.test.ts`

**Interfaces:**

- Consumes: `openPluginDatabase` from Task 1; `GraphViewState`, `serializeGraphViewState`, `parseGraphViewState`, `emptyGraphViewState` from `src/services/graphViewState.ts`.
- Produces, exported from `src/services/savedGraphService.ts`:

```ts
export interface SavedGraphSummary {
  id: number;
  libraryID: number;
  name: string;
  created: string; // ISO 8601
  modified: string; // ISO 8601
}
export interface SavedGraph {
  summary: SavedGraphSummary;
  state: GraphViewState;
}
/** The subset of `Zotero.DBConnection` the store uses; tests hand in a fake. */
export interface SavedGraphConnection {
  queryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  valueQueryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  executeTransaction<T>(task: () => Promise<T>): Promise<T>;
}
export interface SavedGraphStore {
  ensureSchema(): Promise<void>;
  list(libraryID: number): Promise<SavedGraphSummary[]>;
  /** Null when the row is gone. A row whose state no longer parses loads as an empty graph. */
  load(id: number): Promise<SavedGraph | null>;
  create(
    libraryID: number,
    name: string,
    state: GraphViewState,
  ): Promise<SavedGraphSummary>;
  update(id: number, state: GraphViewState): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}
export function createSavedGraphStore(
  connection: SavedGraphConnection,
  now?: () => string,
): SavedGraphStore;
export function normalizeSavedGraphName(name: string): string; // trims; throws on empty

// Bound to the plugin database; each opens it and ensures the schema on first use.
export function listSavedGraphs(
  libraryID: number,
): Promise<SavedGraphSummary[]>;
export function loadSavedGraph(id: number): Promise<SavedGraph | null>;
export function createSavedGraph(
  libraryID: number,
  name: string,
  state: GraphViewState,
): Promise<SavedGraphSummary>;
export function updateSavedGraph(
  id: number,
  state: GraphViewState,
): Promise<void>;
export function renameSavedGraph(id: number, name: string): Promise<void>;
export function deleteSavedGraph(id: number): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/savedGraphService.test.ts`. It drives the store through Node's built-in SQLite so the SQL is real; the fake connection only adapts `DatabaseSync` to the three methods the store calls.

```ts
import { describe, it } from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect } from "chai";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createSavedGraphStore,
  normalizeSavedGraphName,
  type SavedGraphConnection,
  type SavedGraphStore,
} from "../../src/services/savedGraphService";

function fakeConnection(db: DatabaseSync): SavedGraphConnection {
  const bind = (params: unknown[] | undefined): SQLInputValue[] =>
    (params ?? []) as SQLInputValue[];
  return {
    async queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return statement.all(...bind(params));
      statement.run(...bind(params));
      return undefined;
    },
    async valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params)) as
        Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : false;
    },
    async executeTransaction(task) {
      db.exec("BEGIN");
      try {
        const result = await task();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function openStore(): Promise<{
  store: SavedGraphStore;
  db: DatabaseSync;
  tick: () => void;
}> {
  const db = new DatabaseSync(":memory:");
  let clock = 0;
  const now = (): string =>
    new Date(Date.UTC(2026, 8, 7, 12, 0, clock)).toISOString();
  const store = createSavedGraphStore(fakeConnection(db), now);
  await store.ensureSchema();
  return { store, db, tick: () => (clock += 1) };
}

function seededState(itemKey: string) {
  return {
    ...emptyGraphViewState(),
    seeds: [{ kind: "item" as const, itemKey }],
    title: "Seeded",
  };
}

describe("normalizeSavedGraphName", function () {
  it("trims the name", function () {
    expect(normalizeSavedGraphName("  PhD map ")).to.equal("PhD map");
  });

  it("rejects a blank name", function () {
    expect(() => normalizeSavedGraphName("   ")).to.throw(/name/);
  });
});

describe("saved graph store", function () {
  it("creates the schema once and tolerates a second call", async function () {
    const { store, db } = await openStore();
    await store.ensureSchema();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).to.include("saved_graphs_v1");
  });

  it("creates a row and returns its summary", async function () {
    const { store } = await openStore();
    const summary = await store.create(1, "  Alpha ", seededState("AAAA0001"));
    expect(summary.id).to.be.a("number").and.to.be.greaterThan(0);
    expect(summary.libraryID).to.equal(1);
    expect(summary.name).to.equal("Alpha");
    expect(summary.created).to.equal(summary.modified);
  });

  it("rejects a blank name on create and rename", async function () {
    const { store } = await openStore();
    let failed = false;
    try {
      await store.create(1, " ", emptyGraphViewState());
    } catch {
      failed = true;
    }
    expect(failed, "create rejected").to.equal(true);
    const created = await store.create(1, "Ok", emptyGraphViewState());
    failed = false;
    try {
      await store.rename(created.id, "");
    } catch {
      failed = true;
    }
    expect(failed, "rename rejected").to.equal(true);
    expect((await store.load(created.id))?.summary.name).to.equal("Ok");
  });

  it("lists one library's graphs by name, case-insensitively", async function () {
    const { store } = await openStore();
    await store.create(1, "beta", emptyGraphViewState());
    await store.create(1, "Alpha", emptyGraphViewState());
    await store.create(2, "Other library", emptyGraphViewState());
    await store.create(1, "charlie", emptyGraphViewState());
    const names = (await store.list(1)).map((summary) => summary.name);
    expect(names).to.deep.equal(["Alpha", "beta", "charlie"]);
    expect((await store.list(3)).length).to.equal(0);
  });

  it("loads the state it stored", async function () {
    const { store } = await openStore();
    const state = seededState("BBBB0002");
    const created = await store.create(1, "Round trip", state);
    const loaded = await store.load(created.id);
    expect(loaded?.summary).to.deep.equal(created);
    expect(loaded?.state).to.deep.equal(state);
  });

  it("returns null for an id that does not exist", async function () {
    const { store } = await openStore();
    expect(await store.load(999)).to.equal(null);
  });

  it("update replaces the state and bumps modified", async function () {
    const { store, tick } = await openStore();
    const created = await store.create(1, "Growing", seededState("AAAA0001"));
    tick();
    await store.update(created.id, seededState("CCCC0003"));
    const loaded = await store.load(created.id);
    expect(loaded?.state.seeds).to.deep.equal([
      { kind: "item", itemKey: "CCCC0003" },
    ]);
    expect(loaded?.summary.created).to.equal(created.created);
    expect(loaded!.summary.modified > created.modified).to.equal(true);
  });

  it("rename changes the name and bumps modified", async function () {
    const { store, tick } = await openStore();
    const created = await store.create(1, "Before", emptyGraphViewState());
    tick();
    await store.rename(created.id, " After ");
    const loaded = await store.load(created.id);
    expect(loaded?.summary.name).to.equal("After");
    expect(loaded!.summary.modified > created.modified).to.equal(true);
  });

  it("remove deletes the row", async function () {
    const { store } = await openStore();
    const created = await store.create(1, "Gone soon", emptyGraphViewState());
    await store.remove(created.id);
    expect(await store.load(created.id)).to.equal(null);
    expect((await store.list(1)).length).to.equal(0);
  });

  it("loads a row whose state no longer parses as an empty graph", async function () {
    const { store, db } = await openStore();
    const created = await store.create(1, "Corrupt", seededState("AAAA0001"));
    db.prepare("UPDATE saved_graphs_v1 SET state = ? WHERE id = ?").run(
      "{not json",
      created.id,
    );
    const loaded = await store.load(created.id);
    expect(loaded?.summary.name).to.equal("Corrupt");
    expect(loaded?.state).to.deep.equal({
      ...emptyGraphViewState(),
      title: "Corrupt",
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/savedGraphService.test.ts`
Expected: FAIL, cannot find module `../../src/services/savedGraphService`.

- [ ] **Step 3: Write the service**

Create `src/services/savedGraphService.ts`:

```ts
import {
  emptyGraphViewState,
  parseGraphViewState,
  serializeGraphViewState,
  type GraphViewState,
} from "./graphViewState";
import { openPluginDatabase } from "./pluginDatabase";

/**
 * A saved graph is a `GraphViewState` under a name: a recipe, not a picture.
 * Neighbours are recomputed when it is opened. Rows are local to the Zotero
 * profile and never sync.
 */
export interface SavedGraphSummary {
  id: number;
  libraryID: number;
  name: string;
  created: string;
  modified: string;
}

export interface SavedGraph {
  summary: SavedGraphSummary;
  state: GraphViewState;
}

/** What the store needs from `Zotero.DBConnection`; unit tests hand in a fake. */
export interface SavedGraphConnection {
  queryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  valueQueryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  executeTransaction<T>(task: () => Promise<T>): Promise<T>;
}

export interface SavedGraphStore {
  ensureSchema(): Promise<void>;
  /** Sorted by name, case-insensitively; ties by most recently modified. */
  list(libraryID: number): Promise<SavedGraphSummary[]>;
  /** Null when the row is gone. A state that no longer parses loads as an empty graph. */
  load(id: number): Promise<SavedGraph | null>;
  create(
    libraryID: number,
    name: string,
    state: GraphViewState,
  ): Promise<SavedGraphSummary>;
  update(id: number, state: GraphViewState): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saved_graphs_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libraryID INTEGER NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_graphs_v1_library ON saved_graphs_v1(libraryID, name);
`;

const SUMMARY_COLUMNS = "id, libraryID, name, created, modified";

interface SavedGraphRow {
  id: number | string;
  libraryID: number | string;
  name: string;
  created: string;
  modified: string;
  state?: string;
}

export function normalizeSavedGraphName(name: string): string {
  const normalized = String(name ?? "").trim();
  if (!normalized) throw new Error("A saved graph needs a name.");
  return normalized;
}

function rowToSummary(row: SavedGraphRow): SavedGraphSummary {
  return {
    id: Number(row.id),
    libraryID: Number(row.libraryID),
    name: String(row.name),
    created: String(row.created),
    modified: String(row.modified),
  };
}

export function createSavedGraphStore(
  connection: SavedGraphConnection,
  now: () => string = () => new Date().toISOString(),
): SavedGraphStore {
  return {
    async ensureSchema() {
      for (const statement of SCHEMA.split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await connection.queryAsync(statement);
      }
    },

    async list(libraryID) {
      const rows = (await connection.queryAsync(
        `SELECT ${SUMMARY_COLUMNS} FROM saved_graphs_v1
         WHERE libraryID = ?
         ORDER BY name COLLATE NOCASE ASC, modified DESC`,
        [libraryID],
      )) as SavedGraphRow[] | undefined;
      return (rows ?? []).map(rowToSummary);
    },

    async load(id) {
      const rows = (await connection.queryAsync(
        `SELECT ${SUMMARY_COLUMNS}, state FROM saved_graphs_v1 WHERE id = ?`,
        [id],
      )) as SavedGraphRow[] | undefined;
      const row = rows?.[0];
      if (!row) return null;
      const summary = rowToSummary(row);
      const state = parseGraphViewState(String(row.state ?? ""));
      return {
        summary,
        state: state ?? { ...emptyGraphViewState(), title: summary.name },
      };
    },

    async create(libraryID, name, state) {
      const normalized = normalizeSavedGraphName(name);
      const stamp = now();
      const id = await connection.executeTransaction(async () => {
        await connection.queryAsync(
          `INSERT INTO saved_graphs_v1 (libraryID, name, state, created, modified)
           VALUES (?, ?, ?, ?, ?)`,
          [libraryID, normalized, serializeGraphViewState(state), stamp, stamp],
        );
        return Number(
          await connection.valueQueryAsync("SELECT last_insert_rowid()"),
        );
      });
      return {
        id,
        libraryID,
        name: normalized,
        created: stamp,
        modified: stamp,
      };
    },

    async update(id, state) {
      await connection.queryAsync(
        "UPDATE saved_graphs_v1 SET state = ?, modified = ? WHERE id = ?",
        [serializeGraphViewState(state), now(), id],
      );
    },

    async rename(id, name) {
      const normalized = normalizeSavedGraphName(name);
      await connection.queryAsync(
        "UPDATE saved_graphs_v1 SET name = ?, modified = ? WHERE id = ?",
        [normalized, now(), id],
      );
    },

    async remove(id) {
      await connection.queryAsync("DELETE FROM saved_graphs_v1 WHERE id = ?", [
        id,
      ]);
    },
  };
}

// The store bound to the plugin database. Opening is lazy so a saved graph
// can be listed from a menu before any graph has been rendered, and idempotent
// so every entry point can simply await it.
let boundStore: Promise<SavedGraphStore> | null = null;

function store(): Promise<SavedGraphStore> {
  if (boundStore) return boundStore;
  boundStore = (async () => {
    const connection = await openPluginDatabase();
    const created = createSavedGraphStore(
      connection as unknown as SavedGraphConnection,
    );
    await created.ensureSchema();
    return created;
  })().catch((error: unknown) => {
    // Let the next call try again rather than pin a failed open.
    boundStore = null;
    throw error;
  });
  return boundStore;
}

export function listSavedGraphs(
  libraryID: number,
): Promise<SavedGraphSummary[]> {
  return store().then((s) => s.list(libraryID));
}

export function loadSavedGraph(id: number): Promise<SavedGraph | null> {
  return store().then((s) => s.load(id));
}

export function createSavedGraph(
  libraryID: number,
  name: string,
  state: GraphViewState,
): Promise<SavedGraphSummary> {
  return store().then((s) => s.create(libraryID, name, state));
}

export function updateSavedGraph(
  id: number,
  state: GraphViewState,
): Promise<void> {
  return store().then((s) => s.update(id, state));
}

export function renameSavedGraph(id: number, name: string): Promise<void> {
  return store().then((s) => s.rename(id, name));
}

export function deleteSavedGraph(id: number): Promise<void> {
  return store().then((s) => s.remove(id));
}
```

Two notes for the implementer:

- `Zotero.DBConnection.queryAsync` returns the rows for a `SELECT`; for an `INSERT` its return value is not relied on, which is why `create` reads `last_insert_rowid()` inside the same transaction.
- The cast at the one binding site (`connection as unknown as SavedGraphConnection`) is there because `DBConnection`'s parameter types are wider than the store's; try removing it first and keep it only if `npm run typecheck` complains.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/savedGraphService.test.ts`
Expected: 12 passing. If the runner prints an `ExperimentalWarning` about `node:sqlite`, it is harmless on Node 24; if it errors with "No such built-in module", the Node version is older than 22.13 and the test needs `--experimental-sqlite`; report that rather than working around it.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: clean, 214 unit tests.

```bash
git add src/services/savedGraphService.ts test/unit/savedGraphService.test.ts
git commit -F - <<'MSG'
Store saved graphs in the plugin database

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 3: The Graph menu in the view

**Files:**

- Modify: `src/services/graphViewService.ts` (`GraphViewController` ~165, `GraphViewOptions` ~202, the Export menu construction ~493–512, `toolbar.append` ~614, the Export handlers ~3069–3113, the controller object ~3535, `cleanup` ~3680)
- Modify: `addon/content/graph.css` (after the `.cm-export-menu button` rule ~599)
- Test: `test/zotero/graphViewVisual.test.ts` (new view 14)

**Interfaces:**

- Consumes: `element`, `text`, `iconButtonContent` from `./graphViewControls`; the Export menu's open/close pattern.
- Produces, exported from `src/services/graphViewService.ts`:

```ts
export interface SavedGraphMenuEntry {
  id: number;
  name: string;
  modified: string; // ISO 8601
}
export interface GraphViewSavedGraphsHost {
  list(): Promise<SavedGraphMenuEntry[]>;
  /** Saves; prompts for a name when the graph is scratch. Resolves to the saved name, or null when cancelled or failed. */
  save(): Promise<string | null>;
  /** Always prompts. Resolves to the new name, or null when cancelled or failed. */
  saveAs(): Promise<string | null>;
  /** "deleted" when the row vanished between listing and opening. */
  open(id: number): Promise<"opened" | "deleted">;
  /** Asks the user to confirm. Resolves true when the row was deleted. */
  remove(id: number): Promise<boolean>;
}
// GraphViewOptions
savedGraphs?: GraphViewSavedGraphsHost | null;
// GraphViewController
/** Shows a short message in the toolbar; null clears it. */
setStatus(message: string | null): void;
```

DOM produced, for the tests and the CSS: `div.cm-menu-wrapper.cm-graph-menu-wrap` > `button.cm-toolbar-button[aria-controls="meristema-graph-menu"]` + `div#meristema-graph-menu.cm-export-menu.cm-graph-menu` containing `button[data-action="save"]`, `button[data-action="save-as"]`, `div.cm-graph-menu-heading`, `div.cm-graph-menu-list` (rows `div.cm-graph-menu-row` > `button[data-action="open"][data-id]` + `button[data-action="delete"][data-id]`, or `p.cm-graph-menu-empty`). The status is `span.cm-toolbar-status[role="status"]` inside `.cm-plot-toolbar`.

- [ ] **Step 1: Write the failing visual test**

Append to `test/zotero/graphViewVisual.test.ts`, before the suite's final `});`:

```ts
it("view 14 — the Graph menu saves through the host and lists what it has", async function () {
  this.timeout(60_000);
  const calls: string[] = [];
  let entries = [
    { id: 7, name: "PhD map", modified: "2026-09-01T10:00:00.000Z" },
    { id: 9, name: "Reading list", modified: "2026-09-05T09:30:00.000Z" },
  ];
  const first = await open(30);
  stage = await openViewStage(first.model, {
    savedGraphs: {
      list: async () => entries,
      save: async () => {
        calls.push("save");
        return "PhD map";
      },
      saveAs: async () => {
        calls.push("save-as");
        return "Copy";
      },
      open: async (id) => {
        calls.push(`open:${id}`);
        return id === 9 ? "deleted" : "opened";
      },
      remove: async (id) => {
        calls.push(`remove:${id}`);
        entries = entries.filter((entry) => entry.id !== id);
        return true;
      },
    },
  });
  first.close();
  const view = stage;
  await settle(view.window, 6);

  const button = view.root.querySelector(
    'button[aria-controls="meristema-graph-menu"]',
  ) as HTMLButtonElement;
  expect(button, "the toolbar has a Graph button").to.not.equal(null);
  const menu = view.root.querySelector("#meristema-graph-menu") as HTMLElement;
  expect(menu.hidden, "closed at first").to.equal(true);

  button.click();
  await settle(view.window, 4);
  expect(menu.hidden, "open after a click").to.equal(false);
  const rows = menu.querySelectorAll(".cm-graph-menu-row");
  expect(rows.length, "one row per saved graph").to.equal(2);
  expect(
    rows[0]?.querySelector('button[data-action="open"]')?.textContent,
    "named, with its date",
  ).to.include("PhD map");

  (
    menu.querySelector('button[data-action="save"]') as HTMLButtonElement
  ).click();
  await settle(view.window, 4);
  expect(calls).to.deep.equal(["save"]);
  expect(menu.hidden, "closed after Save").to.equal(true);
  const status = view.root.querySelector(".cm-toolbar-status") as HTMLElement;
  expect(status.textContent).to.equal("Saved");
  expect(status.hidden).to.equal(false);

  button.click();
  await settle(view.window, 4);
  (
    menu.querySelector(
      'button[data-action="open"][data-id="9"]',
    ) as HTMLButtonElement
  ).click();
  await settle(view.window, 4);
  expect(calls).to.deep.equal(["save", "open:9"]);
  expect(menu.hidden, "stays open to say what happened").to.equal(false);
  expect(menu.querySelector(".cm-graph-menu-empty")?.textContent).to.equal(
    "This graph was deleted.",
  );

  (
    menu.querySelector(
      'button[data-action="delete"][data-id="7"]',
    ) as HTMLButtonElement
  ).click();
  await settle(view.window, 4);
  expect(calls).to.deep.equal(["save", "open:9", "remove:7"]);
  expect(menu.querySelectorAll(".cm-graph-menu-row").length).to.equal(1);
  expect(view.errors, "nothing threw in the background").to.deep.equal([]);
});
```

`stage` is the suite-level variable the existing `open` helper assigns so `afterEach` can close it; the second `openViewStage` here reassigns it the same way view 13 does. This test runs only inside Zotero; you cannot run it. Keep going.

- [ ] **Step 2: Types**

In `src/services/graphViewService.ts`, before `export interface GraphViewController`, add:

```ts
export interface SavedGraphMenuEntry {
  id: number;
  name: string;
  /** ISO 8601, shown beside the name so two graphs with one name can be told apart. */
  modified: string;
}

/**
 * What the Graph menu asks its host for. The view knows nothing about the
 * database or the instance; it shows what the host lists and reports what
 * the host returns.
 */
export interface GraphViewSavedGraphsHost {
  list(): Promise<SavedGraphMenuEntry[]>;
  /**
   * Saves the graph, prompting for a name when it is still scratch. Resolves
   * to the saved name, or null when the user cancelled or the write failed.
   */
  save(): Promise<string | null>;
  /** Always prompts for a name. Resolves as `save` does. */
  saveAs(): Promise<string | null>;
  /** "deleted" when the row vanished between listing and opening. */
  open(id: number): Promise<"opened" | "deleted">;
  /** Asks the user to confirm. Resolves true when the row was deleted. */
  remove(id: number): Promise<boolean>;
}
```

Add to `GraphViewController`, after `applyState`:

```ts
  /** Shows a short message in the toolbar for a moment; null clears it. */
  setStatus(message: string | null): void;
```

Add to `GraphViewOptions`, after `onStateChange`:

```ts
  /** Backs the toolbar's Graph menu. Without it the menu is disabled. */
  savedGraphs?: GraphViewSavedGraphsHost | null;
```

- [ ] **Step 3: Build the button, the menu and the status**

Directly after `exportWrap.append(exportButton, exportMenu);` add:

```ts
// The Graph menu: the document commands. Built like the Export menu, one
// popup under one toolbar button, so the two read as siblings. Open is a
// group inside the same popup rather than a nested hover menu: a hand-built
// submenu is a second thing to keep open, and a list of names with a
// heading says "open one of these" just as well.
const graphWrap = element(
  document,
  "div",
  "cm-menu-wrapper cm-graph-menu-wrap",
);
const graphButton = element(document, "button", "cm-toolbar-button");
graphButton.type = "button";
graphButton.append(iconButtonContent(document, "document", "Graph"));
graphButton.title = "Save this graph, or open a saved one.";
graphButton.setAttribute("aria-expanded", "false");
graphButton.setAttribute("aria-controls", "meristema-graph-menu");
const graphMenu = element(document, "div", "cm-export-menu cm-graph-menu");
graphMenu.id = "meristema-graph-menu";
graphMenu.hidden = true;
const saveButton = element(document, "button");
saveButton.type = "button";
saveButton.dataset.action = "save";
saveButton.textContent = "Save";
const saveAsButton = element(document, "button");
saveAsButton.type = "button";
saveAsButton.dataset.action = "save-as";
saveAsButton.textContent = "Save as…";
const graphMenuHeading = text(document, "div", "Open", "cm-graph-menu-heading");
const graphMenuList = element(document, "div", "cm-graph-menu-list");
graphMenu.append(saveButton, saveAsButton, graphMenuHeading, graphMenuList);
graphWrap.append(graphButton, graphMenu);
if (!options.savedGraphs) {
  graphButton.disabled = true;
  graphButton.title = "Saved graphs are not available in this view.";
}
// Short confirmations ("Saved", "Autosave failed") beside the toolbar.
const toolbarStatus = element(document, "span", "cm-toolbar-status");
toolbarStatus.setAttribute("role", "status");
toolbarStatus.hidden = true;
```

Change the `toolbar.append(...)` call to:

```ts
toolbar.append(
  graphFilter.root,
  focusSeedMenu,
  similarButton,
  exportWrap,
  graphWrap,
  refreshButton,
);
plotToolbar.append(toolbar, toolbarStatus, searchWrap);
```

(replacing the existing `plotToolbar.append(toolbar, searchWrap);`).

- [ ] **Step 4: Status and menu behaviour**

Directly after the Export menu handlers (after the `exportMenu.addEventListener("click", ...)` block and before `refreshButton.addEventListener("click", ...)`), add:

```ts
let statusTimer = 0;
const setStatus = (message: string | null): void => {
  const view = document.defaultView;
  if (statusTimer) {
    if (view) view.clearTimeout(statusTimer);
    else clearTimeout(statusTimer);
    statusTimer = 0;
  }
  toolbarStatus.textContent = message ?? "";
  toolbarStatus.hidden = !message;
  if (!message) return;
  const hide = (): void => {
    statusTimer = 0;
    toolbarStatus.hidden = true;
    toolbarStatus.textContent = "";
  };
  statusTimer = view
    ? view.setTimeout(hide, 2500)
    : (setTimeout(hide, 2500) as unknown as number);
};

const formatSavedDate = (iso: string): string => {
  const time = Date.parse(iso);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
};
const setGraphMenuMessage = (message: string): void => {
  graphMenuList.replaceChildren(
    text(document, "p", message, "cm-graph-menu-empty"),
  );
};
let graphMenuListGeneration = 0;
const rebuildGraphMenuList = async (): Promise<void> => {
  const host = options.savedGraphs;
  if (!host) return;
  const generation = ++graphMenuListGeneration;
  let entries: SavedGraphMenuEntry[];
  try {
    entries = await host.list();
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    if (generation === graphMenuListGeneration) {
      setGraphMenuMessage("Saved graphs could not be listed.");
    }
    return;
  }
  if (generation !== graphMenuListGeneration || cleaned) return;
  if (!entries.length) {
    setGraphMenuMessage("No saved graphs yet.");
    return;
  }
  graphMenuList.replaceChildren(
    ...entries.map((entry) => {
      const row = element(document, "div", "cm-graph-menu-row");
      const openButton = element(document, "button");
      openButton.type = "button";
      openButton.dataset.action = "open";
      openButton.dataset.id = String(entry.id);
      openButton.append(
        text(document, "span", entry.name, "cm-graph-menu-name"),
        text(
          document,
          "span",
          formatSavedDate(entry.modified),
          "cm-graph-menu-date",
        ),
      );
      const deleteButton = element(document, "button", "cm-graph-menu-delete");
      deleteButton.type = "button";
      deleteButton.dataset.action = "delete";
      deleteButton.dataset.id = String(entry.id);
      deleteButton.textContent = "×";
      deleteButton.setAttribute("aria-label", `Delete ${entry.name}`);
      deleteButton.title = `Delete ${entry.name}`;
      row.append(openButton, deleteButton);
      return row;
    }),
  );
};
const closeGraphMenu = (): void => {
  graphMenu.hidden = true;
  graphButton.setAttribute("aria-expanded", "false");
};
const openGraphMenu = (): void => {
  closeExportMenu();
  graphMenu.hidden = false;
  graphButton.setAttribute("aria-expanded", "true");
  setGraphMenuMessage("Loading…");
  void rebuildGraphMenuList();
};
graphButton.addEventListener("click", () => {
  if (graphButton.disabled) return;
  if (graphMenu.hidden) openGraphMenu();
  else closeGraphMenu();
});
const closeGraphMenuOnOutsidePointer = (event: Event): void => {
  if (graphMenu.hidden) return;
  const target = event.target as Node | null;
  if (target && graphWrap.contains(target)) return;
  closeGraphMenu();
};
const closeGraphMenuOnEscape = (event: KeyboardEvent): void => {
  if (event.key !== "Escape" || graphMenu.hidden) return;
  closeGraphMenu();
  graphButton.focus();
};
document.addEventListener("pointerdown", closeGraphMenuOnOutsidePointer, true);
document.addEventListener("keydown", closeGraphMenuOnEscape, true);
let graphMenuBusy = false;
graphMenu.addEventListener("click", (event) => {
  const host = options.savedGraphs;
  const target = (event.target as Element).closest(
    "button",
  ) as HTMLButtonElement | null;
  if (!host || !target || graphMenuBusy) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id);
  const run = async (): Promise<void> => {
    if (action === "save" || action === "save-as") {
      closeGraphMenu();
      const name = await (action === "save" ? host.save() : host.saveAs());
      if (name) setStatus("Saved");
      return;
    }
    if (action === "open" && Number.isInteger(id)) {
      const result = await host.open(id);
      if (result === "opened") {
        closeGraphMenu();
        return;
      }
      setGraphMenuMessage("This graph was deleted.");
      // Let the message be read before the list replaces it.
      const view = document.defaultView;
      await new Promise<void>((resolve) =>
        view ? view.setTimeout(resolve, 1200) : setTimeout(resolve, 1200),
      );
      if (!graphMenu.hidden) await rebuildGraphMenuList();
      return;
    }
    if (action === "delete" && Number.isInteger(id)) {
      if (await host.remove(id)) await rebuildGraphMenuList();
    }
  };
  graphMenuBusy = true;
  void run()
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      setStatus(action === "open" ? "Could not open" : "Save failed");
    })
    .finally(() => {
      graphMenuBusy = false;
    });
});
```

In the Export menu's `exportButton` click handler, close the Graph menu first so the two never overlap:

```ts
exportButton.addEventListener("click", () => {
  closeGraphMenu();
  exportMenu.hidden = !exportMenu.hidden;
  exportButton.setAttribute("aria-expanded", String(!exportMenu.hidden));
});
```

`closeGraphMenu` is declared after that handler with `const`; the handler only runs on a click, so the temporal dead zone is not an issue. If lint reports use-before-define, declare `let closeGraphMenu: () => void = () => undefined;` next to `closeExportMenu` and assign it where it is defined above.

Add `setStatus` to the controller object:

```ts
    getState,
    applyState,
    setStatus,
```

In `cleanup`, after `cleaned = true;`, add:

```ts
document.removeEventListener(
  "pointerdown",
  closeGraphMenuOnOutsidePointer,
  true,
);
document.removeEventListener("keydown", closeGraphMenuOnEscape, true);
if (statusTimer) {
  const view = document.defaultView;
  if (view) view.clearTimeout(statusTimer);
  else clearTimeout(statusTimer);
  statusTimer = 0;
}
graphMenuListGeneration += 1;
```

- [ ] **Step 5: CSS**

In `addon/content/graph.css`, after the `.cm-export-menu button { ... }` rule, add:

```css
.cm-graph-menu {
  min-width: 240px;
}
.cm-graph-menu-heading {
  margin: 6px 6px 2px;
  padding-top: 6px;
  border-top: 1px solid var(--cm-border);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
.cm-graph-menu-list {
  display: grid;
  max-height: 280px;
  overflow-y: auto;
}
.cm-graph-menu-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: stretch;
}
.cm-graph-menu-row button[data-action="open"] {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  min-width: 0;
}
.cm-graph-menu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-graph-menu-date {
  font-size: 11px;
  opacity: 0.65;
}
.cm-graph-menu-delete {
  padding-inline: 8px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
}
.cm-graph-menu-delete:hover {
  opacity: 1;
}
.cm-graph-menu-empty {
  margin: 4px 8px 6px;
  font-size: 12px;
  opacity: 0.7;
}
.cm-toolbar-status {
  align-self: center;
  margin-inline: 8px;
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
.cm-toolbar-status[hidden] {
  display: none;
}
```

- [ ] **Step 6: Run the gate**

Run: `npm run check`
Expected: clean, 214 unit tests. Prettier may reflow the long `element(...)` lines; run `npx prettier --write src/services/graphViewService.ts test/zotero/graphViewVisual.test.ts addon/content/graph.css` and re-run the gate if it complains.

- [ ] **Step 7: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css test/zotero/graphViewVisual.test.ts
git commit -F - <<'MSG'
Add a Graph menu with Save, Save as and Open to the view toolbar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 4: The window service owns the document

**Files:**

- Modify: `src/services/windowService.ts` (imports ~1–30, `GraphInstanceState` ~36, `createGraphInstance` ~81, `captureViewState`/`viewStateOptions` ~333–370, `renderDetachedWindow` ~372, `renderTab` ~747, `OpenGraphOptions` ~872, `openGraphWindow` ~934, tab `onClose` ~1017, `renameGraphView` ~1083)
- Modify: `src/hooks.ts` (`onShutdown`)

**Interfaces:**

- Consumes: `GraphViewSavedGraphsHost`, `SavedGraphMenuEntry`, `GraphViewController.setStatus` from Task 3; `listSavedGraphs`, `loadSavedGraph`, `createSavedGraph`, `updateSavedGraph`, `renameSavedGraph`, `deleteSavedGraph`, `SavedGraphSummary` from Task 2; `serializeGraphViewState`, `emptyGraphViewState` from `graphViewState.ts`.
- Produces, exported from `src/services/windowService.ts`:

```ts
/** Focuses the tab showing this saved graph, or opens it in a new tab. */
export function openSavedGraph(
  id: number,
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<"opened" | "deleted">;
/** Writes every pending autosave now and waits for the writes in flight. */
export function flushSavedGraphWrites(): Promise<void>;
```

`GraphInstanceState` gains `savedGraphID: number | null`, `savedGraphSerialized: string | null` and `autosaveTimer: number | null`; `OpenGraphOptions` gains `savedGraph?: { id: number; name: string; state: GraphViewState }`.

- [ ] **Step 1: Imports and instance fields**

In `src/services/windowService.ts`, change the `graphViewState` import to:

```ts
import {
  emptyGraphViewState,
  serializeGraphViewState,
  type GraphViewState,
} from "./graphViewState";
```

Add:

```ts
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
  loadSavedGraph,
  renameSavedGraph,
  updateSavedGraph,
} from "./savedGraphService";
```

and add `type GraphViewSavedGraphsHost` to the existing import list from `./graphViewService`.

Add to `GraphInstanceState`, after `discardViewState`:

```ts
/** The saved graph this view is a document of, or null while it is scratch. */
savedGraphID: number | null;
/**
 * The recipe last written to that row, camera stripped, so an echo of the
 * same state (the view reports on open) is not a change to write.
 */
savedGraphSerialized: string | null;
/** The debounce handle of a pending autosave. */
autosaveTimer: number | null;
```

In `createGraphInstance`, after `discardViewState: false,`, add:

```ts
    savedGraphID: null,
    savedGraphSerialized: null,
    autosaveTimer: null,
```

Near the other module constants, add:

```ts
const AUTOSAVE_DELAY_MS = 500;
/** Writes in flight, so shutdown can wait for them before the database closes. */
const savedGraphWrites = new Set<Promise<void>>();
```

- [ ] **Step 2: Autosave and the write path**

Above `captureViewState`, add:

```ts
/** The recipe as autosave compares it: the camera moves without being a change. */
function comparableState(state: GraphViewState): string {
  return serializeGraphViewState({ ...state, camera: null });
}

function instanceTitle(instance: GraphInstanceState): string | null {
  return instance.customTitle ? instance.title : null;
}

function clearAutosave(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): void {
  if (instance.autosaveTimer === null) return;
  win.clearTimeout(instance.autosaveTimer);
  instance.autosaveTimer = null;
}

/**
 * Writes the instance's recipe to its saved graph. Resolves true when the row
 * was written. A failure is logged and shown in the view's toolbar; the graph
 * stays open and the next change tries again.
 */
function writeSavedGraph(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  mode: "autosave" | "save",
): Promise<boolean> {
  const id = instance.savedGraphID;
  const state = instance.viewState;
  if (id === null || !state) return Promise.resolve(false);
  const serialized = comparableState(state);
  const write = updateSavedGraph(id, state).then(
    () => {
      instance.savedGraphSerialized = serialized;
      return true;
    },
    (error: unknown) => {
      reportAsyncError("Meristema: saved graph write failed", error);
      const mount = instanceMount(win, instance);
      if (mount) {
        getGraphViewController(mount)?.setStatus(
          mode === "autosave" ? "Autosave failed" : "Save failed",
        );
      }
      return false;
    },
  );
  const tracked = write.then(() => undefined);
  savedGraphWrites.add(tracked);
  void tracked.finally(() => savedGraphWrites.delete(tracked));
  return write;
}

function scheduleAutosave(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): void {
  if (instance.savedGraphID === null || !instance.viewState) return;
  if (comparableState(instance.viewState) === instance.savedGraphSerialized) {
    return;
  }
  clearAutosave(win, instance);
  instance.autosaveTimer = win.setTimeout(() => {
    instance.autosaveTimer = null;
    void writeSavedGraph(win, instance, "autosave");
  }, AUTOSAVE_DELAY_MS);
}

export async function flushSavedGraphWrites(): Promise<void> {
  for (const [win, state] of graphStateByWindow) {
    for (const instance of state.instances.values()) {
      if (instance.autosaveTimer === null) continue;
      clearAutosave(win, instance);
      void writeSavedGraph(win, instance, "autosave");
    }
  }
  await Promise.allSettled([...savedGraphWrites]);
}

/** Makes the instance the document of a saved graph row and names it after it. */
function adoptSavedGraph(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  id: number,
  name: string,
  state: GraphViewState,
): void {
  clearAutosave(win, instance);
  instance.savedGraphID = id;
  instance.title = name;
  instance.customTitle = true;
  instance.viewState = { ...state, title: name };
  instance.savedGraphSerialized = comparableState(instance.viewState);
  syncInstanceTitle(win, instance);
}

/** Back to scratch: the tab keeps its name and its graph, the row is left alone. */
function releaseSavedGraph(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): void {
  clearAutosave(win, instance);
  instance.savedGraphID = null;
  instance.savedGraphSerialized = null;
}
```

`instanceMount` and `syncInstanceTitle` are declared later in the file as function declarations, so they are hoisted; `reportAsyncError` too.

Change `viewStateOptions` to take the window and to autosave:

```ts
function viewStateOptions(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  libraryID: number,
): Pick<GraphViewOptions, "title" | "onStateChange" | "savedGraphs"> {
  // A view moving to another library keeps nothing: its seeds are that
  // library's items and its collections are that library's folders.
  if (instance.libraryID !== null && instance.libraryID !== libraryID) {
    instance.viewState = null;
  }
  return {
    title: instanceTitle(instance),
    onStateChange: (state) => {
      // The view only knows the title it was rendered with; the instance's
      // is current, and it is the one the saved row should carry.
      instance.viewState = { ...state, title: instanceTitle(instance) };
      scheduleAutosave(win, instance);
    },
    savedGraphs: savedGraphsHost(win, instance),
  };
}
```

Update the two callers: in `renderDetachedWindow`, `const stateOptions = viewStateOptions(hostWindow, instance, snapshot.libraryID);` and in `renderTab`, `const stateOptions = viewStateOptions(win, instance, snapshot.libraryID);`.

- [ ] **Step 3: The host the view talks to**

Below `releaseSavedGraph`, add:

```ts
function savedGraphsHost(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): GraphViewSavedGraphsHost {
  const libraryID = (): number => instance.libraryID ?? selectedLibraryID(win);
  // The live view's state, camera included: Save writes the camera, which
  // autosave never tracks.
  const currentState = (): GraphViewState => {
    captureViewState(instance, instanceMount(win, instance));
    return (
      instance.viewState ?? {
        ...emptyGraphViewState(),
        title: instanceTitle(instance),
      }
    );
  };
  const askName = (): string | null => {
    const answer = (win as any).prompt?.("Save graph as", instance.title);
    if (answer === null || answer === undefined) return null;
    const name = String(answer).trim();
    return name || null;
  };
  const createAs = async (): Promise<string | null> => {
    const name = askName();
    if (!name) return null;
    const state = { ...currentState(), title: name };
    const summary = await createSavedGraph(libraryID(), name, state);
    adoptSavedGraph(win, instance, summary.id, name, state);
    return name;
  };
  return {
    list: async () =>
      (await listSavedGraphs(libraryID())).map(({ id, name, modified }) => ({
        id,
        name,
        modified,
      })),
    save: async () => {
      if (instance.savedGraphID === null) return createAs();
      instance.viewState = currentState();
      clearAutosave(win, instance);
      const written = await writeSavedGraph(win, instance, "save");
      return written ? instance.title : null;
    },
    saveAs: createAs,
    open: (id) => openSavedGraph(id, win),
    remove: async (id) => {
      const entry = (await listSavedGraphs(libraryID())).find(
        (summary) => summary.id === id,
      );
      const name = entry?.name ?? "this graph";
      const confirmed = Boolean(
        (win as any).confirm?.(
          `Delete the saved graph “${name}”? Open tabs keep their graph; only the saved copy is removed.`,
        ),
      );
      if (!confirmed) return false;
      await deleteSavedGraph(id);
      // Every view of that row, in any window, is scratch again. Each timer
      // is cleared through the window that set it.
      for (const [owner, state] of graphStateByWindow) {
        for (const other of state.instances.values()) {
          if (other.savedGraphID === id) releaseSavedGraph(owner, other);
        }
      }
      return true;
    },
  };
}
```

`openSavedGraph` is the exported function written in Step 4; it is a function declaration, so calling it here is fine.

- [ ] **Step 4: Opening a saved graph**

Add to `OpenGraphOptions`, after `titleBase`:

```ts
  /**
   * Opens a saved graph into the new instance: its name becomes the tab
   * title, its recipe the initial state, and the instance autosaves to it.
   * Only meaningful with `newInstance`.
   */
  savedGraph?: { id: number; name: string; state: GraphViewState };
```

In `openGraphWindow`, right after

```ts
if (!instance) {
  instance = createGraphInstance(win, targetLibraryID, options.titleBase);
}
```

add:

```ts
if (options.savedGraph && options.newInstance) {
  const { id, name, state } = options.savedGraph;
  instance.savedGraphID = id;
  instance.title = name;
  instance.customTitle = true;
  instance.viewState = { ...state, title: name };
  instance.savedGraphSerialized = comparableState(instance.viewState);
}
```

In the same function, in the library-change block (`if (previousLibraryID !== null && previousLibraryID !== targetLibraryID) {`), add `releaseSavedGraph(win, instance);` as its first line: a saved graph belongs to one library, so a view that moves library becomes scratch.

Below `openNewGraphWindow`, add:

```ts
export async function openSavedGraph(
  id: number,
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<"opened" | "deleted"> {
  const win = hostWindow ?? defaultMainWindow();
  const open = liveInstances(win).find(
    (instance) => instance.savedGraphID === id,
  );
  if (open) {
    activateInstance(win, open);
    return "opened";
  }
  const loaded = await loadSavedGraph(id);
  if (!loaded) return "deleted";
  await openGraphWindow(win, loaded.summary.libraryID, {
    newInstance: true,
    savedGraph: { id, name: loaded.summary.name, state: loaded.state },
  });
  return "opened";
}
```

- [ ] **Step 5: Tab close and rename**

In the tab's `onClose` inside `openGraphWindow`, before `instance.pendingSelectionItemIDs = [];`, add:

```ts
// A pending autosave is written now rather than dropped with the tab.
if (instance.autosaveTimer !== null) {
  clearAutosave(win, instance);
  void writeSavedGraph(win, instance, "autosave");
}
```

In `renameGraphView`, replace

```ts
if (instance.viewState)
  instance.viewState = { ...instance.viewState, title: normalized };
syncInstanceTitle(win, instance);
```

with

```ts
if (instance.viewState)
  instance.viewState = { ...instance.viewState, title: normalized };
syncInstanceTitle(win, instance);
if (instance.savedGraphID !== null) {
  const id = instance.savedGraphID;
  void renameSavedGraph(id, normalized).catch((error: unknown) =>
    reportAsyncError("Meristema: saved graph rename failed", error),
  );
  // The row's state carries the title too.
  scheduleAutosave(win, instance);
}
```

- [ ] **Step 6: Flush before the database closes**

In `src/hooks.ts`, add `flushSavedGraphWrites` to the import list from `./services/windowService`, and in `onShutdown`, directly after `await waitForProviderResponseCache();`, add:

```ts
await flushSavedGraphWrites().catch((error: unknown) =>
  Zotero.logError(error instanceof Error ? error : new Error(String(error))),
);
```

- [ ] **Step 7: Run the gate and commit**

Run: `npm run check`
Expected: clean, 214 unit tests.

```bash
git add src/services/windowService.ts src/hooks.ts
git commit -F - <<'MSG'
Save, autosave and open graphs from the window service

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 5: Tools menu, context menu wording, docs

**Files:**

- Modify: `src/services/menuService.ts` (imports, `itemMenus` ~282–350, `toolsSubmenu` ~396)
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `README.md:61`
- Modify: `docs/superpowers/specs/2026-09-07-durable-graphs-design.md` (Status)

**Interfaces:**

- Consumes: `openSavedGraph` from Task 4; `listSavedGraphs` from Task 2; the `injectViewItems` pattern.
- Produces: no exported signatures.

- [ ] **Step 1: Locale strings**

In `addon/locale/en-US/mainWindow.ftl`, replace

```
open-focus-view-new-tab-command =
    .label = Explore in New Graph
```

with

```
# $count is how many items were selected. The new graph seeds from them and
# fetches their references and citing papers.
open-focus-view-new-tab-command =
    .label =
        { $count ->
            [1] New Graph from item
           *[other] New Graph from { $count } items
        }
```

and append at the end of the file:

```
open-saved-graph-submenu =
    .label = Open Saved Graph…

open-saved-graph-empty-command =
    .label = No saved graphs yet.
```

- [ ] **Step 2: Context menu wording**

In `src/services/menuService.ts`, in `itemMenus`, the second `contextCommandItem` (the `open-focus-view-new-tab-command` one) gets the count as an l10n argument and the per-view label "Add as seed to X". Replace its `onShown` callback so the whole entry reads:

```ts
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const hostWindow = contextWindow(context);
        const command = itemCommand(context);
        context.setL10nArgs(JSON.stringify({ count: command.itemIDs.length }));
        injectViewItems(
          context,
          "explore",
          getOpenGraphViews(hostWindow),
          "adds as seeds",
          (view) => {
            void exploreInExistingView(view, command, hostWindow).catch(report);
          },
          (view) => `Add as seed to ${view.title}`,
        );
      },
    ),
```

- [ ] **Step 3: Open Saved Graph… under Tools**

Add the imports `openSavedGraph` (from `./windowService`) and:

```ts
import { listSavedGraphs } from "./savedGraphService";
```

Add a module constant next to `OPEN_IN_DYNAMIC_ATTR`:

```ts
const SAVED_GRAPH_DYNAMIC_ATTR = "data-meristema-saved-graph";
```

Above `toolsSubmenu`, add:

```ts
// The submenu's rows are only known when it shows, so, like the item menu's
// per-view entries, they are injected while the popup is open and removed
// when it hides. One static entry, "No saved graphs yet.", is declared up
// front: it is the anchor the rows are inserted after, and the message when
// there are none. Deleting is not offered here; the graph's own menu has it.
async function fillSavedGraphPopup(
  popup: HTMLElement,
  libraryID: number,
  hostWindow: MainWindow,
): Promise<void> {
  const clear = (): void => {
    popup
      .querySelectorAll(`[${SAVED_GRAPH_DYNAMIC_ATTR}]`)
      .forEach((node) => node.remove());
  };
  clear();
  const anchor = Array.from(popup.children).find(
    (child) => !child.hasAttribute(SAVED_GRAPH_DYNAMIC_ATTR),
  ) as HTMLElement | undefined;
  if (!anchor) return;
  const graphs = await listSavedGraphs(libraryID);
  clear();
  anchor.hidden = graphs.length > 0;
  const document = popup.ownerDocument as any;
  let previous: HTMLElement = anchor;
  for (const graph of graphs) {
    const item = document.createXULElement("menuitem");
    item.setAttribute(SAVED_GRAPH_DYNAMIC_ATTR, String(graph.id));
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("image", ICON);
    item.setAttribute("label", graph.name);
    item.setAttribute(
      "acceltext",
      new Date(graph.modified).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    );
    item.addEventListener(
      "command",
      () => {
        void openSavedGraph(graph.id, hostWindow)
          .then((result) => {
            if (result === "deleted") {
              (hostWindow as any).alert?.("This graph was deleted.");
            }
          })
          .catch(report);
      },
      { once: true },
    );
    previous.after(item);
    previous = item;
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}

function openSavedGraphSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-open-saved-graph-submenu`,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const menuElem = safeContextValue(context, "menuElem") as
        HTMLElement | undefined;
      const popup =
        menuElem?.localName === "menupopup"
          ? menuElem
          : (menuElem?.querySelector("menupopup") as HTMLElement | null);
      if (!popup) return;
      void fillSavedGraphPopup(
        popup,
        activeLibraryID(context),
        contextWindow(context),
      ).catch(report);
    },
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-open-saved-graph-empty-command`,
        onShowing: (_event: Event, context: any) => {
          context.setEnabled(false);
        },
      },
    ],
  };
}
```

In `toolsSubmenu`, add `openSavedGraphSubmenu(),` directly after the `new-graph-view-command` entry, so the submenu reads New Graph, Open Saved Graph…, Refresh Library, separator, Settings.

Verification note for the implementer and the reviewer: `MenuManager` hands `onShowing` a `menuElem`; for a `submenu` this is expected to be the `<menu>` element whose `<menupopup>` is its child, which the code above handles either way. If, in Zotero, the rows do not appear, log `menuElem.localName` from `onShowing` and adjust the lookup; this cannot be checked outside Zotero, so the user's manual run (Step 6) is the check.

- [ ] **Step 4: README and spec status**

In `README.md`, replace line 61,

```
  Open several Graph tabs at once. Rename views and use `Show in ›` or `Explore in ›` to create a new view or add papers to an existing one. Each view keeps its own scope, seeds, filters, selection, and camera.
```

with

```
  Open several Graph tabs at once. Rename views and use `Show in ›`, `New Graph from item` or `Add as seed to ›` to create a new view or add papers to an existing one. Each view keeps its own scope, seeds, filters, selection, and camera, and survives a refresh. Save a graph from the toolbar's Graph menu to come back to it later; a saved graph autosaves and reopens from the Graph menu or from Tools › Meristema › Open Saved Graph.
```

In `docs/superpowers/specs/2026-09-07-durable-graphs-design.md`, change `**Status:** Phase 1 implemented` to `**Status:** Implemented`.

Run: `npx prettier --write README.md docs/superpowers/specs/2026-09-07-durable-graphs-design.md`

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: clean, 214 unit tests.

```bash
git add src/services/menuService.ts addon/locale/en-US/mainWindow.ftl README.md docs/superpowers/specs/2026-09-07-durable-graphs-design.md
git commit -F - <<'MSG'
Open saved graphs from Tools and say what the item menu entries do

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

- [ ] **Step 6: Hand the manual check to the user**

Cannot be automated here. After `npm run build` (XPI at `.scaffold/build/meristema.xpi`), the user runs in Zotero, following the spec's manual section:

1. New PhD Graph, add a seed, add a node that is not in Zotero as a seed, Add to Zotero from its detail pane. The graph keeps both seeds and the imported one turns local.
2. Graph › Save, accept the default name. The tab is renamed, the toolbar says "Saved". Add another seed; wait a second; close the tab.
3. Graph › Open from a fresh tab, and Tools › Meristema › Open Saved Graph…: the graph comes back with all three seeds and its title. Opening it again focuses the open tab.
4. Rename the tab: the Open list shows the new name. Delete it from the Open list's ×: a confirm appears, the row goes, the tab stays.
5. Right-click an item: the entries read "Show in New Graph", "Show in X", "New Graph from item" (or "from N items"), "Add as seed to X".

---

## Self-review

**Spec coverage.** Shared connection in `pluginDatabase.ts` (Task 1). Table, index, service API with the listed semantics (Task 2; names trimmed and non-empty, duplicates allowed, sorted by name case-insensitively, `modified` bumped, a missing library simply lists nothing because the list is per library). Graph button between Export and Refresh, Save on scratch prompting with the tab title as default through the same window prompt the rename uses, tab title set with `customTitle`, "Saved" status, Save on a saved graph writing at once with the camera, Save as switching the instance, Open listing name and modified date with a × that confirms, focusing an already-open tab, "This graph was deleted." with a rebuild, "No saved graphs yet." (Tasks 3 and 4). Autosave debounced 500 ms and coalesced, first echo ignored by comparing to the last written recipe, failure logged and shown as "Autosave failed" with retry on the next change (Task 4). Rename renames the row; closing does nothing to the row; the same graph in two windows is allowed and last write wins because nothing prevents it (Task 4). Tools › Open Saved Graph… (Task 5). Context menu wording (Task 5). Docs and status (Task 5). One deviation, stated in Task 3: Open is a group in the Graph popup rather than a nested hover submenu.

**Placeholder scan.** Every code step shows its code; the two Zotero-only checks (view 14, the MenuManager `menuElem` shape) are named as things the implementer cannot run and the user verifies.

**Type consistency.** `GraphViewSavedGraphsHost` (Task 3) is what `savedGraphsHost` (Task 4) returns and what `savedGraphs` carries; `SavedGraphMenuEntry` has `id`, `name`, `modified` and Task 4's `list` maps `SavedGraphSummary` to exactly those; `setStatus(message: string | null)` is called with strings from Task 4; `openSavedGraph(id, hostWindow)` returns `"opened" | "deleted"` in Tasks 4 and 5; `viewStateOptions(win, instance, libraryID)` has both callers updated; `OpenGraphOptions.savedGraph` matches the object `openSavedGraph` builds.
