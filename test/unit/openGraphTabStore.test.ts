import { describe, it } from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect } from "chai";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createOpenGraphTabStore,
  planBackgroundMounts,
  planOpenGraphTabRestore,
  restoredGraphToSelect,
  restoredGraphState,
  type OpenGraphTabRecord,
  type OpenGraphTabStore,
} from "../../src/services/openGraphTabStore";
import type { SavedGraphConnection } from "../../src/services/savedGraphService";

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
  store: OpenGraphTabStore;
  db: DatabaseSync;
}> {
  const db = new DatabaseSync(":memory:");
  const store = createOpenGraphTabStore(fakeConnection(db));
  await store.ensureSchema();
  return { store, db };
}

function seededState(itemKey: string) {
  return {
    ...emptyGraphViewState(),
    seeds: [{ kind: "item" as const, itemKey }],
    ticksNeedDescendants: false,
  };
}

function record(
  key: string,
  overrides: Partial<OpenGraphTabRecord> = {},
): OpenGraphTabRecord {
  return {
    key,
    libraryID: 1,
    position: 1,
    selected: false,
    savedGraphID: null,
    title: key,
    customTitle: false,
    titleCollectionIDs: null,
    state: seededState("AAAA0001"),
    ...overrides,
  };
}

describe("open graph tab store", function () {
  it("creates the schema once and tolerates a second call", async function () {
    const { store, db } = await openStore();
    await store.ensureSchema();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).to.include("open_graph_tabs_v1");
  });

  it("round-trips a record", async function () {
    const { store } = await openStore();
    const written = record("one", {
      libraryID: 3,
      position: 2,
      selected: true,
      savedGraphID: 7,
      title: "PhD Graph",
      customTitle: true,
      titleCollectionIDs: [4, 5],
    });
    await store.put([written]);
    expect(await store.list()).to.deep.equal([written]);
  });

  it("lists by position, a detached window's graph last", async function () {
    const { store } = await openStore();
    await store.put([
      record("detached", { position: null }),
      record("third", { position: 3 }),
      record("first", { position: 1 }),
    ]);
    expect((await store.list()).map((entry) => entry.key)).to.deep.equal([
      "first",
      "third",
      "detached",
    ]);
  });

  it("put replaces a record under the same key", async function () {
    const { store } = await openStore();
    await store.put([record("one", { position: 1 })]);
    await store.put([
      record("one", { position: 4, state: seededState("BBBB0002") }),
    ]);
    const listed = await store.list();
    expect(listed.length).to.equal(1);
    expect(listed[0].position).to.equal(4);
    expect(listed[0].state?.seeds).to.deep.equal([
      { kind: "item", itemKey: "BBBB0002" },
    ]);
  });

  it("put leaves records it was not given alone", async function () {
    const { store } = await openStore();
    await store.put([record("one"), record("two", { position: 2 })]);
    await store.put([record("one", { position: 3 })]);
    expect((await store.list()).map((entry) => entry.key)).to.deep.equal([
      "two",
      "one",
    ]);
  });

  it("sync keeps exactly the records it is given", async function () {
    const { store } = await openStore();
    await store.put([record("closed"), record("open", { position: 2 })]);
    await store.sync([record("open", { position: 1 })]);
    expect((await store.list()).map((entry) => entry.key)).to.deep.equal([
      "open",
    ]);
    await store.sync([]);
    expect(await store.list()).to.deep.equal([]);
  });

  it("reads a state that no longer parses as null", async function () {
    const { store, db } = await openStore();
    await store.put([record("damaged")]);
    db.prepare("UPDATE open_graph_tabs_v1 SET state = ? WHERE key = ?").run(
      "{not json",
      "damaged",
    );
    expect((await store.list())[0].state).to.equal(null);
  });
});

describe("restoredGraphState", function () {
  it("comes back stopped, whether the fill was running or stopped", function () {
    const running = { ...seededState("AAAA0001"), fillStopped: false };
    expect(restoredGraphState(running, null)?.fillStopped).to.equal(true);
    const stopped = { ...seededState("AAAA0001"), fillStopped: true };
    expect(restoredGraphState(stopped, null)?.fillStopped).to.equal(true);
  });

  it("prefers the tab's own state, which carries edits the row does not", function () {
    const snapshot = {
      ...seededState("AAAA0001"),
      camera: { x: 10, y: 20, scale: 2 },
    };
    const row = seededState("BBBB0002");
    const restored = restoredGraphState(snapshot, row);
    expect(restored?.seeds).to.deep.equal(snapshot.seeds);
    expect(restored?.camera).to.deep.equal(snapshot.camera);
  });

  it("falls back to the saved graph's row when the tab's state is unreadable", function () {
    const row = seededState("BBBB0002");
    expect(restoredGraphState(null, row)?.seeds).to.deep.equal(row.seeds);
    expect(restoredGraphState(null, row)?.fillStopped).to.equal(true);
  });

  it("has nothing to restore when neither is readable", function () {
    expect(restoredGraphState(null, null)).to.equal(null);
  });
});

describe("planOpenGraphTabRestore", function () {
  it("puts each graph back at its place among the tabs Zotero restored", function () {
    // Before the restart: library, reader, Graph A, reader, Graph B. Zotero
    // restores its own three tabs; the graphs go back between them.
    const plan = planOpenGraphTabRestore(
      [record("b", { position: 4 }), record("a", { position: 2 })],
      3,
    );
    expect(
      plan.steps.map((step) => [step.record.key, step.index]),
    ).to.deep.equal([
      ["a", 2],
      ["b", 4],
    ]);
  });

  it("clamps a place past the end to the end, never before the library tab", function () {
    // A reader tab whose item was deleted is not restored, so there are
    // fewer tabs than there were.
    const plan = planOpenGraphTabRestore(
      [record("a", { position: 0 }), record("b", { position: 9 })],
      1,
    );
    expect(
      plan.steps.map((step) => [step.record.key, step.index]),
    ).to.deep.equal([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("appends a detached window's graph as a tab", function () {
    const plan = planOpenGraphTabRestore(
      [record("detached", { position: null }), record("a", { position: 1 })],
      2,
    );
    expect(
      plan.steps.map((step) => [step.record.key, step.index]),
    ).to.deep.equal([
      ["a", 1],
      ["detached", 3],
    ]);
  });

  it("selects the graph that was selected, and none when a Zotero tab was", function () {
    expect(
      planOpenGraphTabRestore(
        [record("a"), record("b", { position: 2, selected: true })],
        1,
      ).selectKey,
    ).to.equal("b");
    expect(
      planOpenGraphTabRestore([record("a"), record("b", { position: 2 })], 1)
        .selectKey,
    ).to.equal(null);
  });

  it("opens a saved graph once, however many records name it", function () {
    const plan = planOpenGraphTabRestore(
      [
        record("a", { savedGraphID: 5 }),
        record("b", { position: 2, savedGraphID: 5 }),
        record("c", { position: 3 }),
      ],
      1,
    );
    expect(plan.steps.map((step) => step.record.key)).to.deep.equal(["a", "c"]);
  });
});

describe("planBackgroundMounts", function () {
  it("draws the restored tabs in tab order, all but the one drawn already (B109)", function () {
    expect(
      planBackgroundMounts(
        ["zotero-pane", "c", "reader-1", "a", "b"],
        ["a", "b", "c"],
        "a",
      ),
    ).to.deep.equal(["c", "b"]);
  });

  it("draws every restored tab when none was drawn first", function () {
    expect(
      planBackgroundMounts(["zotero-pane", "b", "a"], ["a", "b"], null),
    ).to.deep.equal(["b", "a"]);
  });

  it("leaves out a restored tab no longer in the tab bar", function () {
    expect(
      planBackgroundMounts(["zotero-pane", "a"], ["a", "b"], null),
    ).to.deep.equal(["a"]);
  });
});

describe("restoredGraphToSelect", function () {
  it("selects the graph selected at quit while the library tab still is (B110)", function () {
    // Zotero's session holds no selected tab when a graph was, so its
    // restore leaves the library tab selected.
    expect(restoredGraphToSelect("a", "zotero-pane")).to.equal("a");
  });

  it("leaves a tab the reader chose since alone", function () {
    expect(restoredGraphToSelect("a", "reader-1")).to.equal(null);
  });

  it("selects nothing when a Zotero tab was selected at quit", function () {
    expect(restoredGraphToSelect(null, "zotero-pane")).to.equal(null);
    expect(restoredGraphToSelect(null, "reader-1")).to.equal(null);
  });
});
