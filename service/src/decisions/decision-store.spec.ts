/**
 * Ticket #40: the full per-request evidence trail (token usage, every
 * Duplicate Candidate considered, per-stage timings, transient retry count)
 * round-trips through DecisionStore and is queryable directly from SQLite --
 * not just reconstructable through the store's own .get().
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Settings } from '../config/settings';
import { DecisionRecord } from '../reports/types';
import { DecisionStore } from './decision-store';

const BASE_SETTINGS: Omit<Settings, 'decision_db_path'> = {
  gitea_url: 'http://gitea.local',
  gitea_repo_owner: 'triageadmin',
  gitea_repo_name: 'acme-app',
  gitea_token: 'x',
  anthropic_api_key: 'test-key',
  anthropic_model: 'claude-sonnet-5',
  embedding_model_name: 'Xenova/all-MiniLM-L6-v2',
  duplicate_similarity_floor: 0.35,
  duplicate_top_k: 3,
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 0,
};

function sampleRecord(): DecisionRecord {
  return {
    report_hash: 'hash-1',
    raw_report: 'raw report text',
    status: 'completed',
    triage_decision: {
      title: 'Login broken',
      report_type: 'bug',
      severity: 'high',
      components: ['frontend'],
      repro_steps: [],
      supporting_evidence: null,
      distinct_issues: [],
    },
    duplicate_verdict: { tier: 'not_a_duplicate', target_issue: null, similarity: null, rationale: '' },
    pending_action: null,
    outcome: 'issue_created',
    gitea_issue_number: 42,
    error: null,
    created_at: 1000,
    updated_at: 1001,
    validation_retries_consumed: 1,
    validation_budget_exhausted: false,
    confidence: 'medium',
    transient_retries_consumed: 2,
    duplicate_candidates_considered: [
      { issue_number: 7, similarity: 0.4, same_bug: 'no' },
      { issue_number: 9, similarity: 0.3, same_bug: null },
    ],
    token_usage: [
      { call: 'extract', candidate_issue_number: null, input_tokens: 500, output_tokens: 80 },
      { call: 'duplicate_judgment', candidate_issue_number: 7, input_tokens: 200, output_tokens: 10 },
    ],
    stage_timings_ms: [
      { stage: 'extraction', duration_ms: 850, candidate_issue_number: null },
      { stage: 'gitea_list_open_issues', duration_ms: 12, candidate_issue_number: null },
      { stage: 'embedding_retrieval', duration_ms: 30, candidate_issue_number: null },
      { stage: 'duplicate_judgment', duration_ms: 400, candidate_issue_number: 7 },
      { stage: 'gitea_create_issue', duration_ms: 90, candidate_issue_number: null },
    ],
  };
}

describe('DecisionStore', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decision-store-test-'));
    dbPath = join(dir, 'decisions.sqlite3');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips the full evidence trail through .get()', () => {
    const store = new DecisionStore({ ...BASE_SETTINGS, decision_db_path: dbPath });
    const record = sampleRecord();

    store.save(record);

    expect(store.get('hash-1')).toEqual(record);
  });

  it('persists the full narrative queryable directly from SQLite for a past report_hash', () => {
    const store = new DecisionStore({ ...BASE_SETTINGS, decision_db_path: dbPath });
    const record = sampleRecord();
    store.save(record);

    const raw = new Database(dbPath);
    const row = raw.prepare('SELECT payload FROM decision_records WHERE report_hash = ?').get('hash-1') as { payload: string };
    raw.close();

    const persisted = JSON.parse(row.payload) as DecisionRecord;
    expect(persisted.transient_retries_consumed).toBe(2);
    expect(persisted.duplicate_candidates_considered).toEqual(record.duplicate_candidates_considered);
    expect(persisted.token_usage).toEqual(record.token_usage);
    expect(persisted.stage_timings_ms).toEqual(record.stage_timings_ms);
  });

  it('tryClaim inserts only the first call for a report_hash and reports the loser (F3 audit finding)', () => {
    const store = new DecisionStore({ ...BASE_SETTINGS, decision_db_path: dbPath });
    const record = { ...sampleRecord(), status: 'pending' as const };

    expect(store.tryClaim(record)).toBe(true);
    expect(store.tryClaim({ ...record, gitea_issue_number: 999 })).toBe(false);

    // the loser's payload never overwrote the winner's row
    expect(store.get('hash-1')!.gitea_issue_number).toBe(record.gitea_issue_number);
  });

  it('new fields stay nullable/additive -- an update overwrites the row rather than merging', () => {
    const store = new DecisionStore({ ...BASE_SETTINGS, decision_db_path: dbPath });
    const pending: DecisionRecord = { ...sampleRecord(), status: 'pending', token_usage: [], stage_timings_ms: [] };
    store.save(pending);

    const completed = sampleRecord();
    store.save(completed);

    expect(store.get('hash-1')).toEqual(completed);
  });
});
