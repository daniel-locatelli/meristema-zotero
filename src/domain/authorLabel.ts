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

/** The longest label the plot draws unhovered, in characters. */
export const LABEL_MAX_LENGTH = 42;

/** A label cut to `max` characters, its last three given to the ellipsis. */
export function cutLabel(text: string, max = LABEL_MAX_LENGTH): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

/**
 * A paper's short `Author (year)` label. A paper with no creators names
 * itself by its Short Title, else the start of its title, cut so the year
 * survives the plot's 42-character cut (F3: an ISO standard reads
 * "ISO 19650-1 (2018)"). Unknown only when there is no title either.
 */
export function authorYearLabel(paper: {
  authors: readonly string[];
  firstAuthorIsInstitution?: boolean;
  shortTitle?: string | null;
  title: string;
  year: number | null;
}): string {
  const year = paper.year ? ` (${paper.year})` : "";
  const stand = paper.shortTitle?.trim() || paper.title.trim();
  const name =
    firstAuthorLabelName(paper) ??
    (stand ? cutLabel(stand, LABEL_MAX_LENGTH - year.length) : "Unknown");
  return `${name}${year}`;
}
