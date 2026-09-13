# One provider per hop expansion, and it must be able to page the direction

A hop paper is expanded by one provider, the paper's native provider first,
never by the seeds' aggregate of three; the cap times one lookup and one page
is the traffic ceiling. Because Crossref and Inspire only contribute
references embedded in a work record and cannot page them, a plan truncated
to one provider promotes a provider that can page the direction into the head
when the head has none (`limitRelationshipProviders`); the seeds'
three-provider merge is unchanged and still takes Crossref's embedded list.
This was a shipped defect first: a References expansion routed to Crossref
alone stored nothing and the paper was marked failed for the session.
