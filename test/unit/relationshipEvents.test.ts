import { describe, it, mock, beforeEach } from "node:test";
import { expect } from "chai";

const completed: unknown[] = [];
const real = await import("../../src/services/citationUpdateEvents");
mock.module("../../src/services/citationUpdateEvents.ts", {
  exports: {
    ...real,
    publishCitationUpdateCompleted: (event: unknown) => completed.push(event),
  },
});
const {
  publishRelationshipPublication,
  HOP_FILL_REFRESH_COALESCE_MS,
  flushCoalescedPresentationRefresh,
} = await import("../../src/services/relationshipEvents");

function event(source?: "hop-fill") {
  return {
    libraryID: 1,
    subjectItemKey: "K",
    direction: "cited-by" as const,
    phase: "membership-published" as const,
    reportedCount: null,
    reportedCountProvider: null,
    identifiedCount: 3,
    ...(source ? { source } : {}),
  };
}

describe("presentation refreshes during a hop fill", function () {
  beforeEach(() => {
    completed.length = 0;
    flushCoalescedPresentationRefresh();
    completed.length = 0;
  });

  it("refreshes columns at once for an ordinary publication", function () {
    publishRelationshipPublication(event());
    // The payload, not the count: a coalescer that emits one *wrong* event
    // passes every count-only assertion.
    expect(completed).to.deep.equal([
      { refreshGraph: false, refreshColumns: true, refreshItemPanes: true },
    ]);
  });

  it("leaves the columns alone for a metadata publication", function () {
    publishRelationshipPublication({ ...event(), phase: "metadata-published" });
    publishRelationshipPublication({ ...event(), phase: "refresh-started" });
    expect(completed).to.deep.equal([]);
  });

  it("holds runner-originated refreshes to one per window", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    expect(completed).to.deep.equal([]);
    mock.timers.tick(HOP_FILL_REFRESH_COALESCE_MS);
    expect(
      completed,
      "one event, carrying the column refresh the three publications earned",
    ).to.deep.equal([
      { refreshGraph: false, refreshColumns: true, refreshItemPanes: true },
    ]);
    mock.timers.reset();
  });

  it("carries the column refresh out of a window that also held a pane-only publication", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication({
      ...event("hop-fill"),
      phase: "refresh-finished",
    });
    mock.timers.tick(HOP_FILL_REFRESH_COALESCE_MS);
    expect(completed).to.deep.equal([
      { refreshGraph: false, refreshColumns: true, refreshItemPanes: true },
    ]);
    mock.timers.reset();
  });

  it("flushes the held event unchanged when the plan empties", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    publishRelationshipPublication(event("hop-fill"));
    expect(completed).to.deep.equal([]);
    flushCoalescedPresentationRefresh();
    expect(completed).to.deep.equal([
      { refreshGraph: false, refreshColumns: true, refreshItemPanes: true },
    ]);
    mock.timers.tick(HOP_FILL_REFRESH_COALESCE_MS);
    expect(completed.length, "the flush cancelled the timer").to.equal(1);
    mock.timers.reset();
  });
});
