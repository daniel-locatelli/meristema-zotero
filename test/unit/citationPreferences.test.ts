import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import {
  getFocusGraphAppearance,
  getGraphAppearance,
} from "../../src/services/citationPreferences";

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
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the graph appearance preference", function () {
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
