import { describe, it, mock } from "node:test";
import { expect } from "chai";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * "A pan recomputes nothing" is the load-bearing performance claim of D6's
 * zoom-bucket cache, and until this case nothing verified it. D6's own
 * assertion compared the drawn coordinates before and after a pan and required
 * them to differ by exactly the pan delta — which passes whether or not the
 * contour was recomputed, because a recompute at an unchanged radius produces
 * the very same contour and the projection then shifts it. Only a call count
 * can tell a cache hit from a byte-identical recompute.
 *
 * `mock.module` is experimental and needs `--experimental-test-module-mocks`
 * (set in the `test:unit` script). It must be installed before the renderer is
 * imported, which is why the renderer is imported dynamically here and why
 * this case lives in its own file rather than beside the statically-imported
 * one in `citationGraphRendererRegions.test.ts`.
 */
describe("CitationGraphRenderer region cache", function () {
  it("recomputes a contour on a bucket change and never on a pan", async function () {
    const real = await import("../../src/services/graphFolderRegion");
    let calls = 0;
    mock.module("../../src/services/graphFolderRegion.ts", {
      exports: {
        ...real,
        folderRegionContours: (
          ...args: Parameters<typeof real.folderRegionContours>
        ) => {
          calls += 1;
          return real.folderRegionContours(...args);
        },
      },
    });
    const { CitationGraphRenderer } =
      await import("../../src/services/citationGraphRenderer");

    const canvas = new FakeCanvas();
    const graphNode = node("n1", { collectionIDs: [1] });
    // A second, unselected node gives the model a nonzero data extent: with
    // a single point the extent is zero on both axes, `regionFitScale`
    // returns 0, and every scale then falls into bucket 0 forever — the
    // zoom-bucket assertions below could never observe a bucket change.
    const otherNode = node("n2");
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([graphNode, otherNode]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(
      new Map([
        ["n1", { x: 100, y: 100 }],
        ["n2", { x: 500, y: 400 }],
      ]),
    );

    renderer.setRegions([
      { collectionID: 1, color: "#336699", nodeKeys: new Set(["n1"]) },
    ]);
    const afterFirstDraw = calls;
    expect(afterFirstDraw, "the first frame builds the contour").to.equal(1);

    // A pan: same scale, different origin. Neither the layout revision nor
    // the zoom bucket moves, so the cached contour is re-projected.
    renderer.setViewTransform({ x: 40, y: -25, scale: 1 });
    expect(calls, "a pan recomputes nothing").to.equal(afterFirstDraw);
    renderer.setViewTransform({ x: -10, y: 90, scale: 1 });
    expect(calls, "a second pan recomputes nothing either").to.equal(
      afterFirstDraw,
    );

    // A zoom far past the fit crosses many bucket edges at once, so exactly
    // one recompute lands, not one per bucket.
    renderer.setViewTransform({ x: 0, y: 0, scale: 8 });
    expect(calls, "a zoom past a bucket edge recomputes once").to.equal(
      afterFirstDraw + 1,
    );

    // And back at that scale, panning is free again.
    renderer.setViewTransform({ x: 5, y: 5, scale: 8 });
    expect(calls, "a pan at the new bucket recomputes nothing").to.equal(
      afterFirstDraw + 1,
    );

    mock.reset();
  });
});
