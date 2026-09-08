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
  seedRowLabel,
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
    });
    // `x` is external and nothing reaches it, so no admission rule covers it:
    // `computeGraphScope` shows 3 of the 4 papers (see graphScopeModel's own
    // "counts what the rail prints").
    expect(model.countLine).to.equal("3 of 4 papers");
    expect(model.seedsHeading).to.equal("Seeds · 0");
    expect(model.hiddenLine).to.equal(null);
  });

  it("indents the tree, keeps its order, and closes it with the two rows", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: false,
      seeds: [],
      scope: emptyScope(),
    });
    expect(model.rows.map((row) => row.label)).to.deep.equal([
      "PhD",
      "    Reading",
      "    Drafts",
      "Teaching",
      "Unfiled",
      "Not in Zotero",
    ]);
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
    });
    const phd = model.rows[0];
    expect(phd.kind).to.equal("collection");
    if (phd.kind !== "collection") throw new Error("expected a folder row");
    expect(phd.count).to.equal(1);
    expect(phd.cascadeIDs).to.deep.equal([1, 11, 12]);
    expect(phd.depth).to.equal(0);
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
    });
    expect(model.seedsHeading).to.equal("Seeds · 2");
    expect(model.seeds.map((seed) => seed.key)).to.deep.equal(["s1", "s2"]);
  });
});
