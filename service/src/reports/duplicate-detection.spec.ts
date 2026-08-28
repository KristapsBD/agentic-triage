/** Ticket #30: embedding retrieval + three-tier Duplicate Verdict. */

import { hashReport } from './pipeline-body';
import { ExtractionValidationError } from './pipeline.errors';
import { PipelineService } from './pipeline.service';
import { FakeTriagePort } from './testing/fake-triage-port';
import { DuplicateCandidate, DuplicateJudgment, TriageDecision } from './types';

function bugDecision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    title: 'Login broken on mobile Safari',
    report_type: 'bug',
    severity: 'high',
    components: ['frontend', 'auth'],
    repro_steps: ['Open app in Safari on iPhone', 'Type login details', 'Tap login button'],
    supporting_evidence: null,
    distinct_issues: [],
    ...overrides,
  };
}

describe('PipelineService (duplicate detection)', () => {
  it('short-circuits to not_a_duplicate with no LLM call when nothing clears the floor', async () => {
    const raw = 'totally novel report about nothing seen before';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    port.candidatesByReport.set(raw, []);

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.duplicate_verdict?.tier).toBe('not_a_duplicate');
    expect(port.calls.some((c) => c.op === 'judge_duplicate')).toBe(false);
    expect(port.calls.some((c) => c.op === 'create_issue')).toBe(true);
  });

  it('comments on the existing issue with no new issue for a clear duplicate', async () => {
    const raw =
      "I can't log in on my iPhone. I open the app in Safari, type my details, " +
      'tap the login button and literally nothing happens. My colleague has the ' +
      'same problem on her phone.';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    const candidate: DuplicateCandidate = {
      issue_number: 1,
      title: 'Login button unresponsive on mobile Safari',
      body: '...',
      similarity: 0.9,
    };
    port.candidatesByReport.set(raw, [candidate]);
    port.judgmentsByCandidate.set(1, { same_bug: 'yes', rationale: 'same symptom, same platform' });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('duplicate_commented');
    expect(envelope.duplicate_verdict?.tier).toBe('clear_duplicate');
    expect(envelope.duplicate_verdict?.target_issue).toBe(1);
    expect(port.calls.some((c) => c.op === 'create_issue')).toBe(false);
    const commentCall = port.calls.find((c) => c.op === 'comment_issue')!;
    const [issueNumber, body] = commentCall.args as [number, string];
    expect(issueNumber).toBe(1);
    expect(body).toContain(raw);
  });

  it('resolves not_a_duplicate for a near-miss: same area, genuinely different bug', async () => {
    const raw =
      "On the login page, the password field overlaps the username field on " +
      "narrow screens — you can't tell which box you're typing into. The login " +
      'button itself works fine once you get the right field.';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision({ title: 'Login page fields overlap on narrow screens' })];
    const candidate: DuplicateCandidate = {
      issue_number: 1,
      title: 'Login button unresponsive on mobile Safari',
      body: 'the button does nothing when tapped',
      similarity: 0.5,
    };
    port.candidatesByReport.set(raw, [candidate]);
    port.judgmentsByCandidate.set(1, {
      same_bug: 'no',
      rationale: 'different symptom: layout overlap vs. unresponsive button',
    });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.duplicate_verdict?.tier).toBe('not_a_duplicate');
    expect(envelope.outcome).toBe('issue_created');
    expect(port.calls.some((c) => c.op === 'comment_issue')).toBe(false);
  });

  it('redacts a secret the judgment rationale echoes back before it reaches Gitea', async () => {
    const raw = "same crash as before, rotating my key didn't help either";
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    const candidate: DuplicateCandidate = { issue_number: 1, title: 'Login button unresponsive', body: '...', similarity: 0.9 };
    port.candidatesByReport.set(raw, [candidate]);
    const judgment: DuplicateJudgment = {
      same_bug: 'yes',
      rationale: 'Same symptom; reporter\'s api_key=sk_live_FAKE1234567890abcdef also appears unrelated.',
    };
    port.judgmentsByCandidate.set(1, judgment);

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.duplicate_verdict?.rationale).not.toContain('sk_live_FAKE1234567890abcdef');
    const commentBody = port.calls.find((c) => c.op === 'comment_issue')!.args[1] as string;
    expect(commentBody).not.toContain('sk_live_FAKE1234567890abcdef');
  });

  it('creates a cross-linked, flagged issue for a possible duplicate', async () => {
    const raw = 'login seems flaky on some phones';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    const candidate: DuplicateCandidate = { issue_number: 1, title: 'Login button unresponsive', body: '...', similarity: 0.6 };
    port.candidatesByReport.set(raw, [candidate]);
    port.judgmentsByCandidate.set(1, { same_bug: 'possibly', rationale: 'similar area, unclear if same root cause' });

    const envelope = await new PipelineService(port).processReport(raw);

    expect(envelope.outcome).toBe('review_flagged');
    expect(envelope.duplicate_verdict?.tier).toBe('possible_duplicate');
    expect(envelope.duplicate_verdict?.target_issue).toBe(1);
    const createCall = port.calls.find((c) => c.op === 'create_issue')!;
    const [, body, labels] = createCall.args as [string, string, string[]];
    expect(body).toContain('#1');
    expect(labels).toContain('needs-triage');
    expect(port.calls.some((c) => c.op === 'comment_issue')).toBe(false);
  });

  it('records every candidate considered, not just the winner, including a validation-exhausted skip (#40)', async () => {
    const raw = 'multiple candidates in play';
    const port = new FakeTriagePort();
    port.extractionQueue = [bugDecision()];
    const candidates: DuplicateCandidate[] = [
      { issue_number: 1, title: 'unrelated', body: '...', similarity: 0.4 },
      { issue_number: 2, title: 'skipped', body: '...', similarity: 0.5 },
      { issue_number: 3, title: 'the winner', body: '...', similarity: 0.9 },
    ];
    port.candidatesByReport.set(raw, candidates);
    port.judgmentsByCandidate.set(1, { same_bug: 'no', rationale: 'different area' });
    port.judgeDuplicateQueueByCandidate.set(2, [
      new ExtractionValidationError('bad'),
      new ExtractionValidationError('bad'),
      new ExtractionValidationError('bad'),
    ]);
    port.judgmentsByCandidate.set(3, { same_bug: 'yes', rationale: 'same root cause' });

    await new PipelineService(port).processReport(raw);

    const record = await port.getDecisionRecord(hashReport(raw));
    expect(record!.duplicate_candidates_considered).toEqual([
      { issue_number: 1, similarity: 0.4, same_bug: 'no' },
      { issue_number: 2, similarity: 0.5, same_bug: null },
      { issue_number: 3, similarity: 0.9, same_bug: 'yes' },
    ]);
    const dupUsageEntries = record!.token_usage.filter((u) => u.call === 'duplicate_judgment');
    expect(dupUsageEntries.map((u) => u.candidate_issue_number)).toEqual([1, 3]);
  });
});
