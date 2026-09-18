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
import { floorAtWorld, floorTagText } from "../../src/services/graphFloor";

/**
 * The floor line, its tag, and the drag. The fake canvas is 800×600 with the
 * plot's world box projected 1:1 (transform x 0, y 0, scale 1 after
 * `setViewTransform`), so a world y is a client y.
 */
describe("CitationGraphRenderer floor", function () {
  const CITATIONS_Y: Partial<GraphLayoutOptions> = {
    xMetric: "year",
    yMetric: "citations",
  };

  function papers(): CitationGraphNode[] {
    return [
      node("low", { year: 2000, citationCount: 0 }),
      node("mid", { year: 2010, citationCount: 50 }),
      node("high", { year: 2020, citationCount: 100 }),
    ];
  }

  function makeRenderer(
    layoutOverrides: Partial<GraphLayoutOptions>,
    hooks: {
      onFloorChange?: (floor: number) => void;
      onFloorDragEnd?: () => void;
    } = {},
  ): { renderer: CitationGraphRenderer; canvas: FakeCanvas } {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(papers()),
      layout: { ...FREE_LAYOUT, ...layoutOverrides },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
      ...hooks,
    });
    attachView(canvas);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    return { renderer, canvas };
  }

  function tagTexts(canvas: FakeCanvas): string[] {
    return canvas.context.calls
      .filter((call) => call.method === "fillText")
      .map((call) => String(call.args[0]))
      .filter((text) => text.startsWith("⇕ floor"));
  }

  it("draws the tag only when an axis shows citations", function () {
    const withY = makeRenderer(CITATIONS_Y);
    withY.renderer.setFloor(20, 1);
    expect(tagTexts(withY.canvas)).to.include(floorTagText(20, 1));

    const withoutY = makeRenderer({ xMetric: "year", yMetric: "year" });
    withoutY.renderer.setFloor(20, 1);
    expect(tagTexts(withoutY.canvas)).to.be.empty;
    expect(withoutY.renderer.labelObstacles()).to.be.empty;
  });

  it("offers the tag's rectangle as a label obstacle", function () {
    const { renderer } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 1);
    const [tag] = renderer.labelObstacles();
    expect(tag).to.exist;
    expect(tag.right).to.be.greaterThan(tag.left);
    expect(tag.bottom).to.be.greaterThan(tag.top);
  });

  it("reports rounded values through a drag and one drag end", function () {
    const changes: number[] = [];
    let ends = 0;
    const { renderer, canvas } = makeRenderer(CITATIONS_Y, {
      onFloorChange: (floor) => changes.push(floor),
      onFloorDragEnd: () => (ends += 1),
    });
    renderer.setFloor(0, 0);
    const [tag] = renderer.labelObstacles();
    const grab = {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    };
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    expect(canvas.style.cursor).to.equal("ns-resize");
    // Halfway up the plot's world box (675 → 60), under the identity camera,
    // is client y 367.5. The axis pads its domain to round ticks, so the
    // expected value is read back through the same inversion the drag uses.
    const domain = renderer.axisScale(papers(), "y")!.domain;
    const expected = floorAtWorld(
      "y",
      { metric: "citations", scale: "linear", domain },
      367.5,
    );
    expect(expected).to.be.greaterThan(0);
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    expect(changes, "one change per new value, not per move").to.deep.equal([
      expected,
    ]);
    expect(ends).to.equal(1);
  });

  it("reads 0 past the bottom edge", function () {
    const changes: number[] = [];
    const { renderer, canvas } = makeRenderer(
      { ...CITATIONS_Y, yScale: "log" },
      { onFloorChange: (floor) => changes.push(floor) },
    );
    renderer.setFloor(30, 1);
    const [tag] = renderer.labelObstacles();
    const grab = {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    };
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 700,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 700,
    });
    expect(changes).to.deep.equal([0]);
  });

  it("lets a node win over the bare line, and the tag win over a node", function () {
    const selected: string[] = [];
    const changes: number[] = [];
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(papers()),
      layout: { ...FREE_LAYOUT, ...CITATIONS_Y },
      collectionLabels: new Map(),
      onSelectionChange: (node) => selected.push(node?.key ?? "none"),
      onOpenNode: () => undefined,
      onFloorChange: (floor) => changes.push(floor),
    });
    attachView(canvas);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    // The floor is put exactly through "mid", so the line and the node share a y.
    const mid = renderer.positionOf("mid");
    expect(mid).to.exist;
    const domain = renderer.axisScale(papers(), "y")!.domain;
    renderer.setFloor(
      floorAtWorld(
        "y",
        { metric: "citations", scale: "linear", domain },
        mid!.y,
      ),
      1,
    );
    canvas.fire("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: mid!.x,
      clientY: mid!.y,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: mid!.x,
      clientY: mid!.y,
    });
    expect(selected).to.deep.equal(["mid"]);
    expect(changes).to.be.empty;
  });

  it("names the tag in the canvas title while it is hovered", function () {
    const { renderer, canvas } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 3);
    const [tag] = renderer.labelObstacles();
    canvas.fire("pointermove", {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    });
    expect(canvas.title).to.equal(floorTagText(20, 3));
    expect(canvas.style.cursor).to.equal("ns-resize");
    canvas.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(canvas.title).to.equal("");
  });
});
