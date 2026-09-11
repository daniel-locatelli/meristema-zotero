/// <reference lib="dom" />
/**
 * Keeps Zotero's item-list selection and the graph's in step.
 *
 * Zotero's items tree fires `onSelect` after every selection change, and after
 * some non-changes, with no arguments. This binding turns that into a stream
 * of item-ID sets that only moves when the set moves, and offers the graph a
 * way to select a listed row without the jump `ZoteroPane.selectItems` makes
 * (collection switch, quick-search reset, focus to the list).
 *
 * The binding publishes every change it sees, its own `selectListed` echo
 * included: that echo is how a click in one graph reaches the sibling graphs
 * of the same window. A set equal to the current one is never republished, and
 * a view applying a synced selection does not report it back, so nothing
 * loops. Everything Zotero is asked for happens inside a try, so a failure
 * here is a debug line and no sync, never a broken item list.
 *
 * One selection is not followed: a paper the list has no row for. Zotero's
 * `selectItems` returns 0 for it and leaves the list where it was, so the
 * graph would say one paper and the list another with nothing to say they
 * disagree (backlog B30). The binding clears the list instead, and takes the
 * empty set as current before Zotero echoes it, so the clear reaches no
 * graph: the one that was clicked keeps its node, its siblings keep theirs.
 */

export interface LibrarySelection {
  /** Sorted ascending, no duplicates. Empty when nothing is selected. */
  itemIDs: number[];
}

/** The subset of Zotero's items tree the binding touches. */
export interface ItemsTreeLike {
  onSelect: {
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  };
  getSelectedItems(asIDs: true): number[];
  selectItems(ids: number[], noRecurse: boolean): Promise<number>;
  /** The tree's own selection object; `clearSelection` empties the list. */
  selection: { clearSelection(): void };
}

/** Injectable so the binding is unit tested without Zotero. */
export interface ZoteroSelectionSyncDeps {
  /** `ZoteroPane.itemsView`, or null while the pane is still starting. */
  itemsView(): ItemsTreeLike | null;
  debug(message: string): void;
}

export interface ZoteroSelectionBinding {
  /**
   * The list's selection when the binding attached, then the last published
   * set. Returns a copy.
   */
  current(): LibrarySelection;
  /**
   * Tree-level select of listed rows only: no jump, no focus, no tab switch.
   * When none of the rows is listed, the list is cleared rather than left on
   * whatever it had (B30); that clear is not published.
   */
  selectListed(itemIDs: readonly number[]): void;
  /** Listeners receive a copy. Returns the unsubscribe function. */
  subscribe(listener: (selection: LibrarySelection) => void): () => void;
  /** Removes the tree listener and drops every subscriber. */
  dispose(): void;
}

export function normalizeItemIDs(itemIDs: readonly number[]): number[] {
  return [
    ...new Set(itemIDs.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((left, right) => left - right);
}

export function sameItemIDs(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function defaultDeps(host: Window): ZoteroSelectionSyncDeps {
  return {
    itemsView: () => {
      const pane = (host as unknown as { ZoteroPane?: { itemsView?: unknown } })
        .ZoteroPane;
      const view = pane?.itemsView;
      return view && typeof view === "object" ? (view as ItemsTreeLike) : null;
    },
    debug: (message) => Zotero.debug(message),
  };
}

export function bindZoteroSelection(
  host: Window,
  deps: ZoteroSelectionSyncDeps = defaultDeps(host),
): ZoteroSelectionBinding {
  const listeners = new Set<(selection: LibrarySelection) => void>();
  let current: number[] = [];
  let tree: ItemsTreeLike | null = null;
  let loggedMissing = false;
  let disposed = false;

  const publish = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener({ itemIDs: [...current] });
      } catch (error) {
        deps.debug(
          `Meristema: selection sync subscriber failed: ${String(error)}`,
        );
      }
    }
  };

  const onSelect = (): void => {
    try {
      if (!tree) return;
      const next = normalizeItemIDs(tree.getSelectedItems(true));
      if (sameItemIDs(next, current)) return;
      current = next;
      publish();
    } catch (error) {
      deps.debug(
        `Meristema: reading the item selection failed: ${String(error)}`,
      );
    }
  };

  /** The tree, attaching the listener the first time it is there. */
  const attach = (): ItemsTreeLike | null => {
    if (tree || disposed) return tree;
    let found: ItemsTreeLike | null = null;
    try {
      found = deps.itemsView();
    } catch (error) {
      deps.debug(`Meristema: items tree lookup failed: ${String(error)}`);
    }
    if (!found) {
      if (!loggedMissing) {
        loggedMissing = true;
        deps.debug("Meristema: items tree not ready; selection sync waits.");
      }
      return null;
    }
    try {
      found.onSelect.addListener(onSelect);
      tree = found;
      // The list may already have a selection; a view rendered now should
      // see it without waiting for the next click.
      try {
        current = normalizeItemIDs(found.getSelectedItems(true));
      } catch (error) {
        deps.debug(
          `Meristema: reading the live item selection failed: ${String(error)}`,
        );
      }
    } catch (error) {
      deps.debug(`Meristema: items tree listener failed: ${String(error)}`);
      return null;
    }
    return tree;
  };

  attach();

  return {
    current() {
      attach();
      return { itemIDs: [...current] };
    },
    selectListed(itemIDs) {
      const target = attach();
      if (!target) return;
      const ids = normalizeItemIDs(itemIDs);
      if (!ids.length || sameItemIDs(ids, current)) return;
      let selecting: Promise<number>;
      try {
        selecting = target.selectItems([...ids], true);
      } catch (error) {
        deps.debug(`Meristema: selecting listed rows failed: ${String(error)}`);
        return;
      }
      // Not awaited: the tree fires `onSelect` when it has selected, and that
      // is what moves `current` and reaches the graphs. A count of zero means
      // no row was listed and the list still shows what it showed before; it
      // is cleared, with `current` set first so the echo is a no-op.
      selecting
        .then((count) => {
          if (count !== 0 || disposed || tree !== target) return;
          current = [];
          target.selection.clearSelection();
        })
        .catch((error: unknown) => {
          deps.debug(
            `Meristema: selecting listed rows failed: ${String(error)}`,
          );
        });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (tree) {
        try {
          tree.onSelect.removeListener(onSelect);
        } catch (error) {
          deps.debug(
            `Meristema: removing the selection listener failed: ${String(error)}`,
          );
        }
        tree = null;
      }
    },
  };
}
