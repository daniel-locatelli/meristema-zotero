import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  CitationGraphModel,
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import { graphThemeFor } from "../../src/services/graphTheme";

/**
 * A typed double for exactly the 2D canvas surface the renderer touches
 * (`grep -oE "context\.[a-zA-Z]+"` over citationGraphRenderer.ts and its
 * scene/frame helpers) plus the DOM surface its constructor and pointer
 * handlers touch — not a general canvas or DOM shim. `ownerDocument`'s
 * `defaultView` is left null throughout: every read of it in the renderer is
 * optionally chained, and a null view makes the constructor skip
 * `ResizeObserver`, `requestAnimationFrame` and the initial fit entirely,
 * which is what keeps this double small.
 */
class FakePath2D {
  commands: Array<{ op: string; args: number[] }> = [];
  moveTo(x: number, y: number): void {
    this.commands.push({ op: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.commands.push({ op: "lineTo", args: [x, y] });
  }
  bezierCurveTo(...args: number[]): void {
    this.commands.push({ op: "bezierCurveTo", args });
  }
  closePath(): void {
    this.commands.push({ op: "closePath", args: [] });
  }
}

interface RecordedCall {
  method: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
}

class FakeContext2D {
  calls: RecordedCall[] = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 0;
  lineJoin = "";
  lineCap = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  shadowBlur = 0;
  shadowColor = "";

  private record(method: string, args: unknown[]): void {
    this.calls.push({
      method,
      args,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
    });
  }

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  rect(): void {}
  clip(): void {}
  rotate(): void {}
  translate(): void {}
  setLineDash(): void {}
  fillText(): void {}
  drawImage(...args: unknown[]): void {
    this.record("drawImage", args);
  }
  stroke(...args: unknown[]): void {
    this.record("stroke", args);
  }
  fill(...args: unknown[]): void {
    this.record("fill", args);
  }
}

class FakeCanvas {
  width = 800;
  height = 600;
  style: Record<string, string> = {};
  title = "";
  tabIndex = 0;
  context = new FakeContext2D();
  ownerDocument: {
    defaultView: { Path2D: typeof FakePath2D } | null;
    createElement: (tag: string) => FakeCanvas;
  };
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    this.ownerDocument = {
      defaultView: null,
      createElement: (tag: string) => {
        if (tag !== "canvas") {
          throw new Error(`FakeCanvas cannot create a <${tag}>`);
        }
        return new FakeCanvas();
      },
    };
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  getContext(kind: string): FakeContext2D | null {
    return kind === "2d" ? this.context : null;
  }
  getBoundingClientRect() {
    return {
      width: this.width,
      height: this.height,
      left: 0,
      top: 0,
      right: this.width,
      bottom: this.height,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

function node(
  key: string,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  return {
    key,
    itemID: 1,
    itemKey: key,
    title: "A paper",
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: null,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    isRetracted: null,
    ...overrides,
  } as unknown as CitationGraphNode;
}

function model(nodes: CitationGraphNode[]): CitationGraphModel {
  return {
    nodes,
    edges: [],
    statistics: {
      nodes: nodes.length,
      resolvedNodes: 0,
      edges: 0,
      isolatedNodes: nodes.length,
    },
  };
}

const FREE_LAYOUT: GraphLayoutOptions = {
  xMetric: "free",
  xScale: "linear",
  yMetric: "free",
  yScale: "linear",
  nodeSizeMetric: "uniform",
  nodeColorMetric: "uniform",
  nodeLabelMode: "none",
};

/**
 * The coordinates of the most recent region border stroke — the plain,
 * full-alpha `stroke(path)` call `drawRegions` issues after compositing the
 * fill, the only place anywhere in the renderer a `Path2D` is stroked (the
 * one `new Path2D()` in the whole module lives in `drawRegions`), so any
 * such call unambiguously belongs to a region draw.
 */
function lastRegionStroke(context: FakeContext2D): RecordedCall {
  for (let i = context.calls.length - 1; i >= 0; i -= 1) {
    const call = context.calls[i];
    if (call.method === "stroke" && call.args[0] instanceof FakePath2D) {
      return call;
    }
  }
  throw new Error("no region stroke recorded");
}

/** As `lastRegionStroke`, but for a specific region's colour — needed once
 * more than one region is on screen, since regions draw in array order and
 * "the last stroke" would otherwise pick up whichever region drew last. */
function lastRegionStrokeOf(
  context: FakeContext2D,
  color: string,
): RecordedCall {
  for (let i = context.calls.length - 1; i >= 0; i -= 1) {
    const call = context.calls[i];
    if (
      call.method === "stroke" &&
      call.args[0] instanceof FakePath2D &&
      call.strokeStyle === color
    ) {
      return call;
    }
  }
  throw new Error(`no region stroke recorded for ${color}`);
}

/**
 * The renderer builds a region's path from `canvas.ownerDocument.defaultView`,
 * not from the global scope, because the plugin's bundle runs in a scope with
 * no DOM constructors on it (backlog B28). This used to polyfill `globalThis`
 * instead, which is precisely why these tests watched the live plugin throw
 * "Path2D is not defined" and reported nothing: every test scope has a global
 * `Path2D`, and the renderer was reading the one place a plugin never has one.
 *
 * The view is attached after construction so the constructor still takes the
 * null-view path this double is built around — no `ResizeObserver`, no
 * `requestAnimationFrame`, no initial fit.
 */
function attachView(canvas: FakeCanvas): void {
  canvas.ownerDocument.defaultView = { Path2D: FakePath2D };
}

describe("CitationGraphRenderer regions", function () {
  it(
    "freezes a selected region's contour during a free-axis drag and " +
      "catches it up on pointer-up",
    function () {
      {
        const canvas = new FakeCanvas();
        const graphNode = node("n1", { collectionIDs: [1] });
        const renderer = new CitationGraphRenderer({
          canvas: canvas as unknown as HTMLCanvasElement,
          model: model([graphNode]),
          layout: FREE_LAYOUT,
          collectionLabels: new Map(),
          onSelectionChange: () => undefined,
          onOpenNode: () => undefined,
        });
        attachView(canvas);

        // Pin the node at a known point. The fake environment's transform
        // starts at the identity (scale 1, origin 0,0) and its device pixel
        // ratio is 1, so world, screen and pointer-event client coordinates
        // all coincide — a pointerdown at (100, 100) lands exactly on it.
        renderer.setNodePositions(new Map([["n1", { x: 100, y: 100 }]]));
        renderer.setRegions([
          { collectionID: 1, color: "#336699", nodeKeys: new Set(["n1"]) },
        ]);

        const before = lastRegionStroke(canvas.context).args[0] as FakePath2D;
        expect(before.commands.length).to.be.greaterThan(0);

        canvas.fire("pointerdown", {
          button: 0,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        });
        canvas.fire("pointermove", { clientX: 150, clientY: 150 });
        const duringDrag = lastRegionStroke(canvas.context)
          .args[0] as FakePath2D;
        // The node actually moved (its position in `this.positions` is now
        // (150, 150)), but the region must not have noticed yet: a
        // pointermove drag frame does not bump `layoutRevision`, so the
        // region's cached contour — built from the pre-drag position — is
        // reused rather than resummed over the whole grid.
        expect(duringDrag.commands).to.deep.equal(before.commands);

        canvas.fire("pointerup", { pointerId: 1 });
        const afterDrag = lastRegionStroke(canvas.context)
          .args[0] as FakePath2D;
        // Pointer-up is the one point the region is allowed to catch up: it
        // must now reflect the node's final, dragged-to position.
        expect(afterDrag.commands).to.not.deep.equal(before.commands);
      }
    },
  );

  it(
    "keeps an untouched region's identity and colour across a setRegions " +
      "call that only changes another region",
    function () {
      // This checks correctness, not the cache hit itself: with the node's
      // position and the region's own key set both unchanged, a correct
      // recompute would produce byte-identical output to a cache hit, so no
      // black-box assertion on the drawn path can tell the two apart —
      // doing that would need an instrumented call count on
      // `folderRegionContours`, which is disproportionate to add for this
      // repair. What this does catch is a regression in the *other*
      // direction: a selective-invalidation scheme that accidentally drops
      // or miscolours the region it was not supposed to touch.
      {
        const canvas = new FakeCanvas();
        const kept = node("kept", { collectionIDs: [1] });
        const other = node("other", { collectionIDs: [2] });
        const renderer = new CitationGraphRenderer({
          canvas: canvas as unknown as HTMLCanvasElement,
          model: model([kept, other]),
          layout: FREE_LAYOUT,
          collectionLabels: new Map(),
          onSelectionChange: () => undefined,
          onOpenNode: () => undefined,
        });
        attachView(canvas);
        renderer.setNodePositions(
          new Map([
            ["kept", { x: 20, y: 20 }],
            ["other", { x: 400, y: 400 }],
          ]),
        );

        const keptRegion = {
          collectionID: 1,
          color: "#112233",
          nodeKeys: new Set(["kept"]),
        };
        renderer.setRegions([
          keptRegion,
          { collectionID: 2, color: "#445566", nodeKeys: new Set(["other"]) },
        ]);
        const before = lastRegionStrokeOf(canvas.context, "#112233")
          .args[0] as FakePath2D;

        // A third folder, sharing no node with "kept", is selected in
        // "other"'s place.
        renderer.setRegions([
          keptRegion,
          { collectionID: 3, color: "#778899", nodeKeys: new Set(["other"]) },
        ]);
        const after = lastRegionStroke(canvas.context);
        expect(after.strokeStyle).to.equal("#778899");
        const keptStroke = lastRegionStrokeOf(canvas.context, "#112233");
        expect((keptStroke.args[0] as FakePath2D).commands).to.deep.equal(
          before.commands,
        );
      }
    },
  );

  it("lets a seed's colour override the fill even under the default uniform metric", function () {
    {
      const canvas = new FakeCanvas();
      const graphNode = node("seedling");
      const renderer = new CitationGraphRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        model: model([graphNode]),
        layout: FREE_LAYOUT,
        collectionLabels: new Map(),
        onSelectionChange: () => undefined,
        onOpenNode: () => undefined,
      });

      renderer.setSeedColors(new Map([["seedling", "#ff00aa"]]));

      const fills = canvas.context.calls.filter(
        (call) => call.method === "fill" && call.args.length === 0,
      );
      expect(fills.length).to.be.greaterThan(0);
      // `nodeColor` checks `seedColors` before it ever looks at
      // `nodeColorMetric` — a seed is its own colour whatever the metric —
      // so even "uniform" (the shipped default) must lose to it here.
      expect(fills[fills.length - 1].fillStyle).to.equal("#ff00aa");
    }
  });

  it("omits the category line from a node's tooltip under the uniform metric", function () {
    {
      const canvas = new FakeCanvas();
      const graphNode = node("n1");
      const renderer = new CitationGraphRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        model: model([graphNode]),
        layout: FREE_LAYOUT,
        collectionLabels: new Map(),
        onSelectionChange: () => undefined,
        onOpenNode: () => undefined,
      });
      renderer.setNodePositions(new Map([["n1", { x: 200, y: 200 }]]));

      // A bare hover (no prior pointerdown) at the node's own position sets
      // `canvas.title` from `tooltipForNode`.
      canvas.fire("pointermove", { clientX: 200, clientY: 200 });

      const title = (canvas as unknown as { title: string }).title;
      expect(title.length).to.be.greaterThan(0);
      // Under "uniform" — the shipped default — `nodeCategory` returns null
      // for every node, and `labelFor` used to fall back to the literal
      // string "No value", which survived `.filter(Boolean)` and closed
      // every hover card. `nodeCategory` is used at all only for the four
      // categorical metrics, so its absence here is the fix.
      expect(title).to.not.include("No value");
    }
  });

  /**
   * Three papers, deliberately: two close together and one far away. At the
   * fit zoom the close pair merges into one loop and the far paper is a
   * second, so the region is two loops. Past the fit the falloff tightens
   * until the pair no longer reaches across the gap, and the territory pulls
   * apart into three — which is the behaviour D6 exists to produce, and is
   * also the only assertion that cannot be satisfied by a re-projection.
   *
   * A single paper would prove nothing here: its contour is *self-similar*
   * under the tightening, because the pitch follows the radius, so both the
   * vertex count and the normalised shape survive a zoom unchanged.
   */
  it("pulls a territory apart on a zoom but recomputes nothing on a pan", function () {
    {
      const canvas = new FakeCanvas();
      const nodes = [
        node("near", { collectionIDs: [1] }),
        node("pair", { collectionIDs: [1] }),
        node("far", { collectionIDs: [1] }),
      ];
      const renderer = new CitationGraphRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        model: model(nodes),
        layout: FREE_LAYOUT,
        collectionLabels: new Map(),
        onSelectionChange: () => undefined,
        onOpenNode: () => undefined,
      });
      attachView(canvas);
      // Spread is 1000, so the fit-zoom falloff radius is 60: "near" and
      // "pair" are 30 apart and merge, "far" is on its own.
      renderer.setNodePositions(
        new Map([
          ["near", { x: 0, y: 0 }],
          ["pair", { x: 30, y: 0 }],
          ["far", { x: 1000, y: 0 }],
        ]),
      );
      renderer.setRegions([
        {
          collectionID: 1,
          color: "#336699",
          nodeKeys: new Set(["near", "pair", "far"]),
        },
      ]);

      const loopsDrawn = (path: FakePath2D): number =>
        path.commands.filter((command) => command.op === "moveTo").length;

      // 0.15 is the viewport's minimum scale, so it is below the fit zoom
      // whatever the plot rect works out to: bucket 0, today's radius.
      renderer.setViewTransform({ x: 0, y: 0, scale: 0.15 });
      const zoomedOut = lastRegionStroke(canvas.context).args[0] as FakePath2D;
      expect(
        loopsDrawn(zoomedOut),
        "at the fit zoom the close pair is one territory",
      ).to.equal(2);

      // A pan: same scale, different origin. Every coordinate must be the old
      // one shifted by the same delta — that is a re-projection of the cached
      // contour, not a resum over the grid.
      renderer.setViewTransform({ x: 40, y: -25, scale: 0.15 });
      const panned = lastRegionStroke(canvas.context).args[0] as FakePath2D;
      expect(panned.commands.map((command) => command.op)).to.deep.equal(
        zoomedOut.commands.map((command) => command.op),
      );
      panned.commands.forEach((command, index) => {
        command.args.forEach((value, position) => {
          const shift = position % 2 === 0 ? 40 : -25;
          expect(
            value - shift,
            `command ${index} argument ${position} moved by more than the pan`,
          ).to.be.closeTo(zoomedOut.commands[index].args[position], 1e-9);
        });
      });

      // 8 is the viewport's maximum scale, so it is many buckets past the fit
      // and the falloff has hit its floor. The pair can no longer reach.
      renderer.setViewTransform({ x: 0, y: 0, scale: 8 });
      const zoomedIn = lastRegionStroke(canvas.context).args[0] as FakePath2D;
      expect(
        loopsDrawn(zoomedIn),
        "zoomed in, the territory is three separate papers",
      ).to.equal(3);
    }
  });

  it("draws a region at every zoom rather than losing it", function () {
    // The tightening must never take a folder off the plot: at maximum zoom a
    // lone paper still has a halo, it is simply a smaller one in data space. A
    // dropped region here would look exactly like B28 coming back.
    {
      const canvas = new FakeCanvas();
      const graphNode = node("n1", { collectionIDs: [1] });
      const renderer = new CitationGraphRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        model: model([graphNode]),
        layout: FREE_LAYOUT,
        collectionLabels: new Map(),
        onSelectionChange: () => undefined,
        onOpenNode: () => undefined,
      });
      attachView(canvas);
      renderer.setNodePositions(new Map([["n1", { x: 100, y: 100 }]]));
      renderer.setRegions([
        { collectionID: 1, color: "#336699", nodeKeys: new Set(["n1"]) },
      ]);
      for (const scale of [0.15, 1, 2, 4, 8]) {
        renderer.setViewTransform({ x: 0, y: 0, scale });
        const path = lastRegionStroke(canvas.context).args[0] as FakePath2D;
        expect(
          path.commands.length,
          `a region at scale ${scale}`,
        ).to.be.greaterThan(0);
        for (const command of path.commands) {
          for (const value of command.args) {
            expect(
              Number.isFinite(value),
              `scale ${scale} produced ${value}`,
            ).to.equal(true);
          }
        }
      }
    }
  });
});

describe("CitationGraphRenderer colour metric allowlist", function () {
  it(
    "treats a retired or unknown colour metric as a category, never as a " +
      "numeric metric",
    function () {
      // "collection" was retired as a node colouring on this branch, but a
      // reader's stored preference can still hold it (citationPreferences.ts
      // coerces the *main* appearance record, but nothing guarantees every
      // caller does before it reaches the renderer). `isMetricID` used to be
      // a denylist of the four category metrics, so an unrecognised value
      // like "collection" read as true and fell into `metricNumber`, which
      // has no case for it — that reached `getMetricDefinition("collection")`
      // downstream and threw "Unknown Meristema metric: collection",
      // crashing the canvas on its first frame. `isMetricID` is now an
      // allowlist over `METRIC_DEFINITIONS`, so an id it does not recognise
      // routes to the category-assignment path instead, which fails closed:
      // the node simply gets `theme.categorical.noValue`.
      {
        const canvas = new FakeCanvas();
        const graphNode = node("n1");
        const renderer = new CitationGraphRenderer({
          canvas: canvas as unknown as HTMLCanvasElement,
          model: model([graphNode]),
          layout: {
            ...FREE_LAYOUT,
            nodeColorMetric:
              "collection" as GraphLayoutOptions["nodeColorMetric"],
          },
          collectionLabels: new Map(),
          onSelectionChange: () => undefined,
          onOpenNode: () => undefined,
        });
        attachView(canvas);

        expect(() =>
          renderer.setNodePositions(new Map([["n1", { x: 100, y: 100 }]])),
        ).to.not.throw();

        const fills = canvas.context.calls.filter(
          (call) => call.method === "fill" && call.args.length === 0,
        );
        expect(fills.length).to.be.greaterThan(0);
        const theme = graphThemeFor("light");
        expect(fills[fills.length - 1].fillStyle).to.equal(
          theme.categorical.noValue,
        );
      }
    },
  );
});
