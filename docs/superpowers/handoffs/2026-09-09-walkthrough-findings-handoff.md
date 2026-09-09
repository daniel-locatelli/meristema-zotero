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
menus are not. Eighteen items: **B12 to B22**, **F5 to F9**, **D3 to D5**, all
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

B13, B14, B16, B17 and B21 are five surface fixes — dark-theme contrast on
"+ Add seed", the off-centre ellipse behind the seed row's ×, the centred Open
list, the plugin icon repeated on every Tools row, and File sitting fourth in
the plot toolbar when the user's rule is that File comes first anywhere. One
branch could carry all five.

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

## Why Advanced is nearly empty, which is worth not re-deriving

The user asked why most papers carry so little under Advanced. Four reasons,
none of them visible in the product, traced through the code this session and
written up as **F8**; **B22** is the user's request that the section stop being
collapsed and stop padding itself with dashes.

1. **Nothing the providers can name — the big one.** The enrichment pass only
   builds a task for a work an identifier function can name: OpenAlex wants a
   DOI or an OpenAlex ID already on the record, Semantic Scholar a DOI, PMID,
   arXiv ID or ISBN. But the core lookup that runs first has an **exact-title
   fallback** (`exactTitleFallback`, default on), which resolves a DOI-less
   item whose title matches a provider record and stores the resulting
   `providerWorkID` — and enrichment can name it after that. So what stays
   empty is the paper whose exact title does _not_ match: a different subtitle
   or capitalisation, a non-English title, an ambiguous match, or a work not in
   the providers at all — books, chapters, reports, theses, standards. Same
   population as F3. Refreshing helps when the title matches and cannot help
   when it does not.
2. **Two providers, different coverage.** FWCI, percentile, top 1%/10% and
   citations-by-year are OpenAlex's; influential citations are Semantic
   Scholar's; the journal indices come from OpenAlex's source record. Disable
   a provider and its rows can never fill.
3. **Enrichment only runs where an update ran.** It is called for the records
   that _changed_ in a run, and the automatic sweep covers the libraries
   ticked in settings plus items modified since. An item that has never been
   through an update has no metric record, and every Advanced value is read
   off that record.
4. **Some rows are computed, not fetched.** Reference coverage, mean reference
   age and spread, estimated self-citations and connections in library are
   derived from the reference list, so they wait on Refresh or Update
   connections.

**Decided with the user, 2026-09-09.** The trap in B22 was that hiding the
empty rows hides reason 1 as well, and a reader would never learn that adding
a DOI is what would fill them. So B22 keeps the rows and only opens the
section, and the dashes get fixed at the source instead — **F9**, a tool for
adding a DOI.

F9 is smaller than it sounds, because **the plugin usually knows the DOI
already and never writes it down**. A resolved lookup is persisted as a
`CitationMetricRecord` carrying `doi`, `provider`, `providerWorkID`,
`matchedBy`, `matchConfidence` and `matchConfirmed`; the Zotero item's own DOI
field is never touched. The only `setField("DOI", …)` in the codebase is in
`externalDiscoveryService`, for a _new_ item imported from an external work.
So the first version is: where the item has no DOI and the record has one,
offer to write it in.

The part not to skip is confirmation. A title match is not a certainty — that
is what `matchConfirmed` and the "Match needs confirmation" badge are for — so
an unconfirmed match has to be shown with its evidence and accepted by the
reader. Writing a wrong DOI into someone's library is worse than an empty
field.

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
