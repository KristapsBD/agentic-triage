/**
 * The seam other tickets build on — TS equivalent of app/pipeline.py's
 * process_report()/_route()/_execute_pending_action(). Depends only on
 * TriagePort, never on GiteaClient or any other provider directly, so tests
 * can substitute one FakeTriagePort to cover the whole pipeline (ticket
 * #26's Testing Decisions).
 *
 * Ticket #30 scope adds: the bug path now checks for a Duplicate Candidate
 * before creating a fresh issue (three-tier verdict, ADR-0005) — a clear
 * duplicate comments on the existing issue instead of creating a new one; a
 * possible duplicate still creates a new issue but cross-linked and
 * Review Flagged; not_a_duplicate is the #29 behavior unchanged.
 *
 * Ticket #31 scope adds: both the extraction call and every duplicate-
 * judgment call (via findDuplicateVerdict) run behind the two independent
 * retry budgets (ADR-0008, see retry.ts). Exhausting the transient budget
 * surfaces as PipelineUnavailableError (502, retry-safe); exhausting the
 * validation budget for extraction degrades to a needs-triage Gitea issue
 * rather than a crash or a silent drop — mirrors app/pipeline.py's
 * process_report().
 *
 * Ticket #32 scope adds: duplicate detection now also runs on the unclear
 * path (previously bug-only), so a vague repeat of an existing issue still
 * gets a cross-link instead of losing the signal. It also adds the one
 * Report Type case not yet handled — a Bundled Report (more than one
 * distinct issue in one Raw Report) is never auto-split; it's Review
 * Flagged with the distinct issues listed in the body, same as every other
 * low-confidence path (ADR-0006).
 *
 * Ticket #33 scope adds: every decision is persisted as a Decision Record,
 * written in phases (pending -> processing -> completed/gitea_call_failed)
 * so a repeated POST of the same Raw Report short-circuits to the prior
 * result once completed, or resumes from wherever it left off (never
 * re-running the LLM once a Triage Decision or routing decision is already
 * recorded) rather than repeating Gitea writes. Routing (_route) is now
 * pure w.r.t. Decision Record state — it only computes a PendingAction, the
 * outcome name, and the Duplicate Verdict; the Gitea write itself happens
 * once, in _executePendingAction, on the way out.
 */

import { Inject, Injectable } from '@nestjs/common';
import { GiteaError } from '../gitea/gitea.errors';
import { SETTINGS } from '../config/settings';
import { NEEDS_TRIAGE, FEATURE_REQUEST, NEEDS_INFO } from '../gitea/labels';
import { computeConfidence, ConfidenceResult } from './confidence';
import { findDuplicateVerdict } from './duplicate-verdict';
import {
  bugIssueBody,
  duplicateCommentBody,
  duplicateCrossLinkNote,
  hashReport,
  issueBody,
  reviewFlagBody,
} from './pipeline-body';
import { PipelineUnavailableError } from './pipeline.errors';
import { RetryBudgets, withRetryBudgets } from './retry';
import { isBundled } from './schemas';
import { NoopTelemetryRecorder } from '../telemetry/noop-telemetry-recorder';
import { TELEMETRY_RECORDER, TelemetryRecorder } from '../telemetry/telemetry-recorder.interface';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import {
  DecisionRecord,
  DuplicateCandidateConsidered,
  DuplicateVerdict,
  LlmCallUsage,
  Outcome,
  PendingAction,
  ResponseEnvelope,
  StageTiming,
  TriageDecision,
} from './types';

const UNCLEAR_REASON =
  "Report Type was classified as unclear — there's a real signal here but not " +
  'enough detail to safely extract severity/components, so this was routed to a ' +
  'human rather than discarded.';

const VALIDATION_FAILED_NOTE =
  "Automated triage failed: the model's structured output kept failing " +
  'validation across every retry. This issue was filed automatically as a ' +
  'safe fallback rather than being dropped or crashing the request.';

// Only used as the fallback when PipelineService is constructed directly
// (tests) rather than through Nest DI, which always resolves the real
// Settings via the SETTINGS token instead.
const DEFAULT_RETRY_BUDGETS: RetryBudgets = {
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 0,
};

interface RoutingResult {
  action: PendingAction;
  outcome: Outcome;
  verdict: DuplicateVerdict | null;
  confidence: ConfidenceResult;
  candidatesConsidered: DuplicateCandidateConsidered[];
  tokenUsage: LlmCallUsage[];
  stageTimings: StageTiming[];
  transientRetriesConsumed: number;
}

const NO_ACTION: PendingAction = { type: 'none', title: null, body: null, labels: [], target_issue: null };
const NO_EVIDENCE = { candidatesConsidered: [] as DuplicateCandidateConsidered[], tokenUsage: [] as LlmCallUsage[], stageTimings: [] as StageTiming[], transientRetriesConsumed: 0 };

@Injectable()
export class PipelineService {
  constructor(
    @Inject(TRIAGE_PORT) private readonly port: TriagePort,
    @Inject(SETTINGS) private readonly settings: RetryBudgets = DEFAULT_RETRY_BUDGETS,
    @Inject(TELEMETRY_RECORDER) private readonly telemetry: TelemetryRecorder = new NoopTelemetryRecorder(),
  ) {}

  async processReport(rawReport: string): Promise<ResponseEnvelope> {
    const reportHash = hashReport(rawReport);
    const requestStart = Date.now();
    let record = await this.port.getDecisionRecord(reportHash);

    if (record !== null && record.status === 'completed') {
      return this.envelopeOf(record);
    }

    if (record === null) {
      record = this.newRecord(reportHash, rawReport);
      await this.save(record);
    }

    record.status = 'processing';
    await this.save(record);

    if (record.triage_decision === null) {
      const stageStart = Date.now();
      const outcome = await withRetryBudgets((feedback) => this.port.extract(rawReport, feedback), this.settings);
      const extractionTiming: StageTiming = { stage: 'extraction', duration_ms: Date.now() - stageStart, candidate_issue_number: null };
      record.stage_timings_ms.push(extractionTiming);
      this.recordStage(reportHash, extractionTiming);
      record.transient_retries_consumed += outcome.transientAttempts;

      if (outcome.failure === 'transient_exhausted') {
        this.telemetry.recordRetryOutcome('extraction', 'transient', 'exhausted', outcome.transientAttempts);
        throw new PipelineUnavailableError(reportHash, 'llm_unavailable', outcome.lastError ?? '');
      }
      if (outcome.transientAttempts > 0) {
        this.telemetry.recordRetryOutcome('extraction', 'transient', 'succeeded', outcome.transientAttempts);
      }
      if (outcome.failure === 'validation_exhausted') {
        this.telemetry.recordRetryOutcome('extraction', 'validation', 'exhausted', outcome.validationAttempts);
        record.validation_retries_consumed = outcome.validationAttempts;
        record.validation_budget_exhausted = true;
        const confidence = computeConfidence({
          validationRetriesConsumed: outcome.validationAttempts,
          validationBudgetExhausted: true,
          duplicateVerdictTier: null,
          reviewFlagged: true,
        });
        record.confidence = confidence.band;
        const body = reviewFlagBody(rawReport, VALIDATION_FAILED_NOTE, confidence);
        record.pending_action = {
          type: 'create_issue',
          title: 'Automated triage failed for incoming report',
          body,
          labels: [NEEDS_TRIAGE],
          target_issue: null,
        };
        record.outcome = 'review_flagged';
        this.telemetry.recordOutcome(record.outcome);
        await this.save(record);
        return this.finishRequest(record, requestStart);
      }
      if (outcome.validationAttempts > 0) {
        this.telemetry.recordRetryOutcome('extraction', 'validation', 'succeeded', outcome.validationAttempts);
      }

      const { decision, usage } = outcome.result as { decision: TriageDecision; usage: { input_tokens: number; output_tokens: number } };
      record.triage_decision = decision;
      const extractUsage: LlmCallUsage = { call: 'extract', candidate_issue_number: null, ...usage };
      record.token_usage.push(extractUsage);
      this.telemetry.recordTokenUsage(extractUsage);
      record.validation_retries_consumed = outcome.validationAttempts;
      record.validation_budget_exhausted = false;
      await this.save(record);
    }

    const decision = record.triage_decision;

    if (record.pending_action === null) {
      const routing = await this.route(decision, rawReport, record.validation_retries_consumed);
      record.pending_action = routing.action;
      record.outcome = routing.outcome;
      record.duplicate_verdict = routing.verdict;
      record.confidence = routing.confidence.band;
      record.duplicate_candidates_considered = routing.candidatesConsidered;
      record.token_usage.push(...routing.tokenUsage);
      record.stage_timings_ms.push(...routing.stageTimings);
      record.transient_retries_consumed += routing.transientRetriesConsumed;
      this.recordRoutingTelemetry(reportHash, routing);
      this.telemetry.recordOutcome(record.outcome);
      await this.save(record);
    }

    return this.finishRequest(record, requestStart);
  }

  /**
   * Runs the pending Gitea action and records the whole-request 'end_to_end'
   * stage timing (#43) once processing has actually happened this call —
   * never on the already-completed short-circuit at the top of
   * processReport, so a cache-hit repeat POST doesn't skew the p95.
   */
  private async finishRequest(record: DecisionRecord, requestStart: number): Promise<ResponseEnvelope> {
    const envelope = await this.executePendingAction(record);
    const endToEndTiming: StageTiming = { stage: 'end_to_end', duration_ms: Date.now() - requestStart, candidate_issue_number: null };
    record.stage_timings_ms.push(endToEndTiming);
    this.recordStage(record.report_hash, endToEndTiming);
    await this.save(record);
    return envelope;
  }

  /**
   * Computes the Gitea action, outcome, and Duplicate Verdict (if any) for
   * an already-extracted Triage Decision. Pure w.r.t. Decision Record
   * state; only touches the port for listOpenIssues/findCandidates/
   * judgeDuplicate (read-only LLM/embedding calls), never a Gitea write.
   */
  private async route(decision: TriageDecision, rawReport: string, validationRetriesConsumed: number): Promise<RoutingResult> {
    if (decision.report_type === 'spam_or_off_topic') {
      const confidence = computeConfidence({
        validationRetriesConsumed,
        validationBudgetExhausted: false,
        duplicateVerdictTier: null,
        reviewFlagged: false,
      });
      return { action: NO_ACTION, outcome: 'dropped_spam', verdict: null, confidence, ...NO_EVIDENCE };
    }

    if (decision.report_type === 'feature_request') {
      const confidence = computeConfidence({
        validationRetriesConsumed,
        validationBudgetExhausted: false,
        duplicateVerdictTier: null,
        reviewFlagged: false,
      });
      const body = issueBody(rawReport, `**Report Type:** feature_request\n\n${decision.title}`);
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [FEATURE_REQUEST], target_issue: null };
      return { action, outcome: 'feature_request_filed', verdict: null, confidence, ...NO_EVIDENCE };
    }

    if (decision.report_type === 'unclear') {
      const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
      const confidence = computeConfidence({
        validationRetriesConsumed,
        validationBudgetExhausted: false,
        duplicateVerdictTier: detection.verdict.tier,
        reviewFlagged: true,
      });
      const body = reviewFlagBody(rawReport, UNCLEAR_REASON, confidence, duplicateCrossLinkNote(detection.verdict));
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_INFO], target_issue: null };
      return {
        action,
        outcome: 'review_flagged',
        verdict: detection.verdict,
        confidence,
        candidatesConsidered: detection.candidatesConsidered,
        tokenUsage: detection.tokenUsage,
        stageTimings: detection.stageTimings,
        transientRetriesConsumed: detection.transientRetriesConsumed,
      };
    }

    // report_type === 'bug' from here down.
    if (decision.severity === null) {
      throw new Error('bug reports always get a severity from the extraction schema');
    }

    if (isBundled(decision)) {
      return this.routeBundled(decision, rawReport, validationRetriesConsumed);
    }

    const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
    const verdict = detection.verdict;
    const evidence = {
      candidatesConsidered: detection.candidatesConsidered,
      tokenUsage: detection.tokenUsage,
      stageTimings: detection.stageTimings,
      transientRetriesConsumed: detection.transientRetriesConsumed,
    };

    if (verdict.tier === 'clear_duplicate') {
      const confidence = computeConfidence({
        validationRetriesConsumed,
        validationBudgetExhausted: false,
        duplicateVerdictTier: verdict.tier,
        reviewFlagged: false,
      });
      const body = duplicateCommentBody(rawReport, verdict.rationale);
      const action: PendingAction = { type: 'comment', title: null, body, labels: [], target_issue: verdict.target_issue };
      return { action, outcome: 'duplicate_commented', verdict, confidence, ...evidence };
    }

    if (verdict.tier === 'possible_duplicate') {
      const confidence = computeConfidence({
        validationRetriesConsumed,
        validationBudgetExhausted: false,
        duplicateVerdictTier: verdict.tier,
        reviewFlagged: true,
      });
      const reason =
        `Duplicate check found a possible match to #${verdict.target_issue} but didn't clear the ` +
        `auto-comment bar (${verdict.rationale}). Filed as a new issue, cross-linked, rather than ` +
        'risking a false merge.';
      const body = reviewFlagBody(rawReport, reason, confidence, `### Possible duplicate\n\nSee #${verdict.target_issue}.`);
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_TRIAGE], target_issue: null };
      return { action, outcome: 'review_flagged', verdict, confidence, ...evidence };
    }

    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: verdict.tier,
      reviewFlagged: false,
    });
    const body = bugIssueBody(rawReport, decision);
    const labels = [decision.severity, ...decision.components];
    const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels, target_issue: null };
    return { action, outcome: 'issue_created', verdict, confidence, ...evidence };
  }

  private async routeBundled(decision: TriageDecision, rawReport: string, validationRetriesConsumed: number): Promise<RoutingResult> {
    const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: detection.verdict.tier,
      reviewFlagged: true,
    });
    const listing = decision.distinct_issues.map((issue) => `- ${issue}`).join('\n');
    const reason =
      `Report describes what looks like ${decision.distinct_issues.length} distinct ` +
      "issues, not auto-splitting — a human should decide how to split this.";
    const extra = [`### Distinct issues identified\n\n${listing}`, duplicateCrossLinkNote(detection.verdict)]
      .filter((part) => part.trim())
      .join('\n\n');
    const body = reviewFlagBody(rawReport, reason, confidence, extra);
    const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_TRIAGE], target_issue: null };
    return {
      action,
      outcome: 'review_flagged',
      verdict: detection.verdict,
      confidence,
      candidatesConsidered: detection.candidatesConsidered,
      tokenUsage: detection.tokenUsage,
      stageTimings: detection.stageTimings,
      transientRetriesConsumed: detection.transientRetriesConsumed,
    };
  }

  /**
   * Executes the one pending Gitea write for a record whose routing
   * decision is already computed and persisted — safe to call again on a
   * retried POST since the action itself was only ever computed once.
   */
  private async executePendingAction(record: DecisionRecord): Promise<ResponseEnvelope> {
    const action = record.pending_action;
    if (action === null) {
      throw new Error('executePendingAction called before a pending action was computed');
    }

    try {
      if (action.type === 'create_issue') {
        if (action.title === null || action.body === null) {
          throw new Error('create_issue action missing title/body');
        }
        const stageStart = Date.now();
        record.gitea_issue_number = await this.port.createIssue(action.title, action.body, action.labels);
        const timing: StageTiming = { stage: 'gitea_create_issue', duration_ms: Date.now() - stageStart, candidate_issue_number: null };
        record.stage_timings_ms.push(timing);
        this.recordStage(record.report_hash, timing);
      } else if (action.type === 'comment') {
        if (action.target_issue === null || action.body === null) {
          throw new Error('comment action missing target_issue/body');
        }
        const stageStart = Date.now();
        await this.port.commentIssue(action.target_issue, action.body);
        const timing: StageTiming = { stage: 'gitea_comment_issue', duration_ms: Date.now() - stageStart, candidate_issue_number: null };
        record.stage_timings_ms.push(timing);
        this.recordStage(record.report_hash, timing);
        record.gitea_issue_number = action.target_issue;
      }
      record.status = 'completed';
      await this.save(record);
      return this.envelopeOf(record);
    } catch (e) {
      if (e instanceof GiteaError) {
        record.status = 'gitea_call_failed';
        record.error = e.message;
        await this.save(record);
        throw new PipelineUnavailableError(record.report_hash, 'gitea_unavailable', e.message);
      }
      throw e;
    }
  }

  private newRecord(reportHash: string, rawReport: string): DecisionRecord {
    const now = Date.now() / 1000;
    return {
      report_hash: reportHash,
      raw_report: rawReport,
      status: 'pending',
      triage_decision: null,
      duplicate_verdict: null,
      pending_action: null,
      outcome: null,
      gitea_issue_number: null,
      error: null,
      created_at: now,
      updated_at: now,
      validation_retries_consumed: 0,
      validation_budget_exhausted: false,
      confidence: null,
      transient_retries_consumed: 0,
      duplicate_candidates_considered: [],
      token_usage: [],
      stage_timings_ms: [],
    };
  }

  private envelopeOf(record: DecisionRecord): ResponseEnvelope {
    if (record.outcome === null || record.confidence === null) {
      throw new Error('envelopeOf called before an outcome/confidence was decided');
    }
    return {
      outcome: record.outcome,
      gitea_issue_number: record.gitea_issue_number,
      triage_decision: record.triage_decision,
      duplicate_verdict: record.duplicate_verdict,
      confidence: record.confidence,
    };
  }

  private recordStage(reportHash: string, timing: StageTiming): void {
    this.telemetry.recordStageLatency(timing);
    this.telemetry.logStage(reportHash, timing.stage, {
      duration_ms: timing.duration_ms,
      candidate_issue_number: timing.candidate_issue_number,
    });
  }

  /**
   * Ticket #41: findDuplicateVerdict stays a plain function with no
   * telemetry dependency of its own — PipelineService is the only seam
   * TelemetryRecorder is injected into, so it reports the whole evidence
   * trail (stage timings, token usage, the Duplicate Verdict tier, and any
   * silently-skipped candidates) once routing returns it.
   */
  private recordRoutingTelemetry(reportHash: string, routing: RoutingResult): void {
    for (const timing of routing.stageTimings) {
      this.recordStage(reportHash, timing);
    }
    for (const usage of routing.tokenUsage) {
      this.telemetry.recordTokenUsage(usage);
    }
    if (routing.verdict !== null) {
      this.telemetry.recordDuplicateVerdict(routing.verdict.tier);
    }
    for (const considered of routing.candidatesConsidered) {
      if (considered.same_bug === null) {
        this.telemetry.recordDuplicateJudgmentSkipped(reportHash, considered.issue_number);
      }
    }
    if (routing.transientRetriesConsumed > 0) {
      this.telemetry.recordRetryOutcome('duplicate_judgment', 'transient', 'succeeded', routing.transientRetriesConsumed);
    }
  }

  private async save(record: DecisionRecord): Promise<void> {
    record.updated_at = Date.now() / 1000;
    await this.port.saveDecisionRecord(record);
  }
}
