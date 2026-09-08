import type { SavedGraphSummary } from "./savedGraphService";

/** Marks a row injected for one saved graph; the value is the graph id. */
export const SAVED_GRAPH_DYNAMIC_ATTR = "data-meristema-saved-graph";

/** What the fill needs from a XUL menuitem; unit tests hand in a fake. */
export interface SavedGraphMenuNode {
  hidden: boolean;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(
    type: string,
    listener: () => void,
    options?: { once: boolean },
  ): void;
  remove(): void;
}

/** What the fill needs from a XUL menupopup; unit tests hand in a fake. */
export interface SavedGraphMenuPopup {
  readonly children: ArrayLike<SavedGraphMenuNode>;
  append(...nodes: SavedGraphMenuNode[]): void;
  addEventListener(
    type: string,
    listener: () => void,
    options?: { once: boolean },
  ): void;
}

export interface SavedGraphMenuHost {
  list(): Promise<SavedGraphSummary[]>;
  createRow(): SavedGraphMenuNode;
  open(graph: SavedGraphSummary): void;
  /** The row's secondary text; the date formatting stays with the caller. */
  formatModified(iso: string): string;
}

function rows(popup: SavedGraphMenuPopup): SavedGraphMenuNode[] {
  return Array.from(popup.children).filter((child) =>
    child.hasAttribute(SAVED_GRAPH_DYNAMIC_ATTR),
  );
}

/** The one declared child, "No saved graphs yet.", when Zotero has created it. */
function staticEntry(
  popup: SavedGraphMenuPopup,
): SavedGraphMenuNode | undefined {
  return Array.from(popup.children).find(
    (child) => !child.hasAttribute(SAVED_GRAPH_DYNAMIC_ATTR),
  );
}

/** True once graph rows are present, so the empty entry can hide itself. */
export function hasSavedGraphRows(popup: SavedGraphMenuPopup): boolean {
  return rows(popup).length > 0;
}

// The submenu's rows are only known when it shows, so, like the item menu's
// per-view entries, they are injected while the popup is open and removed
// when it hides. One static entry, "No saved graphs yet.", is declared up
// front as the message when there are none.
//
// Zotero's MenuManager runs a submenu's onShowing when the *parent* popup
// shows, and creates the submenu's declared children only when the submenu
// itself first opens. So on the first showing after a restart this runs
// against an empty popup: the static entry does not exist yet. The fill must
// not depend on it; when it is created later, its own onShowing hides it
// through hasSavedGraphRows. Deleting is not offered here; the graph's own
// menu has it.
export async function fillSavedGraphPopup(
  popup: SavedGraphMenuPopup,
  host: SavedGraphMenuHost,
): Promise<void> {
  const clear = (): void => {
    rows(popup).forEach((node) => node.remove());
  };
  clear();
  let graphs;
  try {
    graphs = await host.list();
  } catch (error) {
    // The submenu must never render completely empty: put the static entry
    // back and let the caller's .catch(report) log the failure.
    const entry = staticEntry(popup);
    if (entry) entry.hidden = false;
    throw error;
  }
  clear();
  const entry = staticEntry(popup);
  if (entry) entry.hidden = graphs.length > 0;
  for (const graph of graphs) {
    const item = host.createRow();
    item.setAttribute(SAVED_GRAPH_DYNAMIC_ATTR, String(graph.id));
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("label", graph.name);
    item.setAttribute("acceltext", host.formatModified(graph.modified));
    item.addEventListener("command", () => host.open(graph), { once: true });
    popup.append(item);
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}
