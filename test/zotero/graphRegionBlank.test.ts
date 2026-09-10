/// <reference types="mocha" />
import { expect } from "chai";
import {
  delay,
  makeCorpus,
  openViewStage,
  settle,
  writeFrame,
  type ViewStage,
} from "./visualHarness";

/**
 * Reproduction for backlog B28: a non-empty region selection blanks the plot.
 * The user sees it three ways — a graph opened from a folder, a saved folder
 * graph, and a click on a folder's row — and all three are one trigger:
 * `regions` is not empty when the frame is drawn.
 *
 * `graphFolderRegions.test.ts` walks the same click and passes, because it only
 * ever reads the rail's selected class. This asks the canvas instead.
 */
describe("B28: a folder region blanks the plot", function () {
  let stage: ViewStage | null = null;

  afterEach(function () {
    stage?.close();
    stage = null;
  });

  /** Whether anything was drawn, rather than whether a canvas exists. */
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

  function fit(active: ViewStage): void {
    const button = active.root.querySelector(
      '.cm-zoom-controls button[data-action="fit"]',
    ) as HTMLButtonElement | null;
    button?.click();
  }

  it("draws nodes on a graph opened from a folder", async function () {
    this.timeout(60_000);
    const active = await openViewStage(makeCorpus({ nodes: 120 }), {
      initialCollectionIDs: [3],
    });
    stage = active;
    await settle(active.window, 12);
    fit(active);
    await settle(active.window, 8);

    const path = await writeFrame(active.canvas, "b28-folder-opened");
    console.log(
      `B28 folder-opened: pixels=${drawnPixels(active)} frame=${path} errors=${JSON.stringify(active.errors)}`,
    );
    expect(active.errors, `the view threw: ${active.errors.join(" ;; ")}`).to.be
      .empty;
    expect(
      drawnPixels(active),
      "the canvas has a graph on it",
    ).to.be.greaterThan(200);
  });

  it("keeps the nodes when a folder's row is selected", async function () {
    this.timeout(60_000);
    const active = await openViewStage(makeCorpus({ nodes: 120 }));
    stage = active;
    await settle(active.window, 12);
    fit(active);
    await settle(active.window, 8);
    const before = drawnPixels(active);

    const body = active.root.querySelector(
      ".cm-scope-row [data-collection-id]",
    ) as HTMLButtonElement | null;
    expect(body, "a folder row to select").to.exist;
    body!.click();
    await settle(active.window, 12);
    await delay(200);
    const after = drawnPixels(active);

    const path = await writeFrame(active.canvas, "b28-row-clicked");
    console.log(
      `B28 row-click: before=${before} after=${after} frame=${path} errors=${JSON.stringify(active.errors)}`,
    );
    expect(active.errors, `the view threw: ${active.errors.join(" ;; ")}`).to.be
      .empty;
    expect(after, "the canvas still has a graph on it").to.be.greaterThan(200);
  });
});
