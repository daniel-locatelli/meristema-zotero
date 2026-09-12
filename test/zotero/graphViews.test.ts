/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  captureGraphView,
  encodeGraphView,
} from "../../src/services/graphViews";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";
import { getPluginDatabase } from "../../src/services/pluginDatabase";
import {
  createSavedGraph,
  deleteSavedGraph,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "D4 views";
const SAVED_VIEW_NAME = "D4 suite view";
const V3_GRAPH_NAME = "D4 v3 graph";
const IMPORTED_VIEW_NAME = "D4 imported";

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

/** A plain DOM event from the element's own window, as a user's would be. */
function fire(element: Element, type: string): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event(type, { bubbles: true }));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * D4's five ways of looking at a graph, walked through the plugin's own
 * chrome. The test bundle is a second copy of the plugin, so nothing here
 * reaches into a view: a graph is opened from Tools › Meristema › New Graph
 * and every outcome is read from the rendered DOM. The cases run in order
 * against that one graph — the first leaves it blank, the second puts
 * Overview on it, and the fourth saves what the second and third left behind.
 */
describe("Graph views (D4)", function () {
  let win: any;
  let tabID: string | null = null;
  let openedTabID: string | null = null;
  let collectionID: number | null = null;
  let fixtureIDs: number[] = [];
  let v3GraphID: number | null = null;
  /** What the injected file picker answers; the import case writes it. */
  let importPath: string | null = null;

  function tabContent(id: string | null): HTMLElement | null {
    if (!id) return null;
    return (win.Zotero_Tabs.getTabContent(id) as HTMLElement) ?? null;
  }

  /**
   * The graph rendered in this suite's own tab. Asking the document for
   * `.meristema-root` would answer with whichever graph another suite left
   * behind while its tab was still closing.
   */
  function graphRoot(): HTMLElement {
    const root = tabContent(tabID)?.querySelector(
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

  function chip(): HTMLButtonElement {
    const button = graphRoot().querySelector(
      ".cm-view-chip",
    ) as HTMLButtonElement | null;
    expect(button, "the View chip").to.exist;
    return button as HTMLButtonElement;
  }

  /** The whole chip, for the evidence an assertion message carries. */
  function chipText(): string {
    return normalize(chip().textContent);
  }

  /** The chip's name span: "" with no view, "Name (edited)" once edited. */
  function chipName(): string {
    return normalize(
      graphRoot().querySelector(".cm-view-chip-name")?.textContent,
    );
  }

  function viewRow(id: string): HTMLButtonElement {
    const row = graphRoot().querySelector(
      `.cm-view-row[data-view-id="${id}"]`,
    ) as HTMLButtonElement | null;
    expect(row, `a dropdown row for ${id}`).to.exist;
    return row as HTMLButtonElement;
  }

  function gallery(): HTMLElement | null {
    return graphRoot().querySelector(".cm-view-gallery") as HTMLElement | null;
  }

  function galleryShown(): boolean {
    const section = gallery();
    return Boolean(section) && !section!.hidden;
  }

  function buttonReading(host: ParentNode, label: string): HTMLButtonElement {
    const found = (
      Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]
    ).find((candidate) => normalize(candidate.textContent) === label);
    expect(found, `a button reading ${label}`).to.exist;
    return found as HTMLButtonElement;
  }

  /**
   * The dropdown, open. A background metadata refresh can rebuild the whole
   * view between the click and the next line, which leaves the click on a
   * detached chip and the live menu shut — so this asks again, as a reader
   * whose menu did not appear would.
   */
  async function openChipMenu(): Promise<HTMLElement> {
    const menu = await waitFor(() => {
      const live = graphRoot().querySelector(
        ".cm-view-menu",
      ) as HTMLElement | null;
      if (live && !live.hidden) return live;
      chip().click();
      return null;
    }, 10_000);
    expect(menu, `the View dropdown stayed shut; chip read "${chipText()}"`).to
      .exist;
    return menu as HTMLElement;
  }

  async function closeChipMenu(): Promise<void> {
    await waitFor(() => {
      const live = graphRoot().querySelector(
        ".cm-view-menu",
      ) as HTMLElement | null;
      if (!live || live.hidden) return true;
      chip().click();
      return false;
    }, 10_000);
  }

  function labelSelect(): HTMLSelectElement {
    const select = graphRoot().querySelector(
      '.cm-appearance-panel select[data-role="labels"]',
    ) as HTMLSelectElement | null;
    expect(select, "the gear's Label select").to.exist;
    return select as HTMLSelectElement;
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    // A graph that has never chosen a view is the whole point of the gallery,
    // so the preferences start as they would on a fresh profile.
    Zotero.Prefs.clear(`${config.prefsPrefix}.graphViews`, true);
    Zotero.Prefs.clear(
      `${config.prefsPrefix}.graphViewTutorialsDismissed`,
      true,
    );
    // The seam goes in before the graph is built: `renderGraphView` reads
    // its options once, so a picker installed later would never be seen.
    (Zotero as any).__meristemaGraphViewOptions = {
      pickViewFile: async () => importPath,
    };
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    collectionID = await collection.saveTx();
    let year = 2020;
    for (const title of ["D4 views fixture one", "D4 views fixture two"]) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", title);
      item.setField("date", String(year));
      year += 1;
      item.addToCollection(collectionID);
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
    const chipButton = await waitFor(
      () => tabContent(tabID)?.querySelector(".cm-view-chip"),
      30_000,
    );
    expect(chipButton, "the View chip is rendered").to.exist;
  });

  /*
   * Every step runs, whatever the state the cases left. A failed case can
   * leave the tab closing and its root gone, and a hook that threw there
   * would strand the fixture collection, its items, a saved graph row and a
   * set `graphViews` preference — which the next suite's graph would then be
   * built on. The first error is kept and rethrown once the cleanup is done,
   * so a real failure still surfaces.
   */
  after(async function () {
    this.timeout(30_000);
    let failure: unknown = null;
    const record = (error: unknown): void => {
      if (failure === null) failure = error;
    };
    // The gear's Label select writes the graph appearance preference, so the
    // suite hands it back the way it found it — if the graph is still there.
    try {
      const select = tabContent(tabID)?.querySelector(
        '.cm-appearance-panel select[data-role="labels"]',
      ) as HTMLSelectElement | null;
      if (select && select.value !== "author-year") {
        select.value = "author-year";
        fire(select, "change");
        await delay(100);
      }
    } catch (error) {
      record(error);
    }
    try {
      if (openedTabID) win.Zotero_Tabs.close(openedTabID);
      if (tabID) win.Zotero_Tabs.close(tabID);
      await delay(300);
    } catch (error) {
      record(error);
    }
    delete (Zotero as any).__meristemaGraphViewOptions;
    try {
      if (importPath) await IOUtils.remove(importPath, { ignoreAbsent: true });
    } catch (error) {
      record(error);
    }
    importPath = null;
    if (v3GraphID !== null) await deleteSavedGraph(v3GraphID);
    Zotero.Prefs.clear(`${config.prefsPrefix}.graphViews`, true);
    Zotero.Prefs.clear(
      `${config.prefsPrefix}.graphViewTutorialsDismissed`,
      true,
    );
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    if (collectionID !== null) {
      const collection = Zotero.Collections.get(collectionID) as any;
      if (collection) await collection.eraseTx();
    }
    if (failure !== null) throw failure;
  });

  it("shows the gallery for a graph that never chose, and hides it on Start blank", async function () {
    this.timeout(30_000);
    await waitFor(() => galleryShown(), 20_000);
    expect(
      galleryShown(),
      `gallery markup was ${gallery()?.outerHTML}`,
    ).to.equal(true);
    expect(normalize(gallery()!.textContent)).to.contain(
      "How do you want to look at these",
    );
    buttonReading(gallery()!, "Start blank").click();
    await waitFor(() => !galleryShown(), 5_000);
    expect(
      galleryShown(),
      "the gallery is gone once a choice is made",
    ).to.equal(false);
    expect(chipName(), `chip text was "${chipText()}"`).to.equal("");
    expect(chipText(), "the chip still reads View").to.contain("View");
  });

  it("applies Overview from the chip, labels it, and marks a gear edit", async function () {
    this.timeout(30_000);
    await openChipMenu();
    viewRow("overview").click();
    await waitFor(() => chipName().includes("Overview"), 5_000);
    expect(chipName(), `chip text was "${chipText()}"`).to.equal("Overview");
    const card = graphRoot().querySelector(".cm-view-card") as HTMLElement;
    expect(card, "the tutorial card").to.exist;
    expect(card.hidden, "tutorial card shown").to.equal(false);
    expect(normalize(card.textContent)).to.contain("Overview");
    // A gear change on a field the view owns: the label gains "(edited)".
    const gear = graphRoot().querySelector(
      ".cm-appearance-button",
    ) as HTMLButtonElement;
    expect(gear, "the gear button").to.exist;
    gear.click();
    const panelOpen = await waitFor(() => {
      const panel = graphRoot().querySelector(
        ".cm-appearance-panel",
      ) as HTMLElement | null;
      return panel && !panel.hidden ? panel : null;
    }, 5_000);
    expect(panelOpen, "the gear's panel opened").to.exist;
    const labels = labelSelect();
    expect(labels.value, "Overview's own label mode").to.equal("author-year");
    labels.value = "none";
    fire(labels, "change");
    await waitFor(() => chipName().includes("(edited)"), 5_000);
    expect(chipName(), `chip text was "${chipText()}"`).to.equal(
      "Overview (edited)",
    );
    // Leave the gear shut for the cases that follow.
    await waitFor(() => {
      const panel = graphRoot().querySelector(
        ".cm-appearance-panel",
      ) as HTMLElement | null;
      if (!panel || panel.hidden) return true;
      (
        graphRoot().querySelector(".cm-appearance-button") as HTMLButtonElement
      ).click();
      return false;
    }, 5_000);
  });

  it("ignores a click on a greyed view", async function () {
    this.timeout(30_000);
    const before = chipName();
    await openChipMenu();
    const row = viewRow("cornerstones");
    expect(
      row.getAttribute("aria-disabled"),
      "Cornerstones needs a seed",
    ).to.equal("true");
    expect(normalize(row.textContent)).to.contain("Arrives with citation hops");
    row.click();
    // A fixed window on purpose: nothing is meant to happen, so there is no
    // state to wait for. The menu-still-open assertion below carries it — a
    // row that had been taken would have closed the menu on its way out.
    await delay(200);
    expect(chipName(), `chip text was "${chipText()}"`).to.equal(before);
    expect(
      (graphRoot().querySelector(".cm-view-menu") as HTMLElement).hidden,
      "an ignored row leaves the menu open",
    ).to.equal(false);
    await closeChipMenu();
  });

  it("saves the current settings as a view and lists it under My views", async function () {
    this.timeout(30_000);
    let panel: HTMLElement | null = null;
    for (let attempt = 0; attempt < 5 && !panel; attempt += 1) {
      await openChipMenu();
      const action = (
        Array.from(
          graphRoot().querySelectorAll(".cm-view-action"),
        ) as HTMLButtonElement[]
      ).find(
        (candidate) =>
          normalize(candidate.textContent) === "Save current as view…",
      );
      expect(action, "the Save current as view… action").to.exist;
      action!.click();
      panel = await waitFor(() => {
        const live = graphRoot().querySelector(
          ".cm-view-save",
        ) as HTMLElement | null;
        return live && !live.hidden ? live : null;
      }, 2_000);
    }
    expect(panel, "the save panel opened from the dropdown's action").to.exist;
    panel = panel as HTMLElement;
    expect(panel.hidden, "the save panel is open").to.equal(false);
    const name = panel.querySelector(".cm-view-save-input") as HTMLInputElement;
    name.value = SAVED_VIEW_NAME;
    fire(name, "input");
    buttonReading(panel, "Save").click();
    await waitFor(() => chipName().includes(SAVED_VIEW_NAME), 5_000);
    expect(chipName(), `chip text was "${chipText()}"`).to.equal(
      SAVED_VIEW_NAME,
    );
    const menuText = normalize((await openChipMenu()).textContent);
    expect(menuText, "the dropdown's saved section").to.contain("My views");
    expect(menuText, "the saved view's row").to.contain(SAVED_VIEW_NAME);
    await closeChipMenu();
    const stored = String(
      Zotero.Prefs.get(`${config.prefsPrefix}.graphViews`, true) ?? "[]",
    );
    expect(
      JSON.parse(stored).map((saved: { name: string }) => saved.name),
      `the preference held ${stored}`,
    ).to.include(SAVED_VIEW_NAME);
  });

  it("reopens a version 3 graph with the gallery", async function () {
    this.timeout(60_000);
    // A version 3 row, written raw: the store always writes the current
    // version, so the field D4 added has to be taken back out by hand.
    const v3 = { ...emptyGraphViewState(), version: 3 } as Record<
      string,
      unknown
    >;
    delete v3.view;
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      V3_GRAPH_NAME,
      emptyGraphViewState(),
    );
    v3GraphID = summary.id;
    // The same handle the store used, so the UPDATE lands in the same file.
    const db = getPluginDatabase();
    expect(db, "the plugin database is open").to.exist;
    await db!.queryAsync("UPDATE saved_graphs_v1 SET state = ? WHERE id = ?", [
      JSON.stringify(v3),
      summary.id,
    ]);

    // Opened from the graph's own File menu, which gives it a tab of its own.
    const before = new Set(graphTabs().map((tab) => tab.id));
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          graphRoot().querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    fileButton().click();
    const entry = await waitFor(() => {
      const menu = graphRoot().querySelector(
        ".cm-graph-menu",
      ) as HTMLElement | null;
      if (!menu || menu.hidden) {
        fileButton().click();
        return null;
      }
      return (
        Array.from(
          menu.querySelectorAll(
            '.cm-graph-menu-list button[data-action="open"]',
          ),
        ) as HTMLButtonElement[]
      ).find((candidate) =>
        normalize(candidate.textContent).includes(V3_GRAPH_NAME),
      );
    }, 15_000);
    expect(entry, `File › Open did not list ${V3_GRAPH_NAME}`).to.exist;
    entry!.click();
    const opened = await waitFor(
      () => graphTabs().find((tab) => !before.has(tab.id)),
      20_000,
    );
    expect(opened, "the reopened graph's tab").to.exist;
    openedTabID = opened!.id;
    const reopened = await waitFor(() => {
      const section = tabContent(openedTabID)?.querySelector(
        ".cm-view-gallery",
      ) as HTMLElement | null;
      return section && !section.hidden ? section : null;
    }, 25_000);
    expect(
      reopened,
      "a version 3 graph has chosen no view, so the gallery greets it",
    ).to.exist;
    expect(normalize(reopened!.textContent)).to.contain(
      "How do you want to look at these",
    );
    win.Zotero_Tabs.close(openedTabID);
    openedTabID = null;
    await delay(300);
    win.Zotero_Tabs.select(tabID);
  });

  it("imports a view from a JSON file and suffixes a taken name", async function () {
    this.timeout(60_000);
    const wire = encodeGraphView(
      captureGraphView({
        name: IMPORTED_VIEW_NAME,
        paragraph: "A view that arrived as a file.",
        layout: {
          xMetric: "year",
          xScale: "linear",
          yMetric: "citations",
          yScale: "linear",
          nodeSizeMetric: "citations",
          nodeColorMetric: "uniform",
          nodeLabelMode: "author-year",
        },
        regions: [],
        filters: defaultPaperListFilterState(),
        folders: [],
      }),
    );
    importPath = PathUtils.join(
      Zotero.getTempDirectory().path,
      "meristema-d4-imported-view.json",
    );
    await IOUtils.writeUTF8(importPath, wire);

    const clickImport = async (): Promise<void> => {
      await openChipMenu();
      const action = (
        Array.from(
          graphRoot().querySelectorAll(".cm-view-action"),
        ) as HTMLButtonElement[]
      ).find(
        (candidate) => normalize(candidate.textContent) === "Import view JSON…",
      );
      expect(action, "the Import view JSON… action").to.exist;
      action!.click();
    };

    await clickImport();
    await waitFor(() => chipText().includes(IMPORTED_VIEW_NAME), 20_000);
    expect(chipText(), `chip text was "${chipText()}"`).to.contain(
      IMPORTED_VIEW_NAME,
    );
    const menuText = normalize((await openChipMenu()).textContent);
    expect(menuText, `the dropdown read "${menuText}"`).to.contain("My views");
    expect(menuText, `the dropdown read "${menuText}"`).to.contain(
      IMPORTED_VIEW_NAME,
    );
    await closeChipMenu();

    // The same file again: the name is taken, so it arrives suffixed. The
    // suffix is read from the store and the dropdown, not the chip: a
    // background rebuild between the save and the chip's refresh restores
    // the state captured a moment earlier, which leaves the label on the
    // view imported first (seen once, run 10 of 2026-09-12).
    await clickImport();
    const names = (): string[] =>
      JSON.parse(
        String(
          Zotero.Prefs.get(`${config.prefsPrefix}.graphViews`, true) ?? "[]",
        ),
      ).map((saved: { name: string }) => saved.name);
    await waitFor(() => names().includes(`${IMPORTED_VIEW_NAME} (2)`), 20_000);
    const stored = String(
      Zotero.Prefs.get(`${config.prefsPrefix}.graphViews`, true) ?? "[]",
    );
    expect(
      names(),
      `chip text was "${chipText()}"; the preference held ${stored}`,
    ).to.include(`${IMPORTED_VIEW_NAME} (2)`);
    const suffixed = normalize((await openChipMenu()).textContent);
    expect(
      suffixed,
      `the dropdown read "${suffixed}"; the preference held ${stored}`,
    ).to.contain(`${IMPORTED_VIEW_NAME} (2)`);
    await closeChipMenu();
    expect(
      chipText(),
      `chip text was "${chipText()}"; the preference held ${stored}`,
    ).to.contain(IMPORTED_VIEW_NAME);
  });
});
