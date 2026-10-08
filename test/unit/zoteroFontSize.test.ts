import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import {
  axisInsets,
  fitInsets,
  GRAPH_TYPE_SCALE,
} from "../../src/services/graphPlotFrame";
import {
  fontScaleOf,
  followZoteroFontSize,
  scaledFontSize,
} from "../../src/services/zoteroFontSize";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * B93: View › Font Size writes `extensions.zotero.fontSize` (rem, 1.00 being
 * Zotero's 13px), and Zotero.UIProperties writes it onto each registered root
 * as `font-size` and `--zotero-font-size`. The plugin follows it by
 * registering its own roots and sizing its text against that property.
 */
describe("scaledFontSize", function () {
  it("is the px size at Zotero's default and follows the root's property", function () {
    expect(scaledFontSize(11)).to.equal(
      "calc(var(--zotero-font-size, 1rem) * 11 / 13)",
    );
  });
});

describe("fontScaleOf", function () {
  function withFontSize(fontSize: string | null) {
    return {
      ownerDocument: {
        defaultView:
          fontSize === null ? null : { getComputedStyle: () => ({ fontSize }) },
      },
    } as unknown as HTMLElement;
  }

  it("is the computed font size over Zotero's 13px", function () {
    expect(fontScaleOf(withFontSize("26px"))).to.equal(2);
    expect(fontScaleOf(withFontSize("13px"))).to.equal(1);
  });

  it("is 1 without a view or a readable size", function () {
    expect(fontScaleOf(withFontSize(null))).to.equal(1);
    expect(fontScaleOf(withFontSize(""))).to.equal(1);
  });
});

describe("followZoteroFontSize", function () {
  it("registers the root and calls back on UIPropertiesChanged until disposed", function () {
    const registered: unknown[] = [];
    const listeners = new Map<string, () => void>();
    const root = {
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as HTMLElement;
    let changes = 0;
    const dispose = followZoteroFontSize(root, () => changes++, {
      registerRoot: (element: Element) => registered.push(element),
    });
    expect(registered).to.deep.equal([root]);
    listeners.get("UIPropertiesChanged")?.();
    expect(changes).to.equal(1);
    dispose();
    expect(listeners.has("UIPropertiesChanged")).to.equal(false);
  });

  it("does nothing on a Zotero without UIProperties", function () {
    const root = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLElement;
    expect(() =>
      followZoteroFontSize(root, () => undefined, null)(),
    ).to.not.throw();
  });
});

describe("the plot's text gutters", function () {
  const labelled = { xFree: false, yFree: false };

  it("grow with the font scale and keep their px size at 1", function () {
    const base = axisInsets(1, labelled);
    expect(axisInsets(1, labelled, 1)).to.deep.equal(base);
    const big = axisInsets(1, labelled, 2);
    expect(big.left).to.equal(base.left * 2);
    expect(big.bottom).to.equal(base.bottom * 2);
    expect(big.top, "a gutter holding no text keeps its size").to.equal(
      base.top,
    );
    const fit = fitInsets(1, labelled);
    const bigFit = fitInsets(1, labelled, 2);
    expect(bigFit.left - fit.left).to.equal(big.left - base.left);
    expect(bigFit.bottom - fit.bottom).to.equal(big.bottom - base.bottom);
  });

  it("leave a bare axis alone", function () {
    const bare = { xFree: true, yFree: true };
    expect(axisInsets(1, bare, 2)).to.deep.equal(axisInsets(1, bare));
  });
});

describe("CitationGraphRenderer font scale", function () {
  it("draws its labels at the root's font size after refreshFontScale", function () {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([node("a", { title: "A paper" })]),
      layout: { ...FREE_LAYOUT, nodeLabelMode: "title" },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(new Map([["a", { x: 300, y: 300 }]]));
    const labelFont = () =>
      canvas.context.calls.find(
        (call) => call.method === "fillText" && call.args[0] === "A paper",
      )?.font;

    (
      canvas.ownerDocument.defaultView as unknown as Record<string, unknown>
    ).getComputedStyle = () => ({ fontSize: "26px", fontFamily: "Test" });
    canvas.context.calls = [];
    renderer.refreshFontScale();
    expect(labelFont(), "the label font doubles").to.equal(
      `${GRAPH_TYPE_SCALE.tick * 2}px Test`,
    );
  });
});

describe("the plugin's stylesheets", function () {
  it("size no text in px, so View › Font Size reaches all of it", function () {
    const dir = join(process.cwd(), "addon/content");
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".css") && name !== "preferences.css")
      .flatMap((name) =>
        readFileSync(join(dir, name), "utf8")
          .split("\n")
          .map((line, index) => ({ name, line, index }))
          .filter(
            ({ line }) =>
              /font-size:\s*[\d.]+px/.test(line) && !line.includes("glyph:"),
          )
          .map(
            ({ name, line, index }) => `${name}:${index + 1} ${line.trim()}`,
          ),
      );
    expect(offenders).to.deep.equal([]);
  });
});
