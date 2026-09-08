import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../../src/domain/graphTypes";
import {
  additiveGraphModel,
  reachedKeysOf,
  type GraphFocusProjection,
} from "../../src/services/graphFocusService";

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

function projection(): GraphFocusProjection {
  return {
    state: {
      seedKeys: ["s"],
      direction: "both",
      locality: "all",
      ranking: "relevance",
      maxPerDirection: 50,
    },
    seeds: [node("s", "local")],
    nodes: [node("s", "local"), node("lib", "local"), node("ext", "external")],
    edges: [edge("s>lib", "s", "lib"), edge("ext>s", "ext", "s")],
    seedKeys: new Set(["s"]),
    externalKeys: new Set(["ext"]),
    reachedBySeed: new Map([["s", new Set(["lib", "ext"])]]),
    hidden: { references: 0, citedBy: 0 },
  };
}

describe("seed reach", function () {
  it("unions what every seed reached", function () {
    expect([...reachedKeysOf(projection())].sort()).to.deep.equal([
      "ext",
      "lib",
    ]);
  });

  it("adds the projection to the library graph instead of replacing it", function () {
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

  it("keeps the library's own node when the projection has one too", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, projection());
    // The library node is the one the graph already draws; the projection's
    // copy carries a focus role and would reset it.
    expect(merged.nodes.filter((entry) => entry.key === "lib")).to.have.length(
      1,
    );
    expect(merged.nodes[0]).to.equal(base.nodes[0]);
  });

  it("returns the library graph unchanged with no projection", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, null);
    expect(merged.nodes).to.deep.equal(base.nodes);
    expect(merged.edges).to.deep.equal([]);
  });
});
