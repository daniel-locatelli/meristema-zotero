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
import {
  getGraphViewController,
  renderGraphView,
} from "../../src/services/graphViewService";

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

    // A seedless graph has no seeds to show, but the Seeds button is how the
    // first one is added, so it stays live. Direction and scope wait behind
    // the gear, and only appear once there is a seed to explore from.
    const seeds = active.root.querySelector(
      'button[aria-controls="meristema-focus-seed-popover"]',
    ) as HTMLButtonElement;
    expect(seeds, "there is a Seeds button").to.not.equal(null);
    expect(seeds.disabled, "and it is enabled while seedless").to.equal(false);
    expect(
      active.root.querySelector(
        'button[aria-controls="meristema-focus-settings-popover"]',
      ),
      "the toolbar has no Explore button",
    ).to.equal(null);
    const explore = active.root.querySelector(
      ".cm-appearance-panel .cm-explore-section",
    ) as HTMLElement;
    expect(explore, "the gear panel has the Explore section").to.not.equal(
      null,
    );
    expect(explore.hidden, "hidden while seedless").to.equal(true);
    expect(
      explore.querySelectorAll("select").length,
      "with direction and scope only",
    ).to.equal(2);
    expect(
      active.root.querySelector(".cm-add-node-wrap"),
      "Add Node is gone",
    ).to.equal(null);

    // The heading left the layout but not the document.
    const heading = active.root.querySelector("h1") as HTMLElement;
    expect(heading, "the view still has a heading").to.not.equal(null);
    expect(heading.textContent).to.equal("Graph");
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
     * The toggle glyph is drawn, not typed. A text chevron sits on its font's
     * baseline, so it reads high in a centred button however the button is
     * aligned; an svg centred on its own viewBox cannot. This asserts the
     * geometry, which is what was actually wrong.
     */
    for (const selector of [".cm-key-toggle"]) {
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

    // The search icon sits inside the field, so it lines up with the text in
    // it rather than with the field's box.
    const searchIcon = active.root.querySelector(
      ".cm-plot-toolbar .cm-search-wrap > .cm-icon",
    ) as SVGElement;
    const searchField = active.root.querySelector(
      ".cm-plot-toolbar .cm-search",
    ) as HTMLElement;
    const iconRect = searchIcon.getBoundingClientRect();
    const fieldRect = searchField.getBoundingClientRect();
    notes.push(
      `view 9 search icon ${iconRect.top.toFixed(1)}–${iconRect.bottom.toFixed(1)} in field ${fieldRect.top.toFixed(1)}–${fieldRect.bottom.toFixed(1)}`,
    );
    expect(
      Math.abs(
        (iconRect.top + iconRect.bottom) / 2 -
          (fieldRect.top + fieldRect.bottom) / 2,
      ),
      "the search icon is centred against the text beside it",
    ).to.be.lessThan(0.6);
    /*
     * And the field is the toolbar's 28px, which is what the icon was really
     * reporting: `.meristema-root input[type="search"]` carries a
     * `min-height: 30px` that outranks a two-class rule, so the field grew
     * past its wrap and hung below the toolbar's row while the icon stayed
     * centred in the wrap.
     */
    expect(
      Math.round(fieldRect.height),
      "and the field is the toolbar's own height, not the shared field height",
    ).to.equal(28);
    expect(
      Math.round(fieldRect.bottom),
      "so it ends inside the toolbar rather than hanging below it",
    ).to.be.at.most(Math.round(plotRect.bottom));

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

    /*
     * The rail's four buttons draw their glyphs for the same reason the
     * navigation ones do (view 9): "+", "−", "⌖" and "⚙" were text, and text
     * sits on the font's baseline, not in the middle of the button. The gear
     * and the crosshair were the worst of it — no two interface fonts draw
     * those characters the same size or in the same place.
     */
    for (const button of [
      ...zoom.querySelectorAll("button"),
      appearance.querySelector("button")!,
    ] as HTMLElement[]) {
      const glyph = button.querySelector("svg") as SVGElement;
      expect(
        glyph,
        `${button.getAttribute("aria-label")} draws its glyph`,
      ).to.not.equal(null);
      const buttonRect = button.getBoundingClientRect();
      const glyphRect = glyph.getBoundingClientRect();
      for (const [axis, near, far] of [
        ["vertically", "top", "bottom"],
        ["horizontally", "left", "right"],
      ] as const) {
        const drift =
          (glyphRect[near] + glyphRect[far]) / 2 -
          (buttonRect[near] + buttonRect[far]) / 2;
        expect(
          Math.abs(drift),
          `${button.getAttribute("aria-label")} centres its glyph ${axis}`,
        ).to.be.lessThan(0.6);
      }
    }

    /*
     * And both menus dismiss on a click outside them, the way every other menu
     * in Zotero does. The appearance panel's closer used to live on the graph
     * area, so once the control moved into the rail's footer nothing outside
     * the plot reached it and the only way out was the button again.
     */
    const utils = (active.window as any).windowUtils;
    const elsewhere = (): void => {
      // The plot toolbar's own padding: inside the view, outside both controls
      // and on no button.
      const bar = active.root.querySelector(".cm-plot-toolbar") as HTMLElement;
      const barRect = bar.getBoundingClientRect();
      const x = barRect.left + 2;
      const y = barRect.top + barRect.height / 2;
      utils.sendMouseEvent("mousedown", x, y, 0, 1, 0, false, 0, 0);
      utils.sendMouseEvent("mouseup", x, y, 0, 1, 0, false, 0, 0);
    };

    expect(panel.hidden, "the appearance panel is open to begin with").to.equal(
      false,
    );
    elsewhere();
    await settle(active.window, 8);
    expect(
      panel.hidden,
      "and a pointer outside it closes it, without pressing its button again",
    ).to.equal(true);

    const exportMenu = active.root.querySelector(
      ".cm-export-menu",
    ) as HTMLElement;
    const exportButton = exportMenu.parentElement!.querySelector(
      "button",
    ) as HTMLButtonElement;
    exportButton.click();
    await settle(active.window, 8);
    expect(exportMenu.hidden, "the export menu opens").to.equal(false);
    elsewhere();
    await settle(active.window, 8);
    expect(exportMenu.hidden, "and closes the same way").to.equal(true);
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

  it("view 10 — the detail panel is Zotero's item pane", async function () {
    this.timeout(60_000);
    // A paper with everything the panel can draw: a title that has to wrap, a
    // creator line, every badge, and counts long enough to fill a tab label.
    const corpus = makeCorpus({ nodes: 140 });
    const subject = corpus.nodes[0]!;
    subject.title =
      "Auxin transport and the maintenance of the shoot apical meristem across angiosperm lineages";
    subject.authors = ["Reinhardt, D.", "Pesce, E.-R.", "Stieger, P."];
    subject.sourceTitle = "Nature Plants";
    subject.year = 2018;
    subject.doi = "10.1000/harness.demo";
    subject.citationCount = 1284;
    subject.referenceCount = 57;
    subject.citationVelocity = 183.4;
    subject.fwci = 4.21;
    subject.citationPercentile = 0.992;
    subject.isOpenAccess = true;
    subject.isTop1Percent = true;
    subject.provider = "openalex";
    subject.metricsUpdatedAt = new Date("2026-08-30T09:15:00Z").toISOString();

    stage = await openViewStage(corpus);
    const active = stage;
    await settle(active.window, 10);
    (
      active.root.querySelector(
        '.cm-zoom-controls button[data-action="fit"]',
      ) as HTMLButtonElement
    ).click();
    await settle(active.window, 6);
    const controller = getGraphViewController(active.mount);
    expect(controller, "the view published a controller").to.not.equal(null);
    controller!.revealItem(subject.itemID);
    await settle(active.window, 10);

    const panel = active.root.querySelector(".cm-detail-panel") as HTMLElement;
    const header = active.root.querySelector(
      ".cm-detail-header",
    ) as HTMLElement;
    expect(header, "the panel has a header of its own").to.not.equal(null);
    expect(header.textContent, "which names the selected paper").to.contain(
      "Auxin transport",
    );

    // One band across the window, not two and a half: the three panes'
    // toolbars share a top and a bottom edge, and the header starts under
    // them, so the rule under the band runs the width of the window whatever
    // the length of the paper's title.
    const bands = [
      ".cm-rail-toolbar",
      ".cm-plot-toolbar",
      ".cm-detail-toolbar",
    ].map((selector) =>
      (
        active.root.querySelector(selector) as HTMLElement
      ).getBoundingClientRect(),
    );
    const headerRect = header.getBoundingClientRect();
    notes.push(
      `view 10 band ${bands.map((rect) => `${rect.top.toFixed(1)}–${rect.bottom.toFixed(1)}`).join(" ")} header top ${headerRect.top.toFixed(1)}`,
    );
    for (const rect of bands.slice(1)) {
      expect(
        Math.abs(rect.top - bands[0]!.top),
        "every pane's toolbar starts at the same y",
      ).to.be.lessThan(1.5);
      expect(
        Math.abs(rect.bottom - bands[0]!.bottom),
        "and ends at the same y",
        // Gecko snaps a hairline to the device pixel grid, so a 41px box with
        // a border under it can land a fraction either side at 1.25 dppx.
      ).to.be.lessThan(1.5);
    }
    expect(
      headerRect.top,
      "the header hangs under the band rather than filling it",
    ).to.be.greaterThan(bands[2]!.bottom - 1.5);

    /*
     * The right pane is one column of one colour. Its toolbar wears the
     * sidepane fill, not `--material-toolbar`, so there is no step between the
     * tab row and the title under it — the same way the Key rail's toolbar is
     * seamless with the rail. Only the middle pane sits inside Zotero's layout
     * switcher, and only the middle pane takes the toolbar fill.
     */
    const styles = active.window as unknown as Window;
    const fill = (node: Element): string =>
      styles.getComputedStyle(node)!.backgroundColor;
    const toolbarFill = fill(
      active.root.querySelector(".cm-detail-toolbar") as HTMLElement,
    );
    const shellFill = fill(
      active.root.querySelector(".cm-detail-shell") as HTMLElement,
    );
    notes.push(
      `view 10 detail fills: toolbar ${toolbarFill}, pane ${shellFill}`,
    );
    expect(
      toolbarFill,
      "the detail toolbar is painted with the pane under it",
    ).to.equal(shellFill);
    expect(
      fill(active.root.querySelector(".cm-detail-header") as HTMLElement),
      "and so is the header",
    ).to.equal(shellFill);

    /** Controls whose text is wider than the box drawn around them. */
    const overflowing = (): string[] =>
      ([...panel.querySelectorAll("button")] as HTMLButtonElement[])
        .filter((button) => button.scrollWidth > button.clientWidth + 1)
        .map(
          (button) =>
            `${(button.textContent ?? "").trim()} ${button.clientWidth}<${button.scrollWidth}`,
        );
    /** Controls that stand outside the pane they are in. */
    const past = (): string[] => {
      const bounds = panel.getBoundingClientRect();
      return ([...panel.querySelectorAll("button")] as HTMLButtonElement[])
        .filter(
          (button) => button.getBoundingClientRect().right > bounds.right + 1,
        )
        .map((button) => (button.textContent ?? "").trim());
    };
    /** A tab that wrapped is a tab that did not fit. */
    const tabHeights = (): number[] =>
      (
        [
          ...panel.querySelectorAll(".cm-detail-tabs button"),
        ] as HTMLButtonElement[]
      ).map((button) => button.getBoundingClientRect().height);

    /*
     * Both panes' collapse toggles sit at their inner edge — the one facing
     * the plot — so they flank it and both point outward. The detail pane's
     * used to sit at the far end of its toolbar, where a chevron beside a tab
     * row reads as an overflow control rather than a pane control.
     */
    const detailToolbar = active.root.querySelector(
      ".cm-detail-toolbar",
    ) as HTMLElement;
    const detailToggle = active.root.querySelector(
      ".cm-detail-toggle",
    ) as HTMLElement;
    const railToggle = active.root.querySelector(
      ".cm-key-toggle",
    ) as HTMLElement;
    expect(
      detailToolbar.firstElementChild,
      "the detail toggle opens its toolbar, before the tabs",
    ).to.equal(detailToggle);
    const plot = active.root.querySelector(".cm-plot-toolbar") as HTMLElement;
    const plotRect = plot.getBoundingClientRect();
    const railGap = plotRect.left - railToggle.getBoundingClientRect().right;
    const detailGap =
      detailToggle.getBoundingClientRect().left - plotRect.right;
    notes.push(
      `view 10 toggles: rail ${railGap.toFixed(1)}px from the plot, detail ${detailGap.toFixed(1)}px`,
    );
    // And they are the same size. The rail's chevron was drawn at 14px and the
    // detail pane's at createIcon's 16px default, which is visibly larger in
    // the same 26px box when the two are read as a pair across one window.
    const glyphs = [railToggle, detailToggle].map((toggle) => {
      const svg = toggle.querySelector("svg") as SVGSVGElement;
      const rect = svg.getBoundingClientRect();
      return `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`;
    });
    notes.push(`view 10 toggle glyphs: ${glyphs.join(" and ")}`);
    expect(glyphs[1], "both toggles draw the same chevron").to.equal(glyphs[0]);
    for (const gap of [railGap, detailGap]) {
      expect(
        gap,
        "each toggle sits against the plot, not at the window's edge",
      ).to.be.lessThan(20);
    }

    /*
     * The headline strip: three values on one row, three labels on the next.
     */
    const strip = active.root.querySelector(".cm-metric-strip") as HTMLElement;
    expect(strip, "the overview leads with the metric strip").to.not.equal(
      null,
    );
    const values = [...strip.querySelectorAll("dd")] as HTMLElement[];
    const labels = [...strip.querySelectorAll("dt")] as HTMLElement[];
    expect(values.length, "three figures, and only three").to.equal(3);
    notes.push(
      `view 10 strip: ${labels.map((label) => (label.textContent ?? "").trim()).join(" | ")} = ${values.map((value) => (value.textContent ?? "").trim()).join(" | ")}`,
    );
    for (const cell of [...values.slice(1), ...labels.slice(1)]) {
      const first =
        cell.tagName === values[0]!.tagName ? values[0]! : labels[0]!;
      expect(
        Math.abs(
          cell.getBoundingClientRect().bottom -
            first.getBoundingClientRect().bottom,
        ),
        "values share a row and labels share the row under it",
      ).to.be.lessThan(1.5);
    }
    const advanced = active.root.querySelector(
      ".cm-advanced-details > summary",
    ) as HTMLElement | null;
    expect(
      advanced,
      "and the rest of the registry is behind Advanced",
    ).to.not.equal(null);

    /*
     * One action, and one only. "Show in Zotero" repeated the double-click on
     * the circle, "Open DOI" repeated the identifier in the header, "Open in"
     * swapped the whole view, and "Refresh" repeated the toolbar's.
     */
    const actionBar = active.root.querySelector(
      ".cm-detail-body .cm-detail-actions",
    ) as HTMLElement;
    const actions = (
      [...actionBar.querySelectorAll("button")] as HTMLButtonElement[]
    ).map((button) => (button.textContent ?? "").trim());
    notes.push(`view 10 actions: ${actions.join(" | ") || "none"}`);
    expect(actions, "the overview offers one action").to.deep.equal([
      "Find similar papers",
    ]);

    // And the DOI is in the header, as the link it always was.
    const doi = active.root.querySelector(
      ".cm-detail-header .cm-detail-doi",
    ) as HTMLAnchorElement | null;
    expect(doi?.textContent, "the header carries the DOI").to.equal(
      "10.1000/harness.demo",
    );

    const wide = { overflow: overflowing(), out: past(), tabs: tabHeights() };
    notes.push(
      `view 10 at 360px: overflowing ${wide.overflow.join(" | ") || "none"}; past the pane ${wide.out.join(" | ") || "none"}; tabs ${wide.tabs.map((height) => height.toFixed(1)).join("/")}`,
    );
    await shot("view-10-detail-360");

    // And the same panel at its narrowest, which is where it has to hold up.
    const shell = active.root.querySelector(".cm-detail-shell") as HTMLElement;
    shell.style.width = "260px";
    await settle(active.window, 6);
    await shot("view-10-detail-260");
    const narrow = { overflow: overflowing(), out: past(), tabs: tabHeights() };
    notes.push(
      `view 10 at 260px: overflowing ${narrow.overflow.join(" | ") || "none"}; past the pane ${narrow.out.join(" | ") || "none"}; tabs ${narrow.tabs.map((height) => height.toFixed(1)).join("/")}`,
    );

    // The other two views of the same pane: a relationship list, which clears
    // the body and has to name the header again, and the whole thing in the
    // light scheme, where the header's rule and the hairlines between the
    // sections are the parts that can go wrong.
    shell.style.width = "360px";
    await settle(active.window, 4);
    (
      panel.querySelector(
        '.cm-detail-tabs button[data-mode="cited-by"]',
      ) as HTMLButtonElement
    ).click();
    await settle(active.window, 8);
    expect(
      (active.root.querySelector(".cm-detail-header") as HTMLElement)
        .textContent,
      "the header still names the paper the list belongs to",
    ).to.contain("Auxin transport");
    await shot("view-10-cited-by");

    /*
     * The light scheme gets its own stage rather than a repaint of this one.
     * Flipping the appearance under an open harness window repaints the plot —
     * the renderer redraws from the new theme — but the chrome around it kept
     * the scheme it was built with, so the capture came out light inside dark.
     * A window opened after the pref is set has one scheme throughout, which is
     * what a user's window has; view 4 is where the live flip is checked.
     */
    const originalAppearance = Services.prefs.getIntPref(APPEARANCE_PREF, 2);
    try {
      Services.prefs.setIntPref(APPEARANCE_PREF, 1);
      await delay(400);
      active.close();
      stage = await openViewStage(makeCorpus({ nodes: 60 }));
      const light = stage;
      await settle(light.window, 10);
      getGraphViewController(light.mount)!.revealItem(
        light.model.nodes[0]!.itemID,
      );
      await settle(light.window, 10);
      notes.push(
        `view 10 light chrome: ${(light.window as any).getComputedStyle(light.root).backgroundColor}`,
      );
      await shot("view-10-detail-light");
    } finally {
      Services.prefs.setIntPref(APPEARANCE_PREF, originalAppearance);
      await delay(150);
    }

    for (const [width, measured] of [
      ["360px", wide],
      ["260px", narrow],
    ] as const) {
      expect(
        measured.overflow,
        `at ${width}, text spills out of: ${measured.overflow.join(" | ")}`,
      ).to.be.empty;
      expect(
        measured.out,
        `at ${width}, these stand outside the pane: ${measured.out.join(" | ")}`,
      ).to.be.empty;
      expect(measured.tabs.length, "there are three tabs").to.equal(3);
      for (const height of measured.tabs) {
        expect(
          height,
          `at ${width}, a tab label wrapped: ${measured.tabs.join("/")}`,
        ).to.be.lessThan(32);
      }
    }
  });

  it("view 12 — a right-click on a node opens the seed menu, on the background it does not", async function () {
    this.timeout(60_000);
    const active = await open(60);
    const view = active.window as any;
    const menu = active.root.querySelector(".cm-node-menu") as HTMLElement;
    expect(menu, "the menu exists").to.not.equal(null);
    expect(menu.hidden, "and starts hidden").to.equal(true);

    const rect = active.canvas.getBoundingClientRect();
    const background = new view.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 2,
      clientY: rect.top + 2,
    });
    active.canvas.dispatchEvent(background);
    expect(menu.hidden, "the background leaves it hidden").to.equal(true);
    expect(background.defaultPrevented, "and keeps the browser menu").to.equal(
      false,
    );

    const controller = getGraphViewController(active.mount)!;
    const first = active.model.nodes[0]!;
    controller.revealItem(first.itemID);
    await settle(active.window, 4);
    // Revealing selects the node, so the ContextMenu key asks the renderer for
    // the menu at the node it already knows about — no client position to guess.
    const onNode = new view.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ContextMenu",
    });
    active.canvas.dispatchEvent(onNode);
    expect(menu.hidden, "a node opens it").to.equal(false);
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(
      (item) => item?.textContent,
    );
    expect(items).to.deep.equal(["Add as seed", "Explore from this paper"]);
    const escape = new view.KeyboardEvent("keydown", {
      bubbles: true,
      key: "Escape",
    });
    menu.dispatchEvent(escape);
    expect(menu.hidden, "Escape closes it").to.equal(true);
  });

  it("view 13 — a view rebuilt from its own state keeps its seeds, settings and filters", async function () {
    this.timeout(90_000);
    const first = await open(60);
    const controller = getGraphViewController(first.mount)!;
    const [a, b] = first.model.nodes as [
      (typeof first.model.nodes)[number],
      (typeof first.model.nodes)[number],
    ];
    expect(controller.openFocusItems([a.itemID, b.itemID])).to.equal(
      "selected",
    );
    await settle(first.window, 6);

    const direction = first.root.querySelector(
      ".cm-explore-section select",
    ) as HTMLSelectElement;
    direction.value = "references";
    direction.dispatchEvent(new (first.window as any).Event("change"));
    await settle(first.window, 6);

    const state = controller.getState();
    expect(state.seeds, "both seeds, by key, in order").to.deep.equal([
      { kind: "item", itemKey: a.itemKey },
      { kind: "item", itemKey: b.itemKey },
    ]);
    expect(state.explore.direction).to.equal("references");
    expect(state.camera, "the camera is read on demand").to.not.equal(null);
    first.close();

    // A rebuilt view: the same corpus, handed the state the first one gave.
    stage = await openViewStage(first.model, {
      initialState: {
        ...state,
        filters: { ...state.filters, excludeRetracted: true },
      },
    });
    const second = stage;
    await settle(second.window, 12);
    const rebuilt = getGraphViewController(second.mount)!;
    const restored = rebuilt.getState();
    expect(restored.seeds).to.deep.equal(state.seeds);
    expect(restored.explore).to.deep.equal(state.explore);
    expect(restored.filters.excludeRetracted).to.equal(true);
    const seedsButton = second.root.querySelector(
      'button[aria-controls="meristema-focus-seed-popover"]',
    ) as HTMLButtonElement;
    expect(seedsButton.textContent?.trim()).to.equal("2 seeds");
    const filterButton = second.root.querySelector(
      '.cm-plot-toolbar button[aria-label^="Filter papers"]',
    ) as HTMLButtonElement;
    expect(filterButton.getAttribute("aria-label")).to.equal(
      "Filter papers (1 active)",
    );
    expect(second.errors, "nothing threw in the background").to.deep.equal([]);

    // The seam a refresh goes through: the same mount, re-rendered in place
    // from the state the live view just reported.
    renderGraphView(second.document, second.mount, second.snapshot, {
      mode: "window",
      onSelectPaper: () => undefined,
      initialState: rebuilt.getState(),
    });
    await settle(second.window, 12);
    const rerendered = getGraphViewController(second.mount)!;
    expect(rerendered.getState().seeds).to.deep.equal(state.seeds);
    // `stage.root` still points at the torn-down root, so ask the mount.
    const rerenderedSeedsButton = second.mount.querySelector(
      'button[aria-controls="meristema-focus-seed-popover"]',
    ) as HTMLButtonElement;
    expect(rerenderedSeedsButton.textContent?.trim()).to.equal("2 seeds");
    expect(second.errors, "nothing threw on re-render").to.deep.equal([]);
  });

  it("view 14 — the Graph menu saves through the host and lists what it has", async function () {
    this.timeout(60_000);
    const calls: string[] = [];
    let entries = [
      { id: 7, name: "PhD map", modified: "2026-09-01T10:00:00.000Z" },
      { id: 9, name: "Reading list", modified: "2026-09-05T09:30:00.000Z" },
    ];
    const first = await open(30);
    stage = await openViewStage(first.model, {
      savedGraphs: {
        list: async () => entries,
        save: async () => {
          calls.push("save");
          return "PhD map";
        },
        saveAs: async () => {
          calls.push("save-as");
          return "Copy";
        },
        open: async (id) => {
          calls.push(`open:${id}`);
          return id === 9 ? "deleted" : "opened";
        },
        remove: async (id) => {
          calls.push(`remove:${id}`);
          entries = entries.filter((entry) => entry.id !== id);
          return true;
        },
      },
    });
    first.close();
    const view = stage;
    await settle(view.window, 6);

    const button = view.root.querySelector(
      'button[aria-controls="meristema-graph-menu"]',
    ) as HTMLButtonElement;
    expect(button, "the toolbar has a Graph button").to.not.equal(null);
    const menu = view.root.querySelector(
      "#meristema-graph-menu",
    ) as HTMLElement;
    expect(menu.hidden, "closed at first").to.equal(true);

    button.click();
    await settle(view.window, 4);
    expect(menu.hidden, "open after a click").to.equal(false);
    const rows = menu.querySelectorAll(".cm-graph-menu-row");
    expect(rows.length, "one row per saved graph").to.equal(2);
    expect(
      rows[0]?.querySelector('button[data-action="open"]')?.textContent,
      "named, with its date",
    ).to.include("PhD map");

    (
      menu.querySelector('button[data-action="save"]') as HTMLButtonElement
    ).click();
    await settle(view.window, 4);
    expect(calls).to.deep.equal(["save"]);
    expect(menu.hidden, "closed after Save").to.equal(true);
    const status = view.root.querySelector(".cm-toolbar-status") as HTMLElement;
    expect(status.textContent).to.equal("Saved");
    expect(status.hidden).to.equal(false);

    button.click();
    await settle(view.window, 4);
    (
      menu.querySelector(
        'button[data-action="open"][data-id="9"]',
      ) as HTMLButtonElement
    ).click();
    await settle(view.window, 4);
    expect(calls).to.deep.equal(["save", "open:9"]);
    expect(menu.hidden, "stays open to say what happened").to.equal(false);
    expect(menu.querySelector(".cm-graph-menu-empty")?.textContent).to.equal(
      "This graph was deleted.",
    );

    await delay(1400);
    await settle(view.window, 4);
    (
      menu.querySelector(
        'button[data-action="delete"][data-id="7"]',
      ) as HTMLButtonElement
    ).click();
    await settle(view.window, 4);
    expect(calls).to.deep.equal(["save", "open:9", "remove:7"]);
    expect(menu.querySelectorAll(".cm-graph-menu-row").length).to.equal(1);
    expect(view.errors, "nothing threw in the background").to.deep.equal([]);
  });

  it("view 15 — a library selection lands on present nodes and never echoes", async function () {
    this.timeout(60_000);
    const reported: (number | null)[] = [];
    const first = await open(30);
    stage = await openViewStage(first.model, {
      onGraphSelection: (itemID) => reported.push(itemID),
    });
    first.close();
    const view = stage;
    await settle(view.window, 6);
    (
      view.root.querySelector(
        '.cm-zoom-controls button[data-action="fit"]',
      ) as HTMLButtonElement
    ).click();
    await settle(view.window, 6);

    const controller = getGraphViewController(view.mount)!;
    const local = view.model.nodes.filter((node) => node.kind !== "external");
    expect(local.length).to.be.greaterThan(2);
    const [a, b, c] = local.map((node) => node.itemID);
    const placeholder = (): Element | null =>
      view.root.querySelector(".cm-detail-body .cm-placeholder");

    controller.applyLibrarySelection([a]);
    await settle(view.window, 4);
    expect(placeholder(), "one item: its node is selected").to.equal(null);
    expect(reported, "sync never reports back").to.deep.equal([]);
    expect(view.selected, "and never selects a paper").to.deep.equal([]);
    await shot("view-15-single");

    controller.applyLibrarySelection([a, b, c]);
    await settle(view.window, 4);
    expect(placeholder(), "many: the selection is cleared").to.not.equal(null);
    expect(reported).to.deep.equal([]);
    await shot("view-15-many");

    controller.applyLibrarySelection([]);
    await settle(view.window, 4);
    expect(placeholder(), "none: still cleared").to.not.equal(null);
    await shot("view-15-cleared");

    controller.applyLibrarySelection([-1]);
    await settle(view.window, 2);
    expect(reported).to.deep.equal([]);

    // A selection the view makes on its own behalf is reported exactly once.
    controller.revealItem(b);
    await settle(view.window, 4);
    expect(reported).to.deep.equal([b]);
    expect(placeholder()).to.equal(null);
  });
});
