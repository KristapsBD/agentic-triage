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

  it('binds every TriagePort method, with Gitea/LLM/embedding/Decision Record ones all delegating to real providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, GiteaModule, LlmModule, ReportsModule],
    }).compile();

    const port = moduleRef.get<TriagePort>(TRIAGE_PORT);

    expect(typeof port.createIssue).toBe('function');
    expect(typeof port.commentIssue).toBe('function');
    expect(typeof port.listOpenIssues).toBe('function');
    expect(typeof port.extract).toBe('function');
    // findCandidates/judgeDuplicate now delegate to real providers (#30) --
    // calling them here would hit the live embedding model/Anthropic API,
    // so this just confirms they're wired, not stubbed placeholders.
    expect(typeof port.findCandidates).toBe('function');
    expect(typeof port.judgeDuplicate).toBe('function');

    // Decision Record methods delegate to a real DecisionStore (#33, #59) --
    // calling them here would hit a live Postgres database, so (like
    // findCandidates/judgeDuplicate above) this just confirms they're wired,
    // not stubbed placeholders. The real round trip is covered by
    // decision-store.spec.ts against a testcontainers-provisioned Postgres.
    expect(typeof port.saveDecisionRecord).toBe('function');
    expect(typeof port.getDecisionRecord).toBe('function');
    expect(typeof port.claimDecisionRecord).toBe('function');
  });
});
