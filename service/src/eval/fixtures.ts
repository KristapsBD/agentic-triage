/**
 * Ticket #35: Set A issue data + the report texts used to probe duplicate
 * detection at the embedding layer, shared between tune-duplicate-floor.ts
 * and duplicate-threshold-regression.ts so the two don't drift against each
 * other. Mirrors 2_candidate_sample_data.md / seed-set-a.ts.
 */

import { GiteaIssue } from '../reports/types';

export const SET_A: GiteaIssue[] = [
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

export const CLEAR_DUPLICATE_REPORT = {
  name: 'B5_clear_duplicate_of_EXIST1',
  text:
    "I can't log in on my iPhone. I open the app in Safari, type my details, tap the login " +
    'button and literally nothing happens. My colleague has the same problem on her phone.',
  targetIssueNumber: 1,
};

export const UNRELATED_REPORT = {
  name: 'B4_unrelated_footer_copyright',
  text:
    'CRITICAL!!! URGENT!!! The footer copyright year still says 2024 instead of 2025. This is ' +
    'extremely important and needs to be fixed immediately!!!',
};

export const NEAR_MISS_REPORTS = [
  {
    name: 'NEARMISS_login_layout',
    text:
      'On the login page, the password field visually overlaps the username field on narrow ' +
      "screens, making it hard to tell which box you're typing into. Once you find the right " +
      'field the login button itself works fine.',
  },
  {
    name: 'NEARMISS_invoice_pdf',
    text:
      'Generating a monthly invoice PDF spins forever and never downloads. Tried a small invoice ' +
      'and a large one, same result. Works fine for weekly invoices.',
  },
];
