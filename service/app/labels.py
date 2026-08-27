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

# Every label the triage service itself can attach to an issue at runtime.
# Used by scripts/seed_set_a.py to pre-create the full set (plus this repo's
# separate workflow labels) so a fresh Gitea instance looks fully set up
# before the first request, rather than growing labels lazily one at a time.
ALL_TRIAGE_SERVICE_LABELS = (*COMPONENTS, *SEVERITIES, NEEDS_TRIAGE, NEEDS_INFO, FEATURE_REQUEST)

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
