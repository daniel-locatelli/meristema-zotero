/**
 * Which papers a graph draws, and what the Scope rail counts.
 *
 * DOM-free and pure on purpose. Stages 3 and 4 insert the hop toggles, the
 * citation floor and the shared-citer filter into the same order, so this is
 * one function with tests rather than a sequence of early returns inside
 * `applyFilters`.
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
