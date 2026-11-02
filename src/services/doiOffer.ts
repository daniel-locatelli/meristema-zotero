/**
 * F9: a library paper whose DOI field is empty while its stored match carries
 * a DOI. The plugin held that DOI and never wrote it down; this says whether
 * and how to offer it. A confirmed match is offered as one click. An
 * unconfirmed one (a title match) comes with its evidence, for the reader to
 * confirm: a wrong DOI in a library is worse than none.
 */
import type { IdentifierKind } from "../domain/citationTypes";
import { normalizeDOI } from "../domain/workIdentity";

export interface DoiOffer {
  doi: string;
  confirmed: boolean;
  /** For an unconfirmed match: how it was matched, and how sure. */
  evidence: string | null;
}

const MATCHED_BY_LABEL: Partial<Record<IdentifierKind, string>> = {
  doi: "DOI",
  pmid: "PubMed ID",
  arxiv: "arXiv ID",
  isbn: "ISBN",
  title: "title",
};

export function doiOffer(input: {
  /** The match's DOI (the node's, which falls back to the item's). */
  matchedDOI: string | null;
  /** The item's own DOI field, as stored. */
  itemDOI: string;
  /** Whether the item's type has a DOI field at all. */
  fieldValid: boolean;
  matchConfirmed: boolean;
  matchedBy: IdentifierKind | null;
  matchConfidence: number | null;
}): DoiOffer | null {
  if (!input.fieldValid || input.itemDOI.trim()) return null;
  const doi = normalizeDOI(input.matchedDOI);
  if (!doi) return null;
  if (input.matchConfirmed) return { doi, confirmed: true, evidence: null };
  const by = input.matchedBy
    ? (MATCHED_BY_LABEL[input.matchedBy] ?? input.matchedBy)
    : "an unconfirmed match";
  const sure =
    input.matchConfidence === null
      ? ""
      : `, ${Math.round(Math.max(0, Math.min(1, input.matchConfidence)) * 100)}% sure`;
  return {
    doi,
    confirmed: false,
    evidence: `Matched by ${by}${sure}. Check that this is the paper first.`,
  };
}
