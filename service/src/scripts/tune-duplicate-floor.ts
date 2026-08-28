/**
 * Ticket #30: reproducible evidence for the duplicate_similarity_floor value
 * (settings.ts, default 0.35) under this service's actual embedding library
 * (@huggingface/transformers), independent of the Python build's
 * sentence-transformers tuning.
 *
 * Not a Jest spec: onnxruntime-node's native addon does an `instanceof
 * Float32Array` check that fails inside Jest's sandboxed VM realm (each
 * test file gets its own global/intrinsics, so a typed array constructed
 * there isn't `instanceof` the addon's captured Float32Array) -- a known
 * class of incompatibility between native Node addons and Jest, not
 * something fixable from this module. Run standalone instead:
 *   npm run tune:duplicate-floor
 *
 * Prints each Set B / near-miss report's similarity against every Set A
 * issue (2_candidate_sample_data.md), so the floor can be eyeballed against
 * real output rather than assumed portable across embedding runtimes.
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { EmbeddingIndex } from '../embeddings/embedding-index';
import { loadSettings } from '../config/settings';
import { GiteaIssue } from '../reports/types';

const SET_A: GiteaIssue[] = [
  {
    number: 1,
    title: 'Login button unresponsive on mobile Safari',
    body:
      'Multiple users report that on iOS Safari the "Log in" button does nothing ' +
      'when tapped.\nWorks fine on desktop Chrome. Started after the 3.4 release.',
    labels: ['frontend', 'auth', 'high'],
    state: 'open',
  },
  {
    number: 2,
    title: 'CSV export times out for large datasets',
    body: 'Exporting a report with more than ~50k rows spins for a while and then returns a 504.\nSmaller exports are fine.',
    labels: ['backend', 'medium'],
    state: 'open',
  },
  {
    number: 3,
    title: 'Password reset email never arrives',
    body:
      'Requesting a password reset shows a success message but no email is ever ' +
      'delivered.\nChecked spam. Happens for at least three different users.',
    labels: ['backend', 'auth', 'high'],
    state: 'open',
  },
  {
    number: 4,
    title: 'Dashboard charts render blank on first load',
    body: 'On first page load the dashboard charts are empty. A manual refresh fixes it.\nSeems like a race with the data fetch.',
    labels: ['frontend', 'medium'],
    state: 'open',
  },
];

const REPORTS: Record<string, string> = {
  B5_clear_duplicate_of_EXIST1:
    "I can't log in on my iPhone. I open the app in Safari, type my details, tap the login " +
    'button and literally nothing happens. My colleague has the same problem on her phone.',
  B4_unrelated_footer_copyright:
    'CRITICAL!!! URGENT!!! The footer copyright year still says 2024 instead of 2025. This is ' +
    'extremely important and needs to be fixed immediately!!!',
  NEARMISS_login_layout:
    'On the login page, the password field visually overlaps the username field on narrow ' +
    "screens, making it hard to tell which box you're typing into. Once you find the right " +
    'field the login button itself works fine.',
  NEARMISS_invoice_pdf:
    'Generating a monthly invoice PDF spins forever and never downloads. Tried a small invoice ' +
    'and a large one, same result. Works fine for weekly invoices.',
};

async function main(): Promise<void> {
  const settings = loadSettings();
  const index = new EmbeddingIndex(settings);

  console.log(`duplicate_similarity_floor = ${settings.duplicate_similarity_floor}\n`);
  for (const [name, raw] of Object.entries(REPORTS)) {
    const candidates = await index.findCandidates(raw, SET_A);
    console.log(`${name}:`);
    if (candidates.length === 0) {
      console.log('  (nothing cleared the floor)');
    }
    for (const c of candidates) {
      console.log(`  #${c.issue_number} ${c.title.slice(0, 45).padEnd(45)} sim=${c.similarity.toFixed(4)}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
