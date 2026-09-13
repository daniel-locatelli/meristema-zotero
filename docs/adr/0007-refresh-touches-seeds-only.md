# Refresh re-fetches the seeds only; the fill is silent

The toolbar's Refresh re-fetches the seeds' own lists in the current direction
and nothing else; hop papers are refreshed one at a time from the detail pane.
The fill runs on its own queue, epoch and counters, never drives the toolbar's
busy state, and its publications are coalesced to one column refresh and one
snapshot invalidation per 10 s, so a fill of hundreds of papers does not lock
the item tree. Marking hop papers stale in bulk was rejected: it would
re-spend the cap the reader already paid.
