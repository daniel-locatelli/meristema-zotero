/**
 * What the Seeds popover lists. Pure, so the three states the popover can be
 * in — the seeds themselves, a library search in flight, a library search
 * done — are decided in one place and tested without a DOM.
 */
export interface SeedPopoverPaper {
  /** `libraryPaperID` for a library paper, the node key for an external one. */
  id: string;
  title: string;
  authors: readonly string[];
  year: number | null;
  sourceTitle: string | null;
}

export interface SeedPopoverRow {
  paper: SeedPopoverPaper;
  isSeed: boolean;
}

export type LibrarySearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed" }
  | { status: "done"; papers: readonly SeedPopoverPaper[] };

export type SeedPopoverList =
  | { kind: "rows"; rows: SeedPopoverRow[] }
  | { kind: "placeholder"; message: string };

export const NO_SEEDS_MESSAGE = "No seeds yet. Search the library to add one.";
export const SEARCHING_MESSAGE = "Searching library…";
export const SEARCH_FAILED_MESSAGE = "Library search failed.";
export const NO_MATCHES_MESSAGE = "No matching papers found.";

export function libraryPaperID(itemID: number): string {
  return `item:${itemID}`;
}

/**
 * A seed that is a library paper gets the library paper's id, so a library
 * search result can be recognised as a seed by id alone. An external seed has
 * no item and keeps its node key.
 */
export function seedPaperID(node: { key: string; itemID: number }): string {
  return node.itemID > 0 ? libraryPaperID(node.itemID) : node.key;
}

export function seedPopoverList(input: {
  query: string;
  seeds: readonly SeedPopoverPaper[];
  library: LibrarySearchState;
}): SeedPopoverList {
  if (!input.query.trim()) {
    if (!input.seeds.length) {
      return { kind: "placeholder", message: NO_SEEDS_MESSAGE };
    }
    return {
      kind: "rows",
      rows: input.seeds.map((paper) => ({ paper, isSeed: true })),
    };
  }
  const { library } = input;
  if (library.status === "idle" || library.status === "searching") {
    return { kind: "placeholder", message: SEARCHING_MESSAGE };
  }
  if (library.status === "failed") {
    return { kind: "placeholder", message: SEARCH_FAILED_MESSAGE };
  }
  if (!library.papers.length) {
    return { kind: "placeholder", message: NO_MATCHES_MESSAGE };
  }
  const seedIDs = new Set(input.seeds.map((seed) => seed.id));
  return {
    kind: "rows",
    rows: library.papers.map((paper) => ({
      paper,
      isSeed: seedIDs.has(paper.id),
    })),
  };
}
