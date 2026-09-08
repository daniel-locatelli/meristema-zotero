export function normalizedScopeItemIDs(itemIDs: readonly number[]): number[] {
  return [
    ...new Set(
      itemIDs.filter((itemID) => Number.isInteger(itemID) && itemID > 0),
    ),
  ];
}
