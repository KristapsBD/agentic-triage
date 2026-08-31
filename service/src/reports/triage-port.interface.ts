/**
 * TS equivalent of app/port.py's TriagePort Protocol — the single seam every
 * orchestration decision in PipelineService depends on. Bundles both the
 * Gitea-facing operations (implemented by GiteaClient, ticket #27) and the
 * LLM/embedding/decision-record ones (stubbed here, filled in by #28/#30/#33)
 * behind one interface, so tests can substitute one fake covering the whole
 * pipeline rather than mocking several separate clients.
 */

import {
  DecisionRecord,
  DuplicateCandidate,
  DuplicateJudgment,
  GiteaIssue,
  TokenUsage,
  TriageDecision,
} from './types';

export const TRIAGE_PORT = Symbol('TRIAGE_PORT');

export interface TriagePort {
  // --- Gitea-facing ---
  createIssue(title: string, body: string, labels: string[]): Promise<number>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
  listOpenIssues(): Promise<GiteaIssue[]>;

  // --- LLM/embedding-facing ---
  // Ticket #40: usage bundled alongside the parsed result so the Decision
  // Record can capture token cost per call without a second round trip.
  extract(rawReport: string, feedback?: string | null): Promise<{ decision: TriageDecision; usage: TokenUsage }>;
  findCandidates(rawReport: string, openIssues: GiteaIssue[]): Promise<DuplicateCandidate[]>;
  judgeDuplicate(
    rawReport: string,
    candidate: DuplicateCandidate,
    feedback?: string | null,
  ): Promise<{ judgment: DuplicateJudgment; usage: TokenUsage }>;

  // --- Decision Record persistence ---
  saveDecisionRecord(record: DecisionRecord): Promise<void>;
  getDecisionRecord(reportHash: string): Promise<DecisionRecord | null>;
  // Atomic insert-or-bail (F3 audit finding): unlike saveDecisionRecord's
  // plain upsert, this creates the record only if no row for this
  // report_hash exists yet, and reports whether it won that race -- the
  // seam that lets processReport's initial claim be a single atomic
  // operation instead of a read-then-write with an await in between.
  claimDecisionRecord(record: DecisionRecord): Promise<boolean>;
}
