/*
 * The session's abstract lookup for Paper details (F17), wired to the
 * providers and the stores. Semantic Scholar's paper batch asks for
 * `abstract` and OpenAlex's work batch returns `abstract_inverted_index`;
 * both go through `requestJSON`, so the provider queue, keys and refusals
 * apply, and the response cache keeps the full record. A found abstract is
 * stored in a library paper's metrics record (`abstract_text`, never
 * Zotero's `abstractNote`) or in the external-work cache for a hop paper.
 */
import { stableWorkAliases } from "../domain/workIdentity";
import { fetchOpenAlexWorksBatch } from "../providers/openAlexProvider";
import {
  openAlexIdentifierForWork,
  semanticScholarIdentifierForWork,
} from "../providers/providerIdentifiers";
import { fetchSemanticScholarPapersBatch } from "../providers/semanticScholarProvider";
import { getOpenAlexAPIKey, isProviderEnabled } from "./citationPreferences";
import {
  getCitationMetricRecord,
  saveCitationMetricRecord,
} from "./citationMetricsStore";
import {
  cachedExternalWorkMetadata,
  saveExternalWorkCacheSuccesses,
} from "./externalWorkCacheService";
import {
  createAbstractLookup,
  type AbstractLookupTarget,
} from "./paperAbstractLookup";

function libraryRecord(target: AbstractLookupTarget) {
  const item = target.libraryItem;
  if (!item) return null;
  let libraryID = Zotero.Libraries.userLibraryID;
  try {
    const found = Zotero.Items.get(item.itemID) as Zotero.Item | null;
    if (found) libraryID = found.libraryID;
  } catch {
    // A node the snapshot built without a live item reads the user library.
  }
  return getCitationMetricRecord(libraryID, item.itemKey);
}

function storedAbstract(target: AbstractLookupTarget): string | null {
  const recorded = libraryRecord(target)?.abstract?.trim();
  if (recorded) return recorded;
  for (const alias of stableWorkAliases(target.work)) {
    const cached = cachedExternalWorkMetadata(alias)?.abstract?.trim();
    if (cached) return cached;
  }
  return null;
}

async function store(
  target: AbstractLookupTarget,
  abstract: string,
): Promise<void> {
  try {
    if (target.libraryItem) {
      const record = libraryRecord(target);
      if (record && !record.abstract?.trim()) {
        await saveCitationMetricRecord({ ...record, abstract });
      }
      return;
    }
    const cached = cachedExternalWorkMetadata(target.key);
    await saveExternalWorkCacheSuccesses(
      [
        {
          identityKey: target.key,
          metadata: { ...(cached ?? target.work), abstract },
        },
      ],
      { invalidateRelationships: false },
    );
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
}

export const paperAbstractLookup = createAbstractLookup({
  storedAbstract,
  providers: [
    (work) => {
      if (!isProviderEnabled("semantic-scholar")) return null;
      const id = semanticScholarIdentifierForWork(work);
      if (!id) return null;
      return fetchSemanticScholarPapersBatch([id]).then(
        ([paper]) => paper?.abstract ?? null,
      );
    },
    (work) => {
      if (!isProviderEnabled("openalex") || !getOpenAlexAPIKey()) return null;
      const id = openAlexIdentifierForWork(work);
      if (!id) return null;
      return fetchOpenAlexWorksBatch([id]).then(
        ([found]) => found?.abstract ?? null,
      );
    },
  ],
  store,
});
