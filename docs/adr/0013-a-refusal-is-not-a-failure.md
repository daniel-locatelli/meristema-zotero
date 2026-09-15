# A refusal is not a failure

A hop expansion whose provider answers HTTP 429 is refused, not failed: the
paper stays in the plan and nothing is stored for it. The fill does not retry
a 429. It moves the expansion at once to the next paging provider, still one
answering provider per expansion. A provider that refuses after collecting
works has answered with a partial list: the expansion stores it as incomplete
and asks no one else, and the provider still sits out its window. The
refusing provider sits out a window of its own in that fill: 30 s, 1 min,
2 min, then every 5 min, reset by its next answer and ended early by Resume.
The fill waits only when every paging
provider is in a window, or every paper left is deferred behind one, with one
timer and nothing in flight. A refused snapshot with nothing collected is
never stored, on any path.

Refusals travel from the provider to the runner as a typed outcome
(`ProviderRefusedError`, then `refusedBy`, `skipped` and `answeredBy` on the
refresh's resolution), never inferred from timing, and the fill bypasses the
60 s provider register so the rail can always name who is refusing. A fill
also trusts an empty first page only with a lookup match or a reported count
behind it, since OpenCitations answers an unindexed DOI with an empty list.
This refines ADR 0006: the traffic ceiling per expansion becomes one refused
request per paging provider plus one lookup and one page. Rejected: a
provider-health register fed by timeouts, which cannot tell a refusal from a
slow answer, and failing a refused paper as before, which in a refusal storm
emptied the plan until the graph was reopened.
