# What the agent got wrong (and how it was caught)

This is PR #25's disclosure narrative from the live Gitea `bug-triage`
project, carried into the repo so it survives a `git bundle create --all` +
email delivery — the brief asks evaluators to read exactly this, but
evaluators won't have the Gitea instance, and PR descriptions/comments live
in Gitea's database, not in git (see `service/README.md`'s note on this).
Rewritten here against the current TypeScript tree; the original PR (and its
underlying commit `0665045`) predates the TS rewrite and referenced the
Python module names shown in brackets below.

## What this PR fixed

Four findings surfaced by running a synthetic test-ticket set
(`service/src/eval/eval-set-c.ts`, formerly `eval_set_c.py`) against the
already-implemented triage service, rather than by inspecting the code for
hypothetical problems:

1. Secrets/PII pasted into a bug report leaked verbatim into the Gitea issue
   body — including a channel initially missed: the LLM's own
   duplicate-judgment rationale, since it reads the *unredacted* report.
2. The raw report's verbatim quote was blockquoted, so embedded markdown
   (image tags, @mentions) rendered live in Gitea instead of as inert text.
3. Bundled and "unclear" reports skipped duplicate detection entirely, so a
   near-verbatim repeat of an existing issue got no cross-link if it arrived
   bundled with other complaints or worded too vaguely to classify cleanly.
4. A single bug with a causal chain of symptoms ("upload times out, then the
   thumbnail is broken") could get mis-split into `distinct_issues` and
   routed to review instead of filed directly.

## What the agent (Claude) generated

- `service/src/reports/redaction.ts` (then new; `app/redaction.py`):
  pattern-based secret/credential scrub.
- `service/src/reports/pipeline-body.ts` / `pipeline.service.ts` (then
  `app/pipeline.py`): redaction wired into every place raw/model text
  reaches a Gitea body; `quote()` (then `_quote()`) now fences instead of
  blockquoting; `findDuplicateVerdict()` (then `_find_duplicate_verdict()`)
  extracted into `duplicate-verdict.ts` and shared by the
  `bug`/`unclear`/`bundled` branches instead of living inline in the bug
  branch only.
- `service/src/llm/llm-client.ts` (then `app/llm_client.py`): one clarifying
  example added to the `distinct_issues` section of the system prompt.
- `service/src/eval/eval-set-c.ts` (then new, `eval_set_c.py`): the
  synthetic probe suite that surfaced these findings in the first place,
  kept as a reusable harness alongside `eval-set-b.ts` — see
  `service/README.md`'s Testing section for current suite sizes; the exact
  test counts have grown since this PR and are not repeated here to avoid
  the same kind of staleness a later audit flagged elsewhere in this repo.

## What was changed / caught before merging

- A `/code-review` pass (Standards + Spec sub-agents, run against the diff)
  caught a real gap the first pass of the fix missed: the duplicate
  judgment's rationale is free text the LLM writes *after* reading the
  unredacted raw report, so it could echo a secret back through a channel
  the initial redaction didn't cover. Fixed before commit, with its own
  regression test.
- Also caught: the eval harness's own bundled/unclear cases were asserting
  the *old*, buggy behavior (no cross-link) — updated them to assert the
  fixed behavior, otherwise the harness would misreport on its next run.
- Minor standards nits: fixed an argument-order inconsistency between
  neighboring functions; left a small "redact-or-placeholder" duplication
  alone rather than introduce an abstraction for two call sites.

## What wasn't fully trusted at the time

- The eval harness wasn't safely re-runnable as-is: re-running it after
  clearing the decision-store cache found its *own* previously-created
  Gitea issues as duplicates of themselves on the next pass. That's the
  dedup logic working correctly, not a regression — but it means a true
  before/after comparison needs a fresh-start reset (deleting the
  `acme-app` target repo), which wasn't done since it's destructive.
- The `distinct_issues` prompt-wording fix was spot-checked against live
  output, not unit tested — LLM classification isn't deterministic, so
  unlike the other three fixes it isn't guaranteed to hold under a future
  prompt or model change.
- A related finding — the report-type ontology has no bucket for neutral,
  non-actionable feedback, so it's silently dropped identically to spam —
  was flagged but **not** fixed in that PR; out of scope there.

## Since this PR: a second, independent skeptical pass

Two independent audits (`scout-brief-audit`, then two further
logic-gap-focused passes) later traced the DI composition, per-channel
redaction coverage, and concurrent-request semantics more deeply than this
PR's own eval-driven testing had. Their findings — a dropped retry-feedback
argument in the real `TriagePort` composition, three model-authored text
channels (`repro_steps`, `distinct_issues`, `title`) that reached Gitea
without the redaction this PR added elsewhere, no concurrency guard on the
Decision Record, and confidence never actually consuming the duplicate
similarity score the docs claimed it did — were fixed on top of this PR's
work, following the same pattern: find it by testing/tracing the real
seams, not by re-reading the code and hoping.

## Process note

The most useful part of the original iteration wasn't the fixing — it was
building a small synthetic test-ticket set first and running it against the
*already-implemented* service to see what actually broke, instead of
reading the code and guessing where problems might be. All four original
findings came out of that run, not out of a code audit. The later
audit-driven fixes above followed the same discipline in reverse: an
adversarial reader traced the seams a black-box eval run can't reach (DI
wiring, concurrency, doc/code drift) and those traces, not intuition,
produced the fix list.
