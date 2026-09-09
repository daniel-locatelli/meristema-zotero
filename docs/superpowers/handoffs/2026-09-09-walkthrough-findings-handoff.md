# Handoff: what the Stage 2 walk-through found

Written 2026-09-09. Read `docs/superpowers/handoffs/2026-09-08-roadmap.md`
first — it now carries all of this in its lists, and it is what the next
session ticks. This file is the reasoning the lists do not have room for.
`2026-09-09-stage-2-done-handoff.md` says what shipped; nothing in it has
changed.

Nothing was fixed in this session. The user walked the batch, gave the
findings, and asked for them to be written down before any of it is worked.
The tree is clean at `main`; the only commits are documentation.

## The batch passed

All nine Stage 2 checks pass **as written**, including the one that mattered
most: a graph saved before this release still draws the same papers, and a
graph scoped to a parent folder still draws that folder's whole subtree. No
saved work was lost in the migration.

What the walk found is a layer under the checks — the marks are right and the
menus are right, but the colours behind the marks and the dressing around the
menus are not. Fourteen items: **B12 to B20**, **F5 to F7**, **D3 to D5**, all
written up in `2026-09-08-review-backlog.md` with pointers.

## Start with D3, not with B12

The single largest finding, and the one that decides several others.

Four things colour the plot, drawn from two lists that were never designed
against each other:

| what            | where it comes from                             |
| --------------- | ----------------------------------------------- |
| folder          | `theme.categorical.swatches`, **by rank**       |
| seed            | `theme.categorical.swatches`, **by seed index** |
| metric colour   | `theme.ramp`, teal → yellow                     |
| in-library ring | a constant `#4f9a5e`                            |

`#4f9a5e` **is** ramp stop three. Swatch three is `#039f6c`. So the user's
graph — four seeds, colour by citations — had a green seed against a
green-to-yellow ramp with green rings on the papers reaching it: three
meanings, one colour.

**B12** is the visible half of the same problem. `graphCategoryAssignment.ts`
ranks categories "largest first, ties by label" and hands out swatches by that
rank. The sort was written so the order never depends on _input_ order, which
it does not — but it depends on the _counts_, and every tick changes them. So
ticking DOKwood takes magenta off PhD. Colour is the reader's handle on a
folder and it moves under them.

Fixing B12 alone would be repainted by whatever D3 decides, so D3 is the
brainstorm to run first. It has two questions in it, not one:

1. **What does a seed's centre mean?** Today it is the node's own fill — its
   folder — so a paper in several folders is drawn in slices. The user does
   not think the centre should be the folder at all. That is a design
   question, not a bug.
2. **How do the palettes stay apart?** Reserve swatches for seeds; derive the
   ring from the node's colour instead of a constant; drop folder colour while
   a numeric colour metric is on.

## The two other brainstorms

**D4, graph templates.** The user's framing: "There are multiple ways to
visualize the same graph. I like the flexibility, but it may be hard for users
that are just getting started." A template bundles axes, scales, size, colour,
labels and filters under a name and an icon, swapped in one click. Where they
live is open — the user said so explicitly. **The rail already has a presets
line from the Stage 2 spec; read that before designing a second control that
competes with it.**

**D5, the logo.** Two marks today: the blue `favicon.png` the add-ons manager
shows and the white `content/icons/network.svg` used across the UI, which does
not work on the light theme. Wanted: one mark, both themes, carrying the
meristem idea — the growing tip that keeps branching — not a generic network
glyph. Brainstorm the idea before drawing.

## The small ones

B13, B14, B16 and B17 are four surface fixes — dark-theme contrast on "+ Add
seed", the off-centre ellipse behind the seed row's ×, the centred Open list,
the plugin icon repeated on every Tools row. One branch could carry all four.

B15 (two clicks to seed from the search panel), B18 (the graph jumps because
the fit lands after the first frame), B19 (a folder's menu should read "Create
a new graph"), B20 (New Graph from a detached window looks like nothing
happened; the user called it low priority), F5, F6, F7 each stand alone.

Two notes worth keeping:

- **B18 is not "make the fit faster".** `scheduleFocusFit` waits for the
  viewport and node count to hold still before it fits, which is what makes
  the fit correct. The fix is to render the first visible frame already
  framed, not to shorten the settle.
- **B19's label was deliberate.** "New { $graph }" exists so a folder already
  named like a graph does not read "New PhD Graph Graph". A flat "Create a new
  graph" solves that too, so the constraint is satisfied, not ignored.

## Three questions the user asked, answered

**Refresh vs Update connections.** The same fetch at two scopes. **Refresh**
in the toolbar re-fetches references and citing papers for _every seed_ when
the graph is seeded, and metadata plus citation counts for _every visible
paper_ when it is not. **Update connections** in the detail pane does both
directions for _the one paper the pane is showing_. The labels do not say
that, which is part of F5.

**"Show in graph (replace)" and "Explore".** Neither is in the product any
more, which is why the user could not find them — Stage 2 retired both. My
earlier note listed them as loose ends because the stopped-session handoff
did; that list was stale on both counts. The one real remainder is
`itemPaneService.ts`, whose surviving overview button is still _labelled_
"Explore".

**The citation floor — the draggable trim line from the Claude Design
concept.** Not lost: it is **Stage 4** on the roadmap, "citation floor and
shared citers", with the floor line, its drag handle and outline rendering
below the floor. It depends on Stage 3 (citation hops on demand). Nothing
about it has been dropped or redesigned.

## Then

The roadmap's order stands: Stage 3 is the next planned layer, and D3 to D5
are new design items beside it. The user has not said which comes first —
**ask before starting either**, because D3 changes what the plot looks like
and Stage 3 changes what it holds, and both touch the rail.
