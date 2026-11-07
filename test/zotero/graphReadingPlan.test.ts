/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  READING_LIST_TAG,
  writeReadingList,
} from "../../src/readingFormat/readingList";
import {
  emptyReadState,
  READ_STATE_TAG,
  setState,
  writeReadState,
  type ReadStateDoc,
} from "../../src/readingFormat/readState";
import { delay } from "./visualHarness";

const FOLDER_NAME = "Reading R1";
const TITLES = {
  p1: "Reading R1 fixture P1",
  p2: "Reading R1 fixture P2",
  p3: "Reading R1 fixture P3",
} as const;
const P1_DOI = "10.1000/r1a";

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

/** A standalone note as Meristema Reading writes one, never selected. */
async function standaloneNote(
  html: string,
  tag: string,
  collectionID?: number,
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag(tag);
  if (collectionID) note.addToCollection(collectionID);
  await note.saveTx({ skipSelect: true });
  return note;
}

/**
 * The Reading plan view on a real reading list (spec section 3), walked
 * through the plugin's own chrome. The notes are written with the vendored
 * writers, so their HTML is byte for byte what Meristema Reading writes; the
 * graph reads them through its own notifier and loader, never an import. The
 * cases run in order against one graph: the second ticks the folder the third
 * and fourth rely on, and the fifth unticks it.
 */
describe("The Reading plan view", function () {
  let win: any;
  let tabID: string | null = null;
  let collectionID: number | null = null;
  const papers: Record<keyof typeof TITLES, Zotero.Item | null> = {
    p1: null,
    p2: null,
    p3: null,
  };
  let listNote: Zotero.Item | null = null;
  let stateNote: Zotero.Item | null = null;
  let stateDoc: ReadStateDoc | null = null;

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

  function chip(): HTMLButtonElement {
    const button = graphRoot().querySelector(
      ".cm-view-chip",
    ) as HTMLButtonElement | null;
    expect(button, "the View chip").to.exist;
    return button as HTMLButtonElement;
  }

  function chipName(): string {
    return normalize(
      graphRoot().querySelector(".cm-view-chip-name")?.textContent,
    );
  }

  function menuOpen(): boolean {
    const live = graphRoot().querySelector(
      ".cm-view-menu",
    ) as HTMLElement | null;
    return Boolean(live) && !live!.hidden;
  }

  async function closeChipMenu(): Promise<void> {
    await waitFor(() => {
      if (!menuOpen()) return true;
      chip().click();
      return false;
    }, 10_000);
  }

  function viewRow(): HTMLButtonElement | null {
    return graphRoot().querySelector(
      '.cm-view-row[data-view-id="reading-plan"]',
    ) as HTMLButtonElement | null;
  }

  function rowEvidence(): string {
    const row = viewRow();
    if (!row) return "no reading-plan row";
    return `aria-disabled=${row.getAttribute("aria-disabled")} text "${normalize(row.textContent)}"`;
  }

  /**
   * Reopens the dropdown until the reading-plan row reads `disabled`: the rows
   * are drawn when the menu opens, and the plan they read lands on a debounced
   * reload, so a menu opened a moment early shows the state before it.
   */
  async function rowSettlesTo(disabled: boolean): Promise<HTMLButtonElement> {
    const row = await waitFor(() => {
      const live = viewRow();
      if (
        menuOpen() &&
        live &&
        (live.getAttribute("aria-disabled") === "true") === disabled
      ) {
        return live;
      }
      // Shuts a menu drawn too early, or opens a fresh one.
      chip().click();
      return null;
    }, 15_000);
    expect(
      row,
      `the reading-plan row never read disabled=${disabled}; ${rowEvidence()}`,
    ).to.exist;
    return row as HTMLButtonElement;
  }

  function scopeCheck(): HTMLInputElement {
    const body = graphRoot().querySelector(
      `.cm-scope-row [data-collection-id="${collectionID}"]`,
    ) as HTMLElement | null;
    expect(body, `a Scope row for ${FOLDER_NAME}`).to.exist;
    const box = body!.parentElement?.querySelector(
      ".cm-scope-check",
    ) as HTMLInputElement | null;
    expect(box, `the tick box of ${FOLDER_NAME}`).to.exist;
    return box as HTMLInputElement;
  }

  function setTicked(ticked: boolean): void {
    const box = scopeCheck();
    if (box.checked === ticked) return;
    box.checked = ticked;
    box.dispatchEvent(new win.Event("change"));
  }

  /** The gear's selects that offer `value`: x before y for an axis metric. */
  function selectsOffering(value: string): HTMLSelectElement[] {
    return (
      Array.from(
        graphRoot().querySelectorAll(".cm-appearance-panel select"),
      ) as HTMLSelectElement[]
    ).filter((select) =>
      (Array.from(select.options) as HTMLOptionElement[]).some(
        (option) => option.value === value,
      ),
    );
  }

  /** The Key's colour section, as subheading and label → count. */
  function readStateKey(): { text: string; counts: Record<string, number> } {
    const sections = Array.from(
      graphRoot().querySelectorAll(".cm-key-section"),
    ) as HTMLElement[];
    const section = sections.find(
      (candidate) =>
        normalize(
          candidate.querySelector(".cm-key-subheading")?.textContent,
        ) === "Read state",
    );
    if (!section) {
      return {
        text: `no Read state section; subheadings ${sections
          .map((s) =>
            normalize(s.querySelector(".cm-key-subheading")?.textContent),
          )
          .join(" | ")}`,
        counts: {},
      };
    }
    const counts: Record<string, number> = {};
    for (const entry of Array.from(
      section.querySelectorAll(".cm-key-entry"),
    ) as HTMLElement[]) {
      const label = normalize(
        entry.querySelector(".cm-key-entry-label")?.textContent,
      );
      const count = normalize(
        entry.querySelector(".cm-key-entry-count")?.textContent,
      );
      counts[label] = Number(count.replace(/\D/g, "") || "NaN");
    }
    return { text: normalize(section.textContent), counts };
  }

  async function keySettlesTo(
    expected: Record<string, number>,
    evidence: () => string = () => "",
  ): Promise<void> {
    const matches = (): boolean => {
      const { counts } = readStateKey();
      return Object.entries(expected).every(
        ([label, count]) => counts[label] === count,
      );
    };
    await waitFor(() => matches(), 15_000);
    const seen = readStateKey();
    expect(
      Object.fromEntries(
        Object.keys(expected).map((label) => [label, seen.counts[label]]),
      ),
      `the Key read "${seen.text}"${evidence()}`,
    ).to.deep.equal(expected);
  }

  /**
   * Where each fixture paper sits across the plot, in CSS pixels. Hovering a
   * node names it in the canvas's ARIA description, its title on the first
   * line, so the walk moves the pointer over the plot in whole pixels and
   * keeps the mean x of every point that named a fixture paper.
   */
  function fixturePositions(): Record<string, number> {
    const canvas = graphRoot().querySelector(
      "canvas.cm-graph-canvas",
    ) as HTMLCanvasElement;
    expect(canvas, "the plot canvas").to.exist;
    const box = canvas.getBoundingClientRect();
    const left = Math.ceil(box.left);
    const top = Math.ceil(box.top);
    const sums = new Map<string, { x: number; n: number }>();
    const wanted = new Set<string>(Object.values(TITLES));
    for (let y = top + 4; y < box.bottom - 4; y += 4) {
      for (let x = left + 4; x < box.right - 4; x += 4) {
        canvas.dispatchEvent(
          new win.PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        );
        const title = (canvas.getAttribute("aria-description") ?? "").split(
          "\n",
        )[0];
        if (!wanted.has(title)) continue;
        const sum = sums.get(title) ?? { x: 0, n: 0 };
        sum.x += x;
        sum.n += 1;
        sums.set(title, sum);
      }
    }
    canvas.dispatchEvent(
      new win.PointerEvent("pointerleave", { bubbles: true }),
    );
    return Object.fromEntries(
      [...sums].map(([title, sum]) => [title, sum.x / sum.n]),
    );
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    // A graph that has never chosen a view opens on the gallery; the cases
    // read the View chip's dropdown, so the gallery is waved off below.
    Zotero.Prefs.clear(`${config.prefsPrefix}.graphViews`, true);
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = FOLDER_NAME;
    collectionID = await collection.saveTx();
    for (const id of ["p1", "p2", "p3"] as const) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", TITLES[id]);
      item.setField("date", "2020");
      if (id === "p1") item.setField("DOI", P1_DOI);
      item.addToCollection(collectionID);
      await item.saveTx({ skipSelect: true });
      papers[id] = item;
    }
    const p1 = papers.p1!;
    const p2 = papers.p2!;
    const labels = new Map([
      [p1.key, TITLES.p1],
      [p2.key, TITLES.p2],
    ]);
    listNote = await standaloneNote(
      writeReadingList(
        {
          version: 1,
          topic: FOLDER_NAME,
          steps: [
            { key: p2.key, why: "The groundwork" },
            { key: p1.key, why: "" },
          ],
        },
        (key) => labels.get(key) ?? key,
        { kind: "user" },
      ),
      READING_LIST_TAG,
      collectionID ?? undefined,
    );
    stateDoc = setState(
      setState(
        emptyReadState(),
        `doi:${P1_DOI}`,
        "read",
        new Date(Date.now() - 60_000).toISOString(),
      ),
      `user:${p2.key}`,
      "reading",
      new Date().toISOString(),
    );
    stateNote = await standaloneNote(writeReadState(stateDoc), READ_STATE_TAG);

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
    const row = await waitFor(
      () =>
        tabContent()?.querySelector(
          `.cm-scope-row [data-collection-id="${collectionID}"]`,
        ),
      30_000,
    );
    expect(row, `the Scope row of ${FOLDER_NAME}`).to.exist;
    const gallery = await waitFor(() => {
      const section = graphRoot().querySelector(
        ".cm-view-gallery",
      ) as HTMLElement | null;
      return section && !section.hidden ? section : null;
    }, 10_000);
    if (gallery) {
      const blank = (
        Array.from(gallery.querySelectorAll("button")) as HTMLButtonElement[]
      ).find((button) => normalize(button.textContent) === "Start blank");
      blank?.click();
      await waitFor(() => gallery.hidden, 5_000);
    }
  });

  /*
   * Every step runs whatever the cases left, so no state note survives into
   * another suite's profile; the first error is rethrown once all is done.
   */
  after(async function () {
    this.timeout(30_000);
    let failure: unknown = null;
    const attempt = async (step: () => unknown): Promise<void> => {
      try {
        await step();
      } catch (error) {
        if (failure === null) failure = error;
      }
    };
    await attempt(async () => {
      if (tabID) win.Zotero_Tabs.close(tabID);
      await delay(300);
    });
    await attempt(() =>
      win.ZoteroPane.collectionsView.selectLibrary(
        Zotero.Libraries.userLibraryID,
      ),
    );
    for (const item of [stateNote, listNote, papers.p1, papers.p2, papers.p3]) {
      if (item) await attempt(() => Zotero.Items.erase(item.id));
    }
    stateNote = null;
    listNote = null;
    papers.p1 = papers.p2 = papers.p3 = null;
    await attempt(async () => {
      if (collectionID === null) return;
      const collection = Zotero.Collections.get(collectionID) as any;
      if (collection) await collection.eraseTx();
    });
    Zotero.Prefs.clear(`${config.prefsPrefix}.graphViews`, true);
    if (failure !== null) throw failure;
  });

  it("greys the Reading plan row while no ticked folder holds a list", async function () {
    this.timeout(30_000);
    // A new graph opens with every folder ticked, so the folder is unticked
    // first: the row reads the ticks, not the folder's mere presence.
    setTicked(false);
    const row = await rowSettlesTo(true);
    expect(normalize(row.textContent), rowEvidence()).to.contain(
      "Needs a reading list in a ticked folder",
    );
    await closeChipMenu();
  });

  it("offers the view once the folder is ticked, and applies it", async function () {
    this.timeout(45_000);
    setTicked(true);
    const row = await rowSettlesTo(false);
    expect(normalize(row.textContent), rowEvidence()).to.not.contain(
      "Needs a reading list",
    );
    row.click();
    await waitFor(() => chipName().includes("Reading plan"), 10_000);
    expect(chipName(), "the chip names the view").to.equal("Reading plan");
    await closeChipMenu();

    const xSelect = selectsOffering("reading-step")[0];
    expect(xSelect, "the gear's x select").to.exist;
    expect(xSelect.value, "the gear's x").to.equal("reading-step");
    const colour = selectsOffering("read-state")[0];
    expect(colour, "the gear's colour select").to.exist;
    expect(colour.value, "the gear's colour").to.equal("read-state");
    // P3 Unread, P2 Reading, P1 Read.
    await keySettlesTo({ Unread: 1, Reading: 1, Read: 1 });
  });

  it("places the papers along x in reading order", async function () {
    this.timeout(45_000);
    let positions: Record<string, number> = {};
    const placed = (): boolean => {
      positions = fixturePositions();
      return (
        Object.keys(positions).length === 3 &&
        positions[TITLES.p2] < positions[TITLES.p1] &&
        positions[TITLES.p1] < positions[TITLES.p3]
      );
    };
    // The layout may still be easing into the view's axes.
    const deadline = Date.now() + 20_000;
    while (!placed() && Date.now() < deadline) await delay(500);
    const order = Object.entries(positions)
      .sort((a, b) => a[1] - b[1])
      .map(([title, x]) => `${title} @${x.toFixed(1)}`);
    expect(
      order.map((entry) => entry.split(" @")[0]),
      `left to right: ${order.join(", ") || "no fixture paper found"}; Key "${readStateKey().text}"`,
    ).to.deep.equal([TITLES.p2, TITLES.p1, TITLES.p3]);
  });

  it("follows an edit to the read-state note", async function () {
    this.timeout(30_000);
    const rootBefore = graphRoot();
    const keyBefore = readStateKey().text;
    stateDoc = setState(
      stateDoc!,
      `user:${papers.p3!.key}`,
      "read",
      new Date().toISOString(),
    );
    stateNote!.setNote(writeReadState(stateDoc));
    await stateNote!.saveTx({ skipSelect: true });
    await keySettlesTo(
      { Reading: 1, Read: 2 },
      () =>
        `; before the edit "${keyBefore}"; root replaced ${graphRoot() !== rootBefore}` +
        `; ticked ${scopeCheck().checked}; chip "${chipName()}"` +
        `; recent errors: ${(Zotero.getErrors(true) as string[]).slice(-3).join(" || ") || "none"}`,
    );
    expect(
      readStateKey().counts.Unread ?? 0,
      `no paper is left unread; Key "${readStateKey().text}"`,
    ).to.equal(0);
  });

  it("greys the row again once the folder is unticked", async function () {
    this.timeout(30_000);
    setTicked(false);
    const row = await rowSettlesTo(true);
    expect(normalize(row.textContent), rowEvidence()).to.contain(
      "Needs a reading list in a ticked folder",
    );
    await closeChipMenu();
  });
});
