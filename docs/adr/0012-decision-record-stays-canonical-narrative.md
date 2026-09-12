# Decision Record stays the canonical narrative; logs are a transient view

The full per-request evidence trail — duplicate candidates considered and their similarity
scores, per-stage latency, token usage — is persisted as new fields on `DecisionRecord`
(`service/src/reports/types.ts`, ticket #40) and written to the existing SQLite-backed
`DecisionStore` (`service/src/decisions/decision-store.ts`), not left to live only in
Loki-ingested logs. Loki's retention is configurable and, in this demo stack, unbounded only
by accident — nothing prevents an operator from shrinking it or wiping the `loki-data` volume.
The Decision Record already had to survive restarts and support "explain this past decision"
lookups by `report_hash` (its original purpose, predating this stack); extending it to also
carry the retry/candidate/token/timing narrative means that lookup keeps working even if logs
have rolled off, and it stays queryable directly via SQL against the durable
`triage-decisions` volume rather than requiring a live Loki instance.

Structured JSON logs correlated by `report_hash` still exist and are useful — tailing them
live during a demo is a real use case `promtail`/Loki serves well — but they're a *transient
view* onto the same events the Decision Record durably owns, not a second source of truth.
If the two ever disagreed, the Decision Record wins.

**Addendum (2026-09-12, issue #60):** the SQL-queryability claim above was not fully true
until now — the duplicate-candidate, token-usage, and stage-timing histories lived only inside
the SQLite `DecisionRecord` row's JSON blob, reachable only by parsing that blob, not by SQL
against normalized columns. [PR #67](https://github.com/KristapsBD/agentic-triage/pull/67)
(issue #59) migrated the store to Postgres/Prisma and split those histories into real
`DuplicateCandidate`/`TokenUsage`/`StageTiming` child tables (`service/prisma/schema.prisma`),
each cascade-deleted with its parent `Decision` row. The Decision Record now actually is
queryable directly via SQL for its full evidence trail, fulfilling this ADR's original intent.
