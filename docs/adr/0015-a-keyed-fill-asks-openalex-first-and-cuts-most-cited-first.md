# A keyed fill asks OpenAlex first and cuts most cited first

A fill orders its candidates native-first, then moves OpenAlex to the front
whenever it is a paging provider for the direction: enabled and holding a key.
It asks for the list most cited first, and OpenAlex is the one provider that
honours that; the others return arrival order whatever is asked, and the
stored list records which it got. The cut stays fifty works per paper.

Why OpenAlex: measured on 2026-09-16, 393 of 432 fill requests went to
OpenCitations, which needs a lookup per paper and returns bare DOIs, so
hydration is a second pass; Semantic Scholar refused eleven of fifteen;
OpenAlex answered twenty of twenty, sorts, and returns metadata in the list,
and was asked last. With it first an expansion from hop 2 on is one request,
no lookup and no hydration, and the list response's `meta.count` supplies
the total a hinted parent could not otherwise report.

Why most cited first: the reader wants the whole field, and the place
completeness yields is each parent's tail. A cut of fifty in arrival order is
whichever fifty the provider returns; most cited first makes it the fifty
that matter, and the rail says which cut the shown lists carry rather than
what the fill intended, since a fallback provider cuts in arrival order.

Rejected: pruning by attention (expanding only what was looked at), which
answers a different reader; a reader-set budget, which adds a number the
rail already has too many of; batching parents into one OR-filter query,
which reworks per-paper bookkeeping and waits on this order being measured.

ADR 0006 and ADR 0013 stand: one answering provider per expansion, and a
refusal moves the expansion to the next candidate.
