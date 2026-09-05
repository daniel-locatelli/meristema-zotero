# Explore Controls in the Plot Toolbar

**Date:** 2026-09-05
**Status:** Approved

## Problem

An Explore tab draws a second band under the plot toolbar: the seeds button
and four dropdowns (direction, scope, ranking, per-seed limit) on a tinted
strip with its own border. A Collection Graph tab has no such band, so the
two view kinds have different chrome, and the strip still carries the look
the rest of the graph left behind in the redesign.

## Design

The band (`.cm-focus-bar`) is removed. Its controls move into the plot
toolbar, immediately after the filter button and before Add Node, and are
hidden in Collection Graph tabs by a rule on the root's `data-view-kind`
attribute. Nothing else in the toolbar moves between view kinds.

### Seeds

- A `cm-toolbar-button` wrapped in a `cm-menu-wrapper`, drawn with
  `iconButtonContent` like Similar and Export. The icon is `document`; the
  label keeps its current text (`N seeds`).
- The popover is the existing `.cm-focus-seed-popover` (search box, seed list
  with remove buttons), unchanged. It opens downward under the button; the
  wrapper already positions it.

### Explore settings

- A new `cm-toolbar-button` with the `settings` icon and the label
  "Settings", also in a `cm-menu-wrapper`, with `aria-haspopup="dialog"` and
  `aria-expanded`.
- Its popover holds the four existing `<select>` elements as labelled rows:
  Direction, Scope, Ranking, Limit. The rows use `.cm-appearance-section` and
  `.cm-appearance-row` so the panel reads as the appearance panel's family.
  The panel itself is `.cm-appearance-panel` with a new placement modifier,
  `.cm-appearance-panel--below`, that flips it to open downward from the
  toolbar (`top: calc(100% + 6px)`, `bottom: auto`) and drops the width to
  `min(320px, calc(100vw - 38px))`.
- The select elements, their option lists, their values and their `change`
  listeners are untouched, so the projection state round-trip (read on
  rebuild, written on restore) keeps working.

### Open and close

Both popovers follow the Export menu: the button toggles `hidden` and
`aria-expanded`; a pointerdown outside the wrapper closes; Escape closes and
returns focus to the button. Opening one closes the other.

### Stylesheet

Delete `.cm-focus-bar`, `.cm-focus-bar[hidden]` and `.cm-focus-bar .cm-select`
from `graph.css`. Add:

```css
.meristema-root[data-view-kind="map"] .cm-focus-only {
  display: none;
}
.cm-appearance-panel--below {
  top: calc(100% + 6px);
  bottom: auto;
  width: min(320px, calc(100vw - 38px));
}
```

The two wrappers carry `cm-focus-only`.

## Testing

The toolbar has no unit coverage; the gate is `npm run check` and the visual
harness in `npm test`, plus a manual look at both view kinds: the Collection
Graph toolbar unchanged, the Explore toolbar with Seeds and Settings after
the filter, no band, both popovers opening below their buttons and closing
on outside click and Escape.
