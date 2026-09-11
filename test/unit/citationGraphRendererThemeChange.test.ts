import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import {
  GRAPH_APPEARANCE_PREF,
  graphThemeFor,
} from "../../src/services/graphTheme";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  lastRegionStroke,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * A stand-in for Gecko's `Services.prefs`, holding exactly the appearance
 * pref and the observers on it, so a case can flip Zotero's appearance and
 * fire the observer the way the real pref branch does.
 */
class FakePrefs {
  private value: number;
  private observers: Array<{ observe: () => void }> = [];
  constructor(value: number) {
    this.value = value;
  }
  getIntPref(name: string, fallback: number): number {
    return name === GRAPH_APPEARANCE_PREF ? this.value : fallback;
  }
  addObserver(name: string, observer: { observe: () => void }): void {
    expect(name).to.equal(GRAPH_APPEARANCE_PREF);
    this.observers.push(observer);
  }
  removeObserver(_name: string, observer: { observe: () => void }): void {
    this.observers = this.observers.filter((o) => o !== observer);
  }
  set(value: number): void {
    this.value = value;
    for (const observer of [...this.observers]) observer.observe();
  }
}

describe("CitationGraphRenderer on an appearance change", function () {
  let prefs: FakePrefs;
  let hadServices: boolean;
  let previousServices: unknown;

  beforeEach(function () {
    prefs = new FakePrefs(1);
    hadServices = "Services" in globalThis;
    previousServices = (globalThis as any).Services;
    (globalThis as any).Services = { prefs };
  });

  afterEach(function () {
    if (hadServices) (globalThis as any).Services = previousServices;
    else delete (globalThis as any).Services;
  });

  it(
    "tells its owner the theme changed, after re-resolving it and before " +
      "the redraw, so colours handed back in the callback are what it draws",
    function () {
      const canvas = new FakeCanvas();
      const seen: string[] = [];
      let renderer: CitationGraphRenderer | null = null;
      const lightSwatch = graphThemeFor("light").categorical.swatches[0];
      const darkSwatch = graphThemeFor("dark").categorical.swatches[0];

      renderer = new CitationGraphRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        model: model([node("n1", { collectionIDs: [1] })]),
        layout: FREE_LAYOUT,
        collectionLabels: new Map(),
        onSelectionChange: () => undefined,
        onOpenNode: () => undefined,
        onThemeChange: () => {
          seen.push(renderer!.getTheme().scheme);
          // What the view service does with the notice: re-read the region's
          // colour from the theme the renderer now holds and hand it back
          // without asking for a draw of its own.
          renderer!.setRegions(
            [
              {
                collectionID: 1,
                color: renderer!.getTheme().categorical.swatches[0],
                nodeKeys: new Set(["n1"]),
              },
            ],
            false,
          );
        },
      });
      attachView(canvas);
      renderer.setNodePositions(new Map([["n1", { x: 100, y: 100 }]]));
      renderer.setRegions([
        { collectionID: 1, color: lightSwatch, nodeKeys: new Set(["n1"]) },
      ]);
      expect(renderer.getTheme().scheme).to.equal("light");
      expect(lastRegionStroke(canvas.context).strokeStyle).to.equal(
        lightSwatch,
      );

      const drawsBefore = canvas.context.calls.length;
      prefs.set(0);

      expect(seen, "notified once, with the theme already dark").to.deep.equal([
        "dark",
      ]);
      expect(renderer.getTheme().scheme).to.equal("dark");
      expect(canvas.context.calls.length, "the flip redrew").to.be.greaterThan(
        drawsBefore,
      );
      expect(
        lastRegionStroke(canvas.context).strokeStyle,
        "and the redraw used the colour handed back in the callback",
      ).to.equal(darkSwatch);
      expect(darkSwatch).to.not.equal(lightSwatch);
    },
  );

  it("stops observing the pref once destroyed", function () {
    const canvas = new FakeCanvas();
    let notices = 0;
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([node("n1")]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
      onThemeChange: () => {
        notices += 1;
      },
    });
    // No view attached: the double's `destroy` path removes window listeners
    // only when there is a window, and this case is about the pref observer.
    renderer.destroy();
    prefs.set(0);
    expect(notices).to.equal(0);
  });
});
