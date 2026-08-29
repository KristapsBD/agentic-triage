# Self-hosted Prometheus + Grafana + Loki, not a hosted APM

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
