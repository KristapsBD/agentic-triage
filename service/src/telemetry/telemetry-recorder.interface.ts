/**
 * The observability seam, mirroring how TriagePort is the single seam for
 * Gitea/LLM/embedding calls (see reports/triage-port.interface.ts): every
 * counter/histogram/log line PipelineService emits goes through this one
 * interface, injected alongside TriagePort (ticket #41). Tests substitute
 * FakeTelemetryRecorder (testing/fake-telemetry-recorder.ts); production
 * wires PrometheusTelemetryRecorder, whose Registry backs GET /metrics
 * (MetricsController).
 */

import { DuplicateTier, LlmCallUsage, Outcome, StageTiming } from '../reports/types';

export const TELEMETRY_RECORDER = Symbol('TELEMETRY_RECORDER');

export type RetryStage = 'extraction' | 'duplicate_judgment';
export type RetryBudgetKind = 'validation' | 'transient';
export type RetryOutcomeKind = 'succeeded' | 'exhausted';

// Just enough of prom-client's Registry surface for MetricsController to
// serve GET /metrics, so the fake/no-op recorders don't need a real
// prom-client Registry to satisfy the interface.
export interface MetricsRegistry {
  readonly contentType: string;
  metrics(): Promise<string>;
}

export interface TelemetryRecorder {
  readonly registry: MetricsRegistry;
  recordRetryOutcome(
    stage: RetryStage,
    budget: RetryBudgetKind,
    outcome: RetryOutcomeKind,
    attempts: number,
  ): void;
  recordTokenUsage(usage: LlmCallUsage): void;
  recordStageLatency(timing: StageTiming): void;
  recordOutcome(outcome: Outcome): void;
  recordDuplicateVerdict(tier: DuplicateTier): void;
  // Ticket #41: the known findDuplicateVerdict silent-skip path (a
  // candidate's duplicate judgment exhausts its validation retry budget and
  // is dropped rather than judged) previously left no trace anywhere.
  recordDuplicateJudgmentSkipped(reportHash: string, candidateIssueNumber: number): void;
  // Structured JSON log line for one pipeline stage, correlated by
  // report_hash so a request's flow can be tailed live.
  logStage(reportHash: string, stage: string, fields?: Record<string, unknown>): void;
}
