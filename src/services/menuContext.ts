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
 * The ID of the collection the user right-clicked, or null when the row is
 * anything else: a library or group root, a saved search, Trash, Unfiled
 * Items, Duplicate Items, Publications, a feed.
 *
 * Zotero supplies the selected rows as `collectionTreeRows`, an array,
 * because the collection tree supports multi-select. Earlier builds supplied
 * a single `collectionTreeRow`, and current ones make that name THROW rather
 * than return undefined — so the singular is read second and only as a
 * fallback for older builds. Reading it first yields an exception on every
 * modern build, which `contextValue` turns into null and the menu into
 * silence.
 *
 * A multi-selection is not a match. There is no single right-clicked folder
 * to scope a graph to, and choosing one of several arbitrarily would open a
 * graph the user did not ask for.
 *
 * Returns the ID rather than the collection so this module needs no Zotero
 * globals. `openGraphForCollection` performs the lookup itself.
 */
export function contextCollectionID(context: any): number | null {
  const rows = contextValue(context, "collectionTreeRows");
  const row = Array.isArray(rows)
    ? rows.length === 1
      ? rows[0]
      : null
    : contextValue(context, "collectionTreeRow");
  if (row?.isCollection?.() !== true) return null;
  const ref = contextValue(row, "ref");
  return positiveInteger(ref?.id ?? ref?.collectionID);
}
