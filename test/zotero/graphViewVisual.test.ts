/// <reference types="mocha" />
import { expect } from "chai";
import {
  BASE_LAYOUT,
  delay,
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
