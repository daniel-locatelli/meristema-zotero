/**
 * Which shown paper the runner expands next. Pure. Scope gates: a paper is in
 * the plan only while it is visible. The camera orders: it moves papers up the
 * list and never adds or removes one (spec, "The fill").
 */
import type { HopEntry } from "./graphHopModel";

/** Expansions per hop per direction per session before Fetch more is needed. */
export const HOP_EXPANSION_CAP = 500;

export interface HopFillInput {
  entries: ReadonlyMap<string, HopEntry>;
  visibleKeys: ReadonlySet<string>;
  depth: number;
  selectedKey: string | null;
  hoveredKey: string | null;
  onScreenKeys: ReadonlySet<string>;
  failedKeys: ReadonlySet<string>;
  /** Expansions landed this session, by hop. */
  expandedByHop: readonly number[];
  /** The cap in force, by hop. */
  capByHop: readonly number[];
  /** The paper's reported count in the direction, or null when unknown. */
  reportedCountOf: (key: string) => number | null;
}

export interface HopFillPlan {
  /** Keys to expand, first first. */
  order: string[];
  /** Qualifying papers not yet expanded, by hop, cap or no cap. */
  remainingByHop: number[];
  /** Qualifying papers a hop's cap holds back, by hop. */
  waitingByHop: number[];
}

function rank(key: string, entry: HopEntry, input: HopFillInput): number {
  if (entry.hop === 0) return 0;
  if (key === input.selectedKey) return 1;
  if (key === input.hoveredKey) return 2;
  if (input.onScreenKeys.has(key)) return 3;
  return 4;
}

function parentCount(entry: HopEntry, input: HopFillInput): number {
  let best = -1;
  for (const parent of entry.parents) {
    const count = input.reportedCountOf(parent);
    if (count !== null && count > best) best = count;
  }
  return best;
}

export function planHopFill(input: HopFillInput): HopFillPlan {
  const remainingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const waitingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const candidates: Array<{ key: string; entry: HopEntry }> = [];
  for (const [key, entry] of input.entries) {
    if (entry.hop >= input.depth) continue;
    if (!input.visibleKeys.has(key)) continue;
    if (entry.expanded || input.failedKeys.has(key)) continue;
    remainingByHop[entry.hop] += 1;
    const expanded = input.expandedByHop[entry.hop] ?? 0;
    const cap = input.capByHop[entry.hop] ?? HOP_EXPANSION_CAP;
    if (expanded >= cap) {
      waitingByHop[entry.hop] += 1;
      continue;
    }
    candidates.push({ key, entry });
  }
  candidates.sort((left, right) => {
    const byRank =
      rank(left.key, left.entry, input) - rank(right.key, right.entry, input);
    if (byRank) return byRank;
    const byParent =
      parentCount(right.entry, input) - parentCount(left.entry, input);
    if (byParent) return byParent;
    return left.key.localeCompare(right.key);
  });
  return {
    order: candidates.map((candidate) => candidate.key),
    remainingByHop,
    waitingByHop,
  };
}
