import { GiteaClient } from './gitea-client';
import { DEFAULT_LABEL_COLOR } from './labels';
import { Settings } from '../config/settings';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const settings: Settings = {
  gitea_url: 'http://gitea.local',
  gitea_repo_owner: 'triageadmin',
  gitea_repo_name: 'acme-app',
  gitea_token: 'test-token',
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

describe('GiteaClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('creates missing labels and reuses existing ones when creating an issue', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 1, name: 'frontend' }]))
      .mockResolvedValueOnce(jsonResponse(201, { id: 2, name: 'high' }))
      .mockResolvedValueOnce(jsonResponse(201, { number: 42 }));

    const client = new GiteaClient(settings);
    const number = await client.createIssue('t', 'b', ['frontend', 'high']);

    expect(number).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, , createIssueCall] = fetchMock.mock.calls;
    const body = JSON.parse(createIssueCall[1].body);
    expect(body).toEqual({ title: 't', body: 'b', labels: [1, 2] });
  });

  it('caches label ids across calls within one client instance', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: 1, name: 'frontend' }]));
    const client = new GiteaClient(settings);

    await client.ensureLabels(['frontend']);
    await client.ensureLabels(['frontend']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('comments on an issue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 99 }));
    const client = new GiteaClient(settings);

    await client.commentIssue(7, 'still happening');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://gitea.local/api/v1/repos/triageadmin/acme-app/issues/7/comments',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('paginates through open issues until a short page is returned', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      number: i + 1,
      title: `t${i}`,
      labels: [],
    }));
    const page2 = [{ number: 51, title: 't51', labels: [{ id: 1, name: 'backend' }] }];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, page1))
      .mockResolvedValueOnce(jsonResponse(200, page2));

    const client = new GiteaClient(settings);
    const issues = await client.listOpenIssues();

    expect(issues).toHaveLength(51);
    expect(issues[50]).toEqual({
      number: 51,
      title: 't51',
      body: '',
      labels: ['backend'],
      state: 'open',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finds an issue by exact title match, ignoring near-matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        { number: 1, title: 'Login button unresponsive on mobile Safari (dup)', labels: [] },
        { number: 2, title: 'Login button unresponsive on mobile Safari', labels: [] },
      ]),
    );
    const client = new GiteaClient(settings);

    const found = await client.findIssueByTitle('Login button unresponsive on mobile Safari');

    expect(found?.number).toBe(2);
  });

  it('returns null when no issue matches the title', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const client = new GiteaClient(settings);

    expect(await client.findIssueByTitle('nope')).toBeNull();
  });

  it('raises a non-retryable GiteaError with the status code and truncated body on a 4xx response', async () => {
    const longBody = 'x'.repeat(400);
    fetchMock.mockResolvedValueOnce(textResponse(422, longBody));
    const client = new GiteaClient(settings);

    await expect(client.commentIssue(1, 'x')).rejects.toMatchObject({
      status: 422,
      retryable: false,
      message: `Gitea rejected request (422): ${'x'.repeat(300)}`,
    });
  });

  it('raises a retryable GiteaError with the status code and truncated body on a 5xx response', async () => {
    const longBody = 'y'.repeat(400);
    fetchMock.mockResolvedValueOnce(textResponse(503, longBody));
    const client = new GiteaClient(settings);

    await expect(client.commentIssue(1, 'x')).rejects.toMatchObject({
      status: 503,
      retryable: true,
      message: `Gitea returned 503: ${'y'.repeat(300)}`,
    });
  });

  it('does not throw on a 2xx or 3xx response', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(200, ''));
    const client = new GiteaClient(settings);

    await expect(client.commentIssue(1, 'x')).resolves.toBeUndefined();
  });

  it('raises a retryable GiteaError when the network request itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new GiteaClient(settings);

    await expect(client.commentIssue(1, 'x')).rejects.toMatchObject({
      status: undefined,
      retryable: true,
      message: 'Gitea request failed: ECONNREFUSED',
    });
  });

  it('sends the configured base URL, method, and auth headers on each request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 1 }));
    const client = new GiteaClient(settings);

    await client.commentIssue(7, 'hi');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://gitea.local/api/v1/repos/triageadmin/acme-app/issues/7/comments',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'token test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'hi' }),
      }),
    );
  });

  it('URL-encodes the title when searching for an issue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    const client = new GiteaClient(settings);

    await client.findIssueByTitle('a & b');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`q=${encodeURIComponent('a & b')}`),
      expect.anything(),
    );
  });

  it('creates a missing label with its configured color, falling back to the default color', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(201, { id: 5, name: 'totally-unknown-label' }));
    const client = new GiteaClient(settings);

    await client.ensureLabels(['totally-unknown-label']);

    const [, createCall] = fetchMock.mock.calls;
    expect(JSON.parse(createCall[1].body)).toEqual({
      name: 'totally-unknown-label',
      color: DEFAULT_LABEL_COLOR,
    });
  });

  it('throws when a label is neither found nor created', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(201, { id: 1, name: 'a-different-label' }));
    const client = new GiteaClient(settings);

    await expect(client.ensureLabels(['expected-label'])).rejects.toThrow(
      'Label "expected-label" was neither found nor created',
    );
  });

  it('stops paginating exactly when a full page is followed by an empty page', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      number: i + 1,
      title: `t${i}`,
      labels: [],
    }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, fullPage))
      .mockResolvedValueOnce(jsonResponse(200, []));

    const client = new GiteaClient(settings);
    const issues = await client.listOpenIssues();

    expect(issues).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
