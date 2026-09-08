import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allCollectionsTicked,
  collectionTickState,
  expandTicksThroughDescendants,
  isCollectionTicked,
  onlyCollectionsTicked,
  setCollectionTicks,
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
