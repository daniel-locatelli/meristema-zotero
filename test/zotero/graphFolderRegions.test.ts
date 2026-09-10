/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "Region fixture one";
const SIBLING_NAME = "Region fixture two";

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
 * Selecting a folder's row now draws it as a region on the plot (Task 8/9);
 * this walks that through the plugin's own chrome rather than the model, per
 * the repo's rule that a UI-path test goes through the interface, not an
 * imported service. Two sibling folders are needed because the case compares
 * two regions against each other, and neither is nested under the other so
 * ticking one never cascades onto the other.
 */
describe("The graph's folder regions", function () {
  let win: any;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  let siblingID: number | null = null;
  let fixtureIDs: number[] = [];

  function graphRoot(): HTMLElement {
    const root = tabContent()?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, "the graph is rendered").to.exist;
    return root as HTMLElement;
  }

  function tabContent(): HTMLElement | null {
    if (!tabID) return null;
    return (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement) ?? null;
  }

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  /** The row body a click selects, found by the ID the row was built for. */
  function scopeRowBody(id: number): HTMLButtonElement {
    const body = graphRoot().querySelector(
      `.cm-scope-row [data-collection-id="${id}"]`,
    ) as HTMLButtonElement | null;
    expect(body, `a Scope row body for collection ${id}`).to.exist;
    return body as HTMLButtonElement;
  }

  /** Whether that folder's row currently carries the selected-region class. */
  function isSelected(id: number): boolean {
    return (
      scopeRowBody(id).parentElement?.classList.contains(
        "cm-scope-row-selected",
      ) ?? false
    );
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    for (const name of [COLLECTION_NAME, SIBLING_NAME]) {
      const collection = new Zotero.Collection();
      collection.libraryID = libraryID;
      collection.name = name;
      const id = await collection.saveTx();
      if (name === COLLECTION_NAME) collectionID = id;
      else siblingID = id;
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", `${name} paper`);
      item.setField("date", "2020");
      item.addToCollection(id);
      fixtureIDs.push(await item.saveTx());
    }

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
    tabID = tab!.id;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () => tabContent()?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the rail's Scope section").to.exist;
    await waitFor(
      () => graphRoot().querySelector(`[data-collection-id="${siblingID}"]`),
      10_000,
    );
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    for (const id of [collectionID, siblingID]) {
      if (id === null) continue;
      const collection = Zotero.Collections.get(id) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("draws a region for each selected folder, and clears it when unticked", async function () {
    this.timeout(30_000);
    expect(isSelected(collectionID!)).to.equal(false);
    expect(isSelected(siblingID!)).to.equal(false);

    scopeRowBody(collectionID!).click();
    await waitFor(() => isSelected(collectionID!), 5_000);
    expect(isSelected(collectionID!)).to.equal(true);
    expect(isSelected(siblingID!)).to.equal(false);

    scopeRowBody(siblingID!).click();
    await waitFor(() => isSelected(siblingID!), 5_000);
    expect(isSelected(collectionID!)).to.equal(true);
    expect(isSelected(siblingID!)).to.equal(true);

    const box = scopeRowBody(collectionID!).parentElement?.querySelector(
      ".cm-scope-check",
    ) as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new win.Event("change"));
    await waitFor(() => !isSelected(collectionID!), 5_000);
    expect(isSelected(collectionID!)).to.equal(false);
    expect(isSelected(siblingID!)).to.equal(true);
  });

  /**
   * B28. The case above reads the rail's class and nothing else, so it passed
   * while the plot underneath it was blank. `draw()` catches, logs once and
   * latches `canvasError`, after which every later frame returns immediately —
   * so a single throw in the region path leaves the canvas on its flat panel
   * fill for the rest of the renderer's life, with no axes and no nodes.
   * Zotero.logError is stubbed to capture what actually threw.
   */
  it("keeps drawing the plot once a folder is selected", async function () {
    this.timeout(30_000);
    const canvas = graphRoot().querySelector(
      "canvas.cm-graph-canvas",
    ) as HTMLCanvasElement;
    expect(canvas, "the plot canvas").to.exist;

    const logged: string[] = [];
    const original = (Zotero as any).logError;
    (Zotero as any).logError = (...args: any[]) => {
      const error = args[0];
      logged.push(`${error?.message ?? String(error)} ${error?.stack ?? ""}`);
      return original.apply(Zotero, args);
    };

    const painted = (): number => {
      const context = canvas.getContext("2d")!;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
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
    };

    try {
      const before = painted();
      scopeRowBody(siblingID!).click();
      await waitFor(() => isSelected(siblingID!), 5_000);
      await delay(400);
      const after = painted();
      console.log(
        `B28 tab: before=${before} after=${after} logged=${JSON.stringify(logged)}`,
      );
      expect(logged, `the renderer logged: ${logged.join(" ;; ")}`).to.be.empty;
      expect(after, "the plot still has something on it").to.be.greaterThan(50);
    } finally {
      (Zotero as any).logError = original;
    }
  });
});
