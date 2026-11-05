import { describe, it } from "node:test";
import { expect } from "chai";

import {
  axisMetricDefinitions,
  getMetricDefinition,
  nodeColorMetricDefinitions,
  nodeSizeMetricDefinitions,
} from "../../src/services/metricRegistry";

describe("the graph's metric lists (W19)", () => {
  it("do not offer Citation percentile, which a paper still shows", () => {
    for (const list of [
      axisMetricDefinitions(),
      nodeSizeMetricDefinitions(),
      nodeColorMetricDefinitions(),
    ]) {
      expect(list.map((metric) => metric.id)).to.not.include(
        "citation-percentile",
      );
      expect(list.map((metric) => metric.id)).to.not.include.members([
        "journal-h-index",
        "journal-i10-index",
        "two-year-mean-citedness",
      ]);
    }
    expect(getMetricDefinition("citation-percentile").itemPane).to.equal(
      "advanced",
    );
  });
});
