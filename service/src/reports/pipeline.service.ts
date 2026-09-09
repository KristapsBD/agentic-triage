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
  suggestedFieldsNote,
} from './pipeline-body';
import { PipelineRejectedError, PipelineUnavailableError } from './pipeline.errors';
import { redactSecrets } from './redaction';
import { RetryBudgets, RetryOutcome, withRetryBudgets } from './retry';
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
  ReportType,
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

// Structurally a subset of Settings -- real DI always resolves the full
// Settings object via the SETTINGS token, which satisfies this.
export interface PipelineSettings extends RetryBudgets {
  duplicate_similarity_floor: number;
}

// Only used as the fallback when PipelineService is constructed directly
// (tests) rather than through Nest DI, which always resolves the real
// Settings via the SETTINGS token instead.
const DEFAULT_RETRY_BUDGETS: PipelineSettings = {
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 0,
  duplicate_similarity_floor: 0.35,
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

type ExtractionOutcome = RetryOutcome<{ decision: TriageDecision; usage: { input_tokens: number; output_tokens: number } }>;

type RecordResolution = { kind: 'ready'; record: DecisionRecord } | { kind: 'done'; envelope: ResponseEnvelope };

// F3 audit finding: bounds on awaitCompletedRecord's poll loop -- 100
// attempts * 20ms = 2s worst case, comfortably longer than a normal
// extract+route+Gitea-write round trip.
const CONCURRENT_CLAIM_POLL_ATTEMPTS = 100;
const CONCURRENT_CLAIM_POLL_INTERVAL_MS = 20;

const NO_ACTION: PendingAction = { type: 'none', title: null, body: null, labels: [], target_issue: null };
const NO_EVIDENCE = { candidatesConsidered: [] as DuplicateCandidateConsidered[], tokenUsage: [] as LlmCallUsage[], stageTimings: [] as StageTiming[], transientRetriesConsumed: 0 };

@Injectable()
export class PipelineService {
  constructor(
    @Inject(TRIAGE_PORT) private readonly port: TriagePort,
    @Inject(SETTINGS) private readonly settings: PipelineSettings = DEFAULT_RETRY_BUDGETS,
    @Inject(TELEMETRY_RECORDER) private readonly telemetry: TelemetryRecorder = new NoopTelemetryRecorder(),
  ) {}

  async processReport(rawReport: string): Promise<ResponseEnvelope> {
    const reportHash = hashReport(rawReport);
    const requestStart = Date.now();
    const resolution = await this.resolveRecord(reportHash, rawReport);
    if (resolution.kind === 'done') {
      return resolution.envelope;
    }
    const record = resolution.record;

    record.status = 'processing';
    await this.save(record);

    const extracted = await this.ensureTriageDecision(record, rawReport, requestStart);
    if (extracted !== null) {
      return extracted;
    }

    await this.ensureRouting(record, rawReport);

    return this.finishRequest(record, requestStart);
  }

  /**
   * Resolves the Decision Record for a Raw Report: an already-completed
   * record short-circuits to its envelope, a fresh report claims a new
   * record, and losing that claim to a concurrent identical POST (F3 audit
   * finding) waits for the winner instead of also running the LLM/Gitea work.
   */
  private async resolveRecord(reportHash: string, rawReport: string): Promise<RecordResolution> {
    const existing = await this.port.getDecisionRecord(reportHash);
    if (existing !== null) {
      return this.resolveExistingRecord(existing);
    }
    return this.claimNewRecord(reportHash, rawReport);
  }

  private resolveExistingRecord(existing: DecisionRecord): RecordResolution {
    if (existing.status === 'completed') {
      return { kind: 'done', envelope: this.envelopeOf(existing) };
    }
    return { kind: 'ready', record: existing };
  }

  private async claimNewRecord(reportHash: string, rawReport: string): Promise<RecordResolution> {
    const candidate = this.newRecord(reportHash, rawReport);
    const claimed = await this.port.claimDecisionRecord(candidate);
    if (claimed) {
      return { kind: 'ready', record: candidate };
    }
    const winner = await this.awaitCompletedRecord(reportHash);
    return { kind: 'done', envelope: this.envelopeOf(winner) };
  }

  /**
   * Ensures record.triage_decision is populated, running the extraction
   * retry budget if needed. Returns a final envelope when validation
   * exhausted its budget (the fallback needs-triage path short-circuits the
   * rest of processReport), otherwise null to signal "continue".
   */
  private async ensureTriageDecision(
    record: DecisionRecord,
    rawReport: string,
    requestStart: number,
  ): Promise<ResponseEnvelope | null> {
    if (record.triage_decision !== null) {
      return null;
    }
    const outcome = await this.runExtractionCall(record, rawReport);
    return this.handleExtractionOutcome(record, rawReport, requestStart, outcome);
  }

  private async runExtractionCall(record: DecisionRecord, rawReport: string): Promise<ExtractionOutcome> {
    const stageStart = Date.now();
    const outcome = await withRetryBudgets((feedback) => this.port.extract(rawReport, feedback), this.settings);
    const extractionTiming: StageTiming = { stage: 'extraction', duration_ms: Date.now() - stageStart, candidate_issue_number: null };
    record.stage_timings_ms.push(extractionTiming);
    this.recordStage(record.report_hash, extractionTiming);
    record.transient_retries_consumed += outcome.transientAttempts;
    return outcome;
  }

  private async handleExtractionOutcome(
    record: DecisionRecord,
    rawReport: string,
    requestStart: number,
    outcome: ExtractionOutcome,
  ): Promise<ResponseEnvelope | null> {
    if (outcome.failure === 'transient_exhausted') {
      this.telemetry.recordRetryOutcome('extraction', 'transient', 'exhausted', outcome.transientAttempts);
      throw new PipelineUnavailableError(record.report_hash, 'llm_unavailable', outcome.lastError ?? '');
    }
    this.recordTransientRetrySuccess(outcome);

    if (outcome.failure === 'validation_exhausted') {
      return this.handleValidationExhausted(record, rawReport, requestStart, outcome);
    }
    this.recordValidationRetrySuccess(outcome);

    this.applyExtractionResult(record, outcome);
    await this.save(record);
    return null;
  }

  private recordTransientRetrySuccess(outcome: ExtractionOutcome): void {
    if (outcome.transientAttempts > 0) {
      this.telemetry.recordRetryOutcome('extraction', 'transient', 'succeeded', outcome.transientAttempts);
    }
  }

  private recordValidationRetrySuccess(outcome: ExtractionOutcome): void {
    if (outcome.validationAttempts > 0) {
      this.telemetry.recordRetryOutcome('extraction', 'validation', 'succeeded', outcome.validationAttempts);
    }
  }

  private applyExtractionResult(record: DecisionRecord, outcome: ExtractionOutcome): void {
    const { decision, usage } = outcome.result as { decision: TriageDecision; usage: { input_tokens: number; output_tokens: number } };
    record.triage_decision = decision;
    const extractUsage: LlmCallUsage = { call: 'extract', candidate_issue_number: null, ...usage };
    record.token_usage.push(extractUsage);
    this.telemetry.recordTokenUsage(extractUsage);
    record.validation_retries_consumed = outcome.validationAttempts;
    record.validation_budget_exhausted = false;
  }

  private async handleValidationExhausted(
    record: DecisionRecord,
    rawReport: string,
    requestStart: number,
    outcome: ExtractionOutcome,
  ): Promise<ResponseEnvelope> {
    this.telemetry.recordRetryOutcome('extraction', 'validation', 'exhausted', outcome.validationAttempts);
    record.validation_retries_consumed = outcome.validationAttempts;
    record.validation_budget_exhausted = true;
    const confidence = computeConfidence({
      validationRetriesConsumed: outcome.validationAttempts,
      validationBudgetExhausted: true,
      duplicateVerdictTier: null,
      duplicateSimilarity: null,
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

  /** Computes and persists the routing decision, if not already computed. */
  private async ensureRouting(record: DecisionRecord, rawReport: string): Promise<void> {
    if (record.pending_action !== null) {
      return;
    }
    const decision = record.triage_decision as TriageDecision;
    const routing = await this.route(decision, rawReport, record.validation_retries_consumed);
    record.pending_action = routing.action;
    record.outcome = routing.outcome;
    record.duplicate_verdict = routing.verdict;
    record.confidence = routing.confidence.band;
    record.duplicate_candidates_considered = routing.candidatesConsidered;
    record.token_usage.push(...routing.tokenUsage);
    record.stage_timings_ms.push(...routing.stageTimings);
    record.transient_retries_consumed += routing.transientRetriesConsumed;
    this.recordRoutingTelemetry(record.report_hash, routing);
    this.telemetry.recordOutcome(record.outcome);
    await this.save(record);
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
    // decision.title is model-extracted from reporter text, same as
    // repro_steps/distinct_issues (F2 audit finding) -- redact before it
    // reaches Gitea, both as the issue title itself and wherever it's also
    // embedded in a body below.
    const title = redactSecrets(decision.title);
    const handlers: Record<ReportType, (d: TriageDecision, t: string, r: string, v: number) => Promise<RoutingResult>> = {
      spam_or_off_topic: (_d, _t, _r, v) => this.routeSpam(v),
      feature_request: (_d, t, r, v) => this.routeFeatureRequest(t, r, v),
      unclear: (d, t, r, v) => this.routeUnclear(d, t, r, v),
      bug: (d, t, r, v) => this.routeBug(d, t, r, v),
    };
    return handlers[decision.report_type](decision, title, rawReport, validationRetriesConsumed);
  }

  private async routeSpam(validationRetriesConsumed: number): Promise<RoutingResult> {
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: null,
      duplicateSimilarity: null,
      reviewFlagged: false,
    });
    return { action: NO_ACTION, outcome: 'dropped_spam', verdict: null, confidence, ...NO_EVIDENCE };
  }

  private async routeFeatureRequest(title: string, rawReport: string, validationRetriesConsumed: number): Promise<RoutingResult> {
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: null,
      duplicateSimilarity: null,
      reviewFlagged: false,
    });
    const body = issueBody(rawReport, `**Report Type:** feature_request\n\n${title}`);
    const action: PendingAction = { type: 'create_issue', title, body, labels: [FEATURE_REQUEST], target_issue: null };
    return { action, outcome: 'feature_request_filed', verdict: null, confidence, ...NO_EVIDENCE };
  }

  private async routeUnclear(
    decision: TriageDecision,
    title: string,
    rawReport: string,
    validationRetriesConsumed: number,
  ): Promise<RoutingResult> {
    const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: detection.verdict.tier,
      duplicateSimilarity: detection.verdict.similarity,
      reviewFlagged: true,
    });
    const extra = [suggestedFieldsNote(decision), duplicateCrossLinkNote(detection.verdict)].filter((part) => part.trim()).join('\n\n');
    const body = reviewFlagBody(rawReport, UNCLEAR_REASON, confidence, extra);
    const action: PendingAction = { type: 'create_issue', title, body, labels: [NEEDS_INFO], target_issue: null };
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

  private async routeBug(
    decision: TriageDecision,
    title: string,
    rawReport: string,
    validationRetriesConsumed: number,
  ): Promise<RoutingResult> {
    if (decision.severity === null) {
      throw new Error('bug reports always get a severity from the extraction schema');
    }
    if (isBundled(decision)) {
      return this.routeBundled(decision, rawReport, validationRetriesConsumed);
    }

    const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
    return this.routeByDuplicateTier(decision, title, validationRetriesConsumed, rawReport, detection);
  }

  private routeByDuplicateTier(
    decision: TriageDecision,
    title: string,
    validationRetriesConsumed: number,
    rawReport: string,
    detection: Awaited<ReturnType<typeof findDuplicateVerdict>>,
  ): RoutingResult {
    const verdict = detection.verdict;
    const evidence = {
      candidatesConsidered: detection.candidatesConsidered,
      tokenUsage: detection.tokenUsage,
      stageTimings: detection.stageTimings,
      transientRetriesConsumed: detection.transientRetriesConsumed,
    };

    if (verdict.tier === 'clear_duplicate') {
      return this.routeClearDuplicate(rawReport, validationRetriesConsumed, verdict, evidence);
    }
    if (verdict.tier === 'possible_duplicate') {
      return this.routePossibleDuplicate(decision, title, rawReport, validationRetriesConsumed, verdict, evidence);
    }
    return this.routeNewIssue(decision, title, rawReport, validationRetriesConsumed, verdict, evidence);
  }

  private routeClearDuplicate(
    rawReport: string,
    validationRetriesConsumed: number,
    verdict: DuplicateVerdict,
    evidence: Pick<RoutingResult, 'candidatesConsidered' | 'tokenUsage' | 'stageTimings' | 'transientRetriesConsumed'>,
  ): RoutingResult {
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: verdict.tier,
      duplicateSimilarity: verdict.similarity,
      reviewFlagged: false,
    });
    const body = duplicateCommentBody(rawReport, verdict.rationale);
    const action: PendingAction = { type: 'comment', title: null, body, labels: [], target_issue: verdict.target_issue };
    return { action, outcome: 'duplicate_commented', verdict, confidence, ...evidence };
  }

  private routePossibleDuplicate(
    decision: TriageDecision,
    title: string,
    rawReport: string,
    validationRetriesConsumed: number,
    verdict: DuplicateVerdict,
    evidence: Pick<RoutingResult, 'candidatesConsidered' | 'tokenUsage' | 'stageTimings' | 'transientRetriesConsumed'>,
  ): RoutingResult {
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: verdict.tier,
      duplicateSimilarity: verdict.similarity,
      reviewFlagged: true,
    });
    const reason =
      `Duplicate check found a possible match to #${verdict.target_issue} but didn't clear the ` +
      `auto-comment bar (${verdict.rationale}). Filed as a new issue, cross-linked, rather than ` +
      'risking a false merge.';
    const possibleDupExtra = [suggestedFieldsNote(decision), `### Possible duplicate\n\nSee #${verdict.target_issue}.`]
      .filter((part) => part.trim())
      .join('\n\n');
    const body = reviewFlagBody(rawReport, reason, confidence, possibleDupExtra);
    const action: PendingAction = { type: 'create_issue', title, body, labels: [NEEDS_TRIAGE], target_issue: null };
    return { action, outcome: 'review_flagged', verdict, confidence, ...evidence };
  }

  private routeNewIssue(
    decision: TriageDecision,
    title: string,
    rawReport: string,
    validationRetriesConsumed: number,
    verdict: DuplicateVerdict,
    evidence: Pick<RoutingResult, 'candidatesConsidered' | 'tokenUsage' | 'stageTimings' | 'transientRetriesConsumed'>,
  ): RoutingResult {
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: verdict.tier,
      duplicateSimilarity: verdict.similarity,
      reviewFlagged: false,
    });
    const body = bugIssueBody(rawReport, decision);
    const labels = [decision.severity as NonNullable<TriageDecision['severity']>, ...decision.components];
    const action: PendingAction = { type: 'create_issue', title, body, labels, target_issue: null };
    return { action, outcome: 'issue_created', verdict, confidence, ...evidence };
  }

  private async routeBundled(decision: TriageDecision, rawReport: string, validationRetriesConsumed: number): Promise<RoutingResult> {
    const detection = await findDuplicateVerdict(this.port, rawReport, this.settings);
    const confidence = computeConfidence({
      validationRetriesConsumed,
      validationBudgetExhausted: false,
      duplicateVerdictTier: detection.verdict.tier,
      duplicateSimilarity: detection.verdict.similarity,
      reviewFlagged: true,
    });
    const title = redactSecrets(decision.title);
    const listing = decision.distinct_issues.map((issue) => `- ${redactSecrets(issue)}`).join('\n');
    const reason =
      `Report describes what looks like ${decision.distinct_issues.length} distinct ` +
      "issues, not auto-splitting — a human should decide how to split this.";
    const extra = [`### Distinct issues identified\n\n${listing}`, duplicateCrossLinkNote(detection.verdict)]
      .filter((part) => part.trim())
      .join('\n\n');
    const body = reviewFlagBody(rawReport, reason, confidence, extra);
    const action: PendingAction = { type: 'create_issue', title, body, labels: [NEEDS_TRIAGE], target_issue: null };
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
      await this.runPendingAction(record, action);
      record.status = 'completed';
      await this.save(record);
      return this.envelopeOf(record);
    } catch (e) {
      return this.handleActionError(record, e);
    }
  }

  private async runPendingAction(record: DecisionRecord, action: PendingAction): Promise<void> {
    if (action.type === 'create_issue') {
      await this.runCreateIssueAction(record, action);
      return;
    }
    if (action.type === 'comment') {
      await this.runCommentAction(record, action);
    }
  }

  private async runCreateIssueAction(record: DecisionRecord, action: PendingAction): Promise<void> {
    if (action.title === null || action.body === null) {
      throw new Error('create_issue action missing title/body');
    }
    const stageStart = Date.now();
    record.gitea_issue_number = await this.port.createIssue(action.title, action.body, action.labels);
    const timing: StageTiming = { stage: 'gitea_create_issue', duration_ms: Date.now() - stageStart, candidate_issue_number: null };
    record.stage_timings_ms.push(timing);
    this.recordStage(record.report_hash, timing);
  }

  private async runCommentAction(record: DecisionRecord, action: PendingAction): Promise<void> {
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

  private async handleActionError(record: DecisionRecord, e: unknown): Promise<ResponseEnvelope> {
    if (!(e instanceof GiteaError)) {
      throw e;
    }
    record.status = 'gitea_call_failed';
    record.error = e.message;
    await this.save(record);
    if (!e.retryable) {
      throw new PipelineRejectedError(record.report_hash, 'gitea_rejected', e.message);
    }
    throw new PipelineUnavailableError(record.report_hash, 'gitea_unavailable', e.message);
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

  /**
   * F3 audit finding: called when claimDecisionRecord lost the race for a
   * report_hash another concurrent request just created. Polls rather than
   * doing the LLM/Gitea work a second time; bounded so a request that lost
   * the claim can never hang forever if the winner's request dies mid-flight
   * (its record stays at 'processing' rather than 'completed').
   */
  private async awaitCompletedRecord(reportHash: string): Promise<DecisionRecord> {
    for (let attempt = 0; attempt < CONCURRENT_CLAIM_POLL_ATTEMPTS; attempt += 1) {
      const record = await this.port.getDecisionRecord(reportHash);
      if (record !== null && record.status === 'completed') {
        return record;
      }
      await new Promise((resolve) => setTimeout(resolve, CONCURRENT_CLAIM_POLL_INTERVAL_MS));
    }
    throw new PipelineUnavailableError(
      reportHash,
      'concurrent_claim_timeout',
      'a concurrent request for the same report is still processing; retry the identical POST',
    );
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
    this.recordRoutingStageTimings(reportHash, routing.stageTimings);
    this.recordRoutingTokenUsage(routing.tokenUsage);
    this.recordRoutingVerdict(routing.verdict);
    this.recordSkippedCandidates(reportHash, routing.candidatesConsidered);
    this.recordRoutingTransientRetries(routing.transientRetriesConsumed);
  }

  private recordRoutingStageTimings(reportHash: string, stageTimings: StageTiming[]): void {
    for (const timing of stageTimings) {
      this.recordStage(reportHash, timing);
    }
  }

  private recordRoutingTokenUsage(tokenUsage: LlmCallUsage[]): void {
    for (const usage of tokenUsage) {
      this.telemetry.recordTokenUsage(usage);
    }
  }

  private recordRoutingVerdict(verdict: DuplicateVerdict | null): void {
    if (verdict !== null) {
      this.telemetry.recordDuplicateVerdict(verdict.tier);
    }
  }

  private recordSkippedCandidates(reportHash: string, candidatesConsidered: DuplicateCandidateConsidered[]): void {
    for (const considered of candidatesConsidered) {
      if (considered.same_bug === null) {
        this.telemetry.recordDuplicateJudgmentSkipped(reportHash, considered.issue_number);
      }
    }
  }

  private recordRoutingTransientRetries(transientRetriesConsumed: number): void {
    if (transientRetriesConsumed > 0) {
      this.telemetry.recordRetryOutcome('duplicate_judgment', 'transient', 'succeeded', transientRetriesConsumed);
    }
  }

  private async save(record: DecisionRecord): Promise<void> {
    record.updated_at = Date.now() / 1000;
    await this.port.saveDecisionRecord(record);
  }
}
