import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import {
  getFocusGraphAppearance,
  getGraphAppearance,
  hasStoredFocusGraphAppearance,
  hasStoredGraphAppearance,
  initialGraphAppearance,
  resetFocusGraphAppearance,
  resetGraphAppearance,
  setFocusGraphAppearance,
  setGraphAppearance,
} from "../../src/services/citationPreferences";
import { SHIPPED_GRAPH_VIEWS } from "../../src/services/graphViews";

const prefKey = (name: string): string => `${config.prefsPrefix}.${name}`;

let store: Record<string, unknown> = {};
let previousZotero: unknown;

function stubPrefs(overrides: Record<string, unknown>): void {
  store = {};
  for (const [name, value] of Object.entries(overrides)) {
    store[prefKey(name)] = value;
  }
}

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  store = {};
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (name: string) => store[name],
      set: (name: string, value: unknown) => {
        store[name] = value;
      },
      clear: (name: string) => {
        delete store[name];
      },
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the graph appearance preference", function () {
  it("opens a new graph on Overview's appearance (D22)", function () {
    // One neutral grey wasted the colour channel; Overview colours by
    // publication type, and a graph with nothing stored opens the same way.
    const overview = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "overview")!;
    expect(overview.appearance.nodeColorMetric).to.equal("publication-type");
    expect(getGraphAppearance()).to.deep.equal(overview.appearance);
  });

  it("coerces a stored Collection colouring to Uniform", function () {
    // Collection is not a node colouring any more — folders are regions. The
    // appearance schema version is deliberately not bumped to force this: a
    // mismatch makes getGraphAppearance rewrite the whole record from
    // defaults, which would throw away the reader's axes, scales, size metric
    // and label mode to change one field.
    stubPrefs({
      graphAppearanceVersion: 4,
      graphAppearance: JSON.stringify({
        xMetric: "year",
        xScale: "log",
        yMetric: "citations",
        yScale: "linear",
        nodeSizeMetric: "citations",
        nodeColorMetric: "collection",
        nodeLabelMode: "author-year",
      }),
    });
    const appearance = getGraphAppearance();
    expect(appearance.nodeColorMetric).to.equal("uniform");
    expect(appearance.xScale).to.equal(
      "log",
      "the rest of the record survives",
    );
  });
});

describe("the focus graph appearance preference", function () {
  it("coerces a stored Collection colouring to Uniform", function () {
    // getFocusGraphAppearance has no callers today (confirmed by grep before
    // this test was written), so this bug never fired in production — but a
    // reader who changed appearance with a focus projection open before this
    // branch retired "collection" still has it sitting in
    // focusGraphAppearance, and the getter used to merge the stored record
    // over its fallback with `...parsed` alone, never applying
    // withoutRetiredColouring the way getGraphAppearance does. The schema
    // version is deliberately not bumped, for the same reason as the main
    // appearance record: a mismatch would rewrite the whole thing from
    // defaults and throw away the reader's other settings for one retired
    // field.
    stubPrefs({
      focusGraphAppearanceVersion: 1,
      focusGraphAppearance: JSON.stringify({
        xMetric: "citation-sequence",
        xScale: "linear",
        yMetric: "citations",
        yScale: "log",
        nodeSizeMetric: "citations",
        nodeColorMetric: "collection",
        nodeLabelMode: "author-year",
      }),
    });
    const base = {
      xMetric: "year",
      xScale: "linear",
      yMetric: "citations",
      yScale: "linear",
      nodeSizeMetric: "citations",
      nodeColorMetric: "uniform",
      nodeLabelMode: "author-year",
    } as const;
    const appearance = getFocusGraphAppearance(base);
    expect(appearance.nodeColorMetric).to.equal("uniform");
    expect(appearance.yScale).to.equal(
      "log",
      "the rest of the record survives",
    );
  });
});

describe("the appearance a graph opens with (B41)", function () {
  const record = (xMetric: string): string =>
    JSON.stringify({
      xMetric,
      xScale: "linear",
      yMetric: "citations",
      yScale: "linear",
      nodeSizeMetric: "citations",
      nodeColorMetric: "uniform",
      nodeLabelMode: "author-year",
    });

  it("reads the focus variant for a seeded graph and the global one otherwise", function () {
    // The gear writes focusGraphAppearance while a graph is seeded, so a
    // seeded open has to read it back, or the change is lost on reopen.
    stubPrefs({
      graphAppearanceVersion: 4,
      graphAppearance: record("free"),
      focusGraphAppearanceVersion: 1,
      focusGraphAppearance: record("year"),
    });
    expect(initialGraphAppearance(false).xMetric).to.equal("free");
    expect(initialGraphAppearance(true).xMetric).to.equal("year");
  });

  it("gives a seeded graph the citation-sequence variant of the global one when no focus record exists", function () {
    stubPrefs({ graphAppearanceVersion: 4, graphAppearance: record("free") });
    const seeded = initialGraphAppearance(true);
    expect(seeded.xMetric).to.equal("citation-sequence");
    expect(seeded.xScale).to.equal("linear");
    expect(seeded.yMetric).to.equal("citations");
  });
});

describe("the default a new graph opens with (D17)", function () {
  const mine = {
    xMetric: "free",
    xScale: "linear",
    yMetric: "citations",
    yScale: "log",
    nodeSizeMetric: "references",
    nodeColorMetric: "provider",
    nodeLabelMode: "title",
  } as const;
  /** The built-in default before D22: what every open used to write. */
  const legacy = {
    xMetric: "year",
    xScale: "linear",
    yMetric: "citations",
    yScale: "linear",
    nodeSizeMetric: "citations",
    nodeColorMetric: "uniform",
    nodeLabelMode: "author-year",
  } as const;

  it("reads without writing, so nothing is stored until the reader asks", function () {
    initialGraphAppearance(false);
    initialGraphAppearance(true);
    expect(store, "an open stored a default").to.deep.equal({});
    expect(hasStoredGraphAppearance()).to.equal(false);
    expect(hasStoredFocusGraphAppearance()).to.equal(false);
  });

  it("opens on a default the reader made, library and seeded kept apart", function () {
    setGraphAppearance(mine);
    expect(hasStoredGraphAppearance()).to.equal(true);
    expect(hasStoredFocusGraphAppearance()).to.equal(false);
    expect(initialGraphAppearance(false)).to.deep.equal(mine);
    expect(initialGraphAppearance(true).xMetric).to.equal("citation-sequence");
    setFocusGraphAppearance({ ...mine, xMetric: "year" });
    expect(hasStoredFocusGraphAppearance()).to.equal(true);
    expect(initialGraphAppearance(true).xMetric).to.equal("year");
  });

  it("honours a record stored before D17 as the reader's default", function () {
    stubPrefs({
      graphAppearanceVersion: 4,
      graphAppearance: JSON.stringify(mine),
      focusGraphAppearanceVersion: 1,
      focusGraphAppearance: JSON.stringify({ ...mine, xMetric: "year" }),
    });
    expect(hasStoredGraphAppearance()).to.equal(true);
    expect(initialGraphAppearance(false)).to.deep.equal(mine);
    expect(hasStoredFocusGraphAppearance()).to.equal(true);
    expect(initialGraphAppearance(true).xMetric).to.equal("year");
  });

  it("reads a record that only repeats the old built-in default as no default", function () {
    // Every open before D17 wrote the built-in default whether or not the
    // reader chose anything, so such a record is not a choice. Honouring it
    // would keep every existing reader on one grey after D22.
    stubPrefs({
      graphAppearanceVersion: 4,
      graphAppearance: JSON.stringify(legacy),
      focusGraphAppearanceVersion: 1,
      focusGraphAppearance: JSON.stringify({
        ...legacy,
        xMetric: "citation-sequence",
      }),
    });
    expect(hasStoredGraphAppearance()).to.equal(false);
    expect(hasStoredFocusGraphAppearance()).to.equal(false);
    expect(initialGraphAppearance(false).nodeColorMetric).to.equal(
      "publication-type",
    );
    expect(initialGraphAppearance(true).nodeColorMetric).to.equal(
      "publication-type",
    );
  });

  it("keeps the old built-in default when the reader makes it the default", function () {
    setGraphAppearance(legacy);
    expect(hasStoredGraphAppearance()).to.equal(true);
    expect(initialGraphAppearance(false)).to.deep.equal(legacy);
  });

  it("forgets a made default on reset and answers the built-in one", function () {
    setGraphAppearance(mine);
    setFocusGraphAppearance({ ...mine, xMetric: "year" });
    const seeded = resetFocusGraphAppearance(getGraphAppearance());
    expect(hasStoredFocusGraphAppearance()).to.equal(false);
    expect(seeded).to.deep.equal(initialGraphAppearance(true));
    expect(hasStoredGraphAppearance(), "the library default is apart").to.equal(
      true,
    );
    const library = resetGraphAppearance();
    expect(hasStoredGraphAppearance()).to.equal(false);
    expect(library).to.deep.equal(initialGraphAppearance(false));
    expect(library.nodeColorMetric).to.equal("publication-type");
    expect(store, "both records are gone").to.deep.equal({});
  });
});
