/**
 * The OpenAlex reference lists the seed-link check stores (ADR 0018): one row
 * per alias, the list itself once, under `openalex:W…`. Pure, so the store in
 * externalWorkCacheService.ts and the scheduler share one definition.
 */
import type { SeedLinkCheck } from "./graphSeedLinks";

/** A paper as the check asks for it; at least one identifier to be asked. */
export interface CheckPaper {
  key: string;
  openAlexID: string | null;
  doi: string | null;
}

export function openAlexAlias(id: string): string {
  return `openalex:${id}`;
}

export function doiAlias(doi: string): string {
  return `doi:${doi}`;
}

export function checkPaperAliases(paper: CheckPaper): string[] {
  const aliases: string[] = [];
  if (paper.openAlexID) aliases.push(openAlexAlias(paper.openAlexID));
  if (paper.doi) aliases.push(doiAlias(paper.doi));
  return aliases;
}

export type ReferenceListStatus = "success" | "alias" | "not-found";

export interface ReferenceListRow {
  identityKey: string;
  status: ReferenceListStatus;
  openAlexID: string | null;
  referenceIDs: string[] | null;
  fetchedAt: string;
}

/** One answer: the work's canonical ID, its list, every alias it was reached by. */
export interface ReferenceListAnswer {
  openAlexID: string;
  references: string[];
  aliases: string[];
}

/** As `external_works_v2`: a success for 180 days, a not-found for 30. */
export const REFERENCE_LIST_SUCCESS_MAX_AGE_MS = 180 * 86400000;
export const REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS = 30 * 86400000;

export function referenceListRowIsFresh(
  row: ReferenceListRow,
  now: number,
): boolean {
  const age = now - Date.parse(row.fetchedAt);
  if (!Number.isFinite(age)) return false;
  return (
    age <
    (row.status === "not-found"
      ? REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS
      : REFERENCE_LIST_SUCCESS_MAX_AGE_MS)
  );
}

export function referenceListRows(
  found: readonly ReferenceListAnswer[],
  notFoundAliases: readonly string[],
  fetchedAt: string,
): ReferenceListRow[] {
  const rows: ReferenceListRow[] = [];
  for (const answer of found) {
    const primary = openAlexAlias(answer.openAlexID);
    rows.push({
      identityKey: primary,
      status: "success",
      openAlexID: answer.openAlexID,
      referenceIDs: [...answer.references],
      fetchedAt,
    });
    for (const alias of new Set(answer.aliases)) {
      if (alias === primary) continue;
      rows.push({
        identityKey: alias,
        status: "alias",
        openAlexID: answer.openAlexID,
        referenceIDs: null,
        fetchedAt,
      });
    }
  }
  for (const alias of new Set(notFoundAliases)) {
    rows.push({
      identityKey: alias,
      status: "not-found",
      openAlexID: null,
      referenceIDs: null,
      fetchedAt,
    });
  }
  return rows;
}

export class ReferenceListMirror {
  private readonly rows = new Map<string, ReferenceListRow>();

  put(rows: readonly ReferenceListRow[]): void {
    for (const row of rows) this.rows.set(row.identityKey, row);
  }

  clear(): void {
    this.rows.clear();
  }

  get size(): number {
    return this.rows.size;
  }

  /** A fresh check; `null` for a fresh not-found; `undefined` when unknown or stale. */
  lookup(alias: string, now: number): SeedLinkCheck | null | undefined {
    const row = this.rows.get(alias);
    if (!row || !referenceListRowIsFresh(row, now)) return undefined;
    if (row.status === "not-found") return null;
    const target =
      row.status === "success"
        ? row
        : row.openAlexID
          ? this.rows.get(openAlexAlias(row.openAlexID))
          : undefined;
    if (
      !target ||
      target.status !== "success" ||
      !target.openAlexID ||
      !referenceListRowIsFresh(target, now)
    )
      return undefined;
    return {
      openAlexID: target.openAlexID,
      references: target.referenceIDs ?? [],
    };
  }
}

export interface ReferenceListDBRow {
  identity_key: string;
  status: string;
  openalex_id: string | null;
  reference_ids_json: string | null;
  fetched_at: string;
}

const STATUSES = new Set<string>(["success", "alias", "not-found"]);

export function referenceListRowFromDB(
  row: ReferenceListDBRow,
): ReferenceListRow | null {
  const status = String(row.status);
  if (!STATUSES.has(status)) return null;
  let referenceIDs: string[] | null = null;
  if (status === "success") {
    try {
      const parsed: unknown = JSON.parse(String(row.reference_ids_json));
      if (!Array.isArray(parsed)) return null;
      referenceIDs = parsed.filter(
        (id): id is string => typeof id === "string",
      );
    } catch {
      return null;
    }
  }
  return {
    identityKey: String(row.identity_key),
    status: status as ReferenceListStatus,
    openAlexID: row.openalex_id ? String(row.openalex_id) : null,
    referenceIDs,
    fetchedAt: String(row.fetched_at),
  };
}

export function referenceListRowToDB(
  row: ReferenceListRow,
): [string, string, string | null, string | null, string] {
  return [
    row.identityKey,
    row.status,
    row.openAlexID,
    row.referenceIDs ? JSON.stringify(row.referenceIDs) : null,
    row.fetchedAt,
  ];
}
