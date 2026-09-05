/** The measurements an end-anchor decision needs, in one shared coordinate space (viewport, from `getBoundingClientRect`). */
export interface PopoverPlacementMeasurements {
  /** The anchoring wrapper's left edge. */
  buttonLeft: number;
  /** The anchoring wrapper's right edge. */
  buttonRight: number;
  /** The popover's laid-out width. */
  popoverWidth: number;
  /** The clipping container's left edge. */
  containerLeft: number;
  /** The clipping container's right edge. */
  containerRight: number;
}

/**
 * Whether a popover should anchor to its button's right edge instead of its
 * left. It should when the start-anchored box would run past the container's
 * right edge *and* the end-anchored box still clears the container's left
 * edge — a wide popover on a button near the left of a narrow container fits
 * neither way, and start alignment at least keeps its head visible.
 *
 * The container is the clipping box (the plot pane), not the window: the pane
 * is `overflow: hidden`, so the window's edge is not where a popover is cut.
 *
 * A zero or non-finite measurement means "cannot tell", which keeps the
 * default start alignment.
 */
export function popoverShouldAnchorEnd({
  buttonLeft,
  buttonRight,
  popoverWidth,
  containerLeft,
  containerRight,
}: PopoverPlacementMeasurements): boolean {
  if (
    !Number.isFinite(buttonLeft) ||
    !Number.isFinite(buttonRight) ||
    !Number.isFinite(popoverWidth) ||
    !Number.isFinite(containerLeft) ||
    !Number.isFinite(containerRight) ||
    popoverWidth <= 0 ||
    containerRight <= containerLeft
  ) {
    return false;
  }
  const overflowsEnd = buttonLeft + popoverWidth > containerRight;
  const endAnchorFits = buttonRight - popoverWidth >= containerLeft;
  return overflowsEnd && endAnchorFits;
}
