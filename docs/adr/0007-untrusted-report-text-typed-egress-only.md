# Raw Report text never reaches Gitea except through the typed Triage Decision schema

The Raw Report is untrusted free text whose extracted output drives real actions (issue
creation, labels, comments). Two structural defenses, not prompt wording alone: the
Raw Report is always wrapped in an explicit delimiter in the LLM call, with a
system-level instruction that its content is data to classify, never instructions to
follow; and — the guarantee that actually matters — no code path lets model output
reach Gitea except through the typed Pydantic schema's fixed fields. There is no route
by which report text (or the model repeating injected text back) becomes a shell
command, a label outside the fixed enum, or an unvalidated API parameter.

This is deliberately an architecture guarantee (narrow, typed egress) rather than
something relying on the model reliably resisting injected instructions in the input.
