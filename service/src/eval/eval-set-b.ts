/**
 * Ticket #35 (TS port of eval/eval_set_b.py, ticket #14's original): runs
 * Set B (B1-B8) plus self-authored near-miss duplicate cases through
 * POST /reports against a *running* service (not mocked), asserting on the
 * discrete/categorical fields only -- report_type, severity, components,
 * Duplicate Verdict tier + target issue -- never exact-string assertions on
 * generated titles or prose, which would be flaky against any prompt/model
 * change without reflecting a real regression.
 *
 * Ticket #39 scope adds: Confidence band assertions (see
 * checkConfidenceNot) for every case, following the same categorical-only
 * convention -- no assertions on the Confidence reason string, which is
 * prose.
 *
 * Run: `npm run eval:set-b` (service must already be up, e.g. via
 * `docker compose up`, and Set A must already be seeded via
 * `npm run seed:set-a`).
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { loadSettings } from '../config/settings';
import { Component, Confidence, DuplicateTier, Outcome, ReportType, Severity } from '../reports/types';
import { GiteaIssueSummary, resolveGiteaIssueByTitle } from './gitea-issue-resolution';

const BASE_URL = process.env.TRIAGE_SERVICE_URL ?? 'http://localhost:8000';
const SETTINGS = loadSettings();

interface ResponseBody {
  outcome?: Outcome;
  confidence?: Confidence;
  gitea_issue_number?: number | null;
  triage_decision?: {
    report_type?: ReportType;
    severity?: Severity | null;
    components?: Component[];
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

function checkReportType(expected: ReportType): Check {
  return (body) => {
    const actual = body.triage_decision?.report_type;
    return actual === expected ? [] : [`expected report_type=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  };
}

function checkSeverity(expected: Severity): Check {
  return (body) => {
    const actual = body.triage_decision?.severity;
    return actual === expected ? [] : [`expected severity=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  };
}

/**
 * Looser golden check for reports where the exact severity is a judgment
 * call but the rubric rules out certain values outright.
 */
function checkSeverityNot(...excluded: Severity[]): Check {
  return (body) => {
    const actual = body.triage_decision?.severity;
    return actual !== null && actual !== undefined && excluded.includes(actual)
      ? [`severity=${JSON.stringify(actual)} should not be one of ${JSON.stringify(excluded)}`]
      : [];
  };
}

function checkComponentsIntersects(expectedAnyOf: ReadonlySet<Component>): Check {
  return (body) => {
    const actual = body.triage_decision?.components ?? [];
    if (actual.length === 0) return ['components was empty'];
    if (!actual.some((c) => expectedAnyOf.has(c))) {
      return [`expected components to include one of ${JSON.stringify([...expectedAnyOf])}, got ${JSON.stringify(actual)}`];
    }
    return [];
  };
}

/**
 * Confidence band check, loose in the same spirit as checkSeverityNot:
 * validation retries are a real but incidental source of run-to-run
 * variance (ADR-0001/#38), so a case whose Duplicate Verdict/Report Type
 * checks already pin down the deterministic drivers of the band only
 * excludes the bands that a genuine regression -- not routine LLM
 * variance -- would produce.
 */
function checkConfidenceNot(...excluded: Confidence[]): Check {
  return (body) => {
    const actual = body.confidence;
    return actual !== undefined && excluded.includes(actual)
      ? [`confidence=${JSON.stringify(actual)} should not be one of ${JSON.stringify(excluded)}`]
      : [];
  };
}

function checkOutcome(expected: Outcome): Check {
  return (body) => (body.outcome === expected ? [] : [`expected outcome=${JSON.stringify(expected)}, got ${JSON.stringify(body.outcome)}`]);
}

function checkDuplicateTier(expectedTier: DuplicateTier, expectedTargetTitleSubstring?: string): Check {
  return async (body) => {
    const failures: string[] = [];
    const verdict = body.duplicate_verdict ?? {};
    if (verdict.tier !== expectedTier) {
      failures.push(`expected duplicate tier=${JSON.stringify(expectedTier)}, got ${JSON.stringify(verdict.tier)}`);
    }
    if (expectedTargetTitleSubstring !== undefined) {
      const expectedNumber = await findGiteaIssueNumber(expectedTargetTitleSubstring);
      if (expectedNumber === null) {
        failures.push(`could not resolve expected target issue for ${JSON.stringify(expectedTargetTitleSubstring)}`);
      } else if (verdict.target_issue !== expectedNumber) {
        failures.push(`expected duplicate target_issue=#${expectedNumber}, got ${JSON.stringify(verdict.target_issue)}`);
      }
    }
    return failures;
  };
}

function all(...checks: Check[]): Check {
  return async (body) => {
    const failures: string[] = [];
    for (const check of checks) {
      failures.push(...(await check(body)));
    }
    return failures;
  };
}

const CASES: Case[] = [
  {
    id: 'B1_clean_straightforward',
    rawReport:
      'When I upload a profile picture larger than about 5MB, the page shows a spinner ' +
      'forever and the picture never saves. Tried it with a 8MB PNG and a 12MB JPEG, same ' +
      'result. Chrome on Windows. Smaller images work fine.',
    check: all(
      checkReportType('bug'),
      checkComponentsIntersects(new Set(['frontend', 'backend'])),
      checkSeverityNot('critical'), // a workaround exists (smaller images work)
      checkConfidenceNot('low'), // clean single-issue extraction, not duplicate-capped or review-flagged
    ),
  },
  {
    id: 'B2_clean_different_area',
    rawReport:
      'The `/api/v2/orders` endpoint returns a 500 whenever the `status` query param is ' +
      'omitted. Passing `status=open` works. This started today. Reproduced with curl ' +
      'three times.',
    check: all(
      checkReportType('bug'),
      checkComponentsIntersects(new Set(['api', 'backend'])),
      checkSeverityNot('critical'), // a workaround exists (pass status=open)
      checkConfidenceNot('low'), // clean single-issue extraction, not duplicate-capped or review-flagged
    ),
  },
  {
    id: 'B3_vague_underspecified',
    rawReport: 'the reports thing is broken again pls fix',
    check: all(checkOutcome('review_flagged'), checkConfidenceNot('high')), // review-flagged path caps below high
  },
  {
    id: 'B4_severity_mismatch_tone_vs_rubric',
    rawReport:
      'CRITICAL!!! URGENT!!! The footer copyright year still says 2024 instead of 2025. ' +
      'This is extremely important and needs to be fixed immediately!!!',
    check: all(checkReportType('bug'), checkSeverity('low'), checkConfidenceNot('low')),
  },
  {
    id: 'B5_likely_duplicate_of_EXIST1',
    rawReport:
      "I can't log in on my iPhone. I open the app in Safari, type my details, tap the " +
      'login button and literally nothing happens. My colleague has the same problem on ' +
      'her phone.',
    check: all(checkDuplicateTier('clear_duplicate', 'Login button unresponsive on mobile Safari'), checkConfidenceNot('low')),
  },
  {
    id: 'B6_feature_request',
    rawReport:
      'It would be really nice if we could export reports to PDF as well as CSV. A lot of ' +
      'our customers ask for this.',
    check: all(checkReportType('feature_request'), checkOutcome('feature_request_filed'), checkConfidenceNot('low')),
  },
  {
    id: 'B7_bundled_report',
    rawReport:
      'A few things: the search bar sometimes returns no results even for exact matches, ' +
      'the date picker lets you select an end date before the start date, and also the ' +
      'mobile menu overlaps the header on small screens.',
    check: all(checkOutcome('review_flagged'), checkConfidenceNot('high')), // review-flagged path caps below high
  },
  {
    id: 'B8_noisy_buried_signal',
    rawReport:
      'hey so this happened again, see below, no idea whats going on\n' +
      '```\n' +
      '[2025-06-01 09:14:22] INFO  request received\n' +
      '[2025-06-01 09:14:22] DEBUG cache miss key=user:8831\n' +
      '[2025-06-01 09:14:23] ERROR NullReferenceException in OrderService.Calculate() line 214\n' +
      '[2025-06-01 09:14:23] INFO  returning 500\n' +
      '```\n' +
      'basically checkout dies sometimes',
    check: all(checkReportType('bug'), checkSeverityNot('critical', 'low'), checkConfidenceNot('low')),
  },
  // Self-authored near-miss cases (ticket #9/#30): same area as an existing
  // issue but a genuinely different bug -- proves the Duplicate Verdict
  // resists false merges, not just catches obvious repeats.
  {
    id: 'NEARMISS_same_area_different_bug',
    rawReport:
      'On the login page, the password field visually overlaps the username field on narrow ' +
      "screens, making it hard to tell which box you're typing into. Once you find the right " +
      'field the login button itself works fine.',
    check: all(checkDuplicateTier('not_a_duplicate'), checkConfidenceNot('low')),
  },
  {
    id: 'NEARMISS_same_symptom_different_area',
    rawReport:
      'Generating a monthly invoice PDF spins forever and never downloads. Tried a small ' +
      'invoice and a large one, same result. Works fine for weekly invoices.',
    check: all(checkDuplicateTier('not_a_duplicate'), checkConfidenceNot('low')),
  },
];

async function run(): Promise<number> {
  const results: { id: string; failures: string[] }[] = [];

  for (const testCase of CASES) {
    try {
      const resp = await fetch(`${BASE_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_report: testCase.rawReport }),
      });
      const body = (await resp.json()) as ResponseBody;
      if (resp.status !== 200) {
        results.push({ id: testCase.id, failures: [`HTTP ${resp.status}: ${JSON.stringify(body)}`] });
        continue;
      }
      const failures = await testCase.check(body);
      results.push({ id: testCase.id, failures });
    } catch (err) {
      results.push({ id: testCase.id, failures: [`request failed: ${(err as Error).message}`] });
    }
  }

  console.log(`${'CASE'.padEnd(40)} RESULT`);
  console.log('-'.repeat(70));
  let passed = 0;
  for (const { id, failures } of results) {
    if (failures.length === 0) {
      console.log(`${id.padEnd(40)} PASS`);
      passed += 1;
    } else {
      console.log(`${id.padEnd(40)} FAIL`);
      for (const f of failures) console.log(`    - ${f}`);
    }
  }
  console.log('-'.repeat(70));
  console.log(`${passed}/${results.length} passed`);
  return passed === results.length ? 0 : 1;
}

run().then((code) => process.exit(code));
