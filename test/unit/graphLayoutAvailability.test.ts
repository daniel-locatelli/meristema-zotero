import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  colourOptionHasData,
  normaliseLayoutFor,
} from "../../src/services/graphLayoutAvailability";

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

  it("falls back to Free on an axis and Uniform for size and colour, as the gear's selects do", function () {
    const nodes = [node({ citationCount: null, referenceCount: 3 })];
    const out = normaliseLayoutFor(nodes, layout);
    expect(out.yMetric).to.equal("free");
    expect(out.yScale).to.equal("linear"); // a free axis is linear
    expect(out.nodeSizeMetric).to.equal("uniform");
    expect(out.nodeColorMetric).to.equal("uniform");
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

  it("falls back a categorical colour with no matching node data to Uniform, and keeps it when a node carries the field", function () {
    const withoutProvider = [node({ citationCount: 10, provider: null })];
    expect(
      normaliseLayoutFor(withoutProvider, {
        ...layout,
        nodeColorMetric: "provider",
      }).nodeColorMetric,
    ).to.equal("uniform");

    const withProvider = [node({ citationCount: 10, provider: "openalex" })];
    expect(
      normaliseLayoutFor(withProvider, {
        ...layout,
        nodeColorMetric: "provider",
      }).nodeColorMetric,
    ).to.equal("provider");
  });
});

describe("colourOptionHasData for citation-hop", function () {
  it("is always true: the gear enables the option by seededness instead", function () {
    // A hop belongs to the walk, not to a node — `additiveGraphModel` keeps
    // the library's own node objects, which carry no `hop` — so the data
    // probe cannot answer this one. Seededness does, at three points in
    // graphViewService.ts: off at setup, on in `applyHopModel`, off again in
    // `clearSeeds`. This test pins the division of labour, not a preference.
    expect(colourOptionHasData([], "citation-hop")).to.equal(true);
    expect(
      colourOptionHasData([node({ citationCount: 3 })], "citation-hop"),
      "a graph with nodes but no hops says the same: the probe abstains",
    ).to.equal(true);
  });
});
