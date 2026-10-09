import { describe, it } from "node:test";
import { expect } from "chai";
import type { LibrarySnapshot, ZoteroPaper } from "../../src/domain/types";
import { rereadSnapshotPapers } from "../../src/services/zoteroLibraryService";

/** A Zotero item as `toPaper` reads it: fields, creators, tags, folders. */
function fakeItem(id: number, fields: Record<string, string>) {
  return {
    id,
    key: `K${id}`,
    libraryID: 1,
    getField: (name: string) => fields[name] ?? "",
    getCreators: () => [],
    getTags: () => [],
    getCollections: () => [],
  };
}

function paperWithoutYear(id: number): ZoteroPaper {
  return {
    itemID: id,
    itemKey: `K${id}`,
    libraryID: 1,
    title: "A paper",
    authors: [],
    year: null,
    publicationDate: null,
    doi: null,
    abstract: null,
    sourceTitle: null,
    tags: [],
    collectionIDs: [],
    metadataCompleteness: 0,
    metrics: {} as ZoteroPaper["metrics"],
  };
}

function snapshotOver(papers: ZoteroPaper[]): LibrarySnapshot {
  return {
    libraryID: 1,
    libraryName: "Test",
    generatedAt: "",
    papers,
    collections: [],
    tags: [],
    statistics: {
      totalPapers: papers.length,
      withoutYear: papers.filter((paper) => paper.year === null).length,
      withoutDOI: papers.length,
      withoutCitationData: papers.length,
      withoutReferenceData: papers.length,
    },
  };
}

describe("rereadSnapshotPapers (B48)", function () {
  it("reads a date added in Zotero after the snapshot into the same paper", function () {
    const paper = paperWithoutYear(7);
    const snapshot = snapshotOver([paper]);

    const changed = rereadSnapshotPapers(snapshot, [
      fakeItem(7, { title: "A paper", date: "2019-03-01" }),
    ]);

    expect(changed, "a new year is a change").to.equal(true);
    expect(snapshot.papers[0], "the view's maps hold this object").to.equal(
      paper,
    );
    expect(paper.year).to.equal(2019);
    expect(paper.publicationDate).to.equal("2019-03-01");
    expect(snapshot.statistics.withoutYear).to.equal(0);
  });

  it("reports no change when the item reads as the paper already does", function () {
    const snapshot = snapshotOver([paperWithoutYear(7)]);
    rereadSnapshotPapers(snapshot, [fakeItem(7, { title: "A paper" })]);

    expect(
      rereadSnapshotPapers(snapshot, [fakeItem(7, { title: "A paper" })]),
    ).to.equal(false);
  });

  it("leaves an item the snapshot does not hold alone", function () {
    const snapshot = snapshotOver([paperWithoutYear(7)]);

    const changed = rereadSnapshotPapers(snapshot, [
      fakeItem(8, { title: "Another", date: "2001" }),
    ]);

    expect(changed).to.equal(false);
    expect(snapshot.papers).to.have.length(1);
  });
});
