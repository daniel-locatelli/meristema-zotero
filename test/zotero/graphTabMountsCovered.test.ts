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

  let fixtureIDs: number[] = [];
  /** A third paper, erased mid-case: a removal remounts the plot. */
  let removedID: number | null = null;

  function removedPaper(): Zotero.Item {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Covered window removed paper");
    item.setField("date", "2018");
    return item;
  }

  let requested = 0;
  /** Where each starved frame was asked for, for the failure message. */
  const callers = new Set<string>();
  let realRequest: any = null;
  let realCancel: any = null;

  function starveFrames(): void {
    realRequest = win.requestAnimationFrame;
    realCancel = win.cancelAnimationFrame;
    requested = 0;
    win.requestAnimationFrame = () => {
      const stack = (new Error().stack ?? "").split("\n").slice(1, 3);
      callers.add(stack.map((line) => line.replace(/@.*\//, "@")).join(" < "));
      return ++requested;
    };
    win.cancelAnimationFrame = () => undefined;
  }

  function restoreFrames(): void {
    if (!realRequest) return;
    win.requestAnimationFrame = realRequest;
    win.cancelAnimationFrame = realCancel;
    realRequest = null;
    realCancel = null;
  }

  function content(): HTMLElement | null {
    return tabID
      ? (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement | null)
      : null;
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    // A library with no regular item opens no graph at all. Two papers years
    // apart: an unfitted plot shows the early one and crops the late one
    // (B83).
    for (const [title, year] of [
      ["Covered window mount paper", "2022"],
      ["Covered window early paper", "2015"],
    ]) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", title!);
      item.setField("date", year!);
      fixtureIDs.push(await item.saveTx());
    }
    removedID = await removedPaper().saveTx();
  });

  afterEach(function () {
    restoreFrames();
  });

  after(async function () {
    this.timeout(10_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    if (removedID !== null) await Zotero.Items.erase(removedID);
    removedID = null;
  });

  it("renders the Scope rail with no animation frames", async function () {
    this.timeout(60_000);
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id as string));
    starveFrames();
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    try {
      let showing = shown(toolsPopup);
      (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
      await showing;
      const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
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
  });

  /**
   * Fit is camera work, and camera work waited on a frame: on a covered
   * window the plot kept its unfitted view, which crops the later year off
   * the canvas, so the D8 case's walk found only the earlier paper (B83).
   * The plot answers where its papers are through the hovered paper's
   * tooltip, so the walk hovers the canvas in whole pixels (B43) and
   * re-reads the canvas every pass: a remount replaces it.
   */
  it("fits the plot with no animation frames, so every paper can be hovered", async function () {
    this.timeout(60_000);
    expect(tabID, "the tab the first case opened").to.exist;
    starveFrames();
    const gallery = content()?.querySelector(
      ".cm-view-gallery",
    ) as HTMLElement | null;
    if (gallery && !gallery.hidden) {
      (Array.from(gallery.querySelectorAll("button")) as HTMLButtonElement[])
        .find((button) => button.textContent?.trim() === "Start blank")
        ?.click();
      await waitFor(() => gallery.hidden, 5_000);
    }
    // The D8 case presses Fit the same way before its walk.
    const fit = await waitFor(
      () =>
        content()?.querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    expect(fit, "the fit button").to.exist;
    fit!.click();
    // Then the plot remounts, as the D8 tab's did when its paper's citation
    // update landed: the new plot's own first fit is the one that waited on
    // a frame.
    const fitted = content()?.querySelector("canvas");
    await Zotero.Items.erase(removedID!);
    removedID = null;
    const remounted = await waitFor(() => {
      const canvas = content()?.querySelector("canvas");
      return canvas && canvas !== fitted ? canvas : null;
    }, 10_000);
    expect(remounted, "a new plot after the removal").to.exist;
    const wanted = ["Covered window mount paper", "Covered window early paper"];
    const seen = new Set<string>();
    let box: DOMRect | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const canvas = content()?.querySelector(
        "canvas",
      ) as HTMLCanvasElement | null;
      if (canvas) {
        box = canvas.getBoundingClientRect();
        for (let y = Math.ceil(box.top) + 4; y < box.bottom - 4; y += 5) {
          for (let x = Math.ceil(box.left) + 4; x < box.right - 4; x += 5) {
            canvas.dispatchEvent(
              new win.PointerEvent("pointermove", {
                bubbles: true,
                clientX: x,
                clientY: y,
              }),
            );
            if (canvas.title) seen.add(canvas.title.split("\n")[0]!);
          }
        }
      }
      if (wanted.every((title) => [...seen].some((s) => s.includes(title))))
        break;
      await delay(500);
    }
    expect(
      wanted.filter((title) => ![...seen].some((s) => s.includes(title))),
      `papers the walk never hovered; it saw ${[...seen].join(" | ") || "nothing"}` +
        ` on a canvas ${JSON.stringify(box)}; frames requested ${requested} by ${[...callers].join(" || ")}`,
    ).to.be.empty;
  });
});
