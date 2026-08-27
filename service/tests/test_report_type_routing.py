"""Ticket #8: feature requests and spam/off-topic routed off the bug path."""

from app.labels import FEATURE_REQUEST
from app.pipeline import process_report
from app.schemas import TriageDecision


def test_feature_request_filed_under_distinct_label_no_severity_or_component(port, settings):
    raw = (
        "It would be really nice if we could export reports to PDF as well as CSV. "
        "A lot of our customers ask for this."
    )
    decision = TriageDecision(title="Export reports to PDF", report_type="feature_request")
    port.extraction_queue = [decision]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "feature_request_filed"
    create_call = next(c for c in port.calls if c.op == "create_issue")
    _, _, labels = create_call.args
    assert labels == (FEATURE_REQUEST,)


def test_spam_off_topic_drops_with_no_gitea_issue(port, settings):
    raw = "buy cheap watches now www.totally-not-spam.example"
    decision = TriageDecision(title="n/a", report_type="spam_or_off_topic")
    port.extraction_queue = [decision]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "dropped_spam"
    assert envelope.gitea_issue_number is None
    assert not any(c.op in ("create_issue", "comment_issue") for c in port.calls)


def test_report_type_is_single_extraction_call_not_a_second_round_trip(port, settings):
    raw = "export to PDF please"
    port.extraction_queue = [TriageDecision(title="Export to PDF", report_type="feature_request")]
    process_report(raw, port, settings)
    assert len([c for c in port.calls if c.op == "extract"]) == 1
