import { describe, it } from "node:test";
import { expect } from "chai";
import type { HopEntry } from "../../src/services/graphHopModel";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
} from "../../src/services/graphHopFillModel";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import {
  COOL_DOWN_MS,
  answer,
  deferUntil,
  endAll,
  excluded,
  hopCoolDown,
  hopLandingEffects,
  hopRejectionEffects,
  outcomeRefused,
  planHopExploreChange,
  refuse,
  type ProviderWindows,
} from "../../src/services/graphHopRunnerModel";

function entry(
  key: string,
  hop: number,
  parents: string[] = [],
  expanded = false,
): [string, HopEntry] {
  return [key, { key, hop, parents, expanded }];
}

/** The runner's own loop: plan, land, apply the effects, plan again. */
function fillInput(failedKeys: Set<string>): HopFillInput {
  return {
    entries: new Map([entry("s", 0, [], true), entry("a", 1, ["s"])]),
    visibleKeys: new Set(["s", "a"]),
    depth: 2,
    selectedKey: null,
    hoveredKey: null,
    onScreenKeys: new Set(),
    failedKeys,
    expandedByHop: [0, 0, 0],
    capByHop: [HOP_EXPANSION_CAP, HOP_EXPANSION_CAP, HOP_EXPANSION_CAP],
    reportedCountOf: () => null,
  };
}

describe("the hop runner's landing", function () {
  it("marks a refresh that resolved nothing failed, and the next plan drops it", function () {
    const failedKeys = new Set<string>();
    expect(
      planHopFill(fillInput(failedKeys)).order,
      "the paper is planned before it is asked",
    ).to.deep.equal(["a"]);
    const effects = hopLandingEffects({
      epoch: 3,
      currentEpoch: 3,
      cleaned: false,
      stored: false,
      refused: false,
    });
    expect(effects).to.deep.equal({
      countExpanded: false,
      markFailed: true,
      defer: false,
      applyToModel: true,
    });
    if (effects.markFailed) failedKeys.add("a");
    expect(
      planHopFill(fillInput(failedKeys)).order,
      "a failed paper is never planned again this session",
    ).to.deep.equal([]);
  });

  it("counts a stored summary as expanded, empty list or not", function () {
    expect(
      hopLandingEffects({
        epoch: 1,
        currentEpoch: 1,
        cleaned: false,
        stored: true,
        refused: false,
      }),
    ).to.deep.equal({
      countExpanded: true,
      markFailed: false,
      defer: false,
      applyToModel: true,
    });
  });

  it("drops every effect of a landing under a stale epoch", function () {
    // A direction switch bumps the epoch: the request still stored its list,
    // but the counts, the failures and the re-plan belong to a model that is
    // gone (spec, "Direction switch").
    for (const stored of [true, false]) {
      expect(
        hopLandingEffects({
          epoch: 4,
          currentEpoch: 5,
          cleaned: false,
          stored,
          refused: false,
        }),
        `stale epoch, stored=${stored}`,
      ).to.deep.equal({
        countExpanded: false,
        markFailed: false,
        defer: false,
        applyToModel: false,
      });
    }
    expect(
      hopLandingEffects({
        epoch: 5,
        currentEpoch: 5,
        cleaned: true,
        stored: true,
        refused: false,
      }),
      "a torn-down view lands nothing either",
    ).to.deep.equal({
      countExpanded: false,
      markFailed: false,
      defer: false,
      applyToModel: false,
    });
  });

  it("still fails the paper when a rejection escapes, unless the epoch moved", function () {
    expect(hopRejectionEffects({ epoch: 2, currentEpoch: 2 })).to.deep.equal({
      markFailed: true,
    });
    expect(hopRejectionEffects({ epoch: 2, currentEpoch: 3 })).to.deep.equal({
      markFailed: false,
    });
  });

  it("has no output that touches the Refresh button", function () {
    // The spec asks that a landing on the runner's queue does not touch the
    // seed Refresh's state. The runner keeps its own queue, epoch and
    // in-flight slot, so here that is the absence of an output: a landing can
    // only count, fail and re-plan. The DOM side is the Zotero case "keeps
    // Refresh pressable while the fill runs".
    const effects = hopLandingEffects({
      epoch: 1,
      currentEpoch: 1,
      cleaned: false,
      stored: true,
      refused: false,
    });
    expect(Object.keys(effects).sort()).to.deep.equal([
      "applyToModel",
      "countExpanded",
      "defer",
      "markFailed",
    ]);
  });
});

describe("a refused landing", function () {
  it("defers the paper: not counted, not failed, nothing applied", function () {
    expect(
      hopLandingEffects({
        epoch: 1,
        currentEpoch: 1,
        cleaned: false,
        stored: false,
        refused: true,
      }),
    ).to.deep.equal({
      countExpanded: false,
      markFailed: false,
      defer: true,
      applyToModel: false,
    });
  });

  it("lets a stored list win over a refusal on the way", function () {
    expect(
      hopLandingEffects({
        epoch: 1,
        currentEpoch: 1,
        cleaned: false,
        stored: true,
        refused: true,
      }),
    ).to.include({ countExpanded: true, defer: false });
  });

  it("reads one refused and the next failed as refused, not failed", function () {
    const S2: CitationProviderID = "semantic-scholar";
    const OC: CitationProviderID = "opencitations";
    const outcome = { refusedBy: [S2], skipped: [], answeredBy: null };
    expect(outcomeRefused(outcome)).to.equal(true);
    expect(
      outcomeRefused({ refusedBy: [], skipped: [OC], answeredBy: null }),
      "a provider sitting out a window",
    ).to.equal(true);
    expect(
      outcomeRefused({ refusedBy: [], skipped: [], answeredBy: null }),
    ).to.equal(false);
  });
});

describe("provider windows", function () {
  const S2: CitationProviderID = "semantic-scholar";
  const OC: CitationProviderID = "opencitations";

  it("wait 30 s, 1 min, 2 min, then every 5 min", function () {
    let windows: ProviderWindows = new Map();
    let now = 0;
    const delays: number[] = [];
    for (let refusal = 0; refusal < 5; refusal += 1) {
      windows = refuse(windows, S2, now);
      const endsAt = windows.get(S2)!.endsAt;
      delays.push(endsAt - now);
      now = endsAt;
    }
    expect(delays).to.deep.equal([30_000, 60_000, 120_000, 300_000, 300_000]);
    expect(COOL_DOWN_MS).to.deep.equal([30_000, 60_000, 120_000, 300_000]);
  });

  it("start over after an answer", function () {
    let windows = refuse(refuse(new Map(), S2, 0), S2, 30_000);
    windows = answer(windows, S2);
    expect(excluded(windows, 30_000)).to.deep.equal([]);
    windows = refuse(windows, S2, 100_000);
    expect(windows.get(S2)!.endsAt).to.equal(130_000);
  });

  it("end together on Resume, each keeping its step", function () {
    let windows = refuse(refuse(new Map(), S2, 0), OC, 0);
    windows = endAll(windows, 5_000);
    expect(excluded(windows, 5_000)).to.deep.equal([]);
    windows = refuse(windows, S2, 5_000);
    expect(windows.get(S2)!.endsAt, "the second refusal waits 1 min").to.equal(
      65_000,
    );
  });

  it("exclude only the providers whose window is still running", function () {
    const windows = refuse(refuse(refuse(new Map(), S2, 0), OC, 0), OC, 30_000);
    expect(excluded(windows, 0)).to.deep.equal([S2, OC]);
    expect(excluded(windows, 30_000)).to.deep.equal([OC]);
    expect(excluded(windows, 90_000)).to.deep.equal([]);
  });

  it("defer a paper until the earliest of its providers' windows ends", function () {
    const windows = refuse(refuse(refuse(new Map(), S2, 0), OC, 0), OC, 0);
    // S2 ends at 30 s; OC, refused twice at 0, ends at 1 min.
    expect(deferUntil(windows, [S2, OC], 0)).to.equal(30_000);
    expect(deferUntil(windows, [S2, OC], 45_000)).to.equal(60_000);
    expect(deferUntil(windows, [S2, OC], 60_000)).to.equal(null);
    expect(deferUntil(windows, ["openalex"], 0)).to.equal(null);
  });
});

describe("hopCoolDown", function () {
  const S2: CitationProviderID = "semantic-scholar";
  const OC: CitationProviderID = "opencitations";
  const windows = refuse(refuse(new Map(), S2, 0), OC, 1_000);

  it("waits for the earliest window when every paging provider is in one, however many papers wait", function () {
    expect(
      hopCoolDown({
        windows,
        now: 2_000,
        pagingProviders: [S2, OC],
        orderLength: 5,
        deferralEnds: [],
      }),
    ).to.equal(30_000);
  });

  it("expands while one paging provider is free and a paper is planned", function () {
    expect(
      hopCoolDown({
        windows,
        now: 2_000,
        pagingProviders: [S2, OC, "openalex"],
        orderLength: 1,
        deferralEnds: [30_000],
      }),
    ).to.equal(null);
  });

  it("waits for the earliest deferral when every paper left is deferred", function () {
    expect(
      hopCoolDown({
        windows: new Map(),
        now: 0,
        pagingProviders: [S2, OC],
        orderLength: 0,
        deferralEnds: [45_000, 31_000],
      }),
    ).to.equal(31_000);
  });

  it("does not wait on nothing", function () {
    expect(
      hopCoolDown({
        windows: new Map(),
        now: 0,
        pagingProviders: [],
        orderLength: 0,
        deferralEnds: [],
      }),
    ).to.equal(null);
  });
});

describe("planHopExploreChange", function () {
  const current = {
    direction: "cited-by" as const,
    depth: 1,
    enabled: [true, true, false, false],
  };

  it("writes the direction and the depth a view asks for", function () {
    const change = planHopExploreChange(current, {
      direction: "references",
      hops: 2,
    });
    expect(change.direction).to.equal("references");
    expect(change.depth).to.equal(2);
    expect(change.enabled).to.deep.equal([true, true, true, false]);
    expect(change.changed).to.equal(true);
    expect(change.bumpEpoch, "a direction change drops the callbacks").to.equal(
      true,
    );
  });

  it("clamps the depth the view asks for", function () {
    expect(
      planHopExploreChange(current, { direction: "cited-by", hops: 9 }).depth,
    ).to.equal(6);
    expect(
      planHopExploreChange(current, { direction: "cited-by", hops: 0 }).depth,
    ).to.equal(1);
  });

  it("enables hops up to the clamped depth, not the unclamped request", function () {
    const allOff = {
      direction: "cited-by" as const,
      depth: 1,
      enabled: [true, false, false, false, false, false, false],
    };
    const zero = planHopExploreChange(allOff, {
      direction: "cited-by",
      hops: 0,
    });
    expect(zero.depth).to.equal(1);
    expect(zero.enabled).to.deep.equal([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);

    const nine = planHopExploreChange(allOff, {
      direction: "cited-by",
      hops: 9,
    });
    expect(nine.depth).to.equal(6);
    expect(nine.enabled).to.deep.equal([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("changes nothing, and bumps no epoch, for a view already applied", function () {
    const change = planHopExploreChange(current, {
      direction: "cited-by",
      hops: 1,
    });
    expect(change.changed).to.equal(false);
    expect(change.bumpEpoch).to.equal(false);
  });

  it("turns a hop back on without bumping the epoch", function () {
    const change = planHopExploreChange(
      { ...current, depth: 2, enabled: [true, true, false, false] },
      { direction: "cited-by", hops: 2 },
    );
    expect(change.changed).to.equal(true);
    expect(change.bumpEpoch).to.equal(false);
    expect(change.enabled).to.deep.equal([true, true, true, false]);
  });
});
