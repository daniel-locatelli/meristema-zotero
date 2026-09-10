import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import type { RelatedWorkMetadata } from "../../src/domain/citationTypes";
import {
  emptyGraphViewState,
  GRAPH_VIEW_STATE_VERSION,
  MAX_GRAPH_REGIONS,
  markExternalSeedImported,
  parseGraphViewState,
  resolveGraphViewSeeds,
  seedFromNode,
  serializeGraphViewState,
  type GraphViewState,
} from "../../src/services/graphViewState";

function work(
  overrides: Partial<RelatedWorkMetadata> = {},
): RelatedWorkMetadata {
  return {
    provider: "openalex",
    providerWorkID: null,
    doi: "10.1000/seed",
    title: "An external seed",
    year: 2020,
    authors: ["Ada Lovelace"],
    ...overrides,
  };
}

function localNode(itemID: number, itemKey: string): CitationGraphNode {
  return {
    key: `item:${itemID}`,
    itemID,
    itemKey,
    title: `Paper ${itemKey}`,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: 2021,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
  } as unknown as CitationGraphNode;
}

describe("seedFromNode", function () {
  it("stores a library paper by its Zotero key", function () {
    expect(seedFromNode(localNode(7, "ABCD1234"))).to.deep.equal({
      kind: "item",
      itemKey: "ABCD1234",
    });
  });

  it("stores an external paper by its stable identity with the work inline", function () {
    const node = {
      ...localNode(0, "focus:doi:10.1000/seed"),
      kind: "external",
      externalWork: work(),
    } as unknown as CitationGraphNode;
    const seed = seedFromNode(node);
    expect(seed?.kind).to.equal("external");
    if (seed?.kind !== "external") return;
    expect(seed.identityKey).to.equal("doi:10.1000/seed");
    expect(seed.work.title).to.equal("An external seed");
  });

  it("drops an external paper with no stable identity", function () {
    const node = {
      ...localNode(0, "focus:candidate"),
      kind: "external",
      externalWork: work({ doi: null, title: "Only a title" }),
    } as unknown as CitationGraphNode;
    expect(seedFromNode(node)).to.equal(null);
  });
});

describe("resolveGraphViewSeeds", function () {
  it("resolves item seeds through the library and keeps their order", function () {
    const library = new Map([
      ["AAAA0001", localNode(1, "AAAA0001")],
      ["BBBB0002", localNode(2, "BBBB0002")],
    ]);
    const result = resolveGraphViewSeeds(
      [
        { kind: "item", itemKey: "BBBB0002" },
        { kind: "item", itemKey: "AAAA0001" },
      ],
      { nodeForItemKey: (itemKey) => library.get(itemKey) ?? null },
    );
    expect(result.dropped).to.equal(0);
    expect(result.nodes.map((node) => node.itemID)).to.deep.equal([2, 1]);
  });

  it("drops a seed whose item is gone and counts it", function () {
    const result = resolveGraphViewSeeds(
      [
        { kind: "item", itemKey: "GONE0000" },
        { kind: "item", itemKey: "AAAA0001" },
      ],
      {
        nodeForItemKey: (itemKey) =>
          itemKey === "AAAA0001" ? localNode(1, itemKey) : null,
      },
    );
    expect(result.dropped).to.equal(1);
    expect(result.nodes.map((node) => node.itemKey)).to.deep.equal([
      "AAAA0001",
    ]);
  });

  it("builds an external seed node from the inline work", function () {
    const result = resolveGraphViewSeeds(
      [{ kind: "external", identityKey: "doi:10.1000/seed", work: work() }],
      { nodeForItemKey: () => null },
    );
    expect(result.dropped).to.equal(0);
    const node = result.nodes[0]!;
    expect(node.kind).to.equal("external");
    expect(node.itemID).to.equal(0);
    expect(node.title).to.equal("An external seed");
    expect(node.externalWork?.doi).to.equal("10.1000/seed");
  });

  it("resolves an imported external seed to its library item", function () {
    const result = resolveGraphViewSeeds(
      [
        {
          kind: "external",
          identityKey: "doi:10.1000/seed",
          work: work({ inLibraryItemKey: "CCCC0003" }),
        },
      ],
      {
        nodeForItemKey: (itemKey) =>
          itemKey === "CCCC0003" ? localNode(3, itemKey) : null,
      },
    );
    expect(result.dropped).to.equal(0);
    const node = result.nodes[0]!;
    expect(node.itemID).to.equal(3);
    expect(node.itemKey).to.equal("CCCC0003");
  });

  it("resolves an external seed whose DOI now matches a library paper", function () {
    const local = { ...localNode(4, "DDDD0004"), doi: "10.1000/SEED" };
    const result = resolveGraphViewSeeds(
      [{ kind: "external", identityKey: "doi:10.1000/seed", work: work() }],
      {
        nodeForItemKey: () => null,
        nodeForDOI: (doi) => (doi === "10.1000/seed" ? local : null),
      },
    );
    expect(result.dropped).to.equal(0);
    expect(result.nodes[0]!.itemID).to.equal(4);
  });
});

describe("serializeGraphViewState / parseGraphViewState", function () {
  const state: GraphViewState = {
    ...emptyGraphViewState(),
    seeds: [
      { kind: "item", itemKey: "AAAA0001" },
      { kind: "external", identityKey: "doi:10.1000/seed", work: work() },
    ],
    explore: { direction: "references", locality: "local" },
    filters: {
      ...emptyGraphViewState().filters,
      collectionIDs: [3, 4],
      tag: "read",
    },
    camera: { x: 12, y: -4, scale: 1.5 },
    title: "My graph",
    ticksNeedDescendants: false,
  };

  it("round-trips through JSON", function () {
    expect(parseGraphViewState(serializeGraphViewState(state))).to.deep.equal(
      state,
    );
  });

  it("returns null for malformed input without throwing", function () {
    expect(parseGraphViewState("not json")).to.equal(null);
    expect(parseGraphViewState("42")).to.equal(null);
    expect(parseGraphViewState("null")).to.equal(null);
  });

  it("returns null for another version", function () {
    const other = JSON.stringify({ ...state, version: 4 });
    expect(parseGraphViewState(other)).to.equal(null);
  });

  it("fills missing optional fields with defaults", function () {
    const sparse = JSON.stringify({ version: 1, seeds: [] });
    expect(parseGraphViewState(sparse)).to.deep.equal({
      ...emptyGraphViewState(),
      ticksNeedDescendants: false,
    });
  });

  it("drops malformed seeds and unknown Explore values", function () {
    const messy = JSON.stringify({
      version: 1,
      seeds: [
        { kind: "item", itemKey: "AAAA0001" },
        { kind: "item" },
        { kind: "external", identityKey: "x" },
        { kind: "mystery" },
      ],
      explore: { direction: "sideways", locality: "local" },
      filters: { tag: 5, excludeRetracted: true },
      camera: { x: 1, y: "two", scale: 1 },
      title: 9,
    });
    const parsed = parseGraphViewState(messy);
    expect(parsed?.seeds).to.deep.equal([
      { kind: "item", itemKey: "AAAA0001" },
    ]);
    expect(parsed?.explore).to.deep.equal({
      direction: "both",
      locality: "local",
    });
    expect(parsed?.filters.tag).to.equal(null);
    expect(parsed?.filters.excludeRetracted).to.equal(true);
    expect(parsed?.camera).to.equal(null);
    expect(parsed?.title).to.equal(null);
  });

  it("drops an external seed whose inline work is malformed", function () {
    const messy = JSON.stringify({
      version: 1,
      seeds: [
        {
          kind: "external",
          identityKey: "doi:10.1000/bad",
          work: work({ title: 9 as unknown as string }),
        },
        {
          kind: "external",
          identityKey: "doi:10.1000/seed",
          work: work(),
        },
      ],
    });
    const parsed = parseGraphViewState(messy);
    expect(parsed?.seeds).to.deep.equal([
      {
        kind: "external",
        identityKey: "doi:10.1000/seed",
        work: work(),
      },
    ]);
  });

  it("round-trips a version 2 state", function () {
    const state: GraphViewState = {
      ...emptyGraphViewState(),
      collections: { base: "none", except: [4, 7] },
      includeUnfiled: false,
      includeExternal: false,
      hiddenKeys: ["item:9"],
      ticksNeedDescendants: false,
    };
    expect(parseGraphViewState(serializeGraphViewState(state))).to.deep.equal(
      state,
    );
  });

  it("migrates a version 1 recipe with no folder filter to the all base", function () {
    const v1 = JSON.stringify({
      version: 1,
      seeds: [],
      explore: { direction: "both", locality: "all" },
      filters: { collectionIDs: [] },
      camera: null,
      title: null,
    });
    const parsed = parseGraphViewState(v1);
    expect(parsed?.version).to.equal(GRAPH_VIEW_STATE_VERSION);
    expect(parsed?.collections).to.deep.equal({ base: "all", except: [] });
    expect(parsed?.includeUnfiled).to.equal(true);
    expect(parsed?.includeExternal).to.equal(true);
    expect(parsed?.hiddenKeys).to.deep.equal([]);
    // Nothing to expand: the whole library was already ticked.
    expect(parsed?.ticksNeedDescendants).to.equal(false);
  });

  it("migrates a version 1 recipe naming folders to the none base", function () {
    const v1 = JSON.stringify({
      version: 1,
      seeds: [],
      explore: { direction: "both", locality: "all" },
      filters: { collectionIDs: [7, 4] },
      camera: null,
      title: null,
    });
    const parsed = parseGraphViewState(v1);
    expect(parsed?.collections).to.deep.equal({ base: "none", except: [4, 7] });
    // Version 1 drew a scoped parent's whole subtree, so the view expands
    // these once against the library's folder tree.
    expect(parsed?.ticksNeedDescendants).to.equal(true);
    expect(parsed?.filters.collectionIDs).to.deep.equal([]);
  });

  it("keeps the migration flag out of the serialised recipe", function () {
    const state: GraphViewState = {
      ...emptyGraphViewState(),
      ticksNeedDescendants: true,
    };
    expect(serializeGraphViewState(state)).to.not.contain(
      "ticksNeedDescendants",
    );
  });

  it("still returns null for a version it does not know", function () {
    const future = JSON.stringify({ ...emptyGraphViewState(), version: 4 });
    expect(parseGraphViewState(future)).to.equal(null);
  });
});

describe("version 3", function () {
  it("keeps the regions a graph was saved with", function () {
    const state = { ...emptyGraphViewState(), regions: [7, 9] };
    const parsed = parseGraphViewState(JSON.stringify(state));
    expect(parsed?.regions).to.deep.equal([7, 9]);
  });

  it("caps the regions it will accept", function () {
    const state = { ...emptyGraphViewState(), regions: [1, 2, 3, 4, 5, 6] };
    const parsed = parseGraphViewState(JSON.stringify(state));
    expect(parsed?.regions).to.have.length(MAX_GRAPH_REGIONS);
  });

  it("gives a version 2 folder graph its own folders as regions", function () {
    // The colour metric used to default to Collection, so a folder graph drew
    // its folders in colour. It keeps doing so, now as regions.
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "none", except: [12, 4, 30] },
    };
    const parsed = parseGraphViewState(JSON.stringify(legacy));
    expect(parsed?.regions).to.deep.equal([4, 12, 30]);
  });

  it("gives a version 2 whole-library graph no regions", function () {
    // Choosing folders the reader never singled out would be noise.
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "all", except: [] },
    };
    const parsed = parseGraphViewState(JSON.stringify(legacy));
    expect(parsed?.regions).to.deep.equal([]);
  });

  it("caps a version 2 migration at four folders", function () {
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "none", except: [5, 4, 3, 2, 1] },
    };
    const parsed = parseGraphViewState(JSON.stringify(legacy));
    expect(parsed?.regions).to.deep.equal([1, 2, 3, 4]);
  });

  it("gives a version 1 folder graph its own folders as regions", function () {
    // Version 1 is the oldest saved-graph shape: it stored the scoped
    // folders as a filter (`filters.collectionIDs`), not as ticks, so
    // `migrateFromVersion1` has to turn that whitelist into `collections`
    // before `migratedRegions` ever sees it. Both version 1 and version 2
    // fall through to the same `migratedRegions(scope.collections)` call for
    // regions, but only version 2 had coverage for it.
    const v1 = JSON.stringify({
      version: 1,
      seeds: [],
      explore: { direction: "both", locality: "all" },
      filters: { collectionIDs: [30, 4, 12] },
      camera: null,
      title: null,
    });
    const parsed = parseGraphViewState(v1);
    expect(parsed?.collections).to.deep.equal({
      base: "none",
      except: [4, 12, 30],
    });
    expect(parsed?.regions).to.deep.equal([4, 12, 30]);
  });

  it("gives a version 1 whole-library graph no regions", function () {
    const v1 = JSON.stringify({
      version: 1,
      seeds: [],
      explore: { direction: "both", locality: "all" },
      filters: { collectionIDs: [] },
      camera: null,
      title: null,
    });
    const parsed = parseGraphViewState(v1);
    expect(parsed?.collections).to.deep.equal({ base: "all", except: [] });
    expect(parsed?.regions).to.deep.equal([]);
  });

  it("starts a version 2 graph with empty ledgers", function () {
    const legacy = { ...emptyGraphViewState(), version: 2 };
    const parsed = parseGraphViewState(JSON.stringify(legacy));
    expect(parsed?.swatches.assigned).to.deep.equal({});
    expect(parsed?.seedSwatches.assigned).to.deep.equal({});
  });

  it("round-trips the category ledger with the graph", function () {
    // The spec promises the category-to-swatch map is persisted like the seed
    // and folder ledgers. It was not: the ledger lived on the renderer and
    // died with it, so a category that came and went could land on a
    // different swatch after a reopen with nothing in the library changed
    // (B25).
    const state: GraphViewState = {
      ...emptyGraphViewState(),
      categorySwatches: {
        assigned: { article: 3, OpenAlex: 1 },
        releasedOrder: [],
      },
    };
    const parsed = parseGraphViewState(serializeGraphViewState(state));
    expect(parsed?.categorySwatches.assigned).to.deep.equal({
      article: 3,
      OpenAlex: 1,
    });
  });

  it("starts a version 3 graph saved without a category ledger on an empty one", function () {
    const { categorySwatches: _dropped, ...saved } = emptyGraphViewState();
    void _dropped;
    const parsed = parseGraphViewState(JSON.stringify(saved));
    expect(parsed?.categorySwatches.assigned).to.deep.equal({});
  });

  it("degrades an array-shaped assigned ledger to an empty map", function () {
    // A hostile or corrupt record could carry `assigned` as an array. Left
    // unguarded, Object.entries would walk its indices as if they were
    // keys, producing a plausible-looking but nonsensical map.
    const hostile = {
      ...emptyGraphViewState(),
      swatches: { assigned: [1, 2, 3], releasedOrder: [] },
    };
    const parsed = parseGraphViewState(JSON.stringify(hostile));
    expect(parsed?.swatches.assigned).to.deep.equal({});
  });
});

describe("markExternalSeedImported", function () {
  it("gives the matching external seed its library key and leaves the rest alone", function () {
    const seeds = [
      { kind: "item" as const, itemKey: "AAAA1111" },
      {
        kind: "external" as const,
        identityKey: "openalex:W1",
        work: work({ doi: null, providerWorkID: "W1" }),
      },
      {
        kind: "external" as const,
        identityKey: "doi:10.1000/other",
        work: work({ doi: "10.1000/other" }),
      },
    ];
    const marked = markExternalSeedImported(seeds, "openalex:W1", "BBBB2222");
    expect(marked[0]).to.equal(seeds[0]);
    expect(marked[2]).to.equal(seeds[2]);
    expect(marked[1]).to.not.equal(seeds[1]);
    expect(
      marked[1]!.kind === "external" && marked[1]!.work.inLibraryItemKey,
    ).to.equal("BBBB2222");
    expect(
      seeds[1]!.kind === "external" && seeds[1]!.work.inLibraryItemKey,
      "the input is not mutated",
    ).to.equal(undefined);
  });

  it("resolves the marked seed to the library item on the next resolve", function () {
    const seeds = markExternalSeedImported(
      [
        {
          kind: "external",
          identityKey: "openalex:W1",
          work: work({ doi: null, providerWorkID: "W1" }),
        },
      ],
      "openalex:W1",
      "BBBB2222",
    );
    const local = localNode(7, "BBBB2222");
    const { nodes, dropped } = resolveGraphViewSeeds(seeds, {
      nodeForItemKey: (key) => (key === "BBBB2222" ? local : null),
    });
    expect(dropped).to.equal(0);
    expect(nodes).to.deep.equal([local]);
  });
});
