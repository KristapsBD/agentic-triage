import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    gitea_url: str
    gitea_repo_owner: str
    gitea_repo_name: str
    gitea_token: str
    anthropic_api_key: str
    anthropic_model: str
    decision_db_path: str
    embedding_model_name: str
    duplicate_similarity_floor: float
    duplicate_top_k: int
    validation_retry_budget: int
    transient_retry_budget: int
    transient_retry_backoff_seconds: float


def load_settings() -> Settings:
    return Settings(
        gitea_url=os.environ.get("GITEA_URL", "http://localhost:3000").rstrip("/"),
        gitea_repo_owner=os.environ["GITEA_REPO_OWNER"],
        gitea_repo_name=os.environ["GITEA_REPO_NAME"],
        gitea_token=os.environ.get("GITEA_TOKEN", ""),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
        decision_db_path=os.environ.get("DECISION_DB_PATH", "/data/decisions.sqlite3"),
        embedding_model_name=os.environ.get(
            "EMBEDDING_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2"
        ),
        duplicate_similarity_floor=float(os.environ.get("DUPLICATE_SIMILARITY_FLOOR", "0.35")),
        duplicate_top_k=int(os.environ.get("DUPLICATE_TOP_K", "3")),
        validation_retry_budget=int(os.environ.get("VALIDATION_RETRY_BUDGET", "2")),
        transient_retry_budget=int(os.environ.get("TRANSIENT_RETRY_BUDGET", "3")),
        transient_retry_backoff_seconds=float(os.environ.get("TRANSIENT_RETRY_BACKOFF_SECONDS", "1.0")),
    )
