import { describe, it } from "node:test";
import { expect } from "chai";
import {
  orderLabelCandidates,
  shortLabel,
} from "../../src/services/graphRendererScene";
import { node } from "./graphRendererDoubles";

describe("orderLabelCandidates", function () {
  const nodes = [
    node("low", { citationCount: 900 }),
    node("tier2", { citationCount: 5 }),
    node("seed", { citationCount: 1 }),
    node("picked", { citationCount: 0 }),
  ];
  const rank: Record<string, number> = { tier2: 2, seed: 99 };

  it("puts the selection first, then rank, then citations", function () {
    const ordered = orderLabelCandidates(
      nodes,
      "picked",
      null,
      (key) => rank[key] ?? 0,
    );
    expect(ordered.map((n) => n.key)).to.deep.equal([
      "picked",
      "seed",
      "tier2",
      "low",
    ]);
  });

  it("is today's order when every rank is 0", function () {
    const ordered = orderLabelCandidates(nodes, null, null, () => 0);
    expect(ordered.map((n) => n.key)).to.deep.equal([
      "low",
      "tier2",
      "seed",
      "picked",
    ]);
  });
});

describe("shortLabel author-year (F3)", function () {
  it("keeps a person's last name", function () {
    expect(
      shortLabel(
        node("a", { authors: ["Ada Lovelace"], year: 1843 }),
        "author-year",
      ),
    ).to.equal("Lovelace (1843)");
  });

  it("names an institutional creator in full", function () {
    expect(
      shortLabel(
        node("a", {
          authors: ["ISO/TC 59"],
          firstAuthorIsInstitution: true,
          year: 2017,
        }),
        "author-year",
      ),
    ).to.equal("ISO/TC 59 (2017)");
  });
});
