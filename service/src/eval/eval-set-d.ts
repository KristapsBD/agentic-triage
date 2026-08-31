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
 * is never mistaken for a broken build or blocks routine work.
 *
 * Ticket #65 adds the remaining production-scale cases (D3-D9) on top of
 * #63's two anchors, deliberately with its own scenarios rather than mapped
 * onto Set C's H/E/D/J taxonomy -- each is a long, in-depth raw_report
 * written the way a real user or support engineer would actually paste one
 * in, exercising the full pipeline (extraction -> embedding retrieval ->
 * duplicate-judgment -> routing) under realistic complexity rather than
 * single-call correctness. #64 adds auto-filing Set D failures to Gitea.
 *
 * Run (service already up, Set A already seeded, nothing else required):
 *   npm run eval:set-d
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { loadSettings } from '../config/settings';
import { Component, DuplicateTier, Outcome, ReportType, Severity } from '../reports/types';
import { fileSetDFailure } from './file-set-d-failures';
import { findGiteaIssueNumber } from './gitea-issue-resolution';

const BASE_URL = process.env.TRIAGE_SERVICE_URL ?? 'http://localhost:8000';
const SETTINGS = loadSettings();

interface ResponseBody {
  outcome?: Outcome;
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
type PostCheck = (body: ResponseBody) => Promise<string[]>;

interface Case {
  id: string;
  rawReport: string;
  check?: Check;
  postCheck?: PostCheck;
}

function giteaBase(): string {
  return `${SETTINGS.gitea_url}/api/v1/repos/${SETTINGS.gitea_repo_owner}/${SETTINGS.gitea_repo_name}`;
}

async function giteaGetIssue(number: number): Promise<{ state?: string; body?: string }> {
  const resp = await fetch(`${giteaBase()}/issues/${number}`, {
    headers: { Authorization: `token ${SETTINGS.gitea_token}` },
  });
  if (!resp.ok) throw new Error(`Gitea returned ${resp.status}`);
  return (await resp.json()) as { state?: string; body?: string };
}

function checkReportType(expected: ReportType): Check {
  return (body) => {
    const actual = body.triage_decision?.report_type;
    return actual === expected ? [] : [`expected report_type=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  };
}

function checkOutcome(expected: Outcome): Check {
  return (body) => (body.outcome === expected ? [] : [`expected outcome=${JSON.stringify(expected)}, got ${JSON.stringify(body.outcome)}`]);
}

function checkSeverityIn(allowed: Severity[]): Check {
  return (body) => {
    const actual = body.triage_decision?.severity ?? null;
    return actual !== null && allowed.includes(actual)
      ? []
      : [`expected severity in ${JSON.stringify(allowed)}, got ${JSON.stringify(actual)}`];
  };
}

function checkComponentsInclude(expected: Component): Check {
  return (body) => {
    const actual = body.triage_decision?.components ?? [];
    return actual.includes(expected) ? [] : [`expected components to include ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  };
}

function checkComponentsMin(n: number): Check {
  return (body) => {
    const actual = body.triage_decision?.components ?? [];
    return actual.length >= n ? [] : [`expected >= ${n} components, got ${JSON.stringify(actual)}`];
  };
}

function checkDuplicateTier(expectedTier: DuplicateTier, expectedTargetTitleSubstring: string): Check {
  return async (body) => {
    const failures: string[] = [];
    const verdict = body.duplicate_verdict ?? {};
    if (verdict.tier !== expectedTier) {
      failures.push(`expected duplicate tier=${JSON.stringify(expectedTier)}, got ${JSON.stringify(verdict.tier)}`);
    }
    const expectedNumber = await findGiteaIssueNumber(SETTINGS, expectedTargetTitleSubstring);
    if (expectedNumber === null) {
      failures.push(`could not resolve expected target issue for ${JSON.stringify(expectedTargetTitleSubstring)}`);
    } else if (verdict.target_issue !== expectedNumber) {
      failures.push(`expected duplicate target_issue=#${expectedNumber}, got ${JSON.stringify(verdict.target_issue)}`);
    }
    return failures;
  };
}

function checkDuplicateTierNot(excludedTier: DuplicateTier): Check {
  return (body) => {
    const actual = body.duplicate_verdict?.tier;
    return actual === excludedTier ? [`duplicate tier=${JSON.stringify(actual)} should not be ${JSON.stringify(excludedTier)}`] : [];
  };
}

// Same-shape wrong answer as Set C's checkNotClearDuplicateOfIssue, but
// resolves the excluded target by title -- Set D never assumes a fixed
// issue number for anything beyond the bare Set A seed.
function checkNotClearDuplicateOfTitle(titleSubstring: string): Check {
  return async (body) => {
    const verdict = body.duplicate_verdict;
    if (verdict?.tier !== 'clear_duplicate') return [];
    const excludedNumber = await findGiteaIssueNumber(SETTINGS, titleSubstring);
    if (excludedNumber !== null && verdict.target_issue === excludedNumber) {
      return [
        `duplicate tier falsely resolved clear_duplicate against issue #${excludedNumber} ` +
          `(${JSON.stringify(titleSubstring)}), a materially different problem`,
      ];
    }
    return [];
  };
}

function all(...checks: Check[]): Check {
  return async (body) => {
    const results = await Promise.all(checks.map((c) => c(body)));
    return results.flat();
  };
}

function ownIssueNumber(body: ResponseBody): number | null | undefined {
  return body.gitea_issue_number;
}

function postCheckIssueStateByTitle(titleSubstring: string, expectedState: string): PostCheck {
  return async () => {
    const number = await findGiteaIssueNumber(SETTINGS, titleSubstring);
    if (number === null) return [`could not resolve issue for ${JSON.stringify(titleSubstring)} to verify state`];
    try {
      const issue = await giteaGetIssue(number);
      return issue.state === expectedState
        ? []
        : [`issue #${number} (${JSON.stringify(titleSubstring)}) state=${JSON.stringify(issue.state)}, expected ${JSON.stringify(expectedState)}`];
    } catch (err) {
      return [`could not fetch issue #${number} to verify: ${(err as Error).message}`];
    }
  };
}

function postCheckBodyContains(getIssueNumber: (body: ResponseBody) => number | null | undefined, needle: string): PostCheck {
  return async (body) => {
    const number = getIssueNumber(body);
    if (number === null || number === undefined) {
      return ['no gitea_issue_number in response to verify body against'];
    }
    try {
      const issue = await giteaGetIssue(number);
      return (issue.body ?? '').includes(needle) ? [] : [`issue #${number} body did not contain ${JSON.stringify(needle)} verbatim`];
    } catch (err) {
      return [`could not fetch issue #${number} to verify: ${(err as Error).message}`];
    }
  };
}

// Two anchor cases (#63): enough to prove the harness runs end-to-end
// against a bare Set A baseline. #65 adds D3-D9 below on top of this
// scaffold.
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
  {
    id: 'D3_ios_checkout_crash_new_bug_with_stack_trace',
    rawReport:
      "We've started seeing crash reports from the iOS app (build 4.2.1, tested primarily on " +
      "an iPhone 13 mini running iOS 17.4 and an iPhone 15 Pro on 17.5) where the checkout " +
      "screen crashes almost immediately if the cart has more than about 20 line items. This " +
      "seems to have started after last Tuesday's release, though I'll be honest, I'm not " +
      "100% sure it's tied to that release specifically since it was our support queue that " +
      "surfaced it, not our own QA.\n\n" +
      "What we've tried so far:\n" +
      "1. Fresh install, add 25 distinct SKUs to cart, tap 'Proceed to Checkout' -> crash " +
      "within a couple seconds, before the payment sheet even has a chance to render.\n" +
      "2. Same flow but capped at 10 items -> no crash at all, checkout works normally.\n" +
      "3. Tried reproducing on an Android device (Pixel 8, same account, same 25 items) -> " +
      "did not crash, so this looks iOS-specific.\n" +
      "4. Downgraded one test device back to build 4.1.9 -> could NOT reproduce, which points " +
      "back at the new release even though I can't swear to it being the direct cause.\n\n" +
      "One of the customers who hit this sent us the crash log. The relevant tail:\n\n" +
      "Fatal Exception: NSInvalidArgumentException\n" +
      "*** -[__NSArrayM objectAtIndex:]: index 24 beyond bounds [0 .. 19]\n" +
      "  at CheckoutViewController.swift:412\n" +
      "  at CartSummaryView.render()\n" +
      "  at UIViewController.viewDidLoad()\n\n" +
      "My best guess (and it's really just a guess, haven't had time to step through the " +
      "actual Swift) is that something caps the visible cart summary rows at 20 but the " +
      "underlying array iteration doesn't know about that cap and tries to index past it " +
      "anyway.\n\n" +
      "Update (8/28): also reproduced this on an iPad running iOS 17.4 in landscape mode, " +
      "same ~20 item threshold, so it doesn't seem tied to phone screen size specifically.",
    check: all(checkReportType('bug'), checkOutcome('issue_created'), checkComponentsInclude('frontend')),
    // The pasted crash log is the whole reason support forwarded this
    // instead of just describing the symptom -- it needs to actually reach
    // the filed issue for an engineer to act on it (same content-fidelity
    // concern as Set C's E4, applied to a stack trace instead of a markdown
    // image URL).
    postCheck: postCheckBodyContains(ownIssueNumber, 'NSInvalidArgumentException'),
  },
  {
    id: 'D4_login_vocab_overlap_but_different_bug_double_submit',
    rawReport:
      "On iOS Safari (tested on iPhone 12 and iPhone 14, both iOS 17), tapping the 'Log in' " +
      "button seems to fire the request twice if you tap it even slightly fast -- not that it " +
      "does nothing, it actually logs you in fine, but our backend logs show two separate " +
      "login events firing within about 150ms of each other for the same session. Desktop " +
      "Chrome does not show this, only iOS Safari as far as we've tested.\n\n" +
      "This might've started around the same time as the 3.4 release (I know there was a " +
      "login-button bug logged around then too, but this feels different since the button IS " +
      "responsive here, it's just over-firing).\n\n" +
      "Repro:\n" +
      "1. iOS Safari, tap login button once -> two POST /api/auth/login calls in the network " +
      "log, ~140ms apart.\n" +
      "2. Same on iOS Safari but hold the tap slightly longer before releasing -> only one " +
      "call fires.\n" +
      "3. Desktop Chrome, normal tap -> only one call, every time.\n\n" +
      "Not sure yet whether this is causing any real user-facing harm beyond noisy logs and " +
      "maybe a wasted DB write, but wanted to flag it before it turns into a rate-limiting or " +
      "session-token issue.",
    // Deliberate vocabulary overlap with Set A's "Login button unresponsive
    // on mobile Safari" (iOS Safari, tap, login button, started around a
    // release) but a materially different bug: a double-fire on a button
    // that IS responsive, vs. Set A's button that does nothing at all.
    check: checkNotClearDuplicateOfTitle('Login button unresponsive on mobile Safari'),
  },
  {
    id: 'D5_genuine_password_reset_duplicate_reworded_embedding_probe',
    rawReport:
      "Our account-recovery flow tells the user their request went through, but whatever's " +
      "supposed to land in their inbox afterward just... doesn't show up. Not in spam or " +
      "promotions either -- three different people on our team checked their own Gmail " +
      "accounts to be sure. Tried it against two separate mail providers (Gmail and an " +
      "Outlook.com address) with the same result both times. Nothing in our outbound mail " +
      "provider's dashboard shows a bounce or a block, the send just reports as successful " +
      "and then nothing arrives. Genuinely stumped on this one -- could be on our side, could " +
      "be the mail provider silently dropping things, hard to tell without more visibility " +
      "into their delivery logs.",
    // Same underlying bug as Set A's "Password reset email never arrives",
    // deliberately reworded away from its vocabulary (account-recovery/
    // inbox/mail provider vs. password reset/email/spam) to probe whether
    // embedding retrieval still surfaces it as a candidate at all. Left
    // observational on purpose: whether similarity clears the retrieval
    // floor for a reworded-but-genuine duplicate is exactly the open
    // question here, not something with a single right answer to assert on.
  },
  {
    id: 'D6_pdf_export_feature_request_disguised_as_bug_complaint',
    rawReport:
      "This doesn't work at all -- there's no way to export our data as a PDF anywhere in the " +
      "app, only CSV. We need PDF export for our quarterly investor packets, and right now " +
      "our finance team has to manually paste CSV data into a template every single quarter, " +
      "which is slow and error-prone. Every other tool we evaluated before picking this one " +
      "had PDF export as a baseline feature, so this feels like a pretty significant gap. " +
      "Would love to know if this is on a roadmap somewhere, because right now this is the " +
      "#1 thing blocking us from fully switching our finance workflows over.",
    // Worded like a bug complaint ("this doesn't work at all") but
    // describes a capability that was never built, not something broken --
    // the plausible wrong answer is classifying this as a bug.
    check: all(checkReportType('feature_request'), checkOutcome('feature_request_filed')),
  },
  {
    id: 'D7_bundled_report_cross_links_password_reset_duplicate',
    rawReport:
      "A few unrelated-feeling things piling up this week: first, the 'forgot your password' " +
      "email genuinely never arrives no matter how many times we request it or which account " +
      "we try -- confirmed on three separate test accounts, checked spam every time; second, " +
      "the timezone dropdown in account settings resets to UTC every time you save any other " +
      "setting on that page, even when you didn't touch timezone at all; third, we noticed " +
      "the invoice PDF footer still lists a stale support email address " +
      "(support@old-domain.example) that hasn't been valid since the migration a few months " +
      "back.",
    // Same fix Set C's E1/E2 exercise for Set B's issues, applied to Set
    // A's baseline: bundling must not skip duplicate detection outright, so
    // a bundled report containing a near-verbatim repeat of the password
    // reset bug should still surface a cross-link, even though review_
    // flagged (not an auto-comment) is still the only outcome -- a human
    // still decides how to split a bundle.
    check: all(checkOutcome('review_flagged'), checkDuplicateTierNot('not_a_duplicate'), checkComponentsMin(2)),
    // Sanity: bundling must not have side-stepped into auto-commenting (and
    // thus closing/altering) the target directly either.
    postCheck: postCheckIssueStateByTitle('Password reset email never arrives', 'open'),
  },
  {
    id: 'D8_critical_refund_data_loss_with_backend_log',
    rawReport:
      "Steps to reproduce (confirmed by two engineers independently, both as admin users):\n" +
      "1. Log in as an admin.\n" +
      "2. Go to Billing > Refunds.\n" +
      "3. Select any order over $500 and click 'Issue Refund'.\n" +
      "4. The UI shows a spinner for a few seconds, then throws a generic 'Something went " +
      "wrong' toast.\n" +
      "5. Checking the database directly afterward, the order's refund_status column is set " +
      "to 'refunded' anyway, but no actual refund was issued through our payment processor -- " +
      "we checked the processor's own dashboard and there's no matching refund transaction at " +
      "all.\n\n" +
      "This means customers are being told, implicitly via their order status, that they got " +
      "their money back when they did not. We've now confirmed this on four different orders " +
      "ranging from $500 to $2,400, all with the same result: DB says refunded, processor " +
      "says nothing happened.\n\n" +
      "Backend error log around the failure:\n\n" +
      "ERROR RefundService.processRefund: PaymentGatewayTimeoutError: gateway did not respond " +
      "within 8000ms\n" +
      "  at RefundService.processRefund (refund-service.ts:187)\n" +
      "  at RefundController.issueRefund (refund-controller.ts:54)\n" +
      "WARN OrderRepository.markRefunded: proceeding with local status update despite " +
      "upstream timeout\n\n" +
      "That last WARN line looks like the actual root cause to me -- looks like the code " +
      "optimistically marks the order refunded locally even when the upstream payment gateway " +
      "call timed out, instead of rolling back. Flagging this as urgent given the " +
      "financial/trust implications.",
    check: all(checkReportType('bug'), checkSeverityIn(['critical', 'high']), checkComponentsInclude('backend')),
    postCheck: postCheckBodyContains(ownIssueNumber, 'PaymentGatewayTimeoutError'),
  },
  {
    id: 'D9_non_english_french_bug_report',
    rawReport:
      "Depuis la mise a jour de la semaine derniere (version 4.2.1 je crois), l'application " +
      "plante systematiquement quand j'essaie d'ouvrir la page des factures sur mon compte " +
      "professionnel. Ca fonctionnait tres bien avant. J'ai teste sur deux appareils " +
      "differents (un Samsung Galaxy S22 sous Android 14 et une tablette Huawei plus " +
      "ancienne) et le meme plantage se produit a chaque fois, environ 2 secondes apres avoir " +
      "tape sur 'Factures'.\n\n" +
      "J'ai aussi essaye de vider le cache de l'application et de me reconnecter avec un autre " +
      "compte utilisateur, toujours dans la meme entreprise -- meme resultat a chaque fois.\n\n" +
      "Un collegue en IT nous a transmis ce message d'erreur qui apparait dans les logs cote " +
      "serveur au moment du plantage:\n\n" +
      "NullPointerException: Cannot read property 'invoiceItems' of undefined\n" +
      "  at InvoiceListController.render (invoice-list-controller.ts:88)\n\n" +
      "Je ne suis pas developpeur donc je ne sais pas trop quoi en penser, mais ca semble " +
      "correle avec le fait que certaines factures plus anciennes n'ont peut-etre pas ce " +
      "champ rempli. C'est bloquant pour nous car on doit envoyer ces factures a notre " +
      "comptable avant la fin du mois.",
    check: checkReportType('bug'),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<number> {
  console.log(`${'CASE'.padEnd(55)} RESULT`);
  console.log('-'.repeat(90));
  let passed = 0;
  let observed = 0;
  let totalAssertable = 0;

  for (const testCase of CASES) {
    let body: ResponseBody;
    try {
      const resp = await fetch(`${BASE_URL}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_report: testCase.rawReport }),
      });
      body = (await resp.json()) as ResponseBody;
      if (resp.status !== 200) {
        console.log(`${testCase.id.padEnd(55)} FAIL`);
        console.log(`    - HTTP ${resp.status}: ${JSON.stringify(body)}`);
        await fileFailureSafely(testCase.id, [`HTTP ${resp.status}: ${JSON.stringify(body)}`], testCase.rawReport, body);
        continue;
      }
    } catch (err) {
      console.log(`${testCase.id.padEnd(55)} ERROR`);
      console.log(`    - request failed: ${(err as Error).message}`);
      continue;
    }

    const failures: string[] = [];
    if (testCase.check !== undefined) {
      totalAssertable += 1;
      failures.push(...(await testCase.check(body)));
    }
    if (testCase.postCheck !== undefined) {
      if (testCase.check === undefined) totalAssertable += 1;
      failures.push(...(await testCase.postCheck(body)));
    }

    if (testCase.check === undefined && testCase.postCheck === undefined) {
      observed += 1;
      console.log(`${testCase.id.padEnd(55)} OBSERVE`);
    } else if (failures.length === 0) {
      passed += 1;
      console.log(`${testCase.id.padEnd(55)} PASS`);
    } else {
      console.log(`${testCase.id.padEnd(55)} FAIL`);
      for (const f of failures) console.log(`    - ${f}`);
      await fileFailureSafely(testCase.id, failures, testCase.rawReport, body);
    }

    console.log(
      `    outcome=${JSON.stringify(body.outcome)} ` +
        `report_type=${JSON.stringify(body.triage_decision?.report_type)} ` +
        `severity=${JSON.stringify(body.triage_decision?.severity)} ` +
        `components=${JSON.stringify(body.triage_decision?.components)} ` +
        `dup=${JSON.stringify(body.duplicate_verdict)} ` +
        `issue=#${body.gitea_issue_number}`,
    );

    await sleep(200); // be polite to the LLM API between cases
  }

  console.log('-'.repeat(90));
  console.log(`${passed}/${totalAssertable} assertable cases passed, ${observed} observational cases printed above for review`);
  return passed === totalAssertable ? 0 : 1;
}

run().then((code) => process.exit(code));
