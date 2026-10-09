import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { graphThemeFor } from "../../src/services/graphTheme";
import { FakeCanvas, FREE_LAYOUT, model, node } from "./graphRendererDoubles";

/**
 * B34/B89: at a deep zoom nearly every node and edge sits off the canvas, and
 * each one still cost a save, a stroke and a restore every frame. Anything
 * whose grown bounds miss the canvas paints no pixel, so it is skipped; an
 * edge whose two ends are off-screen but whose line crosses the canvas is not.
 */
describe("CitationGraphRenderer culling", function () {
  it("skips the nodes and edges wholly off the canvas, and only those", function () {
    const canvas = new FakeCanvas();
    const keys = ["a", "b", "c", "d", "e"];
    const graph = model(keys.map((key) => node(key)));
    graph.edges = [
      { source: "a", target: "b" },
      { source: "c", target: "d" },
      { source: "e", target: "c" },
    ] as typeof graph.edges;
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: graph,
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    renderer.setNodePositions(
      new Map([
        ["a", { x: 100, y: 100 }],
        ["b", { x: 200, y: 100 }],
        ["c", { x: 5000, y: 100 }],
        ["d", { x: 5000, y: 300 }],
        // e -> c runs from far left to far right straight across the canvas.
        ["e", { x: -3000, y: 300 }],
      ]),
    );
    canvas.context.calls = [];
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });

    const theme = graphThemeFor("light");
    const nodeFills = canvas.context.calls.filter(
      (call) =>
        call.method === "fill" &&
        call.args.length === 0 &&
        call.fillStyle === theme.states.uniformFill,
    );
    expect(nodeFills, "only a and b are on the canvas").to.have.length(2);
    const edgeStrokes = canvas.context.calls.filter(
      (call) =>
        call.method === "stroke" &&
        call.args.length === 0 &&
        call.strokeStyle === theme.edges.base,
    );
    expect(
      edgeStrokes,
      "a -> b is on the canvas and e -> c crosses it; c -> d is off it",
    ).to.have.length(2);
  });
});
