import { describe, it } from "node:test";
import { expect } from "chai";
import type { ExternalWork } from "../../src/domain/externalWork";
import {
  clearFocusGraphCaches,
  focusGraphCacheStats,
  getHopFragment,
  invalidateHopFragment,
  setHopFragment,
} from "../../src/services/focusGraphCacheService";

const work: ExternalWork = {
  provider: "openalex",
  providerWorkID: "W1",
  doi: null,
  title: "A",
  year: 2020,
  authors: ["X"],
};

describe("the hop fragment cache", function () {
  it("keys a fragment by library, paper and direction", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [work] });
    expect(getHopFragment(1, "p", "cited-by")?.works[0].title).to.equal("A");
    expect(getHopFragment(1, "p", "references")).to.equal(null);
    expect(getHopFragment(2, "p", "cited-by")).to.equal(null);
    expect(focusGraphCacheStats().fragments).to.equal(1);
  });

  it("hands back copies, so a caller cannot edit the cache", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [work] });
    getHopFragment(1, "p", "cited-by")!.works[0].title = "edited";
    expect(getHopFragment(1, "p", "cited-by")!.works[0].title).to.equal("A");
  });

  it("invalidates both directions of one paper", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [] });
    setHopFragment(1, "p", "references", { expanded: false, works: [] });
    setHopFragment(1, "q", "cited-by", { expanded: true, works: [] });
    invalidateHopFragment(1, "p");
    expect(getHopFragment(1, "p", "cited-by")).to.equal(null);
    expect(getHopFragment(1, "p", "references")).to.equal(null);
    expect(getHopFragment(1, "q", "cited-by")).to.not.equal(null);
  });
});
