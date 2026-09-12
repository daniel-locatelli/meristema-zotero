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
    expect(completed.length).to.equal(1);
  });

  it("holds runner-originated refreshes to one per window", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    expect(completed.length).to.equal(0);
    mock.timers.tick(HOP_FILL_REFRESH_COALESCE_MS);
    expect(completed.length).to.equal(1);
    mock.timers.reset();
  });
});
