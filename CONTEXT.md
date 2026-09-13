# Meristema

A Zotero plugin that draws a library's citation network as a graph, grows it
outward from chosen papers through external citation providers, and keeps what
the reader built as a saved graph. This glossary names the concepts the graph
is built from; it says what each thing is, not how it is implemented.

## Language

### The graph

**Graph**:
One open plot of papers and their citation links, drawn from a library scope
plus whatever the seeds reached. Lives in a Zotero tab.
_Avoid_: map, focus graph, PhD graph

**Paper**:
A node of the graph: a work identified by DOI or a provider's identifier,
whether or not it is in Zotero.
_Avoid_: item (a Zotero record), node (the drawing), work (a provider's record)

**Library paper**:
A paper that exists as an item in the reader's Zotero library.

**External paper**:
A paper the graph knows only from a provider; it can be added to Zotero, after
which it is a library paper under the same graph key.
_Avoid_: candidate, ghost, missing paper

**Edge**:
A citation link drawn citer to cited.
_Avoid_: relation, arrow

**Seed**:
A paper the reader chose to grow the graph from. Seeds are hop 0; a graph
with at least one seed is seeded. A seed only ever adds papers; it never
hides one.
_Avoid_: focus paper, root, origin

### What is shown

**Scope**:
The rule that decides which papers of the graph are shown: the folder rule
and the hop rule taken together, followed by the reader's filters.
_Avoid_: filter (filters come after scope), visibility, focus

**Folder rule**:
A library paper is shown when a folder it is filed in is ticked in the rail.
Ticking a folder ticks its subfolders.
_Avoid_: collection filter

**Hop rule**:
A paper the folder rule does not admit is shown when it sits at a hop the
reader has opened and enabled, and one of its parents is shown. The hop rule
never hides a paper the folder rule admits.

**Tick**:
The reader's on/off choice on a folder or a hop row in the rail.
_Avoid_: check, toggle, selection

**Rail**:
The panel beside the plot that holds the Scope section (folders, seeds,
citation hops) and the Key.
_Avoid_: sidebar, side panel, legend panel

**Key**:
The rail's block that names what the plot's colours, sizes and rings mean.
_Avoid_: legend

**View**:
A named bundle of appearance, regions, filters and hop settings that a reader
can apply, save and share. A view never changes scope: seeds and folder ticks
are untouched by applying one.
_Avoid_: template, preset, layout (an axis choice), theme (light or dark)

**Region**:
A tinted outline drawn around the papers of a ticked folder, one per subtree
top.
_Avoid_: hull, halo, cluster, contour (the curve that draws it)

**Seed marks**:
What a seeded graph adds to the plot per paper: the seed's bullseye in its own
colour, the thin ring on a reached paper the library holds, the paper's hop and
its seed-relative citation sequence. One record by paper, never a field on a
node (ADR 0008); a library graph has none.
_Avoid_: overlay, decorations, hop map (one part of it)

**Saved graph**:
A graph kept by name in the reader's profile as a recipe (seeds, ticks,
settings, camera) that reopens the same graph later.
_Avoid_: snapshot (a cached result), session, bookmark

### Citation hops

**Direction**:
Which way the graph grows from its seeds: Citers (papers citing) or References
(papers cited). One per graph.
_Avoid_: mode, both (no longer a value)

**Hop**:
A paper's distance from the nearest seed along the direction. Seeds are hop 0;
hop 1 is the seeds' direct citers or references; hop k+1 is hop k's. A paper
reached at several distances sits at the shallowest.
_Avoid_: level, degree, ring

**Depth**:
The deepest hop the reader has opened, 1 to 6. Hops past the depth are neither
walked nor fetched.
_Avoid_: chain depth, loaded depth, hop count

**Parents**:
The papers one hop shallower that link to a paper. A paper keeps all of them.

**Expanded**:
A paper whose own list in the current direction has been fetched and stored,
even if that list is empty.
_Avoid_: fetched, loaded, resolved

**Failed**:
A paper whose expansion in the current direction returned nothing usable this
session. It leaves the fill until the graph is reopened.
_Avoid_: broken, stale, missing

**Fill**:
The background work that expands shown papers one at a time, in priority
order (seeds, then the selected paper, the hovered one, papers on screen, the
rest), until every shown paper at an opened hop is expanded or failed, or the
cap is hit.
_Avoid_: crawl, load, sync, prefetch

**Cap**:
The number of expansions the fill may make per hop per direction in a seeded
graph before it waits for Fetch more.
_Avoid_: budget, quota, limit (a per-list size)

**Refresh**:
The toolbar action that re-fetches the seeds' own lists in the current
direction. It never refreshes hop papers; those are refreshed one at a time
from the detail pane.
_Avoid_: reload, update, sync

### Sources

**Provider**:
An external service the plugin asks for a paper's record, citers or
references (Semantic Scholar, OpenAlex, Crossref, OpenCitations, Inspire).
_Avoid_: API, backend, source

**Native provider**:
The provider that holds a paper's own identifier for that paper.

**List**:
A paper's citers or references as one provider reported them, stored with a
fetch time and the provider's reported count.
_Avoid_: relationships, summary, fragment, snapshot (all names of storage)
