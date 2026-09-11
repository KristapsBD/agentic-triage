# Issue tracker: GitHub

Issues and specs for this repo live as issues in this repo's GitHub project
(`KristapsBD/agentic-triage`). Use the `gh-axi` wrapper around the [`gh`](https://cli.github.com/)
CLI (preferred over plain `gh`) for all operations — it mirrors `gh`'s `issue`/`pr` subcommand shape.

> This convention is for agent/session use of the repo (e.g. an agent creating or
> triaging issues on the user's behalf). The bug-triage service's own runtime path talks
> to a separate Gitea project (`acme-app`) via its REST API, not GitHub — see
> [ADR-0004](../adr/0004-service-uses-gitea-rest-api-not-tea-cli.md).

## Required-PR flow

`main` is branch-protected: changes land only via a pull request that passes the
CI quality gate (`.github/workflows/quality-gate.yml`). Required status checks
are `typecheck` and `coverage` — direct pushes to `main` are blocked, and a PR
with either red cannot be merged.

`lint` and `mutation` also run on every PR and report on it, but are **not**
required. `lint`'s complexity ceiling is red against 14 pre-existing functions
repo-wide (AGENTS.md): ESLint checks the whole tree, not just a PR's diff, so
only the *last* of the CRAP-ranked remediation backlog's (#5) fixes would ever
turn it green — making it required would deadlock that worst-first,
one-module-at-a-time plan, since no intermediate fix PR could pass either.
`mutation` is scoped to files changed since `main` (Stryker's `--since`) for
speed, but the full-repo mutation floor is already enforced locally by
`npm run preflight` and tracked by #5/#6. See the "Quality gate" section of
`AGENTS.md` for what each check enforces and its current pass/fail state.

**Note for whoever closes #6**: once the remediation backlog lands and `lint`
is clean repo-wide, add `lint` back to `main`'s required status checks
(`gh api -X PUT repos/<owner>/<repo>/branches/main/protection` with
`required_status_checks.contexts` including `lint`) — it was dropped only to
avoid the deadlock above, not because it's meant to stay optional forever.

## External issues

Only issues authored by the repo owner are ever picked up as actionable work.
`.github/workflows/external-issue-guard.yml` enforces this automatically —
any issue opened by someone else is closed immediately with an explanatory
comment.

## Setup

`gh-axi` needs GitHub auth configured in the environment before it works (same
prerequisite as the underlying `gh` CLI). Once authenticated, `gh-axi` infers the repo
from the git remote when run inside a clone, same as `tea`/`glab`.

## Conventions

- **Create an issue**: `gh-axi issue create --title "..." --body "..."` (or `--body-file` for multi-line descriptions).
- **Read an issue**: `gh-axi issue view <number>` for details, `gh-axi issue view <number> --comments` for the comment thread.
- **List issues**: `gh-axi issue list`, with `--label` and `--state` filters as needed.
- **Comment on an issue**: `gh-axi issue comment <number> --body "..."`.
- **Apply / remove labels**: `gh-axi label list` to see what's available, `gh-axi issue edit <number> --add-label "..."` / `--remove-label "..."` (singular, repeatable flags — `gh-axi issue edit --help` is the source of truth if this drifts again; labels must exist in the repo first — create with `gh-axi label create` if missing).
- **Close**: `gh-axi issue comment <number> --body "..."` to explain, then `gh-axi issue close <number>`.
- **Open a pull request**: `gh-axi pr create --title "..." --body "..." --head <branch> --base main`.
  Branch naming follows this repo's own history (`fm/<slug>`, or `fm/bt-<ticket#>-<slug>` for
  ticket work — check `git log --all` if unsure). Push the branch first
  (`git push -u origin <branch>`) — `gh-axi` doesn't push for you.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh-axi pr` equivalents (`gh-axi pr list`, `gh-axi pr view <number>`, `gh-axi pr create`).

GitHub numbers issues and PRs from a shared space per-repo (like Gitea), so a bare `#42` may be either — resolve with `gh-axi pr view <n>` and fall back to `gh-axi issue view <n>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "open a pull request"

Push the ticket's branch, then `gh-axi pr create` against it (see Conventions above). Reference
the ticket issue number in the PR description. This repo's `/implement` skill ships this way by
default — commit to a branch, push, open a PR — never a direct commit to `main` and never a
self-merge unless explicitly told to.

## When a skill says "fetch the relevant ticket"

Run `gh-axi issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh-axi issue create --label wayfinder:map`.
- **Child ticket**: an issue carrying `Part of #<map>` at the top of its description and labels `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). GitHub has no native sub-issue or dependency API in `gh-axi`, so this text-link convention is the fallback everywhere. Once claimed, the ticket is assigned to the driving dev (`gh-axi issue edit <n> --add-assignee <user>`).
- **Blocking**: a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: `gh-axi issue list --state open` scoped to the map's children, drop any with an open blocker in the `Blocked by` line or an assignee; first in map order wins.
- **Claim**: `gh-axi issue edit <n> --add-assignee <user>`, the session's first write.
- **Resolve**: `gh-axi issue comment <n> --body "<answer>"`, then `gh-axi issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
