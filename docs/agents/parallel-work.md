# Parallel work: one worktree per engine

Two engines editing the same working tree collide: overlapping file edits, and races on
`git commit`/`git status` since they share one index. The fix is isolation, not care —
give every concurrently-running agent its own git worktree, never a shared one.

## Rule

Before starting work that will run **alongside** another agent on this repo, that engine
works in its own worktree. This applies whether "engine" means a session you're driving
directly or a subagent you spawn.

- **Driving a session directly** (e.g. two terminals/sessions open on this repo at once):
  call `EnterWorktree` at the start of the session. This doc is what makes that automatic —
  `EnterWorktree` only fires unprompted when project instructions say to, which is what this
  file is for. `ExitWorktree` with `action: "keep"` when the session's work is done but not
  yet merged; `"remove"` once it's merged and disposable.
- **Spawning a subagent for parallel implementation work** (e.g. two `/implement` runs
  launched at once): pass `isolation: "worktree"` on each concurrent `Agent` call. This is a
  spawn-time parameter, not something the subagent decides — set it every time you spawn
  more than one agent against this repo concurrently.

## Pair with non-overlapping tickets

A worktree stops engines from colliding on disk; it doesn't stop them from both editing the
same file and creating a merge conflict later. Use `/to-tickets`' blocking edges so
concurrently-run tickets are provably disjoint in scope — only pull a ticket whose blockers
are satisfied — rather than hoping two engines don't touch the same file.

## Merging back

Merges land serially, one worktree's branch at a time — that's the one shared-state
operation and it's supposed to happen there, not mid-edit. If a real conflict surfaces
(genuinely overlapping files, not a race), resolve it with `/resolving-merge-conflicts`.
