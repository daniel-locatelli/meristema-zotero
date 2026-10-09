/**
 * The name a short `Author (year)` label shows for a paper's first author: a
 * person's last name, or an institution's whole name (F3), since "ISO/TC 59"
 * cut to its last word reads "59". Null when the paper has no authors.
 */
export function firstAuthorLabelName(paper: {
  authors: readonly string[];
  firstAuthorIsInstitution?: boolean;
}): string | null {
  const first = paper.authors[0]?.trim();
  if (!first) return null;
  if (paper.firstAuthorIsInstitution) return first;
  return first.split(/\s+/).at(-1) ?? first;
}
