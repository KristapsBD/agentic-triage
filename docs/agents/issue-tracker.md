# Issue tracker: Gitea

Issues and specs for this repo live as issues in this repo's self-hosted Gitea instance
(see `1_candidate_brief.md` — stood up via docker-compose). Use the [`tea`](https://gitea.com/gitea/tea)
CLI for all operations.

> This convention is for agent/session use of the repo (e.g. an agent creating or
> triaging issues on the user's behalf). The bug-triage service's own runtime path talks
> to Gitea's REST API directly, not via `tea` — see [ADR-0004](../adr/0004-service-uses-gitea-rest-api-not-tea-cli.md).

## Setup

`tea` needs a registered login before it works: `tea login add --name <name> --url <gitea-url> --token <token>`.
Once registered, `tea` infers the repo from the git remote when run inside a clone, same as `gh`/`glab`.

## Conventions

- **Create an issue**: `tea issues create --title "..." --description "..."`. Use a heredoc for multi-line descriptions.
- **Read an issue**: `tea issues <index>` for details, `tea comment <index>` for the comment thread.
- **List issues**: `tea issues list --output json`, with `--labels` and `--state` filters as needed.
- **Comment on an issue**: `tea comment <index> "..."`.
- **Apply / remove labels**: `tea label list` to see what's available, `tea issues edit <index> --add-labels "..."` / `--remove-labels "..."` (plural flags — `tea issues edit --help` is the source of truth if this drifts again; Gitea labels must exist in the repo first — create with `tea label create` if missing).
- **Close**: `tea comment <index> "..."` to explain, then `tea issues close <index>`.
- **Open a pull request**: `tea pulls create --title "..." --description "..." --head <branch> --base main`.
  Branch naming follows this repo's own history (`fm/<slug>`, or `fm/bt-<ticket#>-<slug>` for
  ticket work — check `git log --all` if unsure). Push the branch first
  (`git push -u origin <branch>`) — `tea` doesn't push for you.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `tea pulls` equivalents (`tea pulls list`, `tea pulls <index>`, `tea pulls create`).

Gitea numbers issues and PRs from a shared space per-repo (like GitHub), so a bare `#42` may be either — resolve with `tea pulls <n>` and fall back to `tea issues <n>`.

## When a skill says "publish to the issue tracker"

Create a Gitea issue.

## When a skill says "open a pull request"

Push the ticket's branch, then `tea pulls create` against it (see Conventions above). Reference
the ticket issue number in the PR description. This repo's `/implement` skill ships this way by
default — commit to a branch, push, open a PR — never a direct commit to `main` and never a
self-merge unless explicitly told to.

## When a skill says "fetch the relevant ticket"

Run `tea issues <index>` plus `tea comment <index>` for the thread.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `tea issues create --labels wayfinder:map`.
- **Child ticket**: an issue carrying `Part of #<map>` at the top of its description and labels `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Gitea has no native sub-issue or dependency API in the CLI, so this text-link convention is the fallback everywhere. Once claimed, the ticket is assigned to the driving dev (`tea issues edit <n> --assignees <user>`).
- **Blocking**: a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: `tea issues list --state open` scoped to the map's children, drop any with an open blocker in the `Blocked by` line or an assignee; first in map order wins.
- **Claim**: `tea issues edit <n> --assignees <user>`, the session's first write.
- **Resolve**: `tea comment <n> "<answer>"`, then `tea issues close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
