"""Regression test for the code-review finding: a bug report_type with a
missing severity or empty components must fail Pydantic validation (so the
validation-retry budget engages) rather than silently defaulting to
None/[] and later crashing an unrelated assertion in pipeline.py.
"""

import pytest
from pydantic import ValidationError

from app.schemas import TriageDecision


def test_bug_report_missing_severity_fails_validation():
    with pytest.raises(ValidationError, match="severity"):
        TriageDecision(title="t", report_type="bug", severity=None, components=["frontend"])


def test_bug_report_empty_components_fails_validation():
    with pytest.raises(ValidationError, match="components"):
        TriageDecision(title="t", report_type="bug", severity="low", components=[])


def test_non_bug_report_does_not_require_severity_or_components():
    TriageDecision(title="t", report_type="feature_request", severity=None, components=[])
    TriageDecision(title="t", report_type="spam_or_off_topic", severity=None, components=[])
    TriageDecision(title="t", report_type="unclear", severity=None, components=[])
