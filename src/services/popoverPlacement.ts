/**
 * Whether a popover anchored to its button's left edge would run past the
 * window's right edge. A zero or non-finite measurement means "cannot tell",
 * which keeps the default start alignment.
 */
export function popoverOverflowsEnd(
  buttonLeft: number,
  popoverWidth: number,
  windowWidth: number,
): boolean {
  if (
    !Number.isFinite(buttonLeft) ||
    !Number.isFinite(popoverWidth) ||
    !Number.isFinite(windowWidth) ||
    popoverWidth <= 0 ||
    windowWidth <= 0
  ) {
    return false;
  }
  return buttonLeft + popoverWidth > windowWidth;
}
