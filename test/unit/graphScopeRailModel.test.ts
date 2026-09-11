import { describe, it } from "node:test";
import { expect } from "chai";
import type { LibraryCollectionFilter } from "../../src/domain/types";
import {
  allCollectionsTicked,
  computeGraphScope,
  onlyCollectionsTicked,
  setCollectionTicks,
  type GraphScopeResult,
} from "../../src/services/graphScopeModel";
import {
  buildScopeRailModel,
  nextRegionSelection,
  regionsStillInLibrary,
  seedRowLabel,
  scopeSquare,
} from "../../src/services/graphScopeRailModel";

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
    reachedKeys: new Set(),
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
      reachedKeys: new Set(),
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
