# Gitea issue creation carries its own idempotency marker; the Decision Record's phases don't cover a crash mid-write

The phased Decision Record (`pending` → `processing` → `completed`/`gitea_call_failed`) makes a
thrown exception recoverable, but not a hard crash landing between a successful Gitea write and
the record being persisted as `completed`. A retried identical POST in that exact window would
resume from an already-computed pending action and call `createIssue` again, producing a
duplicate issue in Gitea itself — the local record's phases can't guarantee atomicity with a
write to a separate system.

Each created issue is tagged with its report hash, as an invisible marker in the body, at
creation time. The create-issue path checks for an existing issue carrying that marker before
creating a new one, so a retry is idempotent against Gitea's actual state, independent of what
the local Decision Record believes happened.
