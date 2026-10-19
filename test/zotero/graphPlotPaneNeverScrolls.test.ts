/// <reference types="mocha" />
import { expect } from "chai";
import {
  makeCorpus,
  openViewStage,
  settle,
  type ViewStage,
} from "./visualHarness";

/**
 * Regression for B111. Zotero's tab hooks focus the plot toolbar's search box
 * whenever a graph tab is selected or its window regains focus
 * (`windowService.ts`, `focusFirst` and `refocus`). In a pane narrower than its
 * toolbar the box sits partly past the pane's edge, and focusing it scrolled
 * the pane sideways to bring it into view: the plot went with it, 104px under
 * the rail in the 1000px test window, where the floor's tag could be hovered
 * but not pressed. The pane clips; it never scrolls.
 */
describe("B111: the plot pane never scrolls", function () {
  let stage: ViewStage | null = null;

  afterEach(function () {
    stage?.close();
    stage = null;
  });

  it("keeps the plot in place when the search box takes focus in a narrow pane", async function () {
    this.timeout(60_000);
    const active = await openViewStage(makeCorpus({ nodes: 40 }));
    stage = active;
    await settle(active.window, 8);
    const pane = active.root.querySelector(".cm-plot-pane") as HTMLElement;
    const toolbar = active.root.querySelector(
      ".cm-plot-toolbar",
    ) as HTMLElement;
    const area = active.root.querySelector(".cm-graph-area") as HTMLElement;
    const search = active.root.querySelector(".cm-search") as HTMLElement;
    expect(
      pane && toolbar && area && search,
      "the pane, its toolbar, area and search",
    ).to.be.ok;
    // Narrower than anything the toolbar can shrink to.
    pane.style.maxWidth = "240px";
    await settle(active.window, 4);
    expect(
      toolbar.scrollWidth,
      `the toolbar overflows the pane (${toolbar.scrollWidth} in ${pane.clientWidth})`,
    ).to.be.greaterThan(pane.clientWidth);

    search.focus();
    await settle(active.window, 4);
    const canvasLeft = active.canvas.getBoundingClientRect().left;
    const areaLeft = area.getBoundingClientRect().left;
    const evidence =
      `pane scrolled ${pane.scrollLeft}, area scrolled ${area.scrollLeft}, ` +
      `canvas left ${canvasLeft} vs area left ${areaLeft}, focus ` +
      `${active.document.activeElement?.className}`;
    expect(pane.scrollLeft, evidence).to.equal(0);
    expect(canvasLeft, evidence).to.equal(areaLeft);
  });
});
