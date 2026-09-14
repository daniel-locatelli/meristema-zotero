import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import type {
  LibraryCollectionFilter,
  LibrarySnapshot,
  ZoteroPaper,
} from "../../src/domain/types";
import { refreshSnapshotFolders } from "../../src/services/libraryFolders";

interface FakeFolder {
  id: number;
  key: string;
  name: string;
  parentID: number | null;
  deleted?: boolean;
}

let folders: FakeFolder[] = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  folders = [];
  (globalThis as Record<string, unknown>).Zotero = {
    Collections: {
      // Deliberately the worst case for trash: a trashed folder is listed.
      // Whether Zotero's own getByLibrary lists one is recorded by the suite.
      getByLibrary: () => [...folders],
      get: (id: number) => folders.find((folder) => folder.id === id) ?? false,
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

function folder(
  id: number,
  name: string,
  parentID: number | null = null,
): FakeFolder {
  const created = { id, key: `K${id}`, name, parentID };
  folders.push(created);
  return created;
}

/** Only `collectionIDs` is read by the folder builder. */
function paperIn(...collectionIDs: number[]): ZoteroPaper {
  return { collectionIDs } as unknown as ZoteroPaper;
}

function snapshotOver(papers: ZoteroPaper[]): LibrarySnapshot {
  const snapshot: LibrarySnapshot = {
    libraryID: 1,
    libraryName: "Test",
    generatedAt: "",
    papers,
    collections: [],
    tags: [],
    statistics: {
      totalPapers: papers.length,
      withoutYear: 0,
      withoutDOI: 0,
      withoutCitationData: 0,
      withoutReferenceData: 0,
    },
  };
  refreshSnapshotFolders(snapshot);
  return snapshot;
}

function entry(
  snapshot: LibrarySnapshot,
  id: number,
): LibraryCollectionFilter | undefined {
  return snapshot.collections.find((c) => c.collectionID === id);
}

describe("refreshing a snapshot's folders (B58)", function () {
  it("carries a rename into the folder's name and path, and its child's path", function () {
    const parent = folder(1, "PhD");
    folder(2, "Chapter 1", 1);
    const snapshot = snapshotOver([paperIn(2)]);
    expect(entry(snapshot, 2)?.path).to.equal("PhD / Chapter 1");

    parent.name = "Thesis";
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 1)?.name).to.equal("Thesis");
    expect(entry(snapshot, 1)?.path).to.equal("Thesis");
    expect(entry(snapshot, 2)?.path).to.equal("Thesis / Chapter 1");
  });

  it("carries a move into the parent, the depth and both parents' reach", function () {
    folder(1, "A");
    folder(2, "B");
    folder(3, "B2", 2);
    const moved = folder(4, "C", 1);
    const snapshot = snapshotOver([]);
    expect(entry(snapshot, 1)?.includedCollectionIDs).to.deep.equal([1, 4]);

    moved.parentID = 3;
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 4)?.parentCollectionID).to.equal(3);
    expect(entry(snapshot, 4)?.depth).to.equal(2);
    expect(entry(snapshot, 1)?.includedCollectionIDs).to.deep.equal([1]);
    expect(entry(snapshot, 2)?.includedCollectionIDs).to.deep.equal([2, 3, 4]);
    expect(entry(snapshot, 3)?.includedCollectionIDs).to.deep.equal([3, 4]);
  });

  it("drops a deleted folder even while a paper still names it", function () {
    folder(1, "Keep");
    folder(2, "Doomed");
    const snapshot = snapshotOver([paperIn(2)]);
    expect(entry(snapshot, 2)).to.exist;

    folders = folders.filter((f) => f.id !== 2);
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 2)).to.equal(undefined);
    expect(entry(snapshot, 1)?.name).to.equal("Keep");
  });

  it("drops a trashed folder, whether listed or reached through a paper", function () {
    folder(1, "Keep");
    const trashed = folder(2, "Trashed");
    const snapshot = snapshotOver([paperIn(2)]);

    trashed.deleted = true;
    refreshSnapshotFolders(snapshot);

    expect(entry(snapshot, 2)).to.equal(undefined);
  });

  it("reads no paper: the snapshot keeps its paper list", function () {
    folder(1, "PhD");
    const papers = [paperIn(1)];
    const snapshot = snapshotOver(papers);
    refreshSnapshotFolders(snapshot);
    expect(snapshot.papers).to.equal(papers);
  });
});
