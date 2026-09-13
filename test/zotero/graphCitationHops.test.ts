/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import { getPluginDatabase } from "../../src/services/pluginDatabase";
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "Stage 3 hops";
/**
 * One library paper, and a DOI the providers know in both directions. An open
 * access article on purpose: a hop expansion asks one provider only, the first
 * of the automatic order, and that is Semantic Scholar for both directions —
 * which serves no reference list at all for a paper whose publisher elides it
 * (an Elsevier DOI here left References stuck at 0/0 while the aggregating
 * Refresh button found twenty). Nine citers and sixty-two references at the
 * time of writing: small enough that a hop-2 fill lands in seconds, large
 * enough that every count the ladder shows is non-zero.
 */
const FIXTURE_TITLE = "Stage 3 hop fixture";
const FIXTURE_DOI = "10.1371/journal.pone.0146320";
const SAVED_GRAPH_NAME = "Stage 3 hop graph";
const V4_GRAPH_NAME = "Stage 3 v4 both";
/** The one-time notice a version 4 `both` record earns on open. */
const BOTH_NOTICE = "Directions are now one at a time; showing Citers";

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
 * The citation hop ladder, walked through the plugin's own chrome. The test
 * bundle is a second copy of the plugin, so nothing here reaches into a view:
 * a graph is opened from Tools › Meristema › New Graph, a library paper with
 * a real DOI is made a seed from the plot's own node menu, and every outcome
 * is read from the rendered rail. The providers are live, so the waits are
 * generous and every failure carries the counts it saw.
 *
 * The cases run in order against that one graph: the seed the first adds is
 * the ladder the rest walk, and the sixth saves what the first five left.
 */
describe("Citation hops (Stage 3)", function () {
  let win: any;
  /** The graph this suite opened; case 6 closes it. */
  let tabID: string | null = null;
  /** A blank graph kept only for its File menu once the main tab is gone. */
  let hostTabID: string | null = null;
  /** The saved graph reopened in case 6. */
  let reopenedTabID: string | null = null;
  /** The version 4 record opened in case 7. */
  let v4TabID: string | null = null;
  /** Whichever tab the rail helpers read: the main graph, then the reopened. */
  let currentTabID: string | null = null;
  let collectionID: number | null = null;
  let fixtureIDs: number[] = [];
  let v4GraphID: number | null = null;
  /** Set while File › Save's name dialog is answered by the suite. */
  let promptStubbed = false;
  let realPrompt: any = null;

  function tabContent(id: string | null): HTMLElement | null {
    if (!id) return null;
    return (win.Zotero_Tabs.getTabContent(id) as HTMLElement) ?? null;
  }

  /**
   * The graph rendered in this suite's current tab. Asking the document for
   * `.meristema-root` would answer with whichever graph another suite left
   * behind while its tab was still closing.
   */
  function rootOf(id: string | null): HTMLElement {
    const root = tabContent(id)?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, `the graph in tab ${id} is rendered`).to.exist;
    return root as HTMLElement;
  }

  function graphRoot(): HTMLElement {
    return rootOf(currentTabID);
  }

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  /** The `shown` half of the rail's `{shown} of {total} papers`. */
  function scopeCount(): number {
    const line =
      graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
    return Number(/^([\d,]+) of/.exec(line)?.[1]?.replace(/,/g, "") ?? "0");
  }

  /** One row of the Citation hops block, or null before a seed exists. */
  function hopRow(hop: number): HTMLElement | null {
    return graphRoot().querySelector(
      `.cm-scope-hop-row[data-hop="${hop}"]`,
    ) as HTMLElement | null;
  }

  function hopRowText(hop: number): string {
    const row = hopRow(hop);
    return row ? normalize(row.textContent) : `no row for hop ${hop}`;
  }

  /**
   * The row's count, or null while the row carries the Fetch button instead
   * (`.cm-scope-row-count` is not rendered on the first row past the depth).
   */
  function hopCountText(hop: number): string | null {
    const text = hopRow(hop)?.querySelector(".cm-scope-row-count")?.textContent;
    return text === undefined || text === null ? null : normalize(text);
  }

  /** `{shown}/{available}` as numbers, or null when the row shows no pair. */
  function hopCounts(hop: number): { shown: number; available: number } | null {
    const text = hopCountText(hop);
    const match = text ? /^([\d,]+)\/([\d,]+)$/.exec(text) : null;
    if (!match) return null;
    return {
      shown: Number(match[1]!.replace(/,/g, "")),
      available: Number(match[2]!.replace(/,/g, "")),
    };
  }

  /** The runner's progress line, absent while it has nothing to do. */
  function progressText(): string {
    const line = graphRoot().querySelector(".cm-scope-hop-progress");
    return line ? normalize(line.textContent) : "no progress line";
  }

  /** The `Fetch hop N` button, which sits in the first row past the depth. */
  function fetchButton(hop: number): HTMLButtonElement | null {
    const button = hopRow(hop)?.querySelector(
      ".cm-scope-hop-fetch",
    ) as HTMLButtonElement | null;
    return button ?? null;
  }

  function hopCheckbox(hop: number): HTMLInputElement {
    const box = hopRow(hop)?.querySelector(
      "input.cm-scope-check",
    ) as HTMLInputElement | null;
    expect(box, `hop ${hop} carries a checkbox; row read "${hopRowText(hop)}"`)
      .to.exist;
    return box as HTMLInputElement;
  }

  /** One cell of the Citers | References switch. */
  function directionCell(label: "Citers" | "References"): HTMLButtonElement {
    const cell = (
      Array.from(
        graphRoot().querySelectorAll(".cm-scope-hops .cm-segmented-cell"),
      ) as HTMLButtonElement[]
    ).find((candidate) => normalize(candidate.textContent) === label);
    expect(cell, `the ${label} cell of the direction switch`).to.exist;
    return cell as HTMLButtonElement;
  }

  function directionState(): string {
    return (
      Array.from(
        graphRoot().querySelectorAll(".cm-scope-hops .cm-segmented-cell"),
      ) as HTMLButtonElement[]
    )
      .map(
        (cell) =>
          `${normalize(cell.textContent)}=${cell.getAttribute("aria-checked")}`,
      )
      .join(" ");
  }

  function refreshButton(): HTMLButtonElement {
    const button = (
      Array.from(
        graphRoot().querySelectorAll(".cm-toolbar-button"),
      ) as HTMLButtonElement[]
    ).find((candidate) => normalize(candidate.textContent) === "Refresh");
    expect(button, "the toolbar's Refresh button").to.exist;
    return button as HTMLButtonElement;
  }

  /** Press Refresh, once it is free to be pressed. */
  async function pressRefresh(): Promise<void> {
    const button = await waitFor(() => {
      const live = refreshButton();
      return live.disabled ? null : live;
    }, 30_000);
    expect(
      button,
      `Refresh never became pressable; title "${refreshButton().title}", ` +
        `aria-busy ${refreshButton().getAttribute("aria-busy")}`,
    ).to.exist;
    button!.click();
  }

  function statusText(id: string | null = currentTabID): string {
    return normalize(
      tabContent(id)?.querySelector(".cm-toolbar-status")?.textContent,
    );
  }

  /**
   * Wait, keeping every distinct state the ladder passed through on the way.
   * A hop that never fills says nothing in the DOM at the end — whether the
   * runner ever had work is only visible while it is working, so the trace is
   * what a failure here is diagnosed from.
   */
  async function traceUntil(
    probe: () => boolean,
    timeoutMs: number,
  ): Promise<string> {
    const trace: string[] = [];
    const started = Date.now();
    let last = "";
    for (;;) {
      const sample =
        `hop1 "${hopRowText(1)}" hop2 "${hopRowText(2)}" ` +
        `${progressText()} scope ${scopeCount()}`;
      if (sample !== last) {
        trace.push(`+${Date.now() - started}ms ${sample}`);
        last = sample;
      }
      if (probe()) break;
      if (Date.now() - started > timeoutMs) {
        trace.push(`gave up after ${Date.now() - started}ms`);
        break;
      }
      await delay(200);
    }
    return (
      trace.join(" || ") +
      `; recent Zotero errors: ${
        (Zotero.getErrors(true) as string[]).slice(-3).join(" || ") || "none"
      }`
    );
  }

  /** The whole ladder in one line, for an assertion message. */
  function ladder(): string {
    const rows: string[] = [];
    for (let hop = 0; hop <= 3; hop += 1) rows.push(hopRowText(hop));
    return rows.join(" | ");
  }

  /**
   * D4's gallery sits over the plot of a graph that has never chosen a view,
   * and its backdrop blur is the first suspect for a walk's flake (B43), so
   * every failure of the walk says what the gallery was doing.
   */
  function galleryState(): string {
    const section = graphRoot().querySelector(
      ".cm-view-gallery",
    ) as HTMLElement | null;
    if (!section) return "no gallery in the DOM";
    return section.hidden ? "gallery present, hidden" : "gallery SHOWN";
  }

  /** Take the gallery off the plot, so the node-menu walk has a clear canvas. */
  async function dismissGallery(id: string | null): Promise<void> {
    const section = await waitFor(() => {
      const live = tabContent(id)?.querySelector(
        ".cm-view-gallery",
      ) as HTMLElement | null;
      return live && !live.hidden ? live : null;
    }, 10_000);
    if (!section) return;
    const start = (
      Array.from(section.querySelectorAll("button")) as HTMLButtonElement[]
    ).find((button) => normalize(button.textContent) === "Start blank");
    if (!start) return;
    start.click();
    await waitFor(() => section.hidden, 5_000);
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
   * Right-click the fixture's node and hand back one of its menu entries, the
   * way the Scope rail suite does: the plot answers where its papers are by
   * putting the hovered paper's tooltip on the canvas, so the search walks
   * the plot with pointer moves and right-clicks every point that names a
   * paper it has not tried. Here the tooltip must also name the fixture —
   * a hop of the wrong paper would prove nothing.
   *
   * The grid is walked in whole CSS pixels (B43): a synthetic PointerEvent
   * keeps a fractional clientX but a synthetic MouseEvent is delivered at the
   * truncated integer, so a hover and a right-click "at the same point" can
   * reach the renderer a pixel apart.
   */
  async function nodeMenuEntry(
    label: string,
    titleIncludes: string,
  ): Promise<HTMLButtonElement> {
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
    const clicks: string[] = [];
    const menuState = (): string => {
      const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
      if (!menu) return "no menu element";
      if (menu.hidden) return "menu hidden";
      return `menu open [${nodeMenuItems()
        .map((button) => button.textContent?.trim())
        .join(", ")}]`;
    };
    const started = Date.now();
    const deadline = started + 20_000;
    let passes = 0;
    for (;;) {
      passes += 1;
      const box = canvas.getBoundingClientRect();
      const left = Math.ceil(box.left);
      const top = Math.ceil(box.top);
      for (let y = top + 4; y < box.bottom - 4; y += 5) {
        for (let x = left + 4; x < box.right - 4; x += 5) {
          move(x, y);
          const paper = canvas.title;
          if (!paper || tried.has(paper)) continue;
          tried.add(paper);
          if (!paper.includes(titleIncludes)) continue;
          const rightClick = new win.MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          });
          canvas.dispatchEvent(rightClick);
          clicks.push(
            `${paper.split("\n")[0]} @${x},${y} pass ${passes}: ` +
              `hit=${rightClick.defaultPrevented} ${menuState()}`,
          );
          const entry = nodeMenuItems().find(
            (button) => button.textContent?.trim() === label,
          );
          if (entry) return entry;
          closeNodeMenu();
        }
      }
      if (Date.now() > deadline) break;
      await delay(500);
    }
    expect.fail(
      `no node menu entry reading ${label} on a paper named ${titleIncludes}` +
        `; ${tried.size} paper(s) offered ${[...tried].join(" | ") || "nothing"}` +
        `; ${passes} pass(es) over the canvas in ${Date.now() - started}ms` +
        `; ${galleryState()}` +
        `; clicks: ${clicks.join(" || ") || "none"}` +
        `; recent Zotero errors: ${
          (Zotero.getErrors(true) as string[]).slice(-5).join(" || ") || "none"
        }`,
    );
  }

  /** Open a graph from Tools › Meristema › New Graph; hand back its tab id. */
  async function openNewGraphTab(): Promise<string> {
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
    expect(tab, "the new graph's tab").to.exist;
    return tab!.id as string;
  }

  /**
   * Open a saved graph from a live graph's own File menu — the saved-graph
   * menu the D4 suite uses — and hand back the tab it lands in.
   */
  async function openSavedGraphFromFileMenu(
    hostID: string,
    name: string,
  ): Promise<string> {
    const before = new Set(graphTabs().map((tab) => tab.id));
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          rootOf(hostID).querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    fileButton().click();
    const entry = await waitFor(() => {
      const menu = rootOf(hostID).querySelector(
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
      ).find((candidate) => normalize(candidate.textContent).includes(name));
    }, 15_000);
    expect(entry, `File › Open did not list ${name}`).to.exist;
    entry!.click();
    const opened = await waitFor(
      () => graphTabs().find((tab) => !before.has(tab.id)),
      25_000,
    );
    expect(opened, `the tab for ${name}`).to.exist;
    return opened!.id as string;
  }

  /**
   * File › Save on an unbound graph asks for a name through Services.prompt,
   * which is modal. The stub answers it and is installed by redefining the
   * property — the object itself is not writable — and it outlives the async
   * handler behind the menu, so it is taken down only once the save landed.
   */
  function stubPrompt(name: string): void {
    if (promptStubbed) return;
    realPrompt = (Services as any).prompt;
    const stub: any = {
      prompt: (
        _window: unknown,
        _title: unknown,
        _message: unknown,
        value: { value: string },
      ) => {
        value.value = name;
        return true;
      },
    };
    for (const method of ["confirmEx", "confirm", "alert", "confirmCheck"]) {
      stub[method] = (...args: unknown[]) =>
        realPrompt[method]?.(...(args as never[]));
    }
    Object.defineProperty(Services, "prompt", {
      configurable: true,
      get: () => stub,
    });
    promptStubbed = true;
  }

  function restorePrompt(): void {
    if (!promptStubbed) return;
    Object.defineProperty(Services, "prompt", {
      configurable: true,
      get: () => realPrompt,
    });
    promptStubbed = false;
  }

  /** The File menu's own Save, clicked. */
  async function clickFileSave(hostID: string): Promise<void> {
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          rootOf(hostID).querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    fileButton().click();
    const save = await waitFor(() => {
      const menu = rootOf(hostID).querySelector(
        ".cm-graph-menu",
      ) as HTMLElement | null;
      if (!menu || menu.hidden) {
        fileButton().click();
        return null;
      }
      return menu.querySelector(
        'button[data-action="save"]',
      ) as HTMLButtonElement | null;
    }, 15_000);
    expect(save, "the File menu's Save").to.exist;
    save!.click();
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    collectionID = await collection.saveTx();
    // One paper only: the node-menu walk has to land on this DOI, and a
    // second fixture would only give it somewhere else to land.
    const item = new Zotero.Item("journalArticle");
    item.libraryID = libraryID;
    item.setField("title", FIXTURE_TITLE);
    item.setField("date", "2015");
    item.setField("DOI", FIXTURE_DOI);
    item.addToCollection(collectionID);
    fixtureIDs.push(await item.saveTx());

    tabID = await openNewGraphTab();
    currentTabID = tabID;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the rail's Scope section").to.exist;
    // A graph that has never chosen a view is greeted by the gallery, which
    // sits over the plot the walk below reads.
    await dismissGallery(tabID);
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

  /*
   * Every step runs, whatever state the cases left. A failed case can leave a
   * tab closing, a prompt stubbed and a saved graph row behind, and a hook
   * that threw before the cleanup would strand all three for the next suite.
   * The first error is kept and rethrown once the cleanup is done.
   */
  after(async function () {
    this.timeout(60_000);
    let failure: unknown = null;
    const record = (error: unknown): void => {
      if (failure === null) failure = error;
    };
    try {
      restorePrompt();
    } catch (error) {
      record(error);
    }
    try {
      for (const id of [v4TabID, reopenedTabID, hostTabID, tabID]) {
        if (id) win.Zotero_Tabs.close(id);
      }
      await delay(500);
    } catch (error) {
      record(error);
    }
    v4TabID = null;
    reopenedTabID = null;
    hostTabID = null;
    tabID = null;
    currentTabID = null;
    try {
      if (v4GraphID !== null) await deleteSavedGraph(v4GraphID);
      v4GraphID = null;
      const saved = await listSavedGraphs(Zotero.Libraries.userLibraryID);
      for (const graph of saved) {
        if (graph.name === SAVED_GRAPH_NAME || graph.name === V4_GRAPH_NAME) {
          await deleteSavedGraph(graph.id);
        }
      }
    } catch (error) {
      record(error);
    }
    try {
      for (const id of fixtureIDs) await Zotero.Items.erase(id);
      fixtureIDs = [];
      if (collectionID !== null) {
        const collection = Zotero.Collections.get(collectionID) as any;
        if (collection) await collection.eraseTx();
        collectionID = null;
      }
    } catch (error) {
      record(error);
    }
    if (failure !== null) throw failure;
  });

  it("fills hop 1 once the paper becomes a seed", async function () {
    // The seed path no longer fetches anything (Task 12): hop 1 is the
    // runner's first landing, so this wait covers a real provider round-trip.
    this.timeout(120_000);
    (await nodeMenuEntry("Add as seed", FIXTURE_TITLE)).click();
    const row = await waitFor(() => hopRow(1), 20_000);
    expect(
      row,
      `the ladder never appeared; ${galleryState()}; scope ${scopeCount()}`,
    ).to.exist;
    const trace = await traceUntil(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available > 0;
    }, 60_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `hop 1 never reported a count; hop 1 read "${hopRowText(1)}"; ` +
        `Seeds read "${hopRowText(0)}"; ${galleryState()}; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}"; Seeds read "${hopRowText(0)}"; ` +
        `${galleryState()}; trace: ${trace}`,
    ).to.be.greaterThan(0);
    expect(
      counts!.shown,
      `hop 1 shows fewer than it has: "${hopCountText(1)}"; ` +
        `Seeds read "${hopRowText(0)}"; ${progressText()}; ${galleryState()}`,
    ).to.equal(counts!.available);
  });

  it("opens hop 2 from the Fetch hop 2 button", async function () {
    this.timeout(180_000);
    const button = fetchButton(2);
    expect(
      button,
      `hop 2 carries no Fetch button; hop 2 read "${hopRowText(2)}"; ` +
        `ladder ${ladder()}`,
    ).to.exist;
    expect(
      normalize(button!.textContent),
      `the button in the hop 2 row read "${normalize(button!.textContent)}"`,
    ).to.equal("Fetch hop 2");
    expect(
      hopCountText(2),
      `hop 2 already had a count before the fetch: "${hopRowText(2)}"`,
    ).to.equal(null);
    button!.click();
    const trace = await traceUntil(() => {
      const counts = hopCounts(2);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(2);
    expect(
      counts,
      `hop 2 never left "not fetched"; hop 1 read "${hopCountText(1)}"; ` +
        `hop 2 read "${hopRowText(2)}"; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}"; hop 2 read "${hopCountText(2)}"; ` +
        `trace: ${trace}`,
    ).to.be.greaterThan(0);
  });

  it("keeps Refresh pressable while the fill runs", async function () {
    this.timeout(30_000);
    const button = refreshButton();
    expect(
      button.disabled,
      `Refresh was disabled during the fill; aria-busy ` +
        `${button.getAttribute("aria-busy")}; title "${button.title}"; ` +
        `progress: ${progressText()}; ladder ${ladder()}`,
    ).to.equal(false);
    expect(
      button.getAttribute("aria-busy"),
      `Refresh reported busy; title "${button.title}"; ` +
        `progress: ${progressText()}`,
    ).to.not.equal("true");
  });

  it("fills hop 2 again after a Refresh", async function () {
    // The timing-shaped case, run a second time: the ladder must reach the
    // same place from a seed whose lists are refetched under it.
    this.timeout(180_000);
    const before = hopCountText(2);
    await pressRefresh();
    await waitFor(() => {
      const counts = hopCounts(2);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(2);
    expect(
      counts,
      `hop 2 lost its count across a Refresh; it read "${before}" before ` +
        `and "${hopRowText(2)}" after; hop 1 read "${hopCountText(1)}"; ` +
        `progress: ${progressText()}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 2 read "${before}" before the Refresh and ` +
        `"${hopCountText(2)}" after; progress: ${progressText()}`,
    ).to.be.greaterThan(0);
  });

  it("hides the hop 2 papers when hop 1 is unticked, and brings them back", async function () {
    this.timeout(60_000);
    const scopeBefore = scopeCount();
    const hop2Before = hopCountText(2);
    hopCheckbox(1).click();
    await waitFor(() => hopCounts(2)?.shown === 0, 20_000);
    const hidden = hopCounts(2);
    expect(
      hidden?.shown,
      `unticking hop 1 left hop 2 showing; before hop 2 read "${hop2Before}" ` +
        `and scope ${scopeBefore}, after hop 2 read "${hopCountText(2)}" and ` +
        `scope ${scopeCount()}; ladder ${ladder()}`,
    ).to.equal(0);
    expect(
      scopeCount(),
      `the plot kept every paper; scope was ${scopeBefore}, is ` +
        `${scopeCount()}; ladder ${ladder()}`,
    ).to.be.lessThan(scopeBefore);
    hopCheckbox(1).click();
    await waitFor(() => (hopCounts(2)?.shown ?? 0) > 0, 20_000);
    expect(
      hopCounts(2)?.shown ?? 0,
      `re-ticking hop 1 did not bring hop 2 back; before "${hop2Before}", ` +
        `after "${hopCountText(2)}"; scope was ${scopeBefore}, is ` +
        `${scopeCount()}; ladder ${ladder()}`,
    ).to.be.greaterThan(0);
  });

  it("rebuilds the ladder on the References side of the switch", async function () {
    this.timeout(180_000);
    const before = ladder();
    directionCell("References").click();
    const trace = await traceUntil(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `References never filled hop 1; the ladder read ${before} before and ` +
        `${ladder()} after; ${directionState()}; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}" on References; ${directionState()}; ` +
        `trace: ${trace}`,
    ).to.be.greaterThan(0);
    expect(
      directionCell("References").getAttribute("aria-checked"),
      `the switch reads ${directionState()}; ladder ${ladder()}`,
    ).to.equal("true");
    expect(
      directionCell("Citers").getAttribute("aria-checked"),
      `the switch reads ${directionState()}`,
    ).to.equal("false");
  });

  it("fills References hop 1 again after a Refresh", async function () {
    // The second timing-shaped case, repeated as the first one is.
    this.timeout(180_000);
    const before = hopCountText(1);
    await pressRefresh();
    await waitFor(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `References hop 1 lost its count across a Refresh; it read "${before}" ` +
        `before and "${hopRowText(1)}" after; ${directionState()}; ` +
        `progress: ${progressText()}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${before}" before the Refresh and "${hopCountText(1)}" ` +
        `after; ${directionState()}; progress: ${progressText()}`,
    ).to.be.greaterThan(0);
  });

  it("saves the graph and finds its direction and depth on reopening", async function () {
    this.timeout(120_000);
    const savedLadder = ladder();
    const savedDirection = directionState();
    stubPrompt(SAVED_GRAPH_NAME);
    await clickFileSave(tabID!);
    // The save is asynchronous behind the menu, so the store is polled here
    // rather than through `waitFor`, whose probe is synchronous.
    const deadline = Date.now() + 30_000;
    let names = (await listSavedGraphs(Zotero.Libraries.userLibraryID)).map(
      (graph) => graph.name,
    );
    while (!names.includes(SAVED_GRAPH_NAME) && Date.now() < deadline) {
      await delay(250);
      names = (await listSavedGraphs(Zotero.Libraries.userLibraryID)).map(
        (graph) => graph.name,
      );
    }
    expect(
      names,
      `File › Save wrote no row; the toolbar status read "${statusText()}"`,
    ).to.include(SAVED_GRAPH_NAME);
    restorePrompt();

    // A graph bound to the row is simply activated by Open, so the tab has to
    // go before the record can be read back. A blank graph is kept for its
    // File menu, which is the saved-graph menu this reopens from.
    hostTabID = await openNewGraphTab();
    await dismissGallery(hostTabID);
    win.Zotero_Tabs.close(tabID!);
    tabID = null;
    await delay(500);
    reopenedTabID = await openSavedGraphFromFileMenu(
      hostTabID,
      SAVED_GRAPH_NAME,
    );
    currentTabID = reopenedTabID;
    win.Zotero_Tabs.select(reopenedTabID);
    const row = await waitFor(
      () =>
        tabContent(reopenedTabID)?.querySelector(
          '.cm-scope-hop-row[data-hop="2"]',
        ),
      40_000,
    );
    expect(
      row,
      `the reopened graph never drew a ladder; it was saved as ` +
        `${savedLadder} (${savedDirection})`,
    ).to.exist;
    expect(
      directionCell("References").getAttribute("aria-checked"),
      `the reopened switch reads ${directionState()}; it was saved as ` +
        `${savedDirection}; ladder ${ladder()}`,
    ).to.equal("true");
    expect(
      hopRowText(2),
      `hop 2 came back unfetched; it was saved as ${savedLadder}, ` +
        `reopened as ${ladder()}`,
    ).to.not.contain("not fetched");
    expect(
      hopCountText(2),
      `hop 2 shows a Fetch button instead of a count; it was saved as ` +
        `${savedLadder}, reopened as ${ladder()}; hop 2 read ` +
        `"${hopRowText(2)}", count "${hopCountText(2)}"`,
    ).to.not.be.null;
    expect(
      hopRowText(1),
      `hop 1 came back unfetched; it was saved as ${savedLadder}, ` +
        `reopened as ${ladder()}`,
    ).to.not.contain("not fetched");
  });

  it("says so once when a version 4 record asked for both directions", async function () {
    this.timeout(120_000);
    // A version 4 row, written raw: the store always writes the current
    // version, so the fields version 5 added have to come back out by hand.
    const v4 = {
      ...emptyGraphViewState(),
      version: 4,
      explore: { direction: "both", locality: "all" },
    } as Record<string, unknown>;
    delete v4.hops;
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      V4_GRAPH_NAME,
      emptyGraphViewState(),
    );
    v4GraphID = summary.id;
    const db = getPluginDatabase();
    expect(db, "the plugin database is open").to.exist;
    await db!.queryAsync("UPDATE saved_graphs_v1 SET state = ? WHERE id = ?", [
      JSON.stringify(v4),
      summary.id,
    ]);

    v4TabID = await openSavedGraphFromFileMenu(hostTabID!, V4_GRAPH_NAME);
    const status = await waitFor(
      () => (statusText(v4TabID) === BOTH_NOTICE ? BOTH_NOTICE : null),
      40_000,
    );
    expect(
      status,
      `the toolbar of the version 4 graph read "${statusText(v4TabID)}"`,
    ).to.equal(BOTH_NOTICE);
    // The notice is sticky: it is still there once the graph has settled.
    await delay(3000);
    expect(
      statusText(v4TabID),
      "the migration notice is sticky, so it survives the status timeout",
    ).to.equal(BOTH_NOTICE);
  });
});
