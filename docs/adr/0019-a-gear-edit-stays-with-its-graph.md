# A gear edit stays with its graph

A new graph opens on a fixed default appearance: the built-in one, Overview's
(D22), or one the reader made with the gear's "Make this the default", and
"Reset to built-in default" forgets it. The gear's other edits, and an
applied view, stay with the graph they were made on: the graph state carries
its appearance since version 10, so a rebuild, a restored tab and a saved
graph reopen on it. Until D17 every gear edit rewrote the stored default, so
a new graph inherited whatever the last graph had been left on. A library
graph and a seeded one keep separate defaults (B41). A record stored before
D17 that only repeats the old built-in default was written by an open, not
chosen, and reads as no default; any other is honoured as made.
