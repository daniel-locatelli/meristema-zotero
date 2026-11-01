import { describe, it } from "node:test";
import { expect } from "chai";

import { doiOffer } from "../../src/services/doiOffer";

const base = {
  matchedDOI: "10.1145/1201775.882296",
  itemDOI: "",
  fieldValid: true,
  matchConfirmed: true,
  matchedBy: "doi" as const,
  matchConfidence: 1,
};

describe("doiOffer (F9)", function () {
  it("offers a confirmed match's DOI as one click", function () {
    expect(doiOffer(base)).to.deep.equal({
      doi: "10.1145/1201775.882296",
      confirmed: true,
      evidence: null,
    });
  });

  it("shows an unconfirmed match with how it was matched and how sure", function () {
    expect(
      doiOffer({
        ...base,
        matchConfirmed: false,
        matchedBy: "title",
        matchConfidence: 0.87,
      }),
    ).to.deep.equal({
      doi: "10.1145/1201775.882296",
      confirmed: false,
      evidence:
        "Matched by title, 87% sure. Check that this is the paper first.",
    });
  });

  it("offers nothing when the item has a DOI, has no DOI field, or the match has none", function () {
    expect(doiOffer({ ...base, itemDOI: "10.1/x" }), "has one").to.equal(null);
    expect(doiOffer({ ...base, fieldValid: false }), "no field").to.equal(null);
    expect(doiOffer({ ...base, matchedDOI: null }), "no match DOI").to.equal(
      null,
    );
    expect(doiOffer({ ...base, matchedDOI: "not a doi" })).to.equal(null);
  });
});
