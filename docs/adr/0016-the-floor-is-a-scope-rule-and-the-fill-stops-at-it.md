# The floor is a scope rule, and the fill stops at it

A citation floor hides every non-seed paper whose known count is under it,
as the last step of the scope order after the folder rule, the hop rule and
the reader's filters, and a paper with no count passes. Because the fill
expands shown papers, a paper under the floor is never expanded: the floor is
the reader's cost lever, and with the cut (ADR 0015) it is the plain
statement of what a filled plot holds. It is not a facet, since the rail
counts what it removed, and not a renderer overlay, since the renderer never
decides visibility. The design's outline rendering of papers under the floor
was not built: a third node state at D13's densities, and the dashed ghost
outline already means something (citation-floor spec, 2026-09-18).

Amended 2026-10-11 (D21): a paper with no count still passes, since no count
is unknown, not low, but a reader read one staying above a raised floor as a
bug. The floor's rail row now says `· n with no count kept`, and a click hides
them by turning off the Filter's "Include missing citations" (the row then
reads `hidden`, and a click brings them back). The scope reads that switch
beside the floor rather than among the facets, so the row can count what it
hides.

Amended 2026-10-15 (D29): the note read as lost on the floor's row, so it is
its own switch row under it, `Papers with no count (n)`, like the folder and
hop rows: on keeps them, off hides them. It shows only while the floor is
raised and one is in view, and counts them either way.
