# One breadth-first hop model replaces the per-seed focus projection

The seeds' neighbourhood is a breadth-first walk from all seeds over stored
lists, to the opened depth, keeping every parent. The older per-seed one-hop
projection was that walk's special case at depth 1 and was deleted rather than
extended: two models would have meant two visibility rules, two caches and two
ways for a paper to reach the plot.

**Consequences**: a paper sits at its shallowest hop; the walk is pure and
reads lists through one lookup, so anything that changes a stored list must
invalidate that paper's cached fragment.
