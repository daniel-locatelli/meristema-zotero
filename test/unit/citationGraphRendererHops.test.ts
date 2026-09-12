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
   * The hop ramp actually lands on the canvas: a citer's node fill, the
   * edge it draws toward its cited paper, and its label all draw at its
   * hop's alpha — not at the emphasis-only alpha the pre-Task-7 code drew
   * everything at.
   *
   * Three nodes, one edge: a seed at hop 0, a citer at hop 1 with an edge
   * citer -> seed (the citer→cited convention, so the edge's `source` is
   * the citer), and an unconnected hop-2 node. `nodeLabelMode: "title"` and
   * each node's own unique title let the recorded `fillText` calls be told
   * apart; selecting the hop-2 node forces its label past the label
   * budget, since a selected node always draws (`important` in
   * `drawRendererLabels`) regardless of how much room is left. Nothing here
   * emphasises a node (`setEmphasis` untouched), so `emphasisAlphaFor`
   * returns 1 throughout and the recorded alpha is the hop alpha alone.
   */
  it("lands the hop ramp on the node fill, the edge and the label", function () {
    const seed = node("s", { title: "Seed Paper" });
    const citer = node("a", { title: "Citer Paper" });
    const farNode = node("b", { title: "Hop2 Paper" });
    const graphModel: CitationGraphModel = {
      nodes: [seed, citer, farNode],
      edges: [
        {
          key: "a>s",
          source: "a",
          target: "s",
          provenance: "test",
          manual: false,
        },
      ],
      statistics: { nodes: 3, resolvedNodes: 1, edges: 1, isolatedNodes: 1 },
    };
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: graphModel,
      layout: { ...FREE_LAYOUT, nodeLabelMode: "title" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(
      new Map([
        ["s", { x: 400, y: 300 }],
        ["a", { x: 200, y: 300 }],
        ["b", { x: 600, y: 300 }],
      ]),
    );
    renderer.setHops(
      new Map([
        ["s", 0],
        ["a", 1],
        ["b", 2],
      ]),
      false,
    );
    // `setNodePositions` above already triggered its own draw, at a point
    // where `setHops` had not run yet; clear it so only the draw that
    // actually paints the hop alphas is inspected below.
    canvas.context.calls = [];
    // Forces "b"'s label past the label budget, and triggers the draw that
    // paints the hop alphas set above.
    renderer.selectNode("b", false);

    const fills = canvas.context.calls.filter(
      (call) => call.method === "fill" && call.args.length === 0,
    );
    // Edges draw before nodes, so however many arrowhead fills preceded
    // them, the three most recent `fill()` calls are the node discs, in
    // `graphModel.nodes` order: seed, citer, hop-2.
    const [seedFill, citerFill, hop2Fill] = fills.slice(-3);
    expect(seedFill.globalAlpha, "seed's fill alpha").to.equal(1);
    expect(citerFill.globalAlpha, "citer's (hop 1) fill alpha").to.equal(0.9);
    expect(hop2Fill.globalAlpha, "hop-2 node's fill alpha").to.equal(0.8);

    // Only one edge exists, so the first stroke recorded overall is that
    // edge's line, drawn before any node's outline or selection ring.
    const edgeStroke = canvas.context.calls.find(
      (call) => call.method === "stroke",
    );
    expect(edgeStroke, "an edge stroke was recorded").to.exist;
    expect(
      edgeStroke!.globalAlpha,
      "the edge draws at the citer's alpha, not the seed's",
    ).to.equal(0.9);

    const hop2Label = canvas.context.calls.find(
      (call) => call.method === "fillText" && call.args[0] === "Hop2 Paper",
    );
    expect(hop2Label, "the hop-2 node's label was drawn").to.exist;
    expect(hop2Label!.globalAlpha, "hop-2 node's label alpha").to.equal(0.8);
  });
});

/**
 * What the hop runner reads off the renderer to order its plan: the paper
 * under the pointer, a paper's world position (which it projects into the
 * camera itself), and the two notifications that tell it to re-plan.
 */
describe("CitationGraphRenderer plan hooks", function () {
  function makeRenderer(options: {
    onHoverChange?: (key: string | null) => void;
    onViewChange?: () => void;
  }): { renderer: CitationGraphRenderer; canvas: FakeCanvas } {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([node("n1"), node("n2")]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
      ...options,
    });
    renderer.setNodePositions(
      new Map([
        ["n1", { x: 200, y: 200 }],
        ["n2", { x: 640, y: 480 }],
      ]),
    );
    return { renderer, canvas };
  }

  it("reports the hovered key and announces every change of it", function () {
    const hovered: (string | null)[] = [];
    const { renderer, canvas } = makeRenderer({
      onHoverChange: (key) => hovered.push(key),
    });
    expect(renderer.getHoverKey(), "nothing is hovered yet").to.equal(null);

    canvas.fire("pointermove", { clientX: 200, clientY: 200 });
    expect(
      renderer.getHoverKey(),
      `after a pointermove over n1, hover was ${String(renderer.getHoverKey())}`,
    ).to.equal("n1");

    canvas.fire("pointerleave", {});
    expect(renderer.getHoverKey(), "the pointer left the canvas").to.equal(
      null,
    );
    expect(hovered, "one notification per change, in order").to.deep.equal([
      "n1",
      null,
    ]);
  });

  it("hands out a node's world position and null for a key it has none for", function () {
    const { renderer } = makeRenderer({});
    expect(renderer.positionOf("n1")).to.deep.equal({ x: 200, y: 200 });
    expect(
      renderer.positionOf("absent"),
      "no position for an absent key",
    ).to.equal(null);
  });

  it("announces a camera change, which re-orders the plan", function () {
    let views = 0;
    const { renderer } = makeRenderer({
      onViewChange: () => {
        views += 1;
      },
    });
    renderer.setViewTransform({ x: 10, y: 20, scale: 2 });
    expect(views, `onViewChange fired ${views} time(s)`).to.be.greaterThan(0);
    expect(renderer.getViewTransform()).to.deep.equal({
      x: 10,
      y: 20,
      scale: 2,
    });
  });
});
