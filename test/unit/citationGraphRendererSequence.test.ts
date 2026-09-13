import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type {
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
 * The seeded graph's citation sequence arrives by map, like hops (ADR 0008).
 * While the map is set, it is the only source for the metric: a library node
 * keeps the graph-wide ordinal on its own field, and the plot must not read
 * that one while a seed anchors the axis.
 */
describe("CitationGraphRenderer citation sequence", function () {
  function makeRenderer(
    nodes: CitationGraphNode[],
    layoutOverrides: Partial<GraphLayoutOptions> = {},
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

  const library = node("lib", { citationSequence: 5 });
  const external = node("ext", { kind: "external", citationSequence: null });

  it("reads the map over the node's own field while a sequence is set", function () {
    const renderer = makeRenderer([library, external]);
    renderer.setCitationSequence(
      new Map([
        ["lib", -2],
        ["ext", 3],
      ]),
      false,
    );
    expect(renderer.metricNumber(library, "citation-sequence")).to.equal(-2);
    expect(renderer.metricNumber(external, "citation-sequence")).to.equal(3);
  });

  it("reports no value for a paper the map does not name", function () {
    const renderer = makeRenderer([library, external]);
    renderer.setCitationSequence(new Map([["ext", 3]]), false);
    expect(renderer.metricNumber(library, "citation-sequence")).to.equal(null);
  });

  it("falls back to the node field once the sequence is cleared", function () {
    const renderer = makeRenderer([library]);
    renderer.setCitationSequence(new Map([["lib", -2]]), false);
    renderer.setCitationSequence(null, false);
    expect(renderer.metricNumber(library, "citation-sequence")).to.equal(5);
  });

  it("leaves every other metric on the node field", function () {
    const renderer = makeRenderer([node("lib", { citationCount: 7 })]);
    renderer.setCitationSequence(new Map([["lib", -2]]), false);
    expect(
      renderer.metricNumber(node("lib", { citationCount: 7 }), "citations"),
    ).to.equal(7);
  });

  it("scales the x axis from the map, not the field", function () {
    // Two library papers whose fields say 5 and 6 but whose seed-relative
    // steps are -3 and +3: the axis domain must span the map's values.
    const a = node("a", { citationSequence: 5 });
    const b = node("b", { citationSequence: 6 });
    const renderer = makeRenderer([a, b], { xMetric: "citation-sequence" });
    renderer.setCitationSequence(
      new Map([
        ["a", -3],
        ["b", 3],
      ]),
      false,
    );
    const scale = renderer.axisScale([a, b], "x");
    expect(scale?.domain[0]).to.be.at.most(-3);
    expect(scale?.domain[1]).to.be.at.least(3);
  });
});
