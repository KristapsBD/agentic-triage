/**
 * Ticket #41: PipelineService reports through TelemetryRecorder. Uses
 * FakeTelemetryRecorder (../telemetry/testing/fake-telemetry-recorder.ts)
 * the same way every other pipeline test uses FakeTriagePort — no
 * prom-client Registry or network call involved.
 */

import { ExtractionValidationError } from './pipeline.errors';
import { PipelineService, PipelineSettings } from './pipeline.service';
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

describe('PipelineService telemetry wiring', () => {
  it('reports the outcome, stage latencies, and token usage for a plain issue_created run', async () => {
    const raw = 'a fresh bug report';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.extractionUsageQueue = [{ input_tokens: 12, output_tokens: 34 }];
    const telemetry = new FakeTelemetryRecorder();

    const envelope = await new PipelineService(port, SETTINGS, telemetry).processReport(raw);

    expect(envelope.outcome).toBe('issue_created');
    expect(telemetry.outcomes).toEqual(['issue_created']);
    expect(telemetry.tokenUsages).toContainEqual({ call: 'extract', candidate_issue_number: null, input_tokens: 12, output_tokens: 34 });
    expect(telemetry.duplicateVerdicts).toEqual(['not_a_duplicate']);
    const stages = telemetry.stageLatencies.map((t) => t.stage);
    expect(stages).toContain('extraction');
    expect(stages).toContain('gitea_create_issue');
    expect(telemetry.logs.some((l) => l.stage === 'extraction' && l.reportHash)).toBe(true);
  });

  it('increments the dedicated silent-skip counter when a candidate judgment exhausts its validation budget', async () => {
    const raw = 'ambiguous match';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision()];
    port.candidatesByReport.set(raw, [{ issue_number: 1, title: 'existing', body: '...', similarity: 0.8, labels: [] }]);
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

  it('reports a review_flagged outcome when the extraction validation budget is exhausted', async () => {
    const raw = 'garbled input';
    const port = new FakeTriagePort();
    port.extractionQueue = [
      new ExtractionValidationError('bad 1'),
      new ExtractionValidationError('bad 2'),
      new ExtractionValidationError('bad 3'),
    ];
    const telemetry = new FakeTelemetryRecorder();

    const envelope = await new PipelineService(port, SETTINGS, telemetry).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    expect(telemetry.outcomes).toEqual(['review_flagged']);
    expect(
      telemetry.retryOutcomes.some((r) => r.stage === 'extraction' && r.budget === 'validation' && r.outcome === 'exhausted'),
    ).toBe(true);
  });
});
