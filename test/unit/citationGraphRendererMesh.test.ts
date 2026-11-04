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

  it("draws the whole mesh of a graph with no seed", function () {
    const { renderer, canvas, strokes } = graphOf(60, 3300);
    canvas.context.calls = [];
    renderer.setSeedMarks(EMPTY_SEED_MARKS);
    expect(strokes()).to.be.at.least(3300);
  });

  it("draws only the seed's edges at any size, then the selection's", function () {
    const small = graphOf(10, 40);
    small.canvas.context.calls = [];
    small.renderer.setSeedMarks({
      ...EMPTY_SEED_MARKS,
      seedKeys: new Set(["n0"]),
    });
    // n0 cites the 9 others, and n1 to n4 cite n0 among the first 40; the rest
    // are not the seed's. Ten outlines, the seed's ring, and those edges.
    expect(small.strokes(), "a small graph hides the rest too").to.be.below(40);

    const { renderer, canvas, strokes } = graphOf(60, 3300);
    canvas.context.calls = [];
    renderer.setSeedMarks({ ...EMPTY_SEED_MARKS, seedKeys: new Set(["n0"]) });
    // The first 3,300 edges: n0 cites the 59 others, and n1 to n55 each
    // cite n0, so the seed has 114 edges, its ring a stroke and 60 outlines.
    expect(strokes(), "the seed's edges, and no others").to.be.within(174, 176);
    const seedOnly = strokes();
    canvas.context.calls = [];
    renderer.selectNode("n30", false);
    expect(
      strokes() - seedOnly,
      "the selected paper's edges join them",
    ).to.be.at.least(50);
  });

  it("glows a selected paper's outermost circle and adds no ring", function () {
    const { renderer, canvas } = graphOf(3, 0);
    const arcs = (): number[] =>
      canvas.context.calls
        .filter((call) => call.method === "arc")
        .map((call) => Number(call.args[2]));
    canvas.context.calls = [];
    renderer.setSeedMarks(EMPTY_SEED_MARKS);
    const widest = Math.max(...arcs());
    canvas.context.calls = [];
    renderer.selectNode("n2", false);
    expect(Math.max(...arcs()), "nothing outside the disc").to.equal(widest);
    const glowing = canvas.context.calls.filter(
      (call) => call.method === "stroke" && call.shadowBlur > 0,
    );
    expect(glowing, "the outline, stroked twice").to.have.length(2);
  });

  it("pulses a ring round a paper being updated, until it ends (W7)", function () {
    const { renderer, canvas } = graphOf(3, 0);
    // The pulse runs until the set empties, so a failure must not leave it on.
    try {
      const strokes = (): number => {
        canvas.context.calls = [];
        renderer.setSeedMarks({ ...EMPTY_SEED_MARKS });
        return canvas.context.calls.filter((call) => call.method === "stroke")
          .length;
      };
      const atRest = strokes();
      renderer.setUpdatingKeys(new Set(["n0"]));
      expect(strokes(), "one more stroke, its ring").to.equal(atRest + 1);
      renderer.setUpdatingKeys(new Set());
      expect(strokes(), "gone when it ends").to.equal(atRest);
    } finally {
      renderer.destroy();
    }
  });

  it("lights the hovered paper's edges at full strength", function () {
    const { renderer, canvas } = graphOf(3, 2);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    renderer.setNodePositions(
      new Map([
        ["n0", { x: 100, y: 100 }],
        ["n1", { x: 300, y: 100 }],
        ["n2", { x: 500, y: 100 }],
      ]),
    );
    const edgeStrokes = (): string[] =>
      canvas.context.calls
        .filter((call) => call.method === "stroke")
        .map((call) => call.strokeStyle);
    canvas.context.calls = [];
    renderer.setSeedMarks(EMPTY_SEED_MARKS);
    const atRest = edgeStrokes();
    canvas.context.calls = [];
    canvas.fire("pointermove", { clientX: 100, clientY: 100 });
    expect(
      edgeStrokes(),
      "the hover's edges take another colour",
    ).to.not.deep.equal(atRest);
  });
});
