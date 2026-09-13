# A cap of 500 expansions per hop per direction per seeded graph

One Fetch press could otherwise fan out without bound. The fill stops at 500
expansions per hop per direction, shows `500 expanded · {n} waiting`, and
Fetch more raises the cap by 500. The cap bounds a day's provider budget and
the size of the walk. Counts, caps and the failed set all reset when the graph
loses its seeds, so "session" means the seeded graph, not the tab.
