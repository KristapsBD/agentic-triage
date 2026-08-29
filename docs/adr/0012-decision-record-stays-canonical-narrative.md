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
