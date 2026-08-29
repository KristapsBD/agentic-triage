# Six independent red-light alerts, dashboard-only, no composite health score

Grafana is provisioned with six alert rules (`observability/grafana/provisioning/alerting/rules.yml`),
one per known failure mode: Gitea unreachable, LLM transient-error rate, validation-retry-budget
exhaustion rate, Review Flag rate spike, duplicate-judgment silent-skip firing, and p95
end-to-end latency breach. Each has its own threshold and its own red/green state, rather than
folding them into one composite score — a single "system health" number would hide *which*
subsystem degraded behind an average, which is the opposite of what an operator needs when
deciding where to look first.

No Alertmanager, webhook, Slack, or email channel is wired up: no contact points or notification
policies are provisioned alongside the rules. A firing alert is visible only in Grafana's own
Alerting page and the dashboard's "Red-Light Alerts" panel (`alertlist`, `triage-overview.json`).
Building paging infrastructure for a single-operator demo system is deferred until there's an
operator who isn't already watching the dashboard.

Every threshold is a conservative placeholder chosen with no historical baseline (same spirit as
`service/src/scripts/tune-duplicate-floor.ts`), documented per-rule in `rules.yml`'s comments and
each rule's `annotations.threshold` field:

- **Gitea unreachable**: `up{job="gitea"} < 1` for 1m. Gitea's own `/metrics` (`GITEA__metrics__ENABLED`,
  `docker-compose.yml`) is scraped by Prometheus purely so this rule can key off `up`, mirroring
  the existing `up{job="triage-service"}` panel from ticket #42 — no blackbox-exporter container
  needed for a single well-known target.
- **LLM transient-error rate** / **validation-retry-budget exhaustion rate**: both read
  `triage_retry_outcomes_total` (ticket #41), split by the `budget` label (ADR-0008) so an
  Anthropic-side hiccup is never conflated with the model's output failing validation. Both fire
  on any occurrence in a 5m window (`> 0`) — deliberately oversensitive until real traffic volume
  gives a basis for a rate threshold instead of a bare occurrence count.
- **Review Flag rate spike**: the one ratio-based rule (`review_flagged` share of
  `triage_outcomes_total` over `rate(...[5m])`, threshold `> 0.3`) rather than an absolute count,
  so it reads as a genuine mix-shift instead of firing on every single Review Flag during normal
  low-traffic operation.
- **Duplicate-judgment silent-skip firing**: `triage_duplicate_judgment_silent_skip_total` (ticket
  #41) increasing at all, `for: 0s`. This is the README's own flagged rough edge — a candidate's
  judgment quietly dropped rather than judged — so it fires on the first occurrence rather than
  waiting for a rate.
- **p95 end-to-end latency breach**: a new `PipelineStage` value, `end_to_end` (`types.ts`),
  recorded once per freshly processed report (`PipelineService.finishRequest`, ticket #43) —
  covers the whole request's wall-clock time, not a quantile pooled across unrelated per-stage
  buckets the way naively summing the existing per-stage histogram would. Threshold `> 5000ms`
  for 2m.

Reusing the existing `triage_*` metrics from #41/#42 for five of the six rules was deliberate:
only the latency rule needed a new metric, and only the Gitea rule needed new scrape config.
