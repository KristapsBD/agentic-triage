import { loadSettings } from './settings';

describe('loadSettings', () => {
  it('throws when a required variable is missing', () => {
    expect(() => loadSettings({})).toThrow(/GITEA_REPO_OWNER/);
  });

  it('applies defaults and strips a trailing slash from GITEA_URL', () => {
    const settings = loadSettings({
      GITEA_URL: 'http://localhost:3000/',
      GITEA_REPO_OWNER: 'triageadmin',
      GITEA_REPO_NAME: 'acme-app',
    });

    expect(settings.gitea_url).toBe('http://localhost:3000');
    expect(settings.gitea_token).toBe('');
    expect(settings.duplicate_similarity_floor).toBe(0.35);
    expect(settings.transient_retry_budget).toBe(3);
  });

  it('honors overrides for numeric settings', () => {
    const settings = loadSettings({
      GITEA_REPO_OWNER: 'triageadmin',
      GITEA_REPO_NAME: 'acme-app',
      DUPLICATE_SIMILARITY_FLOOR: '0.5',
      TRANSIENT_RETRY_BUDGET: '5',
    });

    expect(settings.duplicate_similarity_floor).toBe(0.5);
    expect(settings.transient_retry_budget).toBe(5);
  });
});
