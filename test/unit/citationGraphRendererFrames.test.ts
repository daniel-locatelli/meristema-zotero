import { afterEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { FRAME_FALLBACK_MS } from "../../src/services/frameOrTimer";
import { graphThemeFor } from "../../src/services/graphTheme";
import {
  attachView,
  FakeCanvas,
  FakePath2D,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * B89: every pointermove of a pan and every wheel notch drew the whole scene
 * at once, and the pointer delivers moves faster than the screen paints. They
 * now mark the scene dirty and draw once, on the next frame, or on the
 * fallback timer when a covered window delivers no frame (B83).
 */
function makeRenderer() {
  const canvas = new FakeCanvas();
  const graph = model([node("a"), node("b"), node("c")]);
  graph.edges = [
    { source: "a", target: "b" },
    { source: "b", target: "a" },
    { source: "b", target: "c" },
  ] as typeof graph.edges;
  const renderer = new CitationGraphRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    model: graph,
    layout: FREE_LAYOUT,
    collectionLabels: new Map(),
    onSelectionChange: () => undefined,
    onOpenNode: () => undefined,
  });
  // The fake starts at the identity transform, so world, screen and client
  // coordinates coincide.
  renderer.setNodePositions(
    new Map([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 300, y: 100 }],
      ["c", { x: 300, y: 300 }],
    ]),
  );
  const { flushFrames } = attachView(canvas);
  let draws = 0;
  canvas.context.clearRect = () => void (draws += 1);
  return {
    canvas,
    graph,
    renderer,
    flushFrames,
    draws: () => draws,
    resetDraws: () => void (draws = 0),
  };
}

/** Grab the empty plot, away from every node, and start a pan. */
function startPan(canvas: FakeCanvas): void {
  canvas.fire("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 600,
    clientY: 500,
  });
}

function panMoves(canvas: FakeCanvas, count: number): void {
  for (let step = 1; step <= count; step += 1) {
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: 600 + step * 10,
      clientY: 500 + step * 5,
    });
  }
}

describe("CitationGraphRenderer interaction frames (B89)", function () {
  afterEach(() => mock.timers.reset());

  it("draws a pan's moves within one frame once, on the frame", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    startPan(canvas);
    resetDraws();
    panMoves(canvas, 6);
    expect(draws(), "no move draws at once").to.equal(0);
    expect(flushFrames(), "one frame asked for").to.equal(1);
    expect(draws(), "six moves, one draw").to.equal(1);
    expect(
      renderer.getViewTransform(),
      "the camera took every move",
    ).to.include({ x: 60, y: 30 });
    expect(flushFrames(), "nothing left pending").to.equal(0);
    renderer.destroy();
  });

  it("draws a burst of wheel notches once", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    resetDraws();
    for (let notch = 0; notch < 4; notch += 1) {
      canvas.fire("wheel", {
        clientX: 400,
        clientY: 300,
        deltaY: -100,
        deltaMode: 0,
        preventDefault: () => undefined,
      });
    }
    expect(draws()).to.equal(0);
    flushFrames();
    expect(draws()).to.equal(1);
    expect(renderer.getViewTransform().scale).to.be.greaterThan(1);
    renderer.destroy();
  });

  it("draws a free-axis node drag's moves once a frame", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    canvas.fire("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    resetDraws();
    for (let step = 1; step <= 5; step += 1) {
      canvas.fire("pointermove", {
        pointerId: 1,
        clientX: 100 + step * 8,
        clientY: 100,
      });
    }
    flushFrames();
    expect(draws()).to.equal(1);
    expect(renderer.positionOf("a")).to.deep.equal({ x: 140, y: 100 });
    renderer.destroy();
  });

  it("paints the gesture's end as the pointer lifts, without a frame", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    startPan(canvas);
    panMoves(canvas, 3);
    resetDraws();
    canvas.fire("pointerup", { pointerId: 1, clientX: 630, clientY: 515 });
    expect(draws(), "the pending frame drawn at once").to.equal(1);
    expect(flushFrames(), "and no longer pending").to.equal(0);
    renderer.destroy();
  });

  it("lets a synchronous draw supersede the pending frame", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    startPan(canvas);
    panMoves(canvas, 2);
    resetDraws();
    renderer.selectNode("b", false);
    expect(draws(), "selection still draws at once").to.equal(1);
    flushFrames();
    expect(draws(), "the frame has nothing left to draw").to.equal(1);
    renderer.destroy();
  });

  it("draws on the fallback timer when the window delivers no frame", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { canvas, renderer, draws, resetDraws } = makeRenderer();
    // A covered window: frames are asked for and never come.
    canvas.ownerDocument.defaultView = {
      Path2D: FakePath2D,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as never;
    startPan(canvas);
    resetDraws();
    panMoves(canvas, 4);
    mock.timers.tick(FRAME_FALLBACK_MS - 1);
    expect(draws(), "not before the fallback").to.equal(0);
    mock.timers.tick(1);
    expect(draws(), "one draw for the four moves").to.equal(1);
    renderer.destroy();
  });

  it("draws nothing after it is destroyed", function () {
    const { canvas, renderer, flushFrames, draws, resetDraws } = makeRenderer();
    startPan(canvas);
    panMoves(canvas, 2);
    resetDraws();
    renderer.destroy();
    flushFrames();
    expect(draws()).to.equal(0);
  });
});

describe("CitationGraphRenderer edge order (B89)", function () {
  /** Count the passes over the model's edges, which only an order rebuild makes. */
  function countEdgePasses(graph: { edges: unknown[] }): () => number {
    let passes = 0;
    const filter = graph.edges.filter.bind(graph.edges);
    (graph.edges as { filter: unknown }).filter = (
      ...args: Parameters<typeof filter>
    ) => {
      passes += 1;
      return filter(...args);
    };
    return () => passes;
  }

  function edgeStrokes(canvas: FakeCanvas): number {
    const base = graphThemeFor("light").edges.base;
    return canvas.context.calls.filter(
      (call) =>
        call.method === "stroke" &&
        call.args.length === 0 &&
        call.strokeStyle === base,
    ).length;
  }

  it("reuses the order across pan frames", function () {
    const { canvas, graph, renderer, flushFrames } = makeRenderer();
    const passes = countEdgePasses(graph);
    startPan(canvas);
    for (let frame = 0; frame < 3; frame += 1) {
      panMoves(canvas, 2);
      flushFrames();
    }
    expect(passes(), "no frame re-sorted the edges").to.equal(0);
    renderer.destroy();
  });

  it("rebuilds it on any other draw, and pan frames keep the rebuild", function () {
    const { canvas, graph, renderer, flushFrames } = makeRenderer();
    const passes = countEdgePasses(graph);
    // The owner hides a relationship: the order loses the edge at once.
    renderer.setRelationshipHidden("b", "c", true);
    expect(passes(), "a synchronous draw rebuilds").to.equal(1);
    startPan(canvas);
    canvas.context.calls = [];
    panMoves(canvas, 2);
    flushFrames();
    expect(edgeStrokes(canvas), "a <-> b only, b -> c stays hidden").to.equal(
      2,
    );
    expect(passes(), "and the pan reused it").to.equal(1);
    renderer.destroy();
  });

  it("rebuilds when the owner grows the edge array in place", function () {
    const { canvas, graph, renderer, flushFrames } = makeRenderer();
    // Without a draw of its own, as an owner that splices the model and
    // draws later would: the edge count alone tells the pan frame.
    graph.edges.push({ source: "c", target: "a" } as (typeof graph.edges)[0]);
    startPan(canvas);
    canvas.context.calls = [];
    panMoves(canvas, 1);
    flushFrames();
    expect(edgeStrokes(canvas)).to.equal(4);
    renderer.destroy();
  });
});
