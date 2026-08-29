/**
 * Records every call it receives, mirroring FakeTriagePort's `calls` list
 * (../../reports/testing/fake-triage-port.ts), so telemetry-wiring tests can
 * assert on what PipelineService reported without a real prom-client
 * Registry or any network call.
 */

import { DuplicateTier, LlmCallUsage, Outcome, StageTiming } from '../../reports/types';
import { MetricsRegistry, RetryBudgetKind, RetryOutcomeKind, RetryStage, TelemetryRecorder } from '../telemetry-recorder.interface';

export interface RetryOutcomeCall {
  stage: RetryStage;
  budget: RetryBudgetKind;
  outcome: RetryOutcomeKind;
  attempts: number;
}

export interface DuplicateJudgmentSkippedCall {
  reportHash: string;
  candidateIssueNumber: number;
}

export interface LogStageCall {
  reportHash: string;
  stage: string;
  fields: Record<string, unknown>;
}

export class FakeTelemetryRecorder implements TelemetryRecorder {
  readonly registry: MetricsRegistry = { contentType: 'text/plain', metrics: () => Promise.resolve('') };

  retryOutcomes: RetryOutcomeCall[] = [];
  tokenUsages: LlmCallUsage[] = [];
  stageLatencies: StageTiming[] = [];
  outcomes: Outcome[] = [];
  duplicateVerdicts: DuplicateTier[] = [];
  duplicateJudgmentSkips: DuplicateJudgmentSkippedCall[] = [];
  logs: LogStageCall[] = [];

  recordRetryOutcome(stage: RetryStage, budget: RetryBudgetKind, outcome: RetryOutcomeKind, attempts: number): void {
    this.retryOutcomes.push({ stage, budget, outcome, attempts });
  }

  recordTokenUsage(usage: LlmCallUsage): void {
    this.tokenUsages.push(usage);
  }

  recordStageLatency(timing: StageTiming): void {
    this.stageLatencies.push(timing);
  }

  recordOutcome(outcome: Outcome): void {
    this.outcomes.push(outcome);
  }

  recordDuplicateVerdict(tier: DuplicateTier): void {
    this.duplicateVerdicts.push(tier);
  }

  recordDuplicateJudgmentSkipped(reportHash: string, candidateIssueNumber: number): void {
    this.duplicateJudgmentSkips.push({ reportHash, candidateIssueNumber });
  }

  logStage(reportHash: string, stage: string, fields: Record<string, unknown> = {}): void {
    this.logs.push({ reportHash, stage, fields });
  }
}
