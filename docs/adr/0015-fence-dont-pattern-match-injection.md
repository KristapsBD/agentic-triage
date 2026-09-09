# Untrusted free text gets fenced for injection defense, not pattern-matched

The raw report is fenced as a literal code block before it reaches Gitea — structural and
lossless, and it neutralizes markdown/mentions/embeds/close-keywords regardless of what the
injected content actually looks like. That same fencing was missing from other LLM-echoed
free-text fields (`supporting_evidence`, `repro_steps`), which are redacted for secrets but were
not fenced, leaving them able to render live markdown from a reporter's pasted content.

We extend the same fencing to every free-text field that renders as a block, rather than
building a pattern/regex classifier for "known" injection shapes. Injection surface (mentions,
embeds, close-keywords, arbitrary HTML) is open-ended and tied to Gitea's own renderer — regex
can't enumerate it and would need to be re-derived every time the renderer's behavior changes.
Fencing sidesteps that by not caring what the content is.

`title` cannot be fenced without breaking as an issue title; it is handled separately, by
stripping/escaping markdown-active characters rather than pattern-matching. Regex remains the
right tool specifically for secret redaction (credential shapes are genuinely finite), a
different mechanism with a different, inherent recall/precision tradeoff — that tradeoff does
not apply to fencing, which removes no information.
