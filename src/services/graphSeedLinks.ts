/**
 * A hop-1 paper's seed links: how many of the reader's seeds it cites, or
 * under References how many cite it (spec: shared citers). Pure, so the scope,
 * the colouring, the Key and the label order read one definition.
 *
 * Only hop 1 has a count. Deeper papers are not graded, and a seed is a seed.
 * The count is of the links the graph knows: the stored lists, cut at 50
 * (ADR 0015), and, with an OpenAlex key, the reference lists OpenAlex holds
 * for the seeds and hop-1 papers (ADR 0018), which find the links the cut
 * dropped.
 */
import type { CitationGraphNode } from "../domain/graphTypes";
import { normalizeDOI } from "../domain/workIdentity";
import { shortOpenAlexID } from "../providers/providerIdentifiers";
import type { HopDirection, SeedMarks } from "./graphHopModel";

/** What the colouring reads, per paper, and what its labels need. */
export interface SeedLinkSource {
  of(key: string): number | undefined;
  seedCount: number;
  direction: HopDirection;
}

/**
 * The seeds among a hop-1 paper's parents. The filter is not redundant: the
 * walk gives an existing entry every parent that links to it, so a hop-1
 * paper can carry a hop-1 parent too.
 */
export function seedLinkCount(
  entry: { hop: number; parents: readonly string[] },
  seedKeys: ReadonlySet<string>,
): number | undefined {
  if (entry.hop !== 1) return undefined;
  return entry.parents.filter((parent) => seedKeys.has(parent)).length;
}

export function seedLinkTierKey(k: number): string {
  return `links:${k}`;
}

export function seedLinkTierLabel(
  k: number,
  seedCount: number,
  direction: HopDirection,
): string {
  const verb = direction === "references" ? "Cited by" : "Cite";
  if (k <= 1) return `${verb} 1 seed`;
  if (k >= seedCount) return `${verb} all ${seedCount} seeds`;
  return `${verb} ${k} of ${seedCount} seeds`;
}

/**
 * The ramp stop a tier takes: all S on the last, 1 on the first. Fixed by k
 * and S alone, so a tier's colour never moves while the fill runs or the
 * floor is dragged.
 */
export function seedLinkRampIndex(
  k: number,
  seedCount: number,
  stops: number,
): number {
  const last = Math.max(0, stops - 1);
  if (seedCount <= 1) return last;
  const clamped = Math.min(seedCount, Math.max(1, k));
  return Math.round(((clamped - 1) / (seedCount - 1)) * last);
}

/**
 * Where a paper sorts among label candidates under the Seeds linked
 * colouring: seeds first, then hop-1 papers by seed links, then the rest.
 */
export function seedLinkLabelRank(
  key: string,
  marks: Pick<SeedMarks, "seedKeys" | "seedLinks">,
): number {
  if (marks.seedKeys.has(key)) return Number.MAX_SAFE_INTEGER;
  return marks.seedLinks.get(key) ?? 0;
}

/** What the check learned about one paper (ADR 0018). */
/** ADR 0018's gate: an OpenAlex key, OpenAlex on, two or more seeds. */
export function seedLinkCheckOpen(options: {
  seedCount: number;
  apiKey: string;
  enabledProviders: readonly string[];
}): boolean {
  return (
    options.seedCount >= 2 &&
    Boolean(options.apiKey) &&
    options.enabledProviders.includes("openalex")
  );
}

export interface SeedLinkCheck {
  openAlexID: string;
  references: readonly string[];
}

export interface OpenAlexIdentifiers {
  openAlexID: string | null;
  doi: string | null;
}

/** An OpenAlex work ID in the one form the check stores, or null. */
export function canonicalOpenAlexID(value: unknown): string | null {
  const id = shortOpenAlexID(value);
  return id && /^W\d+$/i.test(id) ? id.toLocaleUpperCase() : null;
}

/** The identifiers the check asks OpenAlex by, for a seed or a hop-1 paper. */
export function openAlexIdentifiersOf(
  node: Pick<
    CitationGraphNode,
    "provider" | "providerWorkID" | "sourceMetrics" | "externalWork" | "doi"
  >,
): OpenAlexIdentifiers {
  const candidates = [
    node.provider === "openalex" ? node.providerWorkID : null,
    node.sourceMetrics?.libraryUpdateState?.providerWorkIDs?.openalex,
    node.externalWork?.provider === "openalex"
      ? node.externalWork.providerWorkID
      : null,
  ];
  let openAlexID: string | null = null;
  for (const candidate of candidates) {
    openAlexID = canonicalOpenAlexID(candidate);
    if (openAlexID) break;
  }
  return {
    openAlexID,
    doi: normalizeDOI(node.doi ?? node.externalWork?.doi),
  };
}

export interface CheckedPaper {
  key: string;
  check?: SeedLinkCheck;
}

/**
 * The seeds each hop-1 paper links to by the check: under Citers the seeds in
 * its references, under References the seeds whose references hold it.
 */
export function checkedSeedLinks(
  direction: HopDirection,
  seeds: readonly CheckedPaper[],
  hop1: readonly CheckedPaper[],
): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const paper of hop1) {
    if (!paper.check) continue;
    const found: string[] = [];
    for (const seed of seeds) {
      if (!seed.check || seed.key === paper.key) continue;
      const linked =
        direction === "references"
          ? seed.check.references.includes(paper.check.openAlexID)
          : paper.check.references.includes(seed.check.openAlexID);
      if (linked) found.push(seed.key);
    }
    if (found.length) links.set(paper.key, found);
  }
  return links;
}
