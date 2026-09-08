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
 * The loop guard is symmetric. A set the binding itself selected comes back
 * once as Zotero's echo and is swallowed; a set equal to the current one is
 * never republished. Everything Zotero is asked for happens inside a try, so
 * a failure here is a debug line and no sync, never a broken item list.
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
  /** Tree-level select of listed rows only: no jump, no focus, no tab switch. */
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
  /** The set this binding asked Zotero for, whose echo is still to come. */
  let mine: number[] | null = null;
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
      if (mine && sameItemIDs(next, mine)) {
        mine = null;
        return;
      }
      mine = null;
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
      mine = ids;
      let selecting: Promise<number>;
      try {
        selecting = target.selectItems([...ids], true);
      } catch (error) {
        mine = null;
        deps.debug(`Meristema: selecting listed rows failed: ${String(error)}`);
        return;
      }
      selecting.then(
        (count) => {
          if (count === 0 && mine && sameItemIDs(mine, ids)) mine = null;
        },
        (error) => {
          if (mine && sameItemIDs(mine, ids)) mine = null;
          deps.debug(
            `Meristema: selecting listed rows failed: ${String(error)}`,
          );
        },
      );
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
