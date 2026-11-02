/**
 * F12: a folder picked in Zotero's collection tree lights its region in the
 * open detached graph windows. The tree lives in the library tab, so a graph
 * tab is never showing while the reader picks one; a detached window is the
 * graph that can answer, beside the tree.
 *
 * Kept apart from the item selection binding, which it would otherwise
 * complicate, and testable through `deps` without a Zotero window.
 */

export interface CollectionTreeLike {
  onSelect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
}

export interface CollectionSelectionDeps {
  /** `ZoteroPane.collectionsView`, or null while the pane is still starting. */
  collectionsView(): CollectionTreeLike | null;
  /** The selected row's collection ID, or null for a library, a search, etc. */
  selectedCollectionID(): number | null;
  debug(message: string): void;
}

export interface CollectionSelectionBinding {
  dispose(): void;
}

function defaultDeps(host: Window): CollectionSelectionDeps {
  const pane = (): {
    collectionsView?: unknown;
    getSelectedCollection?: (asID?: boolean) => unknown;
  } | null =>
    (host as unknown as { ZoteroPane?: Record<string, unknown> }).ZoteroPane ??
    null;
  return {
    collectionsView: () => {
      const view = pane()?.collectionsView;
      return view && typeof view === "object"
        ? (view as CollectionTreeLike)
        : null;
    },
    selectedCollectionID: () => {
      const id = Number(pane()?.getSelectedCollection?.(true));
      return Number.isInteger(id) && id > 0 ? id : null;
    },
    debug: (message) => Zotero.debug(message),
  };
}

/**
 * Calls `onCollection` each time the tree's selection moves to a folder other
 * than the one it last reported. What is selected when the binding attaches
 * is not reported: only a pick the reader makes from now on.
 */
export function bindZoteroCollectionSelection(
  host: Window,
  onCollection: (collectionID: number) => void,
  deps: CollectionSelectionDeps = defaultDeps(host),
): CollectionSelectionBinding {
  let tree: CollectionTreeLike | null = null;
  let last: number | null = null;
  let disposed = false;

  const onSelect = (): void => {
    if (disposed) return;
    let id: number | null;
    try {
      id = deps.selectedCollectionID();
    } catch (error) {
      deps.debug(`Meristema: reading the folder selection failed: ${error}`);
      return;
    }
    if (id === last) return;
    last = id;
    if (id === null) return;
    try {
      onCollection(id);
    } catch (error) {
      deps.debug(`Meristema: a folder selection subscriber failed: ${error}`);
    }
  };

  try {
    tree = deps.collectionsView();
    if (tree) {
      tree.onSelect.addListener(onSelect);
      last = deps.selectedCollectionID();
    } else {
      deps.debug("Meristema: collection tree not ready; folder sync is off.");
    }
  } catch (error) {
    deps.debug(`Meristema: collection tree listener failed: ${error}`);
    tree = null;
  }

  return {
    dispose() {
      disposed = true;
      try {
        tree?.onSelect.removeListener(onSelect);
      } catch {
        // The tree may already be gone with its window.
      }
      tree = null;
    },
  };
}
