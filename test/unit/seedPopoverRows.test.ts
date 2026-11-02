import { describe, it } from "node:test";
import { expect } from "chai";
import {
  NO_MATCHES_MESSAGE,
  NO_SEEDS_MESSAGE,
  SEARCHING_MESSAGE,
  SEARCH_FAILED_MESSAGE,
  libraryPaperID,
  seedPaperID,
  doiQuery,
  seedPopoverList,
  type SeedPopoverPaper,
} from "../../src/services/seedPopoverRows";

const paper = (id: string, title: string): SeedPopoverPaper => ({
  id,
  title,
  authors: ["Doe"],
  year: 2020,
  sourceTitle: null,
});

describe("seedPopoverList", function () {
  it("lists the seeds, all marked as seeds, when the query is empty", function () {
    const list = seedPopoverList({
      query: "",
      seeds: [paper("item:1", "A"), paper("item:2", "B")],
      library: { status: "idle" },
    });
    expect(list).to.deep.equal({
      kind: "rows",
      rows: [
        { paper: paper("item:1", "A"), isSeed: true },
        { paper: paper("item:2", "B"), isSeed: true },
      ],
    });
  });

  it("treats a whitespace query as empty", function () {
    const list = seedPopoverList({
      query: "   ",
      seeds: [paper("item:1", "A")],
      library: { status: "done", papers: [paper("item:9", "Z")] },
    });
    expect(list.kind).to.equal("rows");
    expect(list.kind === "rows" && list.rows[0].paper.id).to.equal("item:1");
  });

  it("shows the no-seeds placeholder for an empty query on a seedless graph", function () {
    const list = seedPopoverList({
      query: "",
      seeds: [],
      library: { status: "idle" },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: NO_SEEDS_MESSAGE,
    });
  });

  it("shows the searching placeholder while a query has no results yet", function () {
    for (const library of [
      { status: "idle" },
      { status: "searching" },
    ] as const) {
      const list = seedPopoverList({ query: "a", seeds: [], library });
      expect(list).to.deep.equal({
        kind: "placeholder",
        message: SEARCHING_MESSAGE,
      });
    }
  });

  it("shows the failed placeholder when the search failed", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [],
      library: { status: "failed" },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: SEARCH_FAILED_MESSAGE,
    });
  });

  it("shows the no-matches placeholder when the search returned nothing", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [paper("item:1", "A")],
      library: { status: "done", papers: [] },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: NO_MATCHES_MESSAGE,
    });
  });

  it("lists library matches only, marking the ones that are seeds", function () {
    const list = seedPopoverList({
      query: "a",
      seeds: [paper("item:1", "A"), paper("item:3", "C")],
      library: {
        status: "done",
        papers: [paper("item:1", "A"), paper("item:2", "B")],
      },
    });
    expect(list).to.deep.equal({
      kind: "rows",
      rows: [
        { paper: paper("item:1", "A"), isSeed: true },
        { paper: paper("item:2", "B"), isSeed: false },
      ],
    });
  });
});

describe("seed ids", function () {
  it("names a library paper by its item id", function () {
    expect(libraryPaperID(42)).to.equal("item:42");
  });

  it("gives a library seed the same id as the library paper", function () {
    expect(seedPaperID({ key: "node-42", itemID: 42 })).to.equal("item:42");
  });

  it("keeps an external seed's key as its id", function () {
    expect(seedPaperID({ key: "doi:10.1/x", itemID: 0 })).to.equal(
      "doi:10.1/x",
    );
    expect(seedPaperID({ key: "doi:10.1/y", itemID: -1 })).to.equal(
      "doi:10.1/y",
    );
  });
});

describe("a DOI typed into the seed search (F6)", function () {
  it("reads a bare DOI, a doi.org link and a doi: prefix, and nothing else", function () {
    expect(doiQuery("10.1145/1201775.882296")).to.equal(
      "10.1145/1201775.882296",
    );
    expect(doiQuery(" https://doi.org/10.1145/1201775.882296 ")).to.equal(
      "10.1145/1201775.882296",
    );
    expect(doiQuery("doi:10.1145/ABC.1")).to.equal("10.1145/abc.1");
    expect(doiQuery("graph drawing"), "words").to.equal(null);
    expect(
      doiQuery("see 10.1145/1201775.882296 for more"),
      "a DOI inside a sentence",
    ).to.equal(null);
  });

  it("offers a lookup when the library has no match for the DOI", function () {
    const list = seedPopoverList({
      query: "10.1145/1201775.882296",
      seeds: [],
      library: { status: "done", papers: [] },
    });
    expect(list).to.deep.equal({
      kind: "lookup",
      doi: "10.1145/1201775.882296",
      state: "ready",
    });
  });

  it("carries the lookup's state", function () {
    const list = seedPopoverList({
      query: "10.1145/1201775.882296",
      seeds: [],
      library: { status: "done", papers: [] },
      lookup: { doi: "10.1145/1201775.882296", state: "not-found" },
    });
    expect(list).to.deep.equal({
      kind: "lookup",
      doi: "10.1145/1201775.882296",
      state: "not-found",
    });
  });

  it("ignores a lookup state left from another DOI", function () {
    const list = seedPopoverList({
      query: "10.1145/2",
      seeds: [],
      library: { status: "done", papers: [] },
      lookup: { doi: "10.1145/1", state: "failed" },
    });
    expect(list).to.deep.equal({
      kind: "lookup",
      doi: "10.1145/2",
      state: "ready",
    });
  });

  it("lists the library's match instead when it has one", function () {
    const list = seedPopoverList({
      query: "10.1145/1201775.882296",
      seeds: [],
      library: { status: "done", papers: [paper("item:7", "In Zotero")] },
    });
    expect(list.kind).to.equal("rows");
  });

  it("still says no matches for words the library lacks", function () {
    const list = seedPopoverList({
      query: "nothing here",
      seeds: [],
      library: { status: "done", papers: [] },
    });
    expect(list).to.deep.equal({
      kind: "placeholder",
      message: NO_MATCHES_MESSAGE,
    });
  });
});
