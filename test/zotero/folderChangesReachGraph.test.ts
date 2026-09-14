/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const FOLDER_NAME = "B58 fixture folder";
const RENAMED = "B58 renamed folder";
const DOOMED_NAME = "B58 doomed folder";
const TRASHED_NAME = "B58 trashed folder";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

/** A child of a popup by its l10n ID; the failure lists what was there. */
function customMenu(popup: Element, l10nID: string): any {
  const children = Array.from(popup.children) as HTMLElement[];
  const menu = children.find((child) => child.dataset?.l10nId === l10nID);
  expect(
    menu,
    `menu ${l10nID}; the popup offered ${children
      .map((child) => child.dataset?.l10nId ?? child.id ?? child.localName)
      .join(", ")}`,
  ).to.exist;
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
 * B58: a folder change reaches open graphs, new graphs and a folder graph's
 * tab title, without a restart and without remounting. Driven through the
 * plugin's own menus and read from the rendered DOM, since the test bundle is
 * a second copy of the plugin. The cases run in order and share the fixture:
 * the rename in the first is what the next two read.
 *
 * What only Zotero can answer is printed as `B58 evidence:` lines and carried
 * in the assertion messages: which notifications a folder change fires, and
 * whether a trashed folder is still listed by `getByLibrary`.
 */
describe("Folder changes reach the graph (B58)", function () {
  let win: any;
  let libraryTabID: string | null = null;
  let folderTabID: string | null = null;
  let folderID: number | null = null;
  let doomedID: number | null = null;
  let trashedID: number | null = null;
  let fixtureIDs: number[] = [];
  let notifierID: string | null = null;
  const notifications: string[] = [];

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  function tabTitle(tabID: string | null): string {
    return String(
      (win.Zotero_Tabs._tabs as any[]).find((tab) => tab.id === tabID)?.title ??
        "",
    );
  }

  function rootOf(tabID: string | null): HTMLElement {
    const content = tabID
      ? (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null)
      : null;
    const root = content?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, `the graph in tab ${tabID} is rendered`).to.exist;
    return root as HTMLElement;
  }

  function rowBody(tabID: string | null, id: number): HTMLElement | null {
    return rootOf(tabID).querySelector(
      `.cm-scope-row [data-collection-id="${id}"]`,
    ) as HTMLElement | null;
  }

  function rowLabel(tabID: string | null, id: number): string {
    return (
      rowBody(tabID, id)
        ?.closest(".cm-scope-row")
        ?.querySelector(".cm-scope-row-label")
        ?.textContent?.trim() ?? ""
    );
  }

  function evidence(): string {
    return `notifications [${notifications.join(" | ")}]`;
  }

  async function waitForNewGraphTab(already: Set<string>): Promise<string> {
    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the new graph's tab").to.exist;
    const tabID = tab!.id as string;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        (
          win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
        )?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the new graph's Scope rail").to.exist;
    return tabID;
  }

  async function openLibraryGraph(): Promise<string> {
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
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
    return waitForNewGraphTab(already);
  }

  async function openFolderGraph(id: number): Promise<string> {
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
    await win.ZoteroPane.collectionsView.selectCollection(id);
    const popup = doc.getElementById("zotero-collectionmenu")!;
    expect(popup, "Zotero's collection context menu").to.exist;
    // A right-click runs this before opening the popup, and it is what adds
    // plugin entries (MenuManager.updateMenuPopup); a bare openPopup shows
    // Zotero's own entries only. The target groups plugin entries, so the
    // command is looked for anywhere under the popup, not only as a child.
    await win.ZoteroPane.buildCollectionContextMenu();
    const showing = shown(popup);
    (popup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const l10nID = `${config.addonRef}-collection-new-graph-command`;
    const entry = popup.querySelector(`[data-l10n-id="${l10nID}"]`);
    expect(
      entry,
      `menu ${l10nID}; the popup held ${Array.from(
        popup.querySelectorAll("[data-l10n-id]"),
      )
        .map((node) => (node as Element).getAttribute("data-l10n-id"))
        .join(", ")}`,
    ).to.exist;
    command(entry!);
    (popup as any).hidePopup();
    return waitForNewGraphTab(already);
  }

  before(async function () {
    this.timeout(120_000);
    win = Zotero.getMainWindows()[0];
    notifierID = Zotero.Notifier.registerObserver(
      {
        notify(
          event: string,
          type: string,
          ids: Array<number | string>,
          extraData?: unknown,
        ) {
          notifications.push(
            `${type}:${event}:${ids.join(",")}:${JSON.stringify(extraData ?? null)}`,
          );
        },
      } as any,
      ["item", "collection", "collection-item"],
      "meristema-b58-evidence",
    );
    const libraryID = Zotero.Libraries.userLibraryID;
    const ids: number[] = [];
    for (const name of [FOLDER_NAME, DOOMED_NAME, TRASHED_NAME]) {
      const collection = new Zotero.Collection();
      collection.libraryID = libraryID;
      collection.name = name;
      const id = await collection.saveTx();
      ids.push(id);
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", `${name} paper`);
      item.setField("date", "2022");
      item.addToCollection(id);
      fixtureIDs.push(await item.saveTx());
    }
    [folderID, doomedID, trashedID] = ids;

    folderTabID = await openFolderGraph(folderID!);
    libraryTabID = await openLibraryGraph();
    for (const id of ids) {
      await waitFor(() => rowBody(libraryTabID, id), 10_000);
    }
    notifications.length = 0;
  });

  after(async function () {
    this.timeout(30_000);
    for (const tabID of [libraryTabID, folderTabID]) {
      if (tabID) win.Zotero_Tabs.close(tabID);
    }
    await delay(300);
    // Opening the folder graph left Zotero's collection tree on a fixture
    // folder that is about to be erased. Put it back on the library first, as
    // graphSelectionOutsideFolder does, so the next suite starts from the
    // library rather than from a pane still reselecting after a deletion.
    try {
      await win.ZoteroPane.collectionsView.selectLibrary(
        Zotero.Libraries.userLibraryID,
      );
    } catch {
      /* the pane may be mid-refresh; the fixtures go regardless */
    }
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    for (const id of [folderID, doomedID, trashedID]) {
      if (id === null) continue;
      const collection = Zotero.Collections.get(id) as any;
      if (collection) await collection.eraseTx();
    }
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  });

  it("relabels an open graph's row when its folder is renamed, without remounting", async function () {
    this.timeout(30_000);
    expect(rowLabel(libraryTabID, folderID!)).to.equal(FOLDER_NAME);
    const rootBefore = rootOf(libraryTabID);

    const collection = Zotero.Collections.get(folderID!) as any;
    collection.name = RENAMED;
    await collection.saveTx();
    await waitFor(() => rowLabel(libraryTabID, folderID!) === RENAMED, 5_000);

    console.log(`B58 evidence: rename fired ${evidence()}`);
    expect(
      rowLabel(libraryTabID, folderID!),
      `the open graph's row; ${evidence()}`,
    ).to.equal(RENAMED);
    expect(
      rootOf(libraryTabID) === rootBefore,
      "the graph did not remount",
    ).to.equal(true);
  });

  it("retitles the tab of a graph opened from that folder", async function () {
    this.timeout(15_000);
    const expected = `${RENAMED} Graph`;
    await waitFor(() => tabTitle(folderTabID).startsWith(expected), 5_000);
    expect(
      tabTitle(folderTabID),
      `the folder graph's tab; ${evidence()}`,
    ).to.match(new RegExp(`^${RENAMED} Graph( \\d+)?$`));
    expect(rowLabel(folderTabID, folderID!), "and its own rail row").to.equal(
      RENAMED,
    );
  });

  it("shows the new name in a graph opened after the rename", async function () {
    this.timeout(60_000);
    const tabID = await openLibraryGraph();
    try {
      await waitFor(() => rowBody(tabID, folderID!), 10_000);
      expect(
        rowLabel(tabID, folderID!),
        `a new graph reads the renamed folder; ${evidence()}`,
      ).to.equal(RENAMED);
    } finally {
      win.Zotero_Tabs.close(tabID);
      await delay(300);
    }
  });

  it("drops a deleted folder's row and region without remounting", async function () {
    this.timeout(30_000);
    const body = rowBody(libraryTabID, doomedID!);
    expect(body, "the doomed folder's row").to.exist;
    body!.click();
    await waitFor(
      () =>
        rowBody(libraryTabID, doomedID!)
          ?.closest(".cm-scope-row")
          ?.classList.contains("cm-scope-row-selected"),
      5_000,
    );
    const rootBefore = rootOf(libraryTabID);
    notifications.length = 0;

    await (Zotero.Collections.get(doomedID!) as any).eraseTx();
    await waitFor(() => rowBody(libraryTabID, doomedID!) === null, 5_000);

    const itemNotifications = notifications.filter((line) =>
      line.startsWith("item:"),
    );
    console.log(
      `B58 evidence: delete fired ${evidence()}; item notifications: ${itemNotifications.length}`,
    );
    expect(
      rowBody(libraryTabID, doomedID!),
      `the deleted folder's row is gone; ${evidence()}`,
    ).to.equal(null);
    expect(
      rootOf(libraryTabID).querySelectorAll(".cm-scope-row-selected").length,
      "no row is still drawn as a region",
    ).to.equal(0);
    expect(
      rootOf(libraryTabID) === rootBefore,
      "the graph did not remount",
    ).to.equal(true);
  });

  it("drops a trashed folder's row", async function () {
    this.timeout(30_000);
    notifications.length = 0;
    const collection = Zotero.Collections.get(trashedID!) as any;
    collection.deleted = true;
    await collection.saveTx();
    await waitFor(() => rowBody(libraryTabID, trashedID!) === null, 5_000);

    const listed = (
      (Zotero.Collections as any).getByLibrary(
        Zotero.Libraries.userLibraryID,
        true,
      ) as any[]
    ).some((entry) => Number(entry.id) === trashedID);
    console.log(
      `B58 evidence: trash fired ${evidence()}; getByLibrary lists the trashed folder: ${listed}`,
    );
    expect(
      rowBody(libraryTabID, trashedID!),
      `the trashed folder's row is gone; getByLibrary lists it: ${listed}; ${evidence()}`,
    ).to.equal(null);
  });
});
