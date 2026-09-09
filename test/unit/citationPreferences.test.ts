import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import { getGraphAppearance } from "../../src/services/citationPreferences";

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
