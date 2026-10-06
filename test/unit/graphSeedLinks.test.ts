import { describe, it } from "node:test";
import { expect } from "chai";
import {
  canonicalOpenAlexID,
  checkedSeedLinks,
  openAlexIdentifiersOf,
  seedLinkCount,
  seedLinkLabelRank,
  seedLinkRampIndex,
  seedLinkTierKey,
  seedLinkTierLabel,
} from "../../src/services/graphSeedLinks";

describe("seedLinkCount", function () {
  const seeds = new Set(["s", "t", "u"]);

  it("counts the seeds among a hop-1 paper's parents", function () {
    expect(seedLinkCount({ hop: 1, parents: ["s", "u"] }, seeds)).to.equal(2);
  });

  it("ignores a parent that is not a seed", function () {
    // The walk can give a hop-1 paper a hop-1 parent: an existing entry gains
    // every parent that links to it, whatever its hop (graphHopModel.ts).
    expect(seedLinkCount({ hop: 1, parents: ["s", "a"] }, seeds)).to.equal(1);
  });

  it("has no count for a seed or a deeper paper", function () {
    expect(seedLinkCount({ hop: 0, parents: [] }, seeds)).to.equal(undefined);
    expect(seedLinkCount({ hop: 2, parents: ["s"] }, seeds)).to.equal(
      undefined,
    );
  });
});

describe("seed link tiers", function () {
  it("keys a tier by its count", function () {
    expect(seedLinkTierKey(3)).to.equal("links:3");
  });

  it("names a tier by the direction", function () {
    expect(seedLinkTierLabel(3, 3, "cited-by")).to.equal("Cite all 3 seeds");
    expect(seedLinkTierLabel(2, 3, "cited-by")).to.equal("Cite 2 of 3 seeds");
    expect(seedLinkTierLabel(1, 3, "cited-by")).to.equal("Cite 1 seed");
    expect(seedLinkTierLabel(2, 2, "references")).to.equal(
      "Cited by all 2 seeds",
    );
    expect(seedLinkTierLabel(2, 4, "references")).to.equal(
      "Cited by 2 of 4 seeds",
    );
    expect(seedLinkTierLabel(1, 4, "references")).to.equal("Cited by 1 seed");
  });

  it("puts all S on the ramp's last stop and 1 on its first", function () {
    expect(seedLinkRampIndex(2, 2, 5)).to.equal(4);
    expect(seedLinkRampIndex(1, 2, 5)).to.equal(0);
    expect(seedLinkRampIndex(2, 3, 5)).to.equal(2);
    expect(
      [1, 2, 3, 4, 5, 6].map((k) => seedLinkRampIndex(k, 6, 5)),
    ).to.deep.equal([0, 1, 2, 2, 3, 4]);
  });

  it("clamps a count outside 1..S and a graph with one seed", function () {
    expect(seedLinkRampIndex(9, 3, 5)).to.equal(4);
    expect(seedLinkRampIndex(0, 3, 5)).to.equal(0);
    expect(seedLinkRampIndex(1, 1, 5)).to.equal(4);
  });
});

describe("seedLinkLabelRank", function () {
  const marks = {
    seedKeys: new Set(["s"]),
    seedLinks: new Map([
      ["a", 2],
      ["b", 1],
    ]),
  };

  it("ranks seeds first, then by seed links, then everything else at 0", function () {
    expect(seedLinkLabelRank("s", marks)).to.be.greaterThan(
      seedLinkLabelRank("a", marks),
    );
    expect(seedLinkLabelRank("a", marks)).to.equal(2);
    expect(seedLinkLabelRank("b", marks)).to.equal(1);
    expect(seedLinkLabelRank("deep", marks)).to.equal(0);
  });
});

describe("openAlexIdentifiersOf", function () {
  const bare = {
    provider: null,
    providerWorkID: null,
    sourceMetrics: null,
    externalWork: null,
    doi: null,
  };

  it("takes the node's own ID when OpenAlex is its provider", function () {
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "openalex",
        providerWorkID: "https://openalex.org/w123",
        sourceMetrics: {
          libraryUpdateState: { providerWorkIDs: { openalex: "W9" } },
        } as never,
      }),
    ).to.deep.equal({ openAlexID: "W123", doi: null });
  });

  it("falls back to the library update's IDs, then the external work's", function () {
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "semantic-scholar",
        providerWorkID: "abc",
        sourceMetrics: {
          libraryUpdateState: { providerWorkIDs: { openalex: "W77" } },
        } as never,
      }).openAlexID,
    ).to.equal("W77");
    expect(
      openAlexIdentifiersOf({
        ...bare,
        externalWork: { provider: "openalex", providerWorkID: "W5" } as never,
      }).openAlexID,
    ).to.equal("W5");
  });

  it("rejects an ID that is not a work ID", function () {
    expect(canonicalOpenAlexID("A123")).to.equal(null);
    expect(canonicalOpenAlexID("")).to.equal(null);
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "openalex",
        providerWorkID: "S42",
      }).openAlexID,
    ).to.equal(null);
  });

  it("normalises the DOI, from the node or its external work", function () {
    expect(
      openAlexIdentifiersOf({ ...bare, doi: "https://doi.org/10.1234/ABC" })
        .doi,
    ).to.equal("10.1234/abc");
    expect(
      openAlexIdentifiersOf({
        ...bare,
        externalWork: { provider: "crossref", doi: "10.2345/X" } as never,
      }).doi,
    ).to.equal("10.2345/x");
  });
});

describe("checkedSeedLinks", function () {
  const A = { key: "a", check: { openAlexID: "W1", references: [] } };
  const B = { key: "b", check: { openAlexID: "W2", references: ["W10"] } };

  it("under Citers, links a paper to every seed in its references", function () {
    const links = checkedSeedLinks(
      "cited-by",
      [A, B],
      [{ key: "p", check: { openAlexID: "W10", references: ["W1", "W2"] } }],
    );
    expect(links.get("p")).to.deep.equal(["a", "b"]);
  });

  it("under References, links a paper to every seed whose references hold it", function () {
    const links = checkedSeedLinks(
      "references",
      [A, B],
      [{ key: "p", check: { openAlexID: "W10", references: [] } }],
    );
    expect(links.get("p")).to.deep.equal(["b"]);
  });

  it("learns nothing from a seed or a paper with no check", function () {
    const links = checkedSeedLinks(
      "cited-by",
      [{ key: "a" }, B],
      [
        { key: "p", check: { openAlexID: "W10", references: ["W1"] } },
        { key: "q" },
      ],
    );
    expect(links.size).to.equal(0);
  });
});
