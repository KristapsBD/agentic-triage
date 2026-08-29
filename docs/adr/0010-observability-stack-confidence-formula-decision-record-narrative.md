# Prometheus/Grafana/Loki for observability; Decision Record stays the canonical narrative

## Stack choice: Prometheus + Grafana + Loki, not a hosted APM

The service runs as a single-operator demo target, not a production fleet, so the
observability stack needed to be self-hostable via `docker-compose.yml` alongside Gitea and
`triage-service` with zero external accounts or API keys — a hosted APM (Datadog, Honeycomb)
would add a signup step and a network dependency for a demo that otherwise runs entirely
offline-capable. Prometheus (metrics, pull-based scrape of `GET /metrics`), Grafana
(dashboards + the alert rules in [ADR-0009](0009-dashboard-only-alerting-six-conditions.md)),
and Loki (log aggregation, fed by promtail tailing `triage-service`'s structured JSON stdout)
are the standard self-hosted combination for exactly this shape of problem, and all three
ship official Docker images with no license gate.

`report_hash` and `stage` are lifted out of the JSON log lines as Loki *structured metadata*
(`observability/promtail/promtail-config.yml`) rather than indexed labels — Loki's label
cardinality directly drives its storage cost, and `report_hash` is unbounded (one value per
request). Structured metadata is queryable (`| report_hash = "..."`) without paying that
cost.

## Confidence formula: structural evidence only, transient retries excluded

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

## Decision Record stays the canonical narrative; logs are a transient view

The full per-request evidence trail — duplicate candidates considered and their similarity
scores, per-stage latency, token usage — is persisted as new fields on `DecisionRecord`
(`service/src/reports/types.ts`, ticket #40) and written to the existing SQLite-backed
`DecisionStore` (`service/src/decisions/decision-store.ts`), not left to live only in
Loki-ingested logs. Loki's retention is configurable and, in this demo stack, unbounded only
by accident — nothing prevents an operator from shrinking it or wiping the `loki-data` volume.
The Decision Record already had to survive restarts and support "explain this past decision"
lookups by `report_hash` (its original purpose, predating this stack); extending it to also
carry the retry/candidate/token/timing narrative means that lookup keeps working even if logs
have rolled off, and it stays queryable directly via SQL against the durable
`triage-decisions` volume rather than requiring a live Loki instance.

Structured JSON logs correlated by `report_hash` still exist and are useful — tailing them
live during a demo is a real use case `promtail`/Loki serves well — but they're a *transient
view* onto the same events the Decision Record durably owns, not a second source of truth.
If the two ever disagreed, the Decision Record wins.

Dashboard-only alert delivery and the six specific alert conditions are covered in
[ADR-0009](0009-dashboard-only-alerting-six-conditions.md); this ADR covers the stack choice
and the two domain decisions (Confidence formula, Decision-Record-as-canonical-narrative)
that stack was built to support.
