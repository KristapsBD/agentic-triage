## Agent skills

### Issue tracker

Issues are tracked in this repo's self-hosted Gitea instance via the `tea` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Parallel work

Running more than one agent against this repo at once — concurrent sessions or spawned subagents — each one works in its own git worktree, never a shared one. See `docs/agents/parallel-work.md`.
