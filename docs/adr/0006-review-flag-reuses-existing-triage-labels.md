# Review Flag reuses this repo's existing triage labels

Every case where the service doesn't act with full confidence — exhausted validation
retries, `unclear` Report Type, a Bundled Report, a possible Duplicate Verdict — funnels
through one mechanism (Review Flag), not a bespoke one per case. A Review Flag always
still creates a Gitea issue, labeled `needs-triage` (or `needs-info` specifically when
the gap is "we need more from the reporter"), with the reason written into the body.

Two exceptions, decided deliberately rather than folded into the same path:
`spam_or_off_topic` Report Types never become a Gitea issue at all — only a Decision
Record — since filing spam as `needs-triage` would just be noise a human keeps
dismissing. `feature_request` Report Types are filed, but under a distinct label rather
than run through the bug-only Severity/Component schema, since a feature request isn't
a graded-severity bug.

This reuses `docs/agents/triage-labels.md`'s existing vocabulary instead of inventing a
parallel review-queue concept.
