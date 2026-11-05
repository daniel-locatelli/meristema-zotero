import { describe, it } from "node:test";
import { expect } from "chai";

import { axisScaleForNodes } from "../../src/services/graphMetricScale";
import type { CitationGraphNode } from "../../src/domain/graphTypes";

function yearAxis(years: number[]) {
  const nodes = years.map((year) => ({ year }) as unknown as CitationGraphNode);
  return axisScaleForNodes(nodes, "year", "linear", 6, (node) =>
    Number((node as unknown as { year: number }).year),
  );
}

describe("a year axis", () => {
  it("stops at this year, not at the next rounded step", () => {
    const thisYear = new Date().getFullYear();
    const axis = yearAxis([1860, 2005, thisYear]);
    expect(axis?.domain[1]).to.equal(thisYear);
    expect(Math.max(...(axis?.ticks ?? []))).to.be.at.most(thisYear);
  });

  it("reaches a paper dated ahead of this year", () => {
    const ahead = new Date().getFullYear() + 1;
    expect(yearAxis([2000, ahead])?.domain[1]).to.be.at.least(ahead);
  });

  it("fits a narrow range of years", () => {
    const axis = yearAxis([2005, 2021]);
    expect(axis?.domain[0]).to.be.at.least(2000);
    expect(axis?.domain[1]).to.be.at.most(2025);
  });
});
