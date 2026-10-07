import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import type { RelationshipProviderSnapshot } from "../../src/providers/relationshipPolicy";
import {
  askUntilNotRefused,
  providerHintFor,
  providerSupportsPaper,
} from "../../src/services/externalDiscoveryService";

/** A snapshot that succeeded with no works, unless told otherwise. */
function snapshot(
  provider: CitationProviderID,
  over: Partial<RelationshipProviderSnapshot> = {},
): RelationshipProviderSnapshot {
  return {
    provider,
    works: [],
    reportedCount: null,
    complete: true,
    succeeded: true,
    refused: false,
    order: "arrival",
    ...over,
  };
}

const ONE_WORK = [
  {} as unknown as RelationshipProviderSnapshot["works"][number],
];

/**
 * B72: OpenCitations answering "no citers" used to end the expansion, so
 * OpenAlex was never asked for any of the frontier papers though it was
 * answering 20 of 20. No Zotero fixture can reach this branch — a fill's
 * candidate list never holds two providers that both answer, since a refusing
 * one is either skipped or asked first — so it is pinned here or nowhere.
 */
describe("askUntilNotRefused", function () {
  it("asks the next candidate past an empty answer, and keeps its works", async function () {
    const asked: CitationProviderID[] = [];
    const results = await askUntilNotRefused(
      ["opencitations", "openalex"] as const,
      (provider) => {
        asked.push(provider);
        return Promise.resolve(
          provider === "openalex"
            ? snapshot(provider, { works: ONE_WORK })
            : snapshot(provider),
        );
      },
      () => false,
    );
    expect(
      asked,
      "an empty answer must not end the expansion while a candidate is left",
    ).to.deep.equal(["opencitations", "openalex"]);
    expect(
      results.at(-1)!.works,
      "the answering provider's works are what the expansion keeps",
    ).to.have.lengthOf(1);
  });

  it("stops at the last candidate, whose empty list stands", async function () {
    const asked: CitationProviderID[] = [];
    const results = await askUntilNotRefused(
      ["opencitations"] as const,
      (provider) => {
        asked.push(provider);
        return Promise.resolve(snapshot(provider));
      },
      () => false,
    );
    expect(asked).to.deep.equal(["opencitations"]);
    expect(results).to.have.lengthOf(1);
  });

  it("stops at a provider that reports zero, though a candidate is left", async function () {
    const asked: CitationProviderID[] = [];
    await askUntilNotRefused(
      ["opencitations", "openalex"] as const,
      (provider) => {
        asked.push(provider);
        return Promise.resolve(snapshot(provider, { reportedCount: 0 }));
      },
      () => false,
    );
    expect(
      asked,
      "a reported zero is backing in its own right, so nobody else is asked",
    ).to.deep.equal(["opencitations"]);
  });

  it("asks nobody once cancelled", async function () {
    const asked: CitationProviderID[] = [];
    const results = await askUntilNotRefused(
      ["opencitations", "openalex"] as const,
      (provider) => {
        asked.push(provider);
        return Promise.resolve(snapshot(provider));
      },
      () => true,
    );
    expect(asked).to.deep.equal([]);
    expect(results).to.deep.equal([]);
  });
});

/**
 * A paper OpenAlex cannot reach by identifier or title, so only a work ID
 * hint makes it askable.
 */
function bareNode(over: Partial<CitationGraphNode> = {}): CitationGraphNode {
  return {
    title: "",
    authors: [],
    doi: null,
    sourceTitle: null,
    year: null,
    externalWork: null,
    provider: null,
    providerWorkID: null,
    ...over,
  } as unknown as CitationGraphNode;
}

describe("providerSupportsPaper", function () {
  it("cannot ask a provider with no identifier, title or work ID", function () {
    expect(providerSupportsPaper("openalex", bareNode(), {})).to.equal(false);
  });

  it("asks a provider the hints hold a work ID for", function () {
    expect(
      providerSupportsPaper("openalex", bareNode(), { openalex: "W1" }),
    ).to.equal(true);
  });

  it("asks the paper's own provider with its work ID", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "W1" });
    expect(providerSupportsPaper("openalex", node, {})).to.equal(true);
  });

  it("ignores the work ID of another provider", function () {
    const node = bareNode({
      provider: "semantic-scholar",
      providerWorkID: "abc",
    });
    expect(providerSupportsPaper("openalex", node, {})).to.equal(false);
  });

  it("falls back past an empty hint to the paper's own work ID", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "W1" });
    expect(providerSupportsPaper("openalex", node, { openalex: "" })).to.equal(
      true,
    );
  });

  it("takes a whitespace-only work ID for none", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "  " });
    expect(providerSupportsPaper("openalex", node, {})).to.equal(false);
  });
});

describe("providerHintFor", function () {
  it("prefers the caller's hint to the paper's own work ID", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "W1" });
    expect(providerHintFor(node, { openalex: "W2" }, "openalex")).to.equal(
      "W2",
    );
  });

  it("falls back past an empty hint to the paper's own work ID", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "W1" });
    expect(providerHintFor(node, { openalex: "" }, "openalex")).to.equal("W1");
  });

  it("takes a whitespace-only work ID for none", function () {
    const node = bareNode({ provider: "openalex", providerWorkID: "  " });
    expect(providerHintFor(node, {}, "openalex")).to.equal(null);
  });

  it("trims the work ID it hands back", function () {
    expect(
      providerHintFor(bareNode(), { openalex: " W2 " }, "openalex"),
    ).to.equal("W2");
  });

  it("ignores the work ID of another provider", function () {
    const node = bareNode({
      provider: "semantic-scholar",
      providerWorkID: "abc",
    });
    expect(providerHintFor(node, {}, "openalex")).to.equal(null);
  });
});
