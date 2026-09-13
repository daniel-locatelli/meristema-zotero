/**
 * A memo of each paper's stored citation list, per direction, as the hop
 * walk reads it. Reading a list means a store lookup and a conversion to
 * external works, so a rebuild after one landing must not re-read every
 * expanded paper. The entry for a paper is dropped when that paper publishes
 * (graphViewService.ts, `applyRelationshipPublication`).
 */
import type { ExternalWork } from "../domain/externalWork";
import type { HopDirection } from "./graphHopModel";

/** Thousands of hop papers at 50 works each is the working set now. */
export const MAX_FRAGMENT_ENTRIES = 4096;

export interface HopFragment {
  expanded: boolean;
  works: ExternalWork[];
}

/**
 * The Map's own insertion order is the LRU order: a read re-inserts its entry
 * at the back, so the front is always the least recently used. Eviction is a
 * single `delete` instead of the full scan per insertion it used to be.
 */
const fragments = new Map<string, HopFragment>();

function fragmentKey(
  libraryID: number,
  key: string,
  direction: HopDirection,
): string {
  return `${libraryID}:${direction}:${key}`;
}

function cloneWork(work: ExternalWork): ExternalWork {
  return {
    ...work,
    authors: [...(work.authors ?? [])],
    // Nested bibliographies are immutable provider data; share the reference.
    references: work.references,
    citationCountsByYear: work.citationCountsByYear?.map((entry) => ({
      ...entry,
    })),
    sourceMetrics: work.sourceMetrics
      ? { ...work.sourceMetrics }
      : work.sourceMetrics,
  };
}

function evictOldest(): void {
  while (fragments.size > MAX_FRAGMENT_ENTRIES) {
    const oldest = fragments.keys().next();
    if (oldest.done) return;
    fragments.delete(oldest.value);
  }
}

export function getHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
): HopFragment | null {
  const id = fragmentKey(libraryID, key, direction);
  const cached = fragments.get(id);
  if (!cached) return null;
  // Move to the back: this is the read that makes it recently used.
  fragments.delete(id);
  fragments.set(id, cached);
  return { expanded: cached.expanded, works: cached.works.map(cloneWork) };
}

export function setHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
  fragment: HopFragment,
): void {
  const id = fragmentKey(libraryID, key, direction);
  fragments.delete(id);
  fragments.set(id, {
    expanded: fragment.expanded,
    works: fragment.works.map(cloneWork),
  });
  evictOldest();
}

/** Both directions: a publication for a paper may have touched either list. */
export function invalidateHopFragment(libraryID: number, key: string): void {
  fragments.delete(fragmentKey(libraryID, key, "cited-by"));
  fragments.delete(fragmentKey(libraryID, key, "references"));
}

export function clearFocusGraphCachesForLibrary(libraryID: number): void {
  const prefix = `${libraryID}:`;
  for (const key of [...fragments.keys()]) {
    if (key.startsWith(prefix)) fragments.delete(key);
  }
}

export function clearFocusGraphCaches(): void {
  fragments.clear();
}

export function focusGraphCacheStats(): { fragments: number } {
  return { fragments: fragments.size };
}
