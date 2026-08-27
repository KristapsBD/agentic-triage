"""Ticket #11: unified Review Flag mechanism + Bundled Report handling."""

from app.pipeline import process_report
from app.schemas import DuplicateCandidate, DuplicateJudgment, TriageDecision


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


def test_unclear_report_still_cross_links_a_duplicate_candidate(port, settings):
    """Being too vague to safely extract severity/components doesn't mean
    duplicate detection should be skipped -- a vague repeat of an existing
    issue should still surface a cross-link, same as a well-formed one."""
    raw = "the export thing is timing out again, ugh, when will this get fixed"
    decision = TriageDecision(title="Export operation times out", report_type="unclear")
    port.extraction_queue = [decision]
    candidate = DuplicateCandidate(issue_number=2, title="CSV export times out", body="...", similarity=0.6)
    port.candidates_by_report[raw] = [candidate]
    port.judgments_by_candidate[2] = DuplicateJudgment(same_bug="possibly", rationale="both mention export timing out")

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"  # still routed to a human, never auto-commented
    assert envelope.duplicate_verdict.tier == "possible_duplicate"
    assert envelope.duplicate_verdict.target_issue == 2
    body = next(c for c in port.calls if c.op == "create_issue").args[1]
    assert "#2" in body


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
    # duplicate detection still runs (see test below) -- with no candidates
    # registered for this raw text, FakePort.find_candidates returns [], so
    # it's a no-op here rather than skipped outright.
    assert any(c.op == "find_candidates" for c in port.calls)
    assert envelope.duplicate_verdict.tier == "not_a_duplicate"


def test_bundled_report_still_cross_links_a_duplicate_candidate(port, settings):
    """Bundling ("don't auto-split, a human decides") previously bypassed
    duplicate detection entirely: a near-verbatim repeat of an existing
    issue, bundled alongside two unrelated complaints, created a fresh
    needs-triage issue with zero mention of the existing one. Bundling
    should still mean "a human decides how to split this", not "throw away
    the duplicate signal we'd otherwise have caught"."""
    raw = (
        "A few things: first, on iPhone Safari the login button just doesn't respond "
        "when tapped -- same as before; second, the currency dropdown defaults to USD "
        "for EU accounts; third, the timezone setting doesn't persist after logout."
    )
    decision = TriageDecision(
        title="Multiple bugs: login button, currency default, timezone setting",
        report_type="bug",
        severity="high",
        components=["frontend"],
        distinct_issues=[
            "Login button unresponsive on iPhone Safari",
            "Currency dropdown defaults to USD for EU accounts",
            "Timezone setting not persisted after logout",
        ],
    )
    port.extraction_queue = [decision]
    candidate = DuplicateCandidate(issue_number=1, title="Login button unresponsive on mobile Safari", body="...", similarity=0.8)
    port.candidates_by_report[raw] = [candidate]
    port.judgments_by_candidate[1] = DuplicateJudgment(same_bug="yes", rationale="same symptom, same platform")

    envelope = process_report(raw, port, settings)

    assert envelope.outcome == "review_flagged"  # bundling still wins -- never auto-comments
    assert envelope.duplicate_verdict.tier == "clear_duplicate"
    assert envelope.duplicate_verdict.target_issue == 1
    create_calls = [c for c in port.calls if c.op == "create_issue"]
    assert len(create_calls) == 1  # still not auto-split, and not auto-commented either
    body = create_calls[0].args[1]
    assert "#1" in body


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
