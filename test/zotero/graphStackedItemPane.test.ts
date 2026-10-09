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
 * B90: below ~950px Zotero stacks its item pane under the items list, where it
 * spans the window. The graph's Paper details pane follows the item pane's
 * width, and took that stacked width as a side pane's, squeezing the plot out.
 */
describe("Paper details while Zotero is stacked", function () {
  let win: any;
  let tabID: string | null = null;
  let paperID: number | null = null;
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

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    // Run alone, the library is empty and the graph declines to open.
    const paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title", "Stacked pane probe");
    paper.setField("date", "2020");
    paperID = (await paper.saveTx()) as number;

    const unlocked = await Promise.race([
      Zotero.unlockPromise.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!unlocked) Zotero.hideZoteroPaneOverlays();
    const overlay = win.document.getElementById(
      "zotero-pane-overlay",
    ) as HTMLElement | null;
    await waitFor(
      () => !overlay || win.getComputedStyle(overlay).display === "none",
      10_000,
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
    const errors = ((Zotero as any).getErrors?.(true) ?? []) as string[];
    expect(
      tab,
      `the graph's tab; tabs ${JSON.stringify(
        (win.Zotero_Tabs._tabs as any[]).map((t) => `${t.id}:${t.type}`),
      )}; errors ${errors.slice(-6).join(" || ")}`,
    ).to.exist;
    tabID = tab!.id;
    win.Zotero_Tabs.select(tabID);
    await waitFor(
      () => tabContent()?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    await waitFor(() => {
      const found = graphRoot().querySelector("canvas");
      return found ? found.getBoundingClientRect().width > 10 : false;
    }, 10_000);
    await delay(1000);
    // graph.css is a <link>, so it can land after the first layout; until it
    // does, the rail inherits the root's bare 13px.
    const styled = await waitFor(
      () =>
        win
          .getComputedStyle(graphRoot())
          .getPropertyValue("--cm-font-unit")
          .trim() !== "",
      10_000,
    );
    expect(styled).to.equal(true);
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (paperID) await Zotero.Items.erase(paperID);
  });

  it("keeps Paper details a side pane while Zotero stacks its item pane", async function () {
    this.timeout(60_000);
    const doc = win.document as Document;
    const width = (el: Element | null | undefined): number =>
      el ? Math.round(el.getBoundingClientRect().width) : -1;
    const detail = (): number =>
      width(graphRoot().querySelector(".cm-detail-shell"));
    const evidence = (): string =>
      `window ${win.innerWidth}; rail ${width(graphRoot().querySelector(".cm-key-rail"))}, ` +
      `plot ${width(graphRoot().querySelector(".cm-plot-pane"))}, detail ${detail()}; ` +
      `Zotero item pane ${width(doc.getElementById("zotero-item-pane"))} ` +
      `(width attr ${doc.getElementById("zotero-item-pane")?.getAttribute("width")})`;
    const before = detail();
    const startW = win.outerWidth;
    const startH = win.outerHeight;
    try {
      win.resizeTo(750, startH);
      // Zotero lays the library out again only while its tab is showing.
      win.Zotero_Tabs.select("zotero-pane");
      const stacked = await waitFor(
        () =>
          doc
            .getElementById("zotero-layout-switcher")
            ?.getAttribute("orient") === "vertical",
        5_000,
      );
      expect(stacked, `Zotero stacks its panes (${evidence()})`).to.equal(true);
      win.Zotero_Tabs.select(tabID);
      await delay(500);
      expect(
        detail(),
        `Paper details keeps its side width, ${before}px before (${evidence()})`,
      ).to.be.at.most(before);
    } finally {
      win.resizeTo(startW, startH);
      await delay(500);
    }
  });
});
