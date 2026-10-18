/*
 * The session's abstract lookup for Paper details (F17), wired to the
 * providers and the stores. Semantic Scholar's paper batch asks for
 * `abstract` and OpenAlex's work batch returns `abstract_inverted_index`;
 * both go through `requestJSON`, so the provider queue, keys and refusals
 * apply, and the response cache keeps the full record. A found abstract
 * fills a library paper's own Abstract field (`abstractNote`) while it is
 * empty and the library is editable; a hop paper has no item, so its
 * abstract goes to the external-work cache.
 */
import { stableWorkAliases } from "../domain/workIdentity";
import { fetchOpenAlexWorksBatch } from "../providers/openAlexProvider";
import {
  openAlexIdentifierForWork,
  semanticScholarIdentifierForWork,
} from "../providers/providerIdentifiers";
import { fetchSemanticScholarPapersBatch } from "../providers/semanticScholarProvider";
import { getOpenAlexAPIKey, isProviderEnabled } from "./citationPreferences";
import { SELF_WRITE_MARK } from "./automaticUpdateCoordinator";
import {
  cachedExternalWorkMetadata,
  saveExternalWorkCacheSuccesses,
} from "./externalWorkCacheService";
import {
  createAbstractLookup,
  type AbstractLookupTarget,
} from "./paperAbstractLookup";

function libraryItem(target: AbstractLookupTarget): Zotero.Item | null {
  if (!target.libraryItem) return null;
  try {
    return (Zotero.Items.get(target.libraryItem.itemID) as Zotero.Item) ?? null;
  } catch {
    return null;
  }
}

function storedAbstract(target: AbstractLookupTarget): string | null {
  if (target.libraryItem) {
    // The node was built from a snapshot; the item may have gained one since.
    const own = String(
      libraryItem(target)?.getField?.("abstractNote") ?? "",
    ).trim();
    return own || null;
  }
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
      const item = libraryItem(target);
      // Read again just before writing: the reader may have typed one meanwhile.
      if (
        item &&
        item.library?.editable !== false &&
        !String(item.getField("abstractNote") ?? "").trim()
      ) {
        item.setField("abstractNote", abstract);
        await item.saveTx({ notifierData: { [SELF_WRITE_MARK]: true } });
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
