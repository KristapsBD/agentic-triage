/** Ticket #28: clear bug report -> extraction -> new Gitea issue. */

import { PipelineService } from './pipeline.service';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TriageDecision } from './types';

function bugDecision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: 'low',
    components: ['unknown'],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('PipelineService (happy path)', () => {
  it('creates an issue with a concise title, severity, and component labels', async () => {
    const raw =
      'When I upload a profile picture larger than about 5MB, the page shows a ' +
      'spinner forever and the picture never saves. Tried an 8MB PNG and a 12MB ' +
      'JPEG, same result. Chrome on Windows. Smaller images work fine.';
    const decision = bugDecision({
      title: 'Profile picture upload hangs for files over ~5MB',
      severity: 'medium',
      components: ['frontend', 'backend'],
      repro_steps: [
        'Upload a profile picture larger than ~5MB (tested 8MB PNG, 12MB JPEG)',
        'Observe the page shows a spinner forever and the picture never saves',
      ],
    });
    const port = new FakeTriagePort();
    port.extractionQueue = [decision];

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(envelope.gitea_issue_number).not.toBeNull();
    const createCalls = port.calls.filter((c) => c.op === 'create_issue');
    expect(createCalls).toHaveLength(1);
    const [title, body, labels] = createCalls[0].args as [string, string, string[]];
    expect(title).toBe(decision.title);
    expect(new Set(labels)).toEqual(new Set(['medium', 'frontend', 'backend']));
    expect(body).toContain(raw);
    expect(body).toContain('spinner forever');
  });

  it('says so explicitly, never omitted, when no repro steps were narrated', async () => {
    const raw = 'Something is broken with orders sometimes.';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision({ title: 'Intermittent order failure', severity: 'medium' })];

    await new PipelineService(port).processReport(raw);

    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body).toContain('No reproduction steps provided.');
  });

  it('keeps supporting evidence distinct from repro steps', async () => {
    const raw = 'checkout dies sometimes, see attached log';
    const port = new FakeTriagePort();
    port.extractionQueue = [
      bugDecision({
        title: 'Checkout fails intermittently',
        severity: 'high',
        components: ['backend'],
        supporting_evidence: 'ERROR NullReferenceException in OrderService.Calculate() line 214',
      }),
    ];

    await new PipelineService(port).processReport(raw);

    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body).toContain('NullReferenceException');
    expect(body).toContain('No reproduction steps provided.');
  });

  it('passes the Raw Report to extract unmodified, with no feedback on the first attempt', async () => {
    const raw = 'the button does nothing';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];

    await new PipelineService(port).processReport(raw);

    const extractCall = port.calls.find((c) => c.op === 'extract')!;
    expect(extractCall.args[0]).toBe(raw);
    expect(extractCall.args[1]).toBeNull();
  });
});
