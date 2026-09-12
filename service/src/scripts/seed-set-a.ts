/**
 * Ticket #27: seed Set A's four existing issues into a clean Gitea instance,
 * using the service's own GiteaClient (not the tea CLI) so the client code
 * gets exercised before any LLM logic touches it. Idempotent: matches by
 * title first, so running it twice never duplicates.
 *
 * Run from the `service/` directory with GITEA_* env vars set (e.g. via the
 * repo-root .env): `npm run seed:set-a`
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { GiteaClient } from '../gitea/gitea-client';
import { ALL_TRIAGE_SERVICE_LABELS } from '../gitea/labels';
import { loadSettings } from '../config/settings';

// This repo's own triage-workflow labels (docs/agents/triage-labels.md),
// not otherwise created by anything the triage service itself does.
const WORKFLOW_LABELS = ['ready-for-agent', 'ready-for-human', 'wontfix'] as const;

const SET_A = [
  {
    title: 'Login button unresponsive on mobile Safari',
    body:
      'Multiple users report that on iOS Safari the "Log in" button does nothing ' +
      'when tapped.\nWorks fine on desktop Chrome. Started after the 3.4 release.',
    labels: ['frontend', 'auth', 'high'],
  },
  {
    title: 'CSV export times out for large datasets',
    body:
      'Exporting a report with more than ~50k rows spins for a while and then ' +
      'returns a 504.\nSmaller exports are fine.',
    labels: ['backend', 'medium'],
  },
  {
    title: 'Password reset email never arrives',
    body:
      'Requesting a password reset shows a success message but no email is ever ' +
      'delivered.\nChecked spam. Happens for at least three different users.',
    labels: ['backend', 'auth', 'high'],
  },
  {
    title: 'Dashboard charts render blank on first load',
    body:
      'On first page load the dashboard charts are empty. A manual refresh fixes ' +
      'it.\nSeems like a race with the data fetch.',
    labels: ['frontend', 'medium'],
  },
] as const;

async function main(): Promise<void> {
  const settings = loadSettings();
  const client = new GiteaClient(settings);

  await client.ensureLabels([...ALL_TRIAGE_SERVICE_LABELS, ...WORKFLOW_LABELS]);

  for (const item of SET_A) {
    const existing = await client.findIssueByTitle(item.title);
    if (existing !== null) {
      console.log(`skip (exists as #${existing.number}): ${item.title}`);
      continue;
    }
    const number = await client.createIssue(item.title, item.body, item.labels);
    console.log(`created #${number}: ${item.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
