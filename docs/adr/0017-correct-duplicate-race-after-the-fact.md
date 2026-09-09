# The differently-worded-duplicate race is corrected after the fact, never prevented by serializing requests

Two differently-worded reports of the same new bug can both list open issues before either has
filed, and both create separate issues — the identical-report race is closed by an atomic
per-report-hash claim, but a semantic duplicate has no exact key to claim against. Preventing
this race outright — a per-repo lock, or a single-worker-per-repo queue — would serialize every
report for a repo behind every other one, because which reports would collide isn't known until
after the (expensive) embedding and LLM work that decides it. That cost is paid on every
request, not just the rare ones that actually collide.

We accept the race and correct it afterward instead: an async check, triggered off the same
Gitea webhook receiver used elsewhere, compares a newly created issue against others created in
the same short window and applies the existing `clear_duplicate` merge logic retroactively. This
keeps normal request processing fully concurrent. A future contributor who reaches for a lock or
a queue to close this gap should read this decision first — it was deliberately not the chosen
fix, for the reason above, not an oversight.
