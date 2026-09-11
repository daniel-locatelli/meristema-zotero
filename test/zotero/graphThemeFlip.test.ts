/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const APPEARANCE_PREF = "browser.theme.toolbar-theme";

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
 * B29 in the 2026-09-08 review backlog: switching Zotero's appearance from
 * light to dark repaints the rail but leaves the plot's own background light.
 * Walked through the plugin's own chrome, with nothing touching the graph
 * between the flip and the read: the plot must repaint on the flip alone.
 */
describe("Switching the appearance light → dark", function () {
  let win: any;
  let tabID: string | null = null;
  let original = 2;

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

  function pixel(x: number, y: number): [number, number, number, number] {
    const data = canvas()
      .getContext("2d")!
      .getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }

  function luma([r, g, b]: [number, number, number, number]): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    original = Services.prefs.getIntPref(APPEARANCE_PREF, 2);

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
    expect(tab, "the graph's tab").to.exist;
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
  });

  after(async function () {
    this.timeout(30_000);
    Services.prefs.setIntPref(APPEARANCE_PREF, original);
    await delay(300);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
  });

  it("repaints the plot's background dark on the flip alone", async function () {
    this.timeout(60_000);
    const plot = canvas();
    const view = plot.ownerDocument.defaultView as any;

    // The boundary watched: every full-canvas fill the renderer paints, with
    // the colour it used, so the log says whether a frame was drawn after the
    // flip and what theme it drew with.
    const fills: string[] = [];
    const proto = view.CanvasRenderingContext2D.prototype;
    const realFillRect = proto.fillRect;
    proto.fillRect = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      if (this.canvas === plot && w >= plot.width - 1 && h >= plot.height - 1) {
        fills.push(`${Date.now() % 100000}:${String(this.fillStyle)}`);
      }
      return realFillRect.call(this, x, y, w, h);
    };

    try {
      Services.prefs.setIntPref(APPEARANCE_PREF, 1);
      await delay(800);
      const centre = { x: plot.width / 2, y: plot.height / 2 };
      const lightCentre = pixel(centre.x, centre.y);
      const lightCorner = pixel(3, 3);
      const lightScheme = graphRoot().dataset.cmScheme;
      fills.push("--- flip to dark ---");

      Services.prefs.setIntPref(APPEARANCE_PREF, 0);
      await delay(1500);
      const darkCentre = pixel(centre.x, centre.y);
      const darkCorner = pixel(3, 3);
      const darkScheme = graphRoot().dataset.cmScheme;

      const evidence =
        `light: scheme=${lightScheme} centre=${lightCentre} corner=${lightCorner}; ` +
        `dark: scheme=${darkScheme} centre=${darkCentre} corner=${darkCorner}; ` +
        `bitmap ${plot.width}x${plot.height}; fills: ${fills.join(" | ")}`;
      Zotero.debug(`[graphThemeFlip] ${evidence}`);

      expect(darkScheme, `the chrome went dark (${evidence})`).to.equal("dark");
      expect(
        luma(darkCorner),
        `the plot's surround is dark after the flip (${evidence})`,
      ).to.be.below(100);
      expect(
        luma(darkCentre),
        `the plot's paper is dark after the flip (${evidence})`,
      ).to.be.below(100);
      expect(luma(lightCentre), "and was light before it").to.be.above(150);
    } finally {
      proto.fillRect = realFillRect;
    }
  });

  /**
   * The same flip through Automatic (pref 2): the scheme then comes from the
   * OS, not the pref, and whatever Zotero's own chrome paints is the truth
   * the plugin must agree with. On a dark OS this is light → dark as well.
   */
  it("follows the OS after a flip to Automatic", async function () {
    this.timeout(60_000);
    const plot = canvas();
    const view = plot.ownerDocument.defaultView as any;
    const systemDark = view.matchMedia("(-moz-system-dark-theme)");
    const osDark = (): boolean =>
      // A query made after the change reports the truth; the plugin must
      // agree with it once the change has had time to land.
      win.matchMedia("(prefers-color-scheme: dark)").matches;

    Services.prefs.setIntPref(APPEARANCE_PREF, 1);
    await delay(800);
    const lightScheme = graphRoot().dataset.cmScheme;
    const lightOS = osDark();
    const lightSystem = `${systemDark.media}/${systemDark.matches}`;

    Services.prefs.setIntPref(APPEARANCE_PREF, 2);
    // The scheme is read at the pref write, synchronously; the truth lands
    // later. Sample right away and again after it has had time to.
    const atWrite = graphRoot().dataset.cmScheme;
    const atWriteOS = osDark();
    await delay(1500);
    const autoScheme = graphRoot().dataset.cmScheme;
    const autoOS = osDark();
    const autoCentre = pixel(plot.width / 2, plot.height / 2);
    const autoSystem = `${systemDark.media}/${systemDark.matches}`;

    const evidence =
      `light: scheme=${lightScheme} os=${lightOS} system=${lightSystem}; ` +
      `at the write: scheme=${atWrite} os=${atWriteOS}; ` +
      `automatic after 1.5 s: scheme=${autoScheme} os=${autoOS} ` +
      `system=${autoSystem} centre=${autoCentre}`;
    Zotero.debug(`[graphThemeFlip] ${evidence}`);

    expect(lightScheme, `light first (${evidence})`).to.equal("light");
    expect(
      autoScheme,
      `the plugin's scheme follows the OS (${evidence})`,
    ).to.equal(autoOS ? "dark" : "light");
    expect(
      luma(autoCentre) < 100,
      `the plot's paper follows the OS (${evidence})`,
    ).to.equal(autoOS);
  });
});
