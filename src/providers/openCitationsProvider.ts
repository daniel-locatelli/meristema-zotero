import type {
  ProviderLookupResult,
  RelatedWorkMetadata,
  WorkIdentifiers,
} from "../domain/citationTypes";
import { publicationYearOrNull } from "../domain/valueNormalization";
import { normalizeDOI } from "../domain/workIdentity";
import { requestJSON } from "./http";
import type { CitationProvider, ProviderRequestOptions } from "./types";
import {
  ProviderRefusedError,
  failureStatusFromHTTP,
  stringOrNull,
} from "./types";

const MAX_RELATION_RESULTS = 2500;
/**
 * The canonical API host. The legacy `opencitations.net/index/coci/api/v1`
 * paths still answer, but only through a 301 to this one, so every relation
 * page used to cost two round trips (B63).
 */
const API = "https://api.opencitations.net";

/**
 * A record from OpenCitations Meta, where the bibliographic data moved: the
 * Index's own `/metadata` route answers 410 Gone (B63). Meta carries no
 * citation or reference count, and the Index's count endpoints cannot stand
 * in for one, because they answer `0` for a DOI that does not exist at all
 * as readily as for a paper with no citers. So the provider reports no
 * counts, and an empty citer list is trusted on the strength of the match
 * alone (`unbackedEmptyList`, relationshipRefreshPolicy.ts).
 */
interface OCMetaRecord {
  id?: string;
  title?: string;
  author?: string;
  pub_date?: string;
  venue?: string;
}
interface OCLink {
  citing?: string;
  cited?: string;
  creation?: string;
  author_sc?: string;
  timespan?: string;
}

/** Meta appends its own identifiers in brackets to every name and venue. */
function withoutIdentifiers(value: unknown): string {
  return String(value ?? "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
}

function relatedFromLink(
  link: OCLink,
  direction: "citations" | "references",
): RelatedWorkMetadata | null {
  const doi = normalizeDOI(
    direction === "citations" ? link.citing : link.cited,
  );
  if (!doi) return null;
  return {
    provider: "opencitations",
    providerWorkID: doi,
    doi,
    title: null,
    year:
      direction === "citations" && link.creation
        ? Number(String(link.creation).slice(0, 4)) || null
        : null,
    publicationDate:
      direction === "citations" ? stringOrNull(link.creation) : null,
    authors: [],
  };
}

async function fetchLinks(
  doi: string,
  direction: "citations" | "references",
  maximum: number,
  offset = 0,
  options?: ProviderRequestOptions,
): Promise<RelatedWorkMetadata[]> {
  const response = await requestJSON<OCLink[]>(
    "opencitations",
    `${API}/index/v1/${direction}/${encodeURIComponent(doi)}`,
    { signal: options?.signal, retryRefusals: options?.retryRefusals },
  );
  if (response.status === 429) throw new ProviderRefusedError("opencitations");
  if (!response.ok || !Array.isArray(response.data)) return [];
  return response.data
    .slice(offset, offset + Math.min(MAX_RELATION_RESULTS, maximum))
    .map((link) => relatedFromLink(link, direction))
    .filter((work): work is RelatedWorkMetadata => Boolean(work));
}

export const openCitationsProvider: CitationProvider = {
  id: "opencitations",
  label: "OpenCitations",
  capabilities: {
    identifiers: {
      doi: true,
      pmid: false,
      arxiv: false,
      isbn: false,
      titleSearch: false,
    },
    // Meta carries no counts, and the Index's count endpoints answer `0` for
    // a DOI that does not exist, so neither can be reported honestly (B63).
    citationCount: false,
    referenceCount: false,
    citingWorks: true,
    referencedWorks: true,
    abstract: false,
    openAccess: false,
    retraction: false,
    sourceMetrics: false,
  },
  supports: (identifiers) => Boolean(identifiers.doi),
  lookup: async (
    identifiers: WorkIdentifiers,
    options,
  ): Promise<ProviderLookupResult> => {
    if (!identifiers.doi) {
      return {
        status: "no-identifier",
        provider: "opencitations",
        message: "OpenCitations needs a DOI.",
      };
    }
    const response = await requestJSON<OCMetaRecord[]>(
      "opencitations",
      `${API}/meta/v1/metadata/doi:${encodeURIComponent(identifiers.doi)}`,
      { signal: options?.signal, retryRefusals: options?.retryRefusals },
    );
    if (!response.ok) {
      return {
        status: failureStatusFromHTTP(response.status),
        provider: "opencitations",
        message: response.message || "OpenCitations did not return a work.",
      };
    }
    const record = Array.isArray(response.data) ? response.data[0] : null;
    if (!record) {
      // Meta answers 200 with `[]` for a DOI it has never seen. That is a
      // miss, not a provider fault, and saying so is what keeps a fill from
      // storing "no citers" for a paper OpenCitations does not know.
      return {
        status: "not-found",
        provider: "opencitations",
        message: "OpenCitations Meta has no record for this DOI.",
      };
    }
    return {
      status: "success",
      provider: "opencitations",
      matchedBy: "doi",
      matchConfidence: 1,
      providerWorkID: identifiers.doi,
      doi: identifiers.doi,
      title: stringOrNull(record.title),
      // `pub_date` is a full date; publicationYearOrNull reads only a year.
      year: publicationYearOrNull(String(record.pub_date ?? "").slice(0, 4)),
      publicationDate: stringOrNull(record.pub_date),
      authors: record.author
        ? record.author
            .split(";")
            .map((author) => withoutIdentifiers(author))
            .filter(Boolean)
        : [],
      sourceTitle: record.venue
        ? stringOrNull(withoutIdentifiers(record.venue))
        : null,
      abstract: null,
      citationCount: null,
      citationCountProvider: "opencitations",
      referenceCount: null,
      referenceCountProvider: "opencitations",
      resolvedReferenceCount: 0,
      references: [],
      sourceMetrics: null,
    };
  },
  fetchCitingWorks: (doi, maximum, offset, options) =>
    fetchLinks(doi, "citations", maximum, offset, options),
  fetchReferencedWorks: (doi, maximum, offset, options) =>
    fetchLinks(doi, "references", maximum, offset, options),
};
