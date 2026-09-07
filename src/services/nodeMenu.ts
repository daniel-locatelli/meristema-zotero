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
