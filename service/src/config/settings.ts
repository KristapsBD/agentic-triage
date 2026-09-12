/** TS mirror of service/app/config.py's Settings dataclass + load_settings(). */

export interface Settings {
  gitea_url: string;
  gitea_repo_owner: string;
  gitea_repo_name: string;
  gitea_token: string;
  anthropic_api_key: string;
  anthropic_model: string;
  database_url: string;
  embedding_model_name: string;
  duplicate_similarity_floor: number;
  duplicate_top_k: number;
  validation_retry_budget: number;
  transient_retry_budget: number;
  transient_retry_backoff_seconds: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key] ?? fallback;
}

function optionalNumber(env: NodeJS.ProcessEnv, key: string, fallback: string): number {
  return Number(env[key] ?? fallback);
}

function loadGiteaSettings(env: NodeJS.ProcessEnv) {
  return {
    gitea_url: optionalString(env, 'GITEA_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    gitea_repo_owner: required(env, 'GITEA_REPO_OWNER'),
    gitea_repo_name: required(env, 'GITEA_REPO_NAME'),
    gitea_token: optionalString(env, 'GITEA_TOKEN', ''),
  };
}

function loadAnthropicSettings(env: NodeJS.ProcessEnv) {
  return {
    anthropic_api_key: optionalString(env, 'ANTHROPIC_API_KEY', ''),
    anthropic_model: optionalString(env, 'ANTHROPIC_MODEL', 'claude-sonnet-5'),
  };
}

function loadDuplicateDetectionSettings(env: NodeJS.ProcessEnv) {
  return {
    database_url: optionalString(
      env,
      'DATABASE_URL',
      'postgresql://triage:triage@localhost:5432/triage?schema=public',
    ),
    embedding_model_name: optionalString(env, 'EMBEDDING_MODEL_NAME', 'Xenova/all-MiniLM-L6-v2'),
    duplicate_similarity_floor: optionalNumber(env, 'DUPLICATE_SIMILARITY_FLOOR', '0.35'),
    duplicate_top_k: optionalNumber(env, 'DUPLICATE_TOP_K', '3'),
  };
}

function loadRetrySettings(env: NodeJS.ProcessEnv) {
  return {
    validation_retry_budget: optionalNumber(env, 'VALIDATION_RETRY_BUDGET', '2'),
    transient_retry_budget: optionalNumber(env, 'TRANSIENT_RETRY_BUDGET', '3'),
    transient_retry_backoff_seconds: optionalNumber(env, 'TRANSIENT_RETRY_BACKOFF_SECONDS', '1.0'),
  };
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    ...loadGiteaSettings(env),
    ...loadAnthropicSettings(env),
    ...loadDuplicateDetectionSettings(env),
    ...loadRetrySettings(env),
  };
}

export const SETTINGS = Symbol('SETTINGS');
