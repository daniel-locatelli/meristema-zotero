# Seed links are checked against OpenAlex reference lists

A seed's hop-1 list is cut at 50 (ADR 0015), so a paper linked to two seeds
that made one cut read k = 1 (B78). With an OpenAlex key, OpenAlex enabled
and two or more seeds, a separate check asks OpenAlex for the reference lists
of the seeds and hop-1 papers (`select=id,doi,referenced_works`, 100 a
request) and the hop model adds every seed a list links a hop-1 paper to as a
parent, with its edge. Parents grow; hop membership, the counts and the cut
line do not. A separate pass, not `referenced_works` on the citer pages, so
saved graphs and lists other providers filled are checked too, and the
relationship storage is untouched. The answers live in their own table,
`openalex_reference_lists`, one list per work and a pointer per alias, so a
partial record never overwrites a work's metadata. Outside the gate the
count is the stored lists' alone, even with answers cached.
