import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from app.config import Settings
from tests.fake_port import FakePort


@pytest.fixture
def settings() -> Settings:
    return Settings(
        gitea_url="http://localhost:3000",
        gitea_repo_owner="triageadmin",
        gitea_repo_name="bug-triage",
        gitea_token="x",
        anthropic_api_key="x",
        anthropic_model="claude-sonnet-5",
        decision_db_path=":memory:",
        embedding_model_name="sentence-transformers/all-MiniLM-L6-v2",
        duplicate_similarity_floor=0.35,
        duplicate_top_k=3,
        validation_retry_budget=2,
        transient_retry_budget=3,
        transient_retry_backoff_seconds=0.0,
    )


@pytest.fixture
def port() -> FakePort:
    return FakePort()
