/**
 * The seed-link check (ADR 0018): one OpenAlex batch per 100 papers asking
 * only for each work's ID, DOI and reference list. No title is selected, so
 * the response observer drops these partial records and they never reach
 * `external_works_v2` (`openAlexWorkMetadata` needs a title).
 */
import { normalizeDOI } from "../domain/workIdentity";
import { requestJSON } from "../providers/http";
import type { CancellationSignal } from "./cancellationScope";
import { canonicalOpenAlexID } from "./graphSeedLinks";
import {
  checkPaperAliases,
  doiAlias,
  referenceListRows,
  type CheckPaper,
  type ReferenceListAnswer,
  type ReferenceListRow,
} from "./openAlexReferenceLists";
import { providerExecutionPolicy } from "./providerExecutionPolicy";

export const CHECK_SELECT = "id,doi,referenced_works";

/** Statuses that mean "this request is malformed", not "OpenAlex is away". */
const SPLIT_STATUSES = new Set([400, 413, 414, 422]);

export interface CheckOutcome {
  /** Every answer, and every paper missed by ID and by DOI as not-found. */
  rows: ReferenceListRow[];
  /** Papers whose batch was refused, failed or cancelled: nothing learned. */
  failed: CheckPaper[];
}

interface OpenAlexReferenceWork {
  id?: string;
  doi?: string | null;
  referenced_works?: string[];
}

interface OpenAlexReferenceList {
  results?: OpenAlexReferenceWork[];
}

type Field = "ids.openalex" | "doi";

function valueOf(paper: CheckPaper, field: Field): string | null {
  return field === "doi" ? paper.doi : paper.openAlexID;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function checkOpenAlexReferences(
  papers: readonly CheckPaper[],
  options: { apiKey: string; signal?: CancellationSignal; now?: () => Date },
): Promise<CheckOutcome> {
  const batchSize = Math.min(
    100,
    providerExecutionPolicy("openalex").batchSize,
  );
  const found = new Map<string, ReferenceListAnswer>();
  const failed = new Map<string, CheckPaper>();

  const ask = async (field: Field, batch: CheckPaper[]): Promise<void> => {
    if (!batch.length) return;
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set(
      "filter",
      `${field}:${batch.map((paper) => valueOf(paper, field)).join("|")}`,
    );
    url.searchParams.set("per_page", "200");
    url.searchParams.set("select", CHECK_SELECT);
    if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
    const response = await requestJSON<OpenAlexReferenceList>(
      "openalex",
      url.toString(),
      { signal: options.signal, retryRefusals: false },
    );
    if (response.ok && response.data) {
      const byValue = new Map<string, OpenAlexReferenceWork>();
      for (const work of response.data.results ?? []) {
        const value =
          field === "doi"
            ? normalizeDOI(work.doi)
            : canonicalOpenAlexID(work.id);
        if (value && !byValue.has(value)) byValue.set(value, work);
      }
      for (const paper of batch) {
        const work = byValue.get(valueOf(paper, field) ?? "");
        const id = canonicalOpenAlexID(work?.id);
        if (!work || !id) continue;
        const doi = normalizeDOI(work.doi);
        found.set(paper.key, {
          openAlexID: id,
          references: (work.referenced_works ?? [])
            .map(canonicalOpenAlexID)
            .filter((ref): ref is string => Boolean(ref)),
          aliases: [
            ...checkPaperAliases(paper),
            ...(doi ? [doiAlias(doi)] : []),
          ],
        });
      }
      return;
    }
    if (SPLIT_STATUSES.has(response.status)) {
      // One paper the filter cannot carry (a DOI with a comma) rejects its
      // whole batch: halve until it stands alone, and let it be missed.
      if (batch.length === 1) return;
      const half = Math.ceil(batch.length / 2);
      await ask(field, batch.slice(0, half));
      await ask(field, batch.slice(half));
      return;
    }
    for (const paper of batch) failed.set(paper.key, paper);
  };

  const askAll = async (field: Field, list: CheckPaper[]): Promise<void> => {
    for (const batch of chunked(list, batchSize)) await ask(field, batch);
  };

  await askAll(
    "ids.openalex",
    papers.filter((paper) => paper.openAlexID),
  );
  await askAll(
    "doi",
    papers.filter(
      (paper) => paper.doi && !found.has(paper.key) && !failed.has(paper.key),
    ),
  );

  const missed = papers.filter(
    (paper) =>
      (paper.openAlexID || paper.doi) &&
      !found.has(paper.key) &&
      !failed.has(paper.key),
  );
  return {
    rows: referenceListRows(
      [...found.values()],
      missed.flatMap(checkPaperAliases),
      (options.now?.() ?? new Date()).toISOString(),
    ),
    failed: [...failed.values()],
  };
}
