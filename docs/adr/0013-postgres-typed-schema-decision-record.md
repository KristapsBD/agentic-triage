# Decision Record persistence moves to Postgres with a typed schema, not a SQLite blob

The Decision Record was a single `payload TEXT` JSON blob per row in SQLite, correct for a
single-process demo but blocking every operational query (severity trends, cost/latency per
stage) that a growing triage system needs. It also has no home for a growing embedding cache,
and SQLite's single-writer model doesn't extend to genuine concurrent access.

We move to Postgres via Prisma, and give the record's single-valued and categorical fields real
typed columns, its append-only per-call evidence (token usage, stage timings, duplicate
candidates considered) its own tables, and add a `pgvector`-backed cache for issue embeddings.
Nothing in the query surface needs a fully normalized schema for every nested list —
`components`/`repro_steps`/`distinct_issues` stay as native Postgres arrays rather than child
tables, since they're read and written whole, never queried into.

This stays entirely behind `DecisionStore` and `EmbeddingIndex`; `TriagePort` and everything
downstream of it don't change.
