import { loadSettings } from './settings';

const REQUIRED_ENV = {
  GITEA_REPO_OWNER: 'triageadmin',
  GITEA_REPO_NAME: 'acme-app',
};

describe('loadSettings', () => {
  it('throws when GITEA_REPO_OWNER is missing', () => {
    expect(() => loadSettings({ GITEA_REPO_NAME: 'acme-app' })).toThrow(
      'Missing required environment variable: GITEA_REPO_OWNER',
    );
  });

  it('throws when GITEA_REPO_NAME is missing', () => {
    expect(() => loadSettings({ GITEA_REPO_OWNER: 'triageadmin' })).toThrow(
      'Missing required environment variable: GITEA_REPO_NAME',
    );
  });

  it('applies every default when only the required vars are set', () => {
    const settings = loadSettings({ ...REQUIRED_ENV });

    expect(settings).toEqual({
      gitea_url: 'http://localhost:3000',
      gitea_repo_owner: 'triageadmin',
      gitea_repo_name: 'acme-app',
      gitea_token: '',
      anthropic_api_key: '',
      anthropic_model: 'claude-sonnet-5',
      decision_db_path: '/data/decisions.sqlite3',
      database_url: 'postgresql://triage:triage@localhost:5432/triage?schema=public',
      embedding_model_name: 'Xenova/all-MiniLM-L6-v2',
      duplicate_similarity_floor: 0.35,
      duplicate_top_k: 3,
      validation_retry_budget: 2,
      transient_retry_budget: 3,
      transient_retry_backoff_seconds: 1.0,
    });
  });

  it('strips one or more trailing slashes from GITEA_URL', () => {
    expect(loadSettings({ ...REQUIRED_ENV, GITEA_URL: 'http://localhost:3000/' }).gitea_url).toBe(
      'http://localhost:3000',
    );
    expect(loadSettings({ ...REQUIRED_ENV, GITEA_URL: 'http://localhost:3000///' }).gitea_url).toBe(
      'http://localhost:3000',
    );
  });

  it('preserves a GITEA_URL with no trailing slash', () => {
    expect(
      loadSettings({ ...REQUIRED_ENV, GITEA_URL: 'https://gitea.example.com' }).gitea_url,
    ).toBe('https://gitea.example.com');
  });

  it('honors an override for every string setting', () => {
    const settings = loadSettings({
      ...REQUIRED_ENV,
      GITEA_TOKEN: 'gitea-secret',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      ANTHROPIC_MODEL: 'claude-opus-5',
      DECISION_DB_PATH: '/tmp/decisions.sqlite3',
      EMBEDDING_MODEL_NAME: 'custom/embedding-model',
    });

    expect(settings.gitea_token).toBe('gitea-secret');
    expect(settings.anthropic_api_key).toBe('anthropic-secret');
    expect(settings.anthropic_model).toBe('claude-opus-5');
    expect(settings.decision_db_path).toBe('/tmp/decisions.sqlite3');
    expect(settings.embedding_model_name).toBe('custom/embedding-model');
  });

  it('honors an override for every numeric setting', () => {
    const settings = loadSettings({
      ...REQUIRED_ENV,
      DUPLICATE_SIMILARITY_FLOOR: '0.5',
      DUPLICATE_TOP_K: '7',
      VALIDATION_RETRY_BUDGET: '4',
      TRANSIENT_RETRY_BUDGET: '5',
      TRANSIENT_RETRY_BACKOFF_SECONDS: '2.5',
    });

    expect(settings.duplicate_similarity_floor).toBe(0.5);
    expect(settings.duplicate_top_k).toBe(7);
    expect(settings.validation_retry_budget).toBe(4);
    expect(settings.transient_retry_budget).toBe(5);
    expect(settings.transient_retry_backoff_seconds).toBe(2.5);
  });

  it('treats an explicit empty string as a real value, not a missing one', () => {
    const settings = loadSettings({ ...REQUIRED_ENV, GITEA_TOKEN: '' });

    expect(settings.gitea_token).toBe('');
  });

  it('coerces numeric overrides through Number(), not string comparison', () => {
    const settings = loadSettings({ ...REQUIRED_ENV, DUPLICATE_TOP_K: '10' });

    expect(settings.duplicate_top_k).toBe(10);
    expect(settings.duplicate_top_k).not.toBe('10');
  });
});
