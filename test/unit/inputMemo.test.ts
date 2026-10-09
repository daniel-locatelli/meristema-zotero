import { describe, it } from "node:test";
import { expect } from "chai";
import { createInputMemo } from "../../src/services/inputMemo";

describe("inputMemo (B89)", function () {
  const edges = [{ source: "a", target: "b" }];
  const visibleKeys = new Set(["a", "b"]);
  const base = () => ({
    edges,
    edgeCount: 1,
    visibleKeys,
    selectedKey: null as string | null,
    seedLinks: false,
  });

  it("reuses the value while every input is the same one", function () {
    const memo = createInputMemo<Record<string, unknown>, number>();
    let builds = 0;
    const build = () => ++builds;
    expect(memo.get(base(), build)).to.equal(1);
    expect(memo.get(base(), build), "a fresh inputs object").to.equal(1);
    expect(builds).to.equal(1);
  });

  for (const [name, change] of [
    ["the edge array", { edges: [...edges] }],
    ["the edge count", { edgeCount: 2 }],
    ["the visible keys", { visibleKeys: new Set(visibleKeys) }],
    ["the selection", { selectedKey: "a" }],
    ["the colour metric", { seedLinks: true }],
  ] as const) {
    it(`rebuilds when ${name} changes`, function () {
      const memo = createInputMemo<Record<string, unknown>, number>();
      let builds = 0;
      const build = () => ++builds;
      memo.get(base(), build);
      expect(memo.get({ ...base(), ...change }, build)).to.equal(2);
      expect(
        memo.get({ ...base(), ...change }, build),
        "and keeps the rebuilt value",
      ).to.equal(2);
    });
  }

  it("rebuilds when an input is added or dropped", function () {
    const memo = createInputMemo<Record<string, unknown>, number>();
    let builds = 0;
    const build = () => ++builds;
    memo.get(base(), build);
    expect(memo.get({ ...base(), hidden: 0 }, build)).to.equal(2);
    expect(memo.get(base(), build)).to.equal(3);
  });

  it("rebuilds whatever the inputs say when reuse is off", function () {
    // The renderer's owner mutates the edge array in place, so only a draw
    // that knows nothing changed may reuse.
    const memo = createInputMemo<Record<string, unknown>, number>();
    let builds = 0;
    const build = () => ++builds;
    memo.get(base(), build);
    expect(memo.get(base(), build, false)).to.equal(2);
    expect(memo.get(base(), build), "the rebuilt value is kept").to.equal(2);
  });
});
