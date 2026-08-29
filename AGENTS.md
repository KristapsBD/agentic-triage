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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
