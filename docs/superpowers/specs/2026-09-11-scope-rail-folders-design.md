# Scope rail folders: the tree and the square (B31)

Written 2026-09-11 on `main` at c8cefe5. Resolves backlog B31, "the rail
does not show subfolders clearly", which the user widened the same day to a
redesign of the Scope section's folder rows.

The picture is `2026-09-11-scope-rail-folders-d.png` beside this file (light
and dark). The canvas the decision was made on, with the three rejected
directions beside it, is
<https://claude.ai/code/artifact/d857e198-b80e-4302-8ca7-01e693c0ddcb>
(private; "Direction D").

## The complaint

Asked with a graph open, the user picked two of the entry's four candidates:
nesting is invisible, and the cascade is illegible. Folding subtrees and
parent counts were not complaints and stay out of scope.

Today `buildScopeRailModel` indents a row with four leading spaces per depth
level inside the label string, and nothing else draws the hierarchy. Ticking
a parent writes the same tick to its whole subtree (`setCollectionTicks`
over `cascadeIDs`), and nothing on the row says it will. A region is marked
by a 1.5 px border around the row in the region colour, on a paper
background.

## The design

### Tree

A row is indented by its depth, 14 px per level, as padding on the row
rather than spaces in the label. A thin guide line (`--cm-border`) runs down
each ancestor level, so a child sits visibly under its parent and a deep
tree keeps its shape. The label loses its `white-space: pre` and keeps its
hidden overflow and ellipsis, so a deep label in a narrow rail is cut, not
wrapped or spilled; the `INDENT` constant and the repeat go.

No disclosure triangles and no folding: the tree is always fully open, as
today.

### The square

The native checkbox is replaced on screen by a 13 px square with a 3 px
radius. Its fill is the state:

| Folder is                          | Square                                        |
| ---------------------------------- | --------------------------------------------- |
| off                                | empty, 1.5 px outline at 45 % ink             |
| shown                              | filled in the accent blue (`--cm-accent`)     |
| drawn as a region                  | filled in the folder's region swatch          |
| partly shown (a mixed parent)      | grey fill (45 % ink over paper), a white dash |
| region and partly shown            | region swatch fill, the white dash            |

No tick glyph is drawn in any state. Unfiled and Not in Zotero use the same
square and only ever show empty or blue, since neither can be a region.

The square is drawn over a real `<input type="checkbox">` that stays in the
DOM, visually hidden, so the keyboard, the screen reader and the existing
`change` handler are unchanged. The square's classes are written from the
row's `state` and `selected`, the way the row's border colour is today.

### The selected row

A folder drawn as a region is a selected row in Zotero's own style: the row
is filled with the accent (`--cm-accent`), the label and the count go
white. Two or more regions all sit on the same blue and differ only by their
squares; the square wears a 1 px edge in the row's label ink (white) on a
selected row so it separates from the fill. The label is white on the accent
in both themes, so the edge reads wherever the label does. The paper
background and the coloured border go.

The user's words: "the selection should still select the whole container
using a native Zotero select style". The Key's pressed entries use an 18 %
accent tint; this row is the full fill, since it is a selection and not a
toggle.

### Clicks

- **Row body**: draws the folder as a region, and shows it first if it was
  off. Clicking a region's row again clears the region. This is
  `selectRow` as it is.
- **Square**: shows or hides the folder and its whole subtree. Hiding a
  folder that has a region clears the region. This is `toggleRow` as it is.

So the two handlers are unchanged; only their marks are.

### The cascade

Ticking a parent fills every descendant's square in the same render, which
is what makes the cascade legible after the click. Before the click, hovering
a parent's square tints its descendants' rows with a faint accent
(`color-mix(in srgb, var(--cm-accent) 10%, transparent)`), so the reach of
the tick shows first. The tint follows the pointer on the square only, not
the row body, since the row body's hover is already the region emphasis. A
selected row is not tinted: the selected fill wins, so white labels never
sit on a lightened blue.

### Themes

Every colour above is a token the rail already has (`--cm-accent`,
`--cm-border`, `CanvasText`, `Canvas`) or a region swatch the renderer
hands to the row (`--cm-row-color`), so the dark theme needs no new rule
and a theme flip re-reads them the way B29 left it.

## Out of scope

Folding, subtree counts, folder icons, and moving the square to the right
edge. Each was shown as a direction (A, B, C on the canvas) and not chosen.

## Testing

- `graphScopeRailModel`: the label no longer carries an indent; `depth` is
  what the row reads.
- `graphKeyRail`: a row's square carries `off`, `on`, `mixed`, or the region
  colour as its class and style; a selected row carries the selected class;
  the hidden checkbox still fires `toggleRow` and still reads `indeterminate`
  for a mixed parent; hovering a parent's square marks its descendants.
- Zotero suite: `test/zotero/graphScopeRail.test.ts` already walks the tick
  cascade through the rail; it should still pass unchanged, since the
  handlers are the same.
- Manual, appended to the roadmap's batch: a screen reader announces the
  mixed parent as partly checked; a deep folder name in a narrow rail ends
  in an ellipsis; a selected row's square and label both read on the dark
  theme.

## Pointers

`src/services/graphScopeRailModel.ts` (`INDENT`, `label`, `depth`,
`cascadeIDs`), `src/services/graphKeyRail.ts` (`scopeRowElement`),
`addon/content/graph.css` (`.cm-scope-row*`, `.cm-scope-check*`).
