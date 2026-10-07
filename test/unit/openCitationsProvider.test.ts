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
          citing: "omid:br/06101 doi:10.3389/fphar.2022.1071114",
          cited: `omid:br/06190834283 doi:${DOI}`,
          creation: "2022-12-15",
        },
      ]);
    const works = await openCitationsProvider.fetchCitingWorks!(DOI, 50, 0);
    expect(works).to.have.length(1);
    expect(calls[0].url, calls[0].url).to.include(
      "api.opencitations.net/index/",
    );
    expect(
      calls[0].url,
      "the legacy host costs a 301 per request",
    ).to.not.include("opencitations.net/index/coci");
  });
});

/**
 * Index v2 rows as OpenCitations really answers them for
 * 10.1038/nature12373 (probed 2026-10-07), trimmed. Each side is a composite
 * of every identifier the work carries, in no fixed order, and a citer the
 * Index knows only by arXiv ID carries no DOI at all. v1 answered the same
 * rows in the same order with the bare DOI, and `''` for that arXiv citer.
 */
const V2_DOI = "10.1038/nature12373";
const V2_CITATIONS = [
  {
    oci: "06010048871-06120344846",
    citing: "omid:br/06010048871 openalex:W4409995113 doi:10.1063/5.0251893",
    cited:
      "omid:br/06120344846 doi:10.1038/nature12373 pmid:23903748 openalex:W2159974629",
    creation: "2025-05-01",
    timespan: "P11Y9M1D",
    journal_sc: "no",
    author_sc: "no",
  },
  {
    oci: "06022292673-06120344846",
    citing: "omid:br/06022292673 arxiv:1611.02427",
    cited:
      "omid:br/06120344846 doi:10.1038/nature12373 pmid:23903748 openalex:W2159974629",
    creation: "2016-11-08",
    timespan: "P3Y3M8D",
    journal_sc: "no",
    author_sc: "no",
  },
  {
    oci: "06010126079-06120344846",
    citing:
      "omid:br/06010126079 doi:10.1021/acsanm.5c00276 openalex:W4409314817",
    cited:
      "omid:br/06120344846 doi:10.1038/nature12373 pmid:23903748 openalex:W2159974629",
    creation: "2025-04-10",
    timespan: "P11Y8M10D",
    journal_sc: "no",
    author_sc: "no",
  },
];
const V2_REFERENCES = [
  {
    oci: "06120344846-061101490124",
    citing:
      "omid:br/06120344846 doi:10.1038/nature12373 pmid:23903748 openalex:W2159974629",
    cited:
      "omid:br/061101490124 pmid:23288346 doi:10.1007/s10549-012-2393-x openalex:W2093130510",
    creation: "2013-07-31",
    timespan: "P0Y6M27D",
    journal_sc: "no",
    author_sc: "no",
  },
];

describe("the OpenCitations relation pages on Index v2 (B70)", function () {
  it("asks Index v2 for citers, with the doi: prefix v2 requires", async function () {
    // v2 answers 400 for a bare DOI: its `id` must name its scheme.
    respond = () => answered([]);
    await openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0);
    expect(calls[0].url).to.equal(
      "https://api.opencitations.net/index/v2/citations/doi:10.1038%2Fnature12373",
    );
  });

  it("asks Index v2 for references the same way", async function () {
    respond = () => answered([]);
    await openCitationsProvider.fetchReferencedWorks!(V2_DOI, 50, 0);
    expect(calls[0].url).to.equal(
      "https://api.opencitations.net/index/v2/references/doi:10.1038%2Fnature12373",
    );
  });

  it("reads each citer's DOI out of v2's composite identifiers", async function () {
    respond = () => answered(V2_CITATIONS);
    const works = await openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0);
    expect(works.map((work) => work.doi)).to.deep.equal([
      "10.1063/5.0251893",
      "10.1021/acsanm.5c00276",
    ]);
    expect(works[0].providerWorkID).to.equal("10.1063/5.0251893");
    expect(works[0].year).to.equal(2025);
    expect(works[0].publicationDate).to.equal("2025-05-01");
  });

  it("reads each reference's DOI wherever it sits in the composite", async function () {
    respond = () => answered(V2_REFERENCES);
    const works = await openCitationsProvider.fetchReferencedWorks!(
      V2_DOI,
      50,
      0,
    );
    expect(works.map((work) => work.doi)).to.deep.equal([
      "10.1007/s10549-012-2393-x",
    ]);
  });
});

describe("an OpenCitations Index fault (B80)", function () {
  /** The rejection a faulted page must produce. */
  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    return expect.fail("the page was expected to fail, not answer a list");
  }

  function failing(status: number): HTTPResult<unknown> {
    return { ok: false, status, data: null, message: `HTTP ${status}` };
  }

  it("fails the page on a server error, rather than answering no citers", async function () {
    // An empty list is stored as the paper's complete citer list; a 5xx says
    // nothing about the paper at all.
    respond = () => failing(503);
    const error = await rejection(
      openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0),
    );
    expect(error).to.be.instanceOf(Error);
    expect(String(error)).to.include("503");
  });

  it("fails the page on a dropped connection and on a 410 the same way", async function () {
    // A 410 is how the Index retired a route before (B63).
    respond = () => failing(0);
    await rejection(openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0));
    respond = () => failing(410);
    await rejection(openCitationsProvider.fetchReferencedWorks!(V2_DOI, 50, 0));
  });

  it("reads a 404 as a miss, an empty list, as the lookup does", async function () {
    // failureStatusFromHTTP calls a 404 not-found; whether an empty list is
    // trusted is unbackedEmptyList's call, as for the Index's 200 and `[]`.
    respond = () => failing(404);
    expect(
      await openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0),
    ).to.deep.equal([]);
  });

  it("fails the page on an answer that is not a list", async function () {
    respond = () => answered({ error: "unexpected" });
    await rejection(openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0));
  });

  it("still reads the Index's empty list as no citers", async function () {
    respond = () => answered([]);
    expect(
      await openCitationsProvider.fetchCitingWorks!(V2_DOI, 50, 0),
    ).to.deep.equal([]);
  });
});
