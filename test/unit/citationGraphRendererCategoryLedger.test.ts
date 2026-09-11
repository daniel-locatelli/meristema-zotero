import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * The category ledger is part of the saved graph (B25): the host restores it
 * into the renderer when a graph opens and reads it back when the graph is
 * saved, the way the seed and folder ledgers already travel.
 */
describe("CitationGraphRenderer category ledger", function () {
  function renderer(): CitationGraphRenderer {
    const canvas = new FakeCanvas();
    const target = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("a1", { publicationType: "article" }),
        node("a2", { publicationType: "article" }),
        node("b1", { publicationType: "book" }),
      ]),
      layout: { ...FREE_LAYOUT, nodeColorMetric: "publication-type" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    return target;
  }

  it("colours categories from a restored ledger rather than from scratch", function () {
    const target = renderer();
    const swatches = target.getTheme().categorical.swatches;
    target.setCategorySwatchLedger({
      assigned: { article: 5, book: 2 },
      releasedOrder: [],
    });
    const byKey = new Map(
      target
        .getCategoryAssignment()
        .entries.map((entry) => [entry.key, entry.color]),
    );
    expect(byKey.get("article")).to.equal(swatches[5]);
    expect(byKey.get("book")).to.equal(swatches[2]);
  });

  it("hands back the ledger the assignment settled on, for the saved graph", function () {
    const target = renderer();
    target.getCategoryAssignment();
    expect(target.getCategorySwatchLedger().assigned).to.deep.equal({
      article: 0,
      book: 1,
    });
  });

  it("drops the cached assignment when a ledger is restored over it", function () {
    const target = renderer();
    const swatches = target.getTheme().categorical.swatches;
    // Build the assignment once from an empty ledger, so the cache holds it.
    expect(
      target.getCategoryAssignment().entries.find((e) => e.key === "book")
        ?.color,
    ).to.equal(swatches[1]);
    target.setCategorySwatchLedger({
      assigned: { article: 0, book: 7 },
      releasedOrder: [],
    });
    expect(
      target.getCategoryAssignment().entries.find((e) => e.key === "book")
        ?.color,
    ).to.equal(swatches[7]);
  });
});
