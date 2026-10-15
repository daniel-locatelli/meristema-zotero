# A gear edit stays with its graph

A new graph opens on a fixed default appearance: the built-in one, Overview's
(D22), or one the reader made with the gear's "Use for new blank graphs", and
"Restore built-in blank graph" forgets it. The gear's other edits, and an
applied view, stay with the graph they were made on: the graph state carries
its appearance since version 10, so a rebuild, a restored tab and a saved
graph reopen on it. Until D17 every gear edit rewrote the stored default, so
a new graph inherited whatever the last graph had been left on. A library
graph and a seeded one keep separate defaults (B41). A record stored before
D17 that only repeats the old built-in default was written by an open, not
chosen, and reads as no default; any other is honoured as made.

Amended for D28: the default governs only a blank graph (Start blank, or a
new graph no view is applied to). A view keeps its own settings and is never
rewritten from the gear. The buttons were "Make this the default" and "Reset
to built-in default" until a reader applied Overview, pressed the first, and
took Overview to be overridden; they now name the blank graph, and the gear
says which view its settings came from ("From view: Overview", or "Edited
from view: Overview" once a gear field moves from it).
