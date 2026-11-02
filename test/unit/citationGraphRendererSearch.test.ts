import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { graphThemeFor } from "../../src/services/graphTheme";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  hoverText,
  model,
  node,
} from "./graphRendererDoubles";

const CLEAR_SEARCH = "Clear search to select";
const AT_MATCH = { clientX: 200, clientY: 200 };
const AT_GREY = { clientX: 500, clientY: 200 };
const AT_NOTHING = { clientX: 350, clientY: 450 };

/**
 * D36, ADR 0023: the search box greys what does not match. The grey is the
 * uniform colouring's, at the Key's emphasis alpha; a grey paper stays on the
 * plot and takes no pointer until the search is cleared.
 */
describe("CitationGraphRenderer search", function () {
  function makeRenderer() {
    const selected: Array<string | null> = [];
    const opened: string[] = [];
    const menus: string[] = [];
    const toggled: string[] = [];
    const hovers: Array<string | null> = [];
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([node("match"), node("grey", { title: "A grey paper" })]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: (entry: CitationGraphNode | null) =>
        selected.push(entry?.key ?? null),
      onOpenNode: (entry: CitationGraphNode) => opened.push(entry.key),
      onNodeContextMenu: (entry: CitationGraphNode) => menus.push(entry.key),
      onNodeToggle: (entry: CitationGraphNode) => toggled.push(entry.key),
      onHoverChange: (key: string | null) => hovers.push(key),
    });
    attachView(canvas);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    renderer.setNodePositions(
      new Map([
        ["match", { x: AT_MATCH.clientX, y: AT_MATCH.clientY }],
        ["grey", { x: AT_GREY.clientX, y: AT_GREY.clientY }],
      ]),
    );
    return { renderer, canvas, selected, opened, menus, toggled, hovers };
  }

  /** The two discs' fills of the last draw, in draw order: match, then grey. */
  function discFills(canvas: FakeCanvas) {
    return canvas.context.calls
      .filter((call) => call.method === "fill")
      .slice(-2);
  }

  it("draws a paper the search misses in the uniform grey at the emphasis alpha", function () {
    const { renderer, canvas } = makeRenderer();
    canvas.context.calls = [];
    renderer.setSearchMatches(new Set(["match"]));
    const [match, missed] = discFills(canvas);
    expect(match!.globalAlpha, "a match keeps its strength").to.equal(1);
    expect(missed!.globalAlpha, "a miss fades").to.equal(0.25);
    expect(missed!.fillStyle, "a miss greys").to.equal(
      graphThemeFor("light").states.uniformFill,
    );
    canvas.context.calls = [];
    renderer.setSearchMatches(null);
    expect(
      discFills(canvas).map((call) => call.globalAlpha),
      "clearing the search restores every paper",
    ).to.deep.equal([1, 1]);
  });

  it("outlines a grey library paper in its grey, not in ink", function () {
    const { renderer, canvas } = makeRenderer();
    canvas.context.calls = [];
    renderer.setSearchMatches(new Set(["match"]));
    const outlines = canvas.context.calls.filter(
      (call) => call.method === "stroke",
    );
    expect(outlines.at(-1)!.strokeStyle).to.equal(
      graphThemeFor("light").states.uniformFill,
    );
  });

  it("draws no ring around a match", function () {
    const { renderer, canvas } = makeRenderer();
    canvas.context.calls = [];
    renderer.setSearchMatches(new Set(["match", "grey"]));
    const strokes = canvas.context.calls.filter(
      (call) => call.method === "stroke",
    );
    expect(strokes, "the two discs' outlines and nothing else").to.have.length(
      2,
    );
  });

  it("greys every paper when nothing matches", function () {
    const { renderer, canvas } = makeRenderer();
    canvas.context.calls = [];
    renderer.setSearchMatches(new Set());
    expect(discFills(canvas).map((call) => call.globalAlpha)).to.deep.equal([
      0.25, 0.25,
    ]);
  });

  it("fades a grey paper's seed ring with its disc, keeping the ring's colour", function () {
    const { renderer, canvas } = makeRenderer();
    renderer.setSeedMarks(
      {
        seedKeys: new Set(["grey"]),
        seedColors: new Map([["grey", "#123456"]]),
      } as never,
      false,
    );
    canvas.context.calls = [];
    renderer.setSearchMatches(new Set(["match"]));
    const ring = canvas.context.calls.find(
      (call) => call.method === "stroke" && call.strokeStyle === "#123456",
    );
    expect(ring, "the seed's ring").to.exist;
    expect(ring!.globalAlpha).to.equal(0.25);
  });

  it("takes no click, double-click, menu or modifier click on a grey paper", function () {
    const { renderer, canvas, selected, opened, menus, toggled } =
      makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    selected.length = 0;
    const press = { button: 0, pointerId: 1, ...AT_GREY };
    canvas.fire("pointerdown", press);
    canvas.fire("pointerup", press);
    canvas.fire("pointerdown", { ...press, shiftKey: true });
    canvas.fire("pointerup", press);
    canvas.fire("dblclick", AT_GREY);
    let prevented = false;
    canvas.fire("contextmenu", {
      ...AT_GREY,
      preventDefault: () => (prevented = true),
    });
    expect(selected, "no selection").to.be.empty;
    expect(opened, "nothing opened").to.be.empty;
    expect(menus, "no node menu").to.be.empty;
    expect(toggled, "no multi-selection").to.be.empty;
    expect(prevented, "the browser keeps its menu").to.equal(false);
  });

  it("leaves a selection standing when a grey paper is clicked", function () {
    const { renderer, canvas, selected } = makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    renderer.selectNode("match", false);
    selected.length = 0;
    const press = { button: 0, pointerId: 1, ...AT_GREY };
    canvas.fire("pointerdown", press);
    canvas.fire("pointerup", press);
    expect(selected, "the click did not clear it").to.be.empty;
  });

  it("still selects a match, and pans from a grey paper", function () {
    const { renderer, canvas, selected } = makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    selected.length = 0;
    const press = { button: 0, pointerId: 1, ...AT_MATCH };
    canvas.fire("pointerdown", press);
    canvas.fire("pointerup", press);
    expect(selected).to.deep.equal(["match"]);

    const view = renderer.getViewTransform();
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...AT_GREY });
    canvas.fire("pointermove", { clientX: 540, clientY: 200 });
    canvas.fire("pointerup", {
      button: 0,
      pointerId: 1,
      clientX: 540,
      clientY: 200,
    });
    expect(renderer.getViewTransform().x).to.equal(view.x + 40);
  });

  it("finds a match under a grey paper", function () {
    const { renderer, canvas, selected } = makeRenderer();
    renderer.setNodePositions(
      new Map([
        ["match", { x: 200, y: 200 }],
        ["grey", { x: 200, y: 200 }],
      ]),
    );
    renderer.setSearchMatches(new Set(["match"]));
    selected.length = 0;
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...AT_MATCH });
    expect(selected).to.deep.equal(["match"]);
  });

  it("says to clear the search over a grey paper, with no hover", function () {
    const { renderer, canvas, hovers } = makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    canvas.fire("pointermove", AT_GREY);
    expect(canvas.title, "the native tooltip").to.equal(CLEAR_SEARCH);
    expect(hoverText(canvas), "its description").to.equal(CLEAR_SEARCH);
    expect(hovers, "the paper is not hovered").to.deep.equal([null]);
    expect(canvas.style.cursor, "it can still pan").to.equal("grab");
    canvas.fire("pointermove", AT_NOTHING);
    expect(canvas.title, "gone off the paper").to.equal("");
    expect(hoverText(canvas)).to.equal("");
  });

  it("gives a match its normal hover, and no native tooltip", function () {
    const { renderer, canvas, hovers } = makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    canvas.fire("pointermove", AT_MATCH);
    expect(canvas.title).to.equal("");
    expect(hoverText(canvas)).to.equal("A paper");
    expect(hovers).to.deep.equal(["match"]);
  });

  it("clears the tooltip when the pointer leaves or the search ends", function () {
    const { renderer, canvas } = makeRenderer();
    renderer.setSearchMatches(new Set(["match"]));
    canvas.fire("pointermove", AT_GREY);
    canvas.fire("pointerleave");
    expect(canvas.title, "left the plot").to.equal("");
    canvas.fire("pointermove", AT_GREY);
    expect(canvas.title, "back on it").to.equal(CLEAR_SEARCH);
    renderer.setSearchMatches(null);
    expect(canvas.title, "search cleared").to.equal("");
    expect(hoverText(canvas)).to.equal("");
  });

  it("drops the hover of a paper the search just greyed", function () {
    const { renderer, canvas, hovers } = makeRenderer();
    canvas.fire("pointermove", AT_GREY);
    expect(hoverText(canvas), "hovered before the search").to.equal(
      "A grey paper",
    );
    renderer.setSearchMatches(new Set(["match"]));
    expect(hoverText(canvas)).to.equal("");
    expect(hovers).to.deep.equal(["grey", null]);
  });
});
