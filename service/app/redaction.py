"""Best-effort scrub of secrets/credentials out of Raw Report text before it
is quoted verbatim into a Gitea issue or comment body.

ADR-0007's typed-egress guarantee covers the model's *extracted* fields --
there is no free-text label or unvalidated API parameter downstream of an
LLM call. It says nothing about the Raw Report's own verbatim quote, which
is a second, always-present channel straight from reporter to a
Gitea-visible issue body. A reporter who pastes a password or API key
alongside a stack trace for "debugging" gets that secret published verbatim,
with no code path currently touching it.

Pattern-based, not exhaustive: this catches common credential shapes (cloud/
API keys, bearer tokens, explicit password/secret/token assignments), not
every possible secret format. It deliberately trades recall for precision --
false-negatives (a missed secret) are the failure mode, not mangled
legitimate bug-report prose.
"""

from __future__ import annotations

import re

_REDACTED = "[REDACTED]"

# Bare, self-identifying token shapes -- redacted wholesale wherever they appear.
_BARE_TOKEN_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{10,}\b"),  # OpenAI/Anthropic-style secret keys
    re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b"),  # Stripe-style keys
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),  # AWS access key ID
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),  # GitHub PAT-style tokens
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{10,}"),  # Bearer <token>
]

# key: value / key=value / "key":"value" -- keeps the key name, redacts only
# the value, so the report stays readable ("password: [REDACTED]").
_LABELED_VALUE_PATTERN = re.compile(
    r'(?i)\b(password|passwd|pwd|api[_-]?key|secret|access[_-]?key|auth[_-]?token)\b'
    r'([\"\']?\s*[:=]\s*[\"\']?)'
    r'[^\s\"\',}]{4,}'
)


def redact_secrets(text: str) -> str:
    redacted = text
    for pattern in _BARE_TOKEN_PATTERNS:
        redacted = pattern.sub(_REDACTED, redacted)
    redacted = _LABELED_VALUE_PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REDACTED}", redacted)
    return redacted
