"""A single fake implementation of TriagePort for orchestration tests.

Every pipeline test drives this fake rather than mocking Gitea/Anthropic/
sentence-transformers separately — see spec's "Testing Decisions".
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.errors import ExtractionValidationError, GiteaError, TransientAPIError
from app.schemas import DecisionRecord, DuplicateCandidate, DuplicateJudgment, GiteaIssue, TriageDecision


@dataclass
class Call:
    op: str
    args: tuple


class FakePort:
    def __init__(self) -> None:
        self.calls: list[Call] = []
        self._records: dict[str, DecisionRecord] = {}
        self._issue_counter = 100
        self.open_issues: list[GiteaIssue] = []

        # Scriptable behavior, consumed in order where a queue is used.
        self.extraction_queue: list[TriageDecision | ExtractionValidationError | TransientAPIError] = []
        self.candidates_by_report: dict[str, list[DuplicateCandidate]] = {}
        self.judgments_by_candidate: dict[int, DuplicateJudgment] = {}
        self.create_issue_should_fail = False
        self.comment_should_fail = False

    # --- Gitea-facing ---
    def create_issue(self, title: str, body: str, labels: list[str]) -> int:
        self.calls.append(Call("create_issue", (title, body, tuple(labels))))
        if self.create_issue_should_fail:
            raise GiteaError("simulated Gitea outage")
        self._issue_counter += 1
        self.open_issues.append(GiteaIssue(number=self._issue_counter, title=title, body=body, labels=labels))
        return self._issue_counter

    def comment_issue(self, issue_number: int, body: str) -> None:
        self.calls.append(Call("comment_issue", (issue_number, body)))
        if self.comment_should_fail:
            raise GiteaError("simulated Gitea outage")

    def list_open_issues(self) -> list[GiteaIssue]:
        self.calls.append(Call("list_open_issues", ()))
        return list(self.open_issues)

    # --- LLM/embedding-facing ---
    def extract(self, raw_report: str, feedback: str | None = None) -> TriageDecision:
        self.calls.append(Call("extract", (raw_report, feedback)))
        if not self.extraction_queue:
            raise AssertionError("FakePort.extraction_queue exhausted")
        item = self.extraction_queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def find_candidates(self, raw_report: str, open_issues: list[GiteaIssue]) -> list[DuplicateCandidate]:
        self.calls.append(Call("find_candidates", (raw_report,)))
        return self.candidates_by_report.get(raw_report, [])

    def judge_duplicate(self, raw_report: str, candidate: DuplicateCandidate) -> DuplicateJudgment:
        self.calls.append(Call("judge_duplicate", (raw_report, candidate.issue_number)))
        return self.judgments_by_candidate[candidate.issue_number]

    # --- Decision Record persistence ---
    def save_decision_record(self, record: DecisionRecord) -> None:
        self.calls.append(Call("save_decision_record", (record.report_hash, record.status)))
        self._records[record.report_hash] = record.model_copy(deep=True)

    def get_decision_record(self, report_hash: str) -> DecisionRecord | None:
        self.calls.append(Call("get_decision_record", (report_hash,)))
        rec = self._records.get(report_hash)
        return rec.model_copy(deep=True) if rec else None

    def op_names(self) -> list[str]:
        return [c.op for c in self.calls]
