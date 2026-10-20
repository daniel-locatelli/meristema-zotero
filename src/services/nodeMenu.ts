import type { CitationGraphNode } from "../domain/graphTypes";
import { externalWorkURL } from "./providerPresentation";

/**
 * Where a node's right-click menu sits inside the graph area, and which keys
 * open it. Pure, so the clamping can be tested without a DOM.
 */
export interface MenuPlacementInput {
  /** Pointer position relative to the pane's top-left corner. */
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  paneWidth: number;
  paneHeight: number;
}

/**
 * The menu's top-left corner, kept inside the pane on all four edges. A menu
 * larger than the pane pins to the top-left so its first items stay reachable.
 */
export function clampMenuPosition(input: MenuPlacementInput): {
  left: number;
  top: number;
} {
  const maxLeft = Math.max(0, input.paneWidth - input.menuWidth);
  const maxTop = Math.max(0, input.paneHeight - input.menuHeight);
  return {
    left: Math.min(Math.max(0, input.x), maxLeft),
    top: Math.min(Math.max(0, input.y), maxTop),
  };
}

/** Shift+F10 and the dedicated ContextMenu key: the two keyboard ways to ask for a context menu. */
export function isContextMenuKey(event: {
  key: string;
  shiftKey: boolean;
}): boolean {
  return (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu";
}

/** What the best attachment of a Zotero item is, as `getBestAttachmentState` reports it; null when not yet known. */
export type BestAttachmentType = "pdf" | "snapshot" | "other" | "none" | null;

export interface OpenPaperEntry {
  label: string;
  target: { kind: "attachment"; itemID: number } | { kind: "url"; url: string };
}

/**
 * The node menu's first entry: the one way to get at the paper itself. An
 * attachment wins over any address because it is the copy the user already
 * has; a DOI wins over the item's URL because it outlives the URL. A node with
 * neither gets no entry rather than a dead one.
 */
export function openPaperEntry(
  node: Pick<CitationGraphNode, "kind" | "itemID" | "doi" | "externalWork">,
  attachment: BestAttachmentType,
  itemURL: string | null,
): OpenPaperEntry | null {
  if (node.kind !== "external" && attachment && attachment !== "none") {
    return {
      label: attachment === "pdf" ? "Open PDF" : "Open attachment",
      target: { kind: "attachment", itemID: node.itemID },
    };
  }
  const url = paperURL(node, itemURL);
  return url ? { label: "Open online", target: { kind: "url", url } } : null;
}

function paperURL(
  node: Pick<CitationGraphNode, "kind" | "doi" | "externalWork">,
  itemURL: string | null,
): string | null {
  if (node.kind === "external" && node.externalWork) {
    return externalWorkURL(node.externalWork);
  }
  const doi = node.doi?.trim();
  if (doi) return `https://doi.org/${encodeURIComponent(doi)}`;
  const url = itemURL?.trim();
  return url ? url : null;
}

/** The node menu's entries (F5). "separator" is the rule above the seed entries. */
export type NodeMenuEntryId =
  | "open"
  | "show"
  | "add"
  | "similar"
  | "update"
  | "separator"
  | "seed"
  | "remove";

export interface NodeMenuInput {
  kind: "library" | "external";
  /** External papers only: a local Zotero item was found for the paper. */
  inLibrary: boolean;
  isSeed: boolean;
  /** This paper's connections update is running. */
  updating: boolean;
}

export interface NodeMenuEntry {
  id: NodeMenuEntryId;
  /** True only for "update" while the paper's update runs. */
  disabled: boolean;
}

export const UPDATE_CONNECTIONS_LABEL = "Update this paper's connections";
export const UPDATE_CONNECTIONS_TITLE =
  "Fetch this paper's references and citing papers again.";
export const FIND_SIMILAR_TITLE =
  "Find papers similar to this one using scholarly-data providers. Results are shown for review and are not added to Zotero automatically.";

/**
 * What the node menu shows, in order: what Paper details offers for the
 * paper, a rule, then the seed toggle and, for a paper that is not a seed,
 * Remove from graph. "open" is always listed; the view hides it while the
 * paper has nothing to open, because its entry can arrive after the menu
 * opens (`openPaperEntry` relabels it once Zotero answers). The menu never
 * imports: an external paper outside the library gets "add", which hands the
 * reader to the pane's collection picker.
 */
export function nodeMenuEntries(input: NodeMenuInput): NodeMenuEntry[] {
  const external = input.kind === "external";
  const ids: NodeMenuEntryId[] = [
    "open",
    external && !input.inLibrary ? "add" : "show",
    "similar",
  ];
  if (external) ids.push("update");
  ids.push("separator", "seed");
  if (!input.isSeed) ids.push("remove");
  return ids.map((id) => ({
    id,
    disabled: id === "update" && input.updating,
  }));
}
