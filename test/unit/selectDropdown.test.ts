import { describe, it } from "node:test";
import { expect } from "chai";
import { insideSelectDropdown } from "../../src/services/selectDropdown";

type FakeNode = { id?: string; parentNode: FakeNode | null };

const chain = (...ids: (string | undefined)[]): FakeNode => {
  let node: FakeNode | null = null;
  for (const id of ids.reverse()) node = { id, parentNode: node };
  return node as FakeNode;
};

describe("insideSelectDropdown", function () {
  it("is true for an item inside Zotero's select dropdown popup", function () {
    const item = chain("ContentSelectDropdown", undefined);
    expect(insideSelectDropdown(item)).to.equal(true);
  });

  it("is true for the popup element itself", function () {
    expect(insideSelectDropdown(chain("ContentSelectDropdown"))).to.equal(true);
  });

  it("is false for a node with no such ancestor", function () {
    expect(insideSelectDropdown(chain("main-window", "toolbar", ""))).to.equal(
      false,
    );
  });

  it("is false for null", function () {
    expect(insideSelectDropdown(null)).to.equal(false);
  });
});
