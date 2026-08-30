import { describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import type { RelatedWorkMetadata } from "../../src/domain/citationTypes";
import {
  CACHE_RELATED_WORK_MERGE,
  mergeRelatedWorkRecords,
} from "../../src/domain/relatedWorkMetadata";
import {
  createRelatedWorkLookupIndex,
  externalWorkLookupIdentity,
  findMatchingRelatedWork,
  matchRelatedWorks,
  relationshipCandidateIdentity,
  stableExternalWorkIdentity,
} from "../../src/domain/workIdentity";
import {
  comparePublicationYears,
  firstPublicationYear,
  publicationYearOrNull,
  uniquePositiveIntegers,
} from "../../src/domain/valueNormalization";
import {
  createIgnoredRelationIndex,
  findIgnoredRelation,
  ignoredRelationDescriptorForRelatedWork,
  ignoredRelationMatchesDescriptor,
} from "../../src/domain/relationshipDescriptors";
import { workIdentifiersForRelatedWork } from "../../src/domain/workIdentifiers";
import { graphThemeFor } from "../../src/services/graphTheme";
import { SerializedTaskQueue } from "../../src/services/serializedTaskQueue";
import { RelationshipMetadataDependencyIndex } from "../../src/services/relationshipMetadataDependencyIndex";
import { projectRelatedWorkSummary } from "../../src/services/relatedWorkHydrationState";
import {
  mapBounded,
  mapCooperatively,
  settleBounded,
} from "../../src/services/backgroundTaskService";
import {
  openAlexIdentifierForWork,
  semanticScholarIdentifierForIdentifiers,
  semanticScholarIdentifierForWork,
  shortOpenAlexID,
} from "../../src/providers/providerIdentifiers";
import { collectionScopeIDs } from "../../src/services/paperListViewService";
import { getExternalWorkNodeLabel } from "../../src/services/externalWorkMetricRegistry";
import { decodeRelatedWorkMetadata } from "../../src/services/cacheDecoders";
import {
  isFilteredPreservedNode,
  renderedGraphKeys,
} from "../../src/services/graphVisibility";
import {
  buildGraphFocusProjection,
  externalWorkToFocusNode,
  synchronizeExternalFocusNode,
} from "../../src/services/graphFocusService";
import {
  assignFocusCitationSequence,
  assignGraphCitationSequence,
} from "../../src/services/citationSequenceService";
import {
  contextCollectionIDs,
  contextRegularItems,
} from "../../src/services/menuContext";
import { getMetricDefinition } from "../../src/services/metricRegistry";
import {
  inverseScaleValue,
  niceStep,
  numericColor,
  scaleValue,
} from "../../src/services/graphMetricScale";
import {
  automaticFocusSeedRefreshPlan,
  orderRelationshipProviders,
  preferredRelationshipProviders,
  relationshipForegroundMetadataLimit,
  relationshipProviderPolicyForSize,
  relationshipRefreshRequiresFollowUp,
  relationshipRefreshPolicy,
  relationshipSnapshotIsFresh,
} from "../../src/services/relationshipRefreshPolicy";
import { authoritativeReferenceCountAttribution } from "../../src/services/citationCountPolicy";
import {
  prepareRelationshipSnapshots,
  selectRelationshipMembership,
} from "../../src/services/providerDispatcher";
import { mergeRelatedWorkLists } from "../../src/services/relationshipStoreService";
import {
  beginRelationshipPublicationBatch,
  endRelationshipPublicationBatch,
  getRelationshipPublicationState,
  publishRelationshipPublication,
  subscribeRelationshipPublications,
} from "../../src/services/relationshipEvents";
import {
  beginCitationUpdatePublicationBatch,
  endCitationUpdatePublicationBatch,
  publishCitationUpdateCompleted,
  subscribeToCitationUpdates,
} from "../../src/services/citationUpdateEvents";
import {
  collectionGraphTitle,
  multiCollectionGraphTitle,
  nextGraphViewTitle,
  graphInstanceShouldRender,
  isGraphTabDescriptor,
  selectReusableGraphInstance,
} from "../../src/services/graphInstancePolicy";
import {
  appendUniqueScopeKeys,
  extendItemScope,
  replaceItemScope,
} from "../../src/services/graphScopePolicy";
import {
  cancellationRequested,
  createCancellationScope,
} from "../../src/services/cancellationScope";
import {
  cloneCitationGraphModel,
  createCitationGraphIndex,
} from "../../src/services/graphSnapshotStore";
import {
  clearFocusGraphCaches,
  focusProjectionCacheKey,
  getFocusRelationshipFragment,
  setFocusRelationshipFragment,
} from "../../src/services/focusGraphCacheService";

function work(
  overrides: Partial<RelatedWorkMetadata> = {},
): RelatedWorkMetadata {
  return {
    provider: "crossref",
    providerWorkID: null,
    doi: null,
    title: "Example paper",
    year: 2024,
    authors: ["Alice Smith"],
    ...overrides,
  };
}

describe("Architecture foundations", function () {
  it("builds reusable graph indexes and clones mutable view models", function () {
    const source = externalWorkToFocusNode(
      work({ providerWorkID: "source", doi: "10.1000/source" }),
      "seed",
    );
    const target = externalWorkToFocusNode(
      work({ providerWorkID: "target", doi: "10.1000/target" }),
      "reference",
    );
    const model = {
      nodes: [source, target],
      edges: [
        {
          key: `${source.key}>${target.key}`,
          source: source.key,
          target: target.key,
          provenance: "crossref",
          manual: false,
        },
      ],
      statistics: {
        nodes: 2,
        resolvedNodes: 2,
        edges: 1,
        isolatedNodes: 0,
      },
    };

    const index = createCitationGraphIndex(model);
    expect(index.nodeByKey.get(target.key)?.key).to.equal(target.key);
    expect(index.outgoingEdgesByKey.get(source.key)?.[0]?.target).to.equal(
      target.key,
    );
    expect(index.incomingEdgesByKey.get(target.key)?.[0]?.source).to.equal(
      source.key,
    );

    const cloned = cloneCitationGraphModel(model);
    cloned.nodes[0].title = "Changed";
    cloned.nodes[0].authors.push("Another author");
    cloned.edges[0].provenance = "manual";
    expect(model.nodes[0].title).to.equal("Example paper");
    expect(model.nodes[0].authors).to.deep.equal(["Alice Smith"]);
    expect(model.edges[0].provenance).to.equal("crossref");
  });

  it("reuses bounded Focus fragments and invalidates projection keys on change", function () {
    clearFocusGraphCaches();
    const state = {
      seedKeys: ["seed"],
      direction: "both" as const,
      locality: "all" as const,
      ranking: "relevance" as const,
      maxPerDirection: 25,
    };
    const first = work({ doi: "10.1000/one", citationCount: 2 });
    setFocusRelationshipFragment(1, "seed", {
      references: [first],
      citedBy: [],
    });
    const firstKey = focusProjectionCacheKey(1, "graph-a", state);
    const cached = getFocusRelationshipFragment(1, "seed");
    expect(cached?.references[0].doi).to.equal("10.1000/one");

    setFocusRelationshipFragment(1, "seed", {
      references: [work({ doi: "10.1000/one", citationCount: 3 })],
      citedBy: [],
    });
    const secondKey = focusProjectionCacheKey(1, "graph-a", state);
    expect(secondKey).not.to.equal(firstKey);
    clearFocusGraphCaches();
  });

  it("invalidates only relationship lists that depend on changed summaries", function () {
    const index = new RelationshipMetadataDependencyIndex();
    index.register("paper-a:references", ["doi:one", "doi:two"]);
    index.register("paper-b:references", ["doi:three"]);

    expect([...index.affectedRelationships(["doi:two"])]).to.deep.equal([
      "paper-a:references",
    ]);
    expect([...index.affectedRelationships(["doi:three"])]).to.deep.equal([
      "paper-b:references",
    ]);

    index.register("paper-a:references", ["doi:four"]);
    expect([...index.affectedRelationships(["doi:two"])]).to.deep.equal([]);
    expect([...index.affectedRelationships(["doi:four"])]).to.deep.equal([
      "paper-a:references",
    ]);
  });

  it("projects relationship summaries without retaining heavy nested metadata", function () {
    const projected = projectRelatedWorkSummary(
      work({
        abstract: "A large abstract",
        citationCountsByYear: [{ year: 2024, count: 10 }],
        references: [work({ title: "Nested reference" })],
        sourceMetrics: {
          sourceID: "S1",
          sourceTitle: "Journal",
          twoYearMeanCitedness: 3,
          hIndex: 20,
          i10Index: 15,
          updatedAt: "2026-01-01",
        },
      }),
      false,
    );

    expect(projected.title).to.equal("Example paper");
    expect(projected.authors).to.deep.equal(["Alice Smith"]);
    expect(projected.abstract).to.equal(undefined);
    expect(projected.references).to.equal(undefined);
    expect(projected.citationCountsByYear).to.equal(undefined);
    expect(projected.sourceMetrics).to.equal(undefined);
  });

  it("cancels one request scope without affecting independent work", function () {
    const first = createCancellationScope("first");
    const second = createCancellationScope("second");
    let notifications = 0;
    first.signal.subscribe(() => {
      notifications += 1;
    });

    first.cancel();
    first.cancel();

    expect(cancellationRequested(first.signal)).to.equal(true);
    expect(cancellationRequested(second.signal)).to.equal(false);
    expect(notifications).to.equal(1);
  });

  it("notifies late cancellation subscribers immediately", function () {
    const scope = createCancellationScope("late subscriber");
    scope.cancel();
    let notified = false;
    scope.signal.subscribe(() => {
      notified = true;
    });
    expect(notified).to.equal(true);
  });

  it("continues notifying cancellation listeners after one throws", function () {
    const scope = createCancellationScope("listener isolation");
    let notified = false;
    scope.signal.subscribe(() => {
      throw new Error("expected test failure");
    });
    scope.signal.subscribe(() => {
      notified = true;
    });
    scope.cancel();
    expect(notified).to.equal(true);
  });

  it("routes ordinary Meristema commands to the selected or most recent instance", function () {
    const instances = [
      { instanceID: "older", tabID: "tab-1", lastActivatedAt: 10 },
      { instanceID: "newer", tabID: "tab-2", lastActivatedAt: 20 },
    ];
    expect(
      selectReusableGraphInstance(instances, "tab-1")?.instanceID,
    ).to.equal("older");
    expect(
      selectReusableGraphInstance(instances, "other")?.instanceID,
    ).to.equal("newer");
  });

  it("replaces a new map scope and extends an existing scoped map", function () {
    const initial = replaceItemScope([3, 1, 3, 2]);
    expect([...initial]).to.deep.equal([3, 1, 2]);
    const extended = extendItemScope(initial, [2, 4, 4]);
    expect([...(extended ?? [])]).to.deep.equal([3, 1, 2, 4]);
  });

  it("keeps a full-library map unscoped when papers are opened into it", function () {
    expect(extendItemScope(null, [1, 2, 3])).to.equal(null);
  });

  it("adds only missing Focus seeds while preserving existing seed order", function () {
    expect(
      appendUniqueScopeKeys(["seed-a", "seed-b"], ["seed-b", "seed-c"]),
    ).to.deep.equal(["seed-a", "seed-b", "seed-c"]);
  });

  it("never promotes the reserved library tab into a graph view instance", function () {
    expect(
      isGraphTabDescriptor({ id: "zotero-pane", type: "library" }),
    ).to.equal(false);
    expect(isGraphTabDescriptor({ id: "tab-reader", type: "reader" })).to.equal(
      false,
    );
    expect(
      isGraphTabDescriptor({ id: "tab-map", type: config.addonRef }),
    ).to.equal(true);
    expect(
      isGraphTabDescriptor({
        id: "tab-map",
        type: `${config.addonRef}-unloaded`,
      }),
    ).to.equal(true);
  });

  it("assigns separate default names to Collection Graph and Explore views", function () {
    expect(nextGraphViewTitle("map", [])).to.equal("Collection Graph");
    expect(nextGraphViewTitle("map", ["Collection Graph"])).to.equal(
      "Collection Graph 2",
    );
    expect(
      nextGraphViewTitle("focus", ["Collection Graph", "Explore"]),
    ).to.equal("Explore 2");
  });

  it("names a multi-folder graph after the first folder and a count", function () {
    // One folder reads exactly as it did before this feature existed.
    expect(multiCollectionGraphTitle(["PhD"])).to.equal("PhD Graph");
    // Several stay readable in a tab: the first name, then how many more.
    expect(multiCollectionGraphTitle(["PhD", "Reading"])).to.equal(
      "PhD +1 Graph",
    );
    expect(multiCollectionGraphTitle(["PhD", "Reading", "Archive"])).to.equal(
      "PhD +2 Graph",
    );
    // A folder already named like a graph is not doubled, and the count still
    // reflects the others.
    expect(multiCollectionGraphTitle(["Reading Graph", "PhD"])).to.equal(
      "Reading +1 Graph",
    );
    // Blank names are ignored rather than counted as folders.
    expect(multiCollectionGraphTitle(["PhD", "   ", ""])).to.equal("PhD Graph");
    expect(multiCollectionGraphTitle([])).to.equal(null);
    expect(multiCollectionGraphTitle(["  "])).to.equal(null);
  });

  it("unions the folders a graph is scoped to", function () {
    const collections = [
      { collectionID: 1, includedCollectionIDs: [1, 11, 12] }, // PhD + children
      { collectionID: 2, includedCollectionIDs: [2] }, // Reading, no children
      { collectionID: 3, includedCollectionIDs: [] }, // no expansion recorded
    ] as any;

    // Several folders admit the union of their papers, not the intersection.
    // Asking for PhD and Reading asks for both bodies of work; the papers filed
    // in both at once are usually none.
    expect(
      [...collectionScopeIDs([1, 2], collections)].sort((a, b) => a - b),
    ).to.deep.equal([1, 2, 11, 12]);

    // Subcollections come along, for every selected folder.
    expect(
      [...collectionScopeIDs([1], collections)].sort((a, b) => a - b),
    ).to.deep.equal([1, 11, 12]);

    // A folder with no recorded expansion still admits itself.
    expect([...collectionScopeIDs([3], collections)]).to.deep.equal([3]);

    // An unknown folder admits itself rather than nothing, so a stale ID
    // narrows the graph instead of emptying it.
    expect([...collectionScopeIDs([99], collections)]).to.deep.equal([99]);

    // Overlapping expansions are not double counted.
    expect(
      [...collectionScopeIDs([1, 1], collections)].sort((a, b) => a - b),
    ).to.deep.equal([1, 11, 12]);

    // Empty in, empty out. An empty scope is the whole library, and the caller
    // skips the dimension rather than matching nothing.
    expect([...collectionScopeIDs([], collections)]).to.deep.equal([]);
  });

  it("builds a folder's graph name from the folder name", function () {
    expect(collectionGraphTitle("PhD")).to.equal("PhD Graph");
    expect(collectionGraphTitle("  PhD  ")).to.equal("PhD Graph");
    // Already graph-named folders are left alone rather than doubled up.
    expect(collectionGraphTitle("Reading Graph")).to.equal("Reading Graph");
    expect(collectionGraphTitle("reading graph")).to.equal("reading graph");
    // No name means no graph name; the caller falls back to the generic base.
    expect(collectionGraphTitle("")).to.equal(null);
    expect(collectionGraphTitle("   ")).to.equal(null);
    expect(collectionGraphTitle(null)).to.equal(null);
    expect(collectionGraphTitle(undefined)).to.equal(null);
    // "Graphene" ends in graph-the-substring but not graph-the-word.
    expect(collectionGraphTitle("Graphene")).to.equal("Graphene Graph");
  });

  it("names a folder's graph after the folder", function () {
    // A graph opened from a folder is titled after it, so the tab says what it
    // shows. Deduplication still applies: opening the same folder twice must
    // not produce two tabs with one name.
    expect(nextGraphViewTitle("map", [], "PhD Graph")).to.equal("PhD Graph");
    expect(nextGraphViewTitle("map", ["PhD Graph"], "PhD Graph")).to.equal(
      "PhD Graph 2",
    );
    // A blank or whitespace folder name falls back to the generic base rather
    // than titling a tab with nothing.
    expect(nextGraphViewTitle("map", [], "   ")).to.equal("Collection Graph");
    expect(nextGraphViewTitle("map", [], "")).to.equal("Collection Graph");
  });

  it("defers redraws for hidden Meristema tabs", function () {
    expect(graphInstanceShouldRender(false, false)).to.equal(false);
    expect(graphInstanceShouldRender(false, true)).to.equal(true);
    expect(graphInstanceShouldRender(true, false)).to.equal(true);
  });

  it("keeps fuzzy bibliographic evidence out of persistent identities", function () {
    const titleOnly = work();
    expect(stableExternalWorkIdentity(titleOnly)).to.equal(null);
    expect(externalWorkLookupIdentity(titleOnly)).to.match(/^candidate:/);
  });

  it("uses stronger candidate keys than title alone", function () {
    const first = relationshipCandidateIdentity(work());
    const second = relationshipCandidateIdentity(
      work({ authors: ["Bob Jones"], year: 2025 }),
    );
    expect(first).not.to.equal(second);
  });

  it("finds one relationship from a large alias index without a list scan", function () {
    const references = Array.from({ length: 1200 }, (_, index) =>
      work({
        doi: `10.1000/reference-${index}`,
        title: `Reference ${index}`,
      }),
    );
    const index = createRelatedWorkLookupIndex(references);
    const matched = findMatchingRelatedWork(
      index,
      work({
        provider: "openalex",
        providerWorkID: "W-TARGET",
        doi: "https://doi.org/10.1000/reference-997",
        title: "Provider title variant",
      }),
    );
    expect(matched?.title).to.equal("Reference 997");
  });

  it("indexes ignored relationships by provider, DOI, and title aliases", function () {
    const ignored = {
      id: 1,
      libraryID: 1,
      subjectItemKey: "ITEMKEY1",
      direction: "reference" as const,
      provider: "crossref" as const,
      providerWorkID: "10.1000/ignored",
      doi: "10.1000/ignored",
      normalizedTitle: "ignored paper",
      createdAt: new Date(0).toISOString(),
    };
    const index = createIgnoredRelationIndex([ignored]);
    const descriptor = ignoredRelationDescriptorForRelatedWork(
      1,
      "itemkey1",
      "reference",
      work({
        provider: "openalex",
        providerWorkID: "W1",
        doi: "https://doi.org/10.1000/ignored",
        title: "Ignored paper",
      }),
    );
    expect(findIgnoredRelation(index, descriptor)).to.equal(ignored);
  });

  it("merges counts and provider provenance through one policy", function () {
    const merged = mergeRelatedWorkRecords(
      work({
        doi: "10.1000/shared",
        citationCount: 4,
        dataSources: ["crossref"],
      }),
      work({
        provider: "openalex",
        providerWorkID: "W1",
        doi: "10.1000/shared",
        citationCount: 9,
        abstract: "A richer abstract",
        dataSources: ["openalex"],
      }),
      CACHE_RELATED_WORK_MERGE,
    );
    expect(merged.provider).to.equal("openalex");
    expect(merged.providerWorkID).to.equal("W1");
    expect(merged.citationCount).to.equal(9);
    expect(merged.dataSources).to.include.members(["crossref", "openalex"]);
    expect(merged.propertySources?.title).to.include.members([
      "crossref",
      "openalex",
    ]);
    expect(merged.propertySources?.citationCount).to.deep.equal(["openalex"]);
    expect(
      merged.propertyConflicts?.some(
        (conflict) => conflict.property === "citationCount",
      ),
    ).to.equal(true);
  });

  it("flags conflicting stable identifiers without merging provider data", function () {
    const local = work({ provider: "zotero", doi: "10.1000/local" });
    const provider = work({
      provider: "openalex",
      doi: "10.1000/provider",
      abstract: "Provider abstract",
    });
    const match = matchRelatedWorks(local, provider);
    const merged = mergeRelatedWorkRecords(
      local,
      provider,
      CACHE_RELATED_WORK_MERGE,
    );
    expect(match.decision).to.equal("different-work");
    expect(match.identityConflict).to.equal(true);
    expect(merged.identityStatus).to.equal("conflict");
    expect(merged.abstract).to.equal(undefined);
  });

  it("keeps likely preprint and publication versions separate", function () {
    const preprint = work({
      provider: "semantic-scholar",
      providerWorkID: null,
      title: "A distinctive study of citation identity resolution",
      year: 2021,
    });
    const publication = work({
      provider: "crossref",
      providerWorkID: null,
      title: preprint.title,
      year: 2024,
    });
    expect(matchRelatedWorks(preprint, publication).decision).to.equal(
      "possible-version",
    );
  });

  it("serializes tasks without poisoning the queue after a failure", async function () {
    const queue = new SerializedTaskQueue();
    const order: number[] = [];
    const first = queue.enqueue(async () => {
      order.push(1);
      throw new Error("expected");
    });
    const second = queue.enqueue(async () => {
      order.push(2);
    });
    await first.catch(() => undefined);
    await second;
    expect(order).to.deep.equal([1, 2]);
  });

  it("runs cooperative mapping without changing result order", async function () {
    const visited: number[] = [];
    const result = await mapCooperatively(
      [1, 2, 3, 4],
      async (value) => {
        visited.push(value);
        return value * 2;
      },
      { forceEvery: 1 },
    );
    expect(visited).to.deep.equal([1, 2, 3, 4]);
    expect(result).to.deep.equal([2, 4, 6, 8]);
  });

  it("normalizes shared positive-integer preferences consistently", function () {
    expect(
      uniquePositiveIntegers([3, "2", 0, 3, -1, 4.5, "invalid"]),
    ).to.deep.equal([3, 2]);
  });

  it("treats absent and zero publication years as missing", function () {
    expect(publicationYearOrNull(null)).to.equal(null);
    expect(publicationYearOrNull(undefined)).to.equal(null);
    expect(publicationYearOrNull("")).to.equal(null);
    expect(publicationYearOrNull(0)).to.equal(null);
    expect(publicationYearOrNull("0")).to.equal(null);
    expect(publicationYearOrNull(1499)).to.equal(null);
    expect(publicationYearOrNull(2200)).to.equal(null);
    expect(publicationYearOrNull("2024")).to.equal(2024);
    expect(firstPublicationYear(0, null, "2021")).to.equal(2021);
  });

  it("normalizes legacy cached year zero to a missing year", function () {
    expect(
      decodeRelatedWorkMetadata(
        {
          provider: "openalex",
          providerWorkID: "W1",
          doi: null,
          title: "Missing year",
          year: 0,
          authors: [],
        },
        "test",
      ).year,
    ).to.equal(null);
  });

  it("keeps missing publication years after valid years in both year orders", function () {
    const years = [0, 2020, 2024];
    expect(
      [...years].sort((left, right) =>
        comparePublicationYears(left, right, "descending"),
      ),
    ).to.deep.equal([2024, 2020, 0]);
    expect(
      [...years].sort((left, right) =>
        comparePublicationYears(left, right, "ascending"),
      ),
    ).to.deep.equal([2020, 2024, 0]);
  });

  it("builds canonical provider lookup identifiers", function () {
    expect(
      semanticScholarIdentifierForWork(
        work({ doi: "https://doi.org/10.1000/ABC" }),
      ),
    ).to.equal("DOI:10.1000/abc");
    expect(
      semanticScholarIdentifierForIdentifiers({
        doi: null,
        pmid: " 123456 ",
        arxiv: null,
        isbn: null,
        title: "Paper",
        normalizedTitle: "paper",
        year: 2024,
        authors: [],
        sourceTitle: null,
      }),
    ).to.equal("PMID:123456");
    expect(
      openAlexIdentifierForWork(
        work({
          provider: "openalex",
          providerWorkID: "https://openalex.org/W123",
        }),
      ),
    ).to.equal("W123");
    expect(shortOpenAlexID("http://openalex.org/W456")).to.equal("W456");
  });

  it("builds one canonical identifier set for related works", function () {
    expect(
      workIdentifiersForRelatedWork(
        work({
          doi: "https://doi.org/10.1000/ABC",
          pmid: " 123 ",
          arxiv: " 2401.00001 ",
          isbn: " 978-1 ",
          title: "  Example Paper  ",
        }),
      ),
    ).to.deep.include({
      doi: "10.1000/abc",
      pmid: "123",
      arxiv: "2401.00001",
      isbn: "978-1",
      title: "Example Paper",
      normalizedTitle: "example paper",
    });
  });

  it("uses shared relationship descriptors for manual and provider records", function () {
    const descriptor = ignoredRelationDescriptorForRelatedWork(
      1,
      "SUBJECT",
      "reference",
      work({
        provider: "manual",
        providerWorkID: "ignored",
        doi: "https://doi.org/10.1000/ABC",
      }),
    );
    expect(descriptor.provider).to.equal("crossref");
    expect(descriptor.providerWorkID).to.equal(null);
    expect(
      ignoredRelationMatchesDescriptor(
        {
          id: 1,
          libraryID: 1,
          subjectItemKey: "SUBJECT",
          direction: "reference",
          provider: "openalex",
          providerWorkID: null,
          doi: "10.1000/abc",
          normalizedTitle: null,
          createdAt: "2026-07-31T00:00:00Z",
        },
        descriptor,
      ),
    ).to.equal(true);
  });

  it("keeps shared graph scales reversible and bounded", function () {
    const linear = scaleValue(30, 10, 50, "linear");
    expect(linear).to.equal(0.5);
    expect(inverseScaleValue(linear, [10, 50], "linear")).to.equal(30);

    const logarithmic = scaleValue(10, 1, 100, "log");
    expect(logarithmic).to.be.closeTo(0.5, 1e-12);
    expect(inverseScaleValue(logarithmic, [1, 100], "log")).to.be.closeTo(
      10,
      1e-12,
    );
    expect(niceStep(93, 5, true)).to.equal(20);
    const theme = graphThemeFor("light");
    expect(numericColor(-1, theme)).to.equal(numericColor(0, theme));
    expect(numericColor(2, theme)).to.equal(numericColor(1, theme));
  });

  it("bounds concurrent mapping and preserves result order", async function () {
    let active = 0;
    let maximumActive = 0;
    const result = await mapBounded(
      [1, 2, 3, 4],
      2,
      async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return value * 10;
      },
      { yieldAfterEach: true, yieldDelayMs: 1 },
    );
    expect(maximumActive).to.equal(2);
    expect(result).to.deep.equal([10, 20, 30, 40]);
  });

  it("retains bounded task failures without stopping later work", async function () {
    const results = await settleBounded([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("expected");
      return value;
    });
    expect(results.map((result) => result.status)).to.deep.equal([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
  });

  it("reuses fresh Focus membership without foreground metadata hydration", function () {
    const plan = automaticFocusSeedRefreshPlan();
    expect(plan.forceRefresh).to.equal(false);
    expect(plan.membershipLimit).to.equal(50);
    expect(plan.foregroundMetadataLimit).to.equal(0);
    expect(plan.showBackgroundProgress).to.equal(true);
    expect(plan.startDelayMs).to.be.greaterThan(0);
  });

  it("keeps every enabled relationship provider in automatic refreshes", function () {
    const policy = relationshipRefreshPolicy("automatic");
    expect(policy.membershipLimit).to.equal(50);
    expect(policy.metadataLimit).to.equal(25);
    expect(policy.metadataBatchSize).to.equal(10);
    expect(policy.providerLimit).to.equal(Number.POSITIVE_INFINITY);
    expect(
      orderRelationshipProviders(
        ["semantic-scholar", "crossref", "inspire"],
        ["inspire"],
        policy.providerStrategy,
        policy.providerLimit,
      ),
    ).to.deep.equal(["semantic-scholar", "crossref", "inspire"]);
  });

  it("keeps manual relationship metadata hydration bounded", function () {
    const policy = relationshipRefreshPolicy("manual");
    expect(policy.membershipLimit).to.equal(Number.POSITIVE_INFINITY);
    expect(policy.metadataLimit).to.equal(50);
    expect(policy.metadataBatchSize).to.equal(50);
  });

  it("does not reduce the enabled provider set for very large relationship lists", function () {
    expect(relationshipProviderPolicyForSize("manual", 1221)).to.deep.equal({
      providerStrategy: "aggregate",
      providerLimit: Number.POSITIVE_INFINITY,
    });
    expect(
      relationshipProviderPolicyForSize("manual", 1221, {
        providerStrategy: "native-first",
        providerLimit: 2,
      }),
    ).to.deep.equal({
      providerStrategy: "aggregate",
      providerLimit: Number.POSITIVE_INFINITY,
    });
  });

  it("retains every enabled provider for DOI reference membership", function () {
    const available = ["semantic-scholar", "crossref", "openalex"] as const;
    expect(
      orderRelationshipProviders(
        available,
        preferredRelationshipProviders(
          "references",
          available,
          "openalex",
          "openalex",
          true,
        ),
        "aggregate",
        Number.POSITIVE_INFINITY,
      ),
    ).to.deep.equal(["semantic-scholar", "crossref", "openalex"]);
  });

  it("keeps the largest reported reference total", function () {
    expect(
      authoritativeReferenceCountAttribution([
        { count: 1221, provider: "openalex" },
        { count: 1215, provider: "crossref" },
      ]),
    ).to.deep.equal({ count: 1221, provider: "openalex" });
    expect(
      authoritativeReferenceCountAttribution([
        { count: 1215, provider: "crossref" },
        { count: 1214, provider: "crossref" },
      ]),
    ).to.deep.equal({ count: 1215, provider: "crossref" });
  });

  it("merges every provider once and publishes only the largest total", function () {
    const snapshots = prepareRelationshipSnapshots(
      [
        {
          provider: "crossref",
          works: [work({ doi: "10.1000/crossref-only" })],
          reportedCount: 1215,
          complete: true,
          succeeded: true,
        },
        {
          provider: "openalex",
          works: [work({ provider: "openalex", doi: "10.1000/openalex-only" })],
          reportedCount: 1221,
          complete: true,
          succeeded: true,
        },
      ],
      mergeRelatedWorkLists,
    );
    const selected = selectRelationshipMembership(
      "references",
      snapshots,
      mergeRelatedWorkLists,
    );
    expect(selected.works.map((entry) => entry.doi)).to.have.members([
      "10.1000/crossref-only",
      "10.1000/openalex-only",
    ]);
    expect(selected.reportedCount).to.equal(1221);
    expect(selected.countProvider).to.equal("openalex");
    expect(selected.authorityProvider).to.equal(null);
  });

  it("defers optional foreground metadata for very large manual lists", function () {
    expect(relationshipForegroundMetadataLimit("manual", 1221, 50)).to.equal(0);
    expect(relationshipForegroundMetadataLimit("manual", 120, 50)).to.equal(50);
  });

  it("refreshes only missing or stale relationship snapshots automatically", function () {
    const now = Date.parse("2026-07-29T12:00:00Z");
    expect(
      relationshipSnapshotIsFresh("2026-07-28T12:00:00Z", 2 * 86400000, now),
    ).to.equal(true);
    expect(
      relationshipSnapshotIsFresh("2026-07-20T12:00:00Z", 2 * 86400000, now),
    ).to.equal(false);
  });

  it("serializes broader manual relationship refreshes after automatic work", function () {
    expect(
      relationshipRefreshRequiresFollowUp(
        { mode: "automatic", membershipLimit: 50 },
        { mode: "manual", membershipLimit: 200 },
        true,
      ),
    ).to.equal(true);
    expect(
      relationshipRefreshRequiresFollowUp(
        { mode: "manual", membershipLimit: 200 },
        { mode: "automatic", membershipLimit: 50 },
        true,
      ),
    ).to.equal(false);
  });

  it("keeps the selected paper rendered outside the active filter", function () {
    const filteredKeys = new Set(["A", "B"]);
    expect([...renderedGraphKeys(filteredKeys, "C")]).to.have.members([
      "A",
      "B",
      "C",
    ]);
    expect(isFilteredPreservedNode("C", filteredKeys, "C")).to.equal(true);
    expect(isFilteredPreservedNode("A", filteredKeys, "A")).to.equal(false);
  });

  it("keeps focus seeds rendered when filters exclude them", function () {
    const filteredKeys = new Set(["A"]);
    const pinnedKeys = new Set(["SEED"]);
    expect([
      ...renderedGraphKeys(filteredKeys, null, pinnedKeys),
    ]).to.have.members(["A", "SEED"]);
    expect(
      isFilteredPreservedNode("SEED", filteredKeys, null, pinnedKeys),
    ).to.equal(true);
  });

  it("builds a one-hop focus projection with local and external neighbours", function () {
    const seed = {
      ...externalWorkToFocusNode(work({ title: "Seed" }), "seed"),
      key: "SEED",
      itemKey: "SEED",
      itemID: 1,
      kind: "local" as const,
    };
    const localReference = {
      ...externalWorkToFocusNode(
        work({ title: "Local reference" }),
        "reference",
      ),
      key: "LOCAL",
      itemKey: "LOCAL",
      itemID: 2,
      kind: "local" as const,
    };
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [seed, localReference],
        edges: [
          {
            key: "SEED>LOCAL",
            source: "SEED",
            target: "LOCAL",
            provenance: "zotero",
            manual: false,
          },
        ],
        statistics: {
          nodes: 2,
          resolvedNodes: 2,
          edges: 1,
          isolatedNodes: 0,
        },
      },
      state: {
        seedKeys: ["SEED"],
        direction: "both",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds: [seed],
      relationships: new Map([
        [
          "SEED",
          {
            references: [
              work({ doi: "10.1000/external", title: "External reference" }),
            ],
            citedBy: [],
          },
        ],
      ]),
    });
    expect(projection).not.to.equal(null);
    expect(projection!.nodes.map((node) => node.key)).to.include.members([
      "SEED",
      "LOCAL",
    ]);
    expect(projection!.nodes.some((node) => node.kind === "external")).to.equal(
      true,
    );
    expect(projection!.edges).to.have.length(2);
  });

  it("can restrict focus projections to papers already in Zotero", function () {
    const seed = {
      ...externalWorkToFocusNode(work({ title: "Seed" }), "seed"),
      key: "SEED",
      itemKey: "SEED",
      itemID: 1,
      kind: "local" as const,
    };
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [seed],
        edges: [],
        statistics: {
          nodes: 1,
          resolvedNodes: 1,
          edges: 0,
          isolatedNodes: 1,
        },
      },
      state: {
        seedKeys: ["SEED"],
        direction: "references",
        locality: "local",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds: [seed],
      relationships: new Map([
        [
          "SEED",
          {
            references: [
              work({ doi: "10.1000/external", title: "External reference" }),
            ],
            citedBy: [],
          },
        ],
      ]),
    });
    expect(projection!.nodes.map((node) => node.key)).to.deep.equal(["SEED"]);
  });

  it("does not merge focus papers when stable identifiers conflict", function () {
    const seed = externalWorkToFocusNode(
      work({ doi: "10.1000/seed", title: "Shared title" }),
      "seed",
    );
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [],
        edges: [],
        statistics: {
          nodes: 0,
          resolvedNodes: 0,
          edges: 0,
          isolatedNodes: 0,
        },
      },
      state: {
        seedKeys: [seed.key],
        direction: "references",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds: [seed],
      relationships: new Map([
        [
          seed.key,
          {
            references: [work({ doi: "10.1000/other", title: "Shared title" })],
            citedBy: [],
          },
        ],
      ]),
    });
    expect(projection!.nodes).to.have.length(2);
  });

  it("promotes a provisional external seed when a stable identity is resolved", function () {
    const seed = externalWorkToFocusNode(
      work({ title: "Provisional seed", providerWorkID: null }),
      "seed",
    );
    const originalKey = seed.key;
    expect(seed.itemKey).to.match(/^focus:candidate:/);

    const refreshable = synchronizeExternalFocusNode(
      seed,
      work({
        provider: "semantic-scholar",
        providerWorkID: "S2-SEED",
        doi: "10.1000/resolved-seed",
        title: "Provisional seed",
        authors: ["Alice Smith"],
      }),
    );

    expect(refreshable).to.equal(true);
    expect(seed.key).to.equal(originalKey);
    expect(seed.itemKey).to.equal("focus:doi:10.1000/resolved-seed");
    expect(seed.provider).to.equal("semantic-scholar");
    expect(seed.providerWorkID).to.equal("S2-SEED");
    expect(seed.doi).to.equal("10.1000/resolved-seed");
  });

  it("supports an external paper as a focus seed without importing it", function () {
    const seed = externalWorkToFocusNode(
      work({
        provider: "openalex",
        providerWorkID: "W-SEED",
        doi: "10.1000/external-seed",
        title: "External seed",
      }),
      "seed",
    );
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [],
        edges: [],
        statistics: {
          nodes: 0,
          resolvedNodes: 0,
          edges: 0,
          isolatedNodes: 0,
        },
      },
      state: {
        seedKeys: [seed.key],
        direction: "references",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds: [seed],
      relationships: new Map([
        [
          seed.key,
          {
            references: [work({ doi: "10.1000/reference" })],
            citedBy: [],
          },
        ],
      ]),
    });
    expect(projection).not.to.equal(null);
    expect(projection!.seeds[0].kind).to.equal("external");
    expect(projection!.nodes).to.have.length(2);
  });

  it("deduplicates shared neighbours across multiple focus seeds", function () {
    const seedA = {
      ...externalWorkToFocusNode(
        work({ title: "Seed A", doi: "10.1000/a" }),
        "seed",
      ),
      key: "A",
      itemKey: "A",
      itemID: 1,
      kind: "local" as const,
    };
    const seedB = {
      ...externalWorkToFocusNode(
        work({ title: "Seed B", doi: "10.1000/b" }),
        "seed",
      ),
      key: "B",
      itemKey: "B",
      itemID: 2,
      kind: "local" as const,
    };
    const shared = work({
      doi: "10.1000/shared",
      title: "Shared reference",
      providerWorkID: "shared",
    });
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [seedA, seedB],
        edges: [],
        statistics: {
          nodes: 2,
          resolvedNodes: 2,
          edges: 0,
          isolatedNodes: 2,
        },
      },
      state: {
        seedKeys: ["A", "B"],
        direction: "references",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds: [seedA, seedB],
      relationships: new Map([
        ["A", { references: [shared], citedBy: [] }],
        ["B", { references: [shared], citedBy: [] }],
      ]),
    });
    expect(projection).not.to.equal(null);
    expect(projection!.seeds).to.have.length(2);
    expect(projection!.nodes).to.have.length(3);
    expect(projection!.edges).to.have.length(2);
  });

  it("applies the focus limit independently to every seed and direction", function () {
    const seedA = {
      ...externalWorkToFocusNode(
        work({ title: "Seed A", doi: "10.1000/a" }),
        "seed",
      ),
      key: "A",
      itemKey: "A",
      itemID: 1,
      kind: "local" as const,
    };
    const seedB = {
      ...externalWorkToFocusNode(
        work({ title: "Seed B", doi: "10.1000/b" }),
        "seed",
      ),
      key: "B",
      itemKey: "B",
      itemID: 2,
      kind: "local" as const,
    };
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: [seedA, seedB],
        edges: [],
        statistics: {
          nodes: 2,
          resolvedNodes: 2,
          edges: 0,
          isolatedNodes: 2,
        },
      },
      state: {
        seedKeys: ["A", "B"],
        direction: "both",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 2,
      },
      seeds: [seedA, seedB],
      relationships: new Map([
        [
          "A",
          {
            references: [
              work({ doi: "10.1000/a-ref-1", citationCount: 30 }),
              work({ doi: "10.1000/a-ref-2", citationCount: 20 }),
              work({ doi: "10.1000/a-ref-3", citationCount: 10 }),
            ],
            citedBy: [
              work({ doi: "10.1000/a-cite-1", citationCount: 30 }),
              work({ doi: "10.1000/a-cite-2", citationCount: 20 }),
              work({ doi: "10.1000/a-cite-3", citationCount: 10 }),
            ],
          },
        ],
        [
          "B",
          {
            references: [
              work({ doi: "10.1000/b-ref-1", citationCount: 30 }),
              work({ doi: "10.1000/b-ref-2", citationCount: 20 }),
              work({ doi: "10.1000/b-ref-3", citationCount: 10 }),
            ],
            citedBy: [
              work({ doi: "10.1000/b-cite-1", citationCount: 30 }),
              work({ doi: "10.1000/b-cite-2", citationCount: 20 }),
              work({ doi: "10.1000/b-cite-3", citationCount: 10 }),
            ],
          },
        ],
      ]),
    });
    expect(projection).not.to.equal(null);
    expect(projection!.nodes).to.have.length(10);
    expect(projection!.edges).to.have.length(8);
    expect(projection!.hidden).to.deep.equal({ references: 2, citedBy: 2 });
    expect(
      projection!.edges.filter((edge) => edge.source === "A"),
    ).to.have.length(2);
    expect(
      projection!.edges.filter((edge) => edge.source === "B"),
    ).to.have.length(2);
    expect(
      projection!.edges.filter((edge) => edge.target === "A"),
    ).to.have.length(2);
    expect(
      projection!.edges.filter((edge) => edge.target === "B"),
    ).to.have.length(2);
  });

  it("does not cap collection focus views at twenty seeds", function () {
    const seeds = Array.from({ length: 25 }, (_, index) => ({
      ...externalWorkToFocusNode(
        work({
          title: `Seed ${index + 1}`,
          doi: `10.1000/seed-${index + 1}`,
        }),
        "seed",
      ),
      key: `SEED-${index + 1}`,
      itemKey: `SEED-${index + 1}`,
      itemID: index + 1,
      kind: "local" as const,
    }));
    const projection = buildGraphFocusProjection({
      graph: {
        nodes: seeds,
        edges: [],
        statistics: {
          nodes: seeds.length,
          resolvedNodes: seeds.length,
          edges: 0,
          isolatedNodes: seeds.length,
        },
      },
      state: {
        seedKeys: seeds.map((seed) => seed.key),
        direction: "both",
        locality: "all",
        ranking: "relevance",
        maxPerDirection: 25,
      },
      seeds,
      relationships: new Map(
        seeds.map((seed) => [seed.key, { references: [], citedBy: [] }]),
      ),
    });
    expect(projection).not.to.equal(null);
    expect(projection!.seeds).to.have.length(25);
    expect(projection!.nodes).to.have.length(25);
  });

  it("orders citation sequence by precise publication date", function () {
    const seed = externalWorkToFocusNode(
      work({ title: "Seed", publicationDate: "2020-01-15" }),
      "seed",
    );
    const first = externalWorkToFocusNode(
      work({ title: "First citation", publicationDate: "2020-02-15" }),
      "cited-by",
    );
    const second = externalWorkToFocusNode(
      work({ title: "Second citation", publicationDate: "2020-08-15" }),
      "cited-by",
    );
    assignFocusCitationSequence(
      [seed, second, first],
      [
        {
          key: "first>seed",
          source: first.key,
          target: seed.key,
          provenance: "test",
          manual: false,
        },
        {
          key: "second>seed",
          source: second.key,
          target: seed.key,
          provenance: "test",
          manual: false,
        },
      ],
      seed.key,
    );
    expect(seed.citationSequence).to.equal(0);
    expect(first.citationSequence).to.equal(1);
    expect(second.citationSequence).to.equal(2);
  });

  it("makes citation sequence available for graph axes and node colour", function () {
    const metric = getMetricDefinition("citation-sequence");
    expect(metric.graph.axis).to.equal(true);
    expect(metric.graph.nodeColor).to.equal(true);
    expect(metric.graph.nodeSize).to.equal(false);
  });

  it("assigns a graph-wide ordinal publication sequence", function () {
    const later = externalWorkToFocusNode(
      work({ title: "Later", publicationDate: "2022-01" }),
      "reference",
    );
    const earlier = externalWorkToFocusNode(
      work({ title: "Earlier", publicationDate: "2021-06" }),
      "reference",
    );
    assignGraphCitationSequence([later, earlier]);
    expect(earlier.citationSequence).to.equal(0);
    expect(later.citationSequence).to.equal(1);
  });

  it("uses supplied authors for uncached external-preview labels", function () {
    expect(
      getExternalWorkNodeLabel(
        "external:preview",
        "author-year",
        "An external paper",
        ["D. J. Campbell"],
        2025,
      ),
    ).to.equal("Campbell (2025)");
  });

  it("canonicalizes a complete single-provider relationship snapshot once", function () {
    let mergeCalls = 0;
    const snapshots = prepareRelationshipSnapshots(
      [
        {
          provider: "openalex",
          works: [
            work({
              provider: "openalex",
              providerWorkID: "W1",
              doi: "10.1000/one",
            }),
            work({
              provider: "openalex",
              providerWorkID: "W2",
              doi: "10.1000/two",
            }),
          ],
          reportedCount: 2,
          complete: true,
          succeeded: true,
        },
      ],
      (...groups) => {
        mergeCalls += 1;
        return mergeRelatedWorkLists(...groups);
      },
    );

    expect(snapshots[0].identifiedWorks).to.have.length(2);
    expect(mergeCalls).to.equal(1);
  });

  it("publishes relationship membership counts before metadata completion", function () {
    const phases: string[] = [];
    const unsubscribe = subscribeRelationshipPublications((event) => {
      if (event.subjectItemKey === "COUNTER-SYNC") phases.push(event.phase);
    });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "COUNTER-SYNC",
      direction: "references",
      phase: "refresh-started",
      reportedCount: 0,
      reportedCountProvider: "crossref",
      identifiedCount: 0,
    });
    expect(
      getRelationshipPublicationState(1, "COUNTER-SYNC", "references"),
    ).to.include({ active: true, membershipPublished: false });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "COUNTER-SYNC",
      direction: "references",
      phase: "membership-published",
      reportedCount: 31,
      reportedCountProvider: "crossref",
      identifiedCount: 31,
    });
    expect(
      getRelationshipPublicationState(1, "COUNTER-SYNC", "references"),
    ).to.include({
      active: true,
      membershipPublished: true,
      reportedCount: 31,
      identifiedCount: 31,
    });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "COUNTER-SYNC",
      direction: "references",
      phase: "refresh-finished",
      reportedCount: 31,
      reportedCountProvider: "crossref",
      identifiedCount: 31,
    });
    expect(
      getRelationshipPublicationState(1, "COUNTER-SYNC", "references"),
    ).to.equal(null);
    unsubscribe();
    expect(phases).to.deep.equal([
      "refresh-started",
      "membership-published",
      "refresh-finished",
    ]);
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "NON-PROGRESSIVE",
      direction: "cited-by",
      phase: "membership-published",
      reportedCount: 8,
      reportedCountProvider: "openalex",
      identifiedCount: 8,
    });
    expect(
      getRelationshipPublicationState(1, "NON-PROGRESSIVE", "cited-by"),
    ).to.equal(null);
  });

  it("merges presentation refreshes until a multi-stage update completes", function () {
    const events: Array<{
      refreshGraph: boolean;
      refreshColumns: boolean;
      refreshItemPanes: boolean;
    }> = [];
    const unsubscribe = subscribeToCitationUpdates((event) => {
      events.push(event);
    });

    beginCitationUpdatePublicationBatch();
    publishCitationUpdateCompleted({
      refreshGraph: false,
      refreshColumns: false,
      refreshItemPanes: true,
    });
    publishCitationUpdateCompleted({
      refreshGraph: false,
      refreshColumns: true,
      refreshItemPanes: false,
    });
    expect(events).to.deep.equal([]);

    endCitationUpdatePublicationBatch({
      refreshGraph: true,
      refreshColumns: true,
      refreshItemPanes: true,
    });
    unsubscribe();

    expect(events).to.deep.equal([
      {
        refreshGraph: true,
        refreshColumns: true,
        refreshItemPanes: true,
      },
    ]);
  });

  it("keeps metadata-only relationship publication targeted", function () {
    const updateEvents: Array<{
      refreshGraph: boolean;
      refreshColumns: boolean;
      refreshItemPanes: boolean;
    }> = [];
    const unsubscribe = subscribeToCitationUpdates((event) => {
      updateEvents.push(event);
    });

    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "SUMMARY-ONLY",
      direction: "references",
      phase: "metadata-published",
      reportedCount: 1200,
      reportedCountProvider: "openalex",
      identifiedCount: 1200,
    });
    expect(updateEvents).to.deep.equal([]);

    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "MEMBERSHIP-CHANGE",
      direction: "references",
      phase: "membership-published",
      reportedCount: 1201,
      reportedCountProvider: "openalex",
      identifiedCount: 1201,
    });
    unsubscribe();

    expect(updateEvents).to.deep.equal([
      {
        refreshGraph: false,
        refreshColumns: true,
        refreshItemPanes: true,
      },
    ]);
  });

  it("delivers only final relationship publications after a batch", function () {
    const phases: string[] = [];
    const unsubscribe = subscribeRelationshipPublications((event) => {
      if (event.subjectItemKey === "BATCHED-RELATION") {
        phases.push(event.phase);
      }
    });

    beginCitationUpdatePublicationBatch();
    beginRelationshipPublicationBatch();
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "BATCHED-RELATION",
      direction: "references",
      phase: "refresh-started",
      reportedCount: 12,
      reportedCountProvider: "crossref",
      identifiedCount: 5,
    });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "BATCHED-RELATION",
      direction: "references",
      phase: "membership-published",
      reportedCount: 14,
      reportedCountProvider: "crossref",
      identifiedCount: 14,
    });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "BATCHED-RELATION",
      direction: "references",
      phase: "metadata-published",
      reportedCount: 14,
      reportedCountProvider: "crossref",
      identifiedCount: 14,
    });
    publishRelationshipPublication({
      libraryID: 1,
      subjectItemKey: "BATCHED-RELATION",
      direction: "references",
      phase: "refresh-finished",
      reportedCount: 14,
      reportedCountProvider: "crossref",
      identifiedCount: 14,
    });
    expect(phases).to.deep.equal([]);

    endRelationshipPublicationBatch();
    endCitationUpdatePublicationBatch();
    unsubscribe();

    expect(phases).to.deep.equal(["metadata-published", "refresh-finished"]);
  });

  it("reads right-clicked items only from the menu context", function () {
    const paper = { isRegularItem: () => true, deleted: false, id: 11 };
    const trashedPaper = { isRegularItem: () => true, deleted: true, id: 12 };
    const note = { isRegularItem: () => false, deleted: false, id: 13 };

    expect(
      contextRegularItems({ items: [paper, note, trashedPaper] }),
    ).to.deep.equal([paper]);
    expect(contextRegularItems({ items: [note] })).to.deep.equal([]);
    expect(contextRegularItems({ items: [] })).to.deep.equal([]);
    expect(contextRegularItems({})).to.deep.equal([]);
    expect(contextRegularItems(null)).to.deep.equal([]);

    // A context that throws on property access must not take the menu down.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("context property is unavailable");
        },
      },
    );
    expect(contextRegularItems(hostile)).to.deep.equal([]);

    // The predicate must never reach for the pane. A pane offering a paper
    // must not rescue a context that was right-clicked on a note.
    const withPane = {
      items: [note],
      ZoteroPane: { getSelectedItems: () => [paper] },
    };
    expect(contextRegularItems(withPane)).to.deep.equal([]);
  });

  it("reads every right-clicked folder from the collection rows", function () {
    // Zotero replaced the singular `collectionTreeRow` with a plural
    // `collectionTreeRows`, and made the old name THROW rather than return
    // undefined. A predicate that reads the singular name gets an exception,
    // not a value, so the menu silently never appears.
    const folder = (id: number) => ({
      isCollection: () => true,
      ref: { id, libraryID: 1 },
    });
    const context = {
      get collectionTreeRow(): never {
        throw new Error(
          "collectionTreeRow was removed -- use collectionTreeRows",
        );
      },
      collectionTreeRows: [folder(42)],
    };
    expect(contextCollectionIDs(context)).to.deep.equal([42]);

    // Several folders come back in selection order, so the graph is named
    // after the folder the user selected first.
    expect(
      contextCollectionIDs({
        collectionTreeRows: [folder(42), folder(7), folder(9)],
      }),
    ).to.deep.equal([42, 7, 9]);

    // Every other row type still fails, which is the original regression.
    for (const row of [
      { isCollection: () => false, ref: { libraryID: 1 } }, // My Library
      { isCollection: () => false, ref: { id: 7 } }, // saved search
      { isCollection: () => false, ref: {} }, // Trash, Unfiled, Duplicates
      { isCollection: () => true, ref: {} }, // collection with no usable ID
      { isCollection: () => true, ref: { id: 0 } },
      {}, // not a tree row at all
    ]) {
      expect(contextCollectionIDs({ collectionTreeRows: [row] })).to.deep.equal(
        [],
      );
    }

    // A MIXED selection is not a folder selection. Graphing the folders it
    // could find and ignoring Trash would break the rule the user learned in
    // the single-row case.
    expect(
      contextCollectionIDs({
        collectionTreeRows: [
          folder(42),
          { isCollection: () => false, ref: {} },
        ],
      }),
    ).to.deep.equal([]);

    expect(contextCollectionIDs({ collectionTreeRows: [] })).to.deep.equal([]);
    expect(contextCollectionIDs({ collectionTreeRows: "nope" })).to.deep.equal(
      [],
    );
    expect(contextCollectionIDs({})).to.deep.equal([]);
    expect(contextCollectionIDs(null)).to.deep.equal([]);

    // Older builds supplied a single row under the singular name.
    expect(
      contextCollectionIDs({ collectionTreeRow: folder(42) }),
    ).to.deep.equal([42]);

    // No pane fallback: a selected collection elsewhere must not make a
    // library row look like a folder.
    expect(
      contextCollectionIDs({
        collectionTreeRows: [
          { isCollection: () => false, ref: { libraryID: 1 } },
        ],
        ZoteroPane: {
          getSelectedCollection: () => ({ id: 42 }),
          getCollectionTreeRow: () => folder(42),
        },
      }),
    ).to.deep.equal([]);
  });
});
