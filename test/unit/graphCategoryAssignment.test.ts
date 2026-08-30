import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  GRAPH_ASSIGNED_CATEGORY_LIMIT,
  graphThemeCustomProperties,
  graphThemeFor,
} from "../../src/services/graphTheme";
import { assignCategories } from "../../src/services/graphCategoryAssignment";

function node(
  key: string,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  return {
    key,
    collectionIDs: [],
    provider: null,
    publicationType: null,
    isOpenAccess: null,
    isRetracted: null,
    ...overrides,
  } as unknown as CitationGraphNode;
}

const LIGHT = graphThemeFor("light");
const DARK = graphThemeFor("dark");

describe("Graph theme tokens", function () {
  it("resolves a complete token set for each scheme", function () {
    for (const theme of [LIGHT, DARK]) {
      expect(theme.ramp).to.have.lengthOf(5);
      expect(theme.categorical.swatches).to.have.lengthOf(8);
      for (const value of [
        ...theme.ramp,
        ...theme.categorical.swatches,
        theme.categorical.other,
        theme.categorical.noValue,
        theme.surfaces.panel,
        theme.surfaces.paper,
        theme.surfaces.hairline,
        theme.surfaces.grid,
        theme.inks.primary,
        theme.inks.muted,
        theme.inks.emphasis,
        theme.edges.outgoing,
        theme.edges.incoming,
        theme.states.selected,
        theme.states.seed,
        theme.states.searchMatch,
        theme.states.retracted,
      ]) {
        expect(value, `${theme.scheme} token`).to.match(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("exposes the same custom properties in both schemes", function () {
    const names = (theme: typeof LIGHT): string[] =>
      graphThemeCustomProperties(theme)
        .map(([property]) => property)
        .sort();
    expect(names(LIGHT)).to.deep.equal(names(DARK));
  });

  it("keeps the two schemes distinguishable", function () {
    expect(LIGHT.surfaces.paper).to.not.equal(DARK.surfaces.paper);
    expect(LIGHT.inks.primary).to.not.equal(DARK.inks.primary);
  });
});

describe("Rank-based category assignment", function () {
  // Publication type is a free-text category, so it can carry more distinct
  // values than there are swatches — which is the case the cap exists for.
  const nodes = [
    ...Array.from({ length: 5 }, (_, i) =>
      node(`a${i}`, { publicationType: "article" }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      node(`b${i}`, { publicationType: "book" }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      node(`c${i}`, { publicationType: "chapter" }),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      node(`d${i}`, { publicationType: "dataset" }),
    ),
    node("e0", { publicationType: "editorial" }),
    node("f0", { publicationType: "preprint" }),
    node("g0", { publicationType: "thesis" }),
    node("h0"),
  ];

  it("orders categories by node count and caps the assigned swatches", function () {
    const assignment = assignCategories(nodes, "publication-type", LIGHT);
    expect(assignment.entries.map((entry) => entry.key)).to.deep.equal([
      "article",
      "book",
      "chapter",
      "dataset",
      "editorial",
    ]);
    expect(assignment.entries).to.have.lengthOf(GRAPH_ASSIGNED_CATEGORY_LIMIT);
    expect(assignment.entries.map((entry) => entry.color)).to.deep.equal(
      LIGHT.categorical.swatches.slice(0, GRAPH_ASSIGNED_CATEGORY_LIMIT),
    );
  });

  it("breaks count ties by label so assignment is deterministic", function () {
    const shuffled = [...nodes].reverse();
    const first = assignCategories(nodes, "publication-type", LIGHT);
    const second = assignCategories(shuffled, "publication-type", LIGHT);
    expect(second.entries.map((entry) => entry.key)).to.deep.equal(
      first.entries.map((entry) => entry.key),
    );
  });

  it("collapses everything past the limit into one Other entry", function () {
    const assignment = assignCategories(nodes, "publication-type", LIGHT);
    expect(assignment.other?.count).to.equal(2);
    expect(assignment.other?.color).to.equal(LIGHT.categorical.other);
  });

  it("gives a node with no value the no-value token, never a swatch", function () {
    const assignment = assignCategories(nodes, "publication-type", LIGHT);
    expect(assignment.noValue?.count).to.equal(1);
    expect(assignment.noValue?.color).to.equal(LIGHT.categorical.noValue);
    expect(assignment.colorsFor(node("h0"))).to.deep.equal([
      LIGHT.categorical.noValue,
    ]);
  });

  it("accounts for every node exactly once", function () {
    const assignment = assignCategories(nodes, "publication-type", LIGHT);
    const counted =
      assignment.entries.reduce((sum, entry) => sum + entry.count, 0) +
      (assignment.other?.count ?? 0) +
      (assignment.noValue?.count ?? 0);
    expect(counted).to.equal(nodes.length);
  });

  it("splits a node across its collections, largest slice first", function () {
    const collections = [
      node("x", { collectionIDs: [1, 2] }),
      node("y", { collectionIDs: [1] }),
      node("z", { collectionIDs: [2] }),
      node("w", { collectionIDs: [1] }),
    ];
    const assignment = assignCategories(collections, "collection", LIGHT, {
      labelFor: (id) => `Folder ${id}`,
    });
    expect(assignment.entries.map((entry) => entry.label)).to.deep.equal([
      "Folder 1",
      "Folder 2",
    ]);
    expect(assignment.colorsFor(collections[0])).to.deep.equal([
      LIGHT.categorical.swatches[0],
      LIGHT.categorical.swatches[1],
    ]);
  });

  it("draws at most four slices on a heavily filed paper", function () {
    const heavy = node("x", { collectionIDs: [1, 2, 3, 4, 5, 6] });
    const assignment = assignCategories([heavy], "collection", LIGHT, {
      labelFor: (id) => `Folder ${id}`,
    });
    expect(assignment.colorsFor(heavy)).to.have.lengthOf(4);
  });

  it("uses the scheme's own swatches", function () {
    const assignment = assignCategories(nodes, "publication-type", DARK);
    expect(assignment.entries[0].color).to.equal(DARK.categorical.swatches[0]);
  });
});
