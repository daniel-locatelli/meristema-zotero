import { positiveInteger } from "../domain/valueNormalization";

/** The subset of ZoteroPane that names the selected library. */
export interface LibrarySelectingPane {
  getSelectedLibraryIDs?: () => unknown;
  getSelectedLibraryID?: () => unknown;
}

/**
 * The library the pane's collection tree currently selects, or null when
 * the pane cannot say. Newer Zotero builds replaced getSelectedLibraryID
 * with the plural getSelectedLibraryIDs and left the old name behind as a
 * throwing stub, so the singular form is tried second and inside a guard.
 */
export function paneSelectedLibraryID(
  pane: LibrarySelectingPane | null | undefined,
): number | null {
  if (!pane) return null;
  if (typeof pane.getSelectedLibraryIDs === "function") {
    const ids = pane.getSelectedLibraryIDs();
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const libraryID = positiveInteger(id);
        if (libraryID) return libraryID;
      }
    }
  }
  if (typeof pane.getSelectedLibraryID === "function") {
    try {
      return positiveInteger(pane.getSelectedLibraryID());
    } catch {
      return null;
    }
  }
  return null;
}
