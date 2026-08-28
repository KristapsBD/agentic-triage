/** Ticket #33: Decision Record persistence and retry-safe POST. Mirrors tests/test_idempotency.py. */

import { hashReport } from './pipeline-body';
import { PipelineService } from './pipeline.service';
import { PipelineUnavailableError } from './pipeline.errors';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TransientAPIError } from './pipeline.errors';
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

describe('PipelineService idempotency', () => {
  it('persists a Decision Record, including for a dropped-spam outcome', async () => {
    const raw = 'spam spam spam';
    const port = new FakeTriagePort();
    port.extractionQueue = [{ title: 'n/a', report_type: 'spam_or_off_topic', severity: null, components: [], repro_steps: null, supporting_evidence: null, distinct_issues: [] }];

    await new PipelineService(port).processReport(raw);

    const record = await port.getDecisionRecord(hashReport(raw));
    expect(record).not.toBeNull();
    expect(record!.status).toBe('completed');
    expect(record!.outcome).toBe('dropped_spam');
  });

  it('returns the prior result on a repeated POST without re-running the LLM', async () => {
    const raw = 'some report';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];

    const first = await new PipelineService(port).processReport(raw);
    const extractCallsAfterFirst = port.calls.filter((c) => c.op === 'extract').length;
    const createCallsAfterFirst = port.calls.filter((c) => c.op === 'create_issue').length;

    const second = await new PipelineService(port).processReport(raw);

    expect(second).toEqual(first);
    expect(port.calls.filter((c) => c.op === 'extract').length).toBe(extractCallsAfterFirst);
    expect(port.calls.filter((c) => c.op === 'create_issue').length).toBe(createCallsAfterFirst);
  });

  it('leaves a resumable state on a Gitea failure after extraction, then resumes without re-running the LLM', async () => {
    const raw = 'some report';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.createIssueShouldFail = true;

    await expect(new PipelineService(port).processReport(raw)).rejects.toThrow(PipelineUnavailableError);

    const record = await port.getDecisionRecord(hashReport(raw));
    expect(record!.status).toBe('gitea_call_failed');
    expect(record!.triage_decision).not.toBeNull();

    port.createIssueShouldFail = false;
    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(port.calls.filter((c) => c.op === 'extract').length).toBe(1);
  });

  it('carries the report hash on a PipelineUnavailableError for safe retry', async () => {
    const raw = 'flaky';
    const port = new FakeTriagePort();
    port.extractionQueue = Array(4).fill(new TransientAPIError('boom'));

    await expect(new PipelineService(port).processReport(raw)).rejects.toMatchObject({
      reportHash: hashReport(raw),
    });
  });

  it('GiteaError from a comment (clear duplicate) also leaves a resumable state', async () => {
    const raw = 'dup report';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.candidatesByReport.set(raw, [{ issue_number: 101, title: 'existing', body: 'b', similarity: 0.9 }]);
    port.judgmentsByCandidate.set(101, { same_bug: 'yes', rationale: 'same crash' });
    port.commentShouldFail = true;

    await expect(new PipelineService(port).processReport(raw)).rejects.toThrow(PipelineUnavailableError);
    const record = await port.getDecisionRecord(hashReport(raw));
    expect(record!.status).toBe('gitea_call_failed');
    expect(record!.pending_action?.type).toBe('comment');

    port.commentShouldFail = false;
    const envelope = await new PipelineService(port).processReport(raw);
    expect(envelope.outcome).toBe('duplicate_commented');
    expect(port.calls.filter((c) => c.op === 'extract').length).toBe(1);
    expect(port.calls.filter((c) => c.op === 'find_candidates').length).toBe(1);
  });

  it('GiteaError surfaces as PipelineUnavailableError with error_code gitea_unavailable', async () => {
    const raw = 'boom on gitea';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.createIssueShouldFail = true;

    try {
      await new PipelineService(port).processReport(raw);
      throw new Error('expected PipelineUnavailableError');
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineUnavailableError);
      expect((e as PipelineUnavailableError).errorCode).toBe('gitea_unavailable');
    }
  });
});
