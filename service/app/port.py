"""The single seam every orchestration decision in pipeline.py depends on.

Bundles both the Gitea-facing operations (ticket #6) and the LLM/embedding-
facing ones (extract, find_candidates, judge_duplicate — filled in by later
tickets) behind one Protocol, so tests can substitute one fake implementation
covering the whole pipeline rather than mocking several separate clients.
"""

from __future__ import annotations

from typing import Protocol

from app.schemas import (
    DecisionRecord,
    DuplicateCandidate,
    DuplicateJudgment,
    GiteaIssue,
    TriageDecision,
)


class TriagePort(Protocol):
    # --- Gitea-facing ---
    def create_issue(self, title: str, body: str, labels: list[str]) -> int: ...

    def comment_issue(self, issue_number: int, body: str) -> None: ...

    def list_open_issues(self) -> list[GiteaIssue]: ...

    # --- LLM/embedding-facing ---
    def extract(self, raw_report: str, feedback: str | None = None) -> TriageDecision: ...

    def find_candidates(
        self, raw_report: str, open_issues: list[GiteaIssue]
    ) -> list[DuplicateCandidate]: ...

    def judge_duplicate(
        self, raw_report: str, candidate: DuplicateCandidate
    ) -> DuplicateJudgment: ...

    # --- Decision Record persistence ---
    def save_decision_record(self, record: DecisionRecord) -> None: ...

    def get_decision_record(self, report_hash: str) -> DecisionRecord | None: ...
