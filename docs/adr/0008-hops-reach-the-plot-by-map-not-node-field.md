# Hops reach the plot through a map, never a node field

The renderer and the Key learn a paper's hop from a map keyed by paper, set on
the renderer, not from a field on the node. The merged model keeps the
library's own node objects and drops the walk's copy for any library paper,
so a field stamped on the walk's copy never reaches the plot for the papers
most readers look at. The same trap earlier lost the seed-relative citation
sequence for library papers, which is still open. Any per-paper value the walk
computes and the plot needs must travel this way.
