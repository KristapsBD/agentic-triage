"""How the Raw Report's verbatim quote is embedded into a Gitea body.

Two properties, both closing gaps the Set C probe suite found in the
original blockquote-per-line implementation:

1. Secrets/PII pasted into a report must not reach the quote unredacted
   (see app/redaction.py) -- even though the exact same raw text is passed
   to extract()/judge_duplicate() unmodified (test_happy_path.py's
   test_raw_report_passed_to_extract_unmodified still holds).
2. The quote is a fenced code block, not a blockquote -- Gitea (like
   GitHub) does not interpret markdown inside a code fence, so an
   embedded image tag, @mention, or issue-closing keyword in the reporter's
   own text renders as inert text instead of live markdown.
"""

from app.pipeline import _quote
from app.pipeline import process_report
from app.schemas import TriageDecision


def test_quote_wraps_raw_report_in_a_code_fence():
    quoted = _quote("plain bug report text")
    lines = quoted.splitlines()
    assert lines[0].startswith("```")
    assert lines[-1].startswith("```")
    assert "plain bug report text" in quoted


def test_quote_widens_fence_to_avoid_collision_with_embedded_backticks():
    raw = "steps: run `cmd` then check ```output block```"
    quoted = _quote(raw)
    fence = quoted.splitlines()[0]
    assert len(fence) >= 4  # longer than the 3 backticks already in the content
    assert raw in quoted  # content itself is untouched


def test_quote_redacts_secrets_but_leaves_rest_of_text_alone():
    raw = 'debug payload: {"password":"CorrectHorseBattery9!"} still get a 500'
    quoted = _quote(raw)
    assert "CorrectHorseBattery9!" not in quoted
    assert "still get a 500" in quoted


def test_bug_issue_created_with_secret_never_leaks_it_into_gitea_body(port, settings):
    raw = (
        'Getting a 500 saving settings. Request: {"email":"jane@example.com",'
        '"api_key":"sk_live_FAKE1234567890abcdef"}.'
    )
    decision = TriageDecision(
        title="500 saving account settings",
        report_type="bug",
        severity="high",
        components=["backend"],
    )
    port.extraction_queue = [decision]

    process_report(raw, port, settings)

    body = next(c for c in port.calls if c.op == "create_issue").args[1]
    assert "sk_live_FAKE1234567890abcdef" not in body
    assert "jane@example.com" in body  # not a secret, left readable


def test_supporting_evidence_secret_is_also_redacted(port, settings):
    """supporting_evidence is a second verbatim channel (the model is told
    to carry pasted logs/stack traces through unmodified) -- separate from
    the Raw Report quote, so it needs its own redaction pass, not just
    _quote()'s."""
    decision = TriageDecision(
        title="500 error updating billing info",
        report_type="bug",
        severity="high",
        components=["backend"],
        supporting_evidence='Debug payload: {"password":"HunterHunter7!","secret":"topsecretvalue123"}',
    )
    port.extraction_queue = [decision]

    process_report("Server returns 500 when I update my billing info.", port, settings)

    body = next(c for c in port.calls if c.op == "create_issue").args[1]
    assert "HunterHunter7!" not in body
    assert "topsecretvalue123" not in body
    assert "Debug payload" in body


def test_markdown_image_and_mention_in_raw_report_land_inside_the_fence(port, settings):
    raw = "Screenshot ![x](https://example.com/pixel.png) shows a blank page. cc @someone"
    decision = TriageDecision(
        title="Blank page after deploy", report_type="bug", severity="medium", components=["frontend"]
    )
    port.extraction_queue = [decision]

    process_report(raw, port, settings)

    body = next(c for c in port.calls if c.op == "create_issue").args[1]
    # the markdown is present verbatim (nothing strips it) but sits between
    # fence markers, i.e. after the opening ``` and before the raw text ends
    fence_start = body.index("```")
    image_pos = body.index("![x]")
    assert image_pos > fence_start
