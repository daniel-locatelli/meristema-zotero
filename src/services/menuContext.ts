import { positiveInteger } from "../domain/valueNormalization";

// Everything in this module answers one question: what did the user
// right-click? The answer comes from the menu context Zotero hands to
// `onShowing` and from nowhere else.
//
// Reading `ZoteroPane` here is what broke the menus before. When the
// right-clicked row was not a collection, or held no regular items, a pane
// fallback answered with whatever happened to be selected elsewhere and
// reported the entries available — so they appeared on My Library, Trash,
// Unfiled Items, saved searches, group roots, notes and attachments alike.
// These predicates take no fallback. An unrecognised row is not a match.

function contextValue(context: any, key: string): any {
  try {
    return context?.[key];
  } catch {
    return null;
  }
}

/** The regular, untrashed items the user right-clicked. */
export function contextRegularItems(context: any): Zotero.Item[] {
  const items = contextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

/**
 * The IDs of the folders the user right-clicked, in selection order, or an
 * empty list when the selection is anything else: a library or group root, a
 * saved search, Trash, Unfiled Items, Duplicate Items, Publications, a feed.
 *
 * Zotero supplies the selected rows as `collectionTreeRows`, an array, because
 * the collection tree supports multi-select. Earlier builds supplied a single
 * `collectionTreeRow`, and current ones make that name THROW rather than
 * return undefined — so the singular is read second and only as a fallback for
 * older builds. Reading it first yields an exception on every modern build,
 * which `contextValue` turns into null and the menu into silence.
 *
 * A mixed selection yields nothing rather than the folders it could find.
 * Graphing two folders and quietly dropping the Trash row the user also
 * selected would break the rule learned from the single-row case: the entry
 * appears when what you right-clicked is folders.
 *
 * Returns IDs rather than collections so this module needs no Zotero globals.
 * `openGraphForCollections` performs the lookup itself.
 */
export function contextCollectionIDs(context: any): number[] {
  const rows = contextValue(context, "collectionTreeRows");
  const selected = Array.isArray(rows)
    ? rows
    : [contextValue(context, "collectionTreeRow")];
  const ids: number[] = [];
  for (const row of selected) {
    if (row?.isCollection?.() !== true) return [];
    const ref = contextValue(row, "ref");
    const id = positiveInteger(ref?.id ?? ref?.collectionID);
    if (id === null) return [];
    ids.push(id);
  }
  return ids;
}
