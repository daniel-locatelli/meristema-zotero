import type { LibraryLink } from "../readingFormat/common";
import { READING_LIST_TAG } from "../readingFormat/readingList";
import { paperId, READ_STATE_TAG } from "../readingFormat/readState";
import type { ReadingFolder, ReadingSource } from "../domain/readingPlan";

/*
 * Reads what the Reading plan view needs straight from Zotero, as Meristema
 * Reading writes it; Meristema Reading itself need not be installed.
 */

function libraryLinkOf(libraryID: number): LibraryLink {
  const library = Zotero.Libraries.get(libraryID) as any;
  return library?.libraryType === "group"
    ? { kind: "group", id: Zotero.Groups.getGroupIDFromLibraryID(libraryID) }
    : { kind: "user" };
}

function isTaggedNote(item: Zotero.Item, tag: string): boolean {
  return (
    item.isNote() && item.isTopLevelItem() && !item.deleted && item.hasTag(tag)
  );
}

async function taggedNotes(
  libraryID: number,
  tag: string,
): Promise<Zotero.Item[]> {
  const tagID = Zotero.Tags.getID(tag);
  if (!tagID) return [];
  const ids = await Zotero.Tags.getTagItems(libraryID, tagID);
  const items = await Zotero.Items.getAsync(ids);
  return items.filter((item: Zotero.Item) => item && isTaggedNote(item, tag));
}

export async function loadReadingSource(
  libraryID: number,
  collectionIDs: readonly number[],
  itemIDs: readonly number[],
): Promise<ReadingSource> {
  const listNotes = await taggedNotes(libraryID, READING_LIST_TAG);
  const wanted = new Set(collectionIDs);
  const notesByFolder = new Map<number, Zotero.Item[]>();
  for (const note of listNotes) {
    for (const id of note.getCollections()) {
      if (!wanted.has(id)) continue;
      notesByFolder.set(id, [...(notesByFolder.get(id) ?? []), note]);
    }
  }
  const folders: ReadingFolder[] = [];
  for (const [collectionID, notes] of notesByFolder) {
    const collection = Zotero.Collections.get(collectionID);
    if (!collection) continue;
    const children = collection.getChildItems(false, false) as Zotero.Item[];
    folders.push({
      collectionID,
      notes: notes.map((note) => ({
        key: note.key,
        dateAdded: note.dateAdded,
        html: note.getNote(),
      })),
      papers: children
        .filter((item) => item.isRegularItem())
        .map((item) => ({
          key: item.key,
          title: String(item.getField("title")),
        })),
    });
  }
  const stateNotes = (
    await taggedNotes(Zotero.Libraries.userLibraryID, READ_STATE_TAG)
  ).map((note) => ({ key: note.key, html: note.getNote() }));
  const link = libraryLinkOf(libraryID);
  const paperIds = new Map<string, string>();
  for (const item of (await Zotero.Items.getAsync([
    ...itemIDs,
  ])) as Zotero.Item[]) {
    if (!item?.isRegularItem() || item.deleted) continue;
    paperIds.set(
      item.key,
      paperId({
        doi: String(item.getField("DOI") ?? "") || null,
        library: link,
        key: item.key,
      }),
    );
  }
  return { folders, stateNotes, paperIds };
}
