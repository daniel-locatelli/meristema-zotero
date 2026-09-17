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

ADR 0013 otherwise stands, and `outcomeRefused` is unchanged: a provider
sitting out a window still makes a landing refused. Rejected: narrowing it, so
a never-asked provider fails the paper outright, which in a refusal storm
empties the plan — the failure mode 0013 exists to prevent.
