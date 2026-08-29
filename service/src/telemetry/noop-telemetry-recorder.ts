/**
 * Production-safe default for PipelineService's `telemetry` constructor
 * parameter — same role DEFAULT_RETRY_BUDGETS plays for `settings`: only
 * used when PipelineService is constructed directly rather than through
 * Nest DI, which always resolves the real PrometheusTelemetryRecorder via
 * the TELEMETRY_RECORDER token. Does nothing, makes zero network calls.
 */

import { MetricsRegistry, TelemetryRecorder } from './telemetry-recorder.interface';

const EMPTY_REGISTRY: MetricsRegistry = {
  contentType: 'text/plain; version=0.0.4; charset=utf-8',
  metrics: () => Promise.resolve(''),
};

export class NoopTelemetryRecorder implements TelemetryRecorder {
  readonly registry = EMPTY_REGISTRY;

  recordRetryOutcome(): void {}
  recordTokenUsage(): void {}
  recordStageLatency(): void {}
  recordOutcome(): void {}
  recordDuplicateVerdict(): void {}
  recordDuplicateJudgmentSkipped(): void {}
  logStage(): void {}
}
