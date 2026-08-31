# What the agent got wrong (and how it was caught)

The brief asks for this explicitly: "Can you explain what the agent got
wrong while you built it, and how you caught it?" The original answer to
that question — PR #25's disclosure body — is genuinely good, but it lives
only in the Gitea instance this repo stands up, which the brief says graders
won't have access to (PR descriptions/comments live in Gitea's database, not
in git), and it describes files from an earlier Python implementation that
no longer exists (`service/app/*.py`, deleted in `40a520f`). This rewrites
that answer against the current TypeScript tree, and folds in what two
independent adversarial audits (`scout-hire-audit-opus`,
`scout-hire-audit-fable`) found afterwards by probing and tracing the
*composed* system rather than just reading its code.

## What the agent generated

A NestJS/TypeScript service (`service/src/`) that turns a free-text bug
report into a triaged Gitea issue: forced-tool-use structured extraction
against Claude, re-validated independently with Zod; a three-tier duplicate
verdict (`clear_duplicate` / `possible_duplicate` / `not_a_duplicate`) built
from local embedding retrieval plus an LLM judge call; two independent
retry budgets (transient vs. validation) around every LLM call; a phased
Decision Record so a repeated POST never re-runs the pipeline; and four
eval suites (Set A fixtures, Set B golden-value regression, Set C
adversarial probes, Set D production-scale anchors) plus a unit suite
exercising the orchestration logic against one fake port.

## What I changed — caught before merging

The original Python build's own disclosure (preserved in spirit here) came
from building a small adversarial probe set and running it against the
already-implemented service, not from re-reading the code — the same
methodology this document continues. That run caught a redaction gap: the
duplicate-judgment rationale is free text the model writes after reading
the *unredacted* raw report, so it could echo a secret back even though the
raw report itself is redacted everywhere it's quoted verbatim
(`duplicate-verdict.ts`'s `redactSecrets(judgment.rationale)` is the fix
that resulted, still in place today).

## What I don't fully trust yet — and what independent adversarial probing found that I hadn't

Two independent audits each ran a second adversarial pass against the
*composed, running* system — not a code read — and between them reproduced
or traced several defects that no amount of reading the code or the unit
suite would have surfaced, because they live specifically in behavior that
only exists once every piece is wired together and exercised live, or under
concurrency. All are now fixed; they're worth stating plainly rather than
quietly patched, because the *shape* of each mistake is more instructive
than the fix.

**A reproducible false merge into the service's own Review Flag
placeholders** (`scout-hire-audit-opus`, the audit's top finding).
`routeBundled` deliberately doesn't auto-split a bundled report describing
several distinct bugs — `CONTEXT.md` and the ADRs say a human should decide
how to split it, so it becomes a `needs-triage` placeholder issue instead.
That placeholder is a completely ordinary open Gitea issue as far as
`listOpenIssues()`/`findDuplicateVerdict` are concerned, so a *later*,
distinct, well-specified report describing one of the bundle's constituent
bugs got judged — correctly, on the LLM's own honest reading of "does this
describe the same underlying bug as this candidate?" — as a
`clear_duplicate` of the bundle. It silently merged as a comment on the
placeholder: no issue of its own, no severity or component labels, reported
at `confidence: high`. The audit reproduced this live, twice, against a real
bundle. Two individually reasonable design decisions — "don't auto-split a
bundle" and "dedupe against every open issue" — combined into a wrong
outcome neither decision predicts on its own. Nothing had filed a bundle and
then posted one of its constituent bugs afterward, so nothing caught it.
Fixed by demoting a `clear_duplicate` match against a
`needs-triage`/`needs-info` placeholder to `possible_duplicate` — the
existing three-tier design already exists for exactly this — so a real
match still cross-links, but gets its own issue instead of vanishing into
someone else's queue. A regression test (`review-flag-and-bundling.spec.ts`)
now files a bundle, then posts a constituent bug, and asserts the verdict is
never `clear_duplicate` against the placeholder.

**Production wiring silently dropped the validation-retry feedback for
duplicate judgment** (found independently by both audits —
`scout-hire-audit-opus`'s F2 and `scout-hire-audit-fable`'s F1, the same
defect). `ADR-0008`'s self-correcting retry — a validation failure gets fed
back to the model so its next attempt can fix the mistake it made — was
implemented, tested, and asserted... and never actually ran in production
for duplicate judgment. `triage-port.provider.ts`'s real DI composition
dropped the third `feedback` argument on the line wiring `judgeDuplicate` to
the LLM client, so every validation-retry prompt was byte-identical to the
one that just failed. The unit suite asserted the *opposite* of this bug and
passed, because it drove `FakeTriagePort` directly — a fake that implements
`TriagePort`'s full signature itself — rather than the real composition. The
one seam where the defect actually lived was structurally invisible to a
suite built entirely around one fake port. Fixed with a one-line change,
plus a new `triage-port.provider.spec.ts` that calls the *real* `useFactory`
(the way Nest's DI container does) rather than the fake, so a regression
here can't hide behind the fake again.

**Two concurrent POSTs of the identical Raw Report could both run the LLM
and both write to Gitea** (`scout-hire-audit-fable`'s F3). `processReport`
reads the Decision Record, then later claims and writes it, with `await`
points in between; nothing stopped two near-simultaneous requests for the
same report hash from both observing "no record yet" and both doing the
full LLM+Gitea round trip, producing a duplicate issue or comment.
`DecisionStore` now does an atomic insert-or-bail claim so only one request
wins and the other waits for the winner's result rather than repeating the
work. The remaining, narrower case — two *differently-worded* near-
simultaneous reports of the same new bug both listing open issues before
either has filed — can't be closed by a report-hash-keyed guard and is
disclosed in `README.md`'s rough edges instead of silently left
undocumented.

Each of these is exactly the kind of mistake the brief says it's screening
for more than a clean bill of health: not sloppiness, but a design decision
that looked correct in isolation, or a test double that looked complete in
isolation, hiding a defect that only exists at the intersection with
something else — composition, concurrency, or another individually-sound
decision.

**Other things this pass tightened, lower severity, still worth naming:**

- Confidence claimed (per `ADR-0001`/`CONTEXT.md`) to incorporate duplicate
  similarity but never actually consumed the numeric score, only the
  categorical tier — a `clear_duplicate` verdict right at the edge of the
  similarity floor reported the same `confidence: high` as one far above
  it. Found independently by both audits. `computeConfidence` now bands a
  near-floor `clear_duplicate` down to `medium`.
- The eval harness asserted the *positive* half of "extract clean repro
  steps, or record that none were provided — do not invent them" but never
  the fabrication-resistant half. Added a case that feeds a step-free,
  noisy-log-style report and asserts zero extracted steps.
- Set C's two flagship anti-false-merge checks hardcoded issue numbers, so
  they'd silently pass regardless of actual behavior if numbering ever
  drifted. Switched to the same title-based resolution Set B/D already use.
- One Set C case asserted a Gitea behavior that doesn't exist (issue-body
  keyword auto-close) — verified live that Gitea only honors that from
  commit messages/PR descriptions, dropped the case, and repointed its
  neighbor at what the fencing defense actually buys: the injected
  markdown/URL text sitting inertly inside a fenced code block, not merely
  being present in the body.
- Redaction covered the raw-report quote and supporting evidence, but not
  the other LLM-copied free-text channels reaching Gitea: extracted repro
  steps, `distinct_issues`, and the issue title itself. All now go through
  `redactSecrets()`, with a new Set C case narrating a secret inside a
  repro step to guard the previously-uncovered channel.
- "PII" redaction was claimed (in the eval case name and the original PR
  body) but only credential patterns were implemented — an email address
  landed in the Gitea body verbatim. `redaction.ts` now also scrubs email
  addresses, and the E5 eval case asserts on both.
- Possible-duplicate and unclear issues carried only a `needs-triage`/
  `needs-info` label; the severity/components the model had already
  extracted were computed and persisted but never surfaced anywhere a human
  reviewer looks. Now surfaced in the issue body as an explicit "Extracted,
  unconfirmed" suggestion — never as an applied label, since it isn't
  confident enough to assert as one.
- A permanent Gitea rejection (bad token, deleted repo, an oversized title)
  was indistinguishable from a transient one, so it inherited the "safe to
  retry the identical POST" contract meant for 5xx/network failures.
  Distinguished by status code; a permanent rejection now returns a
  distinct, non-retry-safe error.

## What I still don't fully trust

- **`spam_or_off_topic` reports `confidence: high` while silently
  discarding the report with no Gitea artifact at all** — the one outcome
  with no trace is also the one claiming maximum certainty. This is a
  genuine product-ontology gap (there's no bucket for "neutral,
  non-actionable feedback" distinct from spam), not obviously a bug, and
  wasn't in scope for this pass.
- **Feature requests never go through duplicate detection** — only `bug`,
  `unclear`, and bundled paths call `findDuplicateVerdict`. Ten users asking
  for the same feature produce ten open issues. Defensible under the
  brief's letter (dedup is framed around bug reports) and the asymmetry is
  now documented in `README.md` as a deliberate scope choice, but it
  wasn't closed.
- **`unknown` can be applied to components alongside a real label**
  (`components: ['backend', 'unknown']`), which makes `label:unknown`
  useless as a "still needs a component decision" filter.
- **Duplicate retrieval takes the top-3 candidates and the first `yes` in
  similarity order**, with no tie-break toward a better-quality match.
  Measured as not-yet-biting at the current corpus size, but both the
  fixed top-k and first-match-wins policy are false-negative/wrong-target
  risks as the corpus grows.
- **Extraction sets `max_tokens: 1024` with no `stop_reason` guard.** A very
  long, heavily-narrated report gets summarized by the model rather than
  truncated mid-JSON in every case tried — but nothing in the system would
  currently distinguish "the model chose to compress" from "the tool call
  was cut off," so a future model change could silently regress this
  without anything failing loudly.
- **The dedup TOCTOU across differently-worded reports of the same new
  bug** — the concurrency fix above closes the identical-report race, but
  two near-simultaneous reports describing the same bug in different words
  can still both list open issues before either has filed, and both file.
  Disclosed rather than fixed; closing it would need broader locking than a
  report-hash key can express.

## Process note

The most useful part of the original iteration wasn't the fixing — it was
building a small synthetic test-ticket set first and running it against the
*already-implemented* service to see what actually broke, instead of
reading the code and guessing where problems might be. The later
audit-driven fixes followed the same discipline from a different angle: two
independent adversarial readers traced the seams a black-box eval run can't
reach on its own — DI wiring, concurrency, doc/code drift — and those
traces, not intuition, produced the fix list above.

## Working notes: building this in an agent-driven workflow

The brief screens explicitly for the experience of steering agents, catching
drift, and hardening systems built on top of an LLM — which is a different
axis than whether any given line of `service/src/` is correct. The findings
above are about the artifact; these are about the process of producing it,
kept as working notes during the build and worth landing somewhere that
survives the same `git bundle` problem the disclosure doc itself exists to
solve (Gitea issue comments don't survive a bundle/clone either).

**Concurrent agents against one repo conflict, and that needs an actual
mechanism, not discipline.** Running more than one coding agent against the
same working tree at the same time produces the obvious failure mode: two
agents editing overlapping files, one's uncommitted state clobbering the
other's, or both racing to commit against the same branch. This isn't a
one-off annoyance to work around in the moment, it's a process gap that
needs a real answer before running agents in parallel becomes routine —
`docs/agents/parallel-work.md` (worktrees, one per concurrent agent) is
where this repo's answer ended up, but it's worth naming that the honest
starting point was "I don't have a mechanism for this yet," not that the
answer was obvious in advance. Sandboxing is the adjacent question — even
with separate worktrees, an agent that can execute shell commands still
shares whatever it can reach outside the tree unless something isolates it
— and is a further hardening step past worktrees alone rather than a
substitute for them.

**Context rot is real, and the right response at this scope was a budget,
not a token-spend optimization project.** Long agent sessions degrade —
instructions get half-followed, earlier context gets misremembered or
dropped, edits get sloppier — well before the model literally runs out of
context window, so the practical discipline was keeping session usage under
roughly 20% of the 200k window available on Sonnet 5, and starting a fresh
session rather than pushing a long one further once it approached that
line. Migrating the service from its original Python implementation to
NestJS/TypeScript under that discipline went smoothly. What this
deliberately did *not* do is optimize token spend at the level of individual
tasks — trimming prompts, caching more aggressively, minimizing tool-call
round trips — because at this scope (a take-home exercise, not a
production system processing sustained volume) that optimization wouldn't
have paid for the engineering time it cost. That's a real trade-off, not an
oversight, and it's a legitimate future consideration if this system's
actual usage volume ever justified revisiting it.

**Documentation drifts stale fast in an agent-driven codebase, and this
repo already produced a concrete instance of exactly that.** READMEs, ADRs,
`CONTEXT.md`, and this disclosure doc itself are all prose describing code
that an agent can rewrite in minutes — nothing forces the two to stay in
sync the way, say, a type checker forces code and its call sites to agree.
The README test-count/Set-D staleness both independent audits caught (the
F10/F7 findings: `README.md` claiming "77 tests" in one place and "113" in
another in the same document, and describing Set D as a "two-case anchor
suite" after it had grown to nine cases) is that exact failure, caught
externally rather than by any process this build had for keeping docs
current as the suite grew. It's a small, low-severity finding on its own,
but it's the concrete evidence for the general worry: prose documentation
in a fast-moving, agent-edited codebase needs either much tighter discipline
about updating it in the same pass as the code it describes, or some kind
of automated check, because "the agent will remember to update the README"
is not a reliable mechanism.

**Trust in agent output should be backed by structural checks, not just
better prompting or more careful test-writing — and this build hit a real
instance of why.** The general principle is that an agent (or a human,
for that matter) writing both the implementation and the tests for it can
produce a test suite that's internally consistent but doesn't actually
constrain production behavior, because the tests were written against the
same mental model that produced the bug. The abstract version of this
worry is that you want checks that don't depend on the code author having
gotten the invariant right — the kind of thing row-level security or a
database constraint gives you at the data layer, independent of whether
every code path that touches that table remembered to enforce the rule
itself. The F1/F2 finding above is that worry made concrete, not
hypothetical: the unit suite asserted that the validation-retry feedback
loop for duplicate judgment worked, and passed, because it drove
`FakeTriagePort` directly rather than the real DI-composed `TriagePort` —
so the suite was asserting trust in a wiring path that production had
silently dropped a line from. A test suite that only ever exercises a fake
can be perfectly green while the seam it claims to cover — the actual
composition — has zero coverage. The fix (a spec against the real
`useFactory`) closes this one instance; the general lesson is to keep
looking for the places where "the tests pass" is standing in for "I trust
the agent got this right" rather than for an independent, structural
guarantee.

**Prompt injection and useful information often live in the same string,
and this build had to make that call for real, not hypothetically.** The
raw bug report is untrusted input by construction — it's free text from
whoever files it — but it's also the entire substance of what should end up
in the resulting Gitea issue: repro steps, error messages, the exact wording
that makes a report actionable are indistinguishable, at the level of "is
this a string an attacker controls," from an injected instruction trying to
manipulate the pipeline into applying a label it shouldn't or leaking
something it shouldn't echo back. Redacting aggressively is the safe
default, but it comes at the cost of stripping out the reproduction detail
a human triager actually needs to act on the issue; not redacting risks
exactly the injection and secret-leak scenarios the eval suite's Set C
cases exist to catch. This wasn't resolved in the abstract — it's the exact
shape of the redaction-coverage gap documented above, where `redactSecrets`
covered the raw-report quote and supporting evidence but initially missed
the other LLM-copied free-text channels reaching Gitea (extracted repro
steps, `distinct_issues`, and the issue title itself), so a secret sitting
in a repro step could reach Gitea unredacted while the raw report right
next to it was scrubbed. Closing that gap was the right call for this
system, but it's worth being honest that it was a judgment call under real
tension, not a case where the safe answer and the useful answer coincided
for free.

**Visibility into what the system is actually doing matters more, not
less, once an agent is the one building and running it.** An AI agent
writing the code and then reporting "it works" turns the system into an
abstract black box unless something forces the actual data and end results
into view independent of what the agent claims — the whole point is to be
able to spot bottlenecks, silent failures, and drift early rather than
trusting a summary of the code's own behavior. This wasn't left as an
abstract concern: it's the concrete reason this repo has an observability
stack at all — Prometheus scraping `/metrics`, Grafana dashboards and six
alert rules keyed off conditions like `up{job="gitea"}` (ADR-0009), Loki
ingesting the service's structured JSON logs with `report_hash` and `stage`
as queryable metadata, and the Decision Record itself acting as a
ground-truth log of what the pipeline actually did for a given report,
independent of any narration about what it was supposed to do. The same
instinct is what made the two independent audits effective: F1's live
false-merge and F2's DI wiring bug were both found by watching what the
*composed, running* system actually produced against real input, not by
re-reading the code and trusting that it did what it looked like it should
do. Visibility over blind trust is the same discipline in both places —
once applied to production behavior via telemetry, once applied to
catching agent-introduced bugs via adversarial probing of the live system.
