# Bug Report Triage Service

Turns a free-text bug report into a structured, triaged issue in Gitea, checking for
duplicates against existing open issues before creating anything.

## Language

**Raw Report**:
The free-text paragraph a user or teammate submits, before any structure is imposed on it.
_Avoid_: Bug report (ambiguous with the Gitea issue it may become), ticket

**Triage Decision**:
The structured output produced by processing a Raw Report: title, severity, components,
repro steps, report type, and the confidence computed around them.
_Avoid_: Triage result, extraction

**Report Type**:
The classification of what kind of thing a Raw Report actually is — `bug`,
`feature_request`, `unclear`, or `spam_or_off_topic` — decided before any bug-specific
fields in the Triage Decision are trusted.
_Avoid_: Category

**Severity**:
The Triage Decision's judgment of technical impact — `critical`, `high`, `medium`, or
`low` — assigned from an anchored rubric of concrete criteria per level, ignoring the
reporter's own emotional framing or urgency claims.
_Avoid_: Priority

**Component**:
One or more of the eight fixed values (`frontend`, `backend`, `api`, `auth`, `database`,
`infra`, `docs`, `unknown`) describing what part of the system a bug touches. `unknown`
is a legitimate, honest value when the Raw Report doesn't give enough signal to tell —
never a forced guess among the real seven.
_Avoid_: Label (too generic — Components are one specific kind of Gitea label; the
service also applies workflow labels like `needs-triage` that aren't Components)

**Duplicate Candidate**:
An existing open Gitea issue retrieved by embedding similarity against a Raw Report and
then judged by the LLM for whether it actually describes the same bug.
_Avoid_: Match

**Duplicate Verdict**:
The three-way outcome of judging a Raw Report against its Duplicate Candidates: a
clear duplicate (comment on the existing issue, no new issue created), a possible
duplicate (a new issue is still created, cross-linked to the candidate, and Review
Flagged), or not a duplicate (create a fresh issue normally). Exists to avoid false
merges — collapsing "pretty sure" and "not sure" into one boolean would force a
coin-flip at the threshold boundary.
_Avoid_: Duplicate score, is_duplicate (too binary)

**Review Flag**:
An explicit reason a Raw Report didn't lead to a confident, fully-automated action:
exhausted validation retries, `unclear` Report Type, a Bundled Report, or a possible
Duplicate Verdict. A Review Flag always still results in a labeled Gitea issue (using
this repo's existing `needs-triage` / `needs-info` workflow labels) carrying the reason
— it never means the report is silently dropped.
_Avoid_: Error, failure (a Review Flag is an honest "not sure," not a fault)

**Decision Record**:
The persisted link between a Raw Report, the Triage Decision made about it, any
Duplicate Verdict, and the resulting Gitea action — kept so the same report can't be
double-posted on retry and so any decision can be explained after the fact.
_Avoid_: Log entry, audit log (Decision Record is the domain concept; how it's stored is
an implementation detail)

**Confidence**:
A signal the harness computes from structural evidence — validation outcome, duplicate
similarity score, retry count — never a number the LLM is asked to self-report about its
own output.
_Avoid_: Certainty, score (when unqualified)

**Bundled Report**:
A Raw Report that describes more than one distinct issue at once. The service extracts
the list of distinct issues it can identify but does not auto-split them into separate
Gitea issues — it routes the whole report (Review Flagged) to human review instead.
_Avoid_: Multi-issue report
