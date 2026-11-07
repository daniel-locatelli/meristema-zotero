import { describe, it } from "node:test";
import { expect } from "chai";
import {
  publishReadingNotesChanged,
  subscribeReadingNotesChanged,
} from "../../src/services/readingNoteEvents";

describe("reading note events", () => {
  it("calls each listener until it unsubscribes", () => {
    let calls = 0;
    const off = subscribeReadingNotesChanged(() => (calls += 1));
    publishReadingNotesChanged();
    off();
    publishReadingNotesChanged();
    expect(calls).to.equal(1);
  });

  it("still reaches a listener after one that throws", () => {
    const global = globalThis as { Zotero?: unknown };
    const previous = global.Zotero;
    global.Zotero ??= { debug: () => {} };
    try {
      let calls = 0;
      const offBad = subscribeReadingNotesChanged(() => {
        throw new Error("boom");
      });
      const offGood = subscribeReadingNotesChanged(() => (calls += 1));
      publishReadingNotesChanged();
      offBad();
      offGood();
      expect(calls).to.equal(1);
    } finally {
      if (previous === undefined) delete global.Zotero;
      else global.Zotero = previous;
    }
  });
});
