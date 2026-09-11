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
  // barely cleared the retrieval floor. Null on any non-clear_duplicate
  // path, or when the caller has no similarity to compare against.
  duplicateSimilarity: number | null;
}

export interface ConfidenceResult {
  band: Confidence;
  reason: string;
}

const BANDS: Confidence[] = ['high', 'medium', 'low'];

// A genuine clear-duplicate pair scored ~0.65 in the floor-tuning evidence
// (embedding-index.ts), near-miss cases scored 0.38-0.44. A clear_duplicate
// verdict whose similarity falls in/near that near-miss band is a thinner
// signal than the tier alone suggests -- ADR-0001 and CONTEXT.md both say
// Confidence is computed from "duplicate similarity score", not just the
// categorical tier. Exported so duplicate-threshold-regression.ts's own
// CLEAR_BAND_MIN check asserts on this exact value instead of a second,
// independently-hardcoded copy of the same evidence.
export const CLEAR_DUPLICATE_CONFIDENCE_FLOOR = 0.5;

function budgetExhaustedResult(inputs: ConfidenceInputs): ConfidenceResult | null {
  if (!inputs.validationBudgetExhausted) {
    return null;
  }
  return {
    band: 'low',
    reason: 'the validation retry budget was exhausted before the model produced valid structured output',
  };
}

function retriesConsumedResult(inputs: ConfidenceInputs): ConfidenceResult | null {
  if (inputs.validationRetriesConsumed <= 0) {
    return null;
  }
  const band = BANDS[Math.min(BANDS.length - 1, inputs.validationRetriesConsumed)];
  const plural = inputs.validationRetriesConsumed === 1 ? 'retry' : 'retries';
  return {
    band,
    reason: `the model needed ${inputs.validationRetriesConsumed} validation ${plural} before its output passed validation`,
  };
}

function possibleDuplicateResult(inputs: ConfidenceInputs): ConfidenceResult | null {
  if (inputs.duplicateVerdictTier !== 'possible_duplicate') {
    return null;
  }
  return { band: 'medium', reason: "a possible duplicate was found but wasn't confident enough to auto-merge" };
}

function reviewFlaggedResult(inputs: ConfidenceInputs): ConfidenceResult | null {
  if (!inputs.reviewFlagged) {
    return null;
  }
  return { band: 'medium', reason: 'this report was routed to human review' };
}

function thinClearDuplicateResult(inputs: ConfidenceInputs): ConfidenceResult | null {
  const isThinClearDuplicate =
    inputs.duplicateVerdictTier === 'clear_duplicate' &&
    inputs.duplicateSimilarity !== null &&
    inputs.duplicateSimilarity < CLEAR_DUPLICATE_CONFIDENCE_FLOOR;
  if (!isThinClearDuplicate) {
    return null;
  }
  return {
    band: 'medium',
    reason:
      `matched as a clear duplicate at similarity ${(inputs.duplicateSimilarity as number).toFixed(4)}, ` +
      `below the ${CLEAR_DUPLICATE_CONFIDENCE_FLOOR} clear-duplicate band floor -- treat this merge as less certain`,
  };
}

const CONFIDENCE_RULES: Array<(inputs: ConfidenceInputs) => ConfidenceResult | null> = [
  budgetExhaustedResult,
  retriesConsumedResult,
  possibleDuplicateResult,
  reviewFlaggedResult,
  thinClearDuplicateResult,
];

export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  for (const rule of CONFIDENCE_RULES) {
    const result = rule(inputs);
    if (result !== null) {
      return result;
    }
  }
  return { band: 'high', reason: 'clean extraction with no validation retries or unresolved ambiguity' };
}
