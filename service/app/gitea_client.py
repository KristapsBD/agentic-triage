"""Direct Gitea REST API calls (ADR-0004) — no `tea` CLI subprocess, no shell
interpolation of any model-derived string.
"""

from __future__ import annotations

import requests

from app.errors import GiteaError
from app.labels import DEFAULT_LABEL_COLOR, LABEL_COLORS
from app.schemas import GiteaIssue


class GiteaClient:
    def __init__(self, base_url: str, owner: str, repo: str, token: str, timeout: float = 15.0):
        self._base = f"{base_url}/api/v1/repos/{owner}/{repo}"
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"token {token}"})
        self._timeout = timeout
        self._label_id_cache: dict[str, int] | None = None

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        try:
            resp = self._session.request(method, f"{self._base}{path}", timeout=self._timeout, **kwargs)
        except requests.RequestException as e:
            raise GiteaError(f"Gitea request failed: {e}") from e
        if resp.status_code >= 500:
            raise GiteaError(f"Gitea returned {resp.status_code}: {resp.text[:300]}")
        if resp.status_code >= 400:
            raise GiteaError(f"Gitea rejected request ({resp.status_code}): {resp.text[:300]}")
        return resp

    def _label_ids(self) -> dict[str, int]:
        if self._label_id_cache is None:
            resp = self._request("GET", "/labels")
            self._label_id_cache = {label["name"]: label["id"] for label in resp.json()}
        return self._label_id_cache

    def ensure_labels(self, names: list[str]) -> list[int]:
        """Create any of `names` that don't already exist in the repo, and
        return the full set's label ids. Idempotent — safe to call every
        startup/seed run.
        """
        ids = self._label_ids()
        missing = [n for n in names if n not in ids]
        for name in missing:
            resp = self._request(
                "POST",
                "/labels",
                json={"name": name, "color": LABEL_COLORS.get(name, DEFAULT_LABEL_COLOR)},
            )
            created = resp.json()
            ids[created["name"]] = created["id"]
        return [ids[n] for n in names]

    def create_issue(self, title: str, body: str, labels: list[str]) -> int:
        label_ids = self.ensure_labels(labels) if labels else []
        resp = self._request("POST", "/issues", json={"title": title, "body": body, "labels": label_ids})
        return resp.json()["number"]

    def comment_issue(self, issue_number: int, body: str) -> None:
        self._request("POST", f"/issues/{issue_number}/comments", json={"body": body})

    def list_open_issues(self) -> list[GiteaIssue]:
        issues: list[GiteaIssue] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                "/issues",
                params={"state": "open", "type": "issues", "page": page, "limit": 50},
            )
            batch = resp.json()
            if not batch:
                break
            issues.extend(_issue_from_json(raw) for raw in batch)
            if len(batch) < 50:
                break
            page += 1
        return issues

    def find_issue_by_title(self, title: str) -> GiteaIssue | None:
        resp = self._request("GET", "/issues", params={"state": "all", "q": title, "type": "issues"})
        for raw in resp.json():
            if raw["title"] == title:
                return _issue_from_json(raw)
        return None


def _issue_from_json(raw: dict) -> GiteaIssue:
    return GiteaIssue(
        number=raw["number"],
        title=raw["title"],
        body=raw.get("body") or "",
        labels=[label["name"] for label in raw.get("labels", [])],
        state=raw.get("state", "open"),
    )
