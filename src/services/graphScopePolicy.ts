export function normalizedScopeItemIDs(itemIDs: readonly number[]): number[] {
  return [
    ...new Set(
      itemIDs.filter((itemID) => Number.isInteger(itemID) && itemID > 0),
    ),
  ];
}

export function replaceItemScope(itemIDs: readonly number[]): Set<number> {
  return new Set(normalizedScopeItemIDs(itemIDs));
}

/**
 * A null map scope means the complete library is already included, so adding
 * individual papers does not need to narrow or otherwise mutate that scope.
 */
export function extendItemScope(
  current: ReadonlySet<number> | null,
  itemIDs: readonly number[],
): Set<number> | null {
  if (current === null) return null;
  return new Set([...current, ...normalizedScopeItemIDs(itemIDs)]);
}

export function appendUniqueScopeKeys(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  return [...new Set([...current, ...additions].filter(Boolean))];
}
