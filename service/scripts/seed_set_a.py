"""Ticket #6: seed Set A's four existing issues into a clean Gitea instance,
using the service's own GiteaClient (not the tea CLI) so the client code
gets exercised before any LLM logic touches it. Idempotent: matches by
title first, so running it twice never duplicates.

Run from the `service/` directory with GITEA_* env vars set (e.g. via the
repo-root .env): `python -m scripts.seed_set_a`
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.gitea_client import GiteaClient  # noqa: E402
from app.labels import ALL_TRIAGE_SERVICE_LABELS  # noqa: E402
from scripts._env import REPO_ROOT_ENV, load_dotenv  # noqa: E402

# This repo's own triage-workflow labels (docs/agents/triage-labels.md),
# not otherwise created by anything the triage service itself does.
WORKFLOW_LABELS = ("ready-for-agent", "ready-for-human", "wontfix")

SET_A = [
    {
        "title": "Login button unresponsive on mobile Safari",
        "body": (
            'Multiple users report that on iOS Safari the "Log in" button does nothing '
            "when tapped.\nWorks fine on desktop Chrome. Started after the 3.4 release."
        ),
        "labels": ["frontend", "auth", "high"],
    },
    {
        "title": "CSV export times out for large datasets",
        "body": (
            "Exporting a report with more than ~50k rows spins for a while and then "
            "returns a 504.\nSmaller exports are fine."
        ),
        "labels": ["backend", "medium"],
    },
    {
        "title": "Password reset email never arrives",
        "body": (
            "Requesting a password reset shows a success message but no email is ever "
            "delivered.\nChecked spam. Happens for at least three different users."
        ),
        "labels": ["backend", "auth", "high"],
    },
    {
        "title": "Dashboard charts render blank on first load",
        "body": (
            "On first page load the dashboard charts are empty. A manual refresh fixes "
            "it.\nSeems like a race with the data fetch."
        ),
        "labels": ["frontend", "medium"],
    },
]


def main() -> None:
    load_dotenv(REPO_ROOT_ENV)

    client = GiteaClient(
        base_url=os.environ.get("GITEA_URL", "http://localhost:3000"),
        owner=os.environ["GITEA_REPO_OWNER"],
        repo=os.environ["GITEA_REPO_NAME"],
        token=os.environ["GITEA_TOKEN"],
    )

    client.ensure_labels([*ALL_TRIAGE_SERVICE_LABELS, *WORKFLOW_LABELS])

    for item in SET_A:
        existing = client.find_issue_by_title(item["title"])
        if existing is not None:
            print(f"skip (exists as #{existing.number}): {item['title']}")
            continue
        number = client.create_issue(item["title"], item["body"], item["labels"])
        print(f"created #{number}: {item['title']}")


if __name__ == "__main__":
    main()
