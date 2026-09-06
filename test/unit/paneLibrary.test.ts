import { describe, it } from "node:test";
import { expect } from "chai";
import { paneSelectedLibraryID } from "../../src/services/paneLibrary";

describe("paneSelectedLibraryID", function () {
  it("reads the first library from the current plural API", function () {
    const pane = { getSelectedLibraryIDs: () => [3, 5] };
    expect(paneSelectedLibraryID(pane)).to.equal(3);
  });

  it("falls back to the legacy singular API on older Zotero", function () {
    const pane = { getSelectedLibraryID: () => 2 };
    expect(paneSelectedLibraryID(pane)).to.equal(2);
  });

  it("survives the legacy API throwing after its removal", function () {
    const pane = {
      getSelectedLibraryID: () => {
        throw new Error("ZoteroPane.getSelectedLibraryID() was removed");
      },
    };
    expect(paneSelectedLibraryID(pane)).to.equal(null);
  });

  it("returns null for an empty selection or a missing pane", function () {
    expect(paneSelectedLibraryID({ getSelectedLibraryIDs: () => [] })).to.equal(
      null,
    );
    expect(paneSelectedLibraryID(undefined)).to.equal(null);
  });
});
