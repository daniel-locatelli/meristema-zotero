import { beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import type { HTTPResult, JSONRequestOptions } from "../../src/providers/http";

/** `requestJSON` replaced by a script, as openCitationsProvider.test.ts does. */
const calls: Array<{ url: string; options: JSONRequestOptions }> = [];
let respond: (url: URL) => HTTPResult<unknown> = () => ok([]);

function ok(results: unknown[]): HTTPResult<unknown> {
  return { ok: true, status: 200, data: { results }, message: "" };
}

function failed(status: number): HTTPResult<unknown> {
  return { ok: false, status, data: null, message: "" };
}

const realHTTP = await import("../../src/providers/http");
mock.module("../../src/providers/http.ts", {
  exports: {
    ...realHTTP,
    requestJSON: async (
      _provider: string,
      url: string,
      options: JSONRequestOptions,
    ) => {
      calls.push({ url, options });
      return respond(new URL(url));
    },
  },
});
const { checkOpenAlexReferences, CHECK_SELECT } =
  await import("../../src/services/openAlexSeedLinkService");

const AT = new Date("2026-10-06T00:00:00Z");
const options = { apiKey: "k", now: () => AT };
const signal = {
  cancelled: false,
  subscribe: () => () => undefined,
};

function filterValues(url: URL): { field: string; values: string[] } {
  const [field, rest] = (url.searchParams.get("filter") ?? "").split(":", 2);
  return { field, values: rest ? rest.split("|") : [] };
}

/** OpenAlex as a table: answers whatever the filter names that it knows. */
function answering(
  works: Array<{ id: string; doi?: string; refs: string[] }>,
): (url: URL) => HTTPResult<unknown> {
  return (url) => {
    const { field, values } = filterValues(url);
    return ok(
      works
        .filter((w) =>
          field === "ids.openalex"
            ? values.includes(w.id)
            : w.doi !== undefined && values.includes(w.doi),
        )
        .map((w) => ({
          id: `https://openalex.org/${w.id}`,
          doi: w.doi ? `https://doi.org/${w.doi}` : null,
          referenced_works: w.refs.map((r) => `https://openalex.org/${r}`),
        })),
    );
  };
}

describe("checkOpenAlexReferences", function () {
  beforeEach(function () {
    calls.length = 0;
  });

  it("asks by ID, then by DOI, with the check's select and no retries on refusal", async function () {
    respond = answering([
      { id: "W1", refs: ["W9"] },
      { id: "W2", doi: "10.1234/b", refs: [] },
    ]);
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: null, doi: "10.1234/b" },
      ],
      { ...options, signal },
    );
    expect(calls.map((c) => filterValues(new URL(c.url)))).to.deep.equal([
      { field: "ids.openalex", values: ["W1"] },
      { field: "doi", values: ["10.1234/b"] },
    ]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("select")).to.equal(CHECK_SELECT);
    expect(url.searchParams.get("per_page")).to.equal("200");
    expect(url.searchParams.get("api_key")).to.equal("k");
    expect(calls[0].options.retryRefusals).to.equal(false);
    expect(calls[0].options.signal).to.equal(signal);
    expect(outcome.failed).to.deep.equal([]);
    expect(
      outcome.rows.map((r) => [r.identityKey, r.status, r.referenceIDs]),
    ).to.deep.equal([
      ["openalex:W1", "success", ["W9"]],
      ["openalex:W2", "success", []],
      ["doi:10.1234/b", "alias", null],
    ]);
  });

  it("batches at the policy size", async function () {
    respond = answering([]);
    const papers = Array.from({ length: 150 }, (_, i) => ({
      key: `k${i}`,
      openAlexID: `W${i + 1}`,
      doi: null,
    }));
    await checkOpenAlexReferences(papers, options);
    expect(
      calls.map((c) => filterValues(new URL(c.url)).values.length),
    ).to.deep.equal([100, 50]);
  });

  it("retries an ID miss by DOI, and keeps the asked ID as an alias", async function () {
    respond = answering([{ id: "W7", doi: "10.1234/m", refs: ["W1"] }]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "m", openAlexID: "W3", doi: "10.1234/m" }],
      options,
    );
    expect(calls).to.have.length(2);
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W7", "success"],
      ["openalex:W3", "alias"],
      ["doi:10.1234/m", "alias"],
    ]);
  });

  it("records a paper missed both ways as not-found under its aliases", async function () {
    respond = answering([]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "g", openAlexID: "W3", doi: "10.1234/g" }],
      options,
    );
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W3", "not-found"],
      ["doi:10.1234/g", "not-found"],
    ]);
  });

  it("never sends a paper with no identifier", async function () {
    respond = answering([]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "x", openAlexID: null, doi: null }],
      options,
    );
    expect(calls).to.have.length(0);
    expect(outcome).to.deep.equal({ rows: [], failed: [] });
  });

  it("learns nothing from a refused batch", async function () {
    respond = () => failed(429);
    const papers = [{ key: "a", openAlexID: "W1", doi: "10.1234/a" }];
    const outcome = await checkOpenAlexReferences(papers, options);
    expect(calls).to.have.length(1);
    expect(outcome).to.deep.equal({ rows: [], failed: papers });
  });

  it("does not split a batch refused because OpenAlex is disabled", async function () {
    respond = () => failed(403);
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: null },
      ],
      options,
    );
    expect(calls).to.have.length(1);
    expect(outcome.failed).to.have.length(2);
  });

  it("splits a rejected batch down to the paper OpenAlex rejects", async function () {
    respond = (url) => {
      const { values } = filterValues(url);
      return values.includes("W2")
        ? failed(400)
        : answering([
            { id: "W1", refs: [] },
            { id: "W3", refs: [] },
          ])(url);
    };
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: null },
        { key: "c", openAlexID: "W3", doi: null },
      ],
      options,
    );
    expect(outcome.failed).to.deep.equal([]);
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W1", "success"],
      ["openalex:W3", "success"],
      ["openalex:W2", "not-found"],
    ]);
  });

  it("matches results by value, not by position", async function () {
    const work = (id: string, ref: string) => ({
      id: `https://openalex.org/${id}`,
      doi: null,
      referenced_works: [`https://openalex.org/${ref}`],
    });
    respond = (url) =>
      filterValues(url).field === "ids.openalex"
        ? ok([work("W3", "W30"), work("W1", "W10")])
        : ok([]);
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: "10.1234/two" },
        { key: "c", openAlexID: "W3", doi: null },
      ],
      options,
    );
    expect(calls.map((c) => filterValues(new URL(c.url)))).to.deep.equal([
      { field: "ids.openalex", values: ["W1", "W2", "W3"] },
      { field: "doi", values: ["10.1234/two"] },
    ]);
    expect(outcome.failed).to.deep.equal([]);
    expect(
      outcome.rows.map((r) => [r.identityKey, r.status, r.referenceIDs]),
    ).to.deep.equal([
      ["openalex:W1", "success", ["W10"]],
      ["openalex:W3", "success", ["W30"]],
      ["openalex:W2", "not-found", null],
      ["doi:10.1234/two", "not-found", null],
    ]);
  });

  it("retries by DOI a paper rejected alone in the ID pass", async function () {
    respond = (url) => {
      const { field, values } = filterValues(url);
      if (field === "ids.openalex") {
        return values.includes("W2")
          ? failed(400)
          : answering([{ id: "W1", refs: [] }])(url);
      }
      return answering([{ id: "W2", doi: "10.1234/two", refs: ["W5"] }])(url);
    };
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: "10.1234/two" },
      ],
      options,
    );
    expect(calls.map((c) => filterValues(new URL(c.url)))).to.deep.equal([
      { field: "ids.openalex", values: ["W1", "W2"] },
      { field: "ids.openalex", values: ["W1"] },
      { field: "ids.openalex", values: ["W2"] },
      { field: "doi", values: ["10.1234/two"] },
    ]);
    expect(outcome.failed).to.deep.equal([]);
    expect(
      outcome.rows.map((r) => [r.identityKey, r.status, r.referenceIDs]),
    ).to.deep.equal([
      ["openalex:W1", "success", []],
      ["openalex:W2", "success", ["W5"]],
      ["doi:10.1234/two", "alias", null],
    ]);
  });
});
