# Confidence is harness-derived, not self-reported by the LLM

The service needs to represent how much to trust a Triage Decision or a Duplicate
Candidate match. We compute Confidence from structural evidence the harness observes
directly — validation outcome, duplicate similarity score, retry count — rather than
asking the LLM to emit a confidence number as part of its structured output.

LLM self-reported confidence is known to be poorly calibrated: models produce
confident-sounding numbers that don't track actual correctness. Trusting that number
would reintroduce exactly the "confidently making things up" failure mode this service
exists to avoid.
