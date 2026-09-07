import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import type { RelatedWorkMetadata } from "../../src/domain/citationTypes";
import {
  emptyGraphViewState,
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
    const other = JSON.stringify({ ...state, version: 2 });
    expect(parseGraphViewState(other)).to.equal(null);
  });

  it("fills missing optional fields with defaults", function () {
    const sparse = JSON.stringify({ version: 1, seeds: [] });
    expect(parseGraphViewState(sparse)).to.deep.equal(emptyGraphViewState());
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
});
