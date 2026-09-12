import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";
import {
  captureGraphView,
  decodeGraphView,
  encodeGraphView,
  graphViewAvailabilityLine,
  graphViewIsEdited,
  graphViewRequirementLine,
  isShippedViewName,
  planGraphView,
  resolveViewRegions,
  SHIPPED_GRAPH_VIEWS,
  tutorialChips,
  type GraphViewDefinition,
  type GraphViewFilters,
  type ViewFolder,
} from "../../src/services/graphViews";

function node(overrides: Partial<CitationGraphNode>): CitationGraphNode {
  return {
    key: "k",
    itemID: 1,
    itemKey: "K",
    title: "t",
    authors: [],
    year: 2020,
    citationCount: 4,
    referenceCount: 9,
    collectionIDs: [],
    provider: null,
    publicationType: null,
    ...overrides,
  } as CitationGraphNode;
}

const nodes = [node({ key: "a" }), node({ key: "b", citationCount: 40 })];

const folders: ViewFolder[] = [
  {
    collectionID: 1,
    name: "Timber",
    parentCollectionID: null,
    orderIndex: 0,
    ticked: "on",
  },
  {
    collectionID: 2,
    name: "Gridshells",
    parentCollectionID: 1,
    orderIndex: 0,
    ticked: "on",
  },
  {
    collectionID: 3,
    name: "Archive",
    parentCollectionID: null,
    orderIndex: 1,
    ticked: "off",
  },
  {
    collectionID: 4,
    name: "To read",
    parentCollectionID: null,
    orderIndex: 2,
    ticked: "mixed",
  },
  {
    collectionID: 5,
    name: "Old",
    parentCollectionID: 4,
    orderIndex: 0,
    ticked: "on",
  },
  {
    collectionID: 6,
    name: "To read",
    parentCollectionID: null,
    orderIndex: 3,
    ticked: "off",
  },
];

const overview = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "overview")!;
const folderMap = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "folder-map")!;

const liveLayout = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "uniform",
  nodeLabelMode: "author-year",
} as const;

describe("the shipped views", function () {
  it("are five, with unique ids and full appearance records", function () {
    expect(SHIPPED_GRAPH_VIEWS.map((v) => v.id)).to.deep.equal([
      "overview",
      "cornerstones",
      "reading-plan",
      "who-cites-whom",
      "folder-map",
    ]);
    for (const view of SHIPPED_GRAPH_VIEWS) {
      expect(Object.keys(view.appearance).sort(), view.id).to.deep.equal([
        "nodeColorMetric",
        "nodeLabelMode",
        "nodeSizeMetric",
        "xMetric",
        "xScale",
        "yMetric",
        "yScale",
      ]);
      expect(view.explore, view.id).to.equal(null);
    }
  });

  it("names what a greyed view waits on, and what a view needs", function () {
    expect(graphViewAvailabilityLine(overview)).to.equal(null);
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "cornerstones")!,
      ),
    ).to.equal("Arrives with citation hops");
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "reading-plan")!,
      ),
    ).to.equal("Arrives with reading state");
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!,
      ),
    ).to.equal("Arrives with shared citers");
    expect(graphViewRequirementLine(overview)).to.equal(null);
    expect(
      graphViewRequirementLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!,
      ),
    ).to.equal("needs 2 seeds");
    expect(isShippedViewName("overview")).to.equal(true);
    expect(isShippedViewName("Thesis")).to.equal(false);
  });
});

describe("resolveViewRegions", function () {
  it("leaves regions alone for null", function () {
    expect(resolveViewRegions(null, folders)).to.equal(null);
  });

  it("resolves names, skips unknown and unticked ones, counts ambiguous ones", function () {
    const out = resolveViewRegions(
      ["Gridshells", "Nope", "To read", "Archive"],
      folders,
    )!;
    // "To read" is two folders: 4 is mixed (kept), 6 is unticked (skipped);
    // a name counts as unticked only when every match is.
    expect(out.collectionIDs).to.deep.equal([2, 4]);
    expect(out.notFound).to.deep.equal(["Nope"]);
    expect(out.unticked).to.deep.equal(["Archive"]);
    expect(out.ambiguous).to.deep.equal([{ name: "To read", count: 2 }]);
  });

  it('takes the top of each ticked subtree for "ticked", in tree order', function () {
    const out = resolveViewRegions("ticked", folders)!;
    // 1 (on, top) covers 2; 3 and 6 are off; 4 (mixed, top) covers 5.
    expect(out.collectionIDs).to.deep.equal([1, 4]);
    expect(out.notFound).to.deep.equal([]);
  });
});

describe("planGraphView", function () {
  const filters = defaultPaperListFilterState();

  it("applies Overview: appearance whole, regions and filters untouched", function () {
    const plan = planGraphView(overview, {
      nodes,
      layout: { ...liveLayout, xScale: "log" },
      filters: { ...filters, collectionIDs: [9], openAccessOnly: true },
      folders,
    });
    expect(plan.layout).to.deep.equal(overview.appearance);
    expect(plan.regions).to.equal(null);
    expect(plan.filters.openAccessOnly).to.equal(true);
    expect(plan.filters.collectionIDs).to.deep.equal([]);
    expect(plan.substituted).to.deep.equal([]);
  });

  it("reports the fields it had to substitute", function () {
    const plan = planGraphView(overview, {
      nodes: [node({ citationCount: null })],
      layout: liveLayout,
      filters,
      folders,
    });
    expect(plan.substituted).to.include("yMetric");
    expect(plan.substituted).to.include("nodeSizeMetric");
  });

  it("resolves Folder map's regions and never carries collectionIDs", function () {
    const plan = planGraphView(folderMap, {
      nodes,
      layout: liveLayout,
      filters: { ...filters, collectionIDs: [9] },
      folders,
    });
    expect(plan.regions).to.deep.equal([1, 4]);
    expect(plan.filters.collectionIDs).to.deep.equal([]);
  });
});

describe("graphViewIsEdited", function () {
  const filters = defaultPaperListFilterState();
  it("is false right after apply, even with a substituted metric", function () {
    const poor = [node({ citationCount: null })];
    const plan = planGraphView(overview, {
      nodes: poor,
      layout: liveLayout,
      filters,
      folders,
    });
    expect(
      graphViewIsEdited(overview, {
        layout: plan.layout,
        regions: [2],
        filters,
        folders,
        nodes: poor,
      }),
    ).to.equal(false);
  });

  it("is true once an owned field changes, and ignores regions the view does not own", function () {
    expect(
      graphViewIsEdited(overview, {
        layout: { ...overview.appearance, nodeColorMetric: "citations" },
        regions: [],
        filters,
        folders,
        nodes,
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(overview, {
        layout: overview.appearance,
        regions: [1, 2, 3],
        filters,
        folders,
        nodes,
      }),
    ).to.equal(false);
  });

  it("compares owned regions by resolved id", function () {
    const saved: GraphViewDefinition = {
      ...overview,
      id: "user:1",
      regions: ["Gridshells"],
      filters: { ...filters },
    };
    const live = { layout: overview.appearance, filters, folders, nodes };
    expect(graphViewIsEdited(saved, { ...live, regions: [2] })).to.equal(false);
    expect(graphViewIsEdited(saved, { ...live, regions: [] })).to.equal(true);
  });

  it("is edited when an owned filter differs, not when it matches", function () {
    const saved: GraphViewDefinition = {
      ...overview,
      id: "user:2",
      filters: { openAccessOnly: true },
    };
    const live = { layout: overview.appearance, regions: [], folders, nodes };
    expect(
      graphViewIsEdited(saved, {
        ...live,
        filters: defaultPaperListFilterState(),
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(saved, {
        ...live,
        filters: { ...defaultPaperListFilterState(), openAccessOnly: true },
      }),
    ).to.equal(false);
  });

  it("ignores collectionIDs on a filters record even when one is carried on it", function () {
    // A decoded or persisted view is untrusted input and may still carry
    // collectionIDs/relation at runtime even though GraphViewFilters omits
    // them; graphViewIsEdited must skip both rather than diff them.
    const saved: GraphViewDefinition = {
      ...overview,
      id: "user:3",
      filters: {
        openAccessOnly: true,
        collectionIDs: [9],
      } as GraphViewFilters,
    };
    const live = {
      layout: overview.appearance,
      regions: [],
      folders,
      nodes,
      filters: {
        ...defaultPaperListFilterState(),
        openAccessOnly: true,
        collectionIDs: [5],
      },
    };
    expect(graphViewIsEdited(saved, live)).to.equal(false);
  });
});

describe("the wire form", function () {
  it("round-trips a saved view and drops what is not on the wire", function () {
    const saved = captureGraphView({
      name: "Thesis ch. 2 figure",
      paragraph: "Year × references.",
      layout: { ...liveLayout, yMetric: "references" },
      regions: [2],
      filters: {
        ...defaultPaperListFilterState(),
        collectionIDs: [2],
        relation: "related",
      },
      folders,
    });
    expect(saved.id.startsWith("user:")).to.equal(true);
    expect(saved.regions).to.deep.equal(["Gridshells"]);
    const json = encodeGraphView(saved);
    const parsed = JSON.parse(json);
    expect(parsed.meristemaView).to.equal(1);
    expect(parsed).to.not.have.property("id");
    expect(parsed.filters).to.not.have.property("collectionIDs");
    expect(parsed.filters).to.not.have.property("relation");
    const back = decodeGraphView(json);
    expect(back.ok).to.equal(true);
    if (back.ok) {
      expect(back.view.name).to.equal("Thesis ch. 2 figure");
      expect(back.view.appearance).to.deep.equal(saved.appearance);
      expect(back.view.regions).to.deep.equal(["Gridshells"]);
      expect(back.view.id).to.not.equal(saved.id);
      expect(back.view.availability).to.equal("ready");
    }
  });

  it("names the first failing field", function () {
    const good = JSON.parse(
      encodeGraphView(
        captureGraphView({
          name: "n",
          paragraph: "p",
          layout: liveLayout,
          regions: [],
          filters: defaultPaperListFilterState(),
          folders,
        }),
      ),
    );
    const cases: Array<[string, unknown]> = [
      ["meristemaView", { ...good, meristemaView: 2 }],
      ["name", { ...good, name: "" }],
      [
        "appearance.xMetric",
        { ...good, appearance: { ...good.appearance, xMetric: "bogus" } },
      ],
      [
        "appearance.nodeLabelMode",
        { ...good, appearance: { ...good.appearance, nodeLabelMode: 3 } },
      ],
      ["regions", { ...good, regions: "ticked" }],
      ["regions", { ...good, regions: [1] }],
      [
        "filters.collectionIDs",
        { ...good, filters: { ...good.filters, collectionIDs: [1] } },
      ],
      [
        "filters.relation",
        { ...good, filters: { ...good.filters, relation: "all" } },
      ],
      [
        "filters.openAccessOnly",
        { ...good, filters: { ...good.filters, openAccessOnly: "yes" } },
      ],
      [
        "filters.yearMin",
        { ...good, filters: { ...good.filters, yearMin: "1990" } },
      ],
      [
        "filters.__proto__",
        {
          ...good,
          filters: { ...good.filters, ["__proto__"]: { x: 1 } },
        },
      ],
    ];
    for (const [field, value] of cases) {
      const out = decodeGraphView(JSON.stringify(value));
      expect(out.ok, field).to.equal(false);
      if (!out.ok) expect(out.field).to.equal(field);
    }
    expect(decodeGraphView("not json").ok).to.equal(false);
  });
});

describe("tutorialChips", function () {
  it("lists what was applied in the reader's words", function () {
    const plan = planGraphView(folderMap, {
      nodes,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
    });
    const chips = tutorialChips(folderMap, plan, 12);
    expect(chips).to.deep.equal([
      "x free",
      "y free",
      "size references",
      "colour uniform",
      "labels author-year",
      "regions 2 folders",
    ]);
  });

  it("names a substitution and a swatch overflow", function () {
    const poor = [node({ citationCount: null })];
    const plan = planGraphView(overview, {
      nodes: poor,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
    });
    const chips = tutorialChips(overview, plan, 12);
    expect(
      chips.some(
        (c) => c.startsWith("y ") && c.endsWith("(no citations data)"),
      ),
    ).to.equal(true);
    const many = planGraphView(folderMap, {
      nodes,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
    });
    expect(
      tutorialChips(
        folderMap,
        { ...many, regions: Array.from({ length: 14 }, (_, i) => i + 1) },
        12,
      ),
    ).to.include("14 regions, 12 colours");
  });
});
