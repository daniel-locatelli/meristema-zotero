/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "Stage 2 scope";

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
 * The Scope rail, walked through the plugin's own chrome. The test bundle is a
 * second copy of the plugin, so nothing here reaches into a view: a graph is
 * opened from Tools › Meristema › New Graph and every outcome is read from the
 * rendered DOM. The four cases run in order against that one graph — the seed
 * the first one adds is the seed the second and fourth rely on.
 */
describe("The graph's Scope rail", function () {
  let win: any;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  let fixtureIDs: number[] = [];

  /** The rendered graph in the active tab. There is exactly one. */
  function graphRoot(): HTMLElement {
    const root = win.document.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, "the graph is rendered").to.exist;
    return root as HTMLElement;
  }

  /** The `shown` half of the rail's `{shown} of {total} papers`. */
  function scopeCount(): number {
    const line =
      graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
    return Number(/^([\d,]+) of/.exec(line)?.[1]?.replace(/,/g, "") ?? "0");
  }

  /** The `total` half, which no tick and no search moves. */
  function scopeTotal(): number {
    const line =
      graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
    return Number(
      /of ([\d,]+) papers/.exec(line)?.[1]?.replace(/,/g, "") ?? "0",
    );
  }

  function scopeRowLabelled(name: string): HTMLElement {
    const rows = Array.from(
      graphRoot().querySelectorAll(".cm-scope-row"),
    ) as HTMLElement[];
    const row = rows.find(
      (candidate) =>
        candidate.querySelector(".cm-scope-row-label")?.textContent?.trim() ===
        name,
    );
    expect(row, `a Scope row for ${name}`).to.exist;
    return row as HTMLElement;
  }

  /** How many seed rows the rail lists. */
  function seedRowCount(): number {
    return graphRoot().querySelectorAll(".cm-scope-seed").length;
  }

  function nodeMenuItems(): HTMLButtonElement[] {
    const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
    if (!menu || menu.hidden) return [];
    return (
      Array.from(
        menu.querySelectorAll(".cm-node-menu-item"),
      ) as HTMLButtonElement[]
    ).filter((button) => !button.hidden);
  }

  function closeNodeMenu(): void {
    const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
    if (!menu || menu.hidden) return;
    menu.dispatchEvent(
      new win.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
  }

  /**
   * Right-click a node and hand back one of the menu's entries. The canvas is
   * what carries the context menu, and the menu is ordinary DOM once it is
   * open, so no test-only hook is needed — but which pixel a node landed on is
   * the layout's business. The plot answers that itself: hovering a node puts
   * that paper's tooltip on the canvas, so the search walks the plot with
   * pointer moves, and every point that names a paper it has not tried yet
   * gets a right-click. A seed's menu and a plain paper's differ, so the walk
   * continues until one of them offers the entry asked for.
   */
  async function nodeMenuEntry(label: string): Promise<HTMLButtonElement> {
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
    const tried = new Set<string>();
    const deadline = Date.now() + 20_000;
    for (;;) {
      const box = canvas.getBoundingClientRect();
      for (let y = box.top + 4; y < box.bottom - 4; y += 5) {
        for (let x = box.left + 4; x < box.right - 4; x += 5) {
          move(x, y);
          const paper = canvas.title;
          if (!paper || tried.has(paper)) continue;
          tried.add(paper);
          canvas.dispatchEvent(
            new win.MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
            }),
          );
          const entry = nodeMenuItems().find(
            (button) => button.textContent?.trim() === label,
          );
          if (entry) return entry;
          closeNodeMenu();
        }
      }
      if (Date.now() > deadline) break;
      // The layout may still be settling, and a node the walk missed may have
      // moved under it by the next pass.
      await delay(500);
    }
    expect.fail(
      `no node menu entry reading ${label}; ${tried.size} paper(s) offered ` +
        `${[...tried].join(" | ") || "nothing"}`,
    );
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    collectionID = await collection.saveTx();
    for (const title of ["Scope fixture one", "Scope fixture two"]) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", title);
      item.setField("date", "2020");
      item.addToCollection(collectionID);
      fixtureIDs.push(await item.saveTx());
    }

    const doc = win.document as Document;
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
      () =>
        (win.Zotero_Tabs._tabs as any[]).find(
          (candidate) => candidate.type === config.addonRef,
        ),
      20_000,
    );
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;
    const rail = await waitFor(
      () => doc.querySelector(".cm-scope-section .cm-scope-count"),
      20_000,
    );
    expect(rail, "the rail's Scope section").to.exist;
    // Frame every paper before anything looks for one: the walk below reads
    // the plot, so what the plot draws has to be all of it.
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
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    if (collectionID !== null) {
      const collection = Zotero.Collections.get(collectionID) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("keeps a folder's other papers when one of them becomes a seed", async function () {
    // D1, directly: seeding a paper only ever adds. Before the additive
    // model, this dropped every unconnected paper in the folder.
    this.timeout(30_000);
    const before = scopeCount();
    expect(before, "the library has papers to lose").to.be.at.least(2);
    (await nodeMenuEntry("Add as seed")).click();
    await waitFor(() => seedRowCount() === 1, 10_000);
    expect(seedRowCount(), "the rail lists the seed").to.equal(1);
    expect(scopeCount()).to.be.at.least(before);
    expect(scopeTotal()).to.be.at.least(before);
  });

  it("removes a folder's papers when it is unticked and keeps the seed", async function () {
    // The old focus view as a position rather than a mode: untick the folder
    // and the seed and its neighbours are what is left.
    this.timeout(30_000);
    const before = scopeCount();
    const box = scopeRowLabelled(COLLECTION_NAME).querySelector(
      "input",
    ) as HTMLInputElement;
    box.click();
    await waitFor(() => scopeCount() < before, 5_000);
    expect(scopeCount()).to.be.lessThan(before);
    // No rule can hide a seed, so the seed row and its paper are still there.
    expect(seedRowCount()).to.equal(1);
    (
      scopeRowLabelled(COLLECTION_NAME).querySelector(
        "input",
      ) as HTMLInputElement
    ).click();
    await waitFor(() => scopeCount() === before, 5_000);
    expect(scopeCount()).to.equal(before);
  });

  it("has File and no Seeds button, and opens the panel from the rail", async function () {
    this.timeout(30_000);
    const toolbar = graphRoot().querySelector(
      ".cm-command-actions",
    ) as HTMLElement;
    expect(toolbar.textContent).to.contain("File");
    expect(toolbar.textContent?.toLowerCase()).to.not.contain("seeds");
    const add = graphRoot().querySelector(
      ".cm-scope-add-seed",
    ) as HTMLButtonElement;
    expect(add, "the rail's + Add seed").to.exist;
    add.click();
    await delay(50);
    const popover = graphRoot().querySelector(
      ".cm-focus-seed-popover",
    ) as HTMLElement;
    expect(popover.hidden).to.equal(false);
    // Leave it closed for the case that follows.
    add.click();
    await delay(50);
  });

  it("hides a paper and brings it back with Show all", async function () {
    this.timeout(30_000);
    (await nodeMenuEntry("Remove from graph")).click();
    await waitFor(
      () => graphRoot().querySelector(".cm-scope-hidden") !== null,
      5_000,
    );
    const hidden = graphRoot().querySelector(".cm-scope-hidden");
    expect(hidden?.textContent).to.contain("1 hidden");
    (
      graphRoot().querySelector(".cm-scope-show-all") as HTMLButtonElement
    ).click();
    await waitFor(
      () => graphRoot().querySelector(".cm-scope-hidden") === null,
      5_000,
    );
    expect(graphRoot().querySelector(".cm-scope-hidden")).to.equal(null);
  });
});
