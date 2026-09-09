import { describe, it } from "node:test";
import { expect } from "chai";

import { buildKeyModel } from "../../src/services/graphKeyModel";
import { assignCategories } from "../../src/services/graphCategoryAssignment";
import { emptySwatchLedger } from "../../src/services/graphSwatchLedger";
import { graphThemeFor } from "../../src/services/graphTheme";
import type {
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
import type { KeyStates } from "../../src/services/graphKeyModel";

const theme = graphThemeFor("light");

function node(
  index: number,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  return {
    key: `k${index}`,
    itemID: index,
    itemKey: `K${index}`,
    title: `Paper ${index}`,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: 2000 + index,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: index,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: null,
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: null,
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: false,
    metricStatus: null,
    fwci: null,
    citationPercentile: null,
    isTop1Percent: null,
    isTop10Percent: null,
    citationsLastYear: null,
    citationVelocity: null,
    citationAcceleration: null,
    influentialCitationCount: null,
    isRetracted: null,
    openAccessStatus: null,
    isOpenAccess: null,
    publicationType: null,
    sourceMetrics: null,
    metadataCompleteness: 1,
    incomingLibraryCitations: 0,
    outgoingLibraryReferences: 0,
    libraryCoverage: null,
    localGlobalImpactRatio: null,
    isIsolated: false,
    referenceAgeMean: null,
    referenceAgeSpread: null,
    selfCitationEstimate: null,
    futureReferenceCount: null,
    references: [],
    ...overrides,
  };
}

const LAYOUT: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "uniform",
  // "collection" is retired as a colour metric (Task 3/7: folder membership
  // draws a region now, never a node's fill), so the categorical cases below
  // exercise a metric that still splits nodes into categories.
  nodeColorMetric: "publication-type",
  nodeLabelMode: "author-year",
};

const QUIET: KeyStates = {
  selectedKey: null,
  seedKeys: new Set<string>(),
  searchMatches: null,
  visibleKeys: null,
};

function build(
  nodes: CitationGraphNode[],
  layout: Partial<GraphLayoutOptions> = {},
  states: Partial<KeyStates> = {},
  edgeCount = 4,
) {
  const merged = { ...LAYOUT, ...layout };
  const assignment = assignCategories(nodes, merged.nodeColorMetric, theme, {
    ledger: emptySwatchLedger(),
  });
  return buildKeyModel({
    layout: merged,
    assignment,
    nodes,
    theme,
    edgeCount,
    states: { ...QUIET, ...states },
  });
}

function section(model: ReturnType<typeof build>, kind: string) {
  return model.sections.find((candidate) => candidate.kind === kind);
}

describe("Graph key model", () => {
  it("names every colour on screen, with the counts they cover", () => {
    // The complaint the whole redesign answers: a graph coloured by folder said
    // nothing about which folder was which. Publication type stands in for
    // that here, since folder membership no longer colours a node at all.
    const nodes = [
      node(1, { publicationType: "article" }),
      node(2, { publicationType: "article" }),
      node(3, { publicationType: "book" }),
    ];
    const colour = section(build(nodes), "color")!;
    expect(colour.subheading).to.equal("Publication type");
    expect(colour.entries.map((entry) => entry.label)).to.deep.equal([
      "article",
      "book",
    ]);
    expect(colour.entries.map((entry) => entry.count)).to.deep.equal([2, 1]);
    expect(colour.entries[0]!.mark.colors[0]).to.equal(
      theme.categorical.swatches[0],
    );
  });

  it("counts a categorical section up to the node count", () => {
    const nodes = [
      node(1, { publicationType: "article" }),
      node(2, { publicationType: "book" }),
      node(3, {}),
    ];
    const colour = section(build(nodes), "color")!;
    const total = colour.entries.reduce(
      (sum, entry) => sum + (entry.count ?? 0),
      0,
    );
    expect(total, "every node is accounted for exactly once").to.equal(
      nodes.length,
    );
    expect(colour.entries.at(-1)!.label).to.equal("No value");
  });

  it("describes a numeric colour metric as a ramp over the visible domain", () => {
    const nodes = [
      node(1, { citationCount: 3 }),
      node(2, { citationCount: 41 }),
      node(3, { citationCount: null }),
    ];
    const colour = section(
      build(nodes, { nodeColorMetric: "citations" }),
      "color",
    )!;
    const ramp = colour.entries[0]!;
    expect(ramp.mark.kind).to.equal("ramp");
    expect(ramp.mark.colors).to.deep.equal([...theme.ramp]);
    // The section's subheading names the metric, so the row carries the range.
    expect(ramp.label, "the ends of what is on screen").to.equal("3 – 41");
    expect(ramp.detail).to.equal(null);
    expect(ramp.count).to.equal(2);
    // A missing value is never a point on the ramp.
    expect(colour.entries[1]!.label).to.equal("No value");
    expect(colour.entries[1]!.count).to.equal(1);
  });

  it("leaves out the sections whose encoding is not in use", () => {
    const model = build([node(1)], { nodeSizeMetric: "uniform" }, {}, 0);
    expect(model.sections.map((entry) => entry.kind)).to.deep.equal(["color"]);
  });

  it("drops a colour with nothing left under it", () => {
    // The assignment is made across the whole graph so swatches do not shuffle,
    // but a Key that lists a folder no longer on screen names a colour that
    // is not there.
    const all = [
      node(1, { publicationType: "article" }),
      node(2, { publicationType: "book" }),
    ];
    const assignment = assignCategories(all, "publication-type", theme, {
      ledger: emptySwatchLedger(),
    });
    const model = buildKeyModel({
      layout: LAYOUT,
      assignment,
      nodes: [all[0]!],
      theme,
      edgeCount: 0,
      states: QUIET,
    });
    const colour = section(model, "color")!;
    expect(colour.entries.map((entry) => entry.label)).to.deep.equal([
      "article",
    ]);
    expect(colour.entries[0]!.mark.colors[0]).to.equal(
      theme.categorical.swatches[0],
      "and it keeps the swatch it had across the whole graph",
    );
  });

  it("describes size only when a metric drives it", () => {
    const nodes = [
      node(1, { citationCount: 2 }),
      node(2, { citationCount: 90 }),
    ];
    const sized = section(
      build(nodes, { nodeSizeMetric: "citations" }),
      "size",
    )!;
    expect(sized.subheading).to.equal("Citations");
    expect(sized.entries[0]!.mark.kind).to.equal("circles");
    expect(sized.entries[0]!.label).to.equal("2 – 90");
  });

  it("names the link colours whenever there are links to name", () => {
    const links = section(build([node(1)], {}, {}, 12), "links")!;
    expect(links.entries.map((entry) => entry.label)).to.deep.equal([
      "Link",
      "Reference",
      "Cited by",
    ]);
    expect(links.entries[1]!.mark.colors[0]).to.equal(theme.edges.outgoing);
    expect(links.entries[2]!.mark.colors[0]).to.equal(theme.edges.incoming);
  });

  it("lists only the states actually on screen", () => {
    const nodes = [
      node(1, { isRetracted: true }),
      node(2),
      node(3, { year: null }),
    ];
    const states = section(
      build(
        nodes,
        {},
        { selectedKey: "k2", visibleKeys: new Set(["k1", "k2"]) },
      ),
      "states",
    )!;
    expect(states.entries.map((entry) => entry.label)).to.deep.equal([
      "Selected",
      "Retracted",
      "Filtered out",
      "No data",
    ]);
  });

  it("has no states section when the graph is quiet", () => {
    const model = build([node(1)], {}, {});
    expect(section(model, "states")).to.equal(undefined);
  });

  it("matches the nodes an entry stands for, so hovering can emphasise them", () => {
    const nodes = [
      node(1, { publicationType: "article" }),
      node(2, { publicationType: "article" }),
      node(3, {}),
    ];
    const colour = section(build(nodes), "color")!;
    const article = colour.entries.find((entry) => entry.label === "article")!;
    expect(
      nodes.filter((candidate) => article.matches!(candidate)),
    ).to.have.length(2);
    const missing = colour.entries.find((entry) => entry.label === "No value")!;
    expect(
      nodes.filter((candidate) => missing.matches!(candidate)),
    ).to.have.length(1);
  });

  // Categories used to be multi-valued to serve folder membership, where a
  // paper filed in two folders was drawn as a disc split between their
  // colours ("says when a disc is split, and only when one is"). Folder
  // membership has left the node's fill entirely (Task 7's region fill and
  // Task 3's contours took the job), so a node now carries at most one
  // category under any metric and a disc can never be split. There is no
  // longer an input that produces the old split note; this replaces that
  // case with the guarantee that the note is always absent.
  it("never notes a split disc, since a node carries one category now", () => {
    const colour = section(
      build([node(1, { publicationType: "article" })]),
      "color",
    )!;
    expect(colour.note).to.equal(null);
  });

  it("emphasises nothing for an entry that stands for no set of nodes", () => {
    // A ramp and a link colour describe how the graph is drawn, not a group of
    // papers; hovering them must not dim four fifths of the plot.
    const links = section(build([node(1)], {}, {}, 3), "links")!;
    expect(links.entries.every((entry) => entry.matches === null)).to.equal(
      true,
    );
    const sized = section(
      build([node(1), node(2)], { nodeSizeMetric: "citations" }),
      "size",
    )!;
    expect(sized.entries[0]!.matches).to.equal(null);
  });
});
