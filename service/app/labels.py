"""Canonical Gitea label strings this service applies.

Component and severity labels are bare values matching Set A's convention
(e.g. `frontend`, `high`). Workflow labels reuse this repo's existing
triage vocabulary (docs/agents/triage-labels.md) per ADR-0006.
"""

COMPONENTS = ("frontend", "backend", "api", "auth", "database", "infra", "docs", "unknown")
SEVERITIES = ("critical", "high", "medium", "low")

NEEDS_TRIAGE = "needs-triage"
NEEDS_INFO = "needs-info"
FEATURE_REQUEST = "feature-request"

# Default label colors (Gitea requires one at creation time). Cosmetic only.
LABEL_COLORS = {
    NEEDS_TRIAGE: "#fbca04",
    NEEDS_INFO: "#d4c5f9",
    FEATURE_REQUEST: "#0e8a16",
    "critical": "#b60205",
    "high": "#d93f0b",
    "medium": "#fbca04",
    "low": "#c2e0c6",
}
DEFAULT_LABEL_COLOR = "#ededed"
