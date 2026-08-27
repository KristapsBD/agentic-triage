"""Orchestration: Report Type gating, severity/component branching, Duplicate
Verdict routing, Review Flag construction, both retry budgets, and Decision
Record state transitions.

Depends only on the `TriagePort` protocol (app/port.py) — no Gitea, Anthropic,
or sentence-transformers imports here. See docs/adr/0001-0008.
"""

from __future__ import annotations

import hashlib
import re
import time

from app.config import Settings
from app.errors import GiteaError, PipelineUnavailableError
from app.labels import FEATURE_REQUEST, NEEDS_INFO, NEEDS_TRIAGE
from app.port import TriagePort
from app.redaction import redact_secrets
from app.retry import extract_with_retry_budgets
from app.schemas import (
    DecisionRecord,
    DuplicateVerdict,
    PendingAction,
    ResponseEnvelope,
    TriageDecision,
)

VALIDATION_FAILED_NOTE = (
    "Automated triage failed: the model's structured output kept failing "
    "validation across every retry. This issue was filed automatically as a "
    "safe fallback rather than being dropped or crashing the request."
)


def hash_report(raw_report: str) -> str:
    return hashlib.sha256(raw_report.encode("utf-8")).hexdigest()


def _save(record: DecisionRecord, port: TriagePort) -> None:
    record.updated_at = time.time()
    port.save_decision_record(record)


def _quote(raw_report: str) -> str:
    """Fence the Raw Report as a literal code block rather than a blockquote.

    Two reasons, both from the same root cause: this is the one place the
    Raw Report's exact original text (not the model's extracted fields)
    always lands in a Gitea-visible body, so it's the one place that needs
    its own defenses rather than relying on ADR-0007's typed-egress
    guarantee, which only covers the model's output.

    - Secrets/PII a reporter pastes in get redacted here (app/redaction.py)
      -- this is the only call site for the verbatim quote, so it's the
      single seam that guarantees no unredacted secret reaches Gitea this
      way, without touching what extract()/judge_duplicate() see.
    - A code fence is not interpreted as markdown by Gitea, so an embedded
      image tag, @mention, or issue-closing keyword in the reporter's own
      text renders as inert text instead of live markdown.
    """
    safe_report = redact_secrets(raw_report) if raw_report.strip() else "(empty)"
    longest_backtick_run = max((len(run) for run in re.findall(r"`+", safe_report)), default=0)
    fence = "`" * max(3, longest_backtick_run + 1)
    return f"{fence}\n{safe_report}\n{fence}"


def _issue_body(raw_report: str, rationale: str, extra: str = "") -> str:
    parts = [rationale.strip()]
    if extra.strip():
        parts.append(extra.strip())
    parts.append("### Raw Report (verbatim)\n\n" + _quote(raw_report))
    return "\n\n".join(parts)


def _bug_issue_body(raw_report: str, decision: TriageDecision) -> str:
    if decision.repro_steps:
        steps = "\n".join(f"{i}. {s}" for i, s in enumerate(decision.repro_steps, start=1))
    else:
        steps = "No reproduction steps provided."
    # supporting_evidence is explicitly specified (llm_client.py's SYSTEM_PROMPT)
    # to carry pasted logs/stack traces verbatim -- a second channel for a
    # reporter's raw text to reach Gitea unmodified, same as the Raw Report
    # quote below, so it gets the same secret-redaction treatment.
    evidence = redact_secrets(decision.supporting_evidence.strip()) if decision.supporting_evidence else "None."
    rationale = (
        f"**Severity:** {decision.severity}\n"
        f"**Components:** {', '.join(decision.components) or 'unknown'}\n\n"
        f"### Reproduction steps\n\n{steps}\n\n"
        f"### Supporting evidence\n\n{evidence}"
    )
    return _issue_body(raw_report, rationale)


def _review_flag_body(raw_report: str, reason: str, extra: str = "") -> str:
    return _issue_body(raw_report, f"**Why this needs review:** {reason}", extra)


def _judge_duplicate_with_retry(port: TriagePort, raw_report: str, candidate, settings: Settings):
    """Same two retry budgets apply to the duplicate-judgment call. A
    validation failure that never self-corrects degrades to "skip this
    candidate" (safe: worst case is a missed duplicate, never a false
    merge) rather than crashing the whole request; transient exhaustion
    still surfaces as a pipeline-unavailable 502, same as extraction.
    """
    outcome = extract_with_retry_budgets(
        lambda _feedback: port.judge_duplicate(raw_report, candidate),
        validation_budget=settings.validation_retry_budget,
        transient_budget=settings.transient_retry_budget,
        backoff_seconds=settings.transient_retry_backoff_seconds,
    )
    if outcome.failure == "transient_exhausted":
        raise PipelineUnavailableError(hash_report(raw_report), "llm_unavailable", outcome.last_error or "")
    if outcome.failure == "validation_exhausted":
        return None
    return outcome.decision


def _find_duplicate_verdict(port: TriagePort, raw_report: str, settings: Settings) -> DuplicateVerdict:
    """Duplicate Candidate retrieval + judgment. Shared by every report_type
    that can plausibly restate an existing issue (bug, unclear, bundled) --
    only spam/feature_request skip it, since neither ever competes with an
    existing bug issue for the same underlying defect.

    Previously this lived inline in the bug-only branch below, which meant
    an unclear or bundled report that happened to restate an existing issue
    got no cross-link at all: a near-verbatim repeat of issue #1, phrased as
    one of three bundled complaints, created a fresh needs-triage issue with
    zero mention of #1. Running the same check here doesn't change the
    outcome for unclear/bundled (still always review_flagged -- a human
    still decides how to split or clarify), it just stops throwing away a
    signal the pipeline already has the machinery to compute.
    """
    open_issues = port.list_open_issues()
    candidates = port.find_candidates(raw_report, open_issues)

    verdict = DuplicateVerdict(tier="not_a_duplicate")
    if not candidates:
        return verdict

    best_yes = None
    best_possibly = None
    for candidate in candidates:
        judgment = _judge_duplicate_with_retry(port, raw_report, candidate, settings)
        if judgment is None:
            continue
        if judgment.same_bug == "yes" and best_yes is None:
            best_yes = (candidate, judgment)
        elif judgment.same_bug == "possibly" and best_possibly is None:
            best_possibly = (candidate, judgment)

    if best_yes is not None:
        candidate, judgment = best_yes
        return DuplicateVerdict(
            tier="clear_duplicate",
            target_issue=candidate.issue_number,
            similarity=candidate.similarity,
            # judgment.rationale is free text the model wrote after reading the
            # *unredacted* raw report (a deliberate choice -- extract()/
            # judge_duplicate() always see the original), so it can echo a
            # secret back even though the raw report it was judging never
            # appears verbatim here itself. Same redaction as the raw-report
            # quote, applied at the one point every downstream body-construction
            # site (comment body, review-flag reason, cross-link note) reads from.
            rationale=redact_secrets(judgment.rationale),
        )
    if best_possibly is not None:
        candidate, judgment = best_possibly
        return DuplicateVerdict(
            tier="possible_duplicate",
            target_issue=candidate.issue_number,
            similarity=candidate.similarity,
            rationale=redact_secrets(judgment.rationale),
        )
    return verdict


def _duplicate_cross_link_note(verdict: DuplicateVerdict) -> str:
    if verdict.tier == "not_a_duplicate":
        return ""
    return f"### Possibly related to an existing issue\n\nSee #{verdict.target_issue} ({verdict.rationale})."


def _route(
    decision: TriageDecision, raw_report: str, port: TriagePort, settings: Settings
) -> tuple[PendingAction, str, DuplicateVerdict | None]:
    """Compute the Gitea action, outcome, and Duplicate Verdict (if any) for
    an already-extracted Triage Decision. Pure w.r.t. Decision Record state;
    only touches the port for list_open_issues/find_candidates/judge_duplicate
    (read-only LLM/embedding calls), never a Gitea write.
    """
    if decision.report_type == "spam_or_off_topic":
        return PendingAction(type="none"), "dropped_spam", None

    if decision.report_type == "feature_request":
        body = _issue_body(raw_report, f"**Report Type:** feature_request\n\n{decision.title}")
        action = PendingAction(type="create_issue", title=decision.title, body=body, labels=[FEATURE_REQUEST])
        return action, "feature_request_filed", None

    if decision.report_type == "unclear":
        verdict = _find_duplicate_verdict(port, raw_report, settings)
        reason = (
            "Report Type was classified as unclear — there's a real signal here but not "
            "enough detail to safely extract severity/components, so this was routed to a "
            "human rather than discarded."
        )
        body = _review_flag_body(raw_report, reason, extra=_duplicate_cross_link_note(verdict))
        action = PendingAction(type="create_issue", title=decision.title, body=body, labels=[NEEDS_INFO])
        return action, "review_flagged", verdict

    # report_type == "bug" from here down.
    if decision.is_bundled:
        listing = "\n".join(f"- {issue}" for issue in decision.distinct_issues)
        verdict = _find_duplicate_verdict(port, raw_report, settings)
        reason = (
            f"Report describes what looks like {len(decision.distinct_issues)} distinct "
            "issues, not auto-splitting — a human should decide how to split this."
        )
        extra = "\n\n".join(
            part for part in (f"### Distinct issues identified\n\n{listing}", _duplicate_cross_link_note(verdict)) if part
        )
        body = _review_flag_body(raw_report, reason, extra=extra)
        action = PendingAction(type="create_issue", title=decision.title, body=body, labels=[NEEDS_TRIAGE])
        return action, "review_flagged", verdict

    verdict = _find_duplicate_verdict(port, raw_report, settings)

    if verdict.tier == "clear_duplicate":
        body = (
            f"Automated triage matched this report as a duplicate of this issue "
            f"({verdict.rationale}).\n\n### New report (verbatim)\n\n{_quote(raw_report)}"
        )
        action = PendingAction(type="comment", body=body, target_issue=verdict.target_issue)
        return action, "duplicate_commented", verdict

    if verdict.tier == "possible_duplicate":
        reason = (
            f"Duplicate check found a possible match to #{verdict.target_issue} but didn't "
            f"clear the auto-comment bar ({verdict.rationale}). Filed as a new issue, "
            "cross-linked, rather than risking a false merge."
        )
        body = _review_flag_body(
            raw_report,
            reason,
            extra=f"### Possible duplicate\n\nSee #{verdict.target_issue}.",
        )
        action = PendingAction(type="create_issue", title=decision.title, body=body, labels=[NEEDS_TRIAGE])
        return action, "review_flagged", verdict

    body = _bug_issue_body(raw_report, decision)
    assert decision.severity is not None, "bug reports always get a severity from the extraction schema"
    labels: list[str] = [decision.severity, *decision.components]
    action = PendingAction(type="create_issue", title=decision.title, body=body, labels=labels)
    return action, "issue_created", verdict


def _execute_pending_action(record: DecisionRecord, port: TriagePort) -> ResponseEnvelope:
    action = record.pending_action
    assert action is not None
    try:
        if action.type == "create_issue":
            assert action.title is not None and action.body is not None
            record.gitea_issue_number = port.create_issue(action.title, action.body, action.labels)
        elif action.type == "comment":
            assert action.target_issue is not None and action.body is not None
            port.comment_issue(action.target_issue, action.body)
            record.gitea_issue_number = action.target_issue
        record.status = "completed"
        _save(record, port)
        return record.to_envelope()
    except GiteaError as e:
        record.status = "gitea_call_failed"
        record.error = str(e)
        _save(record, port)
        raise PipelineUnavailableError(record.report_hash, "gitea_unavailable", str(e)) from e


def process_report(raw_report: str, port: TriagePort, settings: Settings) -> ResponseEnvelope:
    report_hash = hash_report(raw_report)
    record = port.get_decision_record(report_hash)

    if record is not None and record.status == "completed":
        return record.to_envelope()

    if record is None:
        record = DecisionRecord(report_hash=report_hash, raw_report=raw_report, status="pending")
        _save(record, port)

    record.status = "processing"
    _save(record, port)

    if record.triage_decision is None:
        outcome = extract_with_retry_budgets(
            lambda feedback: port.extract(raw_report, feedback=feedback),
            validation_budget=settings.validation_retry_budget,
            transient_budget=settings.transient_retry_budget,
            backoff_seconds=settings.transient_retry_backoff_seconds,
        )
        if outcome.failure == "transient_exhausted":
            raise PipelineUnavailableError(report_hash, "llm_unavailable", outcome.last_error or "")
        if outcome.failure == "validation_exhausted":
            body = _review_flag_body(raw_report, VALIDATION_FAILED_NOTE)
            record.pending_action = PendingAction(
                type="create_issue",
                title="Automated triage failed for incoming report",
                body=body,
                labels=[NEEDS_TRIAGE],
            )
            record.outcome = "review_flagged"
            _save(record, port)
            return _execute_pending_action(record, port)

        record.triage_decision = outcome.decision  # type: ignore[assignment]
        _save(record, port)

    decision = record.triage_decision
    assert decision is not None

    if record.pending_action is None:
        action, outcome_name, verdict = _route(decision, raw_report, port, settings)
        record.pending_action = action
        record.outcome = outcome_name  # type: ignore[assignment]
        record.duplicate_verdict = verdict
        _save(record, port)

    return _execute_pending_action(record, port)
