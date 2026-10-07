import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import type {
  CitationProviderID,
  ProviderLookupResult,
  RelatedWorkMetadata,
} from "../../src/domain/citationTypes";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import type { CitationProvider } from "../../src/providers/types";
import type {
  ExternalRelationshipRefreshOptions,
  RelationshipRefreshResolution,
} from "../../src/services/externalDiscoveryService";
import type { RelationshipPublicationEvent } from "../../src/services/relationshipEvents";

/**
 * The refresh composed end to end (B68): the provider registry, the
 * provider settings, the relationship store and the metric store are
 * replaced by scripts, and everything between them — snapshot fetching, the
 * fill's candidate walk, membership selection, publication — is the real
 * code. Each provider's citing list is scripted per case; a provider asked
 * for its list is recorded, so a case can assert who was asked. A lookup is
 * scripted only where a case leaves the provider unhinted.
 */
type Answer = () => Promise<RelatedWorkMetadata[]>;

let plan: CitationProviderID[] = [];
let answers: Partial<Record<CitationProviderID, Answer>> = {};
let lookups: Partial<Record<CitationProviderID, ProviderLookupResult>> = {};
const asked: CitationProviderID[] = [];
/** The work ID each asked provider's first page was keyed on. */
const pagedOn: Partial<Record<CitationProviderID, string>> = {};
const searched: CitationProviderID[] = [];
const commits: RelatedWorkMetadata[][] = [];

function fakeProvider(id: CitationProviderID): CitationProvider {
  return {
    id,
    label: id,
    capabilities: {} as CitationProvider["capabilities"],
    supports: () => true,
    lookup: () => {
      const result = lookups[id];
      return result
        ? Promise.resolve(result)
        : Promise.reject(new Error(`${id} was looked up`));
    },
    searchExactTitle: () => {
      searched.push(id);
      return Promise.resolve({
        status: "not-found",
        provider: id,
        message: "no title match",
      });
    },
    fetchCitingWorks: (workID, _maximum, offset) => {
      // Only the first page is scripted; a later one ends the list.
      if (offset) return Promise.resolve([]);
      asked.push(id);
      pagedOn[id] = workID;
      const answer = answers[id];
      return answer ? answer() : Promise.resolve([]);
    },
  };
}

const realRegistry = await import("../../src/providers/registry");
mock.module("../../src/providers/registry.ts", {
  exports: {
    ...realRegistry,
    getCitationProvider: (id: CitationProviderID) => fakeProvider(id),
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
const { ProviderRefusedError } = await import("../../src/providers/types");
const { subscribeRelationshipPublications } =
  await import("../../src/services/relationshipEvents");
const { refreshExternalRelationships } =
  await import("../../src/services/externalDiscoveryService");

function citer(provider: CitationProviderID, n: number): RelatedWorkMetadata {
  return {
    provider,
    providerWorkID: null,
    doi: `10.1000/${provider}.${n}`,
    title: `${provider} citer ${n}`,
    year: 2020,
    authors: [],
  };
}

function answering(provider: CitationProviderID, count: number): Answer {
  return () =>
    Promise.resolve(
      Array.from({ length: count }, (_, n) => citer(provider, n + 1)),
    );
}

function refusing(provider: CitationProviderID): Answer {
  return () => Promise.reject(new ProviderRefusedError(provider));
}

let seedSerial = 0;

/** A citing-list subject the providers know by a hinted work ID. */
function seed(): CitationGraphNode {
  seedSerial += 1;
  const key = `SEED${seedSerial}`;
  return {
    key,
    itemID: 0,
    itemKey: key,
    kind: "external",
    focusRole: null,
    externalWork: null,
    title: key,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: null,
    publicationDate: null,
    citationSequence: null,
    doi: `10.1000/${key.toLowerCase()}`,
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

interface Refreshed {
  resolution: RelationshipRefreshResolution | null;
  publications: RelationshipPublicationEvent[];
  subject: CitationGraphNode;
}

function refusedLookup(provider: CitationProviderID): ProviderLookupResult {
  return { status: "rate-limited", provider, message: "HTTP 429" };
}

/**
 * One citing-list refresh, every provider hinted so none is looked up, save
 * those named in `unhinted`.
 */
async function refresh(
  options: ExternalRelationshipRefreshOptions,
  unhinted: readonly CitationProviderID[] = [],
): Promise<Refreshed> {
  const subject = seed();
  const publications: RelationshipPublicationEvent[] = [];
  const unsubscribe = subscribeRelationshipPublications((event) => {
    publications.push(event);
  });
  let resolution: RelationshipRefreshResolution | null = null;
  try {
    await refreshExternalRelationships(subject, [], "cited-by", {
      refreshMembership: true,
      silent: true,
      queueBackgroundHydration: false,
      metadataHydrationLimit: 0,
      summaryLookupLimit: 0,
      providerWorkIDs: Object.fromEntries(
        plan
          .filter((provider) => !unhinted.includes(provider))
          .map((provider) => [provider, `${provider}-W1`]),
      ),
      onMembershipResolved: (resolved) => {
        resolution = resolved;
      },
      ...options,
    });
  } finally {
    unsubscribe();
  }
  return { resolution, publications, subject };
}

/** The hop fill's options (graphViewService's hop expansion). */
const FILL: ExternalRelationshipRefreshOptions = {
  mode: "automatic",
  maximum: 50,
  providerStrategy: "native-first",
  providerLimit: 1,
  fill: true,
  retryRefusals: false,
};

let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  plan = [];
  answers = {};
  lookups = {};
  asked.length = 0;
  for (const id of Object.keys(pagedOn) as CitationProviderID[])
    delete pagedOn[id];
  searched.length = 0;
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

describe("a fill expansion's refresh", function () {
  it("switches to the next candidate on a refusal and keeps that answer", async function () {
    plan = ["opencitations", "inspire"];
    answers = {
      opencitations: refusing("opencitations"),
      inspire: answering("inspire", 2),
    };
    const { resolution } = await refresh(FILL);
    expect(
      asked,
      "a refusal with nothing collected moves the expansion on",
    ).to.deep.equal(["opencitations", "inspire"]);
    expect(commits, "one membership commit, the answer's").to.have.lengthOf(1);
    expect(commits[0].map((work) => work.doi)).to.deep.equal([
      "10.1000/inspire.1",
      "10.1000/inspire.2",
    ]);
    expect(resolution).to.include({ answeredBy: "inspire" });
    expect(resolution!.refusedBy).to.deep.equal(["opencitations"]);
    expect(resolution!.skipped).to.deep.equal([]);
  });

  it("asks nobody and publishes nothing when every candidate sits out a window", async function () {
    plan = ["opencitations", "inspire"];
    answers = {
      opencitations: answering("opencitations", 1),
      inspire: answering("inspire", 1),
    };
    const { resolution, publications } = await refresh({
      ...FILL,
      excludeProviders: ["opencitations", "inspire"],
    });
    expect(asked, "no provider is asked").to.deep.equal([]);
    expect(commits, "nothing is stored").to.deep.equal([]);
    expect(
      publications,
      "not even refresh-started: the paper was never refreshing",
    ).to.deep.equal([]);
    expect(resolution).to.deep.equal({
      complete: false,
      provider: null,
      reportedCount: null,
      identifiedCount: 0,
      refusedBy: [],
      skipped: ["opencitations", "inspire"],
      answeredBy: null,
    });
  });

  it("names the window's provider skipped, the refusing one refused, and the answering one answered", async function () {
    plan = ["crossref", "opencitations", "inspire"];
    answers = {
      opencitations: refusing("opencitations"),
      inspire: answering("inspire", 1),
    };
    const { resolution } = await refresh({
      ...FILL,
      excludeProviders: ["crossref"],
    });
    expect(asked).to.deep.equal(["opencitations", "inspire"]);
    expect(resolution!.skipped).to.deep.equal(["crossref"]);
    expect(resolution!.refusedBy).to.deep.equal(["opencitations"]);
    expect(resolution!.answeredBy).to.equal("inspire");
  });

  it("answers nobody when every candidate refuses, and stores nothing", async function () {
    plan = ["opencitations", "inspire"];
    answers = {
      opencitations: refusing("opencitations"),
      inspire: refusing("inspire"),
    };
    const { resolution, publications } = await refresh(FILL);
    expect(asked).to.deep.equal(["opencitations", "inspire"]);
    expect(commits, "a refused snapshot is never stored").to.deep.equal([]);
    expect(
      publications.map((event) => event.phase),
      "the refresh started and finished with no membership between",
    ).to.deep.equal(["refresh-finished"]);
    expect(resolution).to.include({ answeredBy: null, complete: false });
    expect(resolution!.refusedBy).to.deep.equal(["opencitations", "inspire"]);
  });

  it("moves on from a refused OpenCitations lookup without paging on the DOI", async function () {
    plan = ["opencitations", "inspire"];
    lookups = { opencitations: refusedLookup("opencitations") };
    answers = {
      opencitations: answering("opencitations", 1),
      inspire: answering("inspire", 1),
    };
    const { resolution } = await refresh(FILL, ["opencitations"]);
    expect(
      asked,
      "the fill treats the lookup's refusal as the provider's (B69)",
    ).to.deep.equal(["inspire"]);
    expect(searched).to.deep.equal([]);
    expect(resolution!.refusedBy).to.deep.equal(["opencitations"]);
    expect(resolution!.answeredBy).to.equal("inspire");
  });
});

describe("an aggregate manual refresh", function () {
  it("drops a refused snapshot and keeps every other provider's works", async function () {
    plan = ["opencitations", "inspire", "crossref"];
    answers = {
      opencitations: answering("opencitations", 1),
      inspire: refusing("inspire"),
      crossref: answering("crossref", 1),
    };
    const { resolution } = await refresh({ mode: "manual" });
    expect(asked, "an aggregate asks every provider").to.have.members([
      "opencitations",
      "inspire",
      "crossref",
    ]);
    expect(commits).to.have.lengthOf(1);
    expect(commits[0].map((work) => work.doi)).to.have.members([
      "10.1000/opencitations.1",
      "10.1000/crossref.1",
    ]);
    expect(
      resolution!.complete,
      "a refused provider leaves the aggregate incomplete",
    ).to.equal(false);
    expect(resolution!.refusedBy).to.deep.equal(["inspire"]);
    expect(resolution!.skipped, "only a fill skips").to.deep.equal([]);
    expect(resolution!.answeredBy).to.equal("crossref");
  });

  it("stores nothing when the only provider refuses", async function () {
    plan = ["opencitations"];
    answers = { opencitations: refusing("opencitations") };
    const { resolution } = await refresh({ mode: "manual" });
    expect(
      commits,
      "a refused snapshot with nothing collected is never stored",
    ).to.deep.equal([]);
    expect(resolution).to.include({ answeredBy: null, complete: false });
    expect(resolution!.refusedBy).to.deep.equal(["opencitations"]);
  });

  it("clears the window of the last provider with works, past a later empty answer", async function () {
    plan = ["opencitations", "inspire"];
    answers = {
      opencitations: answering("opencitations", 1),
      inspire: answering("inspire", 0),
    };
    const { resolution } = await refresh({ mode: "manual" });
    expect(commits).to.have.lengthOf(1);
    expect(resolution!.refusedBy).to.deep.equal([]);
    expect(
      resolution!.answeredBy,
      "inspire's empty list is usable but contributed nothing",
    ).to.equal("opencitations");
  });

  it("still pages OpenCitations on the DOI after its record lookup refuses", async function () {
    plan = ["opencitations"];
    lookups = { opencitations: refusedLookup("opencitations") };
    answers = { opencitations: answering("opencitations", 2) };
    const { resolution, subject } = await refresh({ mode: "manual" }, [
      "opencitations",
    ]);
    expect(
      searched,
      "no title search after a refusal: a second request to a provider that just refused (B50)",
    ).to.deep.equal([]);
    expect(
      pagedOn.opencitations,
      "the Index is a separate service keyed on the DOI (B69)",
    ).to.equal(subject.doi);
    expect(commits).to.have.lengthOf(1);
    expect(commits[0].map((work) => work.doi)).to.deep.equal([
      "10.1000/opencitations.1",
      "10.1000/opencitations.2",
    ]);
    expect(resolution!.refusedBy).to.deep.equal([]);
    expect(resolution!.answeredBy).to.equal("opencitations");
  });

  it("stores nothing when the Index faults on that DOI page (B80)", async function () {
    // The page fetcher throws on an Index error other than 429; the snapshot
    // fails, so the fault is never stored as a complete empty citer list.
    plan = ["opencitations"];
    lookups = { opencitations: refusedLookup("opencitations") };
    answers = {
      opencitations: () =>
        Promise.reject(new Error("OpenCitations Index answered HTTP 503")),
    };
    const { resolution } = await refresh({ mode: "manual" }, ["opencitations"]);
    expect(asked, "the Index was paged on the DOI").to.deep.equal([
      "opencitations",
    ]);
    expect(commits, "a faulted page is never stored").to.deep.equal([]);
    expect(resolution).to.include({ answeredBy: null, complete: false });
    expect(resolution!.refusedBy, "a fault is not a refusal").to.deep.equal([]);
  });

  it("asks a refusing provider whose pages need its own record no further", async function () {
    plan = ["inspire", "crossref"];
    lookups = { inspire: refusedLookup("inspire") };
    answers = {
      inspire: answering("inspire", 1),
      crossref: answering("crossref", 1),
    };
    const { resolution } = await refresh({ mode: "manual" }, ["inspire"]);
    expect(searched).to.deep.equal([]);
    expect(asked, "inspire's pages are not fetched").to.deep.equal([
      "crossref",
    ]);
    expect(resolution!.refusedBy).to.deep.equal(["inspire"]);
  });
});
