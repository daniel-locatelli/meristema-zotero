import { describe, it } from "node:test";
import { expect } from "chai";
import type { HopEntry } from "../../src/services/graphHopModel";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
} from "../../src/services/graphHopFillModel";
import {
  hopLandingEffects,
  hopRejectionEffects,
  planHopExploreChange,
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
    });
    expect(effects).to.deep.equal({
      countExpanded: false,
      markFailed: true,
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
      }),
    ).to.deep.equal({
      countExpanded: true,
      markFailed: false,
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
        }),
        `stale epoch, stored=${stored}`,
      ).to.deep.equal({
        countExpanded: false,
        markFailed: false,
        applyToModel: false,
      });
    }
    expect(
      hopLandingEffects({
        epoch: 5,
        currentEpoch: 5,
        cleaned: true,
        stored: true,
      }),
      "a torn-down view lands nothing either",
    ).to.deep.equal({
      countExpanded: false,
      markFailed: false,
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
    });
    expect(Object.keys(effects).sort()).to.deep.equal([
      "applyToModel",
      "countExpanded",
      "markFailed",
    ]);
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
