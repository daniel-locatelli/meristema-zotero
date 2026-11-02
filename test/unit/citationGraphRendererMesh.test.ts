import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphModel } from "../../src/domain/graphTypes";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  node,
} from "./graphRendererDoubles";
import { EMPTY_SEED_MARKS } from "../../src/services/graphHopModel";

/**
 * D13: past 3,200 edges the mesh is a wash, so only the seeds' edges and the
 * selected or hovered paper's draw. Every node is a library paper, which
 * fills and strokes no ring, so the strokes recorded are the edges and the
 * selection's ring.
 */
describe("CitationGraphRenderer dense mesh", function () {
  function graphOf(count: number, edgeCount: number) {
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
    const edges: CitationGraphModel["edges"] = [];
    for (let i = 0; i < count && edges.length < edgeCount; i += 1) {
      for (let j = 0; j < count && edges.length < edgeCount; j += 1) {
        if (i === j) continue;
        edges.push({
          key: `n${i}>n${j}`,
          source: `n${i}`,
          target: `n${j}`,
          provenance: "test",
          manual: false,
        });
      }
    }
    const graphModel: CitationGraphModel = {
      nodes,
      edges,
      statistics: {
        nodes: count,
        resolvedNodes: count,
        edges: edges.length,
        isolatedNodes: 0,
      },
    };
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: graphModel,
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    // A ring of positions, every node on the canvas so nothing is culled.
    renderer.setNodePositions(
      new Map(
        nodes.map((entry, i) => [
          entry.key,
          {
            x: 400 + 250 * Math.cos((i / count) * Math.PI * 2),
            y: 300 + 250 * Math.sin((i / count) * Math.PI * 2),
          },
        ]),
      ),
    );
    const strokes = (): number =>
      canvas.context.calls.filter((call) => call.method === "stroke").length;
    return { renderer, canvas, strokes };
  }

  it("draws the whole mesh at 3,200 edges", function () {
    const { renderer, canvas, strokes } = graphOf(60, 3200);
    canvas.context.calls = [];
    renderer.setSeedMarks(EMPTY_SEED_MARKS);
    expect(strokes()).to.be.at.least(3200);
  });

  it("past 3,200 draws no mesh, then the seed's edges, then the selection's", function () {
    const { renderer, canvas, strokes } = graphOf(60, 3300);
    canvas.context.calls = [];
    renderer.setSeedMarks(EMPTY_SEED_MARKS);
    // Each node's disc outline is a stroke: 60 of them, and no edge.
    const outlines = strokes();
    expect(outlines, "no edge, only the 60 outlines").to.equal(60);
    canvas.context.calls = [];
    renderer.setSeedMarks({ ...EMPTY_SEED_MARKS, seedKeys: new Set(["n0"]) });
    // The first 3,300 edges: n0 cites the 59 others, and n1 to n55 each
    // cite n0, so the seed has 114 edges; its ring adds a stroke.
    expect(
      strokes() - outlines,
      "the seed's edges, and no others",
    ).to.be.within(114, 116);
    const seedOnly = strokes();
    canvas.context.calls = [];
    renderer.selectNode("n30", false);
    expect(
      strokes() - seedOnly,
      "the selected paper's edges join them",
    ).to.be.at.least(50);
  });
});
