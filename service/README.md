# Bug Report Triage Service

Turns a free-text bug report into a structured, triaged Gitea issue, checking
for duplicates before creating anything. Implements tickets #6–#14 (all
"Part of #5" — see that issue for the full build spec, and `docs/adr/` at
the repo root for the eight decisions this build follows).

## Running it

```
docker compose up --build
```

brings up Gitea (port 3000) and this service (port 8000) together. The
service's container mounts `./service` with `--reload`, so editing code
doesn't require a rebuild — only a fresh `docker compose up` if
`requirements.txt` changes.

Seed Set A (the four existing issues duplicate-detection checks against):

```
cd service && python -m scripts.seed_set_a
```

Safe to run more than once — it matches by title and skips issues that
already exist.

Health check: `GET /health` (also gitea's own reachability).

## The endpoint

```
POST /reports
{"raw_report": "free text..."}
```

Returns one envelope shape for every outcome (`issue_created`,
`duplicate_commented`, `review_flagged`, `feature_request_filed`,
`dropped_spam`) — all `2xx`. A `502` with `{error_code, report_hash}` means
the pipeline itself couldn't complete (LLM or Gitea unavailable after
retries); the identical POST is safe to retry. A `400` means the input was
empty/whitespace-only — the only rejection that happens before the pipeline.

## Architecture / the seam

`app/pipeline.py` holds every orchestration decision (Report Type gating,
severity/component branching, Duplicate Verdict routing, Review Flag
construction, both retry budgets, Decision Record transitions) against a
single `TriagePort` protocol (`app/port.py`) — no Gitea/Anthropic/
sentence-transformers imports in the pipeline module at all.

- `app/gitea_client.py` — direct Gitea REST calls (ADR-0004: not the `tea`
  CLI — no shell command built from LLM-derived text).
- `app/llm_client.py` — Anthropic tool-use calls for extraction and
  duplicate judgment, re-validated with Pydantic (ADR-0003, ADR-0007). The
  Raw Report is always wrapped as explicitly-delimited untrusted content;
  the actual guarantee is structural — `TriageDecision`/`DuplicateJudgment`
  are the only shapes that ever leave `llm_client.py`.
- `app/embeddings.py` — local `sentence-transformers` cosine similarity for
  Duplicate Candidate retrieval (no external embeddings API).
- `app/decision_store.py` — SQLite Decision Record, phased
  (pending → processing → completed/gitea_call_failed) for idempotent
  retries.
- `app/real_port.py` — composes the four above into the real `TriagePort`.
- `tests/fake_port.py` — one fake implementation of the same port, driving
  every orchestration test (`tests/test_*.py`, 30 tests) with zero network
  calls. This is where every ADR's routing logic gets its coverage.

## Testing

```
cd service
pip install -r requirements-dev.txt
pytest tests/ -q
```

These are fast, offline, and cover the orchestration logic against
`FakePort` — happy path, report-type routing, duplicate detection (incl. the
false-merge near-miss), retry budgets, unified Review Flags + bundling,
idempotency, and the HTTP response contract.

`eval/eval_set_b.py` is separate and *not* mocked — it POSTs Set B (plus two
self-authored near-miss duplicate cases) to a **running** service and the
**real** Anthropic API, asserting only on discrete/categorical fields
(report_type, severity, Duplicate Verdict tier + target), never on
generated prose:

```
docker compose up -d
cd service && python -m scripts.seed_set_a   # first run only
python -m eval.eval_set_b
```

## What I'd flag as rough edges / TODOs

- The duplicate-judgment retry path (`_judge_duplicate_with_retry` in
  `pipeline.py`) degrades a validation failure to "skip this candidate"
  rather than surfacing it anywhere — safe (favors missing a duplicate over
  a false merge) but silent. Worth a log line before this goes near
  production traffic.
- `EmbeddingIndex` re-embeds every open issue on every request; fine at
  this scale (a few dozen issues), not fine at thousands — an actual vector
  index/cache is the obvious next step, deliberately not built now.
- No auth on `POST /reports` (matches the spec's stated Out of Scope).
- `GiteaClient._label_id_cache` is process-lifetime and never invalidated;
  a label renamed/deleted directly in Gitea after the service starts would
  need a restart to pick up.
- Model choice (`ANTHROPIC_MODEL`, default `claude-sonnet-5`) is the same
  for extraction and duplicate judgment, per the spec's deliberate
  deferral of cost-optimized model selection.
