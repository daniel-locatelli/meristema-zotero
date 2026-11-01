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

  it("zooms in to 32x, so a crowd held near its values can be pulled apart", function () {
    // B118: with the vertical cap at 1% of the range, a crowd is spread by
    // zooming, not by moving papers off their counts. Discs keep their screen
    // size, so each step in pulls them further apart.
    const renderer = placed([node("a", { year: 2020, citationCount: 3 })]);
    for (let step = 0; step < 40; step += 1) renderer.zoomBy(1.22);
    expect(renderer.getViewTransform().scale).to.equal(32);
    renderer.setViewTransform({ x: 0, y: 0, scale: 100 });
    expect(renderer.getViewTransform().scale).to.equal(32);
  });

  it("fits the axes to the frame, not to papers outside it", function () {
    // B118: a seeded graph keeps the whole library in its model, so a
    // 5,249-citation paper the graph does not show set the Y axis, and a
    // 35-citation hop paper read as 0.
    const hop = [
      node("buga", { year: 2021, citationCount: 35 }),
      node("hodf", { year: 2022, citationCount: 6 }),
    ];
    const renderer = placed([
      node("unshown", { year: 2023, citationCount: 5249 }),
      ...hop,
    ]);
    renderer.setFrameKeys(new Set(hop.map((paper) => paper.key)));
    const domain = renderer.axisScale(hop, "y")!.domain;
    expect(domain[1], `y domain ${domain.join("..")}`).to.be.below(100);
    const y = renderer.positionOf("buga")!.y;
    const read =
      domain[0] +
      ((WORLD_PLOT.bottom - y) / (WORLD_PLOT.bottom - WORLD_PLOT.top)) *
        (domain[1] - domain[0]);
    expect(read, `buga drawn at ${read.toFixed(1)}`).to.be.closeTo(35, 1);
  });
});
