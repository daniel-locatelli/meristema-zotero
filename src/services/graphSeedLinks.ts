/**
 * A hop-1 paper's seed links: how many of the reader's seeds it cites, or
 * under References how many cite it (spec: shared citers). Pure, so the scope,
 * the colouring, the Key and the label order read one definition.
 *
 * Only hop 1 has a count. Deeper papers are not graded, and a seed is a seed.
 * The count is of the links the graph holds: a seed's hop-1 list is cut at 50
 * (ADR 0015), so a paper citing two seeds that made one cut reads 1.
 */
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
