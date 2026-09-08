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
    ticksNeedDescendants: false,
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

  it("rejects and rolls back if valueQueryAsync returns false for last_insert_rowid", async function () {
    const db = new DatabaseSync(":memory:");
    const baseConnection = fakeConnection(db);
    const brokenConnection: SavedGraphConnection = {
      ...baseConnection,
      async valueQueryAsync() {
        return false;
      },
    };
    const store = createSavedGraphStore(brokenConnection);
    await store.ensureSchema();
    let failed = false;
    try {
      await store.create(1, "Failed", emptyGraphViewState());
    } catch {
      failed = true;
    }
    expect(failed, "create rejected").to.equal(true);
    expect((await store.list(1)).length, "transaction rolled back").to.equal(0);
  });
});
