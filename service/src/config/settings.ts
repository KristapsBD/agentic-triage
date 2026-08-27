/** TS mirror of service/app/config.py's Settings dataclass + load_settings(). */

export interface Settings {
  gitea_url: string;
  gitea_repo_owner: string;
  gitea_repo_name: string;
  gitea_token: string;
  anthropic_api_key: string;
  anthropic_model: string;
  decision_db_path: string;
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

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    gitea_url: (env.GITEA_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    gitea_repo_owner: required(env, 'GITEA_REPO_OWNER'),
    gitea_repo_name: required(env, 'GITEA_REPO_NAME'),
    gitea_token: env.GITEA_TOKEN ?? '',
    anthropic_api_key: env.ANTHROPIC_API_KEY ?? '',
    anthropic_model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    decision_db_path: env.DECISION_DB_PATH ?? '/data/decisions.sqlite3',
    embedding_model_name: env.EMBEDDING_MODEL_NAME ?? 'Xenova/all-MiniLM-L6-v2',
    duplicate_similarity_floor: Number(env.DUPLICATE_SIMILARITY_FLOOR ?? '0.35'),
    duplicate_top_k: Number(env.DUPLICATE_TOP_K ?? '3'),
    validation_retry_budget: Number(env.VALIDATION_RETRY_BUDGET ?? '2'),
    transient_retry_budget: Number(env.TRANSIENT_RETRY_BUDGET ?? '3'),
    transient_retry_backoff_seconds: Number(env.TRANSIENT_RETRY_BACKOFF_SECONDS ?? '1.0'),
  };
}

export const SETTINGS = Symbol('SETTINGS');
