import type { RelatedWorkMetadata } from "../domain/citationTypes";

type ExternalWorkSummary = Pick<
  RelatedWorkMetadata,
  "authors" | "sourceTitle" | "year" | "citationCount" | "referenceCount"
>;

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { useGrouping: false }).format(value);
}

export function externalWorkAuthorsText(
  work: Pick<RelatedWorkMetadata, "authors">,
): string {
  return work.authors.length
    ? work.authors.slice(0, 6).join(", ")
    : "Authors unavailable";
}

/** "1 citation", not "1 citations" — the count is read, not parsed. */
function counted(value: number | null | undefined, noun: string): string {
  if (value === null || value === undefined) return "";
  return `${formatCount(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function externalWorkMetadataText(
  work: ExternalWorkSummary,
  recommendationScore: number | undefined,
): string {
  return [
    work.sourceTitle,
    work.year,
    counted(work.citationCount, "citation"),
    counted(work.referenceCount, "reference"),
    recommendationScore
      ? `connected to ${recommendationScore} visible ${recommendationScore === 1 ? "paper" : "papers"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
