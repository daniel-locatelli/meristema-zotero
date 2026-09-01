import { describe, it } from "node:test";
import { expect } from "chai";

import {
  arrivalDirection,
  curveControlPoint,
  edgeBaseOpacity,
  edgeLineInset,
  reciprocalEdgeKeys,
  shouldDrawArrowhead,
  ARROWHEAD_MIN_ZOOM,
} from "../../src/services/graphEdgeStyle";

describe("Graph edge style", () => {
  it("never strengthens an edge as the mesh thickens", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const count of [0, 1, 100, 240, 241, 500, 1000, 3200, 9000]) {
      const opacity = edgeBaseOpacity(count);
      expect(opacity, `${count} edges`).to.be.at.most(previous);
      expect(opacity, `${count} edges`).to.be.within(0, 1);
      previous = opacity;
    }
  });

  it("draws a sparse graph's edges at full strength and a dense one's above a floor", () => {
    expect(edgeBaseOpacity(120)).to.equal(1);
    expect(edgeBaseOpacity(20_000)).to.be.above(0.2);
  });

  it("finds only the edges that have a partner running the other way", () => {
    const reciprocal = reciprocalEdgeKeys([
      { source: "a", target: "b" },
      { source: "b", target: "a" },
      { source: "b", target: "c" },
      // A self-edge is not its own reciprocal; bowing it would be meaningless.
      { source: "d", target: "d" },
    ]);
    expect([...reciprocal].sort()).to.deep.equal(["a>b", "b>a"]);
  });

  it("bows the two halves of a reciprocal pair to opposite sides", () => {
    // Composed, not in pieces. This held for the sign function alone while the
    // pair still overdrew on screen: the control offset runs along the chord's
    // own normal, which reverses with the chord, so a sign derived from the two
    // keys cancelled against it and put both halves on the same side.
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 40 };
    const forward = curveControlPoint(a, b, 8);
    const backward = curveControlPoint(b, a, 8);
    const midpoint = { x: 50, y: 20 };
    const side = (control: { x: number; y: number }): number =>
      Math.sign(
        (b.x - a.x) * (control.y - midpoint.y) -
          (b.y - a.y) * (control.x - midpoint.x),
      );
    expect(side(forward)).to.not.equal(0);
    expect(side(forward)).to.equal(-side(backward));
  });

  it("places the control point so the curve's apex sits at the asked-for offset", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 0 };
    const control = curveControlPoint(source, target, 8);
    // The midpoint of a quadratic is halfway between the chord's midpoint and
    // the control point, so the control has to sit at twice the apex.
    const apexX = 0.25 * source.x + 0.5 * control.x + 0.25 * target.x;
    const apexY = 0.25 * source.y + 0.5 * control.y + 0.25 * target.y;
    expect(apexX).to.be.closeTo(50, 1e-9);
    expect(Math.abs(apexY)).to.be.closeTo(8, 1e-9);
  });

  it("collapses to the chord's own direction when the edge is straight", () => {
    // A straight edge passes its midpoint as the control point.
    const target = { x: 10, y: 60 };
    const midpoint = { x: 10, y: 35 };
    expect(arrivalDirection(midpoint, target)).to.deep.equal({ x: 0, y: 1 });
  });

  it("aims the arrowhead along the curve's tangent, not the chord", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 0 };
    const control = curveControlPoint(source, target, 8);
    const arrival = arrivalDirection(control, target);
    expect(arrival.y).to.not.equal(0);
    expect(Math.hypot(arrival.x, arrival.y)).to.be.closeTo(1, 1e-9);
  });

  it("stops the line at the head's base so the two never composite twice", () => {
    // The bug this pins: the line ran to the head's tip, so its last six pixels
    // lay under the triangle. Both are drawn at the edge's own alpha, so the
    // shaft showed through the head as a darker streak.
    const tip = 9;
    const head = 6;
    const line = edgeLineInset(tip, head, true, 0.5);
    expect(line).to.be.above(tip);
    // The head's base is `head` back from the tip; the line may reach it, and
    // overlap by the seam allowance, but no further.
    expect(line).to.be.at.most(tip + head);
    expect(line).to.equal(tip + head - 0.5);
  });

  it("runs the line to the node's edge when no head is drawn", () => {
    expect(edgeLineInset(9, 6, false, 0.5)).to.equal(9);
  });

  it("never pulls the line back past the node when the head is tiny", () => {
    expect(edgeLineInset(9, 0.2, true, 0.5)).to.equal(9);
  });

  it("keeps a lit arrowhead at any zoom and drops an unlit one when small", () => {
    expect(shouldDrawArrowhead(0.2, true)).to.equal(true);
    expect(shouldDrawArrowhead(0.2, false)).to.equal(false);
    expect(shouldDrawArrowhead(ARROWHEAD_MIN_ZOOM, false)).to.equal(false);
    expect(shouldDrawArrowhead(1, false)).to.equal(true);
  });
});
