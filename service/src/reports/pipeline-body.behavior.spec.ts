/**
 * Direct behavioral coverage for every exported function in pipeline-body.ts.
 * pipeline-body.spec.ts already covers the redaction-specific regression
 * cases; this file asserts the exact rendered output (not just that a
 * function runs) so mutation testing can catch operator/boundary mutants in
 * the body-construction logic itself.
 */

import {
  bugIssueBody,
  duplicateCommentBody,
  duplicateCrossLinkNote,
  hashReport,
  issueBody,
  quote,
  reviewFlagBody,
  suggestedFieldsNote,
} from './pipeline-body';
import { DuplicateVerdict, TriageDecision } from './types';

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: 'medium',
    components: ['backend'],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('hashReport', () => {
  it('returns the sha256 hex digest of the raw report', () => {
    expect(hashReport('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('is stable for the same input and differs for different input', () => {
    expect(hashReport('same')).toBe(hashReport('same'));
    expect(hashReport('a')).not.toBe(hashReport('b'));
  });
});

describe('quote', () => {
  it('renders "(empty)" for a blank report', () => {
    expect(quote('   ')).toBe('```\n(empty)\n```');
  });

  it('fences plain text with a 3-backtick fence', () => {
    expect(quote('plain text')).toBe('```\nplain text\n```');
  });

  it('widens the fence beyond the longest backtick run in the report', () => {
    const result = quote('has ``` triple backticks');
    expect(result.startsWith('````\n')).toBe(true);
    expect(result.endsWith('\n````')).toBe(true);
  });
});

describe('issueBody', () => {
  it('joins rationale and the raw report quote when extra is blank', () => {
    const body = issueBody('raw', 'rationale text');
    expect(body).toBe('rationale text\n\n### Raw Report (verbatim)\n\n```\nraw\n```');
  });

  it('inserts the extra section between rationale and the raw report quote', () => {
    const body = issueBody('raw', 'rationale text', 'extra text');
    expect(body).toBe('rationale text\n\nextra text\n\n### Raw Report (verbatim)\n\n```\nraw\n```');
  });

  it('omits the extra section when it is only whitespace', () => {
    const body = issueBody('raw', 'rationale text', '   ');
    expect(body).not.toContain('   \n\n###');
    expect(body).toBe('rationale text\n\n### Raw Report (verbatim)\n\n```\nraw\n```');
  });
});

describe('bugIssueBody', () => {
  it('numbers each reproduction step starting at 1', () => {
    const body = bugIssueBody('raw', decision({ repro_steps: ['open app', 'click button'] }));
    expect(body).toContain('1. open app\n2. click button');
  });

  it('reports no reproduction steps when repro_steps is null', () => {
    const body = bugIssueBody('raw', decision({ repro_steps: null }));
    expect(body).toContain('No reproduction steps provided.');
  });

  it('reports no reproduction steps when repro_steps is an empty array', () => {
    const body = bugIssueBody('raw', decision({ repro_steps: [] }));
    expect(body).toContain('No reproduction steps provided.');
  });

  it('reports "None." when supporting_evidence is null', () => {
    const body = bugIssueBody('raw', decision({ supporting_evidence: null }));
    expect(body).toContain('### Supporting evidence\n\nNone.');
  });

  it('trims and includes supporting_evidence when present', () => {
    const body = bugIssueBody('raw', decision({ supporting_evidence: '  stack trace  ' }));
    expect(body).toContain('### Supporting evidence\n\nstack trace');
  });

  it('reports "unknown" when components is empty', () => {
    const body = bugIssueBody('raw', decision({ components: [] }));
    expect(body).toContain('**Components:** unknown');
  });

  it('joins multiple components with a comma', () => {
    const body = bugIssueBody('raw', decision({ components: ['frontend', 'api'] }));
    expect(body).toContain('**Components:** frontend, api');
  });

  it('includes the severity', () => {
    const body = bugIssueBody('raw', decision({ severity: 'critical' }));
    expect(body).toContain('**Severity:** critical');
  });
});

describe('reviewFlagBody', () => {
  it('renders the reason and confidence band/reason', () => {
    const body = reviewFlagBody('raw', 'ambiguous report', { band: 'low', reason: 'no clear signal' });
    expect(body).toContain('**Why this needs review:** ambiguous report');
    expect(body).toContain('**Confidence:** low — no clear signal');
  });

  it('includes an extra section when provided', () => {
    const body = reviewFlagBody('raw', 'ambiguous report', { band: 'low', reason: 'no clear signal' }, 'cross-link note');
    expect(body).toContain('cross-link note');
  });
});

describe('duplicateCommentBody', () => {
  it('renders the rationale and the new report quote', () => {
    const body = duplicateCommentBody('raw', 'same stack trace');
    expect(body).toBe(
      'Automated triage matched this report as a duplicate of this issue (same stack trace).\n\n' +
        '### New report (verbatim)\n\n```\nraw\n```',
    );
  });
});

describe('duplicateCrossLinkNote', () => {
  function verdict(overrides: Partial<DuplicateVerdict> = {}): DuplicateVerdict {
    return { tier: 'possible_duplicate', target_issue: 42, similarity: 0.7, rationale: 'similar wording', ...overrides };
  }

  it('returns empty string for not_a_duplicate', () => {
    expect(duplicateCrossLinkNote(verdict({ tier: 'not_a_duplicate' }))).toBe('');
  });

  it('links the target issue number and rationale for possible_duplicate', () => {
    expect(duplicateCrossLinkNote(verdict({ tier: 'possible_duplicate', target_issue: 42, rationale: 'similar wording' }))).toBe(
      '### Possibly related to an existing issue\n\nSee #42 (similar wording).',
    );
  });

  it('links the target issue number and rationale for clear_duplicate', () => {
    expect(duplicateCrossLinkNote(verdict({ tier: 'clear_duplicate', target_issue: 7, rationale: 'exact match' }))).toBe(
      '### Possibly related to an existing issue\n\nSee #7 (exact match).',
    );
  });
});

describe('suggestedFieldsNote', () => {
  it('returns empty string when severity is null and components is empty', () => {
    expect(suggestedFieldsNote({ severity: null, components: [] })).toBe('');
  });

  it('includes only severity when components is empty', () => {
    expect(suggestedFieldsNote({ severity: 'high', components: [] })).toBe(
      '### Extracted, unconfirmed\n\n**Suggested severity:** high',
    );
  });

  it('includes only components when severity is null', () => {
    expect(suggestedFieldsNote({ severity: null, components: ['auth'] })).toBe(
      '### Extracted, unconfirmed\n\n**Suggested components:** auth',
    );
  });

  it('includes both severity and components, one line each, when both are present', () => {
    expect(suggestedFieldsNote({ severity: 'low', components: ['auth', 'database'] })).toBe(
      '### Extracted, unconfirmed\n\n**Suggested severity:** low\n**Suggested components:** auth, database',
    );
  });
});
