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

/**
 * B20: File › New Graph in a detached graph window opened its tab in the main
 * window without bringing that window forward, so nothing seemed to happen.
 * The main window's `focus` is wrapped to count calls: whether the OS hands a
 * test run the foreground is not something a case can rely on.
 */
describe("New Graph from a detached window (B20)", function () {
  let win: any;
  let popup: Window | null = null;
  const openedTabIDs: string[] = [];
  let focusCalls = 0;
  let focusWrapped = false;

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
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
    const tabID = tab!.id as string;
    openedTabIDs.push(tabID);
    win.Zotero_Tabs.select(tabID);
    const rendered = await waitFor(
      () =>
        (
          win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null
        )?.querySelector(".meristema-root"),
      30_000,
    );
    expect(rendered, "the graph rendered in its tab").to.exist;

    // Zotero's own tab menu moves the tab, as a reader would.
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
      (item: any) => item.getAttribute("label") === moveLabel,
    ) as Element | undefined;
    expect(moveItem, `the tab menu's "${moveLabel}"`).to.exist;
    command(moveItem!);
    menu.hidePopup?.();
    popup = await waitFor(
      () => graphWindows().find((candidate) => !windowsBefore.has(candidate)),
      20_000,
    );
    expect(popup, "the graph's detached window").to.exist;
    const detachedRoot = await waitFor(
      () =>
        popup!.document.querySelector("#meristema-window-root .meristema-root"),
      20_000,
    );
    expect(detachedRoot, "the detached window rendered the graph").to.exist;
  });

  after(async function () {
    this.timeout(15_000);
    if (focusWrapped) {
      delete win.focus;
      focusWrapped = false;
    }
    if (popup && !popup.closed) popup.close();
    for (const id of openedTabIDs) {
      if (win.Zotero_Tabs.getTabInfo(id)) win.Zotero_Tabs.close(id);
    }
  });

  it("brings the main window forward on the new graph's tab", async function () {
    this.timeout(40_000);
    const root = (): Element =>
      popup!.document.querySelector(
        "#meristema-window-root .meristema-root",
      ) as Element;
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          root().querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the detached toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    const newGraph = await waitFor(() => {
      const menu = root().querySelector(".cm-graph-menu") as HTMLElement | null;
      if (!menu || menu.hidden) {
        fileButton().click();
        return null;
      }
      return menu.querySelector(
        'button[data-action="new"]',
      ) as HTMLButtonElement | null;
    }, 10_000);
    expect(newGraph, "File › New Graph in the detached window").to.exist;

    // Wrapped until `after`: the command runs on after the click returns.
    const original = win.focus.bind(win);
    Object.defineProperty(win, "focus", {
      configurable: true,
      writable: true,
      value: () => {
        focusCalls += 1;
        original();
      },
    });
    focusWrapped = true;
    const before = new Set(graphTabs().map((tab) => tab.id));
    newGraph!.click();
    const tab = await waitFor(
      () => graphTabs().find((candidate) => !before.has(candidate.id)),
      20_000,
    );
    expect(tab, "New Graph opened a tab in the main window").to.exist;
    openedTabIDs.push(tab!.id);
    const focused = await waitFor(() => focusCalls > 0, 5_000);
    expect(
      win.Zotero_Tabs.selectedID,
      "the new graph's tab is the selected one",
    ).to.equal(tab!.id);
    expect(
      focused,
      `the main window was asked to come forward ${focusCalls} times`,
    ).to.equal(true);
  });
});
