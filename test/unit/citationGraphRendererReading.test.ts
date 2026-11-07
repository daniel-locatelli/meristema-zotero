import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { graphThemeFor } from "../../src/services/graphTheme";
import type { ReadingPlan } from "../../src/domain/readingPlan";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
  type RecordedCall,
} from "./graphRendererDoubles";

const PATH_COLORS = [
  graphThemeFor("light").states.readingPath,
  graphThemeFor("dark").states.readingPath,
];

function planOf(paths: string[][]): ReadingPlan {
  return {
    paths: paths.map((keys, index) => ({
      collectionID: index + 1,
      topic: `list ${index + 1}`,
      keys,
    })),
    stepByKey: new Map(),
    afterLast: 1,
    stateByKey: new Map(),
  };
}

/** Every polyline stroked in the reading-path colour, as its points. */
function pathPolylines(calls: RecordedCall[]): number[][][] {
  const lines: number[][][] = [];
  let points: number[][] = [];
  for (const call of calls) {
    if (call.method === "moveTo") points = [call.args as number[]];
    else if (call.method === "lineTo") points.push(call.args as number[]);
    else if (call.method === "stroke" && PATH_COLORS.includes(call.strokeStyle))
      lines.push(points);
  }
  return lines;
}

function drawnWith(
  paths: string[][] | null,
  visible?: string[],
): { calls: RecordedCall[]; firstFill: number } {
  const canvas = new FakeCanvas();
  const renderer = new CitationGraphRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    model: model([node("a"), node("b"), node("c")]),
    layout: FREE_LAYOUT,
    collectionLabels: new Map(),
    onSelectionChange: () => undefined,
    onOpenNode: () => undefined,
  });
  attachView(canvas);
  renderer.setNodePositions(
    new Map([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 200, y: 100 }],
      ["c", { x: 300, y: 100 }],
    ]),
  );
  if (visible) renderer.setVisibleKeys(new Set(visible), false);
  canvas.context.calls.length = 0;
  renderer.setReadingPlan(paths ? planOf(paths) : null);
  const calls = canvas.context.calls;
  return { calls, firstFill: calls.findIndex((call) => call.method === "arc") };
}

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

  describe("reading path", function () {
    it("joins a list's steps in order with a dashed line under the nodes", function () {
      const { calls, firstFill } = drawnWith([["a", "b", "c"]]);
      expect(pathPolylines(calls)).to.deep.equal([
        [
          [100, 100],
          [200, 100],
          [300, 100],
        ],
      ]);
      const dash = calls.find((call) => call.method === "setLineDash");
      expect((dash?.args[0] as number[]).length).to.be.greaterThan(0);
      const stroke = calls.findIndex(
        (call) =>
          call.method === "stroke" && PATH_COLORS.includes(call.strokeStyle),
      );
      expect(firstFill).to.be.greaterThan(-1);
      expect(stroke).to.be.lessThan(firstFill);
    });

    it("draws nothing for a list of one visible step, and never joins two lists", function () {
      const { calls } = drawnWith([["a", "b"], ["c"]]);
      const lines = pathPolylines(calls);
      expect(lines).to.have.length(1);
      expect(lines[0].some(([x]) => x === 300)).to.equal(false);
    });

    it("skips a hidden step, joining the visible ones either side", function () {
      const { calls } = drawnWith([["a", "b", "c"]], ["a", "c"]);
      expect(pathPolylines(calls)).to.deep.equal([
        [
          [100, 100],
          [300, 100],
        ],
      ]);
    });

    it("draws nothing without a plan or with a plan of no paths", function () {
      expect(pathPolylines(drawnWith(null).calls)).to.have.length(0);
      expect(pathPolylines(drawnWith([]).calls)).to.have.length(0);
    });
  });
});
