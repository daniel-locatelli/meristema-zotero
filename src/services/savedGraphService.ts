import {
  emptyGraphViewState,
  parseGraphViewState,
  serializeGraphViewState,
  type GraphViewState,
} from "./graphViewState";
import { getPluginDatabase, openPluginDatabase } from "./pluginDatabase";

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
        const id = Number(
          await connection.valueQueryAsync("SELECT last_insert_rowid()"),
        );
        if (!Number.isInteger(id) || id <= 0) {
          throw new Error("The saved graph row has no id.");
        }
        return id;
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
let boundConnection: unknown = null;

function store(): Promise<SavedGraphStore> {
  if (boundStore && getPluginDatabase() !== boundConnection) {
    // The connection this store was built on has since been closed (e.g. by
    // a plugin reload); rebuild against whatever is open now.
    boundStore = null;
  }
  if (boundStore) return boundStore;
  boundStore = (async () => {
    const connection = await openPluginDatabase();
    boundConnection = connection;
    const created = createSavedGraphStore(connection);
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
