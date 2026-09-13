# The walk rebuilds on every landing; only publications are coalesced

After each expansion lands, the hop model is rebuilt, merged and drawn at
once, so the reader sees each paper arrive. The column refresh and snapshot
invalidation it causes are coalesced to one per 10 s (ADR 0007), but the walk
itself is not: a coalesced walk would make the plot lag the progress line. The
cost per landing is one walk over the opened hops on the UI thread, kept
linear by reading each list once and never reading lists at the depth. If a
500-expansion fill stutters on a large library, a coalescing window for the
rebuild is the intended knob and is a Stage 4 decision.
