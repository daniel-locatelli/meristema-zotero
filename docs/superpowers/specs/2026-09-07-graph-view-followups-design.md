# Graph View Follow-ups

**Date:** 2026-09-07
**Status:** Implemented

## Problem

The merged graph view landed on 2026-09-06 and the first walk-through in
Zotero raised four points:

1. The Seeds and Explore buttons disappear when a graph has no seeds, so the
   toolbar changes shape depending on how the tab was opened. The view should
   look the same on every path.
2. "Graph" and "Graph 2" say nothing about what a tab holds. A graph opened
   from papers should be named after the paper it started from, the way a
   folder graph is already named after its folder.
3. Showing a folder in an existing graph replaces that graph's contents. The
   user can scope a graph from inside it with filters and seeds, so offering
   folders to open views buys nothing and surprises.
4. Back and Forward walk through previous seed states and, at the end, cross
   into the seedless graph. The user navigates the graph with the mouse and
   finds the history confusing. It goes.

## Design

### Seeds and Explore stay in the toolbar

The two buttons are always rendered. While the graph has no seeds they are
disabled, which the shared `button:disabled` rule already grays out. The
`cm-focus-only` class and the CSS rule that hid them are removed. The Seeds
label reads "0 seeds" while disabled. Removing the last seed still returns
the tab to the library graph.

### A graph opened from papers is named after the first paper

`paperGraphTitle(title, maxLength = 40)` in `graphInstancePolicy.ts` trims
the title and, when it is longer than the limit, cuts it at the last word
boundary that fits and appends "…". A blank title gives null, and the caller
falls back to "Graph". The two item openers in the window service pass the
first selected item's display title as `titleBase`, which only applies when a
new instance is created, so adding papers or seeds to an open view never
renames it. Folder graphs keep their folder name. Tools › New Graph keeps
"Graph". A user-renamed tab keeps its name.

### Folders open new graphs only

The folder context menu keeps "New … Graph" and no longer lists open views.
The `replaces contents` hint goes with it.

### No Back and Forward

The two buttons, the seed-state stacks, the map-selection stacks, the
return-to-seeds state and the `pushHistory` and `preserveFocusReturn`
options are deleted. Adding a seed, removing a seed and changing Explore
settings act directly on the projection. The two arrow icons become unused
and are removed.

## Files

- `src/services/graphViewService.ts`: buttons, history removal.
- `addon/content/graph.css`: the hide rule and the history-controls rules.
- `src/services/uiIconService.ts`: arrow icons.
- `src/services/graphInstancePolicy.ts`, `test/unit/architecture.test.ts`:
  `paperGraphTitle`.
- `src/services/windowService.ts`: item openers pass a title base.
- `src/services/menuService.ts`: folder menu.
- `test/zotero/graphViewVisual.test.ts`: history-button geometry assertions.
- `README.md`.

## Testing

- Unit tests for `paperGraphTitle`: short title unchanged, long title cut at
  a word boundary with "…", blank title null.
- `npm run check` green at the end of every task.
- Manual, in Zotero: the toolbar has the same buttons on every path; a graph
  from a paper is titled after it; a folder offers only a new graph; there
  are no Back or Forward buttons.
