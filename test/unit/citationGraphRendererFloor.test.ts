import { describe, it } from "node:test";
import { expect } from "chai";
import {
  CitationGraphRenderer,
  type Position,
} from "../../src/services/citationGraphRenderer";
import type {
  CitationGraphNode,
  GraphLayoutOptions,
  GraphScaleType,
} from "../../src/domain/graphTypes";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";
import {
  floorAtWorld,
  floorLinePlacement,
  floorTagText,
  WORLD_PLOT,
  type FloorAxisInput,
} from "../../src/services/graphFloor";
import type { LabelRectangle } from "../../src/services/graphLabelBudget";

/**
 * The floor line, its tag, and the drag. The camera is the one production
 * uses — `fitView()`, which maps the whole world plot box inside the plot
 * rectangle — because the renderer draws nothing at all when the line falls
 * off the frame. The world box (615 tall) does not fit an 800×600 canvas at
 * scale 1, so an identity camera would put every floor off-frame.
 *
 * The fake canvas is 800 device pixels across an 800 CSS-pixel rectangle at
 * the origin, so the device-pixel ratio is 1 and a device pixel is a client
 * pixel: the tag's rectangle can be pointed at directly. Every other client
 * coordinate comes from a world one through `toClient`, and every expected
 * floor from `floorAtWorld` on that same world coordinate.
 */
describe("CitationGraphRenderer floor", function () {
  const CITATIONS_Y: Partial<GraphLayoutOptions> = {
    xMetric: "year",
    yMetric: "citations",
  };
  const CITATIONS_X: Partial<GraphLayoutOptions> = {
    xMetric: "citations",
    yMetric: "year",
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
      onSelectionChange?: (node: CitationGraphNode | null) => void;
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
    renderer.fitView();
    return { renderer, canvas };
  }

  /** A world point as the client coordinates a pointer event would carry. */
  function toClient(
    renderer: CitationGraphRenderer,
    world: Position,
  ): { clientX: number; clientY: number } {
    const view = renderer.getViewTransform();
    return {
      clientX: view.x + world.x * view.scale,
      clientY: view.y + world.y * view.scale,
    };
  }

  /** The middle of a device-pixel rectangle, as client coordinates. */
  function centerOf(rectangle: LabelRectangle): {
    clientX: number;
    clientY: number;
  } {
    return {
      clientX: (rectangle.left + rectangle.right) / 2,
      clientY: (rectangle.top + rectangle.bottom) / 2,
    };
  }

  /** The axis the floor reads, exactly as the renderer builds it. */
  function axisInput(
    renderer: CitationGraphRenderer,
    axis: "x" | "y",
    scale: GraphScaleType = "linear",
  ): FloorAxisInput {
    const domain = renderer.axisScale(papers(), axis)!.domain;
    return { metric: "citations", scale, domain };
  }

  /** Where a floor's line sits in world units on a Y axis showing citations. */
  function lineWorldY(renderer: CitationGraphRenderer, floor: number): number {
    return floorLinePlacement(
      { metric: "year", scale: "linear", domain: null },
      axisInput(renderer, "y"),
      floor,
    )!.world;
  }

  /** The only tag on screen, or a readable failure when nothing was drawn. */
  function theTag(renderer: CitationGraphRenderer): LabelRectangle {
    const [tag] = renderer.labelObstacles();
    expect(tag, "the tag's obstacle").to.exist;
    return tag!;
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
    // A tag drawn off the plot is not a tag: it must land on the canvas.
    const tag = theTag(withY.renderer);
    expect(tag.top, "the tag's top edge").to.be.at.least(0);
    expect(tag.bottom, "the tag's bottom edge").to.be.at.most(
      withY.canvas.height,
    );
    expect(tag.left, "the tag's left edge").to.be.at.least(0);
    expect(tag.right, "the tag's right edge").to.be.at.most(withY.canvas.width);

    const withoutY = makeRenderer({ xMetric: "year", yMetric: "year" });
    withoutY.renderer.setFloor(20, 1);
    expect(tagTexts(withoutY.canvas)).to.be.empty;
    expect(withoutY.renderer.labelObstacles()).to.be.empty;
  });

  it("draws nothing once the camera carries the line off the frame", function () {
    const { renderer, canvas } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 1);
    expect(theTag(renderer), "the tag before the pan").to.exist;
    const view = renderer.getViewTransform();
    canvas.context.calls.length = 0;
    // Two canvas heights up: the line and its tag leave the plot entirely.
    renderer.setViewTransform({ ...view, y: view.y - canvas.height * 2 });
    expect(tagTexts(canvas), "nothing drawn off the frame").to.be.empty;
    expect(renderer.labelObstacles(), "no obstacle off the frame").to.be.empty;
    canvas.fire("pointermove", { clientX: 400, clientY: 300 });
    expect(canvas.style.cursor, "nothing to grab").to.not.equal("ns-resize");
  });

  it("offers the tag's rectangle as a label obstacle", function () {
    const { renderer } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 1);
    const tag = theTag(renderer);
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
    const grab = centerOf(theTag(renderer));
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    expect(canvas.style.cursor).to.equal("ns-resize");
    // Halfway up the plot's world box (675 → 60), carried to the canvas by
    // the fitted camera. The axis pads its domain to round ticks, so the
    // expected value is read back through the same inversion the drag uses.
    const target = (WORLD_PLOT.top + WORLD_PLOT.bottom) / 2;
    const expected = floorAtWorld("y", axisInput(renderer, "y"), target);
    expect(expected).to.be.greaterThan(0);
    const move = {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: toClient(renderer, { x: 0, y: target }).clientY,
    };
    canvas.fire("pointermove", move);
    canvas.fire("pointermove", move);
    canvas.fire("pointerup", move);
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
    const grab = centerOf(theTag(renderer));
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    // Below the world box's bottom edge, where the floor reads off.
    const below = toClient(renderer, {
      x: 0,
      y: WORLD_PLOT.bottom + 25,
    }).clientY;
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: below,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: below,
    });
    expect(changes).to.deep.equal([0]);
  });

  it("grabs the bare line where no node sits under it", function () {
    const changes: number[] = [];
    const { renderer, canvas } = makeRenderer(CITATIONS_Y, {
      onFloorChange: (floor) => changes.push(floor),
    });
    renderer.setFloor(20, 1);
    const mid = renderer.positionOf("mid");
    expect(mid, "mid's world position").to.exist;
    // The line's own y under "mid"'s x: "mid" holds 50 citations and the
    // floor 20, so the node sits well clear of the point being pressed.
    const grab = toClient(renderer, {
      x: mid!.x,
      y: lineWorldY(renderer, 20),
    });
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    expect(canvas.style.cursor, "the bare line grabs").to.equal("ns-resize");
    const target = (WORLD_PLOT.top + WORLD_PLOT.bottom) / 2;
    const expected = floorAtWorld("y", axisInput(renderer, "y"), target);
    expect(expected).to.not.equal(20);
    const move = {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: toClient(renderer, { x: 0, y: target }).clientY,
    };
    canvas.fire("pointermove", move);
    canvas.fire("pointerup", move);
    expect(changes).to.deep.equal([expected]);
  });

  it("lets a node win over the bare line, and the tag win over a node", function () {
    const selected: string[] = [];
    const changes: number[] = [];
    const { renderer, canvas } = makeRenderer(CITATIONS_Y, {
      onSelectionChange: (node) => selected.push(node?.key ?? "none"),
      onFloorChange: (floor) => changes.push(floor),
    });
    // The floor is put exactly through "mid", so the line and the node share a y.
    const mid = renderer.positionOf("mid");
    expect(mid, "mid's world position").to.exist;
    renderer.setFloor(floorAtWorld("y", axisInput(renderer, "y"), mid!.y), 1);
    const press = toClient(renderer, mid!);
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...press });
    canvas.fire("pointerup", { pointerId: 1, ...press });
    expect(selected).to.deep.equal(["mid"]);
    expect(changes).to.be.empty;
  });

  it("names the tag in the canvas title while it is hovered", function () {
    const { renderer, canvas } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 3);
    canvas.fire("pointermove", centerOf(theTag(renderer)));
    expect(canvas.title).to.equal(floorTagText(20, 3));
    expect(canvas.style.cursor).to.equal("ns-resize");
    canvas.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(canvas.title).to.equal("");
  });

  it("recovers the hover after a drag and after the pointer leaves", function () {
    const { renderer, canvas } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 3);
    const grab = centerOf(theTag(renderer));
    canvas.fire("pointermove", grab);
    expect(canvas.title).to.equal(floorTagText(20, 3));

    const target = (WORLD_PLOT.top + WORLD_PLOT.bottom) / 2;
    const expected = floorAtWorld("y", axisInput(renderer, "y"), target);
    expect(expected).to.not.equal(20);
    const move = {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: toClient(renderer, { x: 0, y: target }).clientY,
    };
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    canvas.fire("pointermove", move);
    canvas.fire("pointerup", move);
    expect(canvas.style.cursor, "the drag lets go").to.equal("grab");

    // The drag left the tag where it was drawn; hovering it again names the
    // value the drag arrived at, not the one it started from.
    canvas.fire("pointermove", grab);
    expect(canvas.style.cursor).to.equal("ns-resize");
    expect(canvas.title).to.equal(floorTagText(expected, 3));

    // That hover redrew the floor, so the tag has moved to the new value.
    const moved = centerOf(theTag(renderer));
    canvas.fire("pointerleave", {});
    expect(canvas.title).to.equal("");
    canvas.fire("pointermove", moved);
    expect(canvas.style.cursor).to.equal("ns-resize");
    expect(canvas.title).to.equal(floorTagText(expected, 3));
  });

  it("draws and drags the floor on an X axis that shows citations", function () {
    const changes: number[] = [];
    const { renderer, canvas } = makeRenderer(CITATIONS_X, {
      onFloorChange: (floor) => changes.push(floor),
    });
    renderer.setFloor(20, 2);
    expect(tagTexts(canvas)).to.include(floorTagText(20, 2));
    expect(renderer.labelObstacles(), "one obstacle, the tag").to.have.lengthOf(
      1,
    );
    const grab = centerOf(theTag(renderer));
    canvas.fire("pointermove", grab);
    expect(canvas.style.cursor, "an X floor drags sideways").to.equal(
      "ew-resize",
    );
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    const target = (WORLD_PLOT.left + WORLD_PLOT.right) / 2;
    const expected = floorAtWorld("x", axisInput(renderer, "x"), target);
    expect(expected).to.be.greaterThan(0);
    expect(expected).to.not.equal(20);
    const move = {
      pointerId: 1,
      clientX: toClient(renderer, { x: target, y: 0 }).clientX,
      clientY: grab.clientY,
    };
    canvas.fire("pointermove", move);
    canvas.fire("pointerup", move);
    expect(changes).to.deep.equal([expected]);
  });
});
