/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const FOLDER_NAME = "Selection fixture folder";
const INSIDE_TITLE = "Selection fixture inside the folder";
const OUTSIDE_TITLE = "Selection fixture outside the folder";

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
 * B30 in the 2026-09-08 review backlog: with a folder open in Zotero,
 * selecting a node whose paper is outside that folder left Zotero's list on
 * whatever it had selected before, so the graph said one paper and the list
 * another. The list must clear instead, since nothing else says the two
 * disagree. Walked through the plugin's own chrome: the graph is opened from
 * Tools › Meristema › New Graph, and the node is selected the way a reader
 * selects it, with a pointer on the plot.
 */
describe("Selecting a node whose paper is outside the open folder", function () {
  let win: any;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  let insideID: number | null = null;
  let outsideID: number | null = null;

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

  function listSelection(): number[] {
    return [...(win.ZoteroPane.itemsView.getSelectedItems(true) as number[])];
  }

  /**
   * Find the node for a paper the way the scope-rail suite does: hovering a
   * node puts its tooltip on the canvas, so the walk moves the pointer over
   * the plot until the tooltip names the title asked for, and hands back
   * that point.
   */
  async function pointOnNode(title: string): Promise<{ x: number; y: number }> {
    const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
    const move = (x: number, y: number): void => {
      canvas.dispatchEvent(
        new win.PointerEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: y,
        }),
      );
    };
    const deadline = Date.now() + 20_000;
    const seen = new Set<string>();
    for (;;) {
      const box = canvas.getBoundingClientRect();
      for (let y = box.top + 4; y < box.bottom - 4; y += 5) {
        for (let x = box.left + 4; x < box.right - 4; x += 5) {
          move(x, y);
          const paper = canvas.title;
          if (!paper) continue;
          seen.add(paper);
          if (paper.includes(title)) return { x, y };
        }
      }
      if (Date.now() > deadline) break;
      await delay(500);
    }
    expect.fail(
      `no node for ${title}; the plot offered ${[...seen].join(" | ") || "nothing"}`,
    );
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = FOLDER_NAME;
    collectionID = await collection.saveTx();
    const inside = new Zotero.Item("journalArticle");
    inside.libraryID = libraryID;
    inside.setField("title", INSIDE_TITLE);
    inside.setField("date", "2020");
    inside.addToCollection(collectionID);
    insideID = await inside.saveTx();
    const outside = new Zotero.Item("journalArticle");
    outside.libraryID = libraryID;
    outside.setField("title", OUTSIDE_TITLE);
    outside.setField("date", "2021");
    outsideID = await outside.saveTx();

    // The test Zotero starts the suites while its own startup check of the
    // test database is still running, and that keeps the pane locked under a
    // progress overlay ("Checking database integrity…") a real pointer cannot
    // cross. No other suite needs the main window's pointer, so none has met
    // it. Give the unlock a moment, as a reader would, and when it does not
    // come — it did not in 45 s on 2026-09-11 — lower the overlay the way
    // Zotero itself does when the check ends. A reader's Zotero is unlocked.
    const unlocked = await Promise.race([
      Zotero.unlockPromise.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!unlocked) Zotero.hideZoteroPaneOverlays();
    const overlay = win.document.getElementById(
      "zotero-pane-overlay",
    ) as HTMLElement | null;
    const overlayDown = await waitFor(
      () => !overlay || win.getComputedStyle(overlay).display === "none",
      10_000,
    );
    expect(overlayDown, "the pane's progress overlay is down").to.equal(true);

    // Zotero shows the folder, with the paper inside it selected: the
    // state the user's walk found the bug in.
    await win.ZoteroPane.collectionsView.selectCollection(collectionID);
    await waitFor(() => win.ZoteroPane.itemsView?.rowCount === 1, 10_000);
    await win.ZoteroPane.itemsView.selectItems([insideID], true);
    expect(listSelection(), "the folder's paper is selected").to.deep.equal([
      insideID,
    ]);

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
    const fit = await waitFor(
      () =>
        graphRoot().querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    expect(fit, "the rail's fit button").to.exist;
    fit!.click();
    await waitFor(() => {
      const canvas = graphRoot().querySelector("canvas");
      return canvas ? canvas.getBoundingClientRect().width > 10 : false;
    }, 10_000);
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    try {
      await win.ZoteroPane.collectionsView.selectLibrary(
        Zotero.Libraries.userLibraryID,
      );
    } catch {
      /* the pane may be mid-refresh; the fixtures go regardless */
    }
    for (const id of [insideID, outsideID]) {
      if (id !== null) await Zotero.Items.erase(id);
    }
    if (collectionID !== null) {
      const collection = Zotero.Collections.get(collectionID) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("clears Zotero's list rather than leaving it on another paper", async function () {
    this.timeout(60_000);
    const before = listSelection();
    expect(before, "the folder's paper is still selected").to.deep.equal([
      insideID,
    ]);

    // The boundary between the plugin and Zotero, watched: what the graph
    // asked the items tree to select, and how many rows the tree found.
    const tree = win.ZoteroPane.itemsView;
    const asked: { ids: number[]; found: number }[] = [];
    const realSelectItems = tree.selectItems;
    tree.selectItems = async function (
      this: unknown,
      ids: number[],
      ...rest: unknown[]
    ) {
      const found: number = await realSelectItems.call(this, ids, ...rest);
      asked.push({ ids: [...ids], found });
      return found;
    };

    try {
      const point = await pointOnNode(OUTSIDE_TITLE);
      // A real pointer, not a constructed PointerEvent: the renderer captures
      // the pointer on the way down, and a synthetic event carries no valid
      // pointer id, so `setPointerCapture` throws before the node is selected.
      const utils = win.windowUtils;
      utils.sendMouseEvent("mousedown", point.x, point.y, 0, 1, 0, false, 0, 0);
      utils.sendMouseEvent("mouseup", point.x, point.y, 0, 1, 0, false, 0, 0);

      const detailTitle = (): string =>
        graphRoot().querySelector(".cm-detail-title")?.textContent ?? "";
      const selectedInGraph = await waitFor(
        () => detailTitle() === OUTSIDE_TITLE,
        5_000,
      );
      const under = win.document.elementFromPoint(
        point.x,
        point.y,
      ) as Element | null;
      expect(
        selectedInGraph,
        `the graph selected the outside paper (detail pane: ${detailTitle()}; ` +
          `under the pointer: ${under?.tagName}#${under?.id})`,
      ).to.equal(true);

      const askedZotero = await waitFor(() => asked.length > 0, 5_000);
      expect(askedZotero, "the graph asked Zotero's list to select").to.equal(
        true,
      );
      expect(asked[0].ids, "for the outside paper").to.deep.equal([outsideID]);
      expect(asked[0].found, "which the open folder does not list").to.equal(0);

      // The tree clears on its own turn; give it a few.
      const cleared = await waitFor(() => listSelection().length === 0, 3_000);
      expect(
        listSelection(),
        `Zotero's list after selecting a paper the open folder does not list ` +
          `(before: ${before.join(",")}, outside paper: ${outsideID})`,
      ).to.deep.equal([]);
      expect(cleared, "cleared within the wait").to.equal(true);
      expect(
        detailTitle(),
        "and the graph keeps the node it selected",
      ).to.equal(OUTSIDE_TITLE);
    } finally {
      tree.selectItems = realSelectItems;
    }
  });
});
