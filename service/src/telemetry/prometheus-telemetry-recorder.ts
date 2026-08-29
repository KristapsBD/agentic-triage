/**
 * Real TelemetryRecorder: prom-client counters/histograms plus one JSON log
 * line per pipeline stage, matching the existing Fastify/Nest platform's
 * stdout-JSON logging convention. `registry` backs MetricsController's
 * GET /metrics (text-exposition format via `registry.metrics()`).
 */

import { Counter, Histogram, Registry } from 'prom-client';
import { DuplicateTier, LlmCallUsage, Outcome, StageTiming } from '../reports/types';
import { RetryBudgetKind, RetryOutcomeKind, RetryStage, TelemetryRecorder } from './telemetry-recorder.interface';

export class PrometheusTelemetryRecorder implements TelemetryRecorder {
  readonly registry = new Registry();

  private readonly retryOutcomes = new Counter({
    name: 'triage_retry_outcomes_total',
    help: 'Retry budget outcomes per pipeline stage',
    labelNames: ['stage', 'budget', 'outcome'],
    registers: [this.registry],
  });

  private readonly retryAttempts = new Histogram({
    name: 'triage_retry_attempts',
    help: 'Attempts consumed per retry budget outcome',
    labelNames: ['stage', 'budget'],
    buckets: [1, 2, 3, 5, 8],
    registers: [this.registry],
  });

  private readonly tokenUsage = new Counter({
    name: 'triage_token_usage_total',
    help: 'LLM token usage by call type and direction',
    labelNames: ['call', 'token_type'],
    registers: [this.registry],
  });

  private readonly stageDuration = new Histogram({
    name: 'triage_stage_duration_ms',
    help: 'Per-stage pipeline latency in milliseconds',
    labelNames: ['stage'],
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [this.registry],
  });

  private readonly outcomes = new Counter({
    name: 'triage_outcomes_total',
    help: 'Pipeline outcome distribution',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly duplicateVerdicts = new Counter({
    name: 'triage_duplicate_verdict_total',
    help: 'Duplicate Verdict tier distribution',
    labelNames: ['tier'],
    registers: [this.registry],
  });

  private readonly duplicateJudgmentSilentSkips = new Counter({
    name: 'triage_duplicate_judgment_silent_skip_total',
    help: 'Duplicate Candidates whose judgment exhausted its validation retry budget and was silently skipped',
    registers: [this.registry],
  });

  recordRetryOutcome(stage: RetryStage, budget: RetryBudgetKind, outcome: RetryOutcomeKind, attempts: number): void {
    this.retryOutcomes.labels(stage, budget, outcome).inc();
    this.retryAttempts.labels(stage, budget).observe(attempts);
  }

  recordTokenUsage(usage: LlmCallUsage): void {
    this.tokenUsage.labels(usage.call, 'input').inc(usage.input_tokens);
    this.tokenUsage.labels(usage.call, 'output').inc(usage.output_tokens);
  }

  recordStageLatency(timing: StageTiming): void {
    this.stageDuration.labels(timing.stage).observe(timing.duration_ms);
  }

  recordOutcome(outcome: Outcome): void {
    this.outcomes.labels(outcome).inc();
  }

  recordDuplicateVerdict(tier: DuplicateTier): void {
    this.duplicateVerdicts.labels(tier).inc();
  }

  recordDuplicateJudgmentSkipped(reportHash: string, candidateIssueNumber: number): void {
    this.duplicateJudgmentSilentSkips.inc();
    this.logStage(reportHash, 'duplicate_judgment_silent_skip', { candidate_issue_number: candidateIssueNumber });
  }

  logStage(reportHash: string, stage: string, fields: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ level: 'info', time: Date.now(), report_hash: reportHash, stage, ...fields }));
  }
}
