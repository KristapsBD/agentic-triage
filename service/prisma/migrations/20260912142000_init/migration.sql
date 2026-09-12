-- CreateEnum
CREATE TYPE "decision_status" AS ENUM ('pending', 'processing', 'completed', 'gitea_call_failed');

-- CreateEnum
CREATE TYPE "outcome" AS ENUM ('issue_created', 'duplicate_commented', 'review_flagged', 'feature_request_filed', 'dropped_spam');

-- CreateEnum
CREATE TYPE "confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "report_type" AS ENUM ('bug', 'feature_request', 'unclear', 'spam_or_off_topic');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "component" AS ENUM ('frontend', 'backend', 'api', 'auth', 'database', 'infra', 'docs', 'unknown');

-- CreateEnum
CREATE TYPE "duplicate_tier" AS ENUM ('clear_duplicate', 'possible_duplicate', 'not_a_duplicate');

-- CreateEnum
CREATE TYPE "same_bug_judgment" AS ENUM ('yes', 'possibly', 'no');

-- CreateEnum
CREATE TYPE "pending_action_type" AS ENUM ('create_issue', 'comment', 'none');

-- CreateEnum
CREATE TYPE "llm_call" AS ENUM ('extract', 'duplicate_judgment');

-- CreateEnum
CREATE TYPE "pipeline_stage" AS ENUM ('extraction', 'embedding_retrieval', 'duplicate_judgment', 'gitea_list_open_issues', 'gitea_create_issue', 'gitea_comment_issue', 'end_to_end');

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "report_hash" TEXT NOT NULL,
    "raw_report" TEXT NOT NULL,
    "status" "decision_status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "validation_retries_consumed" INTEGER NOT NULL,
    "validation_budget_exhausted" BOOLEAN NOT NULL,
    "confidence" "confidence",
    "transient_retries_consumed" INTEGER NOT NULL,
    "outcome" "outcome",
    "gitea_issue_number" INTEGER,
    "error" TEXT,
    "title" TEXT,
    "report_type" "report_type",
    "severity" "severity",
    "components" "component"[],
    "repro_steps" TEXT[],
    "supporting_evidence" TEXT,
    "distinct_issues" TEXT[],
    "duplicate_tier" "duplicate_tier",
    "duplicate_target_issue" INTEGER,
    "duplicate_similarity" DOUBLE PRECISION,
    "duplicate_rationale" TEXT,
    "action_type" "pending_action_type",
    "action_title" TEXT,
    "action_body" TEXT,
    "action_labels" TEXT[],
    "action_target_issue" INTEGER,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "issue_number" INTEGER NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "same_bug" "same_bug_judgment",

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "call" "llm_call" NOT NULL,
    "candidate_issue_number" INTEGER,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_timings" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "stage" "pipeline_stage" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "candidate_issue_number" INTEGER,

    CONSTRAINT "stage_timings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decisions_report_hash_key" ON "decisions"("report_hash");

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_timings" ADD CONSTRAINT "stage_timings_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
