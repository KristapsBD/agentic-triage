## Agent skills

### Issue tracker

Issues are tracked in this repo's self-hosted Gitea instance via the `tea` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Parallel work

Running more than one agent against this repo at once — concurrent sessions or spawned subagents — each one works in its own git worktree, never a shared one. See `docs/agents/parallel-work.md`.

### Observability seam

`TelemetryRecorder` (`service/src/telemetry/telemetry-recorder.interface.ts`) is the counters/histograms/structured-logs seam, injected into `PipelineService` the same way `TriagePort` is. Real implementation (`PrometheusTelemetryRecorder`, prom-client-backed) is exposed at `GET /metrics` via `MetricsController`, mirroring `HealthController`. Tests use `FakeTelemetryRecorder`/`NoopTelemetryRecorder` (never the real one) to keep the suite network-call-free — see `service/src/telemetry/testing/fake-telemetry-recorder.ts`.

### Disclosure narrative survives `git bundle`

The brief's delivery is a `git bundle` + email, so PR descriptions/comments
(which live in Gitea's database, not git) are dead on arrival for an
evaluator. `docs/what-the-agent-got-wrong.md` carries that narrative in a
tracked file instead; the root `README.md` points to it and to
`service/README.md`. Update `docs/what-the-agent-got-wrong.md` (not just a
Gitea PR description) when a change is significant enough to belong in the
disclosure story.

### Observability stack (Prometheus/Grafana/Loki)

`docker-compose.yml` runs prometheus, loki, promtail, and grafana alongside gitea/triage-service. Config lives under `observability/` (prometheus scrape config — including a `gitea` job, since Gitea's own `GITEA__metrics__ENABLED` exposes `/metrics` purely so alerting can key off `up{job="gitea"}` — loki config, promtail pipeline that ships triage-service's structured JSON logs with `report_hash`/`stage` as Loki structured metadata, and Grafana's provisioned datasources + dashboard JSON + six red-light alert rules under `provisioning/alerting/` — no manual Grafana setup). Alerting is dashboard-only (no Alertmanager/notification channel); see ADR-0009 for the six conditions and their conservative thresholds. Grafana is at `http://localhost:3001` (anonymous Viewer access enabled). Validate compose changes here with `docker compose config`/`docker compose build`, not a bare `docker compose up`, if another stack instance may already be running with the same fixed container names/ports.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
