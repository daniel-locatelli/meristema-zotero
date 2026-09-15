import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import {
  fillRelationshipCandidates,
  isPagingProvider,
  limitRelationshipProviders,
  lookupStep,
  nextFillProvider,
  refusedSnapshotState,
  relationshipProviderPolicyForSize,
  unbackedEmptyList,
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

  it("leaves a limit-1 head alone when that one provider already pages", function () {
    // The hop runner's own case: `providerLimit: 1`. Nothing is promoted
    // when the single provider the order picked can page the direction, so
    // native-first survives the truncation.
    expect(
      limitRelationshipProviders(
        ["semantic-scholar", "crossref", "opencitations"],
        1,
        pages,
      ),
    ).to.deep.equal(["semantic-scholar"]);
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

const S2: CitationProviderID = "semantic-scholar";
const OC: CitationProviderID = "opencitations";

describe("lookupStep", function () {
  it("refuses on a 429, accepts a match, and searches by title otherwise", function () {
    expect(lookupStep("rate-limited")).to.equal("refuse");
    expect(lookupStep("success")).to.equal("accept");
    expect(lookupStep("not-found")).to.equal("search");
    expect(lookupStep("provider-error")).to.equal("search");
    expect(lookupStep(null)).to.equal("search");
  });
});

describe("isPagingProvider", function () {
  const pages = { enabled: true, pagesDirection: true, hasOpenAlexKey: false };

  it("is not keyless OpenAlex, whose page returns nothing before asking", function () {
    expect(isPagingProvider("openalex", pages)).to.equal(false);
    expect(
      isPagingProvider("openalex", { ...pages, hasOpenAlexKey: true }),
    ).to.equal(true);
  });

  it("needs the provider enabled and able to page the direction", function () {
    expect(isPagingProvider(S2, pages)).to.equal(true);
    expect(isPagingProvider(S2, { ...pages, enabled: false })).to.equal(false);
    expect(
      isPagingProvider("crossref", { ...pages, pagesDirection: false }),
    ).to.equal(false);
  });
});

describe("fillRelationshipCandidates", function () {
  const onlyTheTwo = (provider: CitationProviderID): boolean =>
    provider === S2 || provider === OC;

  it("keeps the given order, paging providers only, minus the excluded", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [OC, S2, "crossref", "openalex"],
        isPaging: onlyTheTwo,
        supportsPaper: () => true,
        excluded: [S2],
      }),
    ).to.deep.equal({ candidates: [OC], skipped: [S2] });
  });

  it("leaves a provider that cannot take the paper out of both lists", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [S2, OC],
        isPaging: onlyTheTwo,
        supportsPaper: (provider) => provider !== OC,
        excluded: [OC],
      }),
    ).to.deep.equal({ candidates: [S2], skipped: [] });
  });

  it("names every excluded paging provider as skipped when none remains", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [S2, "crossref", OC],
        isPaging: onlyTheTwo,
        supportsPaper: () => true,
        excluded: [OC, S2],
      }),
    ).to.deep.equal({ candidates: [], skipped: [S2, OC] });
  });
});

describe("nextFillProvider", function () {
  it("asks the first candidate this refresh has not seen refuse", function () {
    expect(nextFillProvider([S2, OC], [])).to.equal(S2);
    expect(nextFillProvider([S2, OC], [S2])).to.equal(OC);
    expect(nextFillProvider([S2, OC], [S2, OC])).to.equal(null);
  });
});

describe("refusedSnapshotState", function () {
  it("is no answer before any work was collected, a partial list after", function () {
    expect(refusedSnapshotState(0)).to.deep.equal({
      succeeded: false,
      complete: false,
    });
    expect(refusedSnapshotState(12)).to.deep.equal({
      succeeded: true,
      complete: false,
    });
  });
});

describe("unbackedEmptyList", function () {
  const empty = {
    fill: true,
    firstPageEmpty: true,
    matched: false,
    reportedCount: null,
  };

  it("fails a fill's empty first page with no match and no count behind it", function () {
    expect(unbackedEmptyList(empty)).to.equal(true);
  });

  it("trusts it with a lookup match or a reported count, and on manual paths", function () {
    expect(unbackedEmptyList({ ...empty, matched: true })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, reportedCount: 12 })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, fill: false })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, firstPageEmpty: false })).to.equal(
      false,
    );
  });
});

describe("getProviderPlan with ignoreHealth", function () {
  it("keeps a provider the 60 s register holds back", function () {
    resetCitationProviderSessionState();
    try {
      recordProviderFailure("auto", {
        provider: S2,
        status: "rate-limited",
        message: "one request per second",
      });
      expect(getProviderPlan("citations", "auto").providers).to.not.include(S2);
      expect(
        getProviderPlan("citations", "auto", { ignoreHealth: true })
          .providers[0],
      ).to.equal(S2);
    } finally {
      resetCitationProviderSessionState();
    }
  });
});
