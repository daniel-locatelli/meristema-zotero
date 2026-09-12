import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  buildGraphHopModel,
  clampHopDepth,
  hopByKey,
  reachedFromSeed,
  type HopNeighbourLookup,
  type HopNeighbourhood,
} from "../../src/services/graphHopModel";

function node(
  key: string,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  return {
    key,
    itemID: overrides.kind === "external" ? 0 : 1,
    itemKey: key,
    kind: "local",
    focusRole: null,
    externalWork: null,
    title: key,
    authors: [],
    year: null,
    citationCount: null,
    referenceCount: null,
    references: [],
    tags: [],
    collectionIDs: [],
    ...overrides,
  } as unknown as CitationGraphNode;
}

/** `lists[key]` is the paper's stored list; a missing key is "not expanded". */
function lookup(
  lists: Record<string, string[]>,
  nodes: Record<string, CitationGraphNode> = {},
): HopNeighbourLookup {
  return (key): HopNeighbourhood => {
    const list = lists[key];
    if (!list) return { expanded: false, neighbours: [] };
    return {
      expanded: true,
      neighbours: list.map((k) => ({
        node: nodes[k] ?? node(k, { kind: "external", itemID: 0 }),
        provenance: "openalex",
      })),
    };
  };
}

describe("buildGraphHopModel", function () {
  it("gives a seed with two citers two hop-1 entries", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a", "b"] }),
    })!;
    expect(model.entries.get("a")).to.deep.include({ hop: 1, parents: ["s"] });
    expect(model.entries.get("b")).to.deep.include({ hop: 1, parents: ["s"] });
    expect(model.entries.get("s")).to.deep.include({ hop: 0, expanded: true });
    expect(model.availableByHop).to.deep.equal([1, 2]);
  });

  it("gives a paper cited by two hop-1 papers two parents and hop 2", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a", "b"], a: ["c"], b: ["c"] }),
    })!;
    expect(model.entries.get("c")).to.deep.include({ hop: 2 });
    expect([...model.entries.get("c")!.parents].sort()).to.deep.equal([
      "a",
      "b",
    ]);
  });

  it("sits a paper reachable at hops 1 and 3 at hop 1", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 3,
      neighbours: lookup({ s: ["a", "x"], a: ["b"], b: ["x"] }),
    })!;
    expect(model.entries.get("x")!.hop).to.equal(1);
    expect([...model.entries.get("x")!.parents].sort()).to.deep.equal([
      "b",
      "s",
    ]);
  });

  it("keeps a seed reached from another seed at hop 0", function () {
    const model = buildGraphHopModel({
      seeds: [node("s"), node("t")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["t"], t: [] }),
    })!;
    expect(model.entries.get("t")!.hop).to.equal(0);
    // The seed-to-seed link is still an edge: t cites s.
    expect(
      model.edges.map((edge) => `${edge.source}>${edge.target}`),
    ).to.include("t>s");
  });

  it("stops at the depth and marks what is not expanded", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"], a: ["b"] }),
    })!;
    expect(model.entries.has("b")).to.equal(false);
    expect(model.entries.get("a")!.expanded).to.equal(true);
    const unexpanded = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(unexpanded.entries.get("a")!.expanded).to.equal(false);
    expect(unexpanded.availableByHop).to.deep.equal([1, 1, 0]);
  });

  it("runs the edges the other way under references", function () {
    const cited = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(cited.edges[0]).to.include({ source: "a", target: "s" });
    const refs = buildGraphHopModel({
      seeds: [node("s")],
      direction: "references",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(refs.edges[0]).to.include({ source: "s", target: "a" });
  });

  it("emits an external neighbour as an external node stamped with its hop", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    const a = model.nodes.find((n) => n.key === "a")!;
    expect(a.kind).to.equal("external");
    expect(a.hop).to.equal(1);
    expect(a.focusRole).to.equal("cited-by");
    expect(model.externalKeys.has("a")).to.equal(true);
    expect(model.externalKeys.has("s")).to.equal(false);
  });

  it("treats a stored empty list as expanded", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"], a: [] }),
    })!;
    expect(model.entries.get("a")!.expanded).to.equal(true);
  });

  it("returns null without seeds and clamps the depth", function () {
    expect(
      buildGraphHopModel({
        seeds: [],
        direction: "cited-by",
        depth: 1,
        neighbours: lookup({}),
      }),
    ).to.equal(null);
    expect(clampHopDepth(0)).to.equal(1);
    expect(clampHopDepth(9)).to.equal(6);
    expect(clampHopDepth("x")).to.equal(1);
    expect(clampHopDepth(3.7)).to.equal(3);
  });

  it("answers hopByKey and reachedFromSeed from the entries", function () {
    const model = buildGraphHopModel({
      seeds: [node("s"), node("t")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"], t: ["b"], a: ["c"], b: [] }),
    })!;
    expect(hopByKey(model).get("c")).to.equal(2);
    expect(hopByKey(model).get("s")).to.equal(0);
    expect([...reachedFromSeed(model, "s")].sort()).to.deep.equal(["a", "c"]);
    expect([...reachedFromSeed(model, "t")]).to.deep.equal(["b"]);
  });

  it("assigns the seed-relative citation sequence, the seeded graph's default X axis", function () {
    // The projection was the only caller of assignFocusCitationSequence; the
    // model takes that over. Citers sit after the seed, references before it.
    const citers = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(citers.nodes.find((n) => n.key === "s")!.citationSequence).to.equal(
      0,
    );
    expect(
      citers.nodes.find((n) => n.key === "a")!.citationSequence,
    ).to.be.greaterThan(0);
    const refs = buildGraphHopModel({
      seeds: [node("s")],
      direction: "references",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(
      refs.nodes.find((n) => n.key === "a")!.citationSequence,
    ).to.be.lessThan(0);
    expect(refs.nodes.find((n) => n.key === "a")!.focusRole).to.equal(
      "reference",
    );
  });

  it("expands a promoted focus candidate by its key, not its itemKey", function () {
    // synchronizeExternalFocusNode (graphFocusService.ts, ~line 204) rewrites
    // itemKey on promotion but never key. The stored citation list is keyed
    // by node.key, so the lookup must be asked with "focus:candidate:1" even
    // though itemKey now points at the resolved item.
    const seedKey = "focus:candidate:1";
    const seed = node(seedKey, { itemKey: "resolved-item-key" });
    const receivedKeys: string[] = [];
    const model = buildGraphHopModel({
      seeds: [seed],
      direction: "cited-by",
      depth: 1,
      neighbours: (key, direction) => {
        receivedKeys.push(key);
        return lookup({ [seedKey]: ["a"] })(key, direction);
      },
    })!;
    expect(receivedKeys).to.include(seedKey);
    expect(receivedKeys).to.not.include("resolved-item-key");
    expect(model.entries.get("a")).to.deep.include({
      hop: 1,
      parents: [seedKey],
    });
  });
});
