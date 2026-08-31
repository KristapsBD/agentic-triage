/** Ticket #32: unified Review Flag mechanism + Bundled Report handling. */

import { PipelineService } from './pipeline.service';
import { FakeTriagePort } from './testing/fake-triage-port';
import { DuplicateCandidate, DuplicateJudgment, TriageDecision } from './types';

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 't',
    report_type: 'bug',
    severity: null,
    components: [],
    repro_steps: null,
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('PipelineService (Review Flag unification + Bundled Report handling)', () => {
  it('still cross-links a duplicate candidate for an unclear report', async () => {
    const raw = 'the export thing is timing out again, ugh, when will this get fixed';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 'Export operation times out', report_type: 'unclear' })];
    const candidate: DuplicateCandidate = { issue_number: 2, title: 'CSV export times out', body: '...', similarity: 0.6, labels: [] };
    port.candidatesByReport.set(raw, [candidate]);
    port.judgmentsByCandidate.set(2, { same_bug: 'possibly', rationale: 'both mention export timing out' });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged'); // still routed to a human, never auto-commented
    expect(envelope.duplicate_verdict?.tier).toBe('possible_duplicate');
    expect(envelope.duplicate_verdict?.target_issue).toBe(2);
    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body).toContain('#2');
  });

  it('flags a bundled report needs-triage, listing distinct issues, not auto-split', async () => {
    const raw =
      'A few things: the search bar sometimes returns no results even for exact ' +
      'matches, the date picker lets you select an end date before the start ' +
      'date, and also the mobile menu overlaps the header on small screens.';
    const distinctIssues = [
      'Search bar returns no results for exact matches',
      'Date picker allows end date before start date',
      'Mobile menu overlaps header on small screens',
    ];
    const port = new FakeTriagePort();
    port.extractionQueue = [
      decision({
        title: 'Multiple UI/search issues reported together',
        severity: 'medium',
        components: ['frontend'],
        distinct_issues: distinctIssues,
      }),
    ];

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    const createCalls = port.calls.filter((c) => c.op === 'create_issue');
    expect(createCalls).toHaveLength(1); // not auto-split into three issues
    const [, body, labels] = createCalls[0].args as [string, string, string[]];
    expect(labels).toEqual(['needs-triage']);
    for (const issue of distinctIssues) {
      expect(body).toContain(issue);
    }
    // duplicate detection still runs -- with no candidates registered for
    // this raw text, FakeTriagePort.findCandidates returns [], a no-op
    // rather than skipped outright.
    expect(port.calls.some((c) => c.op === 'find_candidates')).toBe(true);
    expect(envelope.duplicate_verdict?.tier).toBe('not_a_duplicate');
  });

  it('still cross-links a duplicate candidate for a bundled report', async () => {
    const raw =
      'A few things: first, on iPhone Safari the login button just doesn\'t respond ' +
      'when tapped -- same as before; second, the currency dropdown defaults to USD ' +
      'for EU accounts; third, the timezone setting doesn\'t persist after logout.';
    const port = new FakeTriagePort();
    port.extractionQueue = [
      decision({
        title: 'Multiple bugs: login button, currency default, timezone setting',
        severity: 'high',
        components: ['frontend'],
        distinct_issues: [
          'Login button unresponsive on iPhone Safari',
          'Currency dropdown defaults to USD for EU accounts',
          'Timezone setting not persisted after logout',
        ],
      }),
    ];
    const candidate: DuplicateCandidate = {
      issue_number: 1,
      title: 'Login button unresponsive on mobile Safari',
      body: '...',
      similarity: 0.8,
      labels: [],
    };
    port.candidatesByReport.set(raw, [candidate]);
    port.judgmentsByCandidate.set(1, { same_bug: 'yes', rationale: 'same symptom, same platform' });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged'); // bundling still wins -- never auto-comments
    expect(envelope.duplicate_verdict?.tier).toBe('clear_duplicate');
    expect(envelope.duplicate_verdict?.target_issue).toBe(1);
    const createCalls = port.calls.filter((c) => c.op === 'create_issue');
    expect(createCalls).toHaveLength(1); // still not auto-split, and not auto-commented either
    expect(port.calls.some((c) => c.op === 'comment_issue')).toBe(false);
    const body = createCalls[0].args[1] as string;
    expect(body).toContain('#1');
  });

  it('states why in plain language on every Review Flagged issue', async () => {
    const raw = 'the reports thing is broken again pls fix';
    const port = new FakeTriagePort();
    port.extractionQueue = [decision({ title: 't', report_type: 'unclear' })];

    await new PipelineService(port).processReport(raw);

    const body = port.calls.find((c) => c.op === 'create_issue')!.args[1] as string;
    expect(body.toLowerCase()).toContain('why this needs review');
  });

  it('shares the same body construction between a possible duplicate and a bundled report', async () => {
    const rawPossible = 'possible dup case';
    const portA = new FakeTriagePort();
    portA.extractionQueue = [decision({ severity: 'low', components: ['unknown'] })];
    const candidate: DuplicateCandidate = { issue_number: 1, title: 'x', body: 'y', similarity: 0.6, labels: [] };
    portA.candidatesByReport.set(rawPossible, [candidate]);
    portA.judgmentsByCandidate.set(1, { same_bug: 'possibly', rationale: 'r' } as DuplicateJudgment);
    await new PipelineService(portA).processReport(rawPossible);
    const bodyA = portA.calls.find((c) => c.op === 'create_issue')!.args[1] as string;

    const rawBundled = 'bundled case';
    const portB = new FakeTriagePort();
    portB.extractionQueue = [
      decision({ severity: 'low', components: ['unknown'], distinct_issues: ['one', 'two'] }),
    ];
    await new PipelineService(portB).processReport(rawBundled);
    const bodyB = portB.calls.find((c) => c.op === 'create_issue')!.args[1] as string;

    expect(bodyA.toLowerCase()).toContain('why this needs review');
    expect(bodyB.toLowerCase()).toContain('why this needs review');
  });

  // F1 (scout-hire-audit-opus): a bundled report's needs-triage placeholder
  // is a normal open issue as far as listOpenIssues()/findDuplicateVerdict
  // are concerned, so a later, distinct, well-specified report describing
  // one of the bundle's constituent bugs is a legitimate "yes" match on
  // the LLM's own honest reading. Reproduced live against issue #9 in
  // scout-hire-audit-opus's report.md: two separate constituent bugs both
  // auto-merged as clear_duplicate comments on the bundle placeholder,
  // with no issue, severity, or component labels of their own. The fix
  // demotes a "yes" match against a needs-triage/needs-info placeholder to
  // possible_duplicate, so it still gets a real issue plus a cross-link.
  it('does not clear-duplicate-merge a constituent bug into its own un-split bundle placeholder', async () => {
    const rawBundle =
      'Multiple issues: password reset emails not sent, timezone setting resets on save, ' +
      'stale support email in invoice PDF.';
    const bundlePort = new FakeTriagePort();
    bundlePort.extractionQueue = [
      decision({
        title: 'Multiple issues: password reset emails not sent, timezone setting resets on save, stale support email in invoice PDF',
        severity: 'medium',
        distinct_issues: [
          'Password reset emails not sent',
          'Timezone setting resets on save',
          'Stale support email in invoice PDF',
        ],
      }),
    ];
    const bundleEnvelope = await new PipelineService(bundlePort).processReport(rawBundle);
    expect(bundleEnvelope.outcome).toBe('review_flagged');
    // openIssues[0] is the just-created needs-triage placeholder.
    const placeholder = bundlePort.openIssues[0];
    expect(placeholder.labels).toContain('needs-triage');

    const rawConstituent =
      'The timezone dropdown in account settings resets itself to UTC whenever you save any ' +
      'other setting on that page.';
    bundlePort.extractionQueue = [decision({ title: 'Timezone dropdown resets to UTC on unrelated saves', severity: 'medium', components: ['backend'] })];
    const candidate: DuplicateCandidate = {
      issue_number: placeholder.number,
      title: placeholder.title,
      body: placeholder.body,
      similarity: 0.4829,
      labels: placeholder.labels,
    };
    bundlePort.candidatesByReport.set(rawConstituent, [candidate]);
    bundlePort.judgmentsByCandidate.set(placeholder.number, {
      same_bug: 'yes',
      rationale: 'The candidate explicitly lists the timezone dropdown resetting to UTC on saving other settings.',
    });

    const constituentEnvelope = await new PipelineService(bundlePort).processReport(rawConstituent);

    // Must NOT silently merge as a comment on the placeholder.
    expect(constituentEnvelope.outcome).not.toBe('duplicate_commented');
    expect(constituentEnvelope.duplicate_verdict?.tier).not.toBe('clear_duplicate');
    expect(constituentEnvelope.duplicate_verdict?.tier).toBe('possible_duplicate');
    expect(constituentEnvelope.duplicate_verdict?.target_issue).toBe(placeholder.number);
    // Gets its own issue, cross-linked to the placeholder, not just a comment.
    expect(bundlePort.calls.filter((c) => c.op === 'create_issue')).toHaveLength(2);
  });
});
