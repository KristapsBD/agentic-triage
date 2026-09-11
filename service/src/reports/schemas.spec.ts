/**
 * Regression test mirroring tests/test_schemas.py: a bug report_type with a
 * missing severity or empty components must fail validation (so the
 * validation-retry budget engages) rather than silently defaulting and
 * later crashing an unrelated assertion in pipeline routing.
 */

import { ExtractionValidationError } from './pipeline.errors';
import { isBundled, parseDuplicateJudgment, parseTriageDecision } from './schemas';

describe('parseTriageDecision', () => {
  it('fails validation when a bug report is missing severity', () => {
    expect(() =>
      parseTriageDecision({ title: 't', report_type: 'bug', severity: null, components: ['frontend'] }),
    ).toThrow(ExtractionValidationError);
    try {
      parseTriageDecision({ title: 't', report_type: 'bug', severity: null, components: ['frontend'] });
    } catch (e) {
      expect((e as Error).message).toMatch(/severity/);
    }
  });

  it('fails validation when a bug report has empty components', () => {
    expect(() => parseTriageDecision({ title: 't', report_type: 'bug', severity: 'low', components: [] })).toThrow(
      ExtractionValidationError,
    );
    try {
      parseTriageDecision({ title: 't', report_type: 'bug', severity: 'low', components: [] });
    } catch (e) {
      expect((e as Error).message).toMatch(/components/);
    }
  });

  it('does not require severity or components for a non-bug report type', () => {
    expect(() =>
      parseTriageDecision({ title: 't', report_type: 'feature_request', severity: null, components: [] }),
    ).not.toThrow();
    expect(() =>
      parseTriageDecision({ title: 't', report_type: 'spam_or_off_topic', severity: null, components: [] }),
    ).not.toThrow();
    expect(() =>
      parseTriageDecision({ title: 't', report_type: 'unclear', severity: null, components: [] }),
    ).not.toThrow();
  });

  it('dedupes components and trims the title', () => {
    const decision = parseTriageDecision({
      title: '  t  ',
      report_type: 'bug',
      severity: 'low',
      components: ['frontend', 'frontend', 'backend'],
    });
    expect(decision.title).toBe('t');
    expect(decision.components).toEqual(['frontend', 'backend']);
  });

  it('rejects an unknown enum member with a message mentioning the field', () => {
    try {
      parseTriageDecision({ title: 't', report_type: 'bug', severity: 'nonsense', components: ['frontend'] });
      throw new Error('expected parseTriageDecision to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractionValidationError);
      expect((e as Error).message).toMatch(/severity/);
    }
  });

  it('rejects a blank title', () => {
    try {
      parseTriageDecision({ title: '   ', report_type: 'unclear' });
      throw new Error('expected parseTriageDecision to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractionValidationError);
      expect((e as Error).message).toMatch(/title/);
    }
  });

  it('defaults optional fields when omitted', () => {
    const decision = parseTriageDecision({ title: 't', report_type: 'unclear' });
    expect(decision.severity).toBeNull();
    expect(decision.components).toEqual([]);
    expect(decision.repro_steps).toBeNull();
    expect(decision.supporting_evidence).toBeNull();
    expect(decision.distinct_issues).toEqual([]);
  });
});

describe('parseDuplicateJudgment', () => {
  it('parses a valid judgment and defaults rationale when omitted', () => {
    const judgment = parseDuplicateJudgment({ same_bug: 'yes' });
    expect(judgment.same_bug).toBe('yes');
    expect(judgment.rationale).toBe('');
  });

  it('preserves a provided rationale', () => {
    const judgment = parseDuplicateJudgment({ same_bug: 'no', rationale: 'different stack traces' });
    expect(judgment.rationale).toBe('different stack traces');
  });

  it('rejects an invalid same_bug value', () => {
    try {
      parseDuplicateJudgment({ same_bug: 'maybe' });
      throw new Error('expected parseDuplicateJudgment to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractionValidationError);
      expect((e as Error).message).toMatch(/same_bug/);
    }
  });

  it('rejects a missing required field', () => {
    expect(() => parseDuplicateJudgment({})).toThrow(ExtractionValidationError);
  });
});

describe('isBundled', () => {
  it('is false when there are zero or one distinct issues', () => {
    const single = parseTriageDecision({ title: 't', report_type: 'unclear', distinct_issues: ['a'] });
    const none = parseTriageDecision({ title: 't', report_type: 'unclear' });
    expect(isBundled(single)).toBe(false);
    expect(isBundled(none)).toBe(false);
  });

  it('is true when there is more than one distinct issue', () => {
    const decision = parseTriageDecision({
      title: 't',
      report_type: 'unclear',
      distinct_issues: ['a', 'b'],
    });
    expect(isBundled(decision)).toBe(true);
  });
});
