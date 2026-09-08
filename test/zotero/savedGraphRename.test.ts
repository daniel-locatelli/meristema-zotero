/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const ROW_ATTR = "data-meristema-saved-graph";

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

async function waitFor<T>(
  probe: () => T | null | undefined,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

/**
 * B3 in the 2026-09-08 review backlog: renaming a saved graph's tab did not
 * rename the saved graph's row. Everything here goes through the plugin's
 * own copy of the code, the way the user does it: the graph opens from
 * Tools › Meristema › Open Saved Graph, the tab is renamed from the tab
 * context menu's Rename View… entry, and the list is read back.
 */
describe("Renaming a saved graph's tab", function () {
  let libraryID: number;
  let win: any;
  let graphID: number | null = null;
  let itemID: number | null = null;
  let tabID: string | null = null;
  let scratchTabID: string | null = null;
  let scratchGraphID: number | null = null;

  async function renameFromTabMenu(tab: any, name: string): Promise<void> {
    const popup: any = win.Zotero_Tabs._openMenu(10, 10, tab.id);
    await shown(popup);
    await delay(200);
    const entry = Array.from(popup.children).find(
      (c: any) =>
        c.dataset?.l10nId === `${config.addonRef}-rename-view-command`,
    ) as any;
    expect(entry, "the Rename View entry").to.exist;
    expect(entry.hidden, "the entry is visible").to.equal(false);
    // Services.prompt is an XPCOM service whose methods cannot be replaced;
    // the property on Services can be, and is restored afterwards.
    const original = Object.getOwnPropertyDescriptor(Services, "prompt");
    const stub = {
      ...Services.prompt,
      prompt: (
        _win: unknown,
        _title: string,
        _text: string,
        value: { value: string },
      ) => {
        value.value = name;
        return true;
      },
    };
    Object.defineProperty(Services, "prompt", {
      value: stub,
      configurable: true,
      writable: true,
    });
    try {
      command(entry);
      popup.hidePopup();
      // The menu manager runs the command handler asynchronously; the stub
      // must stay in place until the handler has asked for the name.
      await waitFor(() => (tab.title === name ? true : null), 5_000);
      await delay(500);
    } finally {
      if (original) Object.defineProperty(Services, "prompt", original);
      else delete (Services as any).prompt;
    }
  }

  before(async function () {
    this.timeout(30_000);
    libraryID = Zotero.Libraries.userLibraryID;
    win = Zotero.getMainWindows()[0];
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "B3 rename fixture");
    itemID = await item.saveTx();
    const summary = await createSavedGraph(
      libraryID,
      "B3 before",
      emptyGraphViewState(),
    );
    graphID = summary.id;
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    if (scratchTabID) win.Zotero_Tabs.close(scratchTabID);
    await delay(300);
    if (graphID !== null) await deleteSavedGraph(graphID);
    if (scratchGraphID !== null) await deleteSavedGraph(scratchGraphID);
    if (itemID !== null) await Zotero.Items.erase(itemID);
  });

  it("renames the row the Open list shows", async function () {
    this.timeout(40_000);
    const doc = win.document as Document;
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    const open = customMenu(
      tools.menupopup,
      `${config.addonRef}-open-saved-graph-submenu`,
    );
    showing = shown(open.menupopup);
    open.openMenu(true);
    await showing;
    const row = await waitFor(
      () =>
        Array.from(open.menupopup.children).find(
          (child: any) =>
            child.hasAttribute(ROW_ATTR) &&
            child.getAttribute("label") === "B3 before",
        ),
      3_000,
    );
    expect(row, "the saved graph's row").to.exist;
    command(row as Element);
    (toolsPopup as any).hidePopup();

    const tab = await waitFor(
      () =>
        (win.Zotero_Tabs._tabs as any[]).find(
          (t) => t.type === config.addonRef && t.title === "B3 before",
        ),
      10_000,
    );
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;

    await renameFromTabMenu(tab!, "B3 after");

    const names = (await listSavedGraphs(libraryID)).map((g) => g.name);
    expect(names).to.include("B3 after");
    expect(names).to.not.include("B3 before");
    expect(tab!.title).to.equal("B3 after");
  });

  it("saves a scratch view under the name its tab is given", async function () {
    this.timeout(40_000);
    const doc = win.document as Document;
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    const before = new Set(
      (win.Zotero_Tabs._tabs as any[]).map((t) => String(t.id)),
    );
    command(
      customMenu(tools.menupopup, `${config.addonRef}-new-graph-view-command`),
    );
    (toolsPopup as any).hidePopup();
    const tab = await waitFor(
      () =>
        (win.Zotero_Tabs._tabs as any[]).find(
          (t) => t.type === config.addonRef && !before.has(String(t.id)),
        ),
      10_000,
    );
    expect(tab, "the new graph's tab").to.exist;
    scratchTabID = tab!.id;

    await renameFromTabMenu(tab!, "B3 named scratch");

    const rows = await listSavedGraphs(libraryID);
    const created = rows.find((g) => g.name === "B3 named scratch");
    scratchGraphID = created?.id ?? null;
    expect(created, "a saved graph named after the tab").to.exist;
    expect(tab!.title).to.equal("B3 named scratch");
  });
});
