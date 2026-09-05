import { describe, it } from "node:test";
import { expect } from "chai";
import { popoverShouldAnchorEnd } from "../../src/services/popoverPlacement";

describe("popoverShouldAnchorEnd", function () {
  it("is false when the popover fits before the container's right edge", function () {
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 100,
        buttonRight: 180,
        popoverWidth: 320,
        containerLeft: 0,
        containerRight: 1000,
      }),
    ).to.equal(false);
  });

  it("is false when the popover ends exactly at the container's right edge", function () {
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 680,
        buttonRight: 760,
        popoverWidth: 320,
        containerLeft: 0,
        containerRight: 1000,
      }),
    ).to.equal(false);
  });

  it("is true when the popover would extend past the container's right edge", function () {
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 700,
        buttonRight: 780,
        popoverWidth: 320,
        containerLeft: 0,
        containerRight: 1000,
      }),
    ).to.equal(true);
  });

  it("measures against the container, not the window", function () {
    // The pane runs from 200 to 700 inside a 1000-wide window, so a
    // window-relative test would miss this overflow.
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 500,
        buttonRight: 580,
        popoverWidth: 320,
        containerLeft: 200,
        containerRight: 700,
      }),
    ).to.equal(true);
  });

  it("is false when the end-anchored box would cross the container's left edge", function () {
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 340,
        buttonRight: 420,
        popoverWidth: 430,
        containerLeft: 300,
        containerRight: 700,
      }),
    ).to.equal(false);
  });

  it("is true when the end-anchored box ends exactly at the container's left edge", function () {
    expect(
      popoverShouldAnchorEnd({
        buttonLeft: 650,
        buttonRight: 730,
        popoverWidth: 430,
        containerLeft: 300,
        containerRight: 700,
      }),
    ).to.equal(true);
  });

  it("is false when a measurement is missing, zero or not a number", function () {
    const base = {
      buttonLeft: 700,
      buttonRight: 780,
      popoverWidth: 320,
      containerLeft: 0,
      containerRight: 1000,
    };
    expect(popoverShouldAnchorEnd({ ...base, popoverWidth: 0 })).to.equal(
      false,
    );
    expect(popoverShouldAnchorEnd({ ...base, containerRight: 0 })).to.equal(
      false,
    );
    expect(popoverShouldAnchorEnd({ ...base, containerLeft: 1000 })).to.equal(
      false,
    );
    expect(
      popoverShouldAnchorEnd({ ...base, buttonLeft: Number.NaN }),
    ).to.equal(false);
    expect(
      popoverShouldAnchorEnd({ ...base, buttonRight: Number.NaN }),
    ).to.equal(false);
    expect(
      popoverShouldAnchorEnd({ ...base, popoverWidth: Number.NaN }),
    ).to.equal(false);
  });
});
