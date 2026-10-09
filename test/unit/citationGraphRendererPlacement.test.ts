import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { WORLD_PLOT } from "../../src/services/graphFloor";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * Where the overlap relaxation may move a node (B47). A crowd of papers that
 * share one value is spread apart so each disc can be read, but a paper must
 * never be pushed across an edge of the plot box: below the zero line it reads
 * as a negative count and lands in the No data lane, and a No data paper
 * pushed up into the plot reads as a real low value.
 */
describe("CitationGraphRenderer placement", function () {
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

  function crowd(
    prefix: string,
    count: number,
    overrides: Partial<CitationGraphNode>,
  ): CitationGraphNode[] {
    return Array.from({ length: count }, (_value, index) =>
      node(`${prefix}${index}`, overrides),
    );
  }

  it("keeps a crowd of uncited papers on or above the zero line", function () {
    const fresh = crowd("fresh", 40, { year: 2026, citationCount: 0 });
    const renderer = placed([
      node("old", { year: 2000, citationCount: 1200 }),
      ...fresh,
    ]);
    const below = fresh
      .map((paper) => ({
        key: paper.key,
        y: renderer.positionOf(paper.key)!.y,
      }))
      .filter(({ y }) => y > WORLD_PLOT.bottom);
    expect(
      below,
      `0-citation papers drawn below the zero line (y > ${WORLD_PLOT.bottom})`,
    ).to.deep.equal([]);
  });

  it("keeps a crowd at the newest year inside the plot's right edge", function () {
    const fresh = crowd("fresh", 40, { year: 2030, citationCount: 5 });
    const renderer = placed([
      node("old", { year: 2000, citationCount: 1200 }),
      ...fresh,
    ]);
    const outside = fresh
      .map((paper) => ({
        key: paper.key,
        x: renderer.positionOf(paper.key)!.x,
      }))
      .filter(({ x }) => x > WORLD_PLOT.right);
    expect(
      outside,
      `papers at the domain's last year drawn past it (x > ${WORLD_PLOT.right})`,
    ).to.deep.equal([]);
  });

  it("keeps a crowd of No data papers out of the plot", function () {
    const unknown = crowd("unknown", 40, { year: 2026, citationCount: null });
    const renderer = placed([
      node("old", { year: 2000, citationCount: 1200 }),
      node("new", { year: 2026, citationCount: 0 }),
      ...unknown,
    ]);
    const inside = unknown
      .map((paper) => ({
        key: paper.key,
        y: renderer.positionOf(paper.key)!.y,
      }))
      .filter(({ y }) => y < WORLD_PLOT.bottom);
    expect(
      inside,
      `No data papers drawn inside the plot (y < ${WORLD_PLOT.bottom})`,
    ).to.deep.equal([]);
  });
});
