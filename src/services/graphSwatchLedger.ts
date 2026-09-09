/**
 * Which palette index a key holds, and for how long.
 *
 * Colour used to be dealt by **rank**: categories were ordered by how many
 * nodes carried them and took the swatches in that order, so ticking one
 * folder changed the counts and repainted the others (backlog B12). Seeds had
 * the same fault by another route — they were indexed by their position in the
 * seed list, so removing the first repainted the rest.
 *
 * Here a key takes the lowest free index the first time it is seen and keeps
 * it for as long as it is present. Rank still decides which categories are
 * named and which collapse into "Other"; it no longer decides any colour.
 *
 * Plain data, no DOM: the state serialises straight into the graph's saved
 * recipe, so a reopened graph reproduces every colour it had.
 */

export interface SwatchLedgerState {
  /** Key to palette index, for every key currently holding one. */
  assigned: Record<string, number>;
  /**
   * Keys whose index has been freed, longest-released first. Only the order
   * matters; the keys are kept so the reuse order is inspectable in a saved
   * state rather than being a number nobody can explain.
   */
  releasedOrder: string[];
}

export function emptySwatchLedger(): SwatchLedgerState {
  return { assigned: {}, releasedOrder: [] };
}

export function swatchIndexFor(
  state: SwatchLedgerState,
  key: string,
): number | null {
  const index = state.assigned[key];
  return typeof index === "number" ? index : null;
}

/**
 * The ledger after `keys` are the only live keys. Keys that are present keep
 * their index; keys that have gone release theirs; keys that are new take the
 * longest-released free index, or the lowest never-used one.
 */
export function allocateSwatches(
  state: SwatchLedgerState,
  keys: readonly string[],
  poolSize: number,
): SwatchLedgerState {
  const live = new Set(keys);
  const assigned: Record<string, number> = {};
  const releasedOrder = [...state.releasedOrder];

  // Hold what is still live.
  for (const [key, index] of Object.entries(state.assigned)) {
    if (live.has(key)) assigned[key] = index;
    else if (!releasedOrder.includes(key)) releasedOrder.push(key);
  }

  const freed: number[] = [];
  for (const key of releasedOrder) {
    const index = state.assigned[key];
    if (typeof index === "number") freed.push(index);
  }

  const taken = new Set(Object.values(assigned));
  const never: number[] = [];
  for (let index = 0; index < poolSize; index += 1) {
    if (!taken.has(index) && !freed.includes(index)) never.push(index);
  }

  // Sorting the newcomers keeps the result independent of the order the caller
  // happened to list them in — the property the old rank sort was reaching for.
  const newcomers = [...live].filter((key) => !(key in assigned)).sort();
  let sharedAt = 0;

  for (const key of newcomers) {
    const reused = never.length ? never.shift() : freed.shift();
    if (typeof reused === "number") {
      assigned[key] = reused;
      continue;
    }
    // The pool is exhausted: double up with the oldest live holder rather than
    // repaint anyone. The rail's hover tells the two apart.
    const holders = Object.entries(assigned)
      .sort((left, right) => left[1] - right[1])
      .map(([, index]) => index);
    assigned[key] = holders[sharedAt % holders.length] ?? 0;
    sharedAt += 1;
  }

  return {
    assigned,
    releasedOrder: releasedOrder.filter((key) => !(key in assigned)),
  };
}
