import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";
import {
  captureGraphView,
  decodeGraphView,
  decodeGraphViewRecord,
  encodeGraphView,
  graphViewAvailabilityLine,
  graphViewIsEdited,
  graphViewRequirementLine,
  isShippedViewName,
  planGraphView,
  resolveViewRegions,
  SHIPPED_GRAPH_VIEWS,
  draftParagraph,
  tutorialChips,
  tutorialFootnote,
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

const liveHops = {
  direction: "cited-by" as const,
  depth: 1,
  enabled: [true, true, true, true, true, true, true],
  floor: 0,
};

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
      expect(view.explore, view.id).to.deep.equal(
        view.id === "cornerstones"
          ? { direction: "references", hops: 2, floor: 10 }
          : null,
      );
    }
    const cornerstones = SHIPPED_GRAPH_VIEWS.find(
      (v) => v.id === "cornerstones",
    )!;
    expect(cornerstones.availability).to.equal("ready");
    expect(graphViewAvailabilityLine(cornerstones)).to.equal(null);
  });

  it("names what a greyed view waits on, and what a view needs", function () {
    expect(graphViewAvailabilityLine(overview)).to.equal(null);
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
      hops: liveHops,
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
      hops: liveHops,
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
      hops: liveHops,
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
      hops: liveHops,
    });
    expect(
      graphViewIsEdited(overview, {
        layout: plan.layout,
        regions: [2],
        filters,
        folders,
        nodes: poor,
        hops: liveHops,
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
        hops: liveHops,
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(overview, {
        layout: overview.appearance,
        regions: [1, 2, 3],
        filters,
        folders,
        nodes,
        hops: liveHops,
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
    const live = {
      layout: overview.appearance,
      filters,
      folders,
      nodes,
      hops: liveHops,
    };
    expect(graphViewIsEdited(saved, { ...live, regions: [2] })).to.equal(false);
    expect(graphViewIsEdited(saved, { ...live, regions: [] })).to.equal(true);
  });

  it("is edited when an owned filter differs, not when it matches", function () {
    const saved: GraphViewDefinition = {
      ...overview,
      id: "user:2",
      filters: { openAccessOnly: true },
    };
    const live = {
      layout: overview.appearance,
      regions: [],
      folders,
      nodes,
      hops: liveHops,
    };
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
      hops: liveHops,
      filters: {
        ...defaultPaperListFilterState(),
        openAccessOnly: true,
        collectionIDs: [5],
      },
    };
    expect(graphViewIsEdited(saved, live)).to.equal(false);
  });

  it("is edited when the view's floor differs from the live one, and not when the view has none", function () {
    const cornerstones = SHIPPED_GRAPH_VIEWS.find(
      (v) => v.id === "cornerstones",
    )!;
    expect(cornerstones.explore).to.deep.equal({
      direction: "references",
      hops: 2,
      floor: 10,
    });
    const live = {
      layout: cornerstones.appearance,
      regions: [],
      filters,
      folders,
      nodes,
      hops: {
        ...liveHops,
        direction: "references" as const,
        depth: 2,
        floor: 10,
      },
    };
    expect(graphViewIsEdited(cornerstones, live)).to.equal(false);
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: { ...live.hops, floor: 20 },
      }),
    ).to.equal(true);
    const noFloor: GraphViewDefinition = {
      ...cornerstones,
      id: "user:9",
      explore: { direction: "references", hops: 2 },
    };
    expect(
      graphViewIsEdited(noFloor, {
        ...live,
        hops: { ...live.hops, floor: 20 },
      }),
    ).to.equal(false);
  });

  it("decodes, encodes and captures the floor", function () {
    const record = JSON.parse(
      encodeGraphView({
        ...SHIPPED_GRAPH_VIEWS[0]!,
        explore: { direction: "cited-by", hops: 1, floor: 5 },
      }),
    );
    expect(record.explore).to.deep.equal({
      direction: "cited-by",
      hops: 1,
      floor: 5,
    });
    const decoded = decodeGraphViewRecord(record);
    expect(decoded.ok && decoded.view.explore).to.deep.equal({
      direction: "cited-by",
      hops: 1,
      floor: 5,
    });
    const bad = decodeGraphViewRecord({
      ...record,
      explore: { direction: "cited-by", hops: 1, floor: "many" },
    });
    expect(bad.ok).to.equal(false);
    const captured = captureGraphView({
      name: "Mine",
      paragraph: "",
      layout: SHIPPED_GRAPH_VIEWS[0]!.appearance,
      regions: [],
      filters,
      folders,
      hops: { ...liveHops, floor: 30 },
    });
    expect(captured.explore?.floor).to.equal(30);
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
      hops: liveHops,
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
          hops: liveHops,
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
      hops: liveHops,
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
      hops: liveHops,
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
      hops: liveHops,
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

describe("the missing-value filter chips", function () {
  it("names a hidden missing year on the card and in the draft", function () {
    const view = captureGraphView({
      name: "No missing years",
      paragraph: "",
      layout: liveLayout,
      regions: [],
      filters: { ...defaultPaperListFilterState(), includeMissingYear: false },
      folders,
      hops: liveHops,
    });
    const plan = planGraphView(view, {
      nodes,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
      hops: liveHops,
    });
    expect(tutorialChips(view, plan, 12)).to.include(
      "filter missing year hidden",
    );
    // The two that are still at their default say nothing.
    expect(
      tutorialChips(view, plan, 12).filter((c) => c.startsWith("filter ")),
    ).to.deep.equal(["filter missing year hidden"]);
    expect(
      draftParagraph(liveLayout, 0, view.filters as GraphViewFilters),
    ).to.contain("filter missing year hidden");
  });
});

describe("tutorialFootnote", function () {
  const plan = (
    regionReport: ReturnType<typeof resolveViewRegions>,
  ): Parameters<typeof tutorialFootnote>[0] => ({
    layout: liveLayout,
    regions: [],
    filters: defaultPaperListFilterState(),
    substituted: [],
    regionReport,
  });

  it("says what a view never touches", function () {
    expect(tutorialFootnote(plan(null))).to.equal(
      "Seeds and collections are untouched.",
    );
  });

  it("names folders it could not find, could not show, or found twice", function () {
    expect(
      tutorialFootnote(
        plan({
          collectionIDs: [],
          notFound: ["Ghosts"],
          unticked: [],
          ambiguous: [],
        }),
      ),
    ).to.equal("Seeds and collections are untouched. Not found: Ghosts.");
    expect(
      tutorialFootnote(
        plan({
          collectionIDs: [],
          notFound: [],
          unticked: ["Archive"],
          ambiguous: [],
        }),
      ),
    ).to.equal(
      "Seeds and collections are untouched. Not shown: Archive is unticked.",
    );
    expect(
      tutorialFootnote(
        plan({
          collectionIDs: [],
          notFound: [],
          unticked: ["Archive", "Old"],
          ambiguous: [],
        }),
      ),
    ).to.equal(
      "Seeds and collections are untouched. Not shown: Archive, Old are unticked.",
    );
    expect(
      tutorialFootnote(
        plan({
          collectionIDs: [],
          notFound: [],
          unticked: [],
          ambiguous: [{ name: "To read", count: 2 }],
        }),
      ),
    ).to.equal("Seeds and collections are untouched. To read: 2 folders.");
  });
});

describe("draftParagraph", function () {
  it("reads back the settings, regions and filters included", function () {
    expect(draftParagraph(liveLayout, 2, { openAccessOnly: true })).to.equal(
      "publication year across, citations up; size citations; colour uniform; 2 folders as regions; filter open access. Seeds and collections are untouched.",
    );
  });

  it("drops the regions and the filters when there are none", function () {
    expect(draftParagraph(liveLayout, 0, {})).to.equal(
      "publication year across, citations up; size citations; colour uniform. Seeds and collections are untouched.",
    );
  });
});

describe("explore on a view", function () {
  const cornerstones = SHIPPED_GRAPH_VIEWS.find(
    (v) => v.id === "cornerstones",
  )!;
  const under = {
    direction: "references" as const,
    depth: 2,
    enabled: [true, true, true, true, true, true, true],
    floor: 10,
  };

  it("reads edited when direction, depth or a hop within the depth differs", function () {
    const live = {
      nodes,
      layout: { ...liveLayout, nodeColorMetric: "citations" as const },
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
    };
    expect(graphViewIsEdited(cornerstones, { ...live, hops: under })).to.equal(
      false,
    );
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: { ...under, direction: "cited-by" },
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: { ...under, depth: 3 },
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: {
          ...under,
          enabled: [true, true, false, true, true, true, true],
        },
      }),
    ).to.equal(true);
    // A hop past the view's depth is not the view's claim.
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: {
          ...under,
          enabled: [true, true, true, false, true, true, true],
        },
      }),
    ).to.equal(false);
    // A view without explore ignores the hops entirely.
    expect(
      graphViewIsEdited(overview, {
        ...live,
        layout: liveLayout,
        hops: { ...under, depth: 5 },
      }),
    ).to.equal(false);
  });

  it("captures the live direction and depth, never the toggles", function () {
    const view = captureGraphView({
      name: "Mine",
      paragraph: "",
      layout: liveLayout,
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
      hops: {
        ...under,
        enabled: [true, false, false, false, false, false, false],
      },
    });
    expect(view.explore).to.deep.equal({
      direction: "references",
      hops: 2,
      floor: 10,
    });
  });

  it("round-trips explore on the wire and clamps a bad depth", function () {
    const view = captureGraphView({
      name: "Mine",
      paragraph: "",
      layout: liveLayout,
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
      hops: under,
    });
    const decoded = decodeGraphView(encodeGraphView(view));
    expect(decoded.ok && decoded.view.explore).to.deep.equal({
      direction: "references",
      hops: 2,
      floor: 10,
    });
    const raw = JSON.parse(encodeGraphView(view));
    raw.explore = { direction: "references", hops: 40 };
    const clamped = decodeGraphView(JSON.stringify(raw));
    expect(clamped.ok && clamped.view.explore?.hops).to.equal(6);
    raw.explore = { direction: "both", hops: 2 };
    const bad = decodeGraphView(JSON.stringify(raw));
    expect(bad).to.deep.equal({ ok: false, field: "explore.direction" });
    delete raw.explore;
    const absent = decodeGraphView(JSON.stringify(raw));
    expect(absent.ok && absent.view.explore).to.equal(null);
  });

  it("decodes citation-hop as a colouring", function () {
    const raw = JSON.parse(encodeGraphView(overview));
    raw.appearance.nodeColorMetric = "citation-hop";
    const decoded = decodeGraphView(JSON.stringify(raw));
    expect(decoded.ok && decoded.view.appearance.nodeColorMetric).to.equal(
      "citation-hop",
    );
  });

  it("adds the hops chip and the traffic footnote for a view with explore", function () {
    const plan = planGraphView(cornerstones, {
      nodes,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
      hops: under,
    });
    expect(tutorialChips(cornerstones, plan, 8)).to.include(
      "hops 2 · references · floor 10",
    );
    expect(tutorialFootnote(plan, cornerstones)).to.include(
      "Opening hops fetches citations from the providers.",
    );
    expect(
      tutorialChips(
        overview,
        planGraphView(overview, {
          nodes,
          layout: liveLayout,
          filters: defaultPaperListFilterState(),
          folders,
          hops: under,
        }),
        8,
      ),
    ).to.not.include("hops 2 · references");
  });
});
