/**
 * A single fake implementation of TriagePort for orchestration tests. Every
 * pipeline test drives this fake rather than mocking Gitea/Anthropic/the
 * embedding library separately (ticket #26's Testing Decisions). Mirrors
 * tests/fake_port.py.
 */

import { GiteaError } from '../../gitea/gitea.errors';
import { TriagePort } from '../triage-port.interface';
import { DecisionRecord, DuplicateCandidate, DuplicateJudgment, GiteaIssue, TokenUsage, TriageDecision } from '../types';

export interface PortCall {
  op: string;
  args: unknown[];
}

// Ticket #40: most tests don't care about token usage, so extract()/
// judgeDuplicate() fall back to this rather than forcing every existing
// extractionQueue/judgmentsByCandidate entry in the suite to carry one.
// Tests that do care push onto extractionUsageQueue/judgeDuplicateUsageByCandidate.
const DEFAULT_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 };

export class FakeTriagePort implements TriagePort {
  calls: PortCall[] = [];
  openIssues: GiteaIssue[] = [];

  extractionQueue: Array<TriageDecision | Error> = [];
  extractionUsageQueue: TokenUsage[] = [];
  candidatesByReport = new Map<string, DuplicateCandidate[]>();
  judgmentsByCandidate = new Map<number, DuplicateJudgment>();
  judgeDuplicateQueueByCandidate = new Map<number, Array<DuplicateJudgment | Error>>();
  judgeDuplicateUsageByCandidate = new Map<number, TokenUsage[]>();
  createIssueShouldFail = false;
  commentShouldFail = false;

  private records = new Map<string, DecisionRecord>();
  private issueCounter = 100;

  async createIssue(title: string, body: string, labels: string[]): Promise<number> {
    this.calls.push({ op: 'create_issue', args: [title, body, [...labels]] });
    if (this.createIssueShouldFail) {
      throw new GiteaError('simulated Gitea outage');
    }
    this.issueCounter += 1;
    this.openIssues.push({ number: this.issueCounter, title, body, labels: [...labels], state: 'open' });
    return this.issueCounter;
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    this.calls.push({ op: 'comment_issue', args: [issueNumber, body] });
    if (this.commentShouldFail) {
      throw new GiteaError('simulated Gitea outage');
    }
  }

  async listOpenIssues(): Promise<GiteaIssue[]> {
    this.calls.push({ op: 'list_open_issues', args: [] });
    return [...this.openIssues];
  }

  async extract(rawReport: string, feedback?: string | null): Promise<{ decision: TriageDecision; usage: TokenUsage }> {
    this.calls.push({ op: 'extract', args: [rawReport, feedback ?? null] });
    const item = this.extractionQueue.shift();
    if (item === undefined) {
      throw new Error('FakeTriagePort.extractionQueue exhausted');
    }
    if (item instanceof Error) {
      throw item;
    }
    return { decision: item, usage: this.extractionUsageQueue.shift() ?? DEFAULT_USAGE };
  }

  async findCandidates(rawReport: string, _openIssues: GiteaIssue[]): Promise<DuplicateCandidate[]> {
    this.calls.push({ op: 'find_candidates', args: [rawReport] });
    return this.candidatesByReport.get(rawReport) ?? [];
  }

  async judgeDuplicate(
    rawReport: string,
    candidate: DuplicateCandidate,
    feedback?: string | null,
  ): Promise<{ judgment: DuplicateJudgment; usage: TokenUsage }> {
    this.calls.push({ op: 'judge_duplicate', args: [rawReport, candidate.issue_number, feedback ?? null] });
    const usage = this.judgeDuplicateUsageByCandidate.get(candidate.issue_number)?.shift() ?? DEFAULT_USAGE;
    const queue = this.judgeDuplicateQueueByCandidate.get(candidate.issue_number);
    if (queue && queue.length > 0) {
      const item = queue.shift() as DuplicateJudgment | Error;
      if (item instanceof Error) {
        throw item;
      }
      return { judgment: item, usage };
    }
    const judgment = this.judgmentsByCandidate.get(candidate.issue_number);
    if (!judgment) {
      throw new Error(`no scripted judgment for candidate #${candidate.issue_number}`);
    }
    return { judgment, usage };
  }

  async saveDecisionRecord(record: DecisionRecord): Promise<void> {
    this.calls.push({ op: 'save_decision_record', args: [record.report_hash, record.status] });
    this.records.set(record.report_hash, structuredClone(record));
  }

  async getDecisionRecord(reportHash: string): Promise<DecisionRecord | null> {
    this.calls.push({ op: 'get_decision_record', args: [reportHash] });
    const rec = this.records.get(reportHash);
    return rec ? structuredClone(rec) : null;
  }

  opNames(): string[] {
    return this.calls.map((c) => c.op);
  }
}
