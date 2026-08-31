# Bug Report Triage Service

This repo is the take-home submission for `1_candidate_brief.md`. The real
entry point — how to run it, how to test it, and the file map — is
[`service/README.md`](service/README.md).

Other files at this level worth knowing about:

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr) — architecture decision records.
- [`docs/what-the-agent-got-wrong.md`](docs/what-the-agent-got-wrong.md) —
  what the agent building this got wrong while building it, and how it was
  caught (the brief's evaluation criteria ask for this explicitly).
- [`bootstrap.sh`](bootstrap.sh) / [`docker-compose.yml`](docker-compose.yml)
  — bring the whole stack (Gitea included) up from nothing.
