/*
 * Which papers Paper details asks providers for an abstract, and how often
 * (F17). Relationship pages and the hydration queue keep only summaries, so
 * most papers a hop draws arrive with none; one selected without one is
 * asked for once, by the identifiers it already has. No window and no
 * Zotero here, so `test/unit` can load it; `paperAbstractService.ts` wires
 * the providers and the stores.
 */
import type { RelatedWorkMetadata } from "../domain/citationTypes";
import type { CitationGraphNode } from "../domain/graphTypes";
import {
  normalizeDOI,
  stableExternalWorkIdentity,
} from "../domain/workIdentity";
import { paperAbstract } from "./paperDetailModel";

export interface AbstractLookupTarget {
  /** One ask per key per session; a paper's library and hop nodes share it. */
  key: string;
  /** What the providers are asked by. */
  work: RelatedWorkMetadata;
  /** The library paper the abstract is stored against, or null for a hop paper. */
  libraryItem: { itemID: number; itemKey: string } | null;
}

export interface AbstractLookupSources {
  /** An abstract already stored for the paper, read without asking anyone. */
  storedAbstract(target: AbstractLookupTarget): string | null;
  /**
   * The providers in the order asked. Each returns null when it cannot be
   * asked for this work, else its abstract or null when it has none, and
   * rejects when it could not answer.
   */
  providers: ReadonlyArray<
    (work: RelatedWorkMetadata) => Promise<string | null> | null
  >;
  store(target: AbstractLookupTarget, abstract: string): Promise<void>;
}

export interface AbstractLookup {
  /** The abstract found or stored for a paper that shows none of its own. */
  found(node: CitationGraphNode): string | null;
  /** The ask for a paper without one, or null when there is nothing to ask. */
  request(node: CitationGraphNode): Promise<string | null> | null;
}

function lookupWork(node: CitationGraphNode): RelatedWorkMetadata {
  if (node.externalWork) {
    return {
      ...node.externalWork,
      doi: normalizeDOI(node.externalWork.doi ?? node.doi),
    };
  }
  return {
    provider: node.provider ?? "zotero",
    providerWorkID: node.providerWorkID,
    doi: normalizeDOI(node.doi),
    title: node.title,
    year: node.year,
    authors: node.authors,
  };
}

/** The ask for a paper Paper details shows no abstract for, if it can be asked. */
export function abstractLookupTarget(
  node: CitationGraphNode,
): AbstractLookupTarget | null {
  if (paperAbstract(node)) return null;
  const work = lookupWork(node);
  const key = stableExternalWorkIdentity(work);
  if (!key) return null;
  const isLibraryPaper = node.kind !== "external" && node.itemID > 0;
  return {
    key,
    work,
    libraryItem: isLibraryPaper
      ? { itemID: node.itemID, itemKey: node.itemKey }
      : null,
  };
}

export function createAbstractLookup(
  sources: AbstractLookupSources,
): AbstractLookup {
  /** Every answer this session, null where no provider had one. */
  const answered = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();

  const known = (target: AbstractLookupTarget): string | null =>
    answered.get(target.key) ?? sources.storedAbstract(target);

  const ask = async (target: AbstractLookupTarget): Promise<string | null> => {
    let failed = false;
    for (const provider of sources.providers) {
      const request = provider(target.work);
      if (!request) continue;
      let abstract: string | null;
      try {
        abstract = (await request)?.trim() || null;
      } catch {
        failed = true;
        continue;
      }
      if (!abstract) continue;
      answered.set(target.key, abstract);
      await sources.store(target, abstract);
      return abstract;
    }
    // A provider that failed has not said it has none: a later selection
    // asks again. Otherwise "none" is the answer for the session.
    if (!failed) answered.set(target.key, null);
    return null;
  };

  return {
    found(node) {
      const target = abstractLookupTarget(node);
      return target ? known(target) : null;
    },
    request(node) {
      const target = abstractLookupTarget(node);
      if (!target || answered.has(target.key) || known(target)) return null;
      const inFlight = pending.get(target.key);
      if (inFlight) return inFlight;
      const run = ask(target).finally(() => pending.delete(target.key));
      pending.set(target.key, run);
      return run;
    },
  };
}
