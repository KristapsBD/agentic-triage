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

### Postgres + Prisma (local persistence infra)

A `postgres` service in the root `docker-compose.yml` provisions local Postgres, port 5432
published to the host for a direct client connection. `service/prisma/schema.prisma` models
the `Decision` header table plus `DuplicateCandidate`/`TokenUsage`/`StageTiming` child
tables (each cascade-deleted with its parent), mirroring `service/src/reports/types.ts`'s
`DecisionRecord` shape; the initial migration is checked into `service/prisma/migrations/`.
`service/prisma.config.ts` loads `DATABASE_URL` from the repo-root `.env` rather than a
service-local one, matching every other env-driven script's convention (see
`service/src/eval/*.ts`, `service/src/scripts/*.ts`). This is infrastructure only (issue
#58): nothing in the application reads from this database yet. The still-live SQLite
`DecisionStore` (`service/src/decisions/decision-store.ts`) remains the real persistence
path until issue #59 wires a `PrismaService` up to the existing `TriagePort` interface.
Nothing applies the checked-in init migration automatically (not docker-compose,
not `package.json`, not the Makefile), so a fresh `postgres` volume starts empty —
run `make migrate` (wraps `prisma migrate deploy`). `make migrate-status` wraps
`prisma migrate status`; `make migrate-down` is a manual rollback (Prisma has no
single-step "down" short of `migrate reset`, which wipes all data) that applies
the migration's own `down.sql` and then deletes its row from `_prisma_migrations`
so `migrate`/`migrate-status` see it as pending again — see the "Postgres
migrations" section in `README.md`.

### Quality gate (lint + format + complexity + coverage + mutation)

`service`'s `npm run preflight` runs, in order: `typecheck`, `lint`
(`eslint --max-warnings=0`, including the type-checked
`@typescript-eslint/no-floating-promises`/`no-misused-promises` rules),
`format:check` (Prettier, config in `service/.prettierrc.json`),
`format:prisma:check` (`service/scripts/check-prisma-format.sh` — a hand-rolled
`--check` since Prisma's CLI has no such flag; it diffs a formatted scratch copy
against the committed schema rather than mutating it), `test:coverage` (Jest
`coverageThreshold`, 80% lines/branches), `eval`, and `test:mutation` (StrykerJS,
`service/stryker.conf.json`, `thresholds.break` = 65%). Coverage/mutation are
scoped to exclude `src/eval/**`, `src/scripts/**`, `*.module.ts`, and `main.ts`.
Each check's threshold/config lives in that check's own native file (ESLint rule
config, `.prettierrc.json`, Jest's `coverageThreshold`, Stryker's `thresholds`)
rather than a shared file — follow that pattern for any future check. CI's `lint`
job (`.github/workflows/quality-gate.yml`) runs `lint`, `format:check`, and
`format:prisma:check` as separate steps. As of the gate landing (issue #2), the
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
`src/decisions/decision-store.ts`, `decision-record.mapper.ts`, and
`prisma.service.ts` (issue #59) are excluded from `mutate` the same way, for the
same reason: their only test, `decision-store.spec.ts`, provisions a real
testcontainers Postgres per suite run, and Stryker's per-mutant re-run model pays
that container-startup/migration cost on every single mutant — measured directly
(`npx stryker run --mutate src/decisions/decision-store.ts`), every mutant timed
out rather than being killed or surviving.
`stryker run` also uses `service/jest.stryker.config.js` (transpile-only ts-jest,
via `isolatedModules`) rather than the normal Jest config — Stryker re-runs the
suite once per mutant, and full type-checking on every run makes mutation testing
CPU-bound on the compiler instead of the tests, causing spurious timeouts rather
than real signal; `npm run typecheck` already covers type-checking separately.

CI (issue #4) wires these checks into `.github/workflows/quality-gate.yml`,
run on every PR against `main`. Only `typecheck` and `coverage` are required
GitHub Actions status checks (branch protection blocks merging while either
is red); `lint` and `mutation` also run and report on each PR but are not
required — `lint` because ESLint checks the whole tree rather than a PR's
diff, so making it required would deadlock the CRAP-ranked remediation
backlog (#5), where only its last fix could ever turn the check green, and
`mutation` because a full-repo run is too slow for a per-PR gate. Stryker
v10 dropped the `--since=<ref>` flag its predecessor had; the `mutation` job
scopes itself instead by computing `git diff --name-only origin/main...HEAD`
(filtered through the same exclusions as `stryker.conf.json`'s `mutate`
globs) and passing that file list to `stryker run --mutate` — the supported
mechanism for a stateless PR runner, since Stryker's own `--incremental`
mode needs a cache persisted across runs that GitHub Actions doesn't provide
here. See `docs/agents/issue-tracker.md` for the required-PR flow, and its
note for whoever closes #6 to add `lint` back as required once the tree is
clean.

Since going public, only issues authored by the repo owner (`KristapsBD`) are
ever picked up as actionable work; `.github/workflows/external-issue-guard.yml`
auto-closes everything else (see `docs/agents/issue-tracker.md`).

### CodeRabbit review loop

This repo is public with under 10 stars, so CodeRabbit never auto-reviews a PR
here (`docs.coderabbit.ai/configuration/auto-review`) — the ship-flow crewmate
that owns a PR from push through CI through merge comments `@coderabbitai
review` itself: once immediately after opening the PR, and again after every
subsequent push to that branch, including pushes made by the fix loop below.
This is instructions on the existing crewmate, not a new bot or workflow.

When CodeRabbit requests changes, the same crewmate runs a bounded fix loop
driven by a pure decision function of `(attempt_number, latest_review_verdict)
-> {run_autofix, self_fix, escalate, done, wait}`
(`service/src/ci/coderabbit-review-loop.ts`, colocated Jest spec, same
convention as `duplicate-verdict.ts`/`confidence.ts`/`retry.ts`):

- Verdict `approved` (no actionable comments) at any point -> `done`, proceed
  to merge as normal.
- Verdict `pending` (review hasn't run yet, or CodeRabbit's hourly review cap
  was hit) -> `wait`: recheck later, don't consume an attempt, don't escalate,
  don't report done. Never read a not-yet-run review as `changes_requested`.
- Attempt 1, verdict `changes_requested` -> `run_autofix`: comment
  `@coderabbitai autofix`, wait for its fix commit, re-trigger review, and
  re-check.
- Verdict still `changes_requested` on the re-review after the last allowed
  attempt -> `escalate`: append `blocked: CodeRabbit review still requests
  changes after <N> fix attempt(s) (PR #<n>)` to the status file and stop —
  never merge over an unresolved verdict.

The attempt cap is `MAX_FIX_ATTEMPTS` in that file. Spec caps it at 3 (1
`autofix` + 2 `self_fix` tries), but it's fixed at 1 here: this repo's plan
allows only ~1 included review per hour, and the captain has confirmed no
higher-tier plan will be purchased for this repo, so a 3-attempt loop
permanently cannot get 3 fresh reviews inside that window (issue #56). The
cap stays a named constant so it can still be changed in one line if the
plan ever does.

`.coderabbit.yaml` at the repo root versions the review profile, pre-merge
checks, and path filters actually configured on CodeRabbit — see that file's
own header for how it was derived. CodeRabbit is not yet among `main`'s
required status checks (that's a deliberate later phase, added only once this
trigger/fix-loop instruction set has run clean on real PRs).

### Observability stack (Prometheus/Grafana/Loki)

`docker-compose.yml` runs prometheus, loki, promtail, and grafana alongside gitea/triage-service. Config lives under `observability/` (prometheus scrape config — including a `gitea` job, since Gitea's own `GITEA__metrics__ENABLED` exposes `/metrics` purely so alerting can key off `up{job="gitea"}` — loki config, promtail pipeline that ships triage-service's structured JSON logs with `report_hash`/`stage` as Loki structured metadata, and Grafana's provisioned datasources + dashboard JSON + six red-light alert rules under `provisioning/alerting/` — no manual Grafana setup). Alerting is dashboard-only (no Alertmanager/notification channel); see ADR-0009 for the six conditions and their conservative thresholds. Grafana is at `http://localhost:3001` (anonymous Viewer access enabled).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## Improvement/suggestion decisions

Prefer the properly-engineered production solution over a quick fix that only patches the current implementation — but don't introduce abstraction, infrastructure, or generality the task doesn't actually need.

## Output

Keep output short and concise in plain simple english