# The duplicate-merge threshold is single-sourced in tier assignment, never in Confidence

Confidence already reflects duplicate similarity (a near-floor `clear_duplicate` reports
`medium`), but that only changed the reported label — the tier decision that actually triggers
an auto-merge was already made before Confidence is computed. Wiring Confidence in as a second
gate on the same action would mean two independently-tunable thresholds (the retrieval/tier
floor, and a confidence band) governing one outcome, which can drift apart as either gets
re-tuned.

The near-floor check moves into tier assignment itself: a near-floor `clear_duplicate` judgment
is demoted to `possible_duplicate` at the source. Confidence stays a purely descriptive field,
computed from whichever tier already won — it is never a control input into routing, and never
will be, including via a future LLM-self-reported-confidence field (self-reported confidence is
known to be poorly calibrated, so it isn't a substitute signal, only a second unreliable one).

A miscalibrated embedding score degrades to more human review, never to a wrong auto-merge — a
throughput cost, not a correctness one. The corresponding threshold values are expected to be
re-validated periodically against human-confirmed review outcomes, not trusted as a fixed
constant indefinitely.
