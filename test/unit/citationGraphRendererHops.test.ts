import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type {
  CitationGraphModel,
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * Hops arrive by map, never as a node field (`additiveGraphModel` keeps the
 * library's own node objects, which no walk stamps), and fade fill, label
 * and edge alpha the further out a paper sits.
 */
describe("CitationGraphRenderer hops", function () {
  function makeRenderer(
    nodes: CitationGraphNode[],
    layoutOverrides: Partial<GraphLayoutOptions>,
  ): CitationGraphRenderer {
    const canvas = new FakeCanvas();
    const target = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(nodes),
      layout: { ...FREE_LAYOUT, ...layoutOverrides },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    return target;
  }

  function modelOf(nodes: CitationGraphNode[]): CitationGraphModel {
    return model(nodes);
  }

  it("feeds the Citation hop assignment from setHops, not from the node", function () {
    const renderer = makeRenderer([node("s"), node("a")], {
      nodeColorMetric: "citation-hop",
    });
    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 2],
      ]),
      false,
    );
    const assignment = renderer.getCategoryAssignment();
    expect(assignment.labelFor(node("a"))).to.equal("Hop 2");
    expect(assignment.labelFor(node("s"))).to.equal("Seed");
  });

  it("fades a node's alpha by hop and leaves unmapped nodes whole", function () {
    const renderer = makeRenderer([node("s"), node("a"), node("lib")], {});
    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 3],
      ]),
      false,
    );
    expect(renderer.hopAlphaFor("s")).to.equal(1);
    expect(renderer.hopAlphaFor("a")).to.equal(0.7);
    expect(renderer.hopAlphaFor("lib")).to.equal(1);
  });

  it("drops hops for nodes that left the model on syncModel", function () {
    const graphModel = modelOf([node("s"), node("a")]);
    const renderer = makeRenderer(graphModel.nodes, {});
    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 1],
      ]),
      false,
    );
    graphModel.nodes.splice(1, 1);
    renderer.syncModel({ draw: false });
    expect(renderer.hopAlphaFor("a")).to.equal(1);
  });

  /**
   * The category memo key concatenates `nodeColorMetric`, node count, scheme,
   * `scopeRevision` and `hopsRevision` with no separator between the last two
   * — both plain decimal counters with nothing else between them, the one
   * seam in the key with no letter to anchor it. Two consecutive `setHops`
   * calls always bump `hopsRevision` and (harmlessly) null the cached
   * assignment too, so this alone would pass even key-first; what it actually
   * exercises is the *entries* built at each rebuild, which is where a wrong
   * memo key would go stale (`labelFor` re-reads `hops` live and would not
   * notice).
   */
  it("rebuilds the category entries for each hop map, not a stale one", function () {
    const renderer = makeRenderer([node("s"), node("a")], {
      nodeColorMetric: "citation-hop",
    });
    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 2],
      ]),
      false,
    );
    const first = renderer.getCategoryAssignment();
    expect(first.entries.map((entry) => entry.label)).to.include("Hop 2");

    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 5],
      ]),
      false,
    );
    const second = renderer.getCategoryAssignment();
    expect(second.entries.map((entry) => entry.label)).to.include("Hop 5");
    expect(second.entries.map((entry) => entry.label)).to.not.include("Hop 2");
  });
});
