import { describe, it } from "node:test";
import { expect } from "chai";
import type { ExternalWork } from "../../src/domain/externalWork";
import {
  MAX_FRAGMENT_ENTRIES,
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

  it("evicts the earliest unread fragment once the ceiling is passed", function () {
    // A hop-2 fill inserts far more fragments than the ceiling holds. What
    // must survive is what the walk keeps reading — the expanded parents —
    // not whatever happened to be written last.
    clearFocusGraphCaches();
    for (let index = 0; index < MAX_FRAGMENT_ENTRIES; index += 1) {
      setHopFragment(1, `f${index}`, "cited-by", {
        expanded: true,
        works: [work],
      });
    }
    expect(focusGraphCacheStats().fragments).to.equal(MAX_FRAGMENT_ENTRIES);
    // f0 is the oldest by insertion, but reading it makes it the newest.
    expect(getHopFragment(1, "f0", "cited-by")).to.not.equal(null);
    for (let index = 0; index < 100; index += 1) {
      setHopFragment(1, `g${index}`, "cited-by", {
        expanded: true,
        works: [work],
      });
    }
    expect(focusGraphCacheStats().fragments).to.equal(MAX_FRAGMENT_ENTRIES);
    expect(
      getHopFragment(1, "f0", "cited-by"),
      "the read fragment survives 100 later insertions",
    ).to.not.equal(null);
    expect(
      getHopFragment(1, "f1", "cited-by"),
      "the earliest unread fragment is the one evicted",
    ).to.equal(null);
    expect(
      getHopFragment(1, "f100", "cited-by"),
      "exactly 100 fragments were evicted",
    ).to.equal(null);
    expect(getHopFragment(1, "f101", "cited-by")).to.not.equal(null);
    expect(getHopFragment(1, "g99", "cited-by")).to.not.equal(null);
  });
});
