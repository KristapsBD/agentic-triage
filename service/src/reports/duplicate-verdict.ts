/**
 * Duplicate Candidate retrieval + per-candidate judgment, producing the
 * three-tier Duplicate Verdict (ADR-0005). Mirrors app/pipeline.py's
 * _find_duplicate_verdict()/_judge_duplicate_with_retry(). Ticket #30 scope:
 * called from the bug path only; #32 extends this to the unclear/bundled
 * paths too.
 *
 * Ticket #31: the same two retry budgets (ADR-0008) that guard extraction
 * also guard each judge_duplicate call. A validation failure that never
 * self-corrects degrades to "skip this candidate" — safe, since the worst
 * case is a missed duplicate, never a false merge — rather than crashing
 * the whole request. Transient exhaustion still surfaces as
 * PipelineUnavailableError, same as extraction.
 *
 * Ticket #40: alongside the winning verdict, also returns the full evidence
 * trail — every candidate considered (not just the winner), token usage per
 * successful judgment call, and per-stage timings — for the Decision
 * Record. A validation-exhausted (silently skipped) candidate is still
 * recorded, with same_bug: null, since it has no usage to report (retry.ts
 * only surfaces the result of a successful attempt, not per-attempt usage).
 */

import { hashReport } from './pipeline-body';
import { PipelineUnavailableError } from './pipeline.errors';
import { redactSecrets } from './redaction';
import { RetryBudgets, withRetryBudgets } from './retry';
import { TriagePort } from './triage-port.interface';
import { DuplicateCandidate, DuplicateCandidateConsidered, DuplicateJudgment, DuplicateVerdict, LlmCallUsage, StageTiming } from './types';

const NOT_A_DUPLICATE: DuplicateVerdict = { tier: 'not_a_duplicate', target_issue: null, similarity: null, rationale: '' };

export interface DuplicateDetectionResult {
  verdict: DuplicateVerdict;
  candidatesConsidered: DuplicateCandidateConsidered[];
  tokenUsage: LlmCallUsage[];
  stageTimings: StageTiming[];
  transientRetriesConsumed: number;
}

export async function findDuplicateVerdict(
  port: TriagePort,
  rawReport: string,
  budgets: RetryBudgets,
): Promise<DuplicateDetectionResult> {
  const stageTimings: StageTiming[] = [];
  const tokenUsage: LlmCallUsage[] = [];
  const candidatesConsidered: DuplicateCandidateConsidered[] = [];
  let transientRetriesConsumed = 0;

  let stageStart = Date.now();
  const openIssues = await port.listOpenIssues();
  stageTimings.push({ stage: 'gitea_list_open_issues', duration_ms: Date.now() - stageStart, candidate_issue_number: null });

  stageStart = Date.now();
  const candidates = await port.findCandidates(rawReport, openIssues);
  stageTimings.push({ stage: 'embedding_retrieval', duration_ms: Date.now() - stageStart, candidate_issue_number: null });

  if (candidates.length === 0) {
    return { verdict: NOT_A_DUPLICATE, candidatesConsidered, tokenUsage, stageTimings, transientRetriesConsumed };
  }

  let bestYes: [DuplicateCandidate, DuplicateJudgment] | null = null;
  let bestPossibly: [DuplicateCandidate, DuplicateJudgment] | null = null;

  for (const candidate of candidates) {
    const callStart = Date.now();
    const outcome = await withRetryBudgets(
      (feedback) => port.judgeDuplicate(rawReport, candidate, feedback),
      budgets,
    );
    stageTimings.push({
      stage: 'duplicate_judgment',
      duration_ms: Date.now() - callStart,
      candidate_issue_number: candidate.issue_number,
    });
    transientRetriesConsumed += outcome.transientAttempts;

    if (outcome.failure === 'transient_exhausted') {
      throw new PipelineUnavailableError(hashReport(rawReport), 'llm_unavailable', outcome.lastError ?? '');
    }
    if (outcome.failure === 'validation_exhausted') {
      candidatesConsidered.push({ issue_number: candidate.issue_number, similarity: candidate.similarity, same_bug: null });
      continue;
    }
    const { judgment, usage } = outcome.result as { judgment: DuplicateJudgment; usage: { input_tokens: number; output_tokens: number } };
    candidatesConsidered.push({ issue_number: candidate.issue_number, similarity: candidate.similarity, same_bug: judgment.same_bug });
    tokenUsage.push({ call: 'duplicate_judgment', candidate_issue_number: candidate.issue_number, ...usage });

    if (judgment.same_bug === 'yes' && bestYes === null) {
      bestYes = [candidate, judgment];
    } else if (judgment.same_bug === 'possibly' && bestPossibly === null) {
      bestPossibly = [candidate, judgment];
    }
  }

  let verdict: DuplicateVerdict = NOT_A_DUPLICATE;
  if (bestYes !== null) {
    const [candidate, judgment] = bestYes;
    verdict = {
      tier: 'clear_duplicate',
      target_issue: candidate.issue_number,
      similarity: candidate.similarity,
      // judgment.rationale is free text the model wrote after reading the
      // *unredacted* raw report (extract()/judgeDuplicate() always see the
      // original), so it can echo a secret back even though the raw report
      // it was judging is safely redacted wherever it's quoted verbatim.
      rationale: redactSecrets(judgment.rationale),
    };
  } else if (bestPossibly !== null) {
    const [candidate, judgment] = bestPossibly;
    verdict = {
      tier: 'possible_duplicate',
      target_issue: candidate.issue_number,
      similarity: candidate.similarity,
      rationale: redactSecrets(judgment.rationale),
    };
  }

  return { verdict, candidatesConsidered, tokenUsage, stageTimings, transientRetriesConsumed };
}
