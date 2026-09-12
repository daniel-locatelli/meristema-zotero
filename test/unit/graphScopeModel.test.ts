import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allCollectionsTicked,
  collectionTickState,
  expandTicksThroughDescendants,
  isCollectionTicked,
  onlyCollectionsTicked,
  purgeHiddenKeys,
  computeGraphScope,
  setCollectionTicks,
} from "../../src/services/graphScopeModel";
import type {
  GraphScopeHops,
  GraphScopeInput,
  GraphScopeResult,
  ScopePaper,
} from "../../src/services/graphScopeModel";

function noHops(): GraphScopeHops {
  return { entries: new Map(), depth: 1, enabled: [true, true] };
}

describe("collection ticks", function () {
  it("ticks every folder under the all base, including one made later", function () {
    const ticks = allCollectionsTicked();
    expect(isCollectionTicked(ticks, 1)).to.equal(true);
    expect(isCollectionTicked(ticks, 999)).to.equal(true);
  });

  it("ticks only the named folders under the none base", function () {
    const ticks = onlyCollectionsTicked([2, 3]);
    expect(isCollectionTicked(ticks, 2)).to.equal(true);
    expect(isCollectionTicked(ticks, 4)).to.equal(false);
    expect(isCollectionTicked(ticks, 999)).to.equal(false);
  });

  it("writes a parent's tick to every descendant", function () {
    const off = setCollectionTicks(allCollectionsTicked(), [1, 11, 12], false);
    expect(isCollectionTicked(off, 1)).to.equal(false);
    expect(isCollectionTicked(off, 11)).to.equal(false);
    expect(isCollectionTicked(off, 12)).to.equal(false);
    const on = setCollectionTicks(off, [1, 11, 12], true);
    expect(isCollectionTicked(on, 11)).to.equal(true);
  });

  it("leaves a parent mixed when a descendant is unticked afterwards", function () {
    const off = setCollectionTicks(allCollectionsTicked(), [11], false);
    expect(collectionTickState(off, 1, [11, 12])).to.equal("mixed");
    expect(collectionTickState(off, 11, [])).to.equal("off");
    expect(collectionTickState(allCollectionsTicked(), 1, [11, 12])).to.equal(
      "on",
    );
  });

  it("never mutates the ticks it is given", function () {
    const ticks = onlyCollectionsTicked([2]);
    setCollectionTicks(ticks, [3], true);
    expect(ticks.except).to.deep.equal([2]);
  });

  it("expands each exception through its descendants", function () {
    const descendants = new Map<number, readonly number[]>([
      [1, [11, 12]],
      [11, []],
    ]);
    const expanded = expandTicksThroughDescendants(
      onlyCollectionsTicked([1]),
      descendants,
    );
    expect(expanded).to.deep.equal({ base: "none", except: [1, 11, 12] });
  });
});

function paper(
  key: string,
  collectionIDs: readonly number[] = [],
  inLibrary = true,
): ScopePaper {
  return { key, collectionIDs, inLibrary };
}

function scope(overrides: Partial<GraphScopeInput> = {}): GraphScopeResult {
  return computeGraphScope({
    papers: [],
    seedKeys: new Set(),
    hops: noHops(),
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: new Set(),
    facetAdmits: () => true,
    ...overrides,
  });
}

describe("computeGraphScope", function () {
  it("keeps a seed's neighbour filed in an unticked folder", function () {
    // D1: adding a seed to a folder graph must only ever add papers.
    const result = scope({
      papers: [paper("a", [1]), paper("b", [2])],
      seedKeys: new Set(["a"]),
      hops: {
        entries: new Map([
          ["a", { hop: 0, parents: [] }],
          ["b", { hop: 1, parents: ["a"] }],
        ]),
        depth: 1,
        enabled: [true, true],
      },
      ticks: onlyCollectionsTicked([1]),
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "b"]);
  });

  it("drops a library paper whose only folder is unticked", function () {
    const result = scope({
      papers: [paper("a", [1]), paper("b", [2])],
      ticks: onlyCollectionsTicked([1]),
    });
    expect([...result.visibleKeys]).to.deep.equal(["a"]);
  });

  it("keeps a paper filed in two folders while either is ticked", function () {
    const both = scope({
      papers: [paper("a", [1, 2])],
      ticks: onlyCollectionsTicked([2]),
    });
    expect([...both.visibleKeys]).to.deep.equal(["a"]);
    const neither = scope({
      papers: [paper("a", [1, 2])],
      ticks: onlyCollectionsTicked([3]),
    });
    expect([...neither.visibleKeys]).to.deep.equal([]);
  });

  it("draws an unfiled paper only while Unfiled is ticked", function () {
    expect([...scope({ papers: [paper("a")] }).visibleKeys]).to.deep.equal([
      "a",
    ]);
    const off = scope({ papers: [paper("a")], includeUnfiled: false });
    expect([...off.visibleKeys]).to.deep.equal([]);
  });

  it("hides external papers when Not in Zotero is unticked, but never a seed", function () {
    const result = scope({
      papers: [paper("s", [], false), paper("x", [], false)],
      seedKeys: new Set(["s"]),
      hops: {
        entries: new Map([["x", { hop: 1, parents: ["s"] }]]),
        depth: 1,
        enabled: [true, true],
      },
      includeExternal: false,
    });
    expect([...result.visibleKeys]).to.deep.equal(["s"]);
  });

  it("keeps a seed past a hidden key and an unticked folder", function () {
    const result = scope({
      papers: [paper("s", [1])],
      seedKeys: new Set(["s"]),
      ticks: onlyCollectionsTicked([9]),
      hiddenKeys: new Set(["s"]),
      facetAdmits: () => false,
    });
    expect([...result.visibleKeys]).to.deep.equal(["s"]);
  });

  it("removes a hidden paper the folders admit", function () {
    const result = scope({
      papers: [paper("a", [1]), paper("b", [1])],
      hiddenKeys: new Set(["b"]),
    });
    expect([...result.visibleKeys]).to.deep.equal(["a"]);
    expect(result.hiddenCount).to.equal(1);
  });

  it("lets a facet reach a paper the seed brought in", function () {
    // A year range is a fact about the paper, so it is true of a citer too;
    // a folder is a fact about how you filed it, so it is not.
    const result = scope({
      papers: [paper("s", [1]), paper("old", [2]), paper("new", [2])],
      seedKeys: new Set(["s"]),
      hops: {
        entries: new Map([
          ["s", { hop: 0, parents: [] }],
          ["old", { hop: 1, parents: ["s"] }],
          ["new", { hop: 1, parents: ["s"] }],
        ]),
        depth: 1,
        enabled: [true, true],
      },
      ticks: onlyCollectionsTicked([1]),
      facetAdmits: (key) => key !== "old",
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["new", "s"]);
  });

  it("counts what the rail prints", function () {
    const result = scope({
      papers: [
        paper("a", [1]),
        paper("b", [1, 2]),
        paper("c"),
        paper("x", [], false),
      ],
      ticks: onlyCollectionsTicked([1]),
    });
    expect(result.total).to.equal(4);
    // Only three are admitted: the folder ticks admit `a` and `b`, Unfiled
    // admits `c`, and `x` is external with nothing reaching it, so no
    // admission rule covers it. Not in Zotero only ever removes.
    expect(result.shown).to.equal(3);
    expect(result.countByCollection.get(1)).to.equal(2);
    expect(result.countByCollection.get(2)).to.equal(1);
    expect(result.unfiledCount).to.equal(1);
    expect(result.externalCount).to.equal(1);
  });
});

describe("purgeHiddenKeys", function () {
  it("forgets a hide once the paper is seeded", function () {
    // Precedence alone would draw it, since no rule hides a seed — but the key
    // would sit there waiting, and removing the seed later would make the
    // paper vanish for a reason taken weeks ago and shown nowhere.
    const purged = purgeHiddenKeys(new Set(["a", "b"]), ["b"]);
    expect([...purged]).to.deep.equal(["a"]);
  });

  it("leaves the set alone when no seed was hidden", function () {
    const purged = purgeHiddenKeys(new Set(["a"]), ["b"]);
    expect([...purged]).to.deep.equal(["a"]);
  });
});

function hops(
  spec: Record<string, [number, string[]]>,
  depth: number,
  enabled: boolean[] = [true, true, true, true, true, true, true],
): GraphScopeHops {
  return {
    entries: new Map(
      Object.entries(spec).map(([key, [hop, parents]]) => [
        key,
        { hop, parents },
      ]),
    ),
    depth,
    enabled,
  };
}

describe("computeGraphScope with hops", function () {
  // s → a (hop 1) → b (hop 2) → c (hop 3); every paper external, no folders.
  const chain = hops(
    { s: [0, []], a: [1, ["s"]], b: [2, ["a"]], c: [3, ["b"]] },
    3,
  );
  const external = [
    paper("s"),
    paper("a", [], false),
    paper("b", [], false),
    paper("c", [], false),
  ];

  it("disabling hop 2 hides a hop-3 external paper through its parent", function () {
    const result = scope({
      papers: external,
      seedKeys: new Set(["s"]),
      hops: { ...chain, enabled: [true, true, false, true] },
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "s"]);
    expect(result.shownByHop).to.deep.equal([1, 1, 0, 0]);
    expect(result.availableByHop).to.deep.equal([1, 1, 1, 1]);
  });

  it("keeps a folder-admitted hop-3 library paper and its child when hop 2 is unticked", function () {
    const result = scope({
      papers: [
        paper("s"),
        paper("a", [], false),
        paper("b", [], false),
        paper("c", [1]),
        paper("d", [], false),
      ],
      seedKeys: new Set(["s"]),
      hops: hops(
        {
          s: [0, []],
          a: [1, ["s"]],
          b: [2, ["a"]],
          c: [3, ["b"]],
          d: [4, ["c"]],
        },
        4,
        [true, true, false, true, true],
      ),
    });
    // c is filed in a ticked folder: a seed only ever adds, a hop toggle never
    // removes it. d hangs off c, which is visible, so d stays too.
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "c", "d", "s"]);
  });

  it("hides the child when the folder holding its only parent is unticked", function () {
    const result = scope({
      papers: [paper("s"), paper("p", [7]), paper("q", [], false)],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [7], false),
      includeUnfiled: false,
      hops: hops({ s: [0, []], p: [1, ["s"]], q: [2, ["p"]] }, 2),
    });
    // p is reached by hop 1, so the hop rule admits it whatever the folder;
    // that is today's "unticking a folder never removes what a seed brought".
    expect(result.visibleKeys.has("p")).to.equal(true);
    const unreached = scope({
      papers: [paper("s"), paper("p", [7]), paper("q", [], false)],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [7], false),
      includeUnfiled: false,
      hops: hops({ s: [0, []], q: [2, ["p"]] }, 2),
    });
    // p has no hop entry here (its list is what made q hop 2 in another
    // direction); with its folder unticked it is gone, and so is q.
    expect(unreached.visibleKeys.has("p")).to.equal(false);
    expect(unreached.visibleKeys.has("q")).to.equal(false);
  });

  it("keeps a paper with one visible parent among two", function () {
    const result = scope({
      papers: [
        paper("s"),
        paper("a", [], false),
        paper("b", [], false),
        paper("c", [], false),
      ],
      seedKeys: new Set(["s"]),
      hiddenKeys: new Set(["a"]),
      hops: hops(
        { s: [0, []], a: [1, ["s"]], b: [1, ["s"]], c: [2, ["a", "b"]] },
        2,
      ),
    });
    expect(result.visibleKeys.has("c")).to.equal(true);
  });

  it("does not admit a hop past the depth", function () {
    const result = scope({
      papers: external,
      seedKeys: new Set(["s"]),
      hops: { ...chain, depth: 2 },
    });
    expect(result.visibleKeys.has("c")).to.equal(false);
    expect(result.availableByHop).to.deep.equal([1, 1, 1]);
  });

  it("leaves a library paper no hop reaches to the folder rule", function () {
    const result = scope({
      papers: [paper("s"), paper("lib", [3])],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [3], false),
      hops: hops({ s: [0, []] }, 3, [true, false, false, false]),
    });
    expect(result.visibleKeys.has("lib")).to.equal(false);
  });
});
