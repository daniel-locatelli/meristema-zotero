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
});
