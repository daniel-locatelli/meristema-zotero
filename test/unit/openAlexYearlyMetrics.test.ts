import { describe, it } from "node:test";
import { expect } from "chai";

import { openAlexYearlyMetrics } from "../../src/providers/openAlexMapper";

const thisYear = new Date().getFullYear();
const window = [thisYear - 3, thisYear - 2, thisYear - 1];

describe("the recent citation rate", () => {
  it("averages the last three complete years for an older paper", () => {
    const counts = window.map((year) => ({ year, count: 6 }));
    expect(openAlexYearlyMetrics(counts, thisYear - 10).velocity).to.equal(6);
  });

  it("divides by the years a new paper has existed (W19)", () => {
    const counts = [
      { year: thisYear - 2, count: 4 },
      { year: thisYear - 1, count: 8 },
    ];
    expect(openAlexYearlyMetrics(counts, thisYear - 2).velocity).to.equal(6);
    expect(
      openAlexYearlyMetrics([{ year: thisYear - 1, count: 5 }], thisYear - 1)
        .velocity,
    ).to.equal(5);
  });

  it("has none for a paper from this year, which has no complete year", () => {
    expect(
      openAlexYearlyMetrics([{ year: thisYear, count: 3 }], thisYear).velocity,
    ).to.equal(null);
  });

  it("uses the whole window when the year is unknown", () => {
    const counts = [{ year: thisYear - 1, count: 9 }];
    expect(openAlexYearlyMetrics(counts, null).velocity).to.equal(3);
  });
});
