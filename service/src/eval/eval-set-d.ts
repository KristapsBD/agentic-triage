/**
 * Ticket #63: Set D, a small standalone anchor suite proving the eval
 * harness pattern (live service + real Gitea + real Anthropic API, same as
 * Set B/C) works from a bare `make fresh-start && make seed` alone.
 *
 * Unlike Set B and Set C, Set D deliberately depends on nothing but the Set
 * A baseline (the 4 seeded issues) -- it never assumes eval:set-b or
 * eval:set-c ran first, and resolves its duplicate target by title (see
 * gitea-issue-resolution.ts) rather than a fixed issue number, since no
 * other suite's runs are assumed to have happened first to fix those
 * numbers. It is deliberately excluded from `npm run eval` / `make eval` /
 * `npm run preflight` -- see #63's acceptance criteria -- so a Set D result
 * is never mistaken for a broken build or blocks routine work. #65 adds the
 * remaining production-scale cases on top of this scaffold; #64 adds
 * auto-filing Set D failures to Gitea.
 *
 * Run (service already up, Set A already seeded, nothing else required):
 *   npm run eval:set-d
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { loadSettings } from '../config/settings';
import { DuplicateTier, Outcome, ReportType } from '../reports/types';
import { fileSetDFailure } from './file-set-d-failures';
import { GiteaIssueSummary, resolveGiteaIssueByTitle } from './gitea-issue-resolution';

const BASE_URL = process.env.TRIAGE_SERVICE_URL ?? 'http://localhost:8000';
const SETTINGS = loadSettings();

interface ResponseBody {
  outcome?: Outcome;
  gitea_issue_number?: number | null;
  triage_decision?: {
    report_type?: ReportType;
  } | null;
  duplicate_verdict?: {
    tier?: DuplicateTier;
    target_issue?: number | null;
  } | null;
}

type Check = (body: ResponseBody) => Promise<string[]> | string[];

interface Case {
  id: string;
  rawReport: string;
  check: Check;
}

async function findGiteaIssueNumber(titleSubstring: string): Promise<number | null> {
  const base = `${SETTINGS.gitea_url}/api/v1/repos/${SETTINGS.gitea_repo_owner}/${SETTINGS.gitea_repo_name}`;
  const resp = await fetch(`${base}/issues?state=all&type=issues&limit=50`, {
    headers: { Authorization: `token ${SETTINGS.gitea_token}` },
  });
  if (!resp.ok) throw new Error(`Gitea returned ${resp.status}`);
  const issues = (await resp.json()) as GiteaIssueSummary[];
  return resolveGiteaIssueByTitle(issues, titleSubstring);
}

function checkOutcome(expected: Outcome): Check {
  return (body) => (body.outcome === expected ? [] : [`expected outcome=${JSON.stringify(expected)}, got ${JSON.stringify(body.outcome)}`]);
}

function checkDuplicateTier(expectedTier: DuplicateTier, expectedTargetTitleSubstring: string): Check {
  return async (body) => {
    const failures: string[] = [];
    const verdict = body.duplicate_verdict ?? {};
    if (verdict.tier !== expectedTier) {
      failures.push(`expected duplicate tier=${JSON.stringify(expectedTier)}, got ${JSON.stringify(verdict.tier)}`);
    }
    const expectedNumber = await findGiteaIssueNumber(expectedTargetTitleSubstring);
    if (expectedNumber === null) {
      failures.push(`could not resolve expected target issue for ${JSON.stringify(expectedTargetTitleSubstring)}`);
    } else if (verdict.target_issue !== expectedNumber) {
      failures.push(`expected duplicate target_issue=#${expectedNumber}, got ${JSON.stringify(verdict.target_issue)}`);
    }
    return failures;
  };
}

// Two anchor cases (#63): enough to prove the harness runs end-to-end
// against a bare Set A baseline. #65 adds the remaining production-scale
// cases on top of this scaffold.
const CASES: Case[] = [
  {
    id: 'D_ANCHOR1_clean_new_area_bug',
    rawReport:
      'The notification bell badge count never decreases after you open and read all ' +
      'notifications. Reproduced on both Chrome and Firefox by marking 5 notifications as ' +
      'read and refreshing -- the badge still shows 5.',
    check: checkOutcome('issue_created'),
  },
  {
    id: 'D_ANCHOR2_clear_duplicate_of_setA_password_reset',
    rawReport:
      "Requesting a password reset says it worked, but the email with the reset link never " +
      "shows up -- not even in spam. Confirmed this with a couple of different accounts.",
    check: checkDuplicateTier('clear_duplicate', 'Password reset email never arrives'),
  },
];

// Filing is best-effort dev tooling around the eval run, not the thing
// under test -- a `tea` hiccup should never mask the FAIL that was already
// printed above it. Mirrors eval-set-c.ts's fileFailureSafely. Must be
// called only after the FAIL line for this case has already been printed.
async function fileFailureSafely(caseId: string, failures: string[], rawReport: string, response: unknown): Promise<void> {
  try {
    await fileSetDFailure(caseId, failures, rawReport, response);
  } catch (err) {
    console.log(`    - could not file ${caseId} as a Gitea issue: ${(err as Error).message}`);
  }
}

async function run(): Promise<number> {
  console.log(`${'CASE'.padEnd(40)} RESULT`);
  console.log('-'.repeat(70));
  let passed = 0;

  for (const testCase of CASES) {
    const id = testCase.id;
    let failures: string[];
    const rawReport = testCase.rawReport;
    let body: ResponseBody = {};

    try {
      const resp = await fetch(`${BASE_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_report: testCase.rawReport }),
      });
      body = (await resp.json()) as ResponseBody;
      if (resp.status !== 200) {
        failures = [`HTTP ${resp.status}: ${JSON.stringify(body)}`];
      } else {
        failures = await testCase.check(body);
      }
    } catch (err) {
      failures = [`request failed: ${(err as Error).message}`];
    }

    if (failures.length === 0) {
      console.log(`${id.padEnd(40)} PASS`);
      passed += 1;
    } else {
      console.log(`${id.padEnd(40)} FAIL`);
      for (const f of failures) console.log(`    - ${f}`);
      await fileFailureSafely(id, failures, rawReport, body);
    }
  }

  console.log('-'.repeat(70));
  console.log(`${passed}/${CASES.length} passed`);
  return passed === CASES.length ? 0 : 1;
}

run().then((code) => process.exit(code));
