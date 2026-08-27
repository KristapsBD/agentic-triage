"""Ticket #9: embedding retrieval + three-tier Duplicate Verdict."""

from app.pipeline import process_report
from app.schemas import DuplicateCandidate, DuplicateJudgment, GiteaIssue, TriageDecision


def _bug_decision(title="Login broken on mobile Safari"):
    return TriageDecision(
        title=title,
        report_type="bug",
        severity="high",
        components=["frontend", "auth"],
        repro_steps=["Open app in Safari on iPhone", "Type login details", "Tap login button"],
    )


def test_no_candidates_above_floor_short_circuits_without_llm_call(port, settings):
    raw = "totally novel report about nothing seen before"
    port.extraction_queue = [_bug_decision()]
    port.candidates_by_report[raw] = []  # nothing clears the floor

    envelope = process_report(raw, port, settings)

    assert envelope.duplicate_verdict.tier == "not_a_duplicate"
    assert not any(c.op == "judge_duplicate" for c in port.calls)
    assert any(c.op == "create_issue" for c in port.calls)


def test_clear_duplicate_comments_on_existing_issue_no_new_issue(port, settings):
    raw = (
        "I can't log in on my iPhone. I open the app in Safari, type my details, "
        "tap the login button and literally nothing happens. My colleague has the "
        "same problem on her phone."
    )
    port.extraction_queue = [_bug_decision()]
    candidate = DuplicateCandidate(
        issue_number=1,
        title="Login button unresponsive on mobile Safari",
        body="...",
        similarity=0.9,
    )
    port.candidates_by_report[raw] = [candidate]
    port.judgments_by_candidate[1] = DuplicateJudgment(same_bug="yes", rationale="same symptom, same platform")

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "duplicate_commented"
    assert envelope.duplicate_verdict.tier == "clear_duplicate"
    assert envelope.duplicate_verdict.target_issue == 1
    assert not any(c.op == "create_issue" for c in port.calls)
    comment_call = next(c for c in port.calls if c.op == "comment_issue")
    issue_number, body = comment_call.args
    assert issue_number == 1
    assert raw in body


def test_near_miss_same_area_different_bug_resolves_not_a_duplicate(port, settings):
    """The false-merge-avoidance proof: same area (login page) as EXIST-1, but a
    genuinely different bug (rendering, not an unresponsive button)."""
    raw = (
        "On the login page, the password field overlaps the username field on "
        "narrow screens — you can't tell which box you're typing into. The login "
        "button itself works fine once you get the right field."
    )
    port.extraction_queue = [_bug_decision(title="Login page fields overlap on narrow screens")]
    candidate = DuplicateCandidate(
        issue_number=1,
        title="Login button unresponsive on mobile Safari",
        body="the button does nothing when tapped",
        similarity=0.5,
    )
    port.candidates_by_report[raw] = [candidate]
    port.judgments_by_candidate[1] = DuplicateJudgment(
        same_bug="no", rationale="different symptom: layout overlap vs. unresponsive button"
    )

    envelope = process_report(raw, port, settings)

    assert envelope.duplicate_verdict.tier == "not_a_duplicate"
    assert envelope.outcome == "issue_created"
    assert not any(c.op == "comment_issue" for c in port.calls)


def test_possible_duplicate_creates_cross_linked_flagged_issue(port, settings):
    raw = "login seems flaky on some phones"
    port.extraction_queue = [_bug_decision()]
    candidate = DuplicateCandidate(issue_number=1, title="Login button unresponsive", body="...", similarity=0.6)
    port.candidates_by_report[raw] = [candidate]
    port.judgments_by_candidate[1] = DuplicateJudgment(same_bug="possibly", rationale="similar area, unclear if same root cause")

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"
    assert envelope.duplicate_verdict.tier == "possible_duplicate"
    assert envelope.duplicate_verdict.target_issue == 1
    create_call = next(c for c in port.calls if c.op == "create_issue")
    _, body, labels = create_call.args
    assert "#1" in body
    assert "needs-triage" in labels
    assert not any(c.op == "comment_issue" for c in port.calls)
