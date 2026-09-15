import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import type {
  RelatedWorkMetadata,
  WorkIdentifiers,
} from "../../src/domain/citationTypes";
import type { HTTPResult, JSONRequestOptions } from "../../src/providers/http";

/**
 * `requestJSON` replaced by a script: each case says what the provider
 * answers for a URL, and every request is kept, so a case can assert what was
 * asked and with which options. The HTTP layer itself is
 * providerRefusals.test.ts.
 */
const calls: Array<{
  provider: string;
  url: string;
  options: JSONRequestOptions;
}> = [];
let respond: (url: string) => HTTPResult<unknown> = () => answered(null);

function answered(data: unknown): HTTPResult<unknown> {
  return { ok: true, status: 200, data, message: "" };
}

function refused(): HTTPResult<unknown> {
  return { ok: false, status: 429, data: null, message: "HTTP 429" };
}

const realHTTP = await import("../../src/providers/http");
mock.module("../../src/providers/http.ts", {
  exports: {
    ...realHTTP,
    requestJSON: async (
      provider: string,
      url: string,
      options: JSONRequestOptions,
    ) => {
      calls.push({ provider, url, options });
      return respond(url);
    },
  },
});
const { ProviderRefusedError } = await import("../../src/providers/types");
const { semanticScholarProvider } =
  await import("../../src/providers/semanticScholarProvider");
const { openCitationsProvider } =
  await import("../../src/providers/openCitationsProvider");
const { openAlexProvider } =
  await import("../../src/providers/openAlexProvider");
const {
  clearRelatedWorkSummaryCaches,
  fetchRelatedWorkSummaryPage,
  resolveRelatedWorkSummaries,
} = await import("../../src/services/relatedWorkSummaryService");

function identifiers(
  overrides: Partial<WorkIdentifiers> = {},
): WorkIdentifiers {
  return {
    doi: null,
    pmid: null,
    arxiv: null,
    isbn: null,
    title: "",
    normalizedTitle: "",
    year: null,
    authors: [],
    sourceTitle: null,
    ...overrides,
  };
}

/** The rejection a refused request must produce. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return expect.fail("the request was expected to be refused");
}

let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  calls.length = 0;
  respond = () => answered(null);
  clearRelatedWorkSummaryCaches();
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      // OpenAlex pages only with a key; every other preference is unset.
      get: (name: string) =>
        name === `${config.prefsPrefix}.openAlexAPIKey`
          ? "test-key"
          : undefined,
      set: () => undefined,
    },
    debug: () => undefined,
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("a refused relationship page", function () {
  it("throws from Semantic Scholar's relations and summary pages, passing retryRefusals on", async function () {
    respond = () => refused();
    const relations = await rejection(
      semanticScholarProvider.fetchCitingWorks!("P1", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(relations).to.be.instanceOf(ProviderRefusedError);
    expect(
      (relations as InstanceType<typeof ProviderRefusedError>).provider,
    ).to.equal("semantic-scholar");
    const page = await rejection(
      fetchRelatedWorkSummaryPage("semantic-scholar", "P1", "cited-by", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(page).to.be.instanceOf(ProviderRefusedError);
    expect(calls.map((call) => call.options.retryRefusals)).to.deep.equal([
      false,
      false,
    ]);
  });

  it("still reads an empty Semantic Scholar page as an empty list", async function () {
    respond = () => answered({ data: [] });
    expect(
      await semanticScholarProvider.fetchReferencedWorks!("P1", 50, 0),
    ).to.deep.equal([]);
    expect(
      await fetchRelatedWorkSummaryPage(
        "semantic-scholar",
        "P1",
        "references",
        50,
        0,
      ),
    ).to.deep.equal([]);
  });

  it("throws from OpenAlex's cited-by page, its references source and the page's batches", async function () {
    respond = () => refused();
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W1", "cited-by", 50, 0),
      ),
      "cited-by page",
    ).to.be.instanceOf(ProviderRefusedError);
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W2", "references", 50, 0),
      ),
      "references source",
    ).to.be.instanceOf(ProviderRefusedError);
    respond = (url) =>
      url.includes("/works/W3?")
        ? answered({
            referenced_works: ["https://openalex.org/W30"],
            referenced_works_count: 1,
          })
        : refused();
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W3", "references", 50, 0),
      ),
      "the page's summary batch",
    ).to.be.instanceOf(ProviderRefusedError);
  });

  it("still reads an empty OpenAlex cited-by page as an empty list", async function () {
    respond = () => answered({ results: [] });
    expect(
      await fetchRelatedWorkSummaryPage("openalex", "W4", "cited-by", 50, 0),
    ).to.deep.equal([]);
  });

  it("does not throw when a metadata hydration batch is refused", async function () {
    respond = () => refused();
    const work: RelatedWorkMetadata = {
      provider: "openalex",
      providerWorkID: "W40",
      doi: null,
      title: null,
      year: null,
      authors: [],
    };
    const works = await resolveRelatedWorkSummaries([work], "openalex");
    expect(works).to.have.length(1);
    expect(calls.length, "the batch was asked").to.be.greaterThan(0);
  });

  it("throws from OpenCitations' links and keeps an empty list empty", async function () {
    respond = () => refused();
    const links = await rejection(
      openCitationsProvider.fetchCitingWorks!("10.1000/oc", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(links).to.be.instanceOf(ProviderRefusedError);
    expect(calls[0].options.retryRefusals).to.equal(false);
    respond = () => answered([]);
    expect(
      await openCitationsProvider.fetchReferencedWorks!("10.1000/oc", 50, 0),
    ).to.deep.equal([]);
  });
});

describe("a refused lookup", function () {
  it("reads a refused Semantic Scholar title match as rate-limited, not not-found", async function () {
    respond = (url) =>
      url.includes("/paper/search/match?") ? refused() : answered({ data: [] });
    const result = await semanticScholarProvider.searchExactTitle!(
      identifiers({
        title: "A refused title",
        normalizedTitle: "a refused title",
      }),
    );
    expect(result.status).to.equal("rate-limited");
  });

  it("passes retryRefusals on from every provider's lookup", async function () {
    respond = () => ({
      ok: false,
      status: 404,
      data: null,
      message: "HTTP 404",
    });
    const ids = identifiers({ doi: "10.1000/pass-through" });
    await semanticScholarProvider.lookup(ids, { retryRefusals: false });
    await openCitationsProvider.lookup(ids, { retryRefusals: false });
    await openAlexProvider.lookup(ids, { retryRefusals: false });
    expect(new Set(calls.map((call) => call.provider))).to.deep.equal(
      new Set(["semantic-scholar", "opencitations", "openalex"]),
    );
    expect(
      calls.every((call) => call.options.retryRefusals === false),
      JSON.stringify(calls.map((call) => [call.provider, call.options])),
    ).to.equal(true);
  });
});
