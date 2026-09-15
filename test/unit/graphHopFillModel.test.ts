import { describe, it } from "node:test";
import { expect } from "chai";
import type { HopEntry } from "../../src/services/graphHopModel";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
} from "../../src/services/graphHopFillModel";

function entry(
  key: string,
  hop: number,
  parents: string[] = [],
  expanded = false,
): [string, HopEntry] {
  return [key, { key, hop, parents, expanded }];
}

function input(overrides: Partial<HopFillInput> = {}): HopFillInput {
  return {
    entries: new Map([
      entry("s", 0, [], true),
      entry("a", 1, ["s"]),
      entry("b", 1, ["s"]),
      entry("c", 1, ["s"]),
      entry("d", 1, ["s"]),
    ]),
    visibleKeys: new Set(["s", "a", "b", "c", "d"]),
    depth: 2,
    selectedKey: null,
    hoveredKey: null,
    onScreenKeys: new Set(),
    failedKeys: new Set(),
    deferredKeys: new Set(),
    expandedByHop: [0, 0, 0],
    capByHop: [HOP_EXPANSION_CAP, HOP_EXPANSION_CAP, HOP_EXPANSION_CAP],
    reportedCountOf: () => null,
    ...overrides,
  };
}

describe("planHopFill", function () {
  it("leaves hidden papers out: scope gates the fill", function () {
    const plan = planHopFill(input({ visibleKeys: new Set(["s", "a"]) }));
    expect(plan.order).to.deep.equal(["a"]);
  });

  it("orders seeds, then selected, hovered, on screen, the rest", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0),
          entry("a", 1, ["s"]),
          entry("b", 1, ["s"]),
          entry("c", 1, ["s"]),
          entry("d", 1, ["s"]),
        ]),
        selectedKey: "c",
        hoveredKey: "b",
        onScreenKeys: new Set(["d"]),
      }),
    );
    expect(plan.order).to.deep.equal(["s", "c", "b", "d", "a"]);
  });

  it("lets the camera reorder but never add or remove", function () {
    const before = planHopFill(input());
    const after = planHopFill(input({ onScreenKeys: new Set(["d"]) }));
    expect([...after.order].sort()).to.deep.equal([...before.order].sort());
    expect(after.order[0]).to.equal("d");
  });

  it("skips expanded and failed papers", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0, [], true),
          entry("a", 1, ["s"], true),
          entry("b", 1, ["s"]),
        ]),
        failedKeys: new Set(["b"]),
      }),
    );
    expect(plan.order).to.deep.equal([]);
  });

  it("skips papers at the depth", function () {
    const plan = planHopFill(
      input({
        depth: 1,
        entries: new Map([entry("s", 0, [], true), entry("a", 1, ["s"])]),
      }),
    );
    expect(plan.order).to.deep.equal([]);
  });

  it("breaks ties by the parent's reported count, then key", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0, [], true),
          entry("t", 0, [], true),
          entry("a", 1, ["s"]),
          entry("b", 1, ["t"]),
          entry("c", 1, ["t"]),
        ]),
        visibleKeys: new Set(["s", "t", "a", "b", "c"]),
        reportedCountOf: (key) => (key === "t" ? 900 : key === "s" ? 10 : null),
      }),
    );
    expect(plan.order).to.deep.equal(["b", "c", "a"]);
  });

  it("holds a hop at its cap and counts what waits", function () {
    const plan = planHopFill(
      input({ expandedByHop: [0, 2, 0], capByHop: [500, 2, 500] }),
    );
    expect(plan.order).to.deep.equal([]);
    expect(plan.waitingByHop).to.deep.equal([0, 4, 0]);
    const raised = planHopFill(
      input({ expandedByHop: [0, 2, 0], capByHop: [500, 502, 500] }),
    );
    expect(raised.order.length).to.equal(4);
    expect(raised.waitingByHop).to.deep.equal([0, 0, 0]);
  });

  it("reports how many remain per hop", function () {
    const plan = planHopFill(input());
    expect(plan.remainingByHop).to.deep.equal([0, 4, 0]);
  });

  it("holds a deferred paper out of the order but counts it as left, not waiting", function () {
    const plan = planHopFill(
      input({
        deferredKeys: new Set(["a"]),
        expandedByHop: [0, 2, 0],
        capByHop: [500, 2, 500],
      }),
    );
    expect(plan.order).to.deep.equal([]);
    expect(plan.remainingByHop).to.deep.equal([0, 4, 0]);
    expect(plan.deferredByHop).to.deep.equal([0, 1, 0]);
    expect(plan.waitingByHop, "even at a full cap").to.deep.equal([0, 3, 0]);
    expect(plan.deferred).to.deep.equal(["a"]);
  });

  it("plans the rest while one paper is deferred", function () {
    const plan = planHopFill(input({ deferredKeys: new Set(["b"]) }));
    expect(plan.order).to.deep.equal(["a", "c", "d"]);
    expect(plan.deferredByHop).to.deep.equal([0, 1, 0]);
  });
});
