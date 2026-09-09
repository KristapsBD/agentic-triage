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

import { NEEDS_INFO, NEEDS_TRIAGE } from '../gitea/labels';
import { hashReport } from './pipeline-body';
import { PipelineUnavailableError } from './pipeline.errors';
import { redactSecrets } from './redaction';
import { RetryBudgets, withRetryBudgets } from './retry';
import { TriagePort } from './triage-port.interface';
import { DuplicateCandidate, DuplicateCandidateConsidered, DuplicateJudgment, DuplicateVerdict, LlmCallUsage, StageTiming } from './types';

const NOT_A_DUPLICATE: DuplicateVerdict = { tier: 'not_a_duplicate', target_issue: null, similarity: null, rationale: '' };

/**
 * `needs-triage`/`needs-info` issues are this service's own Review Flag
 * placeholders (routeBundled et al.), not triaged bugs — a "yes" match
 * against one just means the candidate mentions the report as one of
 * several bundled items, not that it's the same tracked bug. Treating that
 * as clear_duplicate silently merges a distinct, well-specified report into
 * an un-split bundle with no issue, severity, or component labels of its
 * own. Demote to possible_duplicate so it still gets cross-linked but also
 * gets a real issue (ADR-0005's three-tier design exists for exactly this).
 */
function isReviewFlagPlaceholder(candidate: DuplicateCandidate): boolean {
  return candidate.labels.includes(NEEDS_TRIAGE) || candidate.labels.includes(NEEDS_INFO);
}

export interface DuplicateDetectionResult {
  verdict: DuplicateVerdict;
  candidatesConsidered: DuplicateCandidateConsidered[];
  tokenUsage: LlmCallUsage[];
  stageTimings: StageTiming[];
  transientRetriesConsumed: number;
}

interface CandidateOutcome {
  stageTiming: StageTiming;
  transientAttempts: number;
  considered: DuplicateCandidateConsidered;
  success: { usage: LlmCallUsage; judgment: DuplicateJudgment } | null;
}

async function evaluateCandidate(
  port: TriagePort,
  rawReport: string,
  candidate: DuplicateCandidate,
  budgets: RetryBudgets,
): Promise<CandidateOutcome> {
  const callStart = Date.now();
  const outcome = await withRetryBudgets((feedback) => port.judgeDuplicate(rawReport, candidate, feedback), budgets);
  const stageTiming: StageTiming = {
    stage: 'duplicate_judgment',
    duration_ms: Date.now() - callStart,
    candidate_issue_number: candidate.issue_number,
  };

  if (outcome.failure === 'transient_exhausted') {
    throw new PipelineUnavailableError(hashReport(rawReport), 'llm_unavailable', outcome.lastError ?? '');
  }
  if (outcome.failure === 'validation_exhausted') {
    return {
      stageTiming,
      transientAttempts: outcome.transientAttempts,
      considered: { issue_number: candidate.issue_number, similarity: candidate.similarity, same_bug: null },
      success: null,
    };
  }
  const { judgment, usage } = outcome.result as { judgment: DuplicateJudgment; usage: { input_tokens: number; output_tokens: number } };
  return {
    stageTiming,
    transientAttempts: outcome.transientAttempts,
    considered: { issue_number: candidate.issue_number, similarity: candidate.similarity, same_bug: judgment.same_bug },
    success: { usage: { call: 'duplicate_judgment', candidate_issue_number: candidate.issue_number, ...usage }, judgment },
  };
}

type BestSlot = 'placeholder-yes' | 'yes' | 'possibly';
type Classification = BestSlot | 'none';
type BestCandidates = Record<BestSlot, [DuplicateCandidate, DuplicateJudgment] | null>;

/**
 * A demoted placeholder "yes" is stronger evidence than a merely "possibly"
 * match on some other candidate -- kept in its own slot so a real "possibly"
 * seen first (candidates arrive in descending-similarity order, so a
 * higher-similarity real candidate can be judged before a lower-similarity
 * placeholder) can't block it from ever being recorded.
 */
function classify(candidate: DuplicateCandidate, judgment: DuplicateJudgment): Classification {
  if (judgment.same_bug === 'possibly') return 'possibly';
  if (judgment.same_bug !== 'yes') return 'none';
  return isReviewFlagPlaceholder(candidate) ? 'placeholder-yes' : 'yes';
}

function recordBest(best: BestCandidates, classification: Classification, candidate: DuplicateCandidate, judgment: DuplicateJudgment): void {
  if (classification === 'none') return;
  if (best[classification] !== null) return;
  best[classification] = [candidate, judgment];
}

function buildVerdict(best: BestCandidates): DuplicateVerdict {
  if (best.yes !== null) {
    const [candidate, judgment] = best.yes;
    return {
      tier: 'clear_duplicate',
      target_issue: candidate.issue_number,
      similarity: candidate.similarity,
      // judgment.rationale is free text the model wrote after reading the
      // *unredacted* raw report (extract()/judgeDuplicate() always see the
      // original), so it can echo a secret back even though the raw report
      // it was judging is safely redacted wherever it's quoted verbatim.
      rationale: redactSecrets(judgment.rationale),
    };
  }
  // A "yes" on a placeholder is stronger evidence than a "possibly" on
  // something else, so it wins the possible_duplicate slot when both exist.
  const fallback = best['placeholder-yes'] ?? best.possibly;
  if (fallback === null) return NOT_A_DUPLICATE;
  const [candidate, judgment] = fallback;
  return { tier: 'possible_duplicate', target_issue: candidate.issue_number, similarity: candidate.similarity, rationale: redactSecrets(judgment.rationale) };
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

  const best: BestCandidates = { 'placeholder-yes': null, yes: null, possibly: null };

  for (const candidate of candidates) {
    const outcome = await evaluateCandidate(port, rawReport, candidate, budgets);
    stageTimings.push(outcome.stageTiming);
    transientRetriesConsumed += outcome.transientAttempts;
    candidatesConsidered.push(outcome.considered);
    if (outcome.success !== null) {
      tokenUsage.push(outcome.success.usage);
      recordBest(best, classify(candidate, outcome.success.judgment), candidate, outcome.success.judgment);
    }
  }

  return { verdict: buildVerdict(best), candidatesConsidered, tokenUsage, stageTimings, transientRetriesConsumed };
}
