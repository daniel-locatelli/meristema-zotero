import {
  parseGraphViewState,
  serializeGraphViewState,
  type GraphViewState,
} from "./graphViewState";
import { getPluginDatabase, openPluginDatabase } from "./pluginDatabase";
import type { SavedGraphConnection } from "./savedGraphService";

/**
 * What the profile keeps of an open graph tab so it comes back after a
 * restart (F15, ADR 0021). Zotero's own session never carries a graph tab:
 * the plugin keeps this list itself and reopens the tabs on startup.
 */
export interface OpenGraphTabRecord {
  /** The view's instance id, which the restored tab keeps as its own. */
  key: string;
  libraryID: number;
  /**
   * The tab's index in the window's tab bar, the library tab being 0. Null
   * for a graph shown in a detached window, which comes back as a tab at
   * the end.
   */
  position: number | null;
  selected: boolean;
  /** The saved graph the tab is a document of; it restores by reference. */
  savedGraphID: number | null;
  title: string;
  customTitle: boolean;
  /** The folders a folder graph's default title was taken from (B58). */
  titleCollectionIDs: number[] | null;
  /**
   * The graph as the tab last showed it, camera included: all an unsaved
   * graph has, and a saved graph's edits its row has not caught up with.
   * Null when the stored state no longer parses.
   */
  state: GraphViewState | null;
}

export interface OpenGraphTabStore {
  ensureSchema(): Promise<void>;
  /** By position, detached windows' graphs last. */
  list(): Promise<OpenGraphTabRecord[]>;
  /** Writes these records and leaves every other alone. */
  put(records: readonly OpenGraphTabRecord[]): Promise<void>;
  /** Writes these records and drops every other: the tabs open now. */
  sync(records: readonly OpenGraphTabRecord[]): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS open_graph_tabs_v1 (
  key TEXT PRIMARY KEY,
  libraryID INTEGER NOT NULL,
  position INTEGER,
  selected INTEGER NOT NULL,
  savedGraphID INTEGER,
  title TEXT NOT NULL,
  customTitle INTEGER NOT NULL,
  titleCollectionIDs TEXT,
  state TEXT NOT NULL
);
`;

const COLUMNS =
  "key, libraryID, position, selected, savedGraphID, title, customTitle, titleCollectionIDs, state";

interface OpenGraphTabRow {
  key: string;
  libraryID: number | string;
  position: number | string | null;
  selected: number | string;
  savedGraphID: number | string | null;
  title: string;
  customTitle: number | string;
  titleCollectionIDs: string | null;
  state: string;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseCollectionIDs(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isInteger(id))
      : null;
  } catch {
    return null;
  }
}

function rowToRecord(row: OpenGraphTabRow): OpenGraphTabRecord {
  return {
    key: String(row.key),
    libraryID: Number(row.libraryID),
    position: nullableNumber(row.position),
    selected: Number(row.selected) === 1,
    savedGraphID: nullableNumber(row.savedGraphID),
    title: String(row.title),
    customTitle: Number(row.customTitle) === 1,
    titleCollectionIDs: parseCollectionIDs(row.titleCollectionIDs),
    state: parseGraphViewState(String(row.state ?? "")),
  };
}

function recordParams(record: OpenGraphTabRecord): unknown[] {
  return [
    record.key,
    record.libraryID,
    record.position,
    record.selected ? 1 : 0,
    record.savedGraphID,
    record.title,
    record.customTitle ? 1 : 0,
    record.titleCollectionIDs
      ? JSON.stringify(record.titleCollectionIDs)
      : null,
    record.state ? serializeGraphViewState(record.state) : "",
  ];
}

export function createOpenGraphTabStore(
  connection: SavedGraphConnection,
): OpenGraphTabStore {
  const write = async (
    records: readonly OpenGraphTabRecord[],
  ): Promise<void> => {
    for (const record of records) {
      await connection.queryAsync(
        `INSERT OR REPLACE INTO open_graph_tabs_v1 (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        recordParams(record),
      );
    }
  };
  return {
    async ensureSchema() {
      await connection.queryAsync(SCHEMA.trim());
    },

    async list() {
      const rows = (await connection.queryAsync(
        `SELECT ${COLUMNS} FROM open_graph_tabs_v1
         ORDER BY position IS NULL, position ASC, key ASC`,
      )) as OpenGraphTabRow[] | undefined;
      return (rows ?? []).map(rowToRecord);
    },

    async put(records) {
      if (!records.length) return;
      await connection.executeTransaction(() => write(records));
    },

    async sync(records) {
      await connection.executeTransaction(async () => {
        const keys = records.map((record) => record.key);
        await connection.queryAsync(
          keys.length
            ? `DELETE FROM open_graph_tabs_v1 WHERE key NOT IN (${keys
                .map(() => "?")
                .join(", ")})`
            : "DELETE FROM open_graph_tabs_v1",
          keys,
        );
        await write(records);
      });
    },
  };
}

/**
 * The state a restored tab opens on: its own, which carries what the saved
 * row has not caught up with, else the saved graph's. Whatever the fill was
 * doing when Zotero closed, it comes back stopped and fetches nothing until
 * Resume, the way a graph saved stopped reopens (B55).
 */
export function restoredGraphState(
  snapshot: GraphViewState | null,
  saved: GraphViewState | null,
): GraphViewState | null {
  const state = snapshot ?? saved;
  return state ? { ...state, fillStopped: true } : null;
}

export interface OpenGraphTabRestoreStep {
  record: OpenGraphTabRecord;
  /** Where `Zotero_Tabs.add` puts the tab, at the time it is added. */
  index: number;
}

export interface OpenGraphTabRestorePlan {
  steps: OpenGraphTabRestoreStep[];
  /** The graph to select once every tab is back; null when a Zotero tab was. */
  selectKey: string | null;
}

/**
 * The order and places to reopen graph tabs in, given how many tabs the
 * window holds once Zotero has restored its own. Adding the graphs in the
 * order of their old places, each at that place, rebuilds the old order when
 * Zotero brought back the same tabs; a place past the end is the end, and
 * the library tab keeps index 0. A saved graph opens once.
 */
export function planOpenGraphTabRestore(
  records: readonly OpenGraphTabRecord[],
  tabCount: number,
): OpenGraphTabRestorePlan {
  const ordered = [...records].sort(
    (left, right) =>
      (left.position ?? Number.POSITIVE_INFINITY) -
      (right.position ?? Number.POSITIVE_INFINITY),
  );
  const seenSavedGraphs = new Set<number>();
  const steps: OpenGraphTabRestoreStep[] = [];
  let count = Math.max(1, tabCount);
  for (const record of ordered) {
    if (record.savedGraphID !== null) {
      if (seenSavedGraphs.has(record.savedGraphID)) continue;
      seenSavedGraphs.add(record.savedGraphID);
    }
    const index =
      record.position === null
        ? count
        : Math.min(Math.max(1, record.position), count);
    steps.push({ record, index });
    count += 1;
  }
  const selected = steps.find(
    (step) => step.record.selected && step.record.position !== null,
  );
  return { steps, selectKey: selected?.record.key ?? null };
}

// The store bound to the plugin database, opened lazily like the saved
// graphs' store and rebuilt when that connection has since been closed.
let boundStore: Promise<OpenGraphTabStore> | null = null;
let boundConnection: unknown = null;

function store(): Promise<OpenGraphTabStore> {
  if (boundStore && getPluginDatabase() !== boundConnection) boundStore = null;
  if (boundStore) return boundStore;
  boundStore = (async () => {
    const connection = await openPluginDatabase();
    boundConnection = connection;
    const created = createOpenGraphTabStore(connection);
    await created.ensureSchema();
    return created;
  })().catch((error: unknown) => {
    boundStore = null;
    throw error;
  });
  return boundStore;
}

export function listOpenGraphTabs(): Promise<OpenGraphTabRecord[]> {
  return store().then((s) => s.list());
}

export function putOpenGraphTabs(
  records: readonly OpenGraphTabRecord[],
): Promise<void> {
  return store().then((s) => s.put(records));
}

export function syncOpenGraphTabs(
  records: readonly OpenGraphTabRecord[],
): Promise<void> {
  return store().then((s) => s.sync(records));
}
