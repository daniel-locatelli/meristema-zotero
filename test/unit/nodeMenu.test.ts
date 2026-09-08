import { describe, it } from "node:test";
import { expect } from "chai";
import {
  clampMenuPosition,
  isContextMenuKey,
  openPaperEntry,
} from "../../src/services/nodeMenu";

describe("clampMenuPosition", function () {
  const pane = {
    paneWidth: 800,
    paneHeight: 600,
    menuWidth: 200,
    menuHeight: 80,
  };

  it("keeps the pointer position when the menu fits", function () {
    expect(clampMenuPosition({ x: 100, y: 100, ...pane })).to.deep.equal({
      left: 100,
      top: 100,
    });
  });

  it("pulls the menu back from the right and bottom edges", function () {
    expect(clampMenuPosition({ x: 700, y: 580, ...pane })).to.deep.equal({
      left: 600,
      top: 520,
    });
  });

  it("never goes past the left or top edges", function () {
    expect(clampMenuPosition({ x: -30, y: -10, ...pane })).to.deep.equal({
      left: 0,
      top: 0,
    });
  });

  it("prefers the top-left corner when the menu is larger than the pane", function () {
    expect(
      clampMenuPosition({
        x: 50,
        y: 50,
        paneWidth: 100,
        paneHeight: 50,
        menuWidth: 200,
        menuHeight: 80,
      }),
    ).to.deep.equal({ left: 0, top: 0 });
  });
});

describe("isContextMenuKey", function () {
  it("is true for Shift+F10 and the ContextMenu key", function () {
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).to.equal(true);
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).to.equal(
      true,
    );
  });

  it("is false for F10 alone and for other keys", function () {
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).to.equal(false);
    expect(isContextMenuKey({ key: "Enter", shiftKey: true })).to.equal(false);
  });
});

describe("openPaperEntry", function () {
  const local = {
    kind: "local" as const,
    itemID: 42,
    doi: null,
    externalWork: null,
  };

  it("opens the PDF when the item has one", function () {
    expect(
      openPaperEntry({ ...local, doi: "10.1/x" }, "pdf", null),
    ).to.deep.equal({
      label: "Open PDF",
      target: { kind: "attachment", itemID: 42 },
    });
  });

  it("names another attachment kind honestly", function () {
    expect(openPaperEntry(local, "snapshot", null)?.label).to.equal(
      "Open attachment",
    );
    expect(openPaperEntry(local, "other", null)?.label).to.equal(
      "Open attachment",
    );
  });

  it("falls back to the DOI, then the item's URL, when there is no attachment", function () {
    expect(
      openPaperEntry({ ...local, doi: "10.1/x" }, "none", "https://a"),
    ).to.deep.equal({
      label: "Open online",
      target: { kind: "url", url: "https://doi.org/10.1%2Fx" },
    });
    expect(openPaperEntry(local, "none", "https://a")).to.deep.equal({
      label: "Open online",
      target: { kind: "url", url: "https://a" },
    });
    expect(openPaperEntry(local, null, " ")).to.equal(null);
  });

  it("opens an external node at its provider address", function () {
    const external = {
      kind: "external" as const,
      itemID: -1,
      doi: null,
      externalWork: {
        provider: "openalex",
        providerWorkID: "W1",
        doi: null,
      } as any,
    };
    const entry = openPaperEntry(external, null, null);
    expect(entry?.label).to.equal("Open online");
    expect(entry?.target).to.deep.equal({
      kind: "url",
      url: "https://openalex.org/W1",
    });
  });

  it("offers nothing when the paper has no address", function () {
    expect(openPaperEntry(local, "none", null)).to.equal(null);
    expect(openPaperEntry(local, null, null)).to.equal(null);
  });
});
