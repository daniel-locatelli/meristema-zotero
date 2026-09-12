import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import {
  deleteGraphView,
  dismissTutorial,
  isTutorialDismissed,
  listSavedGraphViews,
  saveGraphView,
} from "../../src/services/graphViewsStore";
import {
  captureGraphView,
  type GraphViewDefinition,
} from "../../src/services/graphViews";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";

const prefKey = (name: string): string => `${config.prefsPrefix}.${name}`;
let store: Record<string, unknown> = {};
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  store = {};
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (name: string) => store[name],
      set: (name: string, value: unknown) => {
        store[name] = value;
      },
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

function view(name: string): GraphViewDefinition {
  return captureGraphView({
    name,
    paragraph: "p",
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
  });
}

describe("the saved views preference", function () {
  it("is empty when absent or unparseable, and is rewritten on save", function () {
    expect(listSavedGraphViews()).to.deep.equal([]);
    store[prefKey("graphViews")] = "{not json";
    expect(listSavedGraphViews()).to.deep.equal([]);
    const v = view("A");
    saveGraphView(v);
    expect(listSavedGraphViews().map((x) => x.name)).to.deep.equal(["A"]);
    expect(JSON.parse(String(store[prefKey("graphViews")]))[0].id).to.equal(
      v.id,
    );
  });

  it("replaces by id, deletes by id, and forgets a deleted view's dismissal", function () {
    const v = view("A");
    saveGraphView(v);
    saveGraphView({ ...v, name: "A2" });
    expect(listSavedGraphViews().map((x) => x.name)).to.deep.equal(["A2"]);
    dismissTutorial(v.id);
    expect(isTutorialDismissed(v.id)).to.equal(true);
    deleteGraphView(v.id);
    expect(listSavedGraphViews()).to.deep.equal([]);
    expect(isTutorialDismissed(v.id)).to.equal(false);
  });

  it("skips a stored record that no longer decodes", function () {
    store[prefKey("graphViews")] = JSON.stringify([
      {
        meristemaView: 1,
        id: "user:x",
        name: "bad",
        appearance: { xMetric: "bogus" },
      },
    ]);
    expect(listSavedGraphViews()).to.deep.equal([]);
  });
});
