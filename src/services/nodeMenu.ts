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
