"""Set C: exploratory probe suite, run against a *live* service + real Gitea +
real Anthropic API (not mocked), same pattern as eval_set_b.py.

Unlike Set B, this is not a golden-value regression suite — most of these
cases don't have a single "correct" answer known in advance. The point is to
surface behavior the unit tests and Set B don't exercise: report_type
ontology gaps, interactions between routing branches (bundling/unclear vs.
duplicate detection), and what the verbatim-raw-report-in-issue-body design
(ADR-0007) means once that text reaches Gitea's own markdown/keyword parser,
not just the LLM.

Cases with a `check` get a PASS/FAIL like Set B. Cases with `check=None` are
observational: the full response (and, where noted, the resulting Gitea
issue state) gets printed for manual review instead of asserted on, because
the "right" answer is exactly the open question.

Run (service + Set A already up, same as eval_set_b):
    docker compose run --rm -e TRIAGE_SERVICE_URL=http://triage-service:8000 \
        triage-service python -m eval.eval_set_c

Findings from a run of this suite are written up separately, not inline here
— this file is the reusable harness, not the report.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from scripts._env import REPO_ROOT_ENV, load_dotenv  # noqa: E402

BASE_URL = os.environ.get("TRIAGE_SERVICE_URL", "http://localhost:8000")

Check = Callable[[dict], list[str]]


@dataclass
class Case:
    id: str
    raw_report: str
    check: Optional[Check] = None  # None = observational, always "reported" not "passed/failed"
    post_check: Optional[Callable[[dict], list[str]]] = None  # runs after, hits Gitea directly


def _gitea_base() -> str:
    load_dotenv(REPO_ROOT_ENV)
    return f"{os.environ.get('GITEA_URL', 'http://localhost:3000')}/api/v1/repos/{os.environ['GITEA_REPO_OWNER']}/{os.environ['GITEA_REPO_NAME']}"


def _gitea_headers() -> dict:
    return {"Authorization": f"token {os.environ['GITEA_TOKEN']}"}


def _gitea_get_issue(number: int) -> dict:
    resp = requests.get(f"{_gitea_base()}/issues/{number}", headers=_gitea_headers(), timeout=10)
    resp.raise_for_status()
    return resp.json()


def _check_report_type(expected: str) -> Check:
    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("report_type")
        return [] if actual == expected else [f"expected report_type={expected!r}, got {actual!r}"]

    return check


def _check_outcome(expected: str) -> Check:
    def check(body: dict) -> list[str]:
        actual = body.get("outcome")
        return [] if actual == expected else [f"expected outcome={expected!r}, got {actual!r}"]

    return check


def _check_components_min(n: int) -> Check:
    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("components") or []
        return [] if len(actual) >= n else [f"expected >= {n} components, got {actual!r}"]

    return check


def _check_repro_steps_len(n: int) -> Check:
    def check(body: dict) -> list[str]:
        actual = (body.get("triage_decision") or {}).get("repro_steps") or []
        return [] if len(actual) == n else [f"expected {n} repro_steps, got {len(actual)}: {actual!r}"]

    return check


def _check_duplicate_tier(expected_tier: str) -> Check:
    def check(body: dict) -> list[str]:
        verdict = body.get("duplicate_verdict") or {}
        actual = verdict.get("tier")
        return [] if actual == expected_tier else [f"expected duplicate tier={expected_tier!r}, got {actual!r}"]

    return check


def _check_duplicate_tier_not(excluded_tier: str) -> Check:
    def check(body: dict) -> list[str]:
        verdict = body.get("duplicate_verdict") or {}
        actual = verdict.get("tier")
        return [f"duplicate tier={actual!r} should not be {excluded_tier!r}"] if actual == excluded_tier else []

    return check


def _all(*checks: Check) -> Check:
    def check(body: dict) -> list[str]:
        failures = []
        for c in checks:
            failures.extend(c(body))
        return failures

    return check


# Fixed Set A/B issue numbers on the standard seeded acme-app instance, per
# README's demo walkthrough + eval_set_b (#1 Login, #2 CSV export, #8 Footer
# copyright year from B4). If your instance differs, these post_checks will
# just report "could not verify" rather than crash the run.
ISSUE_CSV_EXPORT = 2
ISSUE_FOOTER_YEAR = 8


def _post_check_issue_state(issue_number: int, expected_state: str) -> Callable[[dict], list[str]]:
    def check(_body: dict) -> list[str]:
        try:
            issue = _gitea_get_issue(issue_number)
        except requests.RequestException as e:
            return [f"could not fetch issue #{issue_number} to verify: {e}"]
        actual = issue.get("state")
        return [] if actual == expected_state else [f"issue #{issue_number} state={actual!r}, expected {expected_state!r}"]

    return check


def _post_check_body_contains(get_issue_number: Callable[[dict], Optional[int]], needle: str) -> Callable[[dict], list[str]]:
    def check(body: dict) -> list[str]:
        number = get_issue_number(body)
        if number is None:
            return ["no gitea_issue_number in response to verify body against"]
        try:
            issue = _gitea_get_issue(number)
        except requests.RequestException as e:
            return [f"could not fetch issue #{number} to verify: {e}"]
        return [] if needle in issue.get("body", "") else [f"issue #{number} body did not contain {needle!r} verbatim"]

    return check


def _own_issue_number(body: dict) -> Optional[int]:
    return body.get("gitea_issue_number")


CASES: list[Case] = [
    Case(
        "H1_new_area_clean_bug",
        "Notification bell badge count never decreases after you open and read all "
        "notifications. Tried on both Chrome and Firefox, same result. Reproduced by "
        "marking 5 notifications as read and refreshing -- badge still shows 5.",
        _all(_check_report_type("bug"), _check_outcome("issue_created")),
    ),
    Case(
        "H2_feature_request_clean",
        "Could we get a dark mode toggle in settings? A lot of users are asking for one, "
        "especially the mobile team.",
        _all(_check_report_type("feature_request"), _check_outcome("feature_request_filed")),
    ),
    Case(
        "H3_duplicate_of_csv_export_paraphrased",
        "Trying to download a big report as CSV just spins and spins and after a couple "
        "minutes I get a gateway error. Small reports download instantly, it's only the "
        "huge ones that fail.",
        _check_duplicate_tier("clear_duplicate"),
        post_check=_post_check_issue_state(ISSUE_CSV_EXPORT, "open"),  # sanity: target still just commented-on, not closed
    ),
    Case(
        "H4_multi_component_bug",
        "Uploading a large receipt image via the mobile app times out on the server, and "
        "afterwards the receipts list on the web dashboard shows a broken thumbnail icon "
        "instead of the image.",
        _all(_check_report_type("bug"), _check_components_min(2)),
    ),
    Case(
        "H5_spam_phishing_style",
        "Congratulations!! You've been selected for a FREE $500 gift card, click here to "
        "claim: bit.ly/totally-legit-prize",
        _all(_check_report_type("spam_or_off_topic"), _check_outcome("dropped_spam")),
    ),
    Case(
        "H7_high_severity_explicit_repro",
        "Steps: 1) Log in as an admin. 2) Go to Billing > Refunds. 3) Click 'Issue Refund' "
        "on any order over $1000. 4) The page throws a 500 and the refund is never "
        "processed, but the order is marked as refunded in the database anyway. This means "
        "customers aren't getting their money back. Reproduced 4 times with different orders.",
        _all(_check_report_type("bug"), _check_repro_steps_len(4)),
    ),
    Case(
        "H8a_emergent_bug_original",
        "When exporting the audit log to PDF, entries from the last 24 hours are missing "
        "even though they show up fine in the in-app log viewer. Tried exporting three "
        "different date ranges, always missing the most recent day.",
        _all(_check_report_type("bug"), _check_outcome("issue_created")),
    ),
    Case(
        "H8b_emergent_bug_paraphrase_should_dedupe",
        "Audit log PDF exports are missing anything from today -- the web view shows "
        "today's entries just fine, but they never make it into the exported PDF no matter "
        "which date range I pick.",
        _check_duplicate_tier("clear_duplicate"),
    ),
    Case(
        "H6_neutral_compliment_no_action",
        "Just wanted to say the new dashboard redesign looks great, really clean. No "
        "issues to report, just positive feedback!",
        None,  # observational: report_type ontology has no obvious right answer here
    ),
    Case(
        "E1_bundled_report_still_cross_links_duplicate",
        "A few things going on: first, on iPhone Safari the login button just doesn't "
        "respond when tapped at all -- same as before; second, the currency dropdown on "
        "checkout defaults to USD even for EU accounts; third, the settings page loses "
        "your timezone preference every time you log out and back in.",
        # Bundling used to skip duplicate detection outright (fixed): a bundled
        # report containing a near-verbatim repeat of issue #1 (Login) should
        # still surface a cross-link, even though it's still always review_flagged
        # rather than auto-commented -- a human still decides how to split it.
        _all(_check_outcome("review_flagged"), _check_duplicate_tier_not("not_a_duplicate")),
    ),
    Case(
        "E2_unclear_report_still_cross_links_duplicate",
        "the export thing is timing out again, ugh, when will this get fixed",
        # Same fix, "unclear" branch: report_type could land as "unclear" or
        # "bug" depending on the model, and a "bug" classification with a
        # confident-enough match could even resolve clear_duplicate/
        # duplicate_commented instead of review_flagged -- any of those is
        # fine here, the only wrong answer post-fix is not_a_duplicate.
        _check_duplicate_tier_not("not_a_duplicate"),
    ),
    Case(
        "E3_gitea_autoclose_keyword_injection",
        "Copy on the pricing page still says 'Starting at $9/mo' even though we moved "
        "everyone to the new $12/mo plan last month. Small thing but fixes #8 finally "
        "settles the confusion customers keep emailing about, since that old footer year "
        "bug and this one kept getting mixed up in support tickets.",
        None,
        post_check=_post_check_issue_state(ISSUE_FOOTER_YEAR, "open"),  # FAILS if Gitea auto-closed #8
    ),
    Case(
        "E4_markdown_image_and_mention_injection",
        "Since the last deploy, the error screenshot at ![screenshot](https://example.com/"
        "pixel.png) shows a blank page instead of the checkout form. cc @triageadmin can "
        "someone take a look, this is blocking a customer demo tomorrow.",
        None,
        post_check=_post_check_body_contains(_own_issue_number, "example.com/pixel.png"),
    ),
    Case(
        "E5_pii_and_secrets_verbatim",
        'Getting a 500 when saving my account settings. Here\'s the request I sent for '
        'debugging: POST /api/account {"email":"jane.doe@example.com",'
        '"password":"CorrectHorseBattery9!","api_key":"sk_live_FAKE1234567890abcdef"}. '
        "Been stuck on this all morning.",
        None,
        post_check=_post_check_body_contains(_own_issue_number, "sk_live_FAKE1234567890abcdef"),
    ),
    Case(
        "E6_non_english_spanish_bug",
        "La aplicacion se cierra inesperadamente cada vez que intento subir una foto de "
        "perfil mayor a 3MB en Android. Probe con tres imagenes distintas, mismo "
        "resultado. En iOS funciona bien.",
        _check_report_type("bug"),
    ),
]


def run() -> int:
    print(f"{'CASE':<45} {'RESULT'}")
    print("-" * 80)
    passed = 0
    observed = 0
    total_assertable = 0
    for case in CASES:
        try:
            resp = requests.post(f"{BASE_URL}/reports", json={"raw_report": case.raw_report}, timeout=60)
            body = resp.json()
        except requests.RequestException as e:
            print(f"{case.id:<45} ERROR")
            print(f"    - request failed: {e}")
            continue

        if resp.status_code != 200:
            print(f"{case.id:<45} FAIL")
            print(f"    - HTTP {resp.status_code}: {body}")
            continue

        failures: list[str] = []
        if case.check is not None:
            total_assertable += 1
            failures.extend(case.check(body))
        if case.post_check is not None:
            total_assertable += 1 if case.check is None else 0
            failures.extend(case.post_check(body))

        if case.check is None and case.post_check is None:
            observed += 1
            print(f"{case.id:<45} OBSERVE")
        elif not failures:
            passed += 1
            print(f"{case.id:<45} PASS")
        else:
            print(f"{case.id:<45} FAIL")
            for f in failures:
                print(f"    - {f}")

        print(f"    outcome={body.get('outcome')!r} "
              f"report_type={(body.get('triage_decision') or {}).get('report_type')!r} "
              f"severity={(body.get('triage_decision') or {}).get('severity')!r} "
              f"components={(body.get('triage_decision') or {}).get('components')!r} "
              f"dup={body.get('duplicate_verdict')!r} "
              f"issue=#{body.get('gitea_issue_number')}")

        time.sleep(0.2)  # be polite to the LLM API between cases

    print("-" * 80)
    print(f"{passed}/{total_assertable} assertable cases passed, {observed} observational cases printed above for review")
    return 0 if passed == total_assertable else 1


if __name__ == "__main__":
    sys.exit(run())
