/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

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
  probe: () => T | null | undefined | false,
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
 * B7: New Graph on a library with no regular items used to open nothing and
 * say nothing. A graph is a recipe that may start with no library items, so
 * the tab opens on the view's empty state. Every suite erases its fixtures,
 * so the user library is empty here; the first assertion proves it.
 */
describe("New Graph on an empty library (B7)", function () {
  let win: any;
  let tabID: string | null = null;

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  before(function () {
    win = Zotero.getMainWindows()[0];
  });

  after(function () {
    if (tabID) win.Zotero_Tabs.close(tabID);
  });

  it("opens the graph on its empty state", async function () {
    this.timeout(60_000);
    const libraryID = Zotero.Libraries.userLibraryID;
    win.ZoteroPane.collectionsView.selectLibrary(libraryID);
    const regular = (await Zotero.Items.getAll(libraryID, true)).filter(
      (item: Zotero.Item) => item.isRegularItem(),
    );
    expect(
      regular.map((item: Zotero.Item) => item.getField("title")),
      "the user library holds no regular items",
    ).to.deep.equal([]);

    const logged: string[] = [];
    const logError = Zotero.logError;
    (Zotero as any).logError = (error: any) => {
      logged.push(String(error?.stack ?? error));
      return logError.call(Zotero, error);
    };
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
    (Zotero as any).logError = logError;
    expect(tab, `New Graph opened a tab; logged: ${logged.join(" ## ")}`).to
      .exist;
    tabID = tab!.id;
    win.Zotero_Tabs.select(tabID);
    const emptyState = await waitFor(() => {
      const node = (
        win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
      )?.querySelector(".cm-empty-state") as HTMLElement | null;
      return node && !node.hidden ? node : null;
    }, 30_000);
    expect(emptyState, "the graph shows its empty state").to.exist;
    expect(
      emptyState!.querySelector(".cm-empty-state-title")?.textContent,
    ).to.equal("This graph is empty");
  });
});
