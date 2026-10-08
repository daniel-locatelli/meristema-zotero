import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import type {
  CitationProviderID,
  RelatedWorkMetadata,
} from "../../src/domain/citationTypes";
import type { CitationProvider } from "../../src/providers/types";
import type { RelationshipRefreshResolution } from "../../src/services/externalDiscoveryService";

/**
 * A hop node's count bounding a list it was not counted from (B73). An
 * OpenCitations citer carries no count of its own; hydration merges another
 * index's record into it and keeps the existing provider. Without the count's
 * own sources (a record cached before them), the hop node built from it
 * attributes that index's count to OpenCitations. Expanding the
 * node must not then cut OpenCitations' list at that count.
 */
const OPENCITATIONS_LIST = [1, 2].map((n): RelatedWorkMetadata => ({
  provider: "opencitations",
  providerWorkID: `10.1000/oc.${n}`,
  doi: `10.1000/oc.${n}`,
  title: null,
  year: 2020,
  authors: [],
}));
const commits: RelatedWorkMetadata[][] = [];

const { openCitationsProvider } =
  await import("../../src/providers/openCitationsProvider");

/** OpenCitations as declared, its citer list scripted and sliced as `fetchLinks` does. */
const fakeOpenCitations: CitationProvider = {
  ...openCitationsProvider,
  lookup: () => Promise.reject(new Error("opencitations was looked up")),
  fetchCitingWorks: (_workID, maximum, offset = 0) =>
    Promise.resolve(OPENCITATIONS_LIST.slice(offset, offset + maximum)),
};

const plan: CitationProviderID[] = ["opencitations"];
const realRegistry = await import("../../src/providers/registry");
mock.module("../../src/providers/registry.ts", {
  exports: {
    ...realRegistry,
    getCitationProvider: () => fakeOpenCitations,
    getProviderPlan: () => ({
      operation: "citations",
      mode: "automatic",
      providers: [...plan],
      mergeResults: true,
      stopAfterSuccess: false,
    }),
    providerPagesRelationships: () => true,
  },
});
const realPreferences = await import("../../src/services/citationPreferences");
mock.module("../../src/services/citationPreferences.ts", {
  exports: {
    ...realPreferences,
    getEnabledProviders: () => [...plan],
    getOpenAlexAPIKey: () => "",
    isProviderEnabled: (id: CitationProviderID) => plan.includes(id),
  },
});
const realStore = await import("../../src/services/relationshipStoreService");
mock.module("../../src/services/relationshipStoreService.ts", {
  exports: {
    ...realStore,
    getStoredRelationshipCount: () => 0,
    getStoredRelationshipEntry: () => null,
    getStoredRelationshipSummary: () => null,
    getStoredRelationshipWorks: () => [],
    replaceStoredRelationshipSelection: (
      _node: unknown,
      _direction: unknown,
      works: RelatedWorkMetadata[],
    ) => {
      commits.push(works);
      return Promise.resolve(works);
    },
  },
});
const realMetrics = await import("../../src/services/citationMetricsStore");
mock.module("../../src/services/citationMetricsStore.ts", {
  exports: {
    ...realMetrics,
    getCitationMetricRecord: () => null,
    saveCitationMetricRecord: () => Promise.resolve(),
  },
});
const { mergeExternalWorkMetadata } =
  await import("../../src/services/externalWorkMetadataService");
const { externalWorkToFocusNode } =
  await import("../../src/services/graphFocusService");
const { refreshExternalRelationships } =
  await import("../../src/services/externalDiscoveryService");

let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  commits.length = 0;
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: { get: () => undefined, set: () => undefined },
    Libraries: { userLibraryID: 1 },
    Items: { get: () => null },
    debug: () => undefined,
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("a hop node hydrated from another index", function () {
  it("does not let that index's count cut OpenCitations' citer list", async function () {
    const doi = "10.1000/hop";
    const fromOpenCitations: RelatedWorkMetadata = {
      provider: "opencitations",
      providerWorkID: doi,
      doi,
      title: null,
      year: 2019,
      authors: [],
    };
    const hydrated = mergeExternalWorkMetadata(fromOpenCitations, {
      provider: "semantic-scholar",
      providerWorkID: "S2-HOP",
      doi,
      title: "A hop paper",
      year: 2019,
      authors: [],
      citationCount: 1,
    });
    // A record cached before properties carried their sources: since B81 the
    // node otherwise names the index its count came from.
    const node = externalWorkToFocusNode(
      { ...hydrated, propertySources: undefined },
      "cited-by",
    );
    expect(
      { count: node.citationCount, provider: node.citationCountProvider },
      "the arming: Semantic Scholar's count stands under OpenCitations",
    ).to.deep.equal({ count: 1, provider: "opencitations" });

    let resolution: RelationshipRefreshResolution | null = null;
    await refreshExternalRelationships(node, [], "cited-by", {
      refreshMembership: true,
      silent: true,
      queueBackgroundHydration: false,
      metadataHydrationLimit: 0,
      summaryLookupLimit: 0,
      providerWorkIDs: { opencitations: doi },
      mode: "automatic",
      maximum: 50,
      providerStrategy: "native-first",
      providerLimit: 1,
      fill: true,
      retryRefusals: false,
      onMembershipResolved: (resolved) => {
        resolution = resolved;
      },
    });

    expect(commits).to.have.lengthOf(1);
    expect(
      commits[0].map((work) => work.doi),
      "OpenCitations' whole list, not the first of it",
    ).to.have.members(["10.1000/oc.1", "10.1000/oc.2"]);
    expect(resolution).to.include({
      reportedCount: null,
      identifiedCount: 2,
      complete: true,
    });
  });
});
