import { Test } from '@nestjs/testing';
import { ConfigModule } from '../config/config.module';
import { GiteaModule } from '../gitea/gitea.module';
import { LlmModule } from '../llm/llm.module';
import { PipelineService } from './pipeline.service';
import { ReportsModule } from './reports.module';
import { TRIAGE_PORT, TriagePort } from './triage-port.interface';

describe('ReportsModule wiring', () => {
  const env = { ...process.env };

  beforeAll(() => {
    process.env.GITEA_REPO_OWNER = 'triageadmin';
    process.env.GITEA_REPO_NAME = 'acme-app';
  });

  afterAll(() => {
    process.env = env;
  });

  it('resolves PipelineService through Nest DI, depending only on TriagePort', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, GiteaModule, LlmModule, ReportsModule],
    }).compile();

    expect(moduleRef.get(PipelineService)).toBeInstanceOf(PipelineService);
  });

  it('binds every TriagePort method, with Gitea/LLM ones delegating and the rest stubbed', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, GiteaModule, LlmModule, ReportsModule],
    }).compile();

    const port = moduleRef.get<TriagePort>(TRIAGE_PORT);

    expect(typeof port.createIssue).toBe('function');
    expect(typeof port.commentIssue).toBe('function');
    expect(typeof port.listOpenIssues).toBe('function');
    expect(typeof port.extract).toBe('function');
    await expect(port.findCandidates('report text', [])).rejects.toThrow(/not implemented/);
    await expect(
      port.judgeDuplicate('report text', { issue_number: 1, title: 't', body: 'b', similarity: 0.5 }),
    ).rejects.toThrow(/not implemented/);
    await expect(
      port.saveDecisionRecord({
        report_hash: 'h',
        raw_report: 'r',
        status: 'pending',
        triage_decision: null,
        duplicate_verdict: null,
        pending_action: null,
        outcome: null,
        gitea_issue_number: null,
        error: null,
        created_at: 0,
        updated_at: 0,
      }),
    ).rejects.toThrow(/not implemented/);
    await expect(port.getDecisionRecord('h')).rejects.toThrow(/not implemented/);
  });
});
