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
  GraphScopeInput,
  GraphScopeResult,
  ScopePaper,
} from "../../src/services/graphScopeModel";

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
    reachedKeys: new Set(),
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
      reachedKeys: new Set(["b"]),
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
      reachedKeys: new Set(["x"]),
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
      reachedKeys: new Set(["old", "new"]),
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
