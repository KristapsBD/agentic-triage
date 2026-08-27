# The service calls Gitea's REST API directly, not the `tea` CLI

`docs/agents/issue-tracker.md` documents the `tea` CLI as the convention for repo
operations — written for agent-driven, human-adjacent sessions. The triage *service*
(the long-running process that turns Raw Reports into issues) instead calls Gitea's
REST API directly.

Shelling out to `tea` per request would mean building shell command strings that are
partly downstream of LLM-extracted content (titles, labels). That's exactly the kind of
subprocess-injection surface a system meant to be trustworthy on top of an unreliable
LLM component shouldn't have. The REST API gives typed requests, structured JSON
errors, and no shell in the loop. The `tea` convention still applies to agent/session
use of this repo; it does not apply to the service's own runtime path.
