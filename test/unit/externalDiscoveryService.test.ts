import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import type { RelationshipProviderSnapshot } from "../../src/providers/relationshipPolicy";
import { askUntilNotRefused } from "../../src/services/externalDiscoveryService";

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
