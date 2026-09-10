/**
 * The renderer's test doubles, shared by every unit case that drives a real
 * `CitationGraphRenderer`. Extracted from
 * `citationGraphRendererRegions.test.ts` when a second file needed them: the
 * call-count case has to `mock.module` before importing the renderer, so it
 * cannot live beside a static import of it.
 *
 * Deliberately not a `*.test.ts`, so `npm run test:unit`'s glob does not try
 * to run it as a suite.
 */
import type {
  CitationGraphModel,
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";

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
export class FakePath2D {
  commands: Array<{ op: string; args: number[] }> = [];
  moveTo(x: number, y: number): void {
    this.commands.push({ op: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.commands.push({ op: "lineTo", args: [x, y] });
  }
  arc(...args: number[]): void {
    this.commands.push({ op: "arc", args });
  }
  bezierCurveTo(...args: number[]): void {
    this.commands.push({ op: "bezierCurveTo", args });
  }
  closePath(): void {
    this.commands.push({ op: "closePath", args: [] });
  }
}

export interface RecordedCall {
  method: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
}

export class FakeContext2D {
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

export class FakeCanvas {
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

export function node(
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

export function model(nodes: CitationGraphNode[]): CitationGraphModel {
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

export const FREE_LAYOUT: GraphLayoutOptions = {
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
export function lastRegionStroke(context: FakeContext2D): RecordedCall {
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
export function lastRegionStrokeOf(
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
export function attachView(canvas: FakeCanvas): void {
  canvas.ownerDocument.defaultView = { Path2D: FakePath2D };
}
