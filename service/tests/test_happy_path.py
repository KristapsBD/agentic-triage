"""Ticket #7: clear bug report -> extraction -> new Gitea issue."""

from app.pipeline import process_report
from app.schemas import TriageDecision


def test_clear_bug_report_creates_issue_with_severity_and_components(port, settings):
    raw = (
        "When I upload a profile picture larger than about 5MB, the page shows a "
        "spinner forever and the picture never saves. Tried an 8MB PNG and a 12MB "
        "JPEG, same result. Chrome on Windows. Smaller images work fine."
    )
    decision = TriageDecision(
        title="Profile picture upload hangs for files over ~5MB",
        report_type="bug",
        severity="medium",
        components=["frontend", "backend"],
        repro_steps=[
            "Upload a profile picture larger than ~5MB (tested 8MB PNG, 12MB JPEG)",
            "Observe the page shows a spinner forever and the picture never saves",
        ],
        supporting_evidence=None,
    )
    port.extraction_queue = [decision]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "issue_created"
    assert envelope.gitea_issue_number is not None
    create_calls = [c for c in port.calls if c.op == "create_issue"]
    assert len(create_calls) == 1
    title, body, labels = create_calls[0].args
    assert title == decision.title
    assert set(labels) == {"medium", "frontend", "backend"}
    assert raw in body
    assert "spinner forever" in body


def test_no_repro_steps_says_so_explicitly_not_omitted(port, settings):
    raw = "Something is broken with orders sometimes."
    decision = TriageDecision(
        title="Intermittent order failure",
        report_type="bug",
        severity="medium",
        components=["unknown"],
        repro_steps=None,
        supporting_evidence=None,
    )
    port.extraction_queue = [decision]

    process_report(raw, port, settings)

    body = port.calls[[c.op for c in port.calls].index("create_issue")].args[1]
    assert "No reproduction steps provided." in body


def test_supporting_evidence_kept_distinct_from_repro_steps(port, settings):
    raw = "checkout dies sometimes, see attached log"
    decision = TriageDecision(
        title="Checkout fails intermittently",
        report_type="bug",
        severity="high",
        components=["backend"],
        repro_steps=None,
        supporting_evidence="ERROR NullReferenceException in OrderService.Calculate() line 214",
    )
    port.extraction_queue = [decision]

    process_report(raw, port, settings)

    body = port.calls[[c.op for c in port.calls].index("create_issue")].args[1]
    assert "NullReferenceException" in body
    assert "No reproduction steps provided." in body


def test_raw_report_passed_to_extract_unmodified(port, settings):
    raw = "the button does nothing"
    port.extraction_queue = [
        TriageDecision(title="t", report_type="bug", severity="low", components=["unknown"])
    ]
    process_report(raw, port, settings)
    extract_call = next(c for c in port.calls if c.op == "extract")
    assert extract_call.args[0] == raw
    assert extract_call.args[1] is None  # no feedback on first attempt
