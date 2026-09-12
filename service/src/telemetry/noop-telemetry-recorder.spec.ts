import { NoopTelemetryRecorder } from './noop-telemetry-recorder';
import { TelemetryRecorder } from './telemetry-recorder.interface';

function newRecorder(): TelemetryRecorder {
  return new NoopTelemetryRecorder();
}

describe('NoopTelemetryRecorder', () => {
  it('exposes a registry with the expected prom-client content type and empty metrics output', async () => {
    const recorder = newRecorder();

    expect(recorder.registry.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
    await expect(recorder.registry.metrics()).resolves.toBe('');
  });

  it('recordRetryOutcome is a no-op regardless of arguments', () => {
    const recorder = newRecorder();

    expect(recorder.recordRetryOutcome('extraction', 'validation', 'succeeded', 1)).toBeUndefined();
    expect(
      recorder.recordRetryOutcome('duplicate_judgment', 'transient', 'exhausted', 3),
    ).toBeUndefined();
  });

  it('recordTokenUsage is a no-op', () => {
    const recorder = newRecorder();

    expect(
      recorder.recordTokenUsage({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      } as never),
    ).toBeUndefined();
  });

  it('recordStageLatency is a no-op', () => {
    const recorder = newRecorder();

    expect(
      recorder.recordStageLatency({ stage: 'extraction', durationMs: 42 } as never),
    ).toBeUndefined();
  });

  it('recordOutcome is a no-op', () => {
    const recorder = newRecorder();

    expect(recorder.recordOutcome('applied' as never)).toBeUndefined();
  });

  it('recordDuplicateVerdict is a no-op', () => {
    const recorder = newRecorder();

    expect(recorder.recordDuplicateVerdict('exact' as never)).toBeUndefined();
  });

  it('recordDuplicateJudgmentSkipped is a no-op', () => {
    const recorder = newRecorder();

    expect(recorder.recordDuplicateJudgmentSkipped('deadbeef', 123)).toBeUndefined();
  });

  it('logStage is a no-op, with and without extra fields', () => {
    const recorder = newRecorder();

    expect(recorder.logStage('deadbeef', 'extraction')).toBeUndefined();
    expect(recorder.logStage('deadbeef', 'extraction', { attempt: 2 })).toBeUndefined();
  });

  it('never touches the console or process output as a side effect', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recorder = newRecorder();

    recorder.recordRetryOutcome('extraction', 'validation', 'succeeded', 1);
    recorder.recordTokenUsage({} as never);
    recorder.recordStageLatency({} as never);
    recorder.recordOutcome('applied' as never);
    recorder.recordDuplicateVerdict('exact' as never);
    recorder.recordDuplicateJudgmentSkipped('deadbeef', 1);
    recorder.logStage('deadbeef', 'extraction');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
