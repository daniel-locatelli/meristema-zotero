import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import type { WorkIdentifiers } from "../../src/domain/citationTypes";
import type { HTTPResult, JSONRequestOptions } from "../../src/providers/http";

/**
 * OpenCitations after B63. The COCI metadata route answers 410 Gone, so the
 * lookup asks OpenCitations Meta instead, and the relation pages go straight
 * to the canonical API host rather than through the legacy redirect every
 * request used to pay. Meta carries no counts, so the provider reports none
 * (the user's call, 2026-09-16): the count endpoint answers `0` for a DOI
 * that does not exist at all, so it cannot back an empty list.
 *
 * `requestJSON` is replaced by a script, as providerRefusedPages.test.ts does.
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
const { openCitationsProvider } =
  await import("../../src/providers/openCitationsProvider");

const DOI = "10.1186/1756-8722-6-59";

/** One record as OpenCitations Meta really answers it (probed 2026-09-16). */
const META_RECORD = {
  id: `doi:${DOI} openalex:W2120377900 pmid:23958373 omid:br/06190834283`,
  title: "Ibrutinib And Novel BTK Inhibitors In Clinical Development",
  author:
    "Akinleye, Akintunde [omid:ra/061902461724]; Chen, Yamei [omid:ra/061902461725]",
  pub_date: "2013-08-19",
  venue: "Journal Of Hematology & Oncology [issn:1756-8722 omid:br/0625015494]",
  volume: "6",
  issue: "1",
  type: "journal article",
  page: "",
  publisher: "Springer Science And Business Media Llc [crossref:297]",
  editor: "",
};

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

let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  calls.length = 0;
  respond = () => answered(null);
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: { get: () => undefined, set: () => undefined },
    debug: () => undefined,
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("the OpenCitations lookup after the metadata route's 410 (B63)", function () {
  it("asks OpenCitations Meta, never the deprecated COCI metadata route", async function () {
    respond = () => answered([META_RECORD]);
    const result = await openCitationsProvider.lookup(
      identifiers({ doi: DOI }),
    );
    expect(calls).to.have.length(1);
    expect(calls[0].url, calls[0].url).to.include(
      "api.opencitations.net/meta/v1/metadata/doi:",
    );
    expect(calls[0].url, "the 410 route is gone").to.not.include(
      "metadata/10.",
    );
    expect(result.status).to.equal("success");
  });

  it("reads Meta's record into title, year, authors and venue", async function () {
    respond = () => answered([META_RECORD]);
    const result = await openCitationsProvider.lookup(
      identifiers({ doi: DOI }),
    );
    if (result.status !== "success") return expect.fail(result.message);
    expect(result.title).to.equal(
      "Ibrutinib And Novel BTK Inhibitors In Clinical Development",
    );
    // `pub_date` is a full date, which publicationYearOrNull reads as null
    // unless the year is taken off the front.
    expect(result.year, "the year comes off pub_date").to.equal(2013);
    // Meta appends an identifier in brackets to every name and to the venue.
    expect(result.authors).to.deep.equal([
      "Akinleye, Akintunde",
      "Chen, Yamei",
    ]);
    expect(result.sourceTitle).to.equal("Journal Of Hematology & Oncology");
    expect(result.doi).to.equal(DOI);
  });

  it("reads Meta's empty array as not-found, so an unindexed DOI is no match", async function () {
    // Meta answers 200 with [] both for a real but unindexed paper and for a
    // DOI that does not exist. Either way it is not a match, which is what
    // keeps `unbackedEmptyList` from storing "no citers" for it.
    respond = () => answered([]);
    const result = await openCitationsProvider.lookup(
      identifiers({ doi: DOI }),
    );
    expect(result.status).to.equal("not-found");
  });

  it("reports no counts, because Meta carries none", async function () {
    respond = () => answered([META_RECORD]);
    const result = await openCitationsProvider.lookup(
      identifiers({ doi: DOI }),
    );
    if (result.status !== "success") return expect.fail(result.message);
    expect(result.citationCount, "no citation count").to.equal(null);
    expect(result.referenceCount, "no reference count").to.equal(null);
  });

  it("no longer claims to report counts", function () {
    // The capability is what the provider says it can do; nothing reads these
    // flags today, but a provider that never returns a count must not claim
    // one.
    expect(openCitationsProvider.capabilities.citationCount).to.equal(false);
    expect(openCitationsProvider.capabilities.referenceCount).to.equal(false);
  });

  it("pages relations on the canonical host, not through the legacy redirect", async function () {
    respond = () =>
      answered([
        {
          citing: "10.3389/fphar.2022.1071114",
          cited: DOI,
          creation: "2022-12-15",
        },
      ]);
    const works = await openCitationsProvider.fetchCitingWorks!(DOI, 50, 0);
    expect(works).to.have.length(1);
    expect(calls[0].url, calls[0].url).to.include(
      "api.opencitations.net/index/v1/citations/",
    );
    expect(
      calls[0].url,
      "the legacy host costs a 301 per request",
    ).to.not.include("opencitations.net/index/coci");
  });
});
