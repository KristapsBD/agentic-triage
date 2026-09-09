# Candidate Brief — Live Session Prep

## What this is

We build software in a heavily agent-driven way: specs in markdown, agents do most of the
typing, engineers steer, review, and harden. The interview mirrors that. **Use AI/agents
freely — that is the job, not cheating.** We're not testing whether you can write code from
memory; we're testing whether you can build a *trustworthy* system on top of an unreliable
component (an LLM).

## Bring your own project (the default)

The live session runs on something *you* built. By default that's your own showcase or
existing project: something substantial you built yourself and can run and extend live, with
the agentic workflow visible — markdown specs, agent definitions, skills, MCPs, roles — as
far as your experience reaches. An LLM in the runtime path is a plus, not a requirement.

## Time & format

- **Prep (async):** aim for ~2–3 hrs, up to ~1 week. Come with something running.
- **Live session (~1 hr, Zoom):** you share your screen and drive your own environment — a
  short walkthrough, then we extend it together live.
- **Nothing is submitted.** Everything stays on your machine; we only see it over screen share.

## Out of ideas? The fallback exercise

If you don't have anything suitable to bring, build this instead: a service that turns a
**free-text bug report** into a **structured, triaged issue** in a self-hosted **Gitea**
instance —

- a concise **title**
- a **severity**: `critical` | `high` | `medium` | `low`
- **component labels** from: `frontend`, `backend`, `api`, `auth`, `database`, `infra`,
  `docs`, `unknown`
- extracted **repro steps** — or a note that none were provided (don't invent them)
- a **duplicate check** against existing open issues — a confident duplicate gets a
  comment/link on the existing issue, not a new one
- the issue created in Gitea

Input however you like — HTTP endpoint or CLI both fine. Hints:

- Stand the whole thing up yourself with `docker-compose`, Gitea included. Seed Gitea with
  the issues from the sample data file so your duplicate check has something to work against.
- LLM access: your own harness — your keys, your provider, your subscription.
- Framework: your choice. Plain SDK calls or any agentic framework — reach for whatever lets
  you build a trustworthy system fastest.
- Commit to the Gitea repo and open at least one PR. Use the PR description to note what the
  agent generated, what you changed, and what you didn't trust.
- TODOs and rough edges are fine. Note them.

## How we evaluate

Not line by line — the live session is about the experience of building it. We look at the
engineering *around* the LLM: well-formed output, behavior on weird/empty/hostile input,
degrading gracefully instead of confidently making things up, dedup without false merges.

Just as much, we rate the agentic ecosystem you built to get there: your agent definitions,
skills, connected MCPs, and the roles you set up — tester, QA, validator, reviewer, whatever
you found useful. Show us how you drove it, not just what it produced.

If you catch yourself asking "how would I even know if this is right?" — good. That question
is most of the job.

---

*Version: 2026-09-09*
