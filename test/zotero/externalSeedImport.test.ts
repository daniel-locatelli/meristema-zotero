/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { importExternalWork } from "../../src/services/externalDiscoveryService";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createSavedGraph,
  deleteSavedGraph,
  loadSavedGraph,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const ROW_ATTR = "data-meristema-saved-graph";
const GRAPH_NAME = "B6 external seed";
const TITLE = "B6 external seed fixture";

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

function buttonNamed(root: Element, label: string): HTMLButtonElement | null {
  return (
    (Array.from(root.querySelectorAll("button")) as HTMLButtonElement[]).find(
      (button) => button.textContent?.trim() === label && !button.hidden,
    ) ?? null
  );
}

/**
 * B6 in the 2026-09-08 review backlog: seed a paper that is not in Zotero,
 * press Add to Zotero from its detail pane; the import fails or the seed
 * stays external. The test bundle is a second copy of the plugin, so nothing
 * here reaches into the view: a saved graph carrying one external seed is
 * opened from Tools › Meristema › Open Saved Graph, the pane's own buttons
 * are pressed, and the outcome is read from the library and from the
 * graph's autosaved state.
 */
describe("Adding an external seed to Zotero", function () {
  let win: any;
  let tabID: string | null = null;
  let graphID: number | null = null;
  let fixtureID: number | null = null;
  let importedIDs: number[] = [];
  const logged: string[] = [];
  let originalLogError: typeof Zotero.logError;

  before(async function () {
    this.timeout(30_000);
    win = Zotero.getMainWindows()[0];
    originalLogError = Zotero.logError;
    Zotero.logError = ((error: unknown) => {
      logged.push(String((error as any)?.message ?? error));
      originalLogError.call(Zotero, error as any);
    }) as typeof Zotero.logError;
    // A graph opens on a library; the suite may reach this test with an
    // empty one, so give it a paper to stand on.
    const fixture = new Zotero.Item("journalArticle");
    fixture.setField("title", "B6 library fixture");
    fixtureID = await fixture.saveTx();
    const work = {
      provider: "openalex" as const,
      providerWorkID: "W-b6-fixture",
      doi: null,
      title: TITLE,
      year: 2021,
      authors: ["Ada Lovelace", "Charles Babbage"],
    };
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      GRAPH_NAME,
      {
        ...emptyGraphViewState(),
        seeds: [
          { kind: "external", identityKey: "openalex:W-b6-fixture", work },
        ],
      },
    );
    graphID = summary.id;
  });

  after(async function () {
    this.timeout(30_000);
    Zotero.logError = originalLogError;
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (graphID !== null) await deleteSavedGraph(graphID);
    const search = new Zotero.Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.addCondition("title", "is", TITLE);
    const found = (await search.search()) as number[];
    for (const id of new Set([...importedIDs, ...found])) {
      await Zotero.Items.erase(id);
    }
    if (fixtureID !== null) await Zotero.Items.erase(fixtureID);
  });

  it("the import service alone creates a manual item", async function () {
    this.timeout(30_000);
    const items = await importExternalWork(
      {
        provider: "openalex",
        providerWorkID: "W-b6-direct",
        doi: null,
        title: "B6 direct import fixture",
        year: 2021,
        authors: ["Ada Lovelace"],
      } as any,
      Zotero.Libraries.userLibraryID,
      [],
    );
    expect(items.length).to.equal(1);
    importedIDs.push(items[0]!.id);
    expect(items[0]!.getField("title")).to.equal("B6 direct import fixture");
  });

  it("imports the item and the seed turns local", async function () {
    this.timeout(90_000);
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
            child.getAttribute("label") === GRAPH_NAME,
        ),
      3_000,
    );
    expect(row, "the saved graph's row").to.exist;
    command(row as Element);
    (toolsPopup as any).hidePopup();

    const tab = await waitFor(
      () =>
        (win.Zotero_Tabs._tabs as any[]).find(
          (t) => t.type === config.addonRef && t.title === GRAPH_NAME,
        ),
      20_000,
    );
    expect(tab, `the graph's tab (logged: ${logged.join(" | ")})`).to.exist;
    tabID = tab!.id;

    const root = await waitFor(
      () => doc.querySelector(".meristema-root"),
      20_000,
    );
    expect(root, "the graph view mounted").to.exist;
    // Opening a saved graph selects its seed, so the pane shows the paper.
    const add = await waitFor(
      () => buttonNamed(root!, "Add to Zotero"),
      20_000,
    );
    expect(
      add,
      `the detail pane offers Add to Zotero (logged: ${logged.join(" | ")})`,
    ).to.exist;
    add!.click();
    const confirm = await waitFor(() => buttonNamed(root!, "Add paper"), 5_000);
    expect(confirm, "the collection chooser offers Add paper").to.exist;
    confirm!.click();

    // The new item's citation update rebuilds the tab while the import is
    // still running, so the pane's own confirmation is not what to wait for.
    // What must hold: the item is in the library, no error was logged, the
    // graph's recipe now names the item, and the pane no longer offers the
    // import.
    const savedKinds = async (): Promise<string[]> =>
      (await loadSavedGraph(graphID!))?.state.seeds.map((seed) => seed.kind) ??
      [];
    const deadline = Date.now() + 20_000;
    let kinds = await savedKinds();
    while (!kinds.includes("item") && !logged.length && Date.now() < deadline) {
      await delay(250);
      kinds = await savedKinds();
    }
    expect(logged, "no error was logged during the import").to.deep.equal([]);
    const search = new Zotero.Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.addCondition("title", "is", TITLE);
    importedIDs = (await search.search()) as number[];
    expect(importedIDs.length, "one item was imported").to.equal(1);
    expect(kinds, "the imported seed turns local").to.deep.equal(["item"]);
    const pane = await waitFor(
      () => doc.querySelector(".meristema-root"),
      5_000,
    );
    expect(pane, "the view is still mounted").to.exist;
    expect(
      buttonNamed(pane!, "Add to Zotero"),
      "the pane no longer offers the import",
    ).to.equal(null);
  });
});
