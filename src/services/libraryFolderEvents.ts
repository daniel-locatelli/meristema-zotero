/*
 * A folder in a library was added, renamed, moved, trashed or deleted (B58).
 * It carries nothing: every open graph rebuilds its own snapshot's folder list,
 * which is one walk of Zotero.Collections, so there is nothing to filter on.
 * hooks.ts publishes it from the library snapshot observer, and each mounted
 * graph subscribes. It is a module of its own for the reason
 * relationshipEvents.ts's manual-relation ping is: hooks.ts reaching into
 * graphViewService would close an import cycle.
 */
type LibraryFoldersChangedListener = () => void;

const listeners = new Set<LibraryFoldersChangedListener>();

export function subscribeLibraryFoldersChanged(
  listener: LibraryFoldersChangedListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishLibraryFoldersChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      Zotero.debug(
        `Meristema: library-folders listener failed: ${String(error)}`,
      );
    }
  }
}
