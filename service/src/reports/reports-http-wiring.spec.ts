/**
 * Ticket #34: proves ReportRequestPipe and PipelineExceptionFilter are
 * actually wired into the running app, not just correct in isolation. Boots
 * the real AppModule (env-configured like reports.module.spec.ts) with
 * TRIAGE_PORT swapped for a FakeTriagePort so no live Gitea/Anthropic call
 * happens, then drives it through Fastify's inject() — the same mechanism
 * app.listen() uses under the hood, so this exercises the real route/pipe/
 * filter wiring without a supertest dependency this repo doesn't have.
 */

import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { TRIAGE_PORT } from './triage-port.interface';
import { FakeTriagePort } from './testing/fake-triage-port';
import { TransientAPIError } from './pipeline.errors';

describe('POST /reports HTTP contract (wired through the real AppModule)', () => {
  const env = { ...process.env };
  let app: NestFastifyApplication;
  let port: FakeTriagePort;

  beforeAll(() => {
    process.env.GITEA_REPO_OWNER = 'triageadmin';
    process.env.GITEA_REPO_NAME = 'acme-app';
    // Real settings default this to 1s; zero it so the exhausted-retry test
    // doesn't sleep through the transient budget for real.
    process.env.TRANSIENT_RETRY_BACKOFF_SECONDS = '0';
  });

  afterAll(() => {
    process.env = env;
  });

  beforeEach(async () => {
    port = new FakeTriagePort();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TRIAGE_PORT)
      .useValue(port)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects whitespace-only raw_report with 400 before touching the port', async () => {
    const res = await app.inject({ method: 'POST', url: '/reports', payload: { raw_report: '   \n\t ' } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error_code: 'empty_report',
      message: 'raw_report must not be empty or whitespace-only',
    });
    expect(port.calls).toHaveLength(0);
  });

  it('returns 502 with error_code/report_hash once the transient retry budget is exhausted', async () => {
    port.extractionQueue = Array(4).fill(new TransientAPIError('down'));

    const res = await app.inject({ method: 'POST', url: '/reports', payload: { raw_report: 'flaky infra case' } });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { error_code: string; report_hash: string };
    expect(body.error_code).toBe('llm_unavailable');
    expect(body.report_hash).toEqual(expect.any(String));
    expect(body.report_hash.length).toBeGreaterThan(0);
  });

  it('returns 200 with the full envelope for a normal bug report', async () => {
    port.extractionQueue = [
      {
        title: 't',
        report_type: 'bug',
        severity: 'medium',
        components: ['backend'],
        repro_steps: null,
        supporting_evidence: null,
        distinct_issues: [],
      },
    ];

    const res = await app.inject({ method: 'POST', url: '/reports', payload: { raw_report: 'the api returns 500 sometimes' } });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { outcome: string; gitea_issue_number: number | null };
    expect(body.outcome).toBe('issue_created');
    expect(body.gitea_issue_number).not.toBeNull();
  });

  it('a dropped_spam outcome is 2xx, not an error', async () => {
    port.extractionQueue = [
      {
        title: 'n/a',
        report_type: 'spam_or_off_topic',
        severity: null,
        components: [],
        repro_steps: null,
        supporting_evidence: null,
        distinct_issues: [],
      },
    ];

    const res = await app.inject({ method: 'POST', url: '/reports', payload: { raw_report: 'buy cheap watches now' } });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { outcome: string }).outcome).toBe('dropped_spam');
  });
});
