# A view never changes scope

A view bundles appearance, regions, filters and hop settings, and applying one
never adds or removes seeds or folder ticks. A view that needs seeds the graph
lacks waits until they arrive, and the latest applied view owns that queue.
Views are the reader's looks at a graph; a look that silently rewrote what is
shown would be indistinguishable from data loss (graph-views spec, D4).
