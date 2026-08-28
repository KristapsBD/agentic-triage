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
  TriageDecision,
} from './types';

export const TRIAGE_PORT = Symbol('TRIAGE_PORT');

export interface TriagePort {
  // --- Gitea-facing ---
  createIssue(title: string, body: string, labels: string[]): Promise<number>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
  listOpenIssues(): Promise<GiteaIssue[]>;

  // --- LLM/embedding-facing ---
  extract(rawReport: string, feedback?: string | null): Promise<TriageDecision>;
  findCandidates(rawReport: string, openIssues: GiteaIssue[]): Promise<DuplicateCandidate[]>;
  judgeDuplicate(rawReport: string, candidate: DuplicateCandidate, feedback?: string | null): Promise<DuplicateJudgment>;

  // --- Decision Record persistence ---
  saveDecisionRecord(record: DecisionRecord): Promise<void>;
  getDecisionRecord(reportHash: string): Promise<DecisionRecord | null>;
}
