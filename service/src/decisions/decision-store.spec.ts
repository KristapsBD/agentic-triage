/**
 * Ticket #40 (carried over into issue #59): the full per-request evidence
 * trail (token usage, every Duplicate Candidate considered, per-stage
 * timings, transient retry count) round-trips through DecisionStore and is
 * queryable directly from Postgres -- not just reconstructable through the
 * store's own .get().
 *
 * Issue #59: runs against a real, ephemeral Postgres instance provisioned by
 * testcontainers for this test run (same "real database, not mocked" spirit
 * as the old real-SQLite-temp-file approach), with the checked-in Prisma
 * migrations applied once via `prisma migrate deploy`. Individual tests are
 * isolated by truncating every table (cascading from `decisions`, whose
 * children are all `ON DELETE CASCADE`) rather than a fresh container per
 * test, since spinning up a container per test would dominate the run time.
 */

import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Settings } from '../config/settings';
import { DecisionRecord } from '../reports/types';
import { DecisionStore } from './decision-store';
import { PrismaService } from './prisma.service';

jest.setTimeout(180_000);

const SERVICE_ROOT = resolve(__dirname, '../..');

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
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let store: DecisionStore;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: SERVICE_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaService({ database_url: databaseUrl } as unknown as Settings);
    store = new DecisionStore(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "decisions" RESTART IDENTITY CASCADE');
  });

  it('round-trips the full evidence trail through .get()', async () => {
    const record = sampleRecord();

    await store.save(record);

    expect(await store.get('hash-1')).toEqual(record);
  });

  it('round-trips a non-null pending_action', async () => {
    const record: DecisionRecord = {
      ...sampleRecord(),
      status: 'processing',
      outcome: null,
      pending_action: { type: 'create_issue', title: 'New issue', body: 'body text', labels: ['bug'], target_issue: null },
    };

    await store.save(record);

    expect(await store.get('hash-1')).toEqual(record);
  });

  it('persists the full narrative queryable directly from Postgres for a past report_hash', async () => {
    const record = sampleRecord();
    await store.save(record);

    const row = await prisma.decision.findUniqueOrThrow({
      where: { reportHash: 'hash-1' },
      include: { duplicateCandidates: true, tokenUsages: true, stageTimings: true },
    });

    expect(row.transientRetriesConsumed).toBe(2);
    expect(row.duplicateCandidates.map((c) => ({ issue_number: c.issueNumber, similarity: c.similarity, same_bug: c.sameBug }))).toEqual(
      record.duplicate_candidates_considered,
    );
    expect(
      row.tokenUsages.map((t) => ({
        call: t.call,
        candidate_issue_number: t.candidateIssueNumber,
        input_tokens: t.inputTokens,
        output_tokens: t.outputTokens,
      })),
    ).toEqual(record.token_usage);
    expect(
      row.stageTimings.map((s) => ({ stage: s.stage, duration_ms: s.durationMs, candidate_issue_number: s.candidateIssueNumber })),
    ).toEqual(record.stage_timings_ms);
  });

  it('tryClaim inserts only the first call for a report_hash and reports the loser (F3 audit finding)', async () => {
    const record = { ...sampleRecord(), status: 'pending' as const };

    expect(await store.tryClaim(record)).toBe(true);
    expect(await store.tryClaim({ ...record, gitea_issue_number: 999 })).toBe(false);

    // the loser's payload never overwrote the winner's row
    const winner = await store.get('hash-1');
    expect(winner!.gitea_issue_number).toBe(record.gitea_issue_number);
  });

  it('get() returns null for a report_hash with no record', async () => {
    expect(await store.get('no-such-hash')).toBeNull();
  });

  it('new fields stay nullable/additive -- an update overwrites the row rather than merging', async () => {
    const pending: DecisionRecord = { ...sampleRecord(), status: 'pending', token_usage: [], stage_timings_ms: [] };
    await store.save(pending);

    const completed = sampleRecord();
    await store.save(completed);

    expect(await store.get('hash-1')).toEqual(completed);
  });
});
