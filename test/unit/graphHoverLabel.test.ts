import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { wrapLabel } from "../../src/services/graphRendererScene";
import type { GraphLayoutOptions } from "../../src/domain/graphTypes";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  hoverText,
  model,
  node,
} from "./graphRendererDoubles";

/** Six pixels a character, as the fake canvas measures. */
const measure = (text: string): number => text.length * 6;

describe("wrapLabel", function () {
  it("keeps a label that fits on one line", function () {
    expect(wrapLabel("Short title", 120, measure)).to.deep.equal([
      "Short title",
    ]);
  });

  it("breaks at the last word that fits the width", function () {
    // 60px is ten characters a line.
    expect(wrapLabel("alpha beta gamma delta", 60, measure)).to.deep.equal([
      "alpha beta",
      "gamma",
      "delta",
    ]);
  });

  it("gives a word wider than the cap a line of its own", function () {
    expect(wrapLabel("a extraordinarily b", 60, measure)).to.deep.equal([
      "a",
      "extraordinarily",
      "b",
    ]);
  });
});

/**
 * F13: the hovered paper's label is its whole title, wrapped, at once; every
 * other label keeps the 42-character cut. The fake canvas has no view at
 * construction, so the camera is the identity and a node's world position is
 * the client point that hovers it.
 */
describe("CitationGraphRenderer hovered label", function () {
  const LONG =
    "Agent-based form finding of timber plate shells on doubly curved surfaces with curvature-adaptive panelisation";

  function hovered(layout: Partial<GraphLayoutOptions>, title = LONG) {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("long", { title, authors: ["Ada Smith"], year: 2019 }),
        node("other", { title: `${LONG} again`, citationCount: 5 }),
      ]),
      layout: { ...FREE_LAYOUT, ...layout },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(
      new Map([
        ["long", { x: 300, y: 300 }],
        ["other", { x: 300, y: 100 }],
      ]),
    );
    canvas.context.calls = [];
    canvas.fire("pointermove", { clientX: 300, clientY: 300 });
    expect(renderer.getHoverKey(), "the pointer is over the paper").to.equal(
      "long",
    );
    return canvas.context.calls
      .filter((call) => call.method === "fillText")
      .map((call) => String(call.args[0]));
  }

  it("draws the hovered paper's whole title over several lines", function () {
    const texts = hovered({ nodeLabelMode: "title" });
    const lines = texts.filter((text) => LONG.includes(text));
    expect(lines.length, "the title wraps").to.be.greaterThan(1);
    expect(lines.join(" ")).to.equal(LONG);
  });

  it("keeps the cut on a label nobody hovers", function () {
    const texts = hovered({ nodeLabelMode: "title" });
    expect(texts).to.include(`${LONG.slice(0, 39)}…`);
  });

  it("shows the title on hover under Author (year) too", function () {
    const texts = hovered({ nodeLabelMode: "author-year" });
    const lines = texts.filter((text) => LONG.includes(text));
    expect(lines.join(" ")).to.equal(LONG);
    expect(texts, "the other paper keeps its short label").to.include(
      `${LONG.slice(0, 39)}…`,
    );
  });

  it("keeps the short label for a hovered paper with no title", function () {
    const texts = hovered({ nodeLabelMode: "author-year" }, "");
    expect(texts).to.include("Smith (2019)");
  });
});

/**
 * B101: a hovered paper whose label is pushed off its default spot draws no
 * leader line back to its node; the placement itself stays.
 */
describe("CitationGraphRenderer displaced hovered label", function () {
  it("draws no line from the label to its node", function () {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("long", { title: "A paper whose title is long enough to wrap" }),
        node("right", { title: "Neighbour" }),
      ]),
      layout: { ...FREE_LAYOUT, nodeLabelMode: "title" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    // The neighbour's disc sits where the label would go by default, on the
    // right, so the label is placed elsewhere.
    renderer.setNodePositions(
      new Map([
        ["long", { x: 400, y: 300 }],
        ["right", { x: 480, y: 300 }],
      ]),
    );
    const moves: Array<[number, number]> = [];
    // The double does not record path moves; this case listens for them.
    (
      canvas.context as unknown as { moveTo(x: number, y: number): void }
    ).moveTo = (x, y) => {
      moves.push([x, y]);
    };
    canvas.context.calls = [];
    canvas.fire("pointermove", { clientX: 400, clientY: 300 });
    expect(renderer.getHoverKey(), "the pointer is over the paper").to.equal(
      "long",
    );
    const title = canvas.context.calls.find(
      (call) =>
        call.method === "fillText" &&
        String(call.args[0]).startsWith("A paper"),
    );
    expect(
      Number(title?.args[1]),
      "the label left its default spot",
    ).to.be.below(400);
    expect(moves, "no leader starts at the node").to.not.deep.include([
      400, 300,
    ]);
  });
});

/**
 * B103: no pushed-aside label draws a leader line to its node, hovered or
 * not; the placement itself stays.
 */
describe("CitationGraphRenderer displaced label", function () {
  it("draws no line from an unhovered label to its node", function () {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("long", { title: "A paper whose title is long enough to wrap" }),
        node("right", { title: "Neighbour" }),
      ]),
      layout: { ...FREE_LAYOUT, nodeLabelMode: "title" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    const moves: Array<[number, number]> = [];
    // The double does not record path moves; this case listens for them.
    (
      canvas.context as unknown as { moveTo(x: number, y: number): void }
    ).moveTo = (x, y) => {
      moves.push([x, y]);
    };
    canvas.context.calls = [];
    // The neighbour's disc sits where the label would go by default, on the
    // right, so the label is placed elsewhere.
    renderer.setNodePositions(
      new Map([
        ["long", { x: 400, y: 300 }],
        ["right", { x: 480, y: 300 }],
      ]),
    );
    expect(renderer.getHoverKey(), "nothing is hovered").to.equal(null);
    const title = canvas.context.calls.find(
      (call) =>
        call.method === "fillText" &&
        String(call.args[0]).startsWith("A paper"),
    );
    expect(
      Number(title?.args[1]),
      "the label left its default spot",
    ).to.be.below(400);
    expect(moves, "no leader starts at the node").to.not.deep.include([
      400, 300,
    ]);
  });
});

/**
 * B101: the plot sets no `title`, so the host never lays its native tooltip
 * over the plugin's own label. What is under the pointer is the canvas's ARIA
 * description instead.
 */
describe("CitationGraphRenderer hover without a native tooltip", function () {
  it("names the hovered paper without titling the canvas", function () {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([node("paper", { title: "A hovered paper" })]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(new Map([["paper", { x: 300, y: 300 }]]));
    canvas.fire("pointermove", { clientX: 300, clientY: 300 });
    expect(renderer.getHoverKey()).to.equal("paper");
    expect(canvas.title, "no native tooltip").to.equal("");
    expect(hoverText(canvas)).to.include("A hovered paper");
    canvas.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(hoverText(canvas), "cleared off the paper").to.equal("");
    canvas.fire("pointermove", { clientX: 300, clientY: 300 });
    canvas.fire("pointerleave");
    expect(hoverText(canvas), "cleared when the pointer leaves").to.equal("");
  });
});
