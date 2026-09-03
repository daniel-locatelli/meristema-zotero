/// <reference types="mocha" />
import { expect } from "chai";
import {
  BASE_LAYOUT,
  delay,
  frameDifference,
  makeCorpus,
  note,
  openViewStage,
  outputDirectory,
  railEntries,
  settle,
  writeReport,
  writeWindow,
  type ViewStage,
} from "./visualHarness";
import { setGraphAppearance } from "../../src/services/citationPreferences";
import { getGraphViewController } from "../../src/services/graphViewService";

const APPEARANCE_PREF = "browser.theme.toolbar-theme";

/**
 * The view as `renderGraphView` builds it.
 *
 * `graphVisual.test.ts` drives the renderer against a canvas the harness mounts
 * itself, which cannot see anything the view service wires. These checks call
 * the product's own entry point and look at the whole window, so the chrome,
 * the Key rail's refresh and the theme observer are watched rather than
 * described.
 */
describe("Graph view, as the product builds it", function () {
  let stage: ViewStage | null = null;
  const written: string[] = [];
  const notes: string[] = [];

  /**
   * Errors nobody caught, from anywhere but the view's own window.
   *
   * These are worth the trouble. Mocha fails whichever test happens to be
   * running when one arrives, and reports it with no message attached, so a
   * real fault shows up as a test that is simply, silently red. Both faults
   * this suite found — a ResizeObserver feedback loop in the renderer and a
   * synthetic pointer the harness itself was dispatching wrong — were invisible
   * until these were being read.
   */
  const elsewhere: string[] = [];

  before(function () {
    const record = (label: string) => (event: any) => {
      const reason = event?.reason ?? event?.error ?? event;
      elsewhere.push(
        `${label}: ${reason?.message ?? String(reason)} ${reason?.stack ?? ""}`,
      );
    };
    const host = Zotero.getMainWindows()[0] as any;
    host?.addEventListener("error", record("host error"));
    host?.addEventListener("unhandledrejection", record("host rejection"));
    (globalThis as any).addEventListener?.("error", record("global error"));
    (globalThis as any).addEventListener?.(
      "unhandledrejection",
      record("global rejection"),
    );

    // Every stage reads the persisted appearance, so pin it rather than
    // inherit whatever the last run of the other suite left behind.
    setGraphAppearance(BASE_LAYOUT);
  });

  after(async function () {
    this.timeout(15_000);
    stage?.close();
    stage = null;
    note(`${written.length} view frames in ${outputDirectory()}`);
    await writeReport(
      { directory: outputDirectory(), frames: written, notes },
      // The canvas suite writes its own; one name per suite or the second
      // one to finish erases the first one's trail.
      "report-view",
    );
  });

  afterEach(async function () {
    this.timeout(15_000);
    const escaped = [...(stage?.errors ?? []), ...elsewhere.splice(0)];
    if (escaped.length) {
      notes.push(
        `escaped from ${this.currentTest?.title}: ${escaped.join(" ;; ")}`,
      );
    }
    stage?.close();
    stage = null;
    await delay(120);
    expect(escaped, `the view threw in the background: ${escaped.join(" ;; ")}`)
      .to.be.empty;
  });

  async function open(nodes: number, missingYearShare = 0): Promise<ViewStage> {
    stage = await openViewStage(makeCorpus({ nodes, missingYearShare }));
    await settle(stage.window, 12);
    // The renderer fits itself on the way in, but that fit waits for a couple
    // of stable animation frames and Gecko does not service `requestAnimationFrame`
    // in an occluded window, so it never lands here — the frames came out
    // zoomed past the right of the graph, deterministically. Pressing the view's
    // own Fit button runs the same `fitView()` synchronously. It means the
    // arriving camera is the one thing these checks cannot speak for; that is
    // an occluded-window limit and not something the view does to a user.
    const fit = stage.root.querySelector(
      '.cm-zoom-controls button[data-action="fit"]',
    ) as HTMLButtonElement;
    fit.click();
    await settle(stage.window, 8);
    return stage;
  }

  async function shot(name: string): Promise<void> {
    if (!stage) return;
    written.push((await writeWindow(stage.window, name)) ?? "");
  }

  /** Whether anything was drawn, rather than whether a canvas exists. */
  function drawnPixels(stage: ViewStage): number {
    const context = stage.canvas.getContext("2d")!;
    const { width, height } = stage.canvas;
    const data = context.getImageData(0, 0, width, height).data;
    const first = [data[0], data[1], data[2]];
    let different = 0;
    // Every 40th pixel is plenty to tell a drawn plot from a flat fill.
    for (let index = 0; index < data.length; index += 160) {
      if (
        data[index] !== first[0] ||
        data[index + 1] !== first[1] ||
        data[index + 2] !== first[2]
      ) {
        different += 1;
      }
    }
    return different;
  }

  it("view 1 — the whole view builds from a snapshot and draws", async function () {
    this.timeout(60_000);
    const active = await open(220);

    expect(active.root.classList.contains("meristema-root")).to.equal(true);
    expect(active.canvas, "the view built its own canvas").to.not.equal(null);
    expect(
      active.canvas.width,
      "and gave it a backing store",
    ).to.be.greaterThan(0);
    expect(
      drawnPixels(active),
      "the canvas has a graph on it",
    ).to.be.greaterThan(200);

    // The header counts come from the snapshot and the model, not the renderer,
    // so they are the cheapest proof the two agree.
    const summary =
      active.root.querySelector(".cm-library-summary")?.textContent ?? "";
    expect(summary).to.contain(String(active.snapshot.papers.length));
    expect(summary).to.contain(String(active.model.edges.length));

    // The rail is mounted by the view here, not by the harness.
    const rail = active.root.querySelector(".cm-key-rail");
    expect(rail, "the Key rail is part of the view").to.not.equal(null);
    expect(railEntries(active.root).length).to.be.greaterThan(2);

    await shot("view-01-full");
    notes.push(`view 1 rail: ${railEntries(active.root).join(" | ")}`);
  });

  it("view 2 — the Key rail rebuilds as the view's state changes", async function () {
    this.timeout(60_000);
    const active = await open(220);
    const before = railEntries(active.root);
    expect(
      before.some((entry) => /Search match/i.test(entry)),
      "nothing is matched before a search",
    ).to.equal(false);

    const search = active.root.querySelector(
      "input.cm-search",
    ) as HTMLInputElement;
    // A word out of the corpus's own titles. The collection names are not in
    // the searchable text, which is what the first version of this got wrong.
    search.value = "Patterning";
    search.dispatchEvent(new (active.window as any).Event("input"));
    await settle(active.window, 8);

    const after = railEntries(active.root);
    notes.push(`view 2 after search: ${after.join(" | ")}`);
    expect(
      after.some((entry) => /Search match/i.test(entry)),
      "the search reaches the Key through updateSummary",
    ).to.equal(true);
    expect(
      after.some((entry) => /Filtered out/i.test(entry)),
      "and so does what the search hid",
    ).to.equal(true);
    expect(after).to.not.deep.equal(before);
    await shot("view-02-rail-after-search");

    search.value = "";
    search.dispatchEvent(new (active.window as any).Event("input"));
    await settle(active.window, 8);
    expect(
      railEntries(active.root).some((entry) => /Search match/i.test(entry)),
      "and clearing it puts the Key back",
    ).to.equal(false);
  });

  it("view 3 — a click on the graph releases a pinned Key entry", async function () {
    this.timeout(60_000);
    const active = await open(220);
    const entry = active.root.querySelector(
      "button.cm-key-entry",
    ) as HTMLButtonElement;
    expect(entry, "there is an entry that stands for papers").to.not.equal(
      null,
    );

    entry.click();
    await settle(active.window, 8);
    expect(
      entry.getAttribute("aria-pressed"),
      "clicking pins the emphasis",
    ).to.equal("true");
    await shot("view-03-pinned");

    // The release is wired in the view, not the rail: `onGraphAreaPointerDown`
    // calls `keyRail.release()` only when the canvas itself was hit.
    // A real pointer, not a constructed PointerEvent: the renderer captures the
    // pointer on the way down, and a synthetic event carries no valid pointer
    // id, so `setPointerCapture` throws out of the handler and fails whichever
    // test is running with no message on it.
    const rect = active.canvas.getBoundingClientRect();
    const utils = (active.window as any).windowUtils;
    const x = rect.left + 6;
    const y = rect.top + 6;
    utils.sendMouseEvent("mousedown", x, y, 0, 1, 0, false, 0, 0);
    utils.sendMouseEvent("mouseup", x, y, 0, 1, 0, false, 0, 0);
    await settle(active.window, 8);
    expect(
      entry.getAttribute("aria-pressed"),
      "and a click on the graph lets it go",
    ).to.equal("false");
    await shot("view-03-released");
  });

  it("view 5 — the plot toolbar is one row, and stays one row when narrow", async function () {
    this.timeout(60_000);
    const active = await open(200);
    const bar = active.root.querySelector(".cm-plot-toolbar") as HTMLElement;
    const view = active.window as any;

    expect(bar, "there is a plot toolbar").to.not.equal(null);
    for (const gone of [".cm-header", ".cm-query-band", ".cm-command-bar"]) {
      expect(
        active.root.querySelector(gone),
        `${gone} is one of the window-spanning bars this view no longer has`,
      ).to.equal(null);
    }

    // The heading left the layout but not the document.
    const heading = active.root.querySelector("h1") as HTMLElement;
    expect(heading, "the view still has a heading").to.not.equal(null);
    expect(heading.textContent).to.contain("Collection Graph");
    expect(
      view.getComputedStyle(heading).getPropertyValue("position"),
      "taken out of the flow rather than out of the tree",
    ).to.equal("absolute");
    expect(
      heading.hidden,
      "and never hidden from assistive technology",
    ).to.equal(false);

    /**
     * How many rows the bar's children occupy, counted by vertical overlap
     * rather than by matching tops: items of different heights on the same row
     * are centred differently, and comparing tops read that as a wrap.
     */
    const rows = (): number => {
      const bands: Array<{ top: number; bottom: number }> = [];
      for (const child of [...bar.children]) {
        const rect = (child as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const band = bands.find(
          (candidate) =>
            rect.top < candidate.bottom && rect.bottom > candidate.top,
        );
        if (band) {
          band.top = Math.min(band.top, rect.top);
          band.bottom = Math.max(band.bottom, rect.bottom);
        } else {
          bands.push({ top: rect.top, bottom: rect.bottom });
        }
      }
      return bands.length;
    };

    // The bar's geometry is the claim here, and that is DOM. The canvas in
    // these frames is not: Gecko delivers ResizeObserver notifications during
    // the same rendering step it starves in an occluded window, so the canvas
    // keeps its old bitmap and the graph appears squashed into the narrower
    // box. That is the harness's window being covered, not the view.
    const heights: string[] = [];
    for (const width of [1200, 900, 720, 560]) {
      active.window.resizeTo(width, 820);
      await settle(active.window, 8);
      const height = bar.getBoundingClientRect().height;
      heights.push(
        `${width}px wide: bar ${height.toFixed(0)}px, ${rows()} row`,
      );
      expect(rows(), `the bar wrapped at ${width}px`).to.equal(1);
      expect(height, `the bar grew past one row at ${width}px`).to.be.lessThan(
        56,
      );
      await shot(`view-05-bar-${width}`);
    }
    notes.push(`view 5 ${heights.join(" | ")}`);

    // A tab differs from a window only by `root.dataset.mode`, with nothing
    // keyed off it — but the plan asks for both, so both get looked at.
    stage!.close();
    stage = await openViewStage(makeCorpus({ nodes: 200 }), { mode: "tab" });
    await settle(stage.window, 12);
    const tabBar = stage.root.querySelector(".cm-plot-toolbar") as HTMLElement;
    expect(stage.root.dataset.mode).to.equal("tab");
    expect(
      tabBar.getBoundingClientRect().height,
      "the bar is the same one row in a tab",
    ).to.be.lessThan(56);
    await shot("view-05-bar-tab");
  });

  it("view 9 — the toolbars are Zotero's, one per pane", async function () {
    this.timeout(60_000);
    const active = await open(200);
    const view = active.window as any;
    const rail = active.root.querySelector(".cm-key-rail") as HTMLElement;
    const railToolbar = active.root.querySelector(
      ".cm-rail-toolbar",
    ) as HTMLElement;
    const plotToolbar = active.root.querySelector(
      ".cm-plot-toolbar",
    ) as HTMLElement;
    expect(railToolbar, "the rail has a toolbar of its own").to.not.equal(null);
    expect(plotToolbar, "and so does the plot").to.not.equal(null);

    const railRect = railToolbar.getBoundingClientRect();
    const plotRect = plotToolbar.getBoundingClientRect();

    // Zotero's `.toolbar` is 41px. This is what the complaint was about: with
    // one bar spanning the window the rail began below it, so the sidebar's
    // top edge sat at a different y than #zotero-collections-pane's and the
    // layout appeared to drop on switching to the graph.
    for (const [name, rect] of [
      ["rail", railRect],
      ["plot", plotRect],
    ] as const) {
      expect(
        Math.round(rect.height),
        `the ${name} toolbar is Zotero's 41px`,
      ).to.equal(41);
    }
    expect(
      Math.round(railRect.top),
      "the two toolbars start at the same y",
    ).to.equal(Math.round(plotRect.top));
    expect(
      Math.round(railRect.top),
      "and the rail's toolbar is the top of the rail, not a band above it",
    ).to.equal(Math.round(rail.getBoundingClientRect().top));
    expect(
      // The rail's 1px divider is inside its border box, so the toolbar fills
      // the 199px that leaves rather than the rail's own 200px.
      Math.round(rail.getBoundingClientRect().width - railRect.width),
      "the rail's toolbar fills the rail and goes no further",
    ).to.equal(1);

    /*
     * The two are painted differently, because Zotero paints them
     * differently. `--material-toolbar` is applied by
     * `#zotero-layout-switcher .zotero-toolbar`, and #zotero-collections-pane
     * is outside the layout switcher — so the collections toolbar keeps the
     * sidepane colour and the left column reads as one unbroken block. Getting
     * this wrong is visible: the rail grows a header of a different colour.
     */
    const railBackground = view.getComputedStyle(railToolbar).backgroundColor;
    const plotBackground = view.getComputedStyle(plotToolbar).backgroundColor;
    expect(railBackground, "the rail's toolbar is painted").to.not.equal(
      "rgba(0, 0, 0, 0)",
    );
    expect(
      railBackground,
      "in the same colour as the rail under it, with no seam",
    ).to.equal(view.getComputedStyle(rail).backgroundColor);
    expect(
      plotBackground,
      "while the plot's toolbar takes the toolbar colour",
    ).to.not.equal(railBackground);

    // The divider token is a border shorthand, so a colour slot has to read
    // --color-panedivider; getting that wrong drops the declaration silently.
    for (const [name, element, side] of [
      ["rail", rail, "borderRightWidth"],
      ["plot toolbar", plotToolbar, "borderBottomWidth"],
    ] as const) {
      // Not "1px": Gecko snaps a hairline to the device pixel grid, so a 1px
      // border computes to 0.8px at 1.25 dppx. That it is there at all is the
      // claim.
      expect(
        parseFloat(view.getComputedStyle(element)[side]),
        `the ${name} keeps its divider`,
      ).to.be.greaterThan(0);
    }
    expect(
      view.getComputedStyle(railToolbar).borderBottomColor,
      "and the rail's toolbar has no edge under it at all",
    ).to.equal("rgba(0, 0, 0, 0)");

    /*
     * The navigation glyphs are drawn, not typed. A text arrow sits on its
     * font's baseline and rides the maths axis, so it reads high in a centred
     * button however the button is aligned; an svg centred on its own viewBox
     * cannot. This asserts the geometry, which is what was actually wrong.
     */
    for (const selector of [
      ".cm-history-controls button:first-child",
      ".cm-history-controls button:last-child",
      ".cm-key-toggle",
    ]) {
      const button = active.root.querySelector(selector) as HTMLElement;
      const glyph = button.querySelector("svg") as SVGElement;
      expect(glyph, `${selector} draws its glyph`).to.not.equal(null);
      const buttonRect = button.getBoundingClientRect();
      const glyphRect = glyph.getBoundingClientRect();
      /*
       * Both axes. The horizontal one has its own trap: the shared button rule
       * is `.meristema-root button`, which outranks a bare class, so a square
       * icon button declared as one class keeps `padding: 4px 9px` and its
       * glyph sits against an edge. Any override here must match that
       * specificity.
       */
      for (const [axis, near, far] of [
        ["vertically", "top", "bottom"],
        ["horizontally", "left", "right"],
      ] as const) {
        const drift =
          (glyphRect[near] + glyphRect[far]) / 2 -
          (buttonRect[near] + buttonRect[far]) / 2;
        expect(
          Math.abs(drift),
          `${selector} centres its glyph ${axis}`,
        ).to.be.lessThan(0.6);
      }
    }

    const toggle = active.root.querySelector(".cm-key-toggle") as HTMLElement;
    expect(
      toggle.getAttribute("aria-label"),
      "the toggle names the whole sidebar, which is what it collapses",
    ).to.equal("Collapse sidebar");

    // The search sits at the right end of the plot's toolbar, as the quick
    // search does in #zotero-items-toolbar.
    const search = active.root.querySelector(
      ".cm-plot-toolbar .cm-search-wrap",
    ) as HTMLElement;
    const actions = active.root.querySelector(
      ".cm-plot-toolbar .cm-command-actions",
    ) as HTMLElement;
    expect(search, "the search is in the plot's toolbar").to.not.equal(null);
    expect(
      search.getBoundingClientRect().left,
      "with the action buttons gathered to its left",
    ).to.be.greaterThan(actions.getBoundingClientRect().right - 1);
    expect(
      plotRect.right - search.getBoundingClientRect().right,
      "and nothing but the toolbar's padding beyond it",
    ).to.be.lessThan(12);

    await shot("view-09-pane-toolbars");
  });

  it("view 6 — the zoom and appearance controls live in the rail", async function () {
    this.timeout(60_000);
    const active = await open(200);
    const rail = active.root.querySelector(".cm-key-rail") as HTMLElement;
    const zoom = active.root.querySelector(".cm-zoom-controls") as HTMLElement;
    const appearance = active.root.querySelector(
      ".cm-appearance-control",
    ) as HTMLElement;

    expect(
      rail.contains(zoom),
      "the zoom controls moved into the rail",
    ).to.equal(true);
    expect(
      rail.contains(appearance),
      "and so did the appearance control",
    ).to.equal(true);
    const graphArea = active.root.querySelector(
      ".cm-graph-area",
    ) as HTMLElement;
    expect(
      graphArea.contains(zoom) || graphArea.contains(appearance),
      "neither is left floating over the plot",
    ).to.equal(false);

    // Relocating them must not unwire them: the click listener sits on the
    // container, so it travels, but the graph has to actually respond.
    const pixels = (): Uint8ClampedArray =>
      active.canvas
        .getContext("2d")!
        .getImageData(0, 0, active.canvas.width, active.canvas.height).data;
    const before = pixels();
    (
      zoom.querySelector('button[data-action="in"]') as HTMLButtonElement
    ).click();
    await settle(active.window, 8);
    expect(
      frameDifference(before, pixels()),
      "zooming in from the rail still moves the graph",
    ).to.be.greaterThan(0.02);
    await shot("view-06-rail-controls");

    const button = appearance.querySelector("button") as HTMLButtonElement;
    button.click();
    await settle(active.window, 8);
    const panel = appearance.querySelector(
      ".cm-appearance-panel",
    ) as HTMLElement;
    expect(panel.hidden, "the appearance panel still opens").to.equal(false);
    const rect = panel.getBoundingClientRect();
    expect(rect.width, "with room to be read").to.be.greaterThan(200);
    expect(rect.top, "and it opens on screen, not off the top").to.be.at.least(
      0,
    );
    await shot("view-06-appearance-open");
  });

  it("view 7 — the Key names the folders in scope and no others", async function () {
    this.timeout(60_000);
    const active = await open(220);
    const controller = getGraphViewController(active.mount)!;

    // Every folder in the corpus, because nothing is filtered yet.
    const wide = railEntries(active.root);
    const named = (entries: string[], label: string): boolean =>
      entries.some((entry) => entry.startsWith(label));
    expect(
      named(wide, "Auxin transport"),
      "the whole library names it",
    ).to.equal(true);
    expect(named(wide, "Flowering"), "and names the rest too").to.equal(true);
    await shot("view-07-key-whole-library");

    // The context menu's "graph this folder" arrives here. It is a filter over
    // a library-wide model, which is exactly why the Key used to go on naming
    // folders that were no longer on screen.
    expect(controller.openCollections([3])).to.equal("selected");
    await settle(active.window, 10);

    const scoped = railEntries(active.root);
    notes.push(`view 7 rail in scope: ${scoped.join(" | ")}`);
    expect(
      named(scoped, "Auxin transport"),
      "the folder the graph was opened on is still named",
    ).to.equal(true);
    for (const absent of [
      "Meristem structure",
      "Phyllotaxis",
      "Stem cells",
      "Root apical meristem",
      "Flowering",
      "Methods",
    ]) {
      expect(
        named(scoped, absent),
        `${absent} has no papers on screen, so the Key must not name it`,
      ).to.equal(false);
    }
    await shot("view-07-key-one-folder");
  });

  it("view 8 — the rail is Zotero's own left pane", async function () {
    this.timeout(60_000);
    const active = await open(120);
    const view = active.window as any;
    const rail = active.root.querySelector(".cm-key-rail") as HTMLElement;
    const style = view.getComputedStyle(rail);
    const width = rail.getBoundingClientRect().width;
    notes.push(
      `view 8 rail: ${width}px background ${style.backgroundColor} border ${style.borderRightColor}`,
    );
    // #zotero-collections-pane is 200px wide and painted --material-sidepane.
    expect(width, "the rail matches Zotero's collections pane").to.equal(200);
    expect(
      style.backgroundColor,
      "and is painted, not left transparent",
    ).to.not.equal("rgba(0, 0, 0, 0)");
    expect(
      style.backgroundColor,
      "in the sidepane colour rather than the window's own",
    ).to.not.equal(view.getComputedStyle(active.root).backgroundColor);
    await shot("view-08-rail-chrome");
  });

  it("view 4 — the chrome follows Zotero's appearance in one step", async function () {
    this.timeout(60_000);
    const original = Services.prefs.getIntPref(APPEARANCE_PREF, 2);
    const active = await open(160);
    const view = active.window as any;
    const chromeBackground = (): string =>
      view
        .getComputedStyle(active.root)
        .getPropertyValue("background-color")
        .trim();
    try {
      Services.prefs.setIntPref(APPEARANCE_PREF, 1);
      await delay(300);
      await settle(active.window, 4);
      const light = chromeBackground();
      await shot("view-04-chrome-light");

      Services.prefs.setIntPref(APPEARANCE_PREF, 0);
      await delay(300);
      await settle(active.window, 4);
      const dark = chromeBackground();
      await shot("view-04-chrome-dark");

      notes.push(`view 4 chrome: light ${light} / dark ${dark}`);
      expect(light, "the chrome repainted, not just the canvas").to.not.equal(
        dark,
      );
      expect(light).to.not.equal("");
    } finally {
      Services.prefs.setIntPref(APPEARANCE_PREF, original);
      await delay(150);
    }
  });
});
