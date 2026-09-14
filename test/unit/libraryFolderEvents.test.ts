import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import {
  publishLibraryFoldersChanged,
  subscribeLibraryFoldersChanged,
} from "../../src/services/libraryFolderEvents";

let logged: string[] = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  logged = [];
  (globalThis as Record<string, unknown>).Zotero = {
    debug: (message: string) => logged.push(message),
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the library-folders-changed event (B58)", function () {
  it("calls a subscriber and stops calling it once unsubscribed", function () {
    let calls = 0;
    const unsubscribe = subscribeLibraryFoldersChanged(() => {
      calls += 1;
    });
    publishLibraryFoldersChanged();
    expect(calls).to.equal(1);
    unsubscribe();
    publishLibraryFoldersChanged();
    expect(calls, "no call after unsubscribing").to.equal(1);
  });

  it("logs a throwing listener and still calls the next", function () {
    let reached = false;
    const first = subscribeLibraryFoldersChanged(() => {
      throw new Error("boom");
    });
    const second = subscribeLibraryFoldersChanged(() => {
      reached = true;
    });
    try {
      publishLibraryFoldersChanged();
    } finally {
      first();
      second();
    }
    expect(reached, "the second listener ran").to.equal(true);
    expect(logged.join("\n")).to.contain("boom");
  });
});
