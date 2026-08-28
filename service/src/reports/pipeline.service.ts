/**
 * The seam other tickets build on — TS equivalent of app/pipeline.py's
 * process_report()/_route(). Depends only on TriagePort, never on
 * GiteaClient or any other provider directly, so tests can substitute one
 * FakeTriagePort to cover the whole pipeline (ticket #26's Testing
 * Decisions).
 *
 * Ticket #29 scope: every Report Type gets routed correctly (bug unchanged
 * from #28; feature_request filed under its own label; spam_or_off_topic
 * dropped with no Gitea issue; unclear filed needs-info). No duplicate
 * checking yet (bug path only, #30), no retries/unified Review Flag/
 * bundling (#31-#32), no Decision Record persistence (#33).
 */

import { Inject, Injectable } from '@nestjs/common';
import { FEATURE_REQUEST, NEEDS_INFO } from '../gitea/labels';
import { bugIssueBody, issueBody, reviewFlagBody } from './pipeline-body';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import { ResponseEnvelope, TriageDecision } from './types';

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
    const body = bugIssueBody(rawReport, decision);
    const labels = [decision.severity, ...decision.components];
    const issueNumber = await this.port.createIssue(decision.title, body, labels);
    return {
      outcome: 'issue_created',
      gitea_issue_number: issueNumber,
      triage_decision: decision,
      duplicate_verdict: null,
    };
  }
}
