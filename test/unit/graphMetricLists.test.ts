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
        "reference-coverage",
        "reference-age-mean",
        "reference-age-spread",
        "self-citation-estimate",
        "metadata-completeness",
      ]);
    }
    expect(getMetricDefinition("citation-percentile").itemPane).to.equal(
      "advanced",
    );
    expect(getMetricDefinition("reference-coverage").itemPane).to.equal(
      "advanced",
    );
    expect(getMetricDefinition("metadata-completeness").itemPane).to.equal(
      "advanced",
    );
  });

  it("offers Reading step on the axes only", () => {
    expect(axisMetricDefinitions().map((m) => m.id)).to.include("reading-step");
    expect(nodeSizeMetricDefinitions().map((m) => m.id)).to.not.include(
      "reading-step",
    );
    expect(nodeColorMetricDefinitions().map((m) => m.id)).to.not.include(
      "reading-step",
    );
  });
});
