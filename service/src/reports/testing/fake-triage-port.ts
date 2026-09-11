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

function normalizeFeedback(feedback?: string | null): string | null {
  return feedback ?? null;
}

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
  // F11: undefined (network-error-shaped, retryable) unless a test wants to
  // simulate a permanent Gitea rejection (e.g. 404/403) instead.
  createIssueFailureStatus: number | undefined = undefined;
  commentShouldFail = false;

  private records = new Map<string, DecisionRecord>();
  private issueCounter = 100;

  async createIssue(title: string, body: string, labels: string[]): Promise<number> {
    this.calls.push({ op: 'create_issue', args: [title, body, [...labels]] });
    if (this.createIssueShouldFail) {
      throw new GiteaError('simulated Gitea outage', this.createIssueFailureStatus);
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
    this.calls.push({ op: 'extract', args: [rawReport, normalizeFeedback(feedback)] });
    const decision = this.dequeueExtraction();
    return { decision, usage: this.dequeueUsage(this.extractionUsageQueue) };
  }

  private dequeueExtraction(): TriageDecision {
    const item = this.extractionQueue.shift();
    if (item === undefined) {
      throw new Error('FakeTriagePort.extractionQueue exhausted');
    }
    if (item instanceof Error) {
      throw item;
    }
    return item;
  }

  private dequeueUsage(queue: TokenUsage[] | undefined): TokenUsage {
    return queue?.shift() ?? DEFAULT_USAGE;
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
    this.calls.push({ op: 'judge_duplicate', args: [rawReport, candidate.issue_number, normalizeFeedback(feedback)] });
    const usage = this.dequeueUsage(this.judgeDuplicateUsageByCandidate.get(candidate.issue_number));
    const judgment = this.resolveJudgment(candidate.issue_number);
    return { judgment, usage };
  }

  private resolveJudgment(candidateNumber: number): DuplicateJudgment {
    const queued = this.dequeueQueuedJudgment(candidateNumber);
    if (queued) {
      return queued;
    }
    const judgment = this.judgmentsByCandidate.get(candidateNumber);
    if (!judgment) {
      throw new Error(`no scripted judgment for candidate #${candidateNumber}`);
    }
    return judgment;
  }

  private dequeueQueuedJudgment(candidateNumber: number): DuplicateJudgment | undefined {
    const queue = this.judgeDuplicateQueueByCandidate.get(candidateNumber);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const item = queue.shift() as DuplicateJudgment | Error;
    if (item instanceof Error) {
      throw item;
    }
    return item;
  }

  async saveDecisionRecord(record: DecisionRecord): Promise<void> {
    this.calls.push({ op: 'save_decision_record', args: [record.report_hash, record.status] });
    this.records.set(record.report_hash, structuredClone(record));
  }

  async claimDecisionRecord(record: DecisionRecord): Promise<boolean> {
    this.calls.push({ op: 'claim_decision_record', args: [record.report_hash] });
    if (this.records.has(record.report_hash)) return false;
    this.records.set(record.report_hash, structuredClone(record));
    return true;
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
