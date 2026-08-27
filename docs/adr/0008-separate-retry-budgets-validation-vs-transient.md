# Validation retries and transient-API-error retries are separate budgets

A Triage Decision that fails schema/Pydantic validation gets a bounded retry with the
validation error fed back to the model, so it can correct itself. A transient failure
from the Anthropic API itself (network blip, rate limit, 5xx/overloaded) gets its own
independent bounded retry with backoff, using the identical request unchanged.

These are different failure classes needing different responses: one means "the
model's output was wrong," the other means "nothing about the request was wrong, try
again." Sharing one retry counter between them would let an API hiccup burn down the
budget meant for steering the model, and would misattribute "gave up because the API
was flaky" as "gave up because the model kept getting it wrong" in the Decision Record.
