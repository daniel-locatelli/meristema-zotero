import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";

import {
  runningConnectionUpdate,
  startConnectionUpdate,
} from "../../src/services/connectionUpdates";

let previousZotero: unknown;
const logged: unknown[] = [];

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  logged.length = 0;
  (globalThis as Record<string, unknown>).Zotero = {
    logError: (error: unknown) => logged.push(error),
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

function gate(): {
  promise: Promise<void>;
  open: () => void;
  fail: () => void;
} {
  let open!: () => void;
  let fail!: () => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = () => reject(new Error("offline"));
  });
  return { promise, open, fail };
}

describe("running connection updates (B112)", function () {
  it("shares one running update per library and paper", async function () {
    const held = gate();
    let fetches = 0;
    const fetch = (): Promise<void> => {
      fetches += 1;
      return held.promise;
    };
    const first = startConnectionUpdate(1, "A", fetch);
    expect(startConnectionUpdate(1, "A", fetch)).to.equal(first);
    expect(runningConnectionUpdate(1, "A")).to.equal(first);
    expect(runningConnectionUpdate(2, "A"), "another library").to.equal(
      undefined,
    );
    expect(fetches).to.equal(1);
    held.open();
    expect(await first).to.equal(true);
  });

  it("leaves the registry before what is chained on it runs", async function () {
    const held = gate();
    const run = startConnectionUpdate(1, "B", () => held.promise);
    const seen = run.then(() => runningConnectionUpdate(1, "B"));
    held.open();
    expect(await seen).to.equal(undefined);
  });

  it("resolves false and logs once when the fetch fails", async function () {
    const held = gate();
    const run = startConnectionUpdate(1, "C", () => held.promise);
    held.fail();
    expect(await run).to.equal(false);
    expect(runningConnectionUpdate(1, "C")).to.equal(undefined);
    expect(logged).to.have.length(1);
  });
});
