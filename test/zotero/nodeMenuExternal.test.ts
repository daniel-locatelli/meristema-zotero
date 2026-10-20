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
const GRAPH_NAME = "F5 external menu";
const TITLE = "F5 external menu fixture";
const UPDATE = "Update this paper's connections";

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
 * F5: an external paper's right-click menu offers what Paper details offers
 * for it, and the update it starts is the pane's. A saved graph carrying one
 * external seed is opened from Tools › Meristema › Load; opening it selects
 * the seed, so the pane shows the paper and the ContextMenu key opens the
 * menu on it.
 */
describe("The node menu on an external paper (F5)", function () {
  let win: any;
  let tabID: string | null = null;
  let graphID: number | null = null;
  let fixtureID: number | null = null;

  before(async function () {
    this.timeout(30_000);
    win = Zotero.getMainWindows()[0];
    // A graph opens on a library; give it a paper to stand on.
    const fixture = new Zotero.Item("journalArticle");
    fixture.setField("title", "F5 library fixture");
    fixtureID = await fixture.saveTx();
    const work = {
      provider: "openalex" as const,
      providerWorkID: "W-f5-fixture",
      doi: "10.1000/f5.fixture",
      title: TITLE,
      year: 2022,
      authors: ["Ada Lovelace"],
    };
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      GRAPH_NAME,
      {
        ...emptyGraphViewState(),
        seeds: [
          { kind: "external", identityKey: "openalex:W-f5-fixture", work },
        ],
      },
    );
    graphID = summary.id;
  });

  after(async function () {
    this.timeout(90_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    if (graphID !== null) await deleteSavedGraph(graphID);
    if (fixtureID !== null) await Zotero.Items.erase(fixtureID);
  });

  it("offers the pane's actions, hands Add to Zotero… to the pane, and shares the update", async function () {
    this.timeout(120_000);
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
      `${config.addonRef}-load-saved-graph-submenu`,
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
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;
    const root = (await waitFor(
      () => doc.querySelector(".meristema-root"),
      20_000,
    )) as HTMLElement | null;
    expect(root, "the graph view mounted").to.exist;

    const paneButton = (label: string): HTMLButtonElement | null =>
      (
        Array.from(
          root!.querySelectorAll(".cm-detail-body .cm-detail-actions button"),
        ) as HTMLButtonElement[]
      ).find((button) => button.textContent?.trim() === label) ?? null;
    const paneUpdate = await waitFor(() => paneButton(UPDATE), 20_000);
    expect(paneUpdate, "the pane shows the seed, with the update").to.exist;
    expect(paneUpdate!.title).to.equal(
      "Fetch this paper's references and citing papers again.",
    );

    const menu = root!.querySelector(".cm-node-menu") as HTMLElement;
    const canvas = root!.querySelector("canvas") as HTMLCanvasElement;
    const openMenu = (): void => {
      canvas.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      );
    };
    const entries = (): HTMLButtonElement[] =>
      (
        Array.from(
          menu.querySelectorAll('[role="menuitem"]'),
        ) as HTMLButtonElement[]
      ).filter((item) => !item.hidden);
    const entry = (label: string): HTMLButtonElement => {
      const found = entries().find(
        (item) => item.textContent?.trim() === label,
      );
      expect(
        found,
        `menu entry ${label}; menu [${entries()
          .map((item) => item.textContent)
          .join(", ")}]`,
      ).to.exist;
      return found!;
    };

    openMenu();
    expect(menu.hidden, "the ContextMenu key opens the menu").to.equal(false);
    // A seed, so Remove from graph stays out; not in Zotero, so Add, not Show.
    expect(entries().map((item) => item.textContent?.trim())).to.deep.equal([
      "Open online",
      "Add to Zotero…",
      "Find similar papers",
      UPDATE,
      "Remove seed",
    ]);
    const rule = menu.querySelector('[role="separator"]') as HTMLElement;
    expect(rule, "the menu has a rule").to.exist;
    expect(rule.hidden, "and shows it").to.equal(false);
    expect(
      rule.previousElementSibling?.textContent?.trim(),
      "the rule sits under the paper's actions",
    ).to.equal(UPDATE);
    expect(
      rule.nextElementSibling?.textContent?.trim(),
      "and over the seed entries",
    ).to.equal("Remove seed");

    // Add to Zotero… imports nothing: it hands the reader to the pane.
    entry("Add to Zotero…").click();
    expect(menu.hidden, "the entry closes the menu").to.equal(true);
    const paneAdd = paneButton("Add to Zotero");
    expect(paneAdd, "the pane offers Add to Zotero").to.exist;
    expect(
      doc.activeElement === paneAdd,
      `focus lands on the pane's Add to Zotero; it is on ${
        (doc.activeElement as HTMLElement | null)?.outerHTML?.slice(0, 120) ??
        "nothing"
      }`,
    ).to.equal(true);

    // The menu's update is the pane's: starting it disables the pane button,
    // and the menu, reopened on the same paper, shows its entry disabled.
    openMenu();
    entry(UPDATE).click();
    expect(
      paneButton(UPDATE)?.disabled,
      "the pane's button is disabled while the update runs",
    ).to.equal(true);
    openMenu();
    const menuUpdate = (
      Array.from(
        menu.querySelectorAll('[role="menuitem"]'),
      ) as HTMLButtonElement[]
    ).find((item) => item.textContent?.trim() === UPDATE);
    expect(menuUpdate?.hidden, "the reopened menu lists the update").to.equal(
      false,
    );
    expect(menuUpdate?.disabled, "and shows it disabled").to.equal(true);
    menu.dispatchEvent(
      new win.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );

    // Whether the providers answer or fail, the update ends and the pane's
    // button comes back.
    const freed = await waitFor(() => {
      const live = paneButton(UPDATE);
      return live && !live.disabled ? live : null;
    }, 90_000);
    expect(freed, "the pane's button is enabled once the update ends").to.exist;
  });
});
