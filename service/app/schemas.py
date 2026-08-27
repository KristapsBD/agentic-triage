"""Typed schemas for the Triage Decision pipeline.

ADR-0007: no model output reaches Gitea except through these fixed fields.
There is no free-text label, no shell interpolation, no unvalidated
API parameter anywhere downstream of an LLM call.
"""

from __future__ import annotations

import time
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator, model_validator

from app.labels import COMPONENTS, SEVERITIES

ReportType = Literal["bug", "feature_request", "unclear", "spam_or_off_topic"]
Severity = Literal["critical", "high", "medium", "low"]
Component = Literal["frontend", "backend", "api", "auth", "database", "infra", "docs", "unknown"]
SameBugJudgment = Literal["yes", "possibly", "no"]
DuplicateTier = Literal["clear_duplicate", "possible_duplicate", "not_a_duplicate"]
Outcome = Literal[
    "issue_created",
    "duplicate_commented",
    "review_flagged",
    "feature_request_filed",
    "dropped_spam",
]


class TriageDecision(BaseModel):
    """The model's forced-tool-use structured output, re-validated here.

    severity/components are only meaningful when report_type == "bug"; the
    model is instructed to leave them at their defaults otherwise, but this
    schema does not trust that instruction was followed — the pipeline
    ignores these fields entirely for non-bug report types regardless of
    what's populated.
    """

    title: str = Field(min_length=1, max_length=200)
    report_type: ReportType
    severity: Severity | None = None
    components: list[Component] = Field(default_factory=list)
    repro_steps: list[str] | None = None
    supporting_evidence: str | None = None
    distinct_issues: list[str] = Field(default_factory=list)

    @field_validator("components")
    @classmethod
    def _dedupe_components(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for c in v:
            if c not in seen:
                seen.append(c)
        return seen

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @model_validator(mode="after")
    def _bug_reports_require_severity_and_components(self) -> "TriageDecision":
        # The tool schema's `required` list only hints the model; it isn't a
        # structural guarantee. Without this, an omitted severity/components
        # on a bug report would pass validation as None/[] and later hit an
        # unrelated assertion deep in pipeline.py's routing logic — an
        # unhandled 500 instead of engaging the validation-retry budget
        # (ADR-0008) like any other malformed structured output.
        if self.report_type == "bug":
            if self.severity is None:
                raise ValueError("severity is required when report_type is 'bug'")
            if not self.components:
                raise ValueError(
                    "components must include at least one value (use 'unknown' if unclear) "
                    "when report_type is 'bug'"
                )
        return self

    @property
    def is_bundled(self) -> bool:
        return len(self.distinct_issues) > 1


class DuplicateCandidate(BaseModel):
    issue_number: int
    title: str
    body: str
    similarity: float


class DuplicateJudgment(BaseModel):
    same_bug: SameBugJudgment
    rationale: str = ""


class DuplicateVerdict(BaseModel):
    tier: DuplicateTier
    target_issue: int | None = None
    similarity: float | None = None
    rationale: str = ""


class GiteaIssue(BaseModel):
    number: int
    title: str
    body: str
    labels: list[str] = Field(default_factory=list)
    state: str = "open"


class PendingAction(BaseModel):
    """A Gitea action computed once and safe to retry idempotently."""

    type: Literal["create_issue", "comment", "none"]
    title: str | None = None
    body: str | None = None
    labels: list[str] = Field(default_factory=list)
    target_issue: int | None = None


class DecisionRecord(BaseModel):
    report_hash: str
    raw_report: str
    status: Literal["pending", "processing", "completed", "gitea_call_failed"] = "pending"
    triage_decision: TriageDecision | None = None
    duplicate_verdict: DuplicateVerdict | None = None
    pending_action: PendingAction | None = None
    outcome: Outcome | None = None
    gitea_issue_number: int | None = None
    error: str | None = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def to_envelope(self) -> "ResponseEnvelope":
        assert self.outcome is not None, "to_envelope() called before an outcome was decided"
        return ResponseEnvelope(
            outcome=self.outcome,
            gitea_issue_number=self.gitea_issue_number,
            triage_decision=self.triage_decision,
            duplicate_verdict=self.duplicate_verdict,
        )


class ResponseEnvelope(BaseModel):
    outcome: Outcome
    gitea_issue_number: int | None = None
    triage_decision: TriageDecision | None = None
    duplicate_verdict: DuplicateVerdict | None = None


class ReportRequest(BaseModel):
    raw_report: str


assert set(COMPONENTS) == set(get_args(Component))  # keep labels.py and schema literal in sync
assert set(SEVERITIES) == set(get_args(Severity))
