import { FastifyReply } from 'fastify';
import { HealthController } from './health.controller';
import { Settings } from '../config/settings';

const settings: Settings = {
  gitea_url: 'http://gitea.local',
  gitea_repo_owner: 'triageadmin',
  gitea_repo_name: 'acme-app',
  gitea_token: '',
  anthropic_api_key: '',
  anthropic_model: 'claude-sonnet-5',
  database_url: 'postgresql://triage:triage@localhost:5432/triage?schema=public',
  embedding_model_name: 'Xenova/all-MiniLM-L6-v2',
  duplicate_similarity_floor: 0.35,
  duplicate_top_k: 3,
  validation_retry_budget: 2,
  transient_retry_budget: 3,
  transient_retry_backoff_seconds: 1,
};

function mockReply(): FastifyReply {
  const reply = { status: jest.fn(), send: jest.fn() } as unknown as FastifyReply;
  (reply.status as jest.Mock).mockReturnValue(reply);
  return reply;
}

describe('HealthController', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns 200 when Gitea is reachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const controller = new HealthController(settings);
    const reply = mockReply();

    await controller.check(reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ status: 'ok', gitea: 'reachable' });
  });

  it('returns 503 when Gitea responds with an error status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const controller = new HealthController(settings);
    const reply = mockReply();

    await controller.check(reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({ status: 'not_ready', gitea: 'unreachable' });
  });

  it('returns 503 when Gitea is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const controller = new HealthController(settings);
    const reply = mockReply();

    await controller.check(reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({ status: 'not_ready', gitea: 'unreachable' });
  });
});
