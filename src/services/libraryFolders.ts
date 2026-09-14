import type {
  LibraryCollectionFilter,
  LibrarySnapshot,
  ZoteroPaper,
} from "../domain/types";

interface CollectionInfo {
  collectionID: number;
  key: string;
  name: string;
  parentID: number | null;
  orderIndex: number;
}

/**
 * A folder in Zotero's trash is not a folder a graph can show. The paper walk
 * below reaches folders through `paper.collectionIDs`, which a snapshot keeps
 * from before the folder was trashed, so the guard has to be on both paths.
 */
function isLiveCollection(collection: any): boolean {
  return Boolean(collection) && !collection.deleted;
}

function allCollectionInfo(
  libraryID: number,
  papers: readonly ZoteroPaper[],
): Map<number, CollectionInfo> {
  const info = new Map<number, CollectionInfo>();
  try {
    const collections =
      (Zotero.Collections as any).getByLibrary?.(libraryID, true) ?? [];
    collections.forEach((collection: any, index: number) => {
      if (!isLiveCollection(collection)) return;
      const id = Number(collection.id ?? collection.collectionID);
      if (!Number.isFinite(id)) return;
      const parent = Number(
        collection.parentID ?? collection.parentCollectionID ?? 0,
      );
      info.set(id, {
        collectionID: id,
        key: String(collection.key ?? id),
        name: String(collection.name ?? `Collection ${id}`),
        parentID: Number.isFinite(parent) && parent > 0 ? parent : null,
        orderIndex: index,
      });
    });
  } catch {
    // Collection enumeration may be unavailable for some library contexts.
  }
  const pending = new Set(papers.flatMap((paper) => paper.collectionIDs));
  while (pending.size) {
    const id = pending.values().next().value as number;
    pending.delete(id);
    if (info.has(id)) continue;
    try {
      const collection = Zotero.Collections.get(id) as any;
      if (!isLiveCollection(collection)) continue;
      const parent = Number(
        collection.parentID ?? collection.parentCollectionID ?? 0,
      );
      info.set(id, {
        collectionID: id,
        key: String(collection.key ?? id),
        name: String(collection.name ?? `Collection ${id}`),
        parentID: Number.isFinite(parent) && parent > 0 ? parent : null,
        orderIndex: info.size,
      });
      if (parent > 0 && !info.has(parent)) pending.add(parent);
    } catch {
      // Ignore inaccessible or deleted collection records.
    }
  }
  return info;
}

/** A library's folders as the graph reads them: tree order, paths, reach. */
export function libraryFolderFilters(
  libraryID: number,
  papers: readonly ZoteroPaper[],
): LibraryCollectionFilter[] {
  const info = allCollectionInfo(libraryID, papers);
  const children = new Map<number, number[]>();
  for (const collection of info.values()) {
    if (!collection.parentID) continue;
    const list = children.get(collection.parentID) ?? [];
    list.push(collection.collectionID);
    children.set(collection.parentID, list);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) => (info.get(a)?.orderIndex ?? 0) - (info.get(b)?.orderIndex ?? 0),
    );
  }
  const descendants = (id: number): number[] => {
    const output = [id];
    const queue = [...(children.get(id) ?? [])];
    const seen = new Set(output);
    while (queue.length) {
      const child = queue.shift()!;
      if (seen.has(child)) continue;
      seen.add(child);
      output.push(child);
      queue.push(...(children.get(child) ?? []));
    }
    return output;
  };
  const pathAndDepth = (id: number): { path: string; depth: number } => {
    const parts: string[] = [];
    const seen = new Set<number>();
    let current: number | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const entry = info.get(current);
      if (!entry) break;
      parts.unshift(entry.name);
      current = entry.parentID;
    }
    return { path: parts.join(" / "), depth: Math.max(0, parts.length - 1) };
  };
  return [...info.values()]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((entry) => {
      const located = pathAndDepth(entry.collectionID);
      return {
        collectionID: entry.collectionID,
        parentCollectionID: entry.parentID,
        key: entry.key,
        name: entry.name,
        path: located.path,
        depth: located.depth,
        orderIndex: entry.orderIndex,
        includedCollectionIDs: descendants(entry.collectionID),
      };
    });
}

/**
 * Rebuilds a snapshot's folder list from Zotero and reads no paper (B58). A
 * folder change moves no paper and no citation, so relabelling the rail is
 * one walk of `Zotero.Collections`, not a library reload. Idempotent, and safe
 * on any snapshot, cached or not.
 */
export function refreshSnapshotFolders(snapshot: LibrarySnapshot): void {
  snapshot.collections = libraryFolderFilters(
    snapshot.libraryID,
    snapshot.papers,
  );
}
