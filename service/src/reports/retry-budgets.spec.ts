/** Ticket #31: validation vs transient retry budgets, independent (ADR-0008). Mirrors tests/test_retry_budgets.py. */

import { PipelineService, PipelineSettings } from './pipeline.service';
import { PipelineUnavailableError, ExtractionValidationError, TransientAPIError } from './pipeline.errors';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TriageDecision } from './types';
import { FakeTelemetryRecorder } from '../telemetry/testing/fake-telemetry-recorder';

const SETTINGS: PipelineSettings = {
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 0,
  duplicate_similarity_floor: 0.35,
};

function decision(): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: 'low',
    components: ['unknown'],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
  };
}

describe('PipelineService retry budgets', () => {
  it('retries a validation failure with feedback, then succeeds', async () => {
    const raw = 'some report';
    const port = new FakeTriagePort();
    port.extractionQueue = [new ExtractionValidationError('components: value is not a valid enumeration member'), decision()];

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    const extractCalls = port.calls.filter((c) => c.op === 'extract');
    expect(extractCalls).toHaveLength(2);
    expect(extractCalls[0].args[1]).toBeNull();
    expect(extractCalls[1].args[1] as string).toContain('enumeration');
  });

  it('retries a transient failure with the identical request, then succeeds', async () => {
    const raw = 'some report';
    const port = new FakeTriagePort();
    port.extractionQueue = [new TransientAPIError('rate limited'), decision()];

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    const extractCalls = port.calls.filter((c) => c.op === 'extract');
    expect(extractCalls).toHaveLength(2);
    expect(extractCalls[0].args[0]).toBe(raw);
    expect(extractCalls[1].args[0]).toBe(raw);
    expect(extractCalls[1].args[1]).toBeNull();
  });

  it('creates a needs-triage issue, not a crash, once the validation budget is exhausted', async () => {
    const raw = 'malformed forever';
    const port = new FakeTriagePort();
    port.extractionQueue = [
      new ExtractionValidationError('bad 1'),
      new ExtractionValidationError('bad 2'),
      new ExtractionValidationError('bad 3'),
    ];

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    const createCall = port.calls.find((c) => c.op === 'create_issue')!;
    const [, body, labels] = createCall.args as [string, string, string[]];
    expect(labels).toContain('needs-triage');
    expect(body.toLowerCase()).toContain('automated triage failed');
    expect(body).toContain(raw);
  });

  it('does not misattribute transient exhaustion as a validation failure', async () => {
    const raw = 'flaky infra';
    const port = new FakeTriagePort();
    port.extractionQueue = Array.from({ length: SETTINGS.transient_retry_budget + 1 }, () => new TransientAPIError('boom'));

    await expect(new PipelineService(port, SETTINGS).processReport(raw)).rejects.toThrow(PipelineUnavailableError);
    expect(port.calls.some((c) => c.op === 'create_issue' || c.op === 'comment_issue')).toBe(false);
  });

  it('keeps validation and transient budgets from exhausting each other when both occur within budget', async () => {
    const raw = 'mixed failures';
    const port = new FakeTriagePort();
    port.extractionQueue = [new ExtractionValidationError('bad'), new TransientAPIError('boom'), decision()];

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(port.calls.filter((c) => c.op === 'extract')).toHaveLength(3);
  });

  it('applies the same two retry budgets to the duplicate-judgment call', async () => {
    const raw = 'looks like an existing bug';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.8 }]);
    port.judgeDuplicateQueueByCandidate.set(1, [
      new ExtractionValidationError('same_bug: invalid enum value'),
      { same_bug: 'yes', rationale: 'same root cause' },
    ]);

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('duplicate_commented');
    const judgeCalls = port.calls.filter((c) => c.op === 'judge_duplicate');
    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[0].args[2]).toBeNull();
    expect(judgeCalls[1].args[2] as string).toContain('invalid enum value');
  });

  it('skips a candidate whose judgment exhausts its validation budget rather than crashing', async () => {
    const raw = 'ambiguous match';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.8 }]);
    port.judgeDuplicateQueueByCandidate.set(1, [
      new ExtractionValidationError('bad 1'),
      new ExtractionValidationError('bad 2'),
      new ExtractionValidationError('bad 3'),
    ]);

    const envelope = await new PipelineService(port, SETTINGS).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(envelope.duplicate_verdict?.tier).toBe('not_a_duplicate');
  });

  it('records exactly one silent-skip telemetry increment when a candidate judgment exhausts its validation budget', async () => {
    const raw = 'ambiguous match';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.8 }]);
    port.judgeDuplicateQueueByCandidate.set(1, [
      new ExtractionValidationError('bad 1'),
      new ExtractionValidationError('bad 2'),
      new ExtractionValidationError('bad 3'),
    ]);
    const telemetry = new FakeTelemetryRecorder();

    const envelope = await new PipelineService(port, SETTINGS, telemetry).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(envelope.duplicate_verdict?.tier).toBe('not_a_duplicate');
    expect(telemetry.duplicateJudgmentSkips).toEqual([{ reportHash: expect.any(String), candidateIssueNumber: 1 }]);
  });

  it('surfaces transient exhaustion on a duplicate-judgment call as PipelineUnavailableError', async () => {
    const raw = 'flaky infra during dedup';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.8 }]);
    port.judgeDuplicateQueueByCandidate.set(
      1,
      Array.from({ length: SETTINGS.transient_retry_budget + 1 }, () => new TransientAPIError('boom')),
    );

    await expect(new PipelineService(port, SETTINGS).processReport(raw)).rejects.toThrow(PipelineUnavailableError);
    expect(port.calls.some((c) => c.op === 'create_issue' || c.op === 'comment_issue')).toBe(false);
  });
});
