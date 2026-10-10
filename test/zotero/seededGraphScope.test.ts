/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "F7 seeded scope";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
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
 * F7: a graph started from selected papers opens on those papers. The graph is
 * opened the reader's way, from the item context menu's "New Graph from this
 * paper", because the test bundle is a second copy of the plugin and every
 * outcome is read from the rendered rail.
 */
describe("A graph started from selected papers", function () {
  let win: any;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  let fixtureIDs: number[] = [];

  function tabContent(): HTMLElement | null {
    if (!tabID) return null;
    return (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement) ?? null;
  }

  function graphRoot(): HTMLElement {
    const root = tabContent()?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, "the graph is rendered").to.exist;
    return root as HTMLElement;
  }

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  function scopeLine(): string {
    return graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
  }

  /**
   * The `shown` half of the rail's `{shown} of {total} papers`. Only read
   * when it should be 1, so the de-CH digit grouping never enters; anything
   * larger reads as NaN and the assertion prints the line.
   */
  function scopeCount(): number {
    return Number(/^(\d+) of/.exec(scopeLine())?.[1] ?? NaN);
  }

  function rowBox(name: string): HTMLInputElement {
    const rows = Array.from(
      graphRoot().querySelectorAll(".cm-scope-row"),
    ) as HTMLElement[];
    const row = rows.find(
      (candidate) =>
        candidate.querySelector(".cm-scope-row-label")?.textContent?.trim() ===
        name,
    );
    expect(row, `a Scope row for ${name}`).to.exist;
    const box = row!.querySelector(".cm-scope-check") as HTMLInputElement;
    expect(box, `${name}'s checkbox`).to.exist;
    return box;
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    collectionID = await collection.saveTx();
    for (const [title, filed] of [
      ["F7 seed", true],
      ["F7 folder sibling", true],
      ["F7 unfiled paper", false],
    ] as const) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", title);
      item.setField("date", "2020");
      if (filed) item.addToCollection(collectionID);
      fixtureIDs.push(await item.saveTx());
    }
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    if (collectionID !== null) {
      const collection = Zotero.Collections.get(collectionID) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("opens with no folder ticked, Unfiled off, and only its seed shown (F7)", async function () {
    this.timeout(60_000);
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await win.ZoteroPane.itemsView.selectItems([fixtureIDs[0]], true);

    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id));
    const itemMenu = doc.getElementById("zotero-itemmenu")!;
    // Plugin entries are built into the menu only by Zotero's own builder.
    await win.ZoteroPane.buildItemContextMenu();
    const showing = shown(itemMenu);
    (itemMenu as any).openPopup(null, "after_start", 0, 0, true, false);
    await showing;
    const entry = Array.from(itemMenu.children).find(
      (child) =>
        (child as HTMLElement).dataset?.l10nId ===
        `${config.addonRef}-open-focus-view-new-tab-command`,
    );
    expect(entry, "the item menu's New Graph entry").to.exist;
    command(entry!);
    (itemMenu as any).hidePopup();

    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;
    win.Zotero_Tabs.select(tabID);
    const seeded = await waitFor(
      () =>
        tabContent()?.querySelectorAll(".cm-scope-seed").length === 1 &&
        tabContent()?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(seeded, "the rail lists the one seed").to.exist;

    expect(
      rowBox(COLLECTION_NAME).checked,
      "the seed's own folder is not ticked",
    ).to.equal(false);
    expect(rowBox("Unfiled").checked, "Unfiled is off").to.equal(false);
    expect(
      scopeCount(),
      `only the seed is shown, not its folder sibling or the unfiled paper; ` +
        `rail reads "${scopeLine()}"`,
    ).to.equal(1);
  });
});
