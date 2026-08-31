# Bug Report Triage Service

This repo is the take-home submission for `1_candidate_brief.md`. The real
entry point — how to run it, how to test it, and the file map — is
[`service/README.md`](service/README.md).

This delivery is a `git bundle`: PR descriptions/comments and the planning
tickets the service README cites live in Gitea's own database and do not
survive a bundle/clone.
[`docs/what-the-agent-got-wrong.md`](docs/what-the-agent-got-wrong.md) carries
that disclosure narrative — what the agent building this got wrong while
building it, and how it was caught — in a form that ships with the repo (the
brief's evaluation criteria ask for this explicitly).

Other files at this level worth knowing about:

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr) — architecture decision records.
- [`bootstrap.sh`](bootstrap.sh) / [`docker-compose.yml`](docker-compose.yml)
  — bring the whole stack (Gitea included) up from nothing.
