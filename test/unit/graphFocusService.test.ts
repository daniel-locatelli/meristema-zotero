import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../../src/domain/graphTypes";
import { additiveGraphModel } from "../../src/services/graphFocusService";

function node(key: string, kind: "local" | "external"): CitationGraphNode {
  return {
    key,
    itemID: kind === "local" ? 1 : 0,
    itemKey: key,
    kind,
    focusRole: null,
    externalWork: null,
    title: key,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: null,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: null,
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: null,
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: true,
    metricStatus: null,
    fwci: null,
    citationPercentile: null,
    isTop1Percent: null,
    isTop10Percent: null,
    citationsLastYear: null,
    citationVelocity: null,
    citationAcceleration: null,
    influentialCitationCount: null,
    isRetracted: null,
    openAccessStatus: null,
    isOpenAccess: null,
    publicationType: null,
    sourceMetrics: null,
    metadataCompleteness: 0,
    incomingLibraryCitations: 0,
    outgoingLibraryReferences: 0,
    libraryCoverage: null,
    localGlobalImpactRatio: null,
    isIsolated: false,
    referenceAgeMean: null,
    referenceAgeSpread: null,
    selfCitationEstimate: null,
    futureReferenceCount: null,
    references: [],
  } as CitationGraphNode;
}

function edge(key: string, source: string, target: string): CitationGraphEdge {
  return { key, source, target, provenance: "test", manual: false };
}

/** What the hop model hands `additiveGraphModel`: just nodes and edges. */
function projection(): {
  nodes: CitationGraphNode[];
  edges: CitationGraphEdge[];
} {
  return {
    nodes: [node("s", "local"), node("lib", "local"), node("ext", "external")],
    edges: [edge("s>lib", "s", "lib"), edge("ext>s", "ext", "s")],
  };
}

describe("seed reach", function () {
  it("adds the hop model to the library graph instead of replacing it", function () {
    const base = {
      nodes: [node("lib", "local"), node("other", "local")],
      edges: [edge("lib>other", "lib", "other")],
    };
    const merged = additiveGraphModel(base, projection());
    expect(merged.nodes.map((entry) => entry.key).sort()).to.deep.equal([
      "ext",
      "lib",
      "other",
      "s",
    ]);
    expect(merged.edges.map((entry) => entry.key).sort()).to.deep.equal([
      "ext>s",
      "lib>other",
      "s>lib",
    ]);
  });

  it("keeps the library's own node when the hop model has one too", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, projection());
    // The library node is the one the graph already draws; the hop model's
    // copy carries a focus role and would reset it.
    expect(merged.nodes.filter((entry) => entry.key === "lib")).to.have.length(
      1,
    );
    expect(merged.nodes[0]).to.equal(base.nodes[0]);
  });

  it("returns the library graph unchanged with no hop model", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, null);
    expect(merged.nodes).to.deep.equal(base.nodes);
    expect(merged.edges).to.deep.equal([]);
  });
});
