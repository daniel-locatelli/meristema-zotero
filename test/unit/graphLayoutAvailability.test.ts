import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { normaliseLayoutFor } from "../../src/services/graphLayoutAvailability";

function node(overrides: Partial<CitationGraphNode>): CitationGraphNode {
  return {
    key: "k",
    itemID: 1,
    itemKey: "K",
    title: "t",
    authors: [],
    year: 2020,
    citationCount: null,
    referenceCount: null,
    collectionIDs: [],
    provider: null,
    publicationType: null,
    ...overrides,
  } as CitationGraphNode;
}

const layout = {
  xMetric: "year",
  xScale: "log",
  yMetric: "citations",
  yScale: "log",
  nodeSizeMetric: "citations",
  nodeColorMetric: "citations",
  nodeLabelMode: "author-year",
} as const;

describe("normaliseLayoutFor", function () {
  it("keeps every field the graph can show", function () {
    const nodes = [node({ citationCount: 10 })];
    expect(normaliseLayoutFor(nodes, layout)).to.deep.equal({
      ...layout,
      xScale: "linear", // year is not logarithmic
    });
  });

  it("substitutes the first available metric when the graph lacks one", function () {
    const nodes = [node({ citationCount: null, referenceCount: 3 })];
    const out = normaliseLayoutFor(nodes, layout);
    expect(out.yMetric).to.not.equal("citations");
    expect(out.nodeSizeMetric).to.not.equal("citations");
    expect(out.nodeColorMetric).to.not.equal("citations");
  });

  it("forces a free axis to linear and keeps log where the metric allows it", function () {
    const nodes = [node({ citationCount: 10 })];
    const out = normaliseLayoutFor(nodes, { ...layout, xMetric: "free" });
    expect(out.xScale).to.equal("linear");
    expect(out.yScale).to.equal("log");
  });

  it("is idempotent", function () {
    const nodes = [node({ citationCount: null, referenceCount: 3 })];
    const once = normaliseLayoutFor(nodes, layout);
    expect(normaliseLayoutFor(nodes, once)).to.deep.equal(once);
  });
});
