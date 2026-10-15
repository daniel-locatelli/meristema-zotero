import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import { getCitationUpdateLibraryIDs } from "../../src/services/citationLibraryService";

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
    Libraries: {
      userLibraryID: 1,
      getAll: () => [
        { libraryID: 1, libraryType: "user", name: "My Library" },
        { libraryID: 4, libraryType: "group", name: "Lab" },
        { libraryID: 7, libraryType: "feed", name: "A feed" },
      ],
    },
    Groups: { getAll: () => [{ libraryID: 9, name: "Reading group" }] },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the libraries Meristema updates (D30)", function () {
  it("updates every library that holds bibliographic items", function () {
    expect(getCitationUpdateLibraryIDs()).to.have.members([1, 4, 9]);
  });

  it("ignores a library selection stored by an older version", function () {
    // Settings once chose which libraries to update; the choice is gone, and
    // an old stored value, valid or not, neither narrows the set nor throws.
    for (const stored of ["[1]", "[]", "not json", 42]) {
      store[`${config.prefsPrefix}.updateLibraryIDs`] = stored;
      expect(getCitationUpdateLibraryIDs(), String(stored)).to.have.members([
        1, 4, 9,
      ]);
    }
  });
});
