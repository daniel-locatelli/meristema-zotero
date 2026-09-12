/**
 * Which papers a graph draws, and what the Scope rail counts.
 *
 * DOM-free and pure on purpose. Stage 3 has inserted the hop rule; Stage 4
 * inserts the citation floor and the shared-citer filter into the same
 * order, so this is one function with tests rather than a sequence of early
 * returns inside `applyFilters`.
 */

/**
 * Folder ticks as a base and its exceptions, never as a list of ticked
 * folders. A library graph is `all`, so a folder created next week has its
 * papers on the plot as the rest of the library does; a graph opened on two
 * folders is `none`, so that same new folder does not quietly appear in a
 * graph that was never about it. The base is set when the graph is created,
 * and unticking rows never flips it.
 */
export type GraphViewCollectionTicks =
  /** Every folder is ticked except these. A folder made later is ticked. */
  | { base: "all"; except: number[] }
  /** No folder is ticked except these. A folder made later is not. */
  | { base: "none"; except: number[] };

export type CollectionTickState = "on" | "off" | "mixed";

function normalizedIDs(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b,
  );
}

export function allCollectionsTicked(): GraphViewCollectionTicks {
  return { base: "all", except: [] };
}

export function onlyCollectionsTicked(
  collectionIDs: readonly number[],
): GraphViewCollectionTicks {
  return { base: "none", except: normalizedIDs(collectionIDs) };
}

export function isCollectionTicked(
  ticks: GraphViewCollectionTicks,
  collectionID: number,
): boolean {
  const listed = ticks.except.includes(collectionID);
  return ticks.base === "all" ? !listed : listed;
}

/**
 * Tick or untick a set of folders at once. The caller passes the folder and
 * every descendant of it, because toggling a parent writes the same tick to
 * its whole subtree: `collectionScopeIDs` already expands a selected folder
 * that way, so a tree where a parent left its children alone would quietly
 * shrink every saved folder graph the first time it was opened.
 */
export function setCollectionTicks(
  ticks: GraphViewCollectionTicks,
  collectionIDs: readonly number[],
  ticked: boolean,
): GraphViewCollectionTicks {
  // Under `all` an exception is an unticked folder; under `none` it is a
  // ticked one. One expression, so the two halves cannot drift apart.
  const isException = ticked !== (ticks.base === "all");
  const except = new Set(ticks.except);
  for (const collectionID of normalizedIDs(collectionIDs)) {
    if (isException) except.add(collectionID);
    else except.delete(collectionID);
  }
  return ticks.base === "all"
    ? { base: "all", except: normalizedIDs([...except]) }
    : { base: "none", except: normalizedIDs([...except]) };
}

/**
 * Every exception grows to cover its descendants. Used once, on a recipe
 * migrated from version 1: that recipe named the folders the graph was scoped
 * to, and version 1 drew each of them through `descendants()`, so the ticks it
 * becomes have to say the same thing. Never applied to ticks the rail wrote —
 * a child unticked under a ticked parent would come back.
 */
export function expandTicksThroughDescendants(
  ticks: GraphViewCollectionTicks,
  descendantsByID: ReadonlyMap<number, readonly number[]>,
): GraphViewCollectionTicks {
  const except = new Set(ticks.except);
  for (const collectionID of ticks.except) {
    for (const descendant of descendantsByID.get(collectionID) ?? []) {
      except.add(descendant);
    }
  }
  return ticks.base === "all"
    ? { base: "all", except: normalizedIDs([...except]) }
    : { base: "none", except: normalizedIDs([...except]) };
}

/**
 * What the folder's checkbox draws. A parent whose descendants disagree with
 * it is mixed; each child still owns a checkbox of its own.
 */
export function collectionTickState(
  ticks: GraphViewCollectionTicks,
  collectionID: number,
  descendantIDs: readonly number[],
): CollectionTickState {
  const own = isCollectionTicked(ticks, collectionID);
  const disagrees = descendantIDs.some(
    (id) => isCollectionTicked(ticks, id) !== own,
  );
  if (disagrees) return "mixed";
  return own ? "on" : "off";
}

/** A paper as the scope rules see it. Everything else about it is irrelevant. */
export interface ScopePaper {
  key: string;
  /** The library folders it is filed in. Empty means unfiled or external. */
  collectionIDs: readonly number[];
  /** False for a paper that is not in Zotero. */
  inLibrary: boolean;
}

/** What the hop rule needs of an entry; structurally `HopEntry` from graphHopModel.ts. */
export interface ScopeHopEntry {
  hop: number;
  parents: readonly string[];
}

export interface GraphScopeHops {
  entries: ReadonlyMap<string, ScopeHopEntry>;
  /** The deepest hop opened, 1..6. */
  depth: number;
  /** By hop; index 0 is the seeds and is always treated as true. */
  enabled: readonly boolean[];
}

export interface GraphScopeInput {
  /** Every paper the graph holds, library and external together. */
  papers: readonly ScopePaper[];
  seedKeys: ReadonlySet<string>;
  /** The hop model's entries, depth and per-hop toggles; empty when seedless. */
  hops: GraphScopeHops;
  ticks: GraphViewCollectionTicks;
  includeUnfiled: boolean;
  includeExternal: boolean;
  hiddenKeys: ReadonlySet<string>;
  /**
   * The Filter popover's remaining facets: tags, item type, year, and the
   * data-quality switches. Not the search box, which narrows what is drawn
   * without changing a single count the rail prints.
   */
  facetAdmits: (key: string) => boolean;
}

export interface GraphScopeResult {
  visibleKeys: Set<string>;
  /** What survives every rule, before the search box. */
  shown: number;
  /** Every paper the graph holds. */
  total: number;
  /** Papers in the graph filed in each folder, counting its own members only. */
  countByCollection: Map<number, number>;
  unfiledCount: number;
  externalCount: number;
  hiddenCount: number;
  /** Papers that survived every rule at each hop; index 0 is the seeds. */
  shownByHop: number[];
  /** Papers the walk reached at each hop, whatever the rules said. */
  availableByHop: number[];
}

/**
 * The spec's order, and the reason it is an order rather than a conjunction.
 *
 * A seed is visible, always, and no later rule can hide one. Every other paper
 * is admitted by the folder rule or by the hop rule and can then be removed by
 * the rules after them.
 *
 * The two admitting rules sit *beside* each other: adding a seed only ever
 * adds papers, unticking a folder never removes a paper a hop brought in, and
 * unticking a hop never removes a paper you filed and ticked. Folder ticks are
 * a fact about how you filed a paper, so they say nothing about one you have
 * never filed; a year, an item type, a retraction and being outside Zotero
 * are facts about the paper itself, so they are true of a citer exactly as
 * they are of anything else.
 *
 * The hop rule reads a parent's visibility, so papers are walked in hop
 * order: a parent is settled before its children ask about it.
 */
export function computeGraphScope(input: GraphScopeInput): GraphScopeResult {
  const visibleKeys = new Set<string>();
  const countByCollection = new Map<number, number>();
  let unfiledCount = 0;
  let externalCount = 0;
  let hiddenCount = 0;
  const depth = input.hops.depth;
  const shownByHop = Array.from({ length: depth + 1 }, () => 0);
  const availableByHop = Array.from({ length: depth + 1 }, () => 0);

  const hopOf = (key: string): number =>
    input.hops.entries.get(key)?.hop ?? Number.POSITIVE_INFINITY;
  const ordered = [...input.papers].sort((a, b) => hopOf(a.key) - hopOf(b.key));

  for (const paper of ordered) {
    if (!paper.inLibrary) externalCount += 1;
    else if (!paper.collectionIDs.length) unfiledCount += 1;
    for (const collectionID of paper.collectionIDs) {
      countByCollection.set(
        collectionID,
        (countByCollection.get(collectionID) ?? 0) + 1,
      );
    }
    if (input.hiddenKeys.has(paper.key)) hiddenCount += 1;
    const entry = input.hops.entries.get(paper.key);
    if (entry && entry.hop <= depth) availableByHop[entry.hop] += 1;

    if (input.seedKeys.has(paper.key)) {
      visibleKeys.add(paper.key);
      shownByHop[0] += 1;
      continue;
    }
    const folderAdmitted =
      paper.inLibrary &&
      (paper.collectionIDs.length
        ? paper.collectionIDs.some((collectionID) =>
            isCollectionTicked(input.ticks, collectionID),
          )
        : input.includeUnfiled);
    const hopAdmitted =
      entry !== undefined &&
      entry.hop <= depth &&
      input.hops.enabled[entry.hop] !== false &&
      entry.parents.some((parent) => visibleKeys.has(parent));
    if (!folderAdmitted && !hopAdmitted) continue;
    if (!paper.inLibrary && !input.includeExternal) continue;
    if (input.hiddenKeys.has(paper.key)) continue;
    if (!input.facetAdmits(paper.key)) continue;
    visibleKeys.add(paper.key);
    if (entry && entry.hop <= depth) shownByHop[entry.hop] += 1;
  }

  return {
    visibleKeys,
    shown: visibleKeys.size,
    total: input.papers.length,
    countByCollection,
    unfiledCount,
    externalCount,
    hiddenCount,
    shownByHop,
    availableByHop,
  };
}

/**
 * Seeding a paper is an instruction to look at it, so an earlier instruction
 * to hide it is spent. The same applies to a paper restored by Show all,
 * which empties the set outright.
 */
export function purgeHiddenKeys(
  hiddenKeys: ReadonlySet<string>,
  seedKeys: readonly string[],
): Set<string> {
  const seeds = new Set(seedKeys);
  return new Set([...hiddenKeys].filter((key) => !seeds.has(key)));
}
