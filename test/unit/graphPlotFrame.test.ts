import { describe, it } from "node:test";
import { expect } from "chai";

import {
  axisInsets,
  fitInsets,
  plotRect,
  type PlotAxisState,
} from "../../src/services/graphPlotFrame";

const AXIS_STATES: PlotAxisState[] = [
  { xFree: false, yFree: false },
  { xFree: true, yFree: false },
  { xFree: false, yFree: true },
  { xFree: true, yFree: true },
];

const RATIOS = [1, 1.25, 1.5, 2, 2.5, 3];

describe("Graph plot frame", () => {
  it("never fits a view inside the space the axis furniture occupies", () => {
    // The bug this pins: flat device-pixel fit gutters against a ratio-scaled
    // axis meant nodes landed beneath the y-axis labels on a scaled display.
    for (const ratio of RATIOS) {
      for (const axes of AXIS_STATES) {
        const axis = axisInsets(ratio, axes);
        const fit = fitInsets(ratio, axes);
        expect(fit.left, `left at ${ratio}`).to.be.at.least(axis.left);
        expect(fit.right, `right at ${ratio}`).to.be.at.least(axis.right);
        expect(fit.top, `top at ${ratio}`).to.be.at.least(axis.top);
        expect(fit.bottom, `bottom at ${ratio}`).to.be.at.least(axis.bottom);
      }
    }
  });

  it("reserves exactly what the fit reserved before, at ratio one", () => {
    expect(fitInsets(1, { xFree: false, yFree: false })).to.deep.equal({
      left: 64,
      right: 32,
      top: 28,
      bottom: 72,
    });
    expect(fitInsets(1, { xFree: true, yFree: false }).bottom).to.equal(32);
  });

  it("scales every inset with the device pixel ratio", () => {
    const single = axisInsets(1, { xFree: false, yFree: false });
    const double = axisInsets(2, { xFree: false, yFree: false });
    expect(double.left).to.equal(single.left * 2);
    expect(double.bottom).to.equal(single.bottom * 2);
    expect(fitInsets(2, { xFree: false, yFree: false }).left).to.equal(
      fitInsets(1, { xFree: false, yFree: false }).left * 2,
    );
  });

  it("gives a free axis back the room its labels would have taken", () => {
    const labelled = axisInsets(1, { xFree: false, yFree: false });
    const bare = axisInsets(1, { xFree: true, yFree: true });
    expect(bare.left).to.be.below(labelled.left);
    expect(bare.bottom).to.be.below(labelled.bottom);
  });

  it("derives the plot rectangle from the canvas and its insets", () => {
    const rect = plotRect(
      1000,
      600,
      axisInsets(1, { xFree: false, yFree: false }),
    );
    expect(rect.left).to.equal(58);
    expect(rect.top).to.equal(14);
    expect(rect.right).to.equal(986);
    expect(rect.bottom).to.equal(558);
    expect(rect.width).to.equal(928);
    expect(rect.height).to.equal(544);
  });

  it("degrades to an empty rectangle rather than an inverted one", () => {
    const rect = plotRect(
      20,
      10,
      axisInsets(1, { xFree: false, yFree: false }),
    );
    expect(rect.width).to.equal(0);
    expect(rect.height).to.equal(0);
    expect(rect.right).to.be.at.least(rect.left);
    expect(rect.bottom).to.be.at.least(rect.top);
  });
});
