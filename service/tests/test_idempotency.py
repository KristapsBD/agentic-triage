"""Ticket #12: Decision Record persistence and retry-safe POST."""

from app.errors import GiteaError, PipelineUnavailableError
from app.pipeline import hash_report, process_report
from app.schemas import TriageDecision


def _decision():
    return TriageDecision(title="t", report_type="bug", severity="low", components=["unknown"])


def test_decision_record_persisted_including_dropped_spam(port, settings):
    raw = "spam spam spam"
    port.extraction_queue = [TriageDecision(title="n/a", report_type="spam_or_off_topic")]

    process_report(raw, port, settings)

    record = port.get_decision_record(hash_report(raw))
    assert record is not None
    assert record.status == "completed"
    assert record.outcome == "dropped_spam"


def test_repeated_post_after_completion_returns_prior_result_without_rerunning_llm(port, settings):
    raw = "some report"
    port.extraction_queue = [_decision()]

    first = process_report(raw, port, settings)
    extract_calls_after_first = len([c for c in port.calls if c.op == "extract"])
    create_calls_after_first = len([c for c in port.calls if c.op == "create_issue"])

    second = process_report(raw, port, settings)

    assert second == first
    assert len([c for c in port.calls if c.op == "extract"]) == extract_calls_after_first
    assert len([c for c in port.calls if c.op == "create_issue"]) == create_calls_after_first


def test_gitea_failure_after_extraction_returns_error_and_leaves_resumable_state(port, settings):
    raw = "some report"
    port.extraction_queue = [_decision()]
    port.create_issue_should_fail = True

    try:
        process_report(raw, port, settings)
        assert False, "expected PipelineUnavailableError"
    except PipelineUnavailableError:
        pass

    record = port.get_decision_record(hash_report(raw))
    assert record.status == "gitea_call_failed"
    assert record.triage_decision is not None  # extraction work wasn't lost

    # Now Gitea recovers; a retried identical POST resumes rather than re-running the LLM.
    port.create_issue_should_fail = False
    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "issue_created"
    assert len([c for c in port.calls if c.op == "extract"]) == 1  # not re-run


def test_pipeline_unavailable_error_carries_report_hash_for_safe_retry(port, settings):
    from app.errors import TransientAPIError

    raw = "flaky"
    port.extraction_queue = [TransientAPIError("boom")] * (settings.transient_retry_budget + 1)

    try:
        process_report(raw, port, settings)
        assert False, "expected PipelineUnavailableError"
    except PipelineUnavailableError as e:
        assert e.report_hash == hash_report(raw)
