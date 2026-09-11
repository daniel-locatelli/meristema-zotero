/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const PARENT_NAME = "Tree fixture parent";
const CHILD_NAME = "Tree fixture child";

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
 * The Scope rail's folder tree (B31), walked through the plugin's own chrome
 * with the suite's only nested fixture: one parent folder with one child.
 * The other rail suites use flat folders, so nothing else exercises the
 * depth, the guides' variable, the mixed parent's square, or the reach tint
 * a parent's square casts over its descendants.
 */
describe("The graph's Scope tree", function () {
  let win: any;
  let tabID: string | null = null;
  let parentID: number | null = null;
  let childID: number | null = null;
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

  /** The row wrapper for a folder, found through the body's ID. */
  function scopeRow(id: number): HTMLElement {
    const body = graphRoot().querySelector(
      `.cm-scope-row [data-collection-id="${id}"]`,
    );
    expect(body, `a Scope row body for collection ${id}`).to.exist;
    return body!.closest(".cm-scope-row") as HTMLElement;
  }

  function checkbox(id: number): HTMLInputElement {
    return scopeRow(id).querySelector(".cm-scope-check") as HTMLInputElement;
  }

  function square(id: number): HTMLElement {
    const node = scopeRow(id).querySelector(".cm-scope-square");
    expect(node, `a square on the row for collection ${id}`).to.exist;
    return node as HTMLElement;
  }

  function squareFill(id: number): string {
    const fills = Array.from(square(id).classList)
      .map(
        (name) =>
          /^cm-scope-square-(off|on|mixed|region)$/.exec(name ?? "")?.[1],
      )
      .filter((name): name is string => Boolean(name));
    return fills.join(",");
  }

  function label(id: number): string {
    return scopeRow(id).querySelector(".cm-scope-row-label")?.textContent ?? "";
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const parent = new Zotero.Collection();
    parent.libraryID = libraryID;
    parent.name = PARENT_NAME;
    parentID = await parent.saveTx();
    const child = new Zotero.Collection();
    child.libraryID = libraryID;
    child.name = CHILD_NAME;
    child.parentID = parentID;
    childID = await child.saveTx();
    for (const [name, id] of [
      [PARENT_NAME, parentID],
      [CHILD_NAME, childID],
    ] as const) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", `${name} paper`);
      item.setField("date", "2021");
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
      () => graphRoot().querySelector(`[data-collection-id="${childID}"]`),
      10_000,
    );
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    // The child first: erasing a parent takes its subtree with it, and a
    // second erase of the child would then find nothing.
    for (const id of [childID, parentID]) {
      if (id === null) continue;
      const collection = Zotero.Collections.get(id) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("indents the child by its depth and keeps the label plain", function () {
    expect(
      scopeRow(parentID!).style.getPropertyValue("--cm-depth").trim(),
      "the parent sits at depth 0",
    ).to.equal("0");
    expect(
      scopeRow(childID!).style.getPropertyValue("--cm-depth").trim(),
      "the child sits at depth 1",
    ).to.equal("1");
    expect(
      label(childID!),
      "the label carries no leading spaces; the indent is the row's",
    ).to.equal(CHILD_NAME);
  });

  it("fills both squares while both folders are shown", function () {
    expect(checkbox(parentID!).checked, "the parent is ticked").to.equal(true);
    expect(squareFill(parentID!), "so its square is on").to.equal("on");
    expect(squareFill(childID!), "and so is the child's").to.equal("on");
    expect(
      square(childID!).classList.contains("cm-scope-square-dash"),
      "no dash on a fully shown folder",
    ).to.equal(false);
  });

  it("tints the child's row while the pointer is over the parent's square", async function () {
    const boxLabel = scopeRow(parentID!).querySelector(
      ".cm-scope-check-label",
    ) as HTMLElement;
    boxLabel.dispatchEvent(new win.PointerEvent("pointerenter"));
    expect(
      scopeRow(childID!).classList.contains("cm-scope-row-reach"),
      "the child is in the parent's reach",
    ).to.equal(true);
    expect(
      scopeRow(parentID!).classList.contains("cm-scope-row-reach"),
      "the parent itself is not tinted",
    ).to.equal(false);
    boxLabel.dispatchEvent(new win.PointerEvent("pointerleave"));
    expect(
      scopeRow(childID!).classList.contains("cm-scope-row-reach"),
      "the tint leaves with the pointer",
    ).to.equal(false);
  });

  it("draws the parent mixed when the child is unticked, and refills both on the parent's click", async function () {
    this.timeout(15_000);
    const childBox = checkbox(childID!);
    childBox.checked = false;
    childBox.dispatchEvent(new win.Event("change"));
    await waitFor(() => checkbox(parentID!).indeterminate, 5_000);
    expect(
      checkbox(parentID!).indeterminate,
      "the native box still reads indeterminate for a screen reader",
    ).to.equal(true);
    expect(squareFill(parentID!), "the parent's square is mixed").to.equal(
      "mixed",
    );
    expect(
      square(parentID!).classList.contains("cm-scope-square-dash"),
      "with the dash",
    ).to.equal(true);
    expect(squareFill(childID!), "the child's square is empty").to.equal("off");

    checkbox(parentID!).click();
    await waitFor(() => squareFill(childID!) === "on", 5_000);
    expect(squareFill(parentID!), "the parent is on again").to.equal("on");
    expect(squareFill(childID!), "and the cascade refilled the child").to.equal(
      "on",
    );
    expect(checkbox(parentID!).indeterminate, "no longer mixed").to.equal(
      false,
    );
  });

  it("gives a selected folder's square the region swatch", async function () {
    this.timeout(15_000);
    const body = scopeRow(parentID!).querySelector(
      `[data-collection-id="${parentID}"]`,
    ) as HTMLButtonElement;
    body.click();
    await waitFor(
      () => scopeRow(parentID!).classList.contains("cm-scope-row-selected"),
      5_000,
    );
    expect(squareFill(parentID!), "the square takes the region fill").to.equal(
      "region",
    );
    expect(
      scopeRow(parentID!).style.getPropertyValue("--cm-row-color").trim(),
      "the row carries the swatch the renderer handed it",
    ).to.not.equal("");
    expect(
      squareFill(childID!),
      "the child is only shown, not a region",
    ).to.equal("on");
    body.click();
    await waitFor(
      () => !scopeRow(parentID!).classList.contains("cm-scope-row-selected"),
      5_000,
    );
    expect(
      squareFill(parentID!),
      "clearing the region returns the accent",
    ).to.equal("on");
  });
});
