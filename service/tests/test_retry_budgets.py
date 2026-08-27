"""Ticket #10: validation vs transient retry budgets, independent (ADR-0008)."""

from app.errors import ExtractionValidationError, TransientAPIError
from app.pipeline import process_report
from app.schemas import TriageDecision


def _decision():
    return TriageDecision(title="t", report_type="bug", severity="low", components=["unknown"])


def test_validation_failure_retries_with_feedback_then_succeeds(port, settings):
    raw = "some report"
    port.extraction_queue = [
        ExtractionValidationError("components: value is not a valid enumeration member"),
        _decision(),
    ]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "issue_created"
    extract_calls = [c for c in port.calls if c.op == "extract"]
    assert len(extract_calls) == 2
    assert extract_calls[0].args[1] is None
    assert "enumeration" in extract_calls[1].args[1]


def test_transient_failure_retries_identical_request_then_succeeds(port, settings):
    raw = "some report"
    port.extraction_queue = [
        TransientAPIError("rate limited"),
        _decision(),
    ]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "issue_created"
    extract_calls = [c for c in port.calls if c.op == "extract"]
    assert len(extract_calls) == 2
    assert extract_calls[0].args[0] == extract_calls[1].args[0] == raw
    assert extract_calls[1].args[1] is None  # unchanged request, no feedback text


def test_validation_budget_exhaustion_creates_needs_triage_issue_not_500(port, settings):
    raw = "malformed forever"
    port.extraction_queue = [
        ExtractionValidationError("bad 1"),
        ExtractionValidationError("bad 2"),
        ExtractionValidationError("bad 3"),
    ]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"
    create_call = next(c for c in port.calls if c.op == "create_issue")
    _, body, labels = create_call.args
    assert "needs-triage" in labels
    assert "automated triage failed" in body.lower()
    assert raw in body


def test_transient_exhaustion_does_not_touch_validation_budget(port, settings):
    """A run of transient failures alone must not be misattributed as
    validation failures, and vice versa — separate counters."""
    raw = "flaky infra"
    port.extraction_queue = [TransientAPIError("boom")] * (settings.transient_retry_budget + 1)

    from app.errors import PipelineUnavailableError
    import pytest

    with pytest.raises(PipelineUnavailableError):
        process_report(raw, port, settings)

    # No Gitea write happened; the pipeline could not complete, it didn't guess.
    assert not any(c.op in ("create_issue", "comment_issue") for c in port.calls)


def test_validation_and_transient_failures_both_within_budget_do_not_exhaust_each_other(port, settings):
    raw = "mixed failures"
    port.extraction_queue = [
        ExtractionValidationError("bad"),
        TransientAPIError("boom"),
        _decision(),
    ]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "issue_created"
    assert len([c for c in port.calls if c.op == "extract"]) == 3
