/// <reference types="mocha" />
import { expect } from "chai";
import {
  makeCorpus,
  openViewStage,
  settle,
  type ViewStage,
} from "./visualHarness";

/**
 * D6. A folder's region tightens past the fit zoom so the territory pulls
 * apart into its papers rather than swallowing the viewport. Two things have
 * to be true at once and only one of them is obvious: the region must still be
 * painted after a zoom, and its shape must actually have changed. Asserting
 * only the first would pass on the pre-D6 build; asserting only the second
 * would pass on a build that dropped the region entirely — which is what B28
 * looked like, and is the failure this case is really standing guard over.
 */
describe("D6: a folder region survives a zoom-in", function () {
  let stage: ViewStage | null = null;

  afterEach(function () {
    stage?.close();
    stage = null;
  });

  /** Whether the plot has anything on it beyond one flat fill. */
  function drawnPixels(active: ViewStage): number {
    const context = active.canvas.getContext("2d")!;
    const { width, height } = active.canvas;
    const data = context.getImageData(0, 0, width, height).data;
    const first = [data[0], data[1], data[2]];
    let different = 0;
    for (let index = 0; index < data.length; index += 160) {
      if (
        data[index] !== first[0] ||
        data[index + 1] !== first[1] ||
        data[index + 2] !== first[2]
      ) {
        different += 1;
      }
    }
    return different;
  }

  /** A coarse fingerprint of what is on the canvas, cheap enough to take
   *  twice: the per-channel totals over a sampled grid. Two different
   *  contours cannot land on the same three numbers by accident. */
  function fingerprint(active: ViewStage): string {
    const context = active.canvas.getContext("2d")!;
    const { width, height } = active.canvas;
    const data = context.getImageData(0, 0, width, height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let index = 0; index < data.length; index += 40) {
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
    }
    return `${red}:${green}:${blue}`;
  }

  function zoomIn(active: ViewStage): void {
    const button = active.root.querySelector(
      '.cm-zoom-controls button[data-action="in"]',
    ) as HTMLButtonElement | null;
    expect(button, "the zoom-in control").to.exist;
    button!.click();
  }

  function fit(active: ViewStage): void {
    const button = active.root.querySelector(
      '.cm-zoom-controls button[data-action="fit"]',
    ) as HTMLButtonElement | null;
    button?.click();
  }

  it("keeps the region painted and changes its shape", async function () {
    this.timeout(60_000);
    const active = await openViewStage(makeCorpus({ nodes: 120 }), {
      initialCollectionIDs: [3],
    });
    stage = active;
    await settle(active.window, 12);
    fit(active);
    await settle(active.window, 12);

    const atFit = drawnPixels(active);
    expect(atFit, "the graph is drawn before the zoom").to.be.greaterThan(200);
    const before = fingerprint(active);

    // Two clicks at 1.22 each is 1.49, comfortably past one 12% bucket.
    zoomIn(active);
    zoomIn(active);
    await settle(active.window, 12);

    expect(
      drawnPixels(active),
      "the region and the nodes are still on the plot after zooming",
    ).to.be.greaterThan(200);
    expect(
      fingerprint(active),
      "the zoom actually redrew the plot",
    ).to.not.equal(before);
    expect(active.errors, "nothing threw during the zoom").to.deep.equal([]);
  });
});
