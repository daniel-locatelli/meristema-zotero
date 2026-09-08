/**
 * What a Zotero selection becomes in a graph.
 *
 * One present node is selected; two or more are emphasised through the Key's
 * emphasis so the rest of the graph fades; none clears both. "Present" means
 * the item has a node and the node is visible under the current filters. The
 * view supplies both lookups so this stays a pure decision.
 */

export interface LibrarySelectionResolution {
  select: string | null;
  emphasise: ReadonlySet<string> | null;
}

export function resolveLibrarySelection(
  itemIDs: readonly number[],
  nodeKeyForItem: (itemID: number) => string | null,
  visibleKeys: ReadonlySet<string>,
): LibrarySelectionResolution {
  const present = new Set<string>();
  for (const itemID of itemIDs) {
    const key = nodeKeyForItem(itemID);
    if (key && visibleKeys.has(key)) present.add(key);
  }
  if (present.size === 1) {
    return { select: [...present][0], emphasise: null };
  }
  if (present.size > 1) {
    return { select: null, emphasise: present };
  }
  return { select: null, emphasise: null };
}
