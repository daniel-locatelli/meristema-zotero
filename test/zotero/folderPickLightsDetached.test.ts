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

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const FOLDER_NAME = "F12 picked folder";

/**
 * F12: a folder picked in Zotero's collection tree lights its region in a
 * detached graph window. The graph is opened as a tab and moved to its own
 * window with Zotero's tab menu, as a reader would; the pick is made in the
 * main window's tree, and the outcome read from the detached window's Scope
 * rail, where a lit folder's row carries `cm-scope-row-selected`.
 */
describe("A folder picked in Zotero lights its region in a detached graph (F12)", function () {
  let win: any;
  let popup: Window | null = null;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  let itemID: number | null = null;

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    const collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = FOLDER_NAME;
    collectionID = (await collection.saveTx()) as number;
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "F12 folder paper");
    item.setField("date", "2019");
    item.addToCollection(collectionID);
    itemID = (await item.saveTx()) as number;
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );

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
    tabID = tab!.id as string;
    win.Zotero_Tabs.select(tabID);
    const rendered = await waitFor(
      () =>
        (
          win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
        )?.querySelector(".meristema-root"),
      30_000,
    );
    expect(rendered, "the graph rendered in its tab").to.exist;
    const windowType = `${config.addonRef}:window`;
    const graphWindows = (): Window[] =>
      Array.from(Services.wm.getEnumerator(windowType) as any) as Window[];
    const windowsBefore = new Set(graphWindows());
    const popupset = doc.querySelector("popupset") as Element;
    const popupsBefore = new Set(Array.from(popupset.children));
    win.Zotero_Tabs._openMenu(0, 0, tabID);
    const menu = Array.from(popupset.children).find(
      (child) => !popupsBefore.has(child),
    ) as any;
    expect(menu, "the tab's context menu").to.exist;
    const moveLabel = Zotero.getString("tabs.moveToWindow");
    const moveItem = Array.from(menu.querySelectorAll("menuitem")).find(
      (entry: any) => entry.getAttribute("label") === moveLabel,
    ) as Element | undefined;
    expect(moveItem, `the tab menu's "${moveLabel}"`).to.exist;
    command(moveItem!);
    menu.hidePopup?.();
    popup = await waitFor(
      () => graphWindows().find((candidate) => !windowsBefore.has(candidate)),
      20_000,
    );
    expect(popup, "the graph's detached window").to.exist;
    const row = await waitFor(() => folderRow(), 20_000);
    expect(row, "the detached Scope rail lists the fixture folder").to.exist;
  });

  after(async function () {
    this.timeout(30_000);
    if (popup && !popup.closed) popup.close();
    await delay(300);
    try {
      await win.ZoteroPane.collectionsView.selectLibrary(
        Zotero.Libraries.userLibraryID,
      );
    } catch {
      /* the pane may be mid-refresh; the fixtures go regardless */
    }
    if (itemID !== null) await Zotero.Items.erase(itemID);
    if (collectionID !== null) await Zotero.Collections.erase(collectionID);
  });

  function folderRow(): HTMLElement | null {
    const root = popup?.document.querySelector(
      "#meristema-window-root .meristema-root",
    );
    return (
      (
        Array.from(
          root?.querySelectorAll(".cm-scope-row") ?? [],
        ) as HTMLElement[]
      ).find((row) => normalize(row.textContent).startsWith(FOLDER_NAME)) ??
      null
    );
  }

  it("lights the folder's region when the reader picks it in the tree", async function () {
    this.timeout(30_000);
    expect(
      folderRow()?.classList.contains("cm-scope-row-selected"),
      "the folder's region is off before the pick",
    ).to.equal(false);
    await win.ZoteroPane.collectionsView.selectCollection(collectionID);
    const lit = await waitFor(
      () => folderRow()?.classList.contains("cm-scope-row-selected"),
      10_000,
    );
    expect(
      lit,
      `the folder's region lit; the row reads "${normalize(folderRow()?.textContent)}"`,
    ).to.equal(true);
    // A second pick of the library and back keeps it lit: picking adds.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await win.ZoteroPane.collectionsView.selectCollection(collectionID);
    await delay(500);
    expect(
      folderRow()?.classList.contains("cm-scope-row-selected"),
      "picking it again leaves it lit",
    ).to.equal(true);
  });
});
