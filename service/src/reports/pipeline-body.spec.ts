/**
 * F8 (scout-hire-audit-opus): redactSecrets() is applied to the raw-report
 * quote and supporting_evidence (both LLM-untouched reporter text landing
 * in a Gitea body) but not to decision.repro_steps or decision.title --
 * both are LLM-extracted text copied from the reporter's raw input, so a
 * credential narrated inside a repro step ("log in with password
 * hunter2xyz9") could reach Gitea unredacted through either channel.
 */

import { bugIssueBody } from './pipeline-body';
import { PipelineService } from './pipeline.service';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TriageDecision } from './types';

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: 'medium',
    components: ['backend'],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('bugIssueBody redaction', () => {
  it('redacts a secret narrated inside a repro step', () => {
    const body = bugIssueBody('raw report', decision({ repro_steps: ["Log in with password: hunter2xyz9", 'Click submit'] }));
    expect(body).not.toContain('hunter2xyz9');
    expect(body).toContain('[REDACTED]');
  });

  it('redacts a secret the model copied into the Gitea issue title', async () => {
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'Login fails with password: hunter2xyz9 on retry' })];

    await new PipelineService(port).processReport('raw report');

    const [title] = port.calls.find((c) => c.op === 'create_issue')!.args as [string, string, string[]];
    expect(title).not.toContain('hunter2xyz9');
    expect(title).toContain('[REDACTED]');
  });
});
