import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import {
  FakeCanvas,
  FakePath2D,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * A view whose animation frames run only when the case flushes them, so the
 * case can read the camera the first frame paints with before the initial
 * fit's settle has had a frame.
 */
function heldFrames(): {
  view: Record<string, unknown>;
  flush(limit: number): void;
} {
  let next = 1;
  const queued = new Map<number, () => void>();
  const view = {
    Path2D: FakePath2D,
    devicePixelRatio: 1,
    requestAnimationFrame(run: () => void): number {
      const handle = next++;
      queued.set(handle, run);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      queued.delete(handle);
    },
    addEventListener(): void {},
    removeEventListener(): void {},
  };
  return {
    view,
    flush(limit) {
      for (let round = 0; round < limit && queued.size; round += 1) {
        const batch = [...queued.values()];
        queued.clear();
        for (const run of batch) run();
      }
    },
  };
}

/**
 * B18: opening a graph drew it, and the fit moved everything a few frames
 * later. The first frame must already be framed; the settle that follows
 * confirms the fit and so moves nothing when the canvas held still.
 */
describe("CitationGraphRenderer first frame", function () {
  it("paints its first frame fitted, and the settled fit does not move it", function () {
    const frames = heldFrames();
    const canvas = new FakeCanvas();
    canvas.ownerDocument.defaultView = frames.view as never;
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([
        node("early", { year: 1990, citationCount: 3 }),
        node("late", { year: 2024, citationCount: 900 }),
      ]),
      layout: { ...FREE_LAYOUT, xMetric: "year", yMetric: "citations" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    try {
      const first = renderer.getViewTransform();
      frames.flush(10);
      const settled = renderer.getViewTransform();
      expect(settled, "the settle fitted the view").to.not.deep.equal({
        x: 0,
        y: 0,
        scale: 1,
      });
      expect(first, "the camera before any frame").to.deep.equal(settled);
    } finally {
      renderer.destroy();
    }
  });
});
