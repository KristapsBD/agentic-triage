/**
 * Ticket #38: Confidence is computed purely from structural evidence the
 * harness already observes -- never an LLM self-reported number (ADR-0001).
 * Transient-API retries are never part of the inputs here, so they can never
 * affect the band (ADR-0008).
 */

import { Confidence, DuplicateTier } from './types';

export interface ConfidenceInputs {
  validationRetriesConsumed: number;
  validationBudgetExhausted: boolean;
  duplicateVerdictTier: DuplicateTier | null;
  reviewFlagged: boolean;
  // F6 audit finding: ADR-0001/CONTEXT.md both say Confidence is computed
  // from "validation outcome, duplicate similarity score, retry count", but
  // this previously only ever consumed the categorical tier -- a
  // clear_duplicate auto-merge could report `high` on a candidate that had
  // barely cleared the retrieval floor. Both null on any non-clear_duplicate
  // path, or when the caller has no floor to compare against.
  duplicateSimilarity: number | null;
  duplicateSimilarityFloor: number | null;
}

export interface ConfidenceResult {
  band: Confidence;
  reason: string;
}

const BANDS: Confidence[] = ['high', 'medium', 'low'];

// A clear_duplicate whose similarity is within this margin of the retrieval
// floor is banded down from high -- it cleared the LLM judge, but the
// structural evidence backing it is weak, exactly where a false merge would
// be costliest (ADR-0005's "avoid false merges" pressure).
const NEAR_FLOOR_MARGIN = 0.15;

export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  if (inputs.validationBudgetExhausted) {
    return {
      band: 'low',
      reason: 'the validation retry budget was exhausted before the model produced valid structured output',
    };
  }

  if (inputs.validationRetriesConsumed > 0) {
    const band = BANDS[Math.min(inputs.validationRetriesConsumed, BANDS.length - 1)];
    const plural = inputs.validationRetriesConsumed === 1 ? 'retry' : 'retries';
    return {
      band,
      reason: `the model needed ${inputs.validationRetriesConsumed} validation ${plural} before its output passed validation`,
    };
  }

  if (inputs.duplicateVerdictTier === 'possible_duplicate') {
    return { band: 'medium', reason: "a possible duplicate was found but wasn't confident enough to auto-merge" };
  }

  if (inputs.reviewFlagged) {
    return { band: 'medium', reason: 'this report was routed to human review' };
  }

  if (
    inputs.duplicateVerdictTier === 'clear_duplicate' &&
    inputs.duplicateSimilarity !== null &&
    inputs.duplicateSimilarityFloor !== null &&
    inputs.duplicateSimilarity - inputs.duplicateSimilarityFloor < NEAR_FLOOR_MARGIN
  ) {
    return {
      band: 'medium',
      reason:
        `a clear duplicate was found, but the embedding similarity (${inputs.duplicateSimilarity.toFixed(2)}) barely ` +
        `cleared the retrieval floor (${inputs.duplicateSimilarityFloor.toFixed(2)}) -- banded down from high`,
    };
  }

  return { band: 'high', reason: 'clean extraction with no validation retries or unresolved ambiguity' };
}
