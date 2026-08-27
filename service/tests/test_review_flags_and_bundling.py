"""Ticket #11: unified Review Flag mechanism + Bundled Report handling."""

from app.pipeline import process_report
from app.schemas import TriageDecision


def test_unclear_vague_report_gets_needs_info_not_discarded(port, settings):
    raw = "the reports thing is broken again pls fix"
    decision = TriageDecision(title="Reports feature broken (vague report)", report_type="unclear")
    port.extraction_queue = [decision]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"
    create_call = next(c for c in port.calls if c.op == "create_issue")
    _, body, labels = create_call.args
    assert labels == ("needs-info",)
    assert raw in body


def test_bundled_report_flagged_needs_triage_listing_distinct_issues_not_split(port, settings):
    raw = (
        "A few things: the search bar sometimes returns no results even for exact "
        "matches, the date picker lets you select an end date before the start "
        "date, and also the mobile menu overlaps the header on small screens."
    )
    decision = TriageDecision(
        title="Multiple UI/search issues reported together",
        report_type="bug",
        severity="medium",
        components=["frontend"],
        distinct_issues=[
            "Search bar returns no results for exact matches",
            "Date picker allows end date before start date",
            "Mobile menu overlaps header on small screens",
        ],
    )
    port.extraction_queue = [decision]

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"
    create_calls = [c for c in port.calls if c.op == "create_issue"]
    assert len(create_calls) == 1  # not auto-split into three issues
    _, body, labels = create_calls[0].args
    assert labels == ("needs-triage",)
    for issue in decision.distinct_issues:
        assert issue in body
    assert not any(c.op in ("find_candidates", "judge_duplicate") for c in port.calls)


def test_every_review_flagged_issue_states_why_in_plain_language(port, settings):
    raw = "the reports thing is broken again pls fix"
    port.extraction_queue = [TriageDecision(title="t", report_type="unclear")]

    process_report(raw, port, settings)

    body = next(c for c in port.calls if c.op == "create_issue").args[1]
    assert "why this needs review" in body.lower()


def test_possible_duplicate_and_validation_exhaustion_share_one_action_construction(port, settings):
    """Both paths route through the same _issue_body/_review_flag_body helpers,
    so both bodies carry the same 'why this needs review' framing."""
    from app.errors import ExtractionValidationError
    from app.schemas import DuplicateCandidate, DuplicateJudgment

    raw_a = "possible dup case"
    port.extraction_queue = [
        TriageDecision(title="t", report_type="bug", severity="low", components=["unknown"])
    ]
    candidate = DuplicateCandidate(issue_number=1, title="x", body="y", similarity=0.6)
    port.candidates_by_report[raw_a] = [candidate]
    port.judgments_by_candidate[1] = DuplicateJudgment(same_bug="possibly")
    body_a = None
    process_report(raw_a, port, settings)
    body_a = next(c for c in port.calls if c.op == "create_issue").args[1]

    port2 = port.__class__()
    raw_b = "validation exhaustion case"
    port2.extraction_queue = [ExtractionValidationError("bad")] * (settings.validation_retry_budget + 1)
    process_report(raw_b, port2, settings)
    body_b = next(c for c in port2.calls if c.op == "create_issue").args[1]

    assert "why this needs review" in body_a.lower()
    assert "why this needs review" in body_b.lower()
