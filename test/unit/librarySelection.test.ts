import { describe, it } from "node:test";
import { expect } from "chai";
import { resolveLibrarySelection } from "../../src/services/librarySelection";

const keyFor = (itemID: number): string | null =>
  itemID === 404 ? null : `item-${itemID}`;
const visible = new Set(["item-1", "item-2", "item-3"]);

describe("Library selection resolution", function () {
  it("selects the one present node", function () {
    expect(resolveLibrarySelection([1], keyFor, visible)).to.deep.equal({
      select: "item-1",
      emphasise: null,
    });
  });

  it("emphasises two or more present nodes and selects none", function () {
    const result = resolveLibrarySelection([3, 1, 404], keyFor, visible);
    expect(result.select).to.equal(null);
    expect([...result.emphasise!].sort()).to.deep.equal(["item-1", "item-3"]);
  });

  it("clears both when nothing is present", function () {
    expect(resolveLibrarySelection([], keyFor, visible)).to.deep.equal({
      select: null,
      emphasise: null,
    });
    expect(resolveLibrarySelection([404], keyFor, visible)).to.deep.equal({
      select: null,
      emphasise: null,
    });
  });

  it("treats a filtered-out node as absent", function () {
    expect(
      resolveLibrarySelection([1, 9], keyFor, visible),
      "item-9 exists but is not visible: one present, so select it",
    ).to.deep.equal({ select: "item-1", emphasise: null });
  });

  it("collapses duplicates to one present node", function () {
    expect(resolveLibrarySelection([2, 2], keyFor, visible)).to.deep.equal({
      select: "item-2",
      emphasise: null,
    });
  });
});
