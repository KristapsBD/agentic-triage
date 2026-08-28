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
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import { DecisionRecord, DuplicateVerdict, Outcome, PendingAction, ResponseEnvelope, TriageDecision } from './types';

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
}

const NO_ACTION: PendingAction = { type: 'none', title: null, body: null, labels: [], target_issue: null };

@Injectable()
export class PipelineService {
  constructor(
    @Inject(TRIAGE_PORT) private readonly port: TriagePort,
    @Inject(SETTINGS) private readonly settings: RetryBudgets = DEFAULT_RETRY_BUDGETS,
  ) {}

  async processReport(rawReport: string): Promise<ResponseEnvelope> {
    const reportHash = hashReport(rawReport);
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
      const outcome = await withRetryBudgets((feedback) => this.port.extract(rawReport, feedback), this.settings);

      if (outcome.failure === 'transient_exhausted') {
        throw new PipelineUnavailableError(reportHash, 'llm_unavailable', outcome.lastError ?? '');
      }
      if (outcome.failure === 'validation_exhausted') {
        const body = reviewFlagBody(rawReport, VALIDATION_FAILED_NOTE);
        record.pending_action = {
          type: 'create_issue',
          title: 'Automated triage failed for incoming report',
          body,
          labels: [NEEDS_TRIAGE],
          target_issue: null,
        };
        record.outcome = 'review_flagged';
        await this.save(record);
        return this.executePendingAction(record);
      }

      record.triage_decision = outcome.result as TriageDecision;
      await this.save(record);
    }

    const decision = record.triage_decision;

    if (record.pending_action === null) {
      const { action, outcome, verdict } = await this.route(decision, rawReport);
      record.pending_action = action;
      record.outcome = outcome;
      record.duplicate_verdict = verdict;
      await this.save(record);
    }

    return this.executePendingAction(record);
  }

  /**
   * Computes the Gitea action, outcome, and Duplicate Verdict (if any) for
   * an already-extracted Triage Decision. Pure w.r.t. Decision Record
   * state; only touches the port for listOpenIssues/findCandidates/
   * judgeDuplicate (read-only LLM/embedding calls), never a Gitea write.
   */
  private async route(decision: TriageDecision, rawReport: string): Promise<RoutingResult> {
    if (decision.report_type === 'spam_or_off_topic') {
      return { action: NO_ACTION, outcome: 'dropped_spam', verdict: null };
    }

    if (decision.report_type === 'feature_request') {
      const body = issueBody(rawReport, `**Report Type:** feature_request\n\n${decision.title}`);
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [FEATURE_REQUEST], target_issue: null };
      return { action, outcome: 'feature_request_filed', verdict: null };
    }

    if (decision.report_type === 'unclear') {
      const verdict = await findDuplicateVerdict(this.port, rawReport, this.settings);
      const body = reviewFlagBody(rawReport, UNCLEAR_REASON, duplicateCrossLinkNote(verdict));
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_INFO], target_issue: null };
      return { action, outcome: 'review_flagged', verdict };
    }

    // report_type === 'bug' from here down.
    if (decision.severity === null) {
      throw new Error('bug reports always get a severity from the extraction schema');
    }

    if (isBundled(decision)) {
      return this.routeBundled(decision, rawReport);
    }

    const verdict = await findDuplicateVerdict(this.port, rawReport, this.settings);

    if (verdict.tier === 'clear_duplicate') {
      const body = duplicateCommentBody(rawReport, verdict.rationale);
      const action: PendingAction = { type: 'comment', title: null, body, labels: [], target_issue: verdict.target_issue };
      return { action, outcome: 'duplicate_commented', verdict };
    }

    if (verdict.tier === 'possible_duplicate') {
      const reason =
        `Duplicate check found a possible match to #${verdict.target_issue} but didn't clear the ` +
        `auto-comment bar (${verdict.rationale}). Filed as a new issue, cross-linked, rather than ` +
        'risking a false merge.';
      const body = reviewFlagBody(rawReport, reason, `### Possible duplicate\n\nSee #${verdict.target_issue}.`);
      const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_TRIAGE], target_issue: null };
      return { action, outcome: 'review_flagged', verdict };
    }

    const body = bugIssueBody(rawReport, decision);
    const labels = [decision.severity, ...decision.components];
    const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels, target_issue: null };
    return { action, outcome: 'issue_created', verdict };
  }

  private async routeBundled(decision: TriageDecision, rawReport: string): Promise<RoutingResult> {
    const verdict = await findDuplicateVerdict(this.port, rawReport, this.settings);
    const listing = decision.distinct_issues.map((issue) => `- ${issue}`).join('\n');
    const reason =
      `Report describes what looks like ${decision.distinct_issues.length} distinct ` +
      "issues, not auto-splitting — a human should decide how to split this.";
    const extra = [`### Distinct issues identified\n\n${listing}`, duplicateCrossLinkNote(verdict)]
      .filter((part) => part.trim())
      .join('\n\n');
    const body = reviewFlagBody(rawReport, reason, extra);
    const action: PendingAction = { type: 'create_issue', title: decision.title, body, labels: [NEEDS_TRIAGE], target_issue: null };
    return { action, outcome: 'review_flagged', verdict };
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
        record.gitea_issue_number = await this.port.createIssue(action.title, action.body, action.labels);
      } else if (action.type === 'comment') {
        if (action.target_issue === null || action.body === null) {
          throw new Error('comment action missing target_issue/body');
        }
        await this.port.commentIssue(action.target_issue, action.body);
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
    };
  }

  private envelopeOf(record: DecisionRecord): ResponseEnvelope {
    if (record.outcome === null) {
      throw new Error('envelopeOf called before an outcome was decided');
    }
    return {
      outcome: record.outcome,
      gitea_issue_number: record.gitea_issue_number,
      triage_decision: record.triage_decision,
      duplicate_verdict: record.duplicate_verdict,
    };
  }

  private async save(record: DecisionRecord): Promise<void> {
    record.updated_at = Date.now() / 1000;
    await this.port.saveDecisionRecord(record);
  }
}
