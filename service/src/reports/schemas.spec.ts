/**
 * Regression test mirroring tests/test_schemas.py: a bug report_type with a
 * missing severity or empty components must fail validation (so the
 * validation-retry budget engages) rather than silently defaulting and
 * later crashing an unrelated assertion in pipeline routing.
 */

import { ExtractionValidationError } from './pipeline.errors';
import { parseTriageDecision } from './schemas';

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
});
