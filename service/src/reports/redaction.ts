/**
 * Best-effort scrub of secrets/credentials out of Raw Report text before it is
 * quoted verbatim into a Gitea issue or comment body. Mirrors app/redaction.py.
 *
 * ADR-0007's typed-egress guarantee covers the model's *extracted* fields --
 * there is no free-text label or unvalidated API parameter downstream of an
 * LLM call. It says nothing about the Raw Report's own verbatim quote, which
 * is a second, always-present channel straight from reporter to a
 * Gitea-visible issue body.
 *
 * Pattern-based, not exhaustive: trades recall for precision -- a missed
 * secret is the failure mode, not mangled legitimate bug-report prose.
 */

const REDACTED = '[REDACTED]';

const BARE_TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g, // OpenAI/Anthropic-style secret keys
  /\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ID
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub PAT-style tokens
  /\bBearer\s+[A-Za-z0-9._-]{10,}/g, // Bearer <token>
];

// key: value / key=value / "key":"value" -- keeps the key name, redacts only
// the value, so the report stays readable ("password: [REDACTED]").
const LABELED_VALUE_PATTERN =
  /\b(password|passwd|pwd|api[_-]?key|secret|access[_-]?key|auth[_-]?token)\b(["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi;

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of BARE_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  redacted = redacted.replace(LABELED_VALUE_PATTERN, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  return redacted;
}
