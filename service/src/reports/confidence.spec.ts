/** Ticket #38: Confidence is a pure function of structural evidence (ADR-0001/ADR-0008). */

import { computeConfidence } from './confidence';

const BASE = {
  validationRetriesConsumed: 0,
  validationBudgetExhausted: false,
  duplicateVerdictTier: null,
  reviewFlagged: false,
  duplicateSimilarity: null,
  duplicateSimilarityFloor: null,
};

describe('computeConfidence', () => {
  it('is high with no retries, no duplicate ambiguity, no review flag', () => {
    expect(computeConfidence(BASE).band).toBe('high');
  });

  it('downgrades to medium after one consumed validation retry', () => {
    expect(computeConfidence({ ...BASE, validationRetriesConsumed: 1 }).band).toBe('medium');
  });

  it('floors at low once the validation budget is exhausted', () => {
    expect(computeConfidence({ ...BASE, validationRetriesConsumed: 1, validationBudgetExhausted: true }).band).toBe('low');
  });

  it('caps at medium for a possible_duplicate verdict even with zero retries', () => {
    expect(computeConfidence({ ...BASE, duplicateVerdictTier: 'possible_duplicate' }).band).toBe('medium');
  });

  it('caps at medium whenever a Review Flag is present, independent of duplicate tier', () => {
    expect(computeConfidence({ ...BASE, reviewFlagged: true }).band).toBe('medium');
  });

  it('never downgrades further than one band per retry, even if it would clamp below low', () => {
    expect(computeConfidence({ ...BASE, validationRetriesConsumed: 5 }).band).toBe('low');
  });

  it('does not cap for a clear_duplicate or not_a_duplicate tier on its own', () => {
    expect(computeConfidence({ ...BASE, duplicateVerdictTier: 'clear_duplicate' }).band).toBe('high');
    expect(computeConfidence({ ...BASE, duplicateVerdictTier: 'not_a_duplicate' }).band).toBe('high');
  });

  // F6 audit finding: ADR-0001/CONTEXT.md say Confidence is computed from
  // "validation outcome, duplicate similarity score, retry count", but this
  // previously never consumed the similarity score at all.
  it('bands a clear_duplicate down to medium when similarity barely cleared the retrieval floor', () => {
    const result = computeConfidence({
      ...BASE,
      duplicateVerdictTier: 'clear_duplicate',
      duplicateSimilarity: 0.36,
      duplicateSimilarityFloor: 0.35,
    });
    expect(result.band).toBe('medium');
    expect(result.reason).toContain('0.36');
  });

  it('keeps a clear_duplicate at high when similarity comfortably clears the retrieval floor', () => {
    const result = computeConfidence({
      ...BASE,
      duplicateVerdictTier: 'clear_duplicate',
      duplicateSimilarity: 0.9,
      duplicateSimilarityFloor: 0.35,
    });
    expect(result.band).toBe('high');
  });

  it('every result includes a non-empty one-line reason', () => {
    for (const inputs of [
      BASE,
      { ...BASE, validationRetriesConsumed: 1 },
      { ...BASE, validationBudgetExhausted: true },
      { ...BASE, duplicateVerdictTier: 'possible_duplicate' as const },
      { ...BASE, reviewFlagged: true },
    ]) {
      const result = computeConfidence(inputs);
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).not.toContain('\n');
    }
  });
});
