# Human corrections reach the pipeline as free text, but only through the same typed-egress pattern as the original report

Bundled and review-flagged tickets had no path back into the pipeline: a human resolving one in
Gitea produced no reprocessing. Free text from a Gitea comment is a materially different trust
boundary than the public `/reports` endpoint — the author is an authenticated repo member, not
an anonymous reporter — but the risk of ambiguous phrasing driving the wrong action is unchanged
in kind from the original untrusted-input problem, just weaker in threat model.

A Gitea webhook triggers reprocessing on a review-flagged ticket. The human's comment is free
text, but it is never acted on directly: it goes through the same forced-tool-use extraction and
Zod validation already used for the original report, constrained to a small enumerable action
set (confirm split, confirm duplicate-of, reject/needs more info). Before executing anything hard
to undo, the pipeline echoes back what it understood and waits for confirmation, rather than
acting immediately. This is the same architectural guarantee ADR-0007 established for the
original report, applied to a second, differently-trusted input channel — never relaxed just
because the source is more trusted.
