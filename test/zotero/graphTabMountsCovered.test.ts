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
 * A covered window is delivered no animation frames. A new graph tab must
 * still mount there: its first render may not wait on a frame alone. The
 * window's frames are stubbed out for the open; the stub reaches the real
 * plugin because both copies share this window object.
 */
describe("A new graph tab mounts on a covered window", function () {
  let win: any;
  let tabID: string | null = null;

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  let fixtureID: number | null = null;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    // A library with no regular item opens no graph at all.
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Covered window mount paper");
    item.setField("date", "2022");
    fixtureID = await item.saveTx();
  });

  after(async function () {
    this.timeout(10_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (fixtureID !== null) await Zotero.Items.erase(fixtureID);
  });

  it("renders the Scope rail with no animation frames", async function () {
    this.timeout(60_000);
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
    const realRequest = win.requestAnimationFrame;
    const realCancel = win.cancelAnimationFrame;
    let requested = 0;
    win.requestAnimationFrame = () => ++requested;
    win.cancelAnimationFrame = () => undefined;
    try {
      const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
      try {
        let showing = shown(toolsPopup);
        (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
        await showing;
        const tools = customMenu(
          toolsPopup,
          `${config.addonRef}-tools-submenu`,
        );
        showing = shown(tools.menupopup);
        tools.openMenu(true);
        await showing;
        command(
          customMenu(
            tools.menupopup,
            `${config.addonRef}-new-graph-view-command`,
          ),
        );
      } finally {
        (toolsPopup as any).hidePopup();
      }

      const tab = await waitFor(
        () => graphTabs().find((candidate) => !already.has(candidate.id)),
        20_000,
      );
      expect(tab, `the new graph's tab; graph tabs ${graphTabs().length}`).to
        .exist;
      tabID = tab!.id as string;
      win.Zotero_Tabs.select(tabID);
      const content = (): HTMLElement | null =>
        win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null;
      const rail = await waitFor(
        () => content()?.querySelector(".cm-scope-section .cm-scope-count"),
        5_000,
      );
      expect(
        rail,
        `the Scope count with no frames delivered; tab content children ${
          content()?.children.length ?? "none"
        }, root ${Boolean(content()?.querySelector(".meristema-root"))}, ` +
          `visibility ${doc.visibilityState}, frames requested ${requested}`,
      ).to.exist;
    } finally {
      win.requestAnimationFrame = realRequest;
      win.cancelAnimationFrame = realCancel;
    }
  });
});
