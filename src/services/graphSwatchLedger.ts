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
  /**
   * Key to palette index, for every key currently holding one. If `poolSize`
   * shrinks between calls, a live key already holding an index outside
   * `[0, poolSize)` is carried forward unchanged rather than reassigned;
   * validating pool bounds is the caller's job, and the caller that does it
   * is the colour read — `categoricalSwatchAt` in `graphTheme.ts` paints an
   * out-of-range index in the Other tone rather than letting canvas keep the
   * previous draw's colour (B27).
   */
  assigned: Record<string, number>;
  /**
   * Retained for the saved-state shape only — the parser for a persisted
   * recipe still expects this field, so it cannot be dropped from the type.
   * Nothing reads it: reuse always takes the lowest free index, never the
   * longest-released one, so no caller needs departure order. `allocateSwatches`
   * no longer writes to it, for exactly that reason — it used to append one
   * entry per key ever released and never trim, so it grew without bound
   * over a graph's lifetime (one entry per seed ever removed, for the seed
   * ledger). A ledger loaded from an older saved state may still carry old
   * entries in this array; they are dropped on the next `allocateSwatches`
   * call rather than carried forward.
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
 * their index; keys that have gone release theirs; keys that are new take
 * the lowest free index in `[0, poolSize)`, or, once the pool is exhausted
 * (including a `poolSize` of zero, where no index ever exists), double up
 * with the lowest-indexed live holder rather than repaint anyone.
 */
export function allocateSwatches(
  state: SwatchLedgerState,
  keys: readonly string[],
  poolSize: number,
): SwatchLedgerState {
  const live = new Set(keys);
  const assigned: Record<string, number> = {};

  // Hold what is still live.
  for (const [key, index] of Object.entries(state.assigned)) {
    if (live.has(key)) assigned[key] = index;
  }

  const taken = new Set(Object.values(assigned));
  const free: number[] = [];
  for (let index = 0; index < poolSize; index += 1) {
    if (!taken.has(index)) free.push(index);
  }

  // Sorting the newcomers keeps the result independent of the order the caller
  // happened to list them in — the property the old rank sort was reaching for.
  const newcomers = [...live].filter((key) => !(key in assigned)).sort();
  let sharedAt = 0;

  for (const key of newcomers) {
    const reused = free.shift();
    if (typeof reused === "number") {
      assigned[key] = reused;
      continue;
    }
    // The pool is exhausted, or poolSize is zero so no index ever existed:
    // double up with a live holder rather than repaint anyone. The holder is
    // the lowest-indexed one, not the oldest: this state records which index a
    // key holds and not when it took it, so arrival order is not recoverable
    // here. If nobody holds any index either, this newcomer stays unassigned.
    const holders = Object.entries(assigned)
      .sort((left, right) => left[1] - right[1])
      .map(([, index]) => index);
    if (holders.length === 0) continue;
    assigned[key] = holders[sharedAt % holders.length];
    sharedAt += 1;
  }

  return {
    assigned,
    // Never written to any more — see the field's docstring. Always empty
    // rather than carrying old entries forward from `state`, so a ledger
    // loaded from an older saved state sheds them on its first reallocation
    // instead of growing them forever.
    releasedOrder: [],
  };
}
