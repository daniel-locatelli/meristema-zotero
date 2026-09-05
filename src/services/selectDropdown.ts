/**
 * The XUL popup Zotero's window uses to draw an HTML `<select>`'s option list.
 * It hangs off the window's document, not off the `<select>`, so a pointer
 * landing on one of its items looks like an outside click to any popover that
 * dismisses on outside pointerdown — and the dismissal tears the `<select>`
 * down before the option is applied.
 */
const SELECT_DROPDOWN_ID = "ContentSelectDropdown";

interface AncestorNode {
  id?: string;
  parentNode: AncestorNode | null;
}

/** Whether `node` is Zotero's select dropdown popup or something inside it. */
export function insideSelectDropdown(node: AncestorNode | null): boolean {
  for (let current = node; current; current = current.parentNode) {
    if (current.id === SELECT_DROPDOWN_ID) return true;
  }
  return false;
}
