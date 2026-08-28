/**
 * The seam other tickets build on — TS equivalent of app/pipeline.py's
 * process_report(). Depends only on TriagePort, never on GiteaClient or any
 * other provider directly, so tests can substitute one FakeTriagePort to
 * cover the whole pipeline (ticket #26's Testing Decisions).
 *
 * Ticket #28 scope only: a bug-typed Raw Report is extracted and turned into
 * a Gitea issue. No duplicate checking, retries, Review Flags, or Decision
 * Record persistence yet — those are filled in by #29-#34.
 */

import { Inject, Injectable } from '@nestjs/common';
import { bugIssueBody } from './pipeline-body';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';
import { ResponseEnvelope } from './types';

@Injectable()
export class PipelineService {
  constructor(@Inject(TRIAGE_PORT) private readonly port: TriagePort) {}

  async processReport(rawReport: string): Promise<ResponseEnvelope> {
    const decision = await this.port.extract(rawReport, null);

    if (decision.report_type !== 'bug') {
      throw new Error(`report_type "${decision.report_type}" routing is not implemented yet (ticket #29)`);
    }
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
