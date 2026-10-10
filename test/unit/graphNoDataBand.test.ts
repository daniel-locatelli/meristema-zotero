import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { WORLD_PLOT } from "../../src/services/graphFloor";
import {
  MISSING_X,
  MISSING_Y,
  NO_DATA_GAP,
  noDataBands,
  type WorldRect,
} from "../../src/services/graphRendererScene";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * The No data bands (B48). A paper with no value for an axis is parked in a
 * tinted band inside the frame, set apart from the data region by a bare gap,
 * so it cannot read as a real low value. Where both lanes are drawn the two
 * bands meet in the corner, and the paper missing both values sits there.
 */
describe("No data bands", function () {
  function contains(rect: WorldRect, x: number, y: number): boolean {
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  it("draws no band for an axis with nothing parked", function () {
    expect(noDataBands({ x: false, y: false })).to.deep.equal({
      x: null,
      y: null,
    });
  });

  it("parks the x lane in a band left of the plot, past a gap", function () {
    const { x } = noDataBands({ x: true, y: false });
    expect(x).to.not.equal(null);
    expect(WORLD_PLOT.left - x!.right).to.equal(NO_DATA_GAP);
    expect(NO_DATA_GAP).to.be.greaterThan(35);
    expect(x!.top).to.equal(WORLD_PLOT.top);
    expect(x!.bottom).to.equal(WORLD_PLOT.bottom);
    expect(contains(x!, MISSING_X, WORLD_PLOT.top)).to.equal(true);
  });

  it("parks the y lane in a band below the plot, past a gap", function () {
    const { y } = noDataBands({ x: false, y: true });
    expect(y).to.not.equal(null);
    expect(y!.top - WORLD_PLOT.bottom).to.equal(NO_DATA_GAP);
    expect(y!.left).to.equal(WORLD_PLOT.left);
    expect(y!.right).to.equal(WORLD_PLOT.right);
    expect(contains(y!, WORLD_PLOT.left, MISSING_Y)).to.equal(true);
  });

  it("joins the two bands in the corner when both are drawn", function () {
    const { x, y } = noDataBands({ x: true, y: true });
    expect(x!.bottom).to.equal(y!.bottom);
    expect(y!.left).to.equal(x!.left);
    expect(contains(x!, MISSING_X, MISSING_Y)).to.equal(true);
    expect(contains(y!, MISSING_X, MISSING_Y)).to.equal(true);
  });

  function placed(nodes: CitationGraphNode[]): CitationGraphRenderer {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(nodes),
      layout: { ...FREE_LAYOUT, xMetric: "year", yMetric: "citations" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    return renderer;
  }

  it("keeps a crowd of No data papers inside the band, clear of the gap", function () {
    const unknown = Array.from({ length: 40 }, (_value, index) =>
      node(`unknown${index}`, { year: 2026, citationCount: null }),
    );
    const renderer = placed([
      node("old", { year: 2000, citationCount: 1200 }),
      node("new", { year: 2026, citationCount: 0 }),
      ...unknown,
    ]);
    const band = noDataBands({ x: false, y: true }).y!;
    const astray = unknown
      .map((paper) => ({ key: paper.key, ...renderer.positionOf(paper.key)! }))
      .filter(({ y }) => y < band.top || y > band.bottom);
    expect(
      astray,
      `No data papers outside the band (${band.top}..${band.bottom})`,
    ).to.deep.equal([]);
  });

  it("fits the bands and the corner into the plot", function () {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("old", { year: 2000, citationCount: 1200 }),
        node("new", { year: 2026, citationCount: 0 }),
        node("none", { year: null, citationCount: null }),
      ]),
      layout: { ...FREE_LAYOUT, xMetric: "year", yMetric: "citations" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.fitView();
    const view = renderer.getViewTransform();
    const { x, y } = noDataBands({ x: true, y: true });
    const left = view.x + x!.left * view.scale;
    const bottom = view.y + y!.bottom * view.scale;
    expect(left, "band's left edge on the canvas").to.be.at.least(0);
    expect(bottom, "band's bottom edge on the canvas").to.be.at.most(
      canvas.height,
    );
  });
});
