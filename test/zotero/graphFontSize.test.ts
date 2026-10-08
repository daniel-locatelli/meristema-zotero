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
 * B93: View › Font Size writes `extensions.zotero.fontSize`, and Zotero
 * writes it onto its registered roots. The graph tab sits outside them, so
 * it registers its own: its chrome text and its canvas text follow the pref.
 */
describe("Zotero's View › Font Size reaches the graph", function () {
  let win: any;
  let tabID: string | null = null;
  let original = "1.00";
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

  function canvas(): HTMLCanvasElement {
    const found = graphRoot().querySelector("canvas") as HTMLCanvasElement;
    expect(found, "the plot canvas").to.exist;
    return found;
  }

  function rootState(): string {
    const root = graphRoot();
    const style = win.getComputedStyle(root);
    const docRoot = win.getComputedStyle(root.ownerDocument.documentElement);
    return (
      `inline=${root.getAttribute("style")?.slice(0, 160)} ` +
      `computed=${style.fontSize} unit=${style.getPropertyValue("--cm-font-unit")} ` +
      `zfs=${style.getPropertyValue("--zotero-font-size")} rem=${docRoot.fontSize} ` +
      `pref=${String(Zotero.Prefs.get("fontSize"))}`
    );
  }

  function fontPx(selector: string): number {
    const found = graphRoot().querySelector(selector) as HTMLElement | null;
    expect(found, selector).to.exist;
    return parseFloat(win.getComputedStyle(found).fontSize);
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    original = String(Zotero.Prefs.get("fontSize") ?? "1.00");
    Zotero.Prefs.set("fontSize", "1.00");
    // Run alone, the library is empty and the graph declines to open.
    const paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title", "Font size probe");
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
    expect(styled, `graph.css applies (${rootState()})`).to.equal(true);
  });

  after(async function () {
    this.timeout(30_000);
    Zotero.Prefs.set("fontSize", original);
    await delay(300);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (paperID) await Zotero.Items.erase(paperID);
  });

  it("scales the chrome's text and the canvas text with the pref", async function () {
    this.timeout(60_000);
    const plot = canvas();
    const view = plot.ownerDocument.defaultView as any;
    const ratio = view.devicePixelRatio || 1;

    // The boundary watched: the size of every run of text the plot draws.
    const sizes: number[] = [];
    const proto = view.CanvasRenderingContext2D.prototype;
    const realFillText = proto.fillText;
    proto.fillText = function (
      this: CanvasRenderingContext2D,
      ...args: [string, number, number, number?]
    ) {
      if (this.canvas === plot) {
        const px = /([\d.]+)px/.exec(this.font);
        if (px) sizes.push(parseFloat(px[1]) / ratio);
      }
      return realFillText.apply(this, args);
    };

    try {
      const count = ".cm-scope-section .cm-scope-count";
      const smallChrome = fontPx(count);
      const smallRoot = rootState();
      const smallCanvas = Math.max(0, ...sizes);
      sizes.length = 0;

      Zotero.Prefs.set("fontSize", "1.54");
      await delay(800);
      const bigChrome = fontPx(count);
      const bigRoot = rootState();
      const bigCanvas = Math.max(0, ...sizes);
      const rootSize = graphRoot().style.getPropertyValue("--zotero-font-size");

      const evidence =
        `chrome ${smallChrome}px → ${bigChrome}px; ` +
        `canvas max ${smallCanvas}px → ${bigCanvas}px; ` +
        `root --zotero-font-size=${rootSize}; ratio ${ratio}; ` +
        `root at 1.00 ${smallRoot}; at 1.54 ${bigRoot}`;

      expect(
        smallChrome,
        `the default size is unchanged (${evidence})`,
      ).to.equal(12);
      expect(rootSize, `the root is registered (${evidence})`).to.equal(
        "1.54rem",
      );
      expect(
        bigChrome / smallChrome,
        `the chrome's text scales (${evidence})`,
      ).to.be.closeTo(1.54, 0.05);
      expect(
        bigCanvas,
        `the plot drew text after the change (${evidence})`,
      ).to.be.above(0);
      expect(
        bigCanvas,
        `the plot's text is larger than any it drew at 1.00 (${evidence})`,
      ).to.be.above(Math.max(smallCanvas, 12) * 1.3);
    } finally {
      proto.fillText = realFillText;
    }
  });
});
