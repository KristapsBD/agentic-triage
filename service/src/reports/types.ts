/**
 * TS mirror of service/app/schemas.py. Field names stay snake_case to match
 * the HTTP wire contract (see docs/adr and service/tests/test_http.py)
 * byte-for-byte — no camelCase/snake_case mapping layer at the boundary.
 */

export type ReportType = 'bug' | 'feature_request' | 'unclear' | 'spam_or_off_topic';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Component =
  | 'frontend'
  | 'backend'
  | 'api'
  | 'auth'
  | 'database'
  | 'infra'
  | 'docs'
  | 'unknown';
export type SameBugJudgment = 'yes' | 'possibly' | 'no';
export type DuplicateTier = 'clear_duplicate' | 'possible_duplicate' | 'not_a_duplicate';
export type Outcome =
  | 'issue_created'
  | 'duplicate_commented'
  | 'review_flagged'
  | 'feature_request_filed'
  | 'dropped_spam';
export type Confidence = 'high' | 'medium' | 'low';

export interface TriageDecision {
  title: string;
  report_type: ReportType;
  severity: Severity | null;
  components: Component[];
  repro_steps: string[] | null;
  supporting_evidence: string | null;
  distinct_issues: string[];
}

export interface DuplicateCandidate {
  issue_number: number;
  title: string;
  body: string;
  similarity: number;
}

export interface DuplicateJudgment {
  same_bug: SameBugJudgment;
  rationale: string;
}

export interface DuplicateVerdict {
  tier: DuplicateTier;
  target_issue: number | null;
  similarity: number | null;
  rationale: string;
}

export interface GiteaIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
}

export interface PendingAction {
  type: 'create_issue' | 'comment' | 'none';
  title: string | null;
  body: string | null;
  labels: string[];
  target_issue: number | null;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LlmCallUsage extends TokenUsage {
  call: 'extract' | 'duplicate_judgment';
  candidate_issue_number: number | null;
}

export interface DuplicateCandidateConsidered {
  issue_number: number;
  similarity: number;
  // null when the candidate's duplicate-judgment call exhausted its
  // validation budget and was silently skipped rather than judged.
  same_bug: SameBugJudgment | null;
}

export type PipelineStage =
  | 'extraction'
  | 'embedding_retrieval'
  | 'duplicate_judgment'
  | 'gitea_list_open_issues'
  | 'gitea_create_issue'
  | 'gitea_comment_issue'
  // Ticket #43: whole-request wall-clock time, recorded once per freshly
  // processed report (never on an idempotent cache-hit return) so Grafana
  // can alert on p95 end-to-end latency without summing per-stage buckets.
  | 'end_to_end';

export interface StageTiming {
  stage: PipelineStage;
  duration_ms: number;
  candidate_issue_number: number | null;
}

export interface DecisionRecord {
  report_hash: string;
  raw_report: string;
  status: 'pending' | 'processing' | 'completed' | 'gitea_call_failed';
  triage_decision: TriageDecision | null;
  duplicate_verdict: DuplicateVerdict | null;
  pending_action: PendingAction | null;
  outcome: Outcome | null;
  gitea_issue_number: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  // Ticket #38: captured at the same phase as triage_decision so it survives
  // a resume even though route() (where duplicate tier/Review Flag presence
  // become known) may run in a later call.
  validation_retries_consumed: number;
  validation_budget_exhausted: boolean;
  confidence: Confidence | null;
  // Ticket #40: the full evidence trail behind the decision above -- never
  // consulted by routing/confidence logic itself, purely for
  // investigation/observability.
  transient_retries_consumed: number;
  duplicate_candidates_considered: DuplicateCandidateConsidered[];
  token_usage: LlmCallUsage[];
  stage_timings_ms: StageTiming[];
}

export interface ResponseEnvelope {
  outcome: Outcome;
  gitea_issue_number: number | null;
  triage_decision: TriageDecision | null;
  duplicate_verdict: DuplicateVerdict | null;
  confidence: Confidence;
}
