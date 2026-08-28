/** Ticket #29: feature requests, spam/off-topic, and unclear reports routed off the bug path. */

import { FEATURE_REQUEST } from '../gitea/labels';
import { PipelineService } from './pipeline.service';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TriageDecision } from './types';

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: null,
    components: [],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('PipelineService (report type routing)', () => {
  it('files a feature_request under a distinct label, never severity/component fields', async () => {
    const raw =
      'It would be really nice if we could export reports to PDF as well as CSV. ' +
      'A lot of our customers ask for this.';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'Export reports to PDF', report_type: 'feature_request' })];

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('feature_request_filed');
    const createCall = port.calls.find((c) => c.op === 'create_issue')!;
    const [, , labels] = createCall.args as [string, string, string[]];
    expect(labels).toEqual([FEATURE_REQUEST]);
  });

  it('drops spam/off-topic with no Gitea issue at all', async () => {
    const raw = 'buy cheap watches now www.totally-not-spam.example';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'n/a', report_type: 'spam_or_off_topic' })];

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('dropped_spam');
    expect(envelope.gitea_issue_number).toBeNull();
    expect(port.calls.some((c) => c.op === 'create_issue' || c.op === 'comment_issue')).toBe(false);
  });

  it('classifies report type from a single extraction call, no second round trip', async () => {
    const raw = 'export to PDF please';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'Export to PDF', report_type: 'feature_request' })];

    await new PipelineService(port).processReport(raw);

    expect(port.calls.filter((c) => c.op === 'extract')).toHaveLength(1);
  });

  it('files an unclear/low-signal report as needs-info rather than discarding it', async () => {
    const raw = 'the reports thing is broken again pls fix';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'Reports feature broken (vague report)', report_type: 'unclear' })];

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    expect(envelope.gitea_issue_number).not.toBeNull();
    const createCall = port.calls.find((c) => c.op === 'create_issue')!;
    const [, body, labels] = createCall.args as [string, string, string[]];
    expect(labels).toEqual(['needs-info']);
    expect(body).toContain(raw);
    expect(body.toLowerCase()).toContain('why this needs review');
  });
});
