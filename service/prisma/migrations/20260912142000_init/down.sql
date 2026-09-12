-- Manual rollback for 20260912142000_init.
-- Prisma has no built-in single-step "down" command (only `migrate reset`,
-- which wipes the whole database, and `migrate resolve --rolled-back`, which
-- only applies to a *failed* migration, not a successfully-applied one) —
-- this is the documented manual-rollback procedure: apply this file directly
-- against the database, then delete this migration's own row from Prisma's
-- `_prisma_migrations` tracking table so `migrate status`/`deploy` see it as
-- pending again (wired up by `make migrate-down`).

DROP TABLE IF EXISTS "stage_timings";
DROP TABLE IF EXISTS "token_usage";
DROP TABLE IF EXISTS "duplicate_candidates";
DROP TABLE IF EXISTS "decisions";

DROP TYPE IF EXISTS "pipeline_stage";
DROP TYPE IF EXISTS "llm_call";
DROP TYPE IF EXISTS "pending_action_type";
DROP TYPE IF EXISTS "same_bug_judgment";
DROP TYPE IF EXISTS "duplicate_tier";
DROP TYPE IF EXISTS "component";
DROP TYPE IF EXISTS "severity";
DROP TYPE IF EXISTS "report_type";
DROP TYPE IF EXISTS "confidence";
DROP TYPE IF EXISTS "outcome";
DROP TYPE IF EXISTS "decision_status";
