import { describe, it } from "node:test";
import { expect } from "chai";
import { relationshipProviderPolicyForSize } from "../../src/services/relationshipRefreshPolicy";

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
