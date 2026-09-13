# Citation hop is a categorical colouring; hop opacity fades under every colouring

A paper's hop shows as an entry in the gear's colour list, Citation hop, with
categories Seed and Hop 1 to Hop 6, like publication type. Independently,
every paper's fill, label and edge fade by hop under whatever colouring is
active, on the ramp 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4. The design's hop-painted
fill was not built because it would have collided with the colour system's
reserved channels (colour-system spec, D3). The entry is available only while
the graph has a seed, toggled by seededness, because library nodes never
carry a hop field (ADR 0008).
