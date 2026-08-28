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
}

export interface ConfidenceResult {
  band: Confidence;
  reason: string;
}

const BANDS: Confidence[] = ['high', 'medium', 'low'];

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

  return { band: 'high', reason: 'clean extraction with no validation retries or unresolved ambiguity' };
}
