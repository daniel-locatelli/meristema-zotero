/**
 * Running connection updates, by library and node key (F5, B112). They live
 * outside the graph view because a library change remounts the view while an
 * update runs: the new view reads the same entry, so it shows the update
 * running and a second request starts no second fetch.
 */
const running = new Map<string, Promise<boolean>>();

const keyOf = (libraryID: number, nodeKey: string): string =>
  `${libraryID}:${nodeKey}`;

/** The update running for this paper, if any; it resolves true once it succeeds. */
export function runningConnectionUpdate(
  libraryID: number,
  nodeKey: string,
): Promise<boolean> | undefined {
  return running.get(keyOf(libraryID, nodeKey));
}

/**
 * Starts `fetch` for this paper unless an update already runs for it, and
 * returns the one that runs. It never rejects: a failure is logged and
 * resolves false. The entry leaves the registry before anything chained on
 * the returned promise runs, so a view redrawn then shows the update ended.
 */
export function startConnectionUpdate(
  libraryID: number,
  nodeKey: string,
  fetch: () => Promise<void>,
): Promise<boolean> {
  const key = keyOf(libraryID, nodeKey);
  const existing = running.get(key);
  if (existing) return existing;
  const run = fetch().then(
    () => {
      running.delete(key);
      return true;
    },
    (error: unknown) => {
      running.delete(key);
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    },
  );
  running.set(key, run);
  return run;
}
