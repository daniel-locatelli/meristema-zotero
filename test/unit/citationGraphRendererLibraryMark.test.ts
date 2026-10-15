import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { EMPTY_SEED_MARKS } from "../../src/services/graphHopModel";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * A paper in the Zotero library draws as a filled disc; one known only
 * through a hop draws as a ring in its own colour, hollow on the plot's paper
 * (F14). A hop paper matched to a library item is the library's node, so it
 * fills.
 */
describe("CitationGraphRenderer library mark", function () {
  function draw(nodes: CitationGraphNode[]) {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(nodes),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(
      new Map(
        nodes.map((paper, index) => [
          paper.key,
          { x: 100 + index * 200, y: 300 },
        ]),
      ),
    );
    renderer.setSeedMarks(
      { ...EMPTY_SEED_MARKS, hops: new Map([["ext", 1]]) },
      false,
    );
    canvas.context.calls = [];
    renderer.selectNode("lib", false);
    return { calls: canvas.context.calls, theme: renderer.getTheme() };
  }

  it("fills a library paper and rings a paper not in Zotero", function () {
    const { calls, theme } = draw([
      node("lib"),
      node("ext", { kind: "external", itemID: 0 }),
    ]);
    const fill = theme.states.uniformFill;
    const fills = calls.filter(
      (call) => call.method === "fill" && call.args.length === 0,
    );
    const [libraryFill, externalFill] = fills.slice(-2);
    expect(libraryFill!.fillStyle, "the library paper fills").to.equal(fill);
    expect(
      externalFill!.fillStyle,
      "the hop paper's interior is the plot's paper",
    ).to.equal(theme.surfaces.paper);
    const after = calls.slice(calls.indexOf(externalFill!));
    const ring = after.find(
      (call) => call.method === "stroke" && call.strokeStyle === fill,
    );
    expect(ring, "the hop paper's ring strokes in the node's colour").to.exist;
    expect(ring!.globalAlpha, "the ring keeps the hop's opacity").to.equal(0.9);
  });
});
