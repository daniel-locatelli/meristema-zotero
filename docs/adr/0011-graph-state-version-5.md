# Graph state version 5 replaces `explore` with `hops`

A saved graph's Explore settings (direction, locality) became `hops`
(direction, depth, per-hop ticks) as version 5. Versions 1 to 4 still parse
and migrate, a `both` direction becomes Citers with a one-time toolbar notice,
and a record is read by its version, defaulting fields it lacks rather than
trusting whichever keys are present. Saved views carry `explore` on the wire
as direction plus hop count only, never the ticks.
