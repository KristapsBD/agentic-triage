"""Pattern-based secret/credential scrub applied before Raw Report text is
quoted verbatim into a Gitea issue body (finding: PII/secrets pasted into a
bug report were landing, unredacted, in a public issue -- see
docs/eval-findings or the Set C probe suite for the original repro)."""

from app.redaction import redact_secrets


def test_leaves_ordinary_bug_report_text_untouched():
    text = "The button does nothing when tapped on iPhone Safari."
    assert redact_secrets(text) == text


def test_redacts_json_style_password_and_api_key_values():
    text = (
        'POST /api/account {"email":"jane.doe@example.com",'
        '"password":"CorrectHorseBattery9!","api_key":"sk_live_FAKE1234567890abcdef"}'
    )
    redacted = redact_secrets(text)
    assert "CorrectHorseBattery9!" not in redacted
    assert "sk_live_FAKE1234567890abcdef" not in redacted
    assert "jane.doe@example.com" in redacted  # not a secret, left alone
    assert '"password":"[REDACTED]"' in redacted
    assert '"api_key":"[REDACTED]"' in redacted


def test_redacts_bare_cloud_style_keys_without_a_label():
    text = "seeing this with key AKIAABCDEFGHIJKLMNOP and also ghp_abcdefghij0123456789klmnop"
    redacted = redact_secrets(text)
    assert "AKIAABCDEFGHIJKLMNOP" not in redacted
    assert "ghp_abcdefghij0123456789klmnop" not in redacted
    assert "[REDACTED]" in redacted


def test_redacts_bearer_token():
    text = "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' https://api/x"
    redacted = redact_secrets(text)
    assert "eyJhbGciOiJIUzI1NiJ9.abc.def" not in redacted


def test_does_not_touch_the_word_token_without_an_assignment():
    text = "The auth token expires after 5 minutes and then login silently fails."
    assert redact_secrets(text) == text
