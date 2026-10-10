/**
 * Where a graph status message goes (D15).
 *
 * A sticky notice that must stay up (the read-only notice, the migration
 * notice) sits in the toolbar until the next sticky one or a null. A
 * confirmation that must pass ("Copied", "Saved") goes to the toast in the
 * plot's corner, which fades by itself and never touches the toolbar. A null
 * or an empty message clears the toolbar; the toast passes on its own.
 */

export type StatusRoute =
  | { readonly to: "toolbar"; readonly message: string | null }
  | { readonly to: "toast"; readonly message: string };

export function routeStatus(
  message: string | null,
  options: { sticky?: boolean } = {},
): StatusRoute {
  if (!message) return { to: "toolbar", message: null };
  return options.sticky ? { to: "toolbar", message } : { to: "toast", message };
}

/** How long the toast reads before it starts to fade. */
export const STATUS_TOAST_MS = 3000;
/** The fade out; the CSS animation on `.cm-status-toast` lasts as long. */
export const STATUS_TOAST_FADE_MS = 180;
