import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import {
  limitRelationshipProviders,
  relationshipProviderPolicyForSize,
} from "../../src/services/relationshipRefreshPolicy";
import {
  getProviderPlan,
  providerPagesRelationships,
  recordProviderFailure,
  resetCitationProviderSessionState,
} from "../../src/providers/registry";

describe("relationshipProviderPolicyForSize", function () {
  it("stays aggregate and unlimited by default", function () {
    expect(relationshipProviderPolicyForSize("automatic", 40)).to.deep.equal({
      providerStrategy: "aggregate",
      providerLimit: Number.POSITIVE_INFINITY,
    });
  });

  it("honours an explicit strategy and limit: a hop paper asks one provider", function () {
    expect(
      relationshipProviderPolicyForSize("automatic", 40, {
        providerStrategy: "native-first",
        providerLimit: 1,
      }),
    ).to.deep.equal({ providerStrategy: "native-first", providerLimit: 1 });
  });
});

describe("providerPagesRelationships", function () {
  it("names the providers with a fetcher for each direction", function () {
    expect(
      (
        [
          "semantic-scholar",
          "crossref",
          "inspire",
          "opencitations",
          "openalex",
        ] as CitationProviderID[]
      ).filter((provider) =>
        providerPagesRelationships(provider, "references"),
      ),
    ).to.deep.equal(["semantic-scholar", "opencitations", "openalex"]);
    expect(
      (
        [
          "semantic-scholar",
          "crossref",
          "inspire",
          "opencitations",
          "openalex",
        ] as CitationProviderID[]
      ).filter((provider) => providerPagesRelationships(provider, "cited-by")),
    ).to.deep.equal(["semantic-scholar", "opencitations", "openalex"]);
  });
});

describe("limitRelationshipProviders", function () {
  const pages = (provider: CitationProviderID): boolean =>
    provider === "semantic-scholar" || provider === "opencitations";

  it("keeps the whole plan when nothing is dropped", function () {
    const ordered: CitationProviderID[] = ["crossref", "opencitations"];
    expect(
      limitRelationshipProviders(ordered, Number.POSITIVE_INFINITY, pages),
    ).to.deep.equal(ordered);
    expect(limitRelationshipProviders(ordered, 2, pages)).to.deep.equal(
      ordered,
    );
  });

  it("keeps the given order when the kept head can already page", function () {
    expect(
      limitRelationshipProviders(
        ["semantic-scholar", "crossref", "inspire", "opencitations"],
        3,
        pages,
      ),
    ).to.deep.equal(["semantic-scholar", "crossref", "inspire"]);
  });

  it("promotes a paging provider into a head that has none", function () {
    expect(
      limitRelationshipProviders(
        ["crossref", "inspire", "opencitations"],
        1,
        pages,
      ),
    ).to.deep.equal(["opencitations"]);
    expect(
      limitRelationshipProviders(
        ["crossref", "inspire", "opencitations", "openalex"],
        2,
        pages,
      ),
    ).to.deep.equal(["opencitations", "crossref"]);
  });

  it("leaves a plan alone when no provider can page the direction", function () {
    expect(
      limitRelationshipProviders(["crossref", "inspire"], 1, pages),
    ).to.deep.equal(["crossref"]);
    expect(limitRelationshipProviders(["crossref"], 0, pages)).to.deep.equal(
      [],
    );
  });

  it("gives a one-provider references hop a provider that can page, not Crossref", function () {
    resetCitationProviderSessionState();
    try {
      recordProviderFailure("auto", {
        provider: "semantic-scholar",
        status: "rate-limited",
        message: "one request per second",
      });
      const plan = getProviderPlan("references", "auto");
      expect(plan.providers[0]).to.equal("crossref");
      expect(
        limitRelationshipProviders(plan.providers, 1, (provider) =>
          providerPagesRelationships(provider, "references"),
        ),
      ).to.deep.equal(["opencitations"]);
    } finally {
      resetCitationProviderSessionState();
    }
  });
});
