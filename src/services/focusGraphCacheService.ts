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
const MAX_FRAGMENT_ENTRIES = 4096;

export interface HopFragment {
  expanded: boolean;
  works: ExternalWork[];
}

interface CachedFragment extends HopFragment {
  touchedAt: number;
}

const fragments = new Map<string, CachedFragment>();

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
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, value] of fragments) {
      if (value.touchedAt < oldest) {
        oldest = value.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    fragments.delete(oldestKey);
  }
}

export function getHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
): HopFragment | null {
  const cached = fragments.get(fragmentKey(libraryID, key, direction));
  if (!cached) return null;
  cached.touchedAt = Date.now();
  return { expanded: cached.expanded, works: cached.works.map(cloneWork) };
}

export function setHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
  fragment: HopFragment,
): void {
  fragments.set(fragmentKey(libraryID, key, direction), {
    expanded: fragment.expanded,
    works: fragment.works.map(cloneWork),
    touchedAt: Date.now(),
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
