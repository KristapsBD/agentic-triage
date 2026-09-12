-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('pending', 'processing', 'completed', 'gitea_call_failed');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('bug', 'feature_request', 'unclear', 'spam_or_off_topic');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "Component" AS ENUM ('frontend', 'backend', 'api', 'auth', 'database', 'infra', 'docs', 'unknown');

-- CreateEnum
CREATE TYPE "DuplicateTier" AS ENUM ('clear_duplicate', 'possible_duplicate', 'not_a_duplicate');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('create_issue', 'comment', 'none');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('issue_created', 'duplicate_commented', 'review_flagged', 'feature_request_filed', 'dropped_spam');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "SameBugJudgment" AS ENUM ('yes', 'possibly', 'no');

-- CreateEnum
CREATE TYPE "LlmCallType" AS ENUM ('extract', 'duplicate_judgment');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('extraction', 'embedding_retrieval', 'duplicate_judgment', 'gitea_list_open_issues', 'gitea_create_issue', 'gitea_comment_issue', 'end_to_end');

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "rawReport" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL,
    "outcome" "Outcome",
    "giteaIssueNumber" INTEGER,
    "error" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "validationRetriesConsumed" INTEGER NOT NULL,
    "validationBudgetExhausted" BOOLEAN NOT NULL,
    "confidence" "Confidence",
    "transientRetriesConsumed" INTEGER NOT NULL,
    "title" TEXT,
    "reportType" "ReportType",
    "severity" "Severity",
    "components" "Component"[],
    "reproSteps" TEXT[],
    "supportingEvidence" TEXT,
    "distinctIssues" TEXT[],
    "duplicateTier" "DuplicateTier",
    "duplicateTargetIssue" INTEGER,
    "duplicateSimilarity" DOUBLE PRECISION,
    "duplicateRationale" TEXT,
    "actionType" "ActionType",
    "actionTitle" TEXT,
    "actionBody" TEXT,
    "actionLabels" TEXT[],
    "actionTargetIssue" INTEGER,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "sameBug" "SameBugJudgment",

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usages" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "callType" "LlmCallType" NOT NULL,
    "candidateIssueNumber" INTEGER,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,

    CONSTRAINT "token_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_timings" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "candidateIssueNumber" INTEGER,

    CONSTRAINT "stage_timings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decisions_reportHash_key" ON "decisions"("reportHash");

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usages" ADD CONSTRAINT "token_usages_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_timings" ADD CONSTRAINT "stage_timings_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
