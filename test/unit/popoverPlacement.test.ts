import { describe, it } from "node:test";
import { expect } from "chai";
import { popoverOverflowsEnd } from "../../src/services/popoverPlacement";

describe("popoverOverflowsEnd", function () {
  it("is false when the popover fits before the window's right edge", function () {
    expect(popoverOverflowsEnd(100, 320, 1000)).to.equal(false);
  });

  it("is false when the popover ends exactly at the right edge", function () {
    expect(popoverOverflowsEnd(680, 320, 1000)).to.equal(false);
  });

  it("is true when the popover would extend past the right edge", function () {
    expect(popoverOverflowsEnd(700, 320, 1000)).to.equal(true);
  });

  it("is false when a measurement is missing or zero", function () {
    expect(popoverOverflowsEnd(700, 0, 1000)).to.equal(false);
    expect(popoverOverflowsEnd(700, 320, 0)).to.equal(false);
    expect(popoverOverflowsEnd(Number.NaN, 320, 1000)).to.equal(false);
  });
});
