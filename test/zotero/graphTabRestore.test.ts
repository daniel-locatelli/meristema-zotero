/// <reference types="mocha" />
import { expect } from "chai";
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
    for (const id of [openedTabID, SCRATCH_KEY, SAVED_KEY]) {
      try {
        if (id && win.Zotero_Tabs.getTabInfo(id)) win.Zotero_Tabs.close(id);
      } catch {
        // Already closed.
      }
    }
    if (savedGraphID !== null) await deleteSavedGraph(savedGraphID);
    // The plugin drops the closed tabs' records a moment later.
    await waitFor(
      async () =>
        !(await record(SCRATCH_KEY)) && !(await record(SAVED_KEY)) && true,
      5_000,
    );
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
});
