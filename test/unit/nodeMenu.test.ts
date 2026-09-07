import { describe, it } from "node:test";
import { expect } from "chai";
import {
  clampMenuPosition,
  isContextMenuKey,
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
