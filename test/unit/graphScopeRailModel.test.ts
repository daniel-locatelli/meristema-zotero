import { describe, it } from "node:test";
import { expect } from "chai";
import type { LibraryCollectionFilter } from "../../src/domain/types";
import {
  allCollectionsTicked,
  computeGraphScope,
  onlyCollectionsTicked,
  setCollectionTicks,
  type GraphScopeHops,
  type GraphScopeResult,
} from "../../src/services/graphScopeModel";

import {
  buildScopeRailModel,
  nextRegionSelection,
  regionsStillInLibrary,
  seedRowLabel,
  scopeSquare,
} from "../../src/services/graphScopeRailModel";

function noHops(): GraphScopeHops {
  return { entries: new Map(), depth: 1, enabled: [true, true] };
}

function collection(
  collectionID: number,
  name: string,
  depth: number,
  includedCollectionIDs: number[] = [collectionID],
  parentCollectionID: number | null = null,
): LibraryCollectionFilter {
  return {
    collectionID,
    parentCollectionID,
    key: `C${collectionID}`,
    name,
    path: name,
    depth,
    orderIndex: collectionID,
    includedCollectionIDs,
  };
}

const TREE: LibraryCollectionFilter[] = [
  collection(1, "PhD", 0, [1, 11, 12]),
  collection(11, "Reading", 1, [11], 1),
  collection(12, "Drafts", 1, [12], 1),
  collection(2, "Teaching", 0, [2]),
];

function emptyScope(): GraphScopeResult {
  return computeGraphScope({
    papers: [
      { key: "a", collectionIDs: [1], inLibrary: true },
      { key: "b", collectionIDs: [11], inLibrary: true },
      { key: "c", collectionIDs: [], inLibrary: true },
      { key: "x", collectionIDs: [], inLibrary: false },
    ],
    seedKeys: new Set(),
    hops: noHops(),
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: new Set(),
    facetAdmits: () => true,
  });
}

describe("buildScopeRailModel", function () {
  it("prints shown of total papers", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    // `x` is external and nothing reaches it, so no admission rule covers it:
    // `computeGraphScope` shows 3 of the 4 papers (see graphScopeModel's own
    // "counts what the rail prints").
    expect(model.countLine).to.equal("3 of 4 papers");
    expect(model.seedsHeading).to.equal("Seeds · 0");
    expect(model.hiddenLine).to.equal(null);
  });

  it("keeps the tree's order with plain labels, and closes it with the two rows", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: false,
      seeds: [],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    // The indent is the row's padding now (B31), not spaces in the label.
    expect(model.rows.map((row) => row.label)).to.deep.equal([
      "PhD",
      "Reading",
      "Drafts",
      "Teaching",
      "Unfiled",
      "Not in Zotero",
    ]);
    expect(
      model.rows.map((row) => (row.kind === "collection" ? row.depth : null)),
    ).to.deep.equal([0, 1, 1, 0, null, null]);
    const last = model.rows.at(-1);
    expect(last?.kind).to.equal("external");
    expect(last?.state).to.equal("off");
    expect(last?.count).to.equal(1);
  });

  it("carries each folder's own count and its cascade", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    const phd = model.rows[0];
    expect(phd.kind).to.equal("collection");
    if (phd.kind !== "collection") throw new Error("expected a folder row");
    expect(phd.count).to.equal(1);
    expect(phd.cascadeIDs).to.deep.equal([1, 11, 12]);
    expect(phd.depth).to.equal(0);
  });

  it("marks a selected folder and carries its region colour", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
      regions: [11],
      regionColors: new Map([[11, "#123456"]]),
      hops: null,
    });
    const phd = model.rows[0];
    const reading = model.rows[1];
    expect(phd.selected).to.equal(false);
    expect(phd.color).to.equal(null);
    expect(reading.selected).to.equal(true);
    expect(reading.color).to.equal("#123456");
    // Unfiled and Not in Zotero are never regions, whatever is selected.
    const unfiled = model.rows.find((row) => row.kind === "unfiled")!;
    expect(unfiled.selected).to.equal(false);
    expect(unfiled.color).to.equal(null);
  });

  it("draws a parent mixed when a descendant disagrees", function () {
    const ticks = setCollectionTicks(allCollectionsTicked(), [11], false);
    const model = buildScopeRailModel({
      collections: TREE,
      ticks,
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    expect(model.rows[0].state).to.equal("mixed");
    expect(model.rows[1].state).to.equal("off");
    expect(model.rows[3].state).to.equal("on");
  });

  it("reads Unfiled and the folder rows off the none base", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: onlyCollectionsTicked([2]),
      includeUnfiled: false,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    expect(model.rows[0].state).to.equal("off");
    expect(model.rows[3].state).to.equal("on");
    const unfiled = model.rows.find((row) => row.kind === "unfiled");
    expect(unfiled?.state).to.equal("off");
    expect(unfiled?.count).to.equal(1);
  });

  it("shows the hidden line only when something is hidden", function () {
    const scope = computeGraphScope({
      papers: [
        { key: "a", collectionIDs: [1], inLibrary: true },
        { key: "b", collectionIDs: [1], inLibrary: true },
      ],
      seedKeys: new Set(),
      hops: noHops(),
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      hiddenKeys: new Set(["b"]),
      facetAdmits: () => true,
    });
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope,
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    expect(model.hiddenLine).to.equal("1 hidden");
    expect(model.countLine).to.equal("1 of 2 papers");
  });

  it("names a seed by its first author and year", function () {
    expect(
      seedRowLabel({ authors: ["Ada Lovelace"], year: 1843, title: "Notes" }),
    ).to.equal("Lovelace (1843)");
    expect(seedRowLabel({ authors: [], year: 2020, title: "Notes" })).to.equal(
      "Notes (2020)",
    );
    expect(seedRowLabel({ authors: [], year: null, title: "Notes" })).to.equal(
      "Notes",
    );
  });

  it("passes the seeds through in order with their heading", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [
        { key: "s1", label: "Lovelace (1843)", color: "#111111" },
        { key: "s2", label: "Turing (1936)", color: "#222222" },
      ],
      scope: emptyScope(),
      regions: [],
      regionColors: new Map(),
      hops: null,
    });
    expect(model.seedsHeading).to.equal("Seeds · 2");
    expect(model.seeds.map((seed) => seed.key)).to.deep.equal(["s1", "s2"]);
  });
});

describe("selecting folders for regions", function () {
  it("adds a folder, oldest first", function () {
    expect(nextRegionSelection([4], 9)).to.deep.equal([4, 9]);
  });

  it("toggles a selected folder off", function () {
    expect(nextRegionSelection([4, 9], 4)).to.deep.equal([9]);
  });

  it("keeps every earlier selection: there is no cap (F14)", function () {
    expect(nextRegionSelection([1, 2, 3, 4], 5)).to.deep.equal([1, 2, 3, 4, 5]);
  });
});

describe("regions whose folder was deleted", function () {
  // B23: a saved graph's `regions` can name a collection the library no
  // longer has. It got no row (so no checkbox to untick it with), drew an
  // empty region and, while the four-folder cap existed, held one of its
  // slots until a fifth pick evicted it. It is dropped the moment the
  // library no longer has it, the way an unticked folder is.
  it("drops an ID the library no longer has", function () {
    expect(regionsStillInLibrary([1, 99, 2], TREE)).to.deep.equal([1, 2]);
  });

  it("keeps the order of the ones that remain", function () {
    expect(regionsStillInLibrary([2, 11, 1], TREE)).to.deep.equal([2, 11, 1]);
  });

  it("frees the slot the deleted folder held", function () {
    const pruned = regionsStillInLibrary([1, 99, 2, 11], TREE);
    expect(nextRegionSelection(pruned, 12)).to.deep.equal([1, 2, 11, 12]);
  });
});

describe("scopeSquare", function () {
  // The square is the checkbox's face (B31): its fill is the row's state,
  // and a region's swatch wins over the accent because the row is already
  // on the selected fill and the square is what tells two regions apart.
  function rows(regions: number[], untick: number[] = []) {
    return buildScopeRailModel({
      collections: TREE,
      ticks: setCollectionTicks(allCollectionsTicked(), untick, false),
      includeUnfiled: true,
      includeExternal: false,
      seeds: [],
      scope: emptyScope(),
      regions,
      regionColors: new Map(regions.map((id) => [id, "#abcdef"])),
      hops: null,
    }).rows;
  }

  it("is empty for an unticked folder", function () {
    expect(scopeSquare(rows([], [2])[3])).to.deep.equal({
      fill: "off",
      dash: false,
    });
  });

  it("is the accent for a ticked folder", function () {
    expect(scopeSquare(rows([])[3])).to.deep.equal({
      fill: "on",
      dash: false,
    });
  });

  it("is grey with a dash for a mixed parent", function () {
    expect(scopeSquare(rows([], [11])[0])).to.deep.equal({
      fill: "mixed",
      dash: true,
    });
  });

  it("takes the region swatch for a selected folder", function () {
    expect(scopeSquare(rows([2])[3])).to.deep.equal({
      fill: "region",
      dash: false,
    });
  });

  it("keeps the dash on a selected parent that is partly shown", function () {
    expect(scopeSquare(rows([1], [11])[0])).to.deep.equal({
      fill: "region",
      dash: true,
    });
  });

  it("only ever shows empty or the accent for Unfiled and Not in Zotero", function () {
    const model = rows([]);
    expect(scopeSquare(model[4])).to.deep.equal({ fill: "on", dash: false });
    expect(scopeSquare(model[5])).to.deep.equal({ fill: "off", dash: false });
  });
});

import type { ScopeHopsInput } from "../../src/services/graphScopeRailModel";

// Mirrors COUNT_FORMAT in graphScopeRailModel.ts: the grouping separator is
// locale-dependent (e.g. "1,200" vs "1'200"), so assertions derive the digits
// from the same formatter instead of hard-coding a comma.
function count(n: number): string {
  return new Intl.NumberFormat(undefined, { useGrouping: true }).format(n);
}

function hopsInput(overrides: Partial<ScopeHopsInput> = {}): ScopeHopsInput {
  return {
    direction: "cited-by",
    depth: 2,
    enabled: [true, true, true, true, true, true, true],
    shownByHop: [1, 4, 9],
    availableByHop: [1, 5, 12],
    reportedByHop: [null, 1200, null],
    colours: null,
    fill: null,
    ...overrides,
  };
}

function railWithHops(hops: ScopeHopsInput | null) {
  return buildScopeRailModel({
    collections: TREE,
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    seeds: hops ? [{ key: "s", label: "Seed (2020)", color: "#000" }] : [],
    scope: emptyScope(),
    regions: [],
    regionColors: new Map(),
    hops,
  });
}

describe("the Citation hops block", function () {
  it("is absent on a seedless graph", function () {
    expect(railWithHops(null).hops).to.equal(null);
  });

  it("lists Seeds and Hop 1 to Hop 6 with counts, not fetched, and the button", function () {
    const block = railWithHops(hopsInput())!.hops!;
    expect(block.direction).to.equal("cited-by");
    expect(block.rows.map((row) => row.label)).to.deep.equal([
      "Seeds",
      "Hop 1",
      "Hop 2",
      "Hop 3",
      "Hop 4",
      "Hop 5",
      "Hop 6",
    ]);
    expect(block.rows[0]).to.include({
      count: "1",
      checkbox: false,
      dimmed: false,
      fetchButton: false,
    });
    expect(block.rows[1]).to.include({
      count: "4/5",
      reported: `of ${count(1200)}`,
      checkbox: true,
    });
    expect(block.rows[2]).to.include({ count: "9/12", reported: null });
    expect(block.rows[3]).to.include({
      count: "not fetched",
      fetchButton: true,
      dimmed: true,
      enabled: true,
    });
    expect(block.rows[4]).to.include({
      count: "not fetched",
      fetchButton: false,
      dimmed: true,
    });
  });

  it("dims an unticked hop and carries no button at depth 6", function () {
    const block = railWithHops(
      hopsInput({
        depth: 6,
        enabled: [true, true, false, true, true, true, true],
        shownByHop: [1, 1, 0, 0, 0, 0, 0],
        availableByHop: [1, 1, 1, 0, 0, 0, 0],
        reportedByHop: [null, null, null, null, null, null, null],
      }),
    )!.hops!;
    expect(block.rows[2]).to.include({
      enabled: false,
      dimmed: true,
      count: "0/1",
    });
    expect(block.rows.some((row) => row.fetchButton)).to.equal(false);
  });

  it("takes the hop's category colour only under the Citation hop colouring", function () {
    const neutral = railWithHops(hopsInput())!.hops!;
    expect(neutral.rows[1].swatch).to.equal(null);
    const coloured = railWithHops(
      hopsInput({ colours: ["#111", "#222", "#333"] }),
    )!.hops!;
    expect(coloured.rows[1].swatch).to.equal("#222");
    expect(coloured.rows[5].swatch).to.equal(null);
  });

  it("prints the progress line in its three states under the deepest open hop", function () {
    const running = railWithHops(
      hopsInput({ fill: { remaining: 7, waiting: 0, paused: false } }),
    )!.hops!;
    expect(running.progress).to.deep.equal({
      afterHop: 2,
      text: "expanding · 7 left",
      action: "stop",
      actionLabel: "Stop",
    });
    const paused = railWithHops(
      hopsInput({ fill: { remaining: 7, waiting: 0, paused: true } }),
    )!.hops!;
    expect(paused.progress).to.deep.include({
      action: "resume",
      actionLabel: "Resume",
    });
    const capped = railWithHops(
      hopsInput({ fill: { remaining: 0, waiting: 1800, paused: false } }),
    )!.hops!;
    expect(capped.progress).to.deep.equal({
      afterHop: 2,
      text: `${count(500)} expanded · ${count(1800)} waiting`,
      action: "more",
      actionLabel: "Fetch more",
    });
    expect(railWithHops(hopsInput({ fill: null }))!.hops!.progress).to.equal(
      null,
    );
  });
});
