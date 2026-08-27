"""Composes the real Gitea client, Anthropic LLM client, local embedding
index, and SQLite decision store into one TriagePort implementation.
"""

from __future__ import annotations

from app.config import Settings
from app.decision_store import SqliteDecisionStore
from app.embeddings import EmbeddingIndex
from app.gitea_client import GiteaClient
from app.llm_client import AnthropicLLMClient
from app.schemas import DecisionRecord, DuplicateCandidate, DuplicateJudgment, GiteaIssue, TriageDecision


class RealPort:
    def __init__(self, settings: Settings):
        self._gitea = GiteaClient(
            settings.gitea_url, settings.gitea_repo_owner, settings.gitea_repo_name, settings.gitea_token
        )
        self._llm = AnthropicLLMClient(settings.anthropic_api_key, settings.anthropic_model)
        self._embeddings = EmbeddingIndex(
            settings.embedding_model_name, settings.duplicate_similarity_floor, settings.duplicate_top_k
        )
        self._store = SqliteDecisionStore(settings.decision_db_path)

    def create_issue(self, title: str, body: str, labels: list[str]) -> int:
        return self._gitea.create_issue(title, body, labels)

    def comment_issue(self, issue_number: int, body: str) -> None:
        self._gitea.comment_issue(issue_number, body)

    def list_open_issues(self) -> list[GiteaIssue]:
        return self._gitea.list_open_issues()

    def extract(self, raw_report: str, feedback: str | None = None) -> TriageDecision:
        return self._llm.extract(raw_report, feedback=feedback)

    def find_candidates(self, raw_report: str, open_issues: list[GiteaIssue]) -> list[DuplicateCandidate]:
        return self._embeddings.find_candidates(raw_report, open_issues)

    def judge_duplicate(self, raw_report: str, candidate: DuplicateCandidate) -> DuplicateJudgment:
        return self._llm.judge_duplicate(raw_report, candidate)

    def save_decision_record(self, record: DecisionRecord) -> None:
        self._store.save(record)

    def get_decision_record(self, report_hash: str) -> DecisionRecord | None:
        return self._store.get(report_hash)
