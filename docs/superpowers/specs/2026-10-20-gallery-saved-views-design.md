# D16: saved views in the gallery

The gallery offers only the six shipped views; the reader's saved views live
in the View dropdown alone. Decided 2026-10-20: a row of chips.

## Layout

A "My views" heading (the dropdown's word) and a wrapping row of chips sit
between the six cards and the footer (Start blank, Import view JSON…). With no
saved views, neither the heading nor the row is drawn, and the gallery is as
before. The row is `role="group"`, labelled by the heading
(`aria-labelledby`).

## A chip

- A button: the 16px `view-user` icon and the view's name.
- Its `title` is the view's paragraph, or its summary when the paragraph is
  empty.
- Order: as `listSaved()` returns them, the dropdown's order.
- A click calls `onChoose(view)`, as a card does. A saved view is always
  `requires: "none"`, so no chip is unavailable.
- No edit control; editing stays in the dropdown.

## Many views

The row wraps, and past about two chip lines it scrolls inside its own box,
so the panel grows by at most that.

## Freshness

`createViewGallery` takes `listSaved: () => GraphViewDefinition[]`, the
synchronous callback the dropdown already uses. Every `show` reads it and
compares a signature of the list (each view's id, name and title) with the
one last drawn; the chips are redrawn only when it differs. So a save, rename
or delete, in any tab, shows on the next `show`, including one while the
gallery is already up, and a `show` with an unchanged heading and list stays
a no-op (the blurred layer must not re-invalidate).

## Tests

Unit tests on `FakeElement` in `test/unit/graphViewsMenu.test.ts`:

- no saved views: no heading and no row;
- each chip's name and title, including the summary fallback;
- a click calls `onChoose` with that view;
- a `show` after a new save draws the new chip, and an unchanged `show`
  leaves the row's nodes untouched.

No new Zotero suite case. One manual check joins the roadmap: save a view,
open Choose a view…, see its chip and tooltip, click it and see it applied.

## Roadmap

Tick D16 and drop its note that `view-user` has no 28px rendering to walk:
the icon renders at 16px only.
