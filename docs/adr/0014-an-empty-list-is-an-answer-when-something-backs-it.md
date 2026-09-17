# An empty list is an answer when something backs it

A fill trusts an empty first page when a lookup match, a reported count, or a
work-ID hint the asking provider itself supplied stands behind it. A hint is
backing because the provider emitted that identifier in one of its own citation
links, and the fill skips the lookup that would otherwise match it. Unbacked, an
empty page is still a failure and is still never stored.

An empty answer does not end an expansion while another candidate can be asked.
This refines ADR 0013's "one answering provider per expansion": the expansion
stops at works, at a failure, or at a refusal with a usable partial list, and
the last candidate's empty list stands as "no citers". The window cleared by a
landing belongs to the last usable snapshot that contributed works, or, when
every answer was empty, to the last provider that answered.

A paper deferred three times with nothing ever stored fails for the session, so
`markFailed` is reachable while a provider holds an open window. Resume undoes
those failures and only those: a paper a provider answered nothing usable for
stays out.

Three deferrals is deliberately shorter than the cool-down ladder, whose last
rung is "every 5 min, never giving up". A paper can therefore never reach that
rung: a provider refusing for much longer than three minutes empties the plan
into the session's failures. That is the trade — a fill that ends over a fill
that never does — and Resume is the whole of the recovery, so the progress line
stays while any paper is limit-failed rather than vanishing with the plan that
produced it.

The traffic ceiling ADR 0006 and ADR 0013 state is refined rather than dropped.
An expansion may now ask a lookup and a page of each paging provider, because an
empty answer no longer ends it. A provider that reports zero is the exception and
still ends the expansion at once: a reported zero is backing in its own right and
needs no second opinion.

ADR 0013 otherwise stands, and `outcomeRefused` is unchanged: a provider
sitting out a window still makes a landing refused. Rejected: narrowing it, so
a never-asked provider fails the paper outright, which in a refusal storm
empties the plan — the failure mode 0013 exists to prevent.
