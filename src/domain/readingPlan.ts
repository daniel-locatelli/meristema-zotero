import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
} from "../readingFormat/readingList";
import {
  emptyReadState,
  mergeReadStates,
  parseReadState,
  stateOf,
  type ReadState,
  type ReadStateDoc,
} from "../readingFormat/readState";

/*
 * R1 step 3: what the Reading plan view draws, from the two notes Meristema
 * Reading writes (spec 2026-11-06, section 3). Pure; the Zotero reads are in
 * services/readingNoteSource.ts.
 */

export interface ReadingListNote {
  key: string;
  dateAdded: string;
  html: string;
}

export interface ReadingFolder {
  collectionID: number;
  notes: ReadingListNote[];
  papers: FolderItem[];
}

export interface ReadingStateNote {
  key: string;
  html: string;
}

export interface ReadingSource {
  folders: ReadingFolder[];
  stateNotes: ReadingStateNote[];
  /** Node key (the item key) to paper id, for every paper in the graph's library. */
  paperIds: ReadonlyMap<string, string>;
}

export interface ReadingPath {
  collectionID: number;
  topic: string;
  /** The list's ordered steps, first to last; unordered papers are not on it. */
  keys: string[];
}

export interface ReadingPlan {
  paths: ReadingPath[];
  stepByKey: ReadonlyMap<string, number>;
  /** The step a paper in no ticked list sits at: one past every list's last. */
  afterLast: number;
  stateByKey: ReadonlyMap<string, ReadState>;
}

export const EMPTY_READING_SOURCE: ReadingSource = {
  folders: [],
  stateNotes: [],
  paperIds: new Map(),
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A folder's list note, as Meristema Reading picks it: oldest, then smallest key. */
function oldest(notes: readonly ReadingListNote[]): ReadingListNote | null {
  return (
    [...notes].sort(
      (a, b) => compare(a.dateAdded, b.dateAdded) || compare(a.key, b.key),
    )[0] ?? null
  );
}

/** Every readable state note merged; an unreadable one is left out. */
export function readStateFromNotes(
  notes: readonly ReadingStateNote[],
): ReadStateDoc {
  return [...notes]
    .sort((a, b) => compare(a.key, b.key))
    .map((note) => parseReadState(note.html))
    .reduce<ReadStateDoc>(
      (doc, parsed) => (parsed.ok ? mergeReadStates(doc, parsed.value) : doc),
      emptyReadState(),
    );
}

/**
 * The plan for the ticked folders, given in folder-tree order. A paper in two
 * ticked lists takes the first list's step; every list keeps its own path.
 */
export function buildReadingPlan(
  source: ReadingSource,
  tickedInTreeOrder: readonly number[],
): ReadingPlan {
  const byID = new Map(source.folders.map((f) => [f.collectionID, f]));
  const paths: ReadingPath[] = [];
  const stepByKey = new Map<string, number>();
  let afterLast = 1;
  for (const collectionID of tickedInTreeOrder) {
    const folder = byID.get(collectionID);
    const note = folder ? oldest(folder.notes) : null;
    if (!folder || !note) continue;
    const parsed = parseReadingList(note.html);
    if (!parsed.ok) continue;
    const resolved = resolveReadingList(parsed.value, folder.papers);
    const n = resolved.steps.length;
    for (const step of resolved.steps) {
      if (!stepByKey.has(step.key)) stepByKey.set(step.key, step.step);
    }
    for (const key of resolved.unordered) {
      if (!stepByKey.has(key)) stepByKey.set(key, n + 1);
    }
    afterLast = Math.max(afterLast, n + (resolved.unordered.length ? 2 : 1));
    paths.push({
      collectionID,
      topic: parsed.value.topic,
      keys: resolved.steps.map((step) => step.key),
    });
  }
  const doc = readStateFromNotes(source.stateNotes);
  const stateByKey = new Map<string, ReadState>();
  for (const [key, id] of source.paperIds)
    stateByKey.set(key, stateOf(doc, id));
  return { paths, stepByKey, afterLast, stateByKey };
}

/** A node's Reading step: its list step, else one past the last; null with no plan. */
export function readingStepOf(
  plan: ReadingPlan | null,
  key: string,
): number | null {
  if (!plan) return null;
  return plan.stepByKey.get(key) ?? plan.afterLast;
}

/** Whether two ticked-folder lists (in tree order) are the same list. */
export function sameTicks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
