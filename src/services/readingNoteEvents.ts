/*
 * A note or a folder membership changed somewhere in Zotero, which may be a
 * reading-list note, a read-state note, or a paper filed into or out of a list
 * folder. It carries nothing: each open graph debounces and reloads its own
 * reading source, so there is nothing to filter on. hooks.ts publishes it from
 * a notifier observer. A module of its own for the reason libraryFolderEvents.ts
 * is: hooks.ts reaching into graphViewService would close an import cycle.
 */
type ReadingNotesChangedListener = () => void;

const listeners = new Set<ReadingNotesChangedListener>();

export function subscribeReadingNotesChanged(
  listener: ReadingNotesChangedListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishReadingNotesChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      Zotero.debug(
        `Meristema: reading-notes listener failed: ${String(error)}`,
      );
    }
  }
}
