/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import {
  createSavedGraph,
  deleteSavedGraph,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const ROW_ATTR = "data-meristema-saved-graph";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

function hidden(popup: Element): Promise<void> {
  if (!(popup as any).state || (popup as any).state === "closed") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    popup.addEventListener("popuphidden", () => resolve(), { once: true });
  });
}

function customMenu(popup: Element, l10nID: string): any {
  const menu = Array.from(popup.children).find(
    (child) => (child as HTMLElement).dataset?.l10nId === l10nID,
  );
  expect(menu, `menu ${l10nID}`).to.exist;
  return menu;
}

async function rowsIn(popup: Element, timeoutMs: number): Promise<Element[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = Array.from(popup.children).filter((child) =>
      child.hasAttribute(ROW_ATTR),
    );
    if (rows.length || Date.now() > deadline) return rows;
    await delay(50);
  }
}

/**
 * B2 in the 2026-09-08 review backlog: Tools › Meristema › Open Saved Graph
 * listed nothing the first time it opened after a restart, and the graphs
 * only the second time. This walks the real menubar once, in a Zotero that
 * has never opened that submenu, and expects the rows on that first showing.
 */
describe("Tools › Meristema › Open Saved Graph", function () {
  let toolsPopup: Element;
  let graphID: number | null = null;

  before(async function () {
    this.timeout(15_000);
    const win = Zotero.getMainWindows()[0] as any;
    toolsPopup = (win.document as Document).getElementById("menu_ToolsPopup")!;
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      "B2 first showing",
      emptyGraphViewState(),
    );
    graphID = summary.id;
  });

  after(async function () {
    this.timeout(15_000);
    const closing = hidden(toolsPopup);
    (toolsPopup as any).hidePopup?.();
    await closing;
    if (graphID !== null) await deleteSavedGraph(graphID);
  });

  it("lists the saved graphs on the first showing", async function () {
    this.timeout(20_000);

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
    const popup = open.menupopup as Element;
    showing = shown(popup);
    open.openMenu(true);
    await showing;

    const rows = await rowsIn(popup, 3_000);
    expect(rows.map((row) => row.getAttribute("label"))).to.include(
      "B2 first showing",
    );
    const empty = Array.from(popup.children).find(
      (child) =>
        (child as HTMLElement).dataset?.l10nId ===
        `${config.addonRef}-open-saved-graph-empty-command`,
    ) as HTMLElement | undefined;
    expect(empty, "the empty entry").to.exist;
    expect(empty!.hidden, "the empty entry is hidden").to.equal(true);
  });
});
