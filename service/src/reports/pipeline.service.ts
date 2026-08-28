/**
 * The seam other tickets build on — TS equivalent of app/pipeline.py's
 * process_report()/_route(). Depends only on TriagePort, never on
 * GiteaClient or any other provider directly, so tests can substitute one
 * FakeTriagePort to cover the whole pipeline (ticket #26's Testing
 * Decisions).
 *
 * Ticket #30 scope adds: the bug path now checks for a Duplicate Candidate
 * before creating a fresh issue (three-tier verdict, ADR-0005) — a clear
 * duplicate comments on the existing issue instead of creating a new one; a
 * possible duplicate still creates a new issue but cross-linked and
 * Review Flagged; not_a_duplicate is the #29 behavior unchanged. No retries
 * yet (#31), no duplicate check on the unclear/bundled paths yet (#32), no
 * Decision Record persistence yet (#33).
 */

import { Inject, Injectable } from '@nestjs/common';
import { NEEDS_TRIAGE, FEATURE_REQUEST, NEEDS_INFO } from '../gitea/labels';
import { findDuplicateVerdict } from './duplicate-verdict';
import { bugIssueBody, duplicateCommentBody, issueBody, reviewFlagBody } from './pipeline-body';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import { DuplicateVerdict, ResponseEnvelope, TriageDecision } from './types';

const UNCLEAR_REASON =
  "Report Type was classified as unclear — there's a real signal here but not " +
  'enough detail to safely extract severity/components, so this was routed to a ' +
  'human rather than discarded.';

@Injectable()
export class PipelineService {
  constructor(@Inject(TRIAGE_PORT) private readonly port: TriagePort) {}

  async processReport(rawReport: string): Promise<ResponseEnvelope> {
    const decision = await this.port.extract(rawReport, null);

    switch (decision.report_type) {
      case 'spam_or_off_topic':
        return this.dropped(decision);
      case 'feature_request':
        return this.filedAsFeatureRequest(rawReport, decision);
      case 'unclear':
        return this.filedNeedsInfo(rawReport, decision);
      case 'bug':
        return this.filedAsBug(rawReport, decision);
    }
  }

  private dropped(decision: TriageDecision): ResponseEnvelope {
    return { outcome: 'dropped_spam', gitea_issue_number: null, triage_decision: decision, duplicate_verdict: null };
  }

  private async filedAsFeatureRequest(rawReport: string, decision: TriageDecision): Promise<ResponseEnvelope> {
    const body = issueBody(rawReport, `**Report Type:** feature_request\n\n${decision.title}`);
    const issueNumber = await this.port.createIssue(decision.title, body, [FEATURE_REQUEST]);
    return {
      outcome: 'feature_request_filed',
      gitea_issue_number: issueNumber,
      triage_decision: decision,
      duplicate_verdict: null,
    };
  }

  private async filedNeedsInfo(rawReport: string, decision: TriageDecision): Promise<ResponseEnvelope> {
    const body = reviewFlagBody(rawReport, UNCLEAR_REASON);
    const issueNumber = await this.port.createIssue(decision.title, body, [NEEDS_INFO]);
    return {
      outcome: 'review_flagged',
      gitea_issue_number: issueNumber,
      triage_decision: decision,
      duplicate_verdict: null,
    };
  }

  private async filedAsBug(rawReport: string, decision: TriageDecision): Promise<ResponseEnvelope> {
    if (decision.severity === null) {
      throw new Error('bug reports always get a severity from the extraction schema');
    }

    const verdict = await findDuplicateVerdict(this.port, rawReport);

    if (verdict.tier === 'clear_duplicate') {
      const body = duplicateCommentBody(rawReport, verdict.rationale);
      await this.port.commentIssue(verdict.target_issue as number, body);
      return {
        outcome: 'duplicate_commented',
        gitea_issue_number: verdict.target_issue,
        triage_decision: decision,
        duplicate_verdict: verdict,
      };
    }

    if (verdict.tier === 'possible_duplicate') {
      const issueNumber = await this.createPossibleDuplicateIssue(rawReport, decision, verdict);
      return {
        outcome: 'review_flagged',
        gitea_issue_number: issueNumber,
        triage_decision: decision,
        duplicate_verdict: verdict,
      };
    }

    const body = bugIssueBody(rawReport, decision);
    const labels = [decision.severity, ...decision.components];
    const issueNumber = await this.port.createIssue(decision.title, body, labels);
    return {
      outcome: 'issue_created',
      gitea_issue_number: issueNumber,
      triage_decision: decision,
      duplicate_verdict: verdict,
    };
  }

  private async createPossibleDuplicateIssue(
    rawReport: string,
    decision: TriageDecision,
    verdict: DuplicateVerdict,
  ): Promise<number> {
    const reason =
      `Duplicate check found a possible match to #${verdict.target_issue} but didn't clear the ` +
      `auto-comment bar (${verdict.rationale}). Filed as a new issue, cross-linked, rather than ` +
      'risking a false merge.';
    const body = reviewFlagBody(rawReport, reason, `### Possible duplicate\n\nSee #${verdict.target_issue}.`);
    return this.port.createIssue(decision.title, body, [NEEDS_TRIAGE]);
  }
}
