import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import { providerExecutionPolicy } from "../../src/services/providerExecutionPolicy";

const PROVIDERS: CitationProviderID[] = [
  "crossref",
  "semantic-scholar",
  "opencitations",
  "inspire",
  "openalex",
];

const prefKey = (name: string): string => `${config.prefsPrefix}.${name}`;

let store: Record<string, unknown> = {};
let previousZotero: unknown;

/** Requests per second a policy allows once its queue is saturated. */
function requestsPerSecond(provider: CitationProviderID): number {
  const policy = providerExecutionPolicy(provider);
  return policy.requestParallelism / (policy.minimumStartDelayMs / 1000);
}

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  store = {};
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (name: string) => store[name],
      set: (name: string, value: unknown) => {
        store[name] = value;
      },
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("Provider execution policy", function () {
  it("keeps Semantic Scholar under the one request per second its plan grants", function () {
    // The plan is "1 request per second, cumulative across all endpoints",
    // and the application asks the applicant to sit below that threshold.
    const policy = providerExecutionPolicy("semantic-scholar");
    expect(policy.requestParallelism).to.equal(1);
    expect(policy.minimumStartDelayMs).to.be.at.least(1000);
  });

  it("returns the same Semantic Scholar policy with a key as without one", function () {
    // B9: a key buys batch and page size and a private quota, never speed.
    const keyless = providerExecutionPolicy("semantic-scholar");
    store[prefKey("semanticScholarAPIKey")] = "a-real-looking-key";
    expect(providerExecutionPolicy("semantic-scholar")).to.deep.equal(keyless);
  });

  it("returns the same OpenAlex policy with a key as without one", function () {
    const keyless = providerExecutionPolicy("openalex");
    store[prefKey("openAlexAPIKey")] = "a-real-looking-key";
    expect(providerExecutionPolicy("openalex")).to.deep.equal(keyless);
  });

  it("keeps OpenAlex an order of magnitude under its documented ceiling", function () {
    // OpenAlex returns 429 above 100 requests per second at every
    // authentication level; its real limit is a daily budget.
    expect(requestsPerSecond("openalex")).to.be.at.most(10);
  });

  it("gives every provider a policy", function () {
    for (const provider of PROVIDERS) {
      const policy = providerExecutionPolicy(provider);
      expect(policy.requestParallelism, provider).to.be.at.least(1);
      expect(policy.minimumStartDelayMs, provider).to.be.at.least(0);
      expect(policy.batchSize, provider).to.be.at.least(1);
      expect(policy.relationshipPageSize, provider).to.be.at.least(1);
    }
  });
});
