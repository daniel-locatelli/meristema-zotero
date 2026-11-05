/// <reference types="mocha" />
import { expect } from "chai";
import { FRAME_FALLBACK_MS } from "../../src/services/frameOrTimer";
import { config } from "../../package.json";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  listOpenGraphTabs,
  putOpenGraphTabs,
  type OpenGraphTabRecord,
} from "../../src/services/openGraphTabStore";
import {
  createSavedGraph,
  deleteSavedGraph,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const SCRATCH_KEY = "meristema-f15-scratch";
const SAVED_KEY = "meristema-f15-saved";
const SAVED_NAME = "F15 saved graph";
const KEPT_KEY = "meristema-b110-kept";
const UNSELECTED_KEY = "meristema-b110-unselected";
const GATED_KEY = "meristema-b113-gated";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

function customMenu(popup: Element, l10nID: string): any {
  const menu = Array.from(popup.children).find(
    (child) => (child as HTMLElement).dataset?.l10nId === l10nID,
  );
  expect(menu, `menu ${l10nID}`).to.exist;
  return menu;
}

function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false> | T | null | undefined,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(100);
  }
}

/**
 * F15: open graph tabs come back after a restart. The suite cannot restart
 * Zotero, so it stands in for one: it writes the records a previous session
 * would have left and asks the plugin's own copy to restore them, as startup
 * does. The test bundle is a second copy of the plugin, so the records are
 * read and written through the profile's database, which both copies share.
 */
describe("Graph tabs after a restart (F15)", function () {
  let win: any;
  let openedTabID: string | null = null;
  let savedGraphID: number | null = null;

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  async function record(key: string): Promise<OpenGraphTabRecord | null> {
    return (
      (await listOpenGraphTabs()).find((entry) => entry.key === key) ?? null
    );
  }

  before(function () {
    win = Zotero.getMainWindows()[0];
  });

  after(async function () {
    this.timeout(20_000);
    for (const id of [
      openedTabID,
      SCRATCH_KEY,
      SAVED_KEY,
      KEPT_KEY,
      UNSELECTED_KEY,
      GATED_KEY,
    ]) {
      try {
        if (id && win.Zotero_Tabs.getTabInfo(id)) win.Zotero_Tabs.close(id);
      } catch {
        // Already closed.
      }
    }
    if (savedGraphID !== null) await deleteSavedGraph(savedGraphID);
    // The plugin drops the closed tabs' records a moment later.
    await waitFor(async () => {
      for (const key of [
        SCRATCH_KEY,
        SAVED_KEY,
        KEPT_KEY,
        UNSELECTED_KEY,
        GATED_KEY,
      ]) {
        if (await record(key)) return false;
      }
      return true;
    }, 5_000);
  });

  it("keeps a record of an open graph tab and drops it when the tab is closed", async function () {
    this.timeout(60_000);
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id));
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    command(
      customMenu(tools.menupopup, `${config.addonRef}-new-graph-view-command`),
    );
    (toolsPopup as any).hidePopup();
    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the graph's tab").to.exist;
    openedTabID = tab.id as string;

    const kept = await waitFor(() => record(openedTabID!), 10_000);
    const keys = (await listOpenGraphTabs()).map((entry) => entry.key);
    expect(kept, `no record for ${openedTabID}; records: ${keys.join(", ")}`).to
      .exist;
    expect(kept!.position, "its place among the tabs").to.equal(
      (win.Zotero_Tabs._tabs as any[]).findIndex(
        (candidate) => candidate.id === openedTabID,
      ),
    );
    expect(kept!.selected, "it is the selected tab").to.equal(true);

    win.Zotero_Tabs.close(openedTabID);
    const dropped = await waitFor(
      async () => !(await record(openedTabID!)) && true,
      10_000,
    );
    expect(dropped, "the closed tab's record is dropped").to.equal(true);
    openedTabID = null;
  });

  /*
   * W22: the first write comes a second after the tab opens, and the view
   * mounts on a frame. A frame later than that wrote no record, since no state
   * exists yet, and nothing wrote again until the graph next changed.
   */
  it("records a tab whose view mounted after the first write", async function () {
    this.timeout(60_000);
    // A write the last case's tab close scheduled must land first.
    await delay(2_000);
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id));
    const realSetTimeout = win.setTimeout;
    const realFrame = win.requestAnimationFrame;
    // The frame helper's fallback and the frame itself, both past the write.
    win.setTimeout = (run: unknown, delayMs?: number, ...rest: unknown[]) =>
      realSetTimeout.call(
        win,
        run,
        delayMs === FRAME_FALLBACK_MS ? 2_500 : delayMs,
        ...rest,
      );
    win.requestAnimationFrame = (run: unknown) =>
      realSetTimeout.call(win, () => realFrame.call(win, run), 2_500);
    try {
      const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
      let showing = shown(toolsPopup);
      (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
      await showing;
      const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
      showing = shown(tools.menupopup);
      tools.openMenu(true);
      await showing;
      command(
        customMenu(
          tools.menupopup,
          `${config.addonRef}-new-graph-view-command`,
        ),
      );
      (toolsPopup as any).hidePopup();
      const tab = await waitFor(
        () => graphTabs().find((candidate) => !already.has(candidate.id)),
        20_000,
      );
      expect(tab, "the graph's tab").to.exist;
      openedTabID = tab.id as string;
      const kept = await waitFor(() => record(openedTabID!), 12_000);
      const keys = (await listOpenGraphTabs()).map((entry) => entry.key);
      expect(kept, `no record for ${openedTabID}; records: ${keys.join(", ")}`)
        .to.exist;
    } finally {
      win.setTimeout = realSetTimeout;
      win.requestAnimationFrame = realFrame;
    }
    win.Zotero_Tabs.close(openedTabID);
    await waitFor(async () => !(await record(openedTabID!)) && true, 10_000);
    openedTabID = null;
  });

  it("brings the tabs back in place, the selected one selected, the fill stopped", async function () {
    this.timeout(60_000);
    // A write the last case's tab close scheduled keeps only the tabs open
    // then, so it must land before these records go in, not after.
    await delay(2_000);
    const libraryID = Zotero.Libraries.userLibraryID;
    const running = { ...emptyGraphViewState(), fillStopped: false };
    const summary = await createSavedGraph(libraryID, SAVED_NAME, running);
    savedGraphID = summary.id;
    const before = (win.Zotero_Tabs._tabs as any[]).length;
    await putOpenGraphTabs([
      {
        key: SCRATCH_KEY,
        libraryID,
        position: 1,
        selected: false,
        savedGraphID: null,
        title: "F15 scratch",
        customTitle: true,
        titleCollectionIDs: null,
        state: { ...running, title: "F15 scratch" },
      },
      {
        key: SAVED_KEY,
        libraryID,
        position: 2,
        selected: true,
        savedGraphID: summary.id,
        title: "an older name",
        customTitle: true,
        titleCollectionIDs: null,
        state: { ...running, title: SAVED_NAME },
      },
    ]);

    // A graph was selected at quit, so Zotero's own restore left the
    // library tab selected (B110).
    win.Zotero_Tabs.select("zotero-pane");
    await (Zotero as any)[config.addonInstance].hooks.onRestoreGraphTabs(win);

    const order = (win.Zotero_Tabs._tabs as any[]).map((tab) => tab.id);
    expect(order.length, `tabs: ${order.join(", ")}`).to.equal(before + 2);
    expect(order[1], "the scratch graph is back at its place").to.equal(
      SCRATCH_KEY,
    );
    expect(order[2], "the saved graph is back at its place").to.equal(
      SAVED_KEY,
    );
    expect(win.Zotero_Tabs.selectedID, "the selected graph").to.equal(
      SAVED_KEY,
    );
    expect(win.Zotero_Tabs.getTabInfo(SCRATCH_KEY).title).to.equal(
      "F15 scratch",
    );
    expect(
      win.Zotero_Tabs.getTabInfo(SAVED_KEY).title,
      "the saved graph takes its row's name",
    ).to.equal(SAVED_NAME);

    // Every tab is up before the last one mounts: the selected graph mounts
    // straight after (B108), and the other is drawn in the background
    // without being selected (B109).
    const canvasOf = (tabID: string): HTMLCanvasElement | null =>
      (
        win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
      )?.querySelector("canvas") ?? null;
    const mounted = (tabID: string): boolean =>
      Boolean(
        (
          win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
        )?.querySelector(".cm-search"),
      ) && Boolean(canvasOf(tabID));
    expect(
      await waitFor(() => mounted(SAVED_KEY), 20_000),
      "the selected graph mounts",
    ).to.equal(true);
    expect(
      await waitFor(() => mounted(SCRATCH_KEY), 20_000),
      "the scratch graph is drawn in the background",
    ).to.equal(true);
    expect(win.Zotero_Tabs.selectedID, "drawn without being selected").to.equal(
      SAVED_KEY,
    );
    // The deck only hides a tab, so the hidden plot is laid out at the size
    // of the shown one.
    const hidden = canvasOf(SCRATCH_KEY)!.getBoundingClientRect();
    const shownRect = canvasOf(SAVED_KEY)!.getBoundingClientRect();
    expect(
      [Math.round(hidden.width), Math.round(hidden.height)],
      "the hidden plot's size",
    ).to.deep.equal([
      Math.round(shownRect.width),
      Math.round(shownRect.height),
    ]);

    win.Zotero_Tabs.select(SCRATCH_KEY);
    const ratio = win.devicePixelRatio ?? 1;
    const fitted = await waitFor(() => {
      const canvas = canvasOf(SCRATCH_KEY);
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return rect.width >= 240 &&
        rect.height >= 180 &&
        Math.abs(canvas.width - Math.round(rect.width * ratio)) <= 1 &&
        Math.abs(canvas.height - Math.round(rect.height * ratio)) <= 1
        ? rect
        : null;
    }, 10_000);
    const canvas = canvasOf(SCRATCH_KEY)!;
    expect(
      fitted,
      `canvas ${canvas.width}x${canvas.height} in ${JSON.stringify(
        canvas.getBoundingClientRect(),
      )} at ratio ${ratio}`,
    ).to.exist;
    // The camera the tab's record keeps once it is shown is a fit's.
    const camera = await waitFor(async () => {
      if (win.Zotero_Tabs.selectedID !== SCRATCH_KEY) return null;
      return (await record(SCRATCH_KEY))?.state?.camera ?? null;
    }, 10_000);
    expect(camera, "the shown scratch graph's camera").to.exist;
    expect(
      Number.isFinite(camera!.x) &&
        Number.isFinite(camera!.y) &&
        camera!.scale >= 0.15 &&
        camera!.scale <= 8,
      `camera ${JSON.stringify(camera)}`,
    ).to.equal(true);
    win.Zotero_Tabs.select(SAVED_KEY);

    // Both views report a stopped fill, and the saved one stays its row's.
    const settled = await waitFor(async () => {
      const scratch = await record(SCRATCH_KEY);
      const saved = await record(SAVED_KEY);
      return scratch?.state?.fillStopped && saved?.state?.fillStopped
        ? { scratch, saved }
        : null;
    }, 10_000);
    const now = await listOpenGraphTabs();
    expect(
      settled,
      `records: ${JSON.stringify(
        now.map((entry) => [entry.key, entry.state?.fillStopped]),
      )}`,
    ).to.exist;
    expect(settled!.saved.savedGraphID).to.equal(summary.id);
  });

  it("leaves a tab chosen before the restore lands selected (B110)", async function () {
    this.timeout(30_000);
    const libraryID = Zotero.Libraries.userLibraryID;
    const stopped = { ...emptyGraphViewState(), fillStopped: true };
    // The reader chose a tab while Zotero was still starting: the graph
    // selected at quit must not take the selection from it.
    win.Zotero_Tabs.select(SCRATCH_KEY);
    await putOpenGraphTabs([
      {
        key: KEPT_KEY,
        libraryID,
        position: 1,
        selected: true,
        savedGraphID: null,
        title: "B110 kept",
        customTitle: true,
        titleCollectionIDs: null,
        state: { ...stopped, title: "B110 kept" },
      },
    ]);
    await (Zotero as any)[config.addonInstance].hooks.onRestoreGraphTabs(win);
    expect(win.Zotero_Tabs.getTabInfo(KEPT_KEY), "the graph is back").to.exist;
    expect(win.Zotero_Tabs.selectedID, "the tab the reader chose").to.equal(
      SCRATCH_KEY,
    );
  });

  it("leaves the library tab selected when it was selected at quit (B110)", async function () {
    this.timeout(30_000);
    const libraryID = Zotero.Libraries.userLibraryID;
    const stopped = { ...emptyGraphViewState(), fillStopped: true };
    win.Zotero_Tabs.select("zotero-pane");
    await putOpenGraphTabs([
      {
        key: UNSELECTED_KEY,
        libraryID,
        position: 1,
        selected: false,
        savedGraphID: null,
        title: "B110 unselected",
        customTitle: true,
        titleCollectionIDs: null,
        state: { ...stopped, title: "B110 unselected" },
      },
    ]);
    await (Zotero as any)[config.addonInstance].hooks.onRestoreGraphTabs(win);
    expect(win.Zotero_Tabs.getTabInfo(UNSELECTED_KEY), "the graph is back").to
      .exist;
    expect(win.Zotero_Tabs.selectedID, "the library tab").to.equal(
      "zotero-pane",
    );
  });

  it("puts a graph tab back before the stores load, and draws it after (B113)", async function () {
    this.timeout(30_000);
    const libraryID = Zotero.Libraries.userLibraryID;
    const stopped = { ...emptyGraphViewState(), fillStopped: true };
    win.Zotero_Tabs.select("zotero-pane");
    await putOpenGraphTabs([
      {
        key: GATED_KEY,
        libraryID,
        position: 1,
        selected: true,
        savedGraphID: null,
        title: "B113 gated",
        customTitle: true,
        titleCollectionIDs: null,
        state: { ...stopped, title: "B113 gated" },
      },
    ]);
    let storesLoaded!: () => void;
    const storesLoading = new Promise<void>((resolve) => {
      storesLoaded = resolve;
    });
    const mounted = (): boolean =>
      Boolean(
        (
          win.Zotero_Tabs.getTabContent(GATED_KEY) as HTMLElement | null
        )?.querySelector("canvas"),
      );
    const restoring = (Zotero as any)[
      config.addonInstance
    ].hooks.onRestoreGraphTabs(win, storesLoading) as Promise<void>;
    try {
      expect(
        await waitFor(() => win.Zotero_Tabs.getTabInfo(GATED_KEY), 5_000),
        "the tab is back while the stores still load",
      ).to.exist;
      await delay(1_000);
      expect(mounted(), "and its graph waits for them").to.equal(false);
    } finally {
      storesLoaded();
    }
    await restoring;
    expect(
      await waitFor(() => mounted(), 20_000),
      "the graph draws once the stores are in",
    ).to.equal(true);
  });
});
