## Agent skills

### Issue tracker

This codebase's own planning/PRs live on GitHub (`origin`) via the `gh-axi`/`gh` CLI.
The triage service's separate runtime Gitea target (`acme-app`) is unchanged — see
[ADR-0004](docs/adr/0004-service-uses-gitea-rest-api-not-tea-cli.md). Old history and
PRs prior to the GitHub move remain on the `gitea` remote. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Parallel work

Running more than one agent against this repo at once — concurrent sessions or spawned subagents — each one works in its own git worktree, never a shared one. See `docs/agents/parallel-work.md`.

### Quality gate (complexity + coverage + mutation)

`service`'s `npm run preflight` enforces ESLint `complexity` (ceiling 4), Jest
`coverageThreshold` (80% lines/branches), and a StrykerJS mutation-score floor
(`service/stryker.conf.json`, `thresholds.break` = 65%), all scoped to exclude
`src/eval/**`, `src/scripts/**`, `*.module.ts`, and `main.ts`. Each check's
threshold lives in that check's own native config file (ESLint rule config,
Jest's `coverageThreshold`, Stryker's `thresholds`) rather than a shared file —
follow that pattern for any future check. As of the gate landing (issue #2), the
complexity ceiling is intentionally red against ~14 pre-existing functions —
this is not a regression to fix opportunistically; remediation is tracked by the
CRAP-ranked backlog issue (#5) and the tickets it generates, gating the freeze-lift
issue (#6). Don't raise the ceiling, loosen the floor, or add extra exclusions to
make it pass without a decision from whoever owns that initiative.

Mutation testing (issue #3) landed the same way: measured score is 62.65%
against a 65% floor chosen from the issue's 60-70% range (not tuned to pass),
so `test:mutation` is also intentionally red pending the same #5/#6 remediation
track — don't loosen the floor to make it pass either. `src/embeddings/embedding-index.ts`
is excluded from Stryker's `mutate` scope: it's not a speed carve-out, it's a hard
incompatibility — any Jest spec that exercises its real model inference crashes
Jest's sandboxed VM realm (confirmed by measurement, not assumed; see the file's
own docblock). Its existing manual check, `npm run tune:duplicate-floor`, is the
only verification path for that module and isn't run automatically by `preflight`.
`stryker run` also uses `service/jest.stryker.config.js` (transpile-only ts-jest,
via `isolatedModules`) rather than the normal Jest config — Stryker re-runs the
suite once per mutant, and full type-checking on every run makes mutation testing
CPU-bound on the compiler instead of the tests, causing spurious timeouts rather
than real signal; `npm run typecheck` already covers type-checking separately.

CI (issue #4) wires three of these checks — `typecheck`, `lint`, `coverage` —
into `.github/workflows/quality-gate.yml` as required GitHub Actions status
checks on `main` (branch protection blocks merging while any is red).
`mutation` also runs per PR there, scoped to changed files via Stryker's
`--since` for speed, but is report-only, not required — see
`docs/agents/issue-tracker.md` for the required-PR flow and why `lint` being
required means `main` is currently frozen for every PR (pending #5/#6).

### Observability stack (Prometheus/Grafana/Loki)

`docker-compose.yml` runs prometheus, loki, promtail, and grafana alongside gitea/triage-service. Config lives under `observability/` (prometheus scrape config — including a `gitea` job, since Gitea's own `GITEA__metrics__ENABLED` exposes `/metrics` purely so alerting can key off `up{job="gitea"}` — loki config, promtail pipeline that ships triage-service's structured JSON logs with `report_hash`/`stage` as Loki structured metadata, and Grafana's provisioned datasources + dashboard JSON + six red-light alert rules under `provisioning/alerting/` — no manual Grafana setup). Alerting is dashboard-only (no Alertmanager/notification channel); see ADR-0009 for the six conditions and their conservative thresholds. Grafana is at `http://localhost:3001` (anonymous Viewer access enabled).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## Improvement/suggestion decisions

Prefer the properly-engineered production solution over a quick fix that only patches the current implementation — but don't introduce abstraction, infrastructure, or generality the task doesn't actually need.