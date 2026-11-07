import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { FakeCanvas, FREE_LAYOUT, model, node } from "./graphRendererDoubles";

describe("CitationGraphRenderer reading plan", function () {
  it("reads Reading step from the plan, and nothing without one", function () {
    const renderer = new CitationGraphRenderer({
      canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
      model: model([node("a"), node("z")]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    expect(renderer.metricNumber(node("a"), "reading-step")).to.equal(null);
    renderer.setReadingPlan(
      {
        paths: [],
        stepByKey: new Map([["a", 2]]),
        afterLast: 3,
        stateByKey: new Map(),
      },
      false,
    );
    expect(renderer.metricNumber(node("a"), "reading-step")).to.equal(2);
    expect(renderer.metricNumber(node("z"), "reading-step")).to.equal(3);
  });
});
