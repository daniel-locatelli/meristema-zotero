# Scope gates the fill; the camera only orders it

The fill expands only papers the scope shows and stops when they are all
expanded, failed or capped; panning and zooming change the order of the queue
(selected, hovered, on screen, the rest) but never its contents. The obvious
alternative, fetching whatever scrolls into view, makes the plot grow because
of a pan, which the reader did not ask for and cannot undo.

**Consequences**: hidden papers are never expanded until shown; a scope change
or a new selection wakes the fill.
