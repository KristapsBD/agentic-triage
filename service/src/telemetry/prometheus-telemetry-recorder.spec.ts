import { PrometheusTelemetryRecorder } from './prometheus-telemetry-recorder';

describe('PrometheusTelemetryRecorder', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('exposes zeroed metrics before any traffic', async () => {
    const recorder = new PrometheusTelemetryRecorder();
    const body = await recorder.registry.metrics();
    expect(body).toContain('triage_outcomes_total');
    expect(body).toContain('triage_duplicate_judgment_silent_skip_total');
  });

  it('reflects recorded traffic in the exposed registry', async () => {
    const recorder = new PrometheusTelemetryRecorder();

    recorder.recordOutcome('issue_created');
    recorder.recordDuplicateVerdict('clear_duplicate');
    recorder.recordTokenUsage({ call: 'extract', candidate_issue_number: null, input_tokens: 10, output_tokens: 5 });
    recorder.recordStageLatency({ stage: 'extraction', duration_ms: 42, candidate_issue_number: null });
    recorder.recordRetryOutcome('extraction', 'validation', 'succeeded', 1);
    recorder.recordDuplicateJudgmentSkipped('deadbeef', 7);

    const body = await recorder.registry.metrics();

    expect(body).toContain('triage_outcomes_total{outcome="issue_created"} 1');
    expect(body).toContain('triage_duplicate_verdict_total{tier="clear_duplicate"} 1');
    expect(body).toContain('triage_token_usage_total{call="extract",token_type="input"} 10');
    expect(body).toContain('triage_duplicate_judgment_silent_skip_total 1');
  });

  it('emits a structured JSON log line correlated by report_hash', () => {
    const recorder = new PrometheusTelemetryRecorder();

    recorder.logStage('abc123', 'extraction', { duration_ms: 5 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ report_hash: 'abc123', stage: 'extraction', duration_ms: 5 });
  });

  it('logs the silent-skip event alongside the counter', () => {
    const recorder = new PrometheusTelemetryRecorder();

    recorder.recordDuplicateJudgmentSkipped('abc123', 9);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ report_hash: 'abc123', stage: 'duplicate_judgment_silent_skip', candidate_issue_number: 9 });
  });
});
