import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  IgnoredProviderRelation,
  ManualCitationRelation,
  RelatedWorkMetadata,
} from "../../src/domain/citationTypes";
import type { ExternalWork } from "../../src/domain/externalWork";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  ignoredRelationDescriptorFor,
  mergeRelationEntries,
  relationshipTabLabel,
} from "../../src/services/paperDetailModel";

const work = (overrides: Partial<ExternalWork>): ExternalWork => ({
  provider: "openalex",
  providerWorkID: null,
  doi: null,
  title: "Untitled",
  year: null,
  authors: [],
  sourceTitle: null,
  abstract: null,
  citationCount: null,
  referenceCount: null,
  isOpenAccess: null,
  openAccessStatus: null,
  isRetracted: null,
  ...overrides,
});

const node = (overrides: Partial<CitationGraphNode>): CitationGraphNode =>
  ({
    key: "item:AAAA",
    itemID: 1,
    itemKey: "AAAA",
    title: "Subject paper",
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: 2020,
    publicationDate: null,
    citationSequence: null,
    doi: "10.1000/subject",
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: "openalex",
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: "W1",
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
    metadataCompleteness: 1,
    ...overrides,
  }) as CitationGraphNode;

describe("relationshipTabLabel", () => {
  it("shows an ellipsis while membership is being published", () => {
    const label = relationshipTabLabel(
      "cited-by",
      {
        active: true,
        membershipPublished: false,
        reportedCount: null,
        reportedCountProvider: null,
        identifiedCount: 0,
      },
      12,
    );
    expect(label).to.deep.equal({
      name: "Cited by",
      count: "…",
      title: "Cited by (updating…)",
    });
  });

  it("prefers the published count over the reported one", () => {
    const label = relationshipTabLabel(
      "references",
      {
        active: false,
        membershipPublished: true,
        reportedCount: 40,
        reportedCountProvider: "openalex",
        identifiedCount: 40,
      },
      12,
    );
    expect(label.count).to.equal("40");
    expect(label.title).to.equal("References (40 reported)");
  });

  it("falls back to the reported count and an em dash", () => {
    expect(relationshipTabLabel("references", null, 12).count).to.equal("12");
    expect(relationshipTabLabel("references", null, null).count).to.equal("—");
  });
});

describe("mergeRelationEntries", () => {
  const manualRelation: ManualCitationRelation = {
    id: 7,
    libraryID: 1,
    subjectItemKey: "AAAA",
    relatedItemKey: "BBBB",
    direction: "reference",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("puts manual relations first and drops a provider duplicate", () => {
    const manualWork = work({
      provider: "manual",
      doi: "10.1000/b",
      inLibraryItemKey: "BBBB",
      zoteroItemKey: "BBBB",
    });
    const entries = mergeRelationEntries(
      [{ relation: manualRelation, work: manualWork }],
      [work({ doi: "10.1000/b" }), work({ doi: "10.1000/c" })],
      () => null,
    );
    expect(entries.map((entry) => entry.work.doi)).to.deep.equal([
      "10.1000/b",
      "10.1000/c",
    ]);
    expect(entries[0].manualRelation).to.equal(manualRelation);
    expect(entries[1].manualRelation).to.equal(null);
    expect(entries.map((entry) => entry.providerOrder)).to.deep.equal([0, 1]);
  });

  it("skips a manual relation whose item could not be loaded", () => {
    const entries = mergeRelationEntries(
      [{ relation: manualRelation, work: null }],
      [work({ doi: "10.1000/c" })],
      () => null,
    );
    expect(entries).to.have.length(1);
  });

  it("resolves the ignored relation for provider works only", () => {
    const ignored: IgnoredProviderRelation = {
      id: 3,
      libraryID: 1,
      subjectItemKey: "AAAA",
      direction: "reference",
      provider: "openalex",
      providerWorkID: null,
      doi: "10.1000/c",
      normalizedTitle: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const entries = mergeRelationEntries(
      [],
      [work({ doi: "10.1000/c" })],
      (candidate) => (candidate.doi === "10.1000/c" ? ignored : null),
    );
    expect(entries[0].ignoredRelation).to.equal(ignored);
  });
});

describe("ignoredRelationDescriptorFor", () => {
  const reference: RelatedWorkMetadata = {
    provider: "openalex",
    providerWorkID: "W9",
    doi: "10.1000/ref",
    title: "A reference",
    year: 2010,
    authors: [],
    sourceTitle: null,
    abstract: null,
    citationCount: null,
    referenceCount: null,
    isOpenAccess: null,
    openAccessStatus: null,
    isRetracted: null,
    zoteroItemKey: null,
  } as RelatedWorkMetadata;

  it("names the subject's own reference record for a references row", () => {
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "references",
      work({ doi: "10.1000/ref" }),
      () => ({ references: [reference] }),
    );
    expect(descriptor.subjectItemKey).to.equal("AAAA");
    expect(descriptor.direction).to.equal("reference");
    expect(descriptor.providerWorkID).to.equal("W9");
  });

  it("flips to the citing item's reference for a cited-by row that is in the library", () => {
    const citing = work({ doi: "10.1000/citing", inLibraryItemKey: "CCCC" });
    const subjectAsReference = { ...reference, doi: "10.1000/subject" };
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "cited-by",
      citing,
      (_libraryID, itemKey) =>
        itemKey === "CCCC" ? { references: [subjectAsReference] } : null,
    );
    expect(descriptor.subjectItemKey).to.equal("CCCC");
    expect(descriptor.direction).to.equal("reference");
    expect(descriptor.doi).to.equal("10.1000/subject");
  });

  it("describes the citing work itself when it is not in the library", () => {
    const descriptor = ignoredRelationDescriptorFor(
      node({}),
      1,
      "cited-by",
      work({ doi: "10.1000/citing" }),
      () => null,
    );
    expect(descriptor.subjectItemKey).to.equal("AAAA");
    expect(descriptor.direction).to.equal("cited-by");
    expect(descriptor.doi).to.equal("10.1000/citing");
  });
});
