# Confidence formula steps down on validation retries only, never on transient retries

[ADR-0001](0001-harness-derived-confidence.md) already decided Confidence must be
harness-derived rather than LLM-self-reported. `computeConfidence`
(`service/src/reports/confidence.ts`) is the concrete formula: a validation-budget exhaustion
forces `low`; each validation retry consumed steps the band down one level (`high` → `medium`
→ `low`); a `possible_duplicate` Duplicate Verdict caps the band at `medium` even with zero
retries; a Review Flag with no other signal also caps at `medium`; otherwise `high`.

Transient API retries (rate limits, timeouts, 5xxs — [ADR-0008](0008-separate-retry-budgets-validation-vs-transient.md)'s
other budget) are never an input to this function. A transient retry reflects Anthropic's
API having a bad moment, not the model's output being untrustworthy — folding it into
Confidence would make the score noisy in a way that has nothing to do with whether the
Triage Decision itself should be trusted. Only validation retries (the model's structured
output failing schema/business-rule checks) move the needle, because that failure mode is
actually evidence about the decision's quality.
