/**
 * Zotero's View › Font Size (B93). The menu writes `extensions.zotero.fontSize`
 * in rem, and a pref observer has Zotero.UIProperties write it onto every
 * registered root as `font-size: <pref>rem` and `--zotero-font-size`, then
 * fire `UIPropertiesChanged` on that root. Zotero's windows set
 * `:root { font-size: 13px }`, so 1.00 is 13px.
 *
 * Only `#zotero-pane` and `#zotero-context-pane` are registered in the main
 * window. The graph tab sits beside them in `#tabs-deck`, so the plugin
 * registers its own roots and sizes its text against `--zotero-font-size`.
 */
export const ZOTERO_BASE_FONT_PX = 13;

interface UIProperties {
  registerRoot(root: Element): void;
}

/** A CSS font size that is `px` at Zotero's default and follows the root. */
export function scaledFontSize(px: number): string {
  return `calc(var(--zotero-font-size, 1rem) * ${px} / ${ZOTERO_BASE_FONT_PX})`;
}

/** The element's font size over Zotero's 13px; 1 when it cannot be read. */
export function fontScaleOf(element: HTMLElement): number {
  const view = element.ownerDocument?.defaultView;
  const size = Number.parseFloat(
    view?.getComputedStyle?.(element)?.fontSize ?? "",
  );
  return Number.isFinite(size) && size > 0 ? size / ZOTERO_BASE_FONT_PX : 1;
}

/**
 * Register `root` with Zotero.UIProperties and call `onChange` each time the
 * user picks another size. Returns the disposer for the listener; Zotero holds
 * the root weakly, so nothing else needs undoing.
 */
export function followZoteroFontSize(
  root: HTMLElement,
  onChange: () => void,
  properties: UIProperties | null = zoteroUIProperties(),
): () => void {
  if (!properties) return () => undefined;
  // An internal Zotero API: if it ever changes, the text keeps its default
  // size rather than taking the view down with it.
  try {
    properties.registerRoot(root);
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    return () => undefined;
  }
  root.addEventListener("UIPropertiesChanged", onChange);
  return () => root.removeEventListener("UIPropertiesChanged", onChange);
}

function zoteroUIProperties(): UIProperties | null {
  const zotero = (globalThis as { Zotero?: { UIProperties?: UIProperties } })
    .Zotero;
  return zotero?.UIProperties ?? null;
}
