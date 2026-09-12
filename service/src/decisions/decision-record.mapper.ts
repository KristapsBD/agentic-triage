/**
 * DecisionRecord <-> Prisma row conversion (issue #59). The `decisions` table
 * flattens `triage_decision`/`duplicate_verdict`/`pending_action` into
 * nullable columns on one header row, keyed together (all-or-nothing) via the
 * writer below, so reading only needs to check one discriminator column per
 * group -- not every field independently.
 *
 * One divergence from the old SQLite blob: `TriageDecision.repro_steps` is
 * `string[] | null`, but Prisma's `reproSteps` column is a non-nullable
 * Postgres array (schema from #58), so `null` round-trips as `[]`. Downstream
 * code already treats the two identically (see `pipeline-body.ts`'s
 * `reproStepsList`), and no existing caller distinguishes them.
 */

import { Component, Prisma } from '@prisma/client';
import {
  Confidence,
  DecisionRecord,
  DuplicateCandidateConsidered,
  DuplicateVerdict,
  LlmCallUsage,
  PendingAction,
  StageTiming,
  TriageDecision,
} from '../reports/types';

export type DecisionRow = Prisma.DecisionGetPayload<{
  include: { duplicateCandidates: true; tokenUsages: true; stageTimings: true };
}>;

const NULL_TRIAGE_FIELDS = {
  title: null,
  reportType: null,
  severity: null,
  components: [] as Component[],
  reproSteps: [] as string[],
  supportingEvidence: null,
  distinctIssues: [] as string[],
};

function triageDecisionFields(decision: TriageDecision | null) {
  if (!decision) return NULL_TRIAGE_FIELDS;
  return {
    title: decision.title,
    reportType: decision.report_type,
    severity: decision.severity,
    components: decision.components,
    reproSteps: decision.repro_steps ?? [],
    supportingEvidence: decision.supporting_evidence,
    distinctIssues: decision.distinct_issues,
  };
}

const NULL_VERDICT_FIELDS = {
  duplicateTier: null,
  duplicateTargetIssue: null,
  duplicateSimilarity: null,
  duplicateRationale: null,
};

function duplicateVerdictFields(verdict: DuplicateVerdict | null) {
  if (!verdict) return NULL_VERDICT_FIELDS;
  return {
    duplicateTier: verdict.tier,
    duplicateTargetIssue: verdict.target_issue,
    duplicateSimilarity: verdict.similarity,
    duplicateRationale: verdict.rationale,
  };
}

const NULL_ACTION_FIELDS = {
  actionType: null,
  actionTitle: null,
  actionBody: null,
  actionLabels: [] as string[],
  actionTargetIssue: null,
};

function pendingActionFields(action: PendingAction | null) {
  if (!action) return NULL_ACTION_FIELDS;
  return {
    actionType: action.type,
    actionTitle: action.title,
    actionBody: action.body,
    actionLabels: action.labels,
    actionTargetIssue: action.target_issue,
  };
}

function headerFields(record: DecisionRecord) {
  return {
    reportHash: record.report_hash,
    rawReport: record.raw_report,
    status: record.status,
    createdAt: new Date(record.created_at * 1000),
    updatedAt: new Date(record.updated_at * 1000),
    validationRetriesConsumed: record.validation_retries_consumed,
    validationBudgetExhausted: record.validation_budget_exhausted,
    confidence: record.confidence,
    transientRetriesConsumed: record.transient_retries_consumed,
    outcome: record.outcome,
    giteaIssueNumber: record.gitea_issue_number,
    error: record.error,
    ...triageDecisionFields(record.triage_decision),
    ...duplicateVerdictFields(record.duplicate_verdict),
    ...pendingActionFields(record.pending_action),
  };
}

function duplicateCandidateCreates(record: DecisionRecord): Prisma.DuplicateCandidateCreateWithoutDecisionInput[] {
  return record.duplicate_candidates_considered.map((c) => ({
    issueNumber: c.issue_number,
    similarity: c.similarity,
    sameBug: c.same_bug,
  }));
}

function tokenUsageCreates(record: DecisionRecord): Prisma.TokenUsageCreateWithoutDecisionInput[] {
  return record.token_usage.map((t) => ({
    call: t.call,
    candidateIssueNumber: t.candidate_issue_number,
    inputTokens: t.input_tokens,
    outputTokens: t.output_tokens,
  }));
}

function stageTimingCreates(record: DecisionRecord): Prisma.StageTimingCreateWithoutDecisionInput[] {
  return record.stage_timings_ms.map((s) => ({
    stage: s.stage,
    durationMs: s.duration_ms,
    candidateIssueNumber: s.candidate_issue_number,
  }));
}

export function toDecisionCreateInput(record: DecisionRecord): Prisma.DecisionCreateInput {
  return {
    ...headerFields(record),
    duplicateCandidates: { create: duplicateCandidateCreates(record) },
    tokenUsages: { create: tokenUsageCreates(record) },
    stageTimings: { create: stageTimingCreates(record) },
  };
}

// Fully replaces the prior evidence-trail rows rather than merging with them
// (issue #59's "save still fully replaces the prior record"): nested
// `deleteMany: {}` clears every existing child row for this decision before
// the `create` below repopulates them, all inside Prisma's single batched
// write for a nested update.
export function toDecisionReplaceUpdateInput(record: DecisionRecord): Prisma.DecisionUpdateInput {
  return {
    ...headerFields(record),
    duplicateCandidates: { deleteMany: {}, create: duplicateCandidateCreates(record) },
    tokenUsages: { deleteMany: {}, create: tokenUsageCreates(record) },
    stageTimings: { deleteMany: {}, create: stageTimingCreates(record) },
  };
}

function fromTriageDecision(row: DecisionRow): TriageDecision | null {
  if (row.title === null) return null;
  return {
    title: row.title,
    report_type: row.reportType!,
    severity: row.severity,
    components: row.components,
    repro_steps: row.reproSteps,
    supporting_evidence: row.supportingEvidence,
    distinct_issues: row.distinctIssues,
  };
}

function fromDuplicateVerdict(row: DecisionRow): DuplicateVerdict | null {
  if (row.duplicateTier === null) return null;
  return {
    tier: row.duplicateTier,
    target_issue: row.duplicateTargetIssue,
    similarity: row.duplicateSimilarity,
    rationale: row.duplicateRationale ?? '',
  };
}

function fromPendingAction(row: DecisionRow): PendingAction | null {
  if (row.actionType === null) return null;
  return {
    type: row.actionType,
    title: row.actionTitle,
    body: row.actionBody,
    labels: row.actionLabels,
    target_issue: row.actionTargetIssue,
  };
}

function fromCandidatesConsidered(row: DecisionRow): DuplicateCandidateConsidered[] {
  return row.duplicateCandidates.map((c) => ({
    issue_number: c.issueNumber,
    similarity: c.similarity,
    same_bug: c.sameBug,
  }));
}

function fromTokenUsage(row: DecisionRow): LlmCallUsage[] {
  return row.tokenUsages.map((t) => ({
    call: t.call,
    candidate_issue_number: t.candidateIssueNumber,
    input_tokens: t.inputTokens,
    output_tokens: t.outputTokens,
  }));
}

function fromStageTimings(row: DecisionRow): StageTiming[] {
  return row.stageTimings.map((s) => ({
    stage: s.stage,
    duration_ms: s.durationMs,
    candidate_issue_number: s.candidateIssueNumber,
  }));
}

export function fromDecisionRow(row: DecisionRow): DecisionRecord {
  return {
    report_hash: row.reportHash,
    raw_report: row.rawReport,
    status: row.status,
    triage_decision: fromTriageDecision(row),
    duplicate_verdict: fromDuplicateVerdict(row),
    pending_action: fromPendingAction(row),
    outcome: row.outcome,
    gitea_issue_number: row.giteaIssueNumber,
    error: row.error,
    created_at: row.createdAt.getTime() / 1000,
    updated_at: row.updatedAt.getTime() / 1000,
    validation_retries_consumed: row.validationRetriesConsumed,
    validation_budget_exhausted: row.validationBudgetExhausted,
    confidence: row.confidence as Confidence | null,
    transient_retries_consumed: row.transientRetriesConsumed,
    duplicate_candidates_considered: fromCandidatesConsidered(row),
    token_usage: fromTokenUsage(row),
    stage_timings_ms: fromStageTimings(row),
  };
}
