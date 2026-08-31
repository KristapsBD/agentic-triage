/** Ticket #28: clear bug report -> extraction -> new Gitea issue. */

import { PipelineService } from './pipeline.service';
import { ExtractionValidationError } from './pipeline.errors';
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

describe('PipelineService (Ticket #38: Confidence)', () => {
  it('reports high confidence for a clean extraction with no retries or ambiguity', async () => {
    const raw = 'clean report, no ambiguity';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.candidatesByReport.set(raw, []);

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.confidence).toBe('high');
  });

  it('persists confidence on the Decision Record so a repeated POST returns the same value without recomputation', async () => {
    const raw = 'idempotent confidence check';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.candidatesByReport.set(raw, []);

    const first = await new PipelineService(port).processReport(raw);
    const second = await new PipelineService(port).processReport(raw);

    expect(second.confidence).toBe(first.confidence);
    expect(port.calls.filter((c) => c.op === 'extract')).toHaveLength(1);
  });

  it('downgrades confidence once a validation retry was consumed during extraction', async () => {
    const raw = 'needed a retry to extract';
    const port = new FakeTriagePort();
    const budgets = { validation_retry_budget: 2, transient_retry_budget: 3, transient_retry_backoff_seconds: 0, duplicate_similarity_floor: 0.35 };
    port.extractionQueue = [new ExtractionValidationError('bad'), bugDecision()];
    port.candidatesByReport.set(raw, []);

    const envelope = await new PipelineService(port, budgets).processReport(raw);

    expect(envelope.confidence).toBe('medium');
  });

  it('floors confidence at low once the validation budget is exhausted on extraction', async () => {
    const raw = 'malformed forever';
    const port = new FakeTriagePort();
    const budgets = { validation_retry_budget: 2, transient_retry_budget: 3, transient_retry_backoff_seconds: 0, duplicate_similarity_floor: 0.35 };
    port.extractionQueue = [new ExtractionValidationError('bad 1'), new ExtractionValidationError('bad 2'), new ExtractionValidationError('bad 3')];

    const envelope = await new PipelineService(port, budgets).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    expect(envelope.confidence).toBe('low');
    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body).toContain('**Confidence:** low');
  });

  it('caps confidence at medium for a possible duplicate even with a clean extraction', async () => {
    const raw = 'looks kind of like an existing bug';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.6 }]);
    port.judgmentsByCandidate.set(1, { same_bug: 'possibly', rationale: 'similar area' });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    expect(envelope.confidence).toBe('medium');
  });

  it('includes the Confidence band and reason on a Review Flagged Gitea issue body', async () => {
    const raw = 'the export thing is timing out again';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision({ report_type: 'unclear', severity: null, components: [] })];
    port.candidatesByReport.set(raw, []);

    await new PipelineService(port).processReport(raw);

    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body).toContain('**Confidence:**');
  });
});
