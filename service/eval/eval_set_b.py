"""Ticket #14: golden-value eval harness.

Runs Set B (B1-B8) plus self-authored near-miss duplicate cases through
POST /reports against a *running* service (not mocked), and asserts on the
discrete/categorical fields only — report_type, severity, components,
Duplicate Verdict tier + target issue — never exact-string assertions on
generated titles or prose, which would be flaky against any prompt/model
change without reflecting a real regression.

Run: `python -m eval.eval_set_b` (service must already be up, e.g. via
`docker compose up`, and Set A must already be seeded).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from scripts._env import REPO_ROOT_ENV, load_dotenv  # noqa: E402

BASE_URL = os.environ.get("TRIAGE_SERVICE_URL", "http://localhost:8000")


@dataclass
class Case:
    id: str
    raw_report: str
    check: Callable[[dict], list[str]]  # returns list of failure descriptions, empty = pass


def _find_gitea_issue_number(title_substring: str) -> int | None:
    load_dotenv(REPO_ROOT_ENV)
    base = f"{os.environ.get('GITEA_URL', 'http://localhost:3000')}/api/v1/repos/{os.environ['GITEA_REPO_OWNER']}/{os.environ['GITEA_REPO_NAME']}"
    resp = requests.get(
        f"{base}/issues",
        params={"state": "all", "type": "issues"},
        headers={"Authorization": f"token {os.environ['GITEA_TOKEN']}"},
        timeout=10,
    )
    resp.raise_for_status()
    for issue in resp.json():
        if title_substring.lower() in issue["title"].lower():
            return issue["number"]
    return None


def _check_report_type(expected: str):
    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("report_type")
        return [] if actual == expected else [f"expected report_type={expected!r}, got {actual!r}"]

    return check


def _check_severity(expected: str):
    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("severity")
        return [] if actual == expected else [f"expected severity={expected!r}, got {actual!r}"]

    return check


def _check_severity_not(*excluded: str):
    """Looser golden check for reports where the exact severity is a
    judgment call but the rubric rules out certain values outright (e.g.
    nothing here describes data loss/a security hole/a total outage with no
    workaround, so 'critical' would be tone-inflated, not rubric-anchored).
    """

    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("severity")
        return [f"severity={actual!r} should not be one of {excluded!r}"] if actual in excluded else []

    return check


def _check_components_intersects(expected_any_of: set[str]):
    def check(body: dict) -> list[str]:
        actual = set((body.get("triage_decision") or {}).get("components") or [])
        if not actual:
            return ["components was empty"]
        if actual.isdisjoint(expected_any_of):
            return [f"expected components to include one of {expected_any_of!r}, got {actual!r}"]
        return []

    return check


def _check_outcome(expected: str):
    def check(body: dict) -> list[str]:
        actual = body.get("outcome")
        return [] if actual == expected else [f"expected outcome={expected!r}, got {actual!r}"]

    return check


def _check_duplicate_tier(expected_tier: str, expected_target_title_substring: str | None = None):
    def check(body: dict) -> list[str]:
        failures = []
        verdict = body.get("duplicate_verdict") or {}
        if verdict.get("tier") != expected_tier:
            failures.append(f"expected duplicate tier={expected_tier!r}, got {verdict.get('tier')!r}")
        if expected_target_title_substring is not None:
            expected_number = _find_gitea_issue_number(expected_target_title_substring)
            if expected_number is None:
                failures.append(f"could not resolve expected target issue for {expected_target_title_substring!r}")
            elif verdict.get("target_issue") != expected_number:
                failures.append(
                    f"expected duplicate target_issue=#{expected_number}, got {verdict.get('target_issue')!r}"
                )
        return failures

    return check


def _all(*checks: Callable[[dict], list[str]]):
    def check(body: dict) -> list[str]:
        failures = []
        for c in checks:
            failures.extend(c(body))
        return failures

    return check


CASES: list[Case] = [
    Case("B1_clean_straightforward", (
        "When I upload a profile picture larger than about 5MB, the page shows a spinner "
        "forever and the picture never saves. Tried it with a 8MB PNG and a 12MB JPEG, same "
        "result. Chrome on Windows. Smaller images work fine."
    ), _all(
        _check_report_type("bug"),
        _check_components_intersects({"frontend", "backend"}),
        _check_severity_not("critical"),  # a workaround exists (smaller images work)
    )),
    Case("B2_clean_different_area", (
        "The `/api/v2/orders` endpoint returns a 500 whenever the `status` query param is "
        "omitted. Passing `status=open` works. This started today. Reproduced with curl "
        "three times."
    ), _all(
        _check_report_type("bug"),
        _check_components_intersects({"api", "backend"}),
        _check_severity_not("critical"),  # a workaround exists (pass status=open)
    )),
    Case("B3_vague_underspecified",
         "the reports thing is broken again pls fix",
         _check_outcome("review_flagged")),
    Case("B4_severity_mismatch_tone_vs_rubric", (
        "CRITICAL!!! URGENT!!! The footer copyright year still says 2024 instead of 2025. "
        "This is extremely important and needs to be fixed immediately!!!"
    ), _all(_check_report_type("bug"), _check_severity("low"))),
    Case("B5_likely_duplicate_of_EXIST1", (
        "I can't log in on my iPhone. I open the app in Safari, type my details, tap the "
        "login button and literally nothing happens. My colleague has the same problem on "
        "her phone."
    ), _check_duplicate_tier("clear_duplicate", "Login button unresponsive")),
    Case("B6_feature_request",
         "It would be really nice if we could export reports to PDF as well as CSV. A lot of "
         "our customers ask for this.",
         _all(_check_report_type("feature_request"), _check_outcome("feature_request_filed"))),
    Case("B7_bundled_report", (
        "A few things: the search bar sometimes returns no results even for exact matches, "
        "the date picker lets you select an end date before the start date, and also the "
        "mobile menu overlaps the header on small screens."
    ), _check_outcome("review_flagged")),
    Case("B8_noisy_buried_signal", (
        "hey so this happened again, see below, no idea whats going on\n"
        "```\n"
        "[2025-06-01 09:14:22] INFO  request received\n"
        "[2025-06-01 09:14:22] DEBUG cache miss key=user:8831\n"
        "[2025-06-01 09:14:23] ERROR NullReferenceException in OrderService.Calculate() line 214\n"
        "[2025-06-01 09:14:23] INFO  returning 500\n"
        "```\n"
        "basically checkout dies sometimes"
    ), _all(_check_report_type("bug"), _check_severity_not("critical", "low"))),
    # Self-authored near-miss cases (ticket #9 / user story #40): same area as an
    # existing issue but a genuinely different bug — proves the Duplicate Verdict
    # resists false merges, not just catches obvious repeats.
    Case("NEARMISS_same_area_different_bug", (
        "On the login page, the password field visually overlaps the username field on "
        "narrow screens, making it hard to tell which box you're typing into. Once you find "
        "the right field the login button itself works fine."
    ), _check_duplicate_tier("not_a_duplicate")),
    Case("NEARMISS_same_symptom_different_area", (
        "Generating a monthly invoice PDF spins forever and never downloads. Tried a small "
        "invoice and a large one, same result. Works fine for weekly invoices."
    ), _check_duplicate_tier("not_a_duplicate")),
]


def run() -> int:
    results = []
    for case in CASES:
        try:
            resp = requests.post(f"{BASE_URL}/reports", json={"raw_report": case.raw_report}, timeout=60)
            body = resp.json()
            if resp.status_code != 200:
                results.append((case.id, [f"HTTP {resp.status_code}: {body}"]))
                continue
            failures = case.check(body)
            results.append((case.id, failures))
        except requests.RequestException as e:
            results.append((case.id, [f"request failed: {e}"]))

    print(f"{'CASE':<40} {'RESULT'}")
    print("-" * 70)
    passed = 0
    for case_id, failures in results:
        if not failures:
            print(f"{case_id:<40} PASS")
            passed += 1
        else:
            print(f"{case_id:<40} FAIL")
            for f in failures:
                print(f"    - {f}")
    print("-" * 70)
    print(f"{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(run())
