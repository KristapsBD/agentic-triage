import { FakeTelemetryRecorder } from './fake-telemetry-recorder';

describe('FakeTelemetryRecorder', () => {
  it('records every telemetry call it receives', async () => {
    const recorder = new FakeTelemetryRecorder();

    recorder.recordRetryOutcome('extraction', 'validation', 'succeeded', 1);
    recorder.recordTokenUsage({ call: 'extract', candidate_issue_number: null, input_tokens: 10, output_tokens: 5 });
    recorder.recordStageLatency({ stage: 'extraction', duration_ms: 42, candidate_issue_number: null });
    recorder.recordOutcome('issue_created');
    recorder.recordDuplicateVerdict('clear_duplicate');
    recorder.recordDuplicateJudgmentSkipped('abc123', 9);
    recorder.logStage('abc123', 'extraction', { duration_ms: 5 });

    expect(recorder.retryOutcomes).toEqual([{ stage: 'extraction', budget: 'validation', outcome: 'succeeded', attempts: 1 }]);
    expect(recorder.tokenUsages).toEqual([{ call: 'extract', candidate_issue_number: null, input_tokens: 10, output_tokens: 5 }]);
    expect(recorder.stageLatencies).toEqual([{ stage: 'extraction', duration_ms: 42, candidate_issue_number: null }]);
    expect(recorder.outcomes).toEqual(['issue_created']);
    expect(recorder.duplicateVerdicts).toEqual(['clear_duplicate']);
    expect(recorder.duplicateJudgmentSkips).toEqual([{ reportHash: 'abc123', candidateIssueNumber: 9 }]);
    expect(recorder.logs).toEqual([{ reportHash: 'abc123', stage: 'extraction', fields: { duration_ms: 5 } }]);
    await expect(recorder.registry.metrics()).resolves.toBe('');
    expect(recorder.registry.contentType).toBe('text/plain');
  });

  it('defaults logStage fields to an empty object when omitted', () => {
    const recorder = new FakeTelemetryRecorder();

    recorder.logStage('abc123', 'extraction');

    expect(recorder.logs).toEqual([{ reportHash: 'abc123', stage: 'extraction', fields: {} }]);
  });
});
