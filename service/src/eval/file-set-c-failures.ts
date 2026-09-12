/**
 * Ticket #49: files every Set C FAIL as a Gitea issue instead of letting it
 * disappear into console scrollback. Filed into *this codebase's own*
 * Gitea project (docs/agents/issue-tracker.md's "bug-triage", resolved by
 * `tea` from the git remote) via the `tea` CLI -- deliberately not the
 * REST-API GiteaClient the service itself uses at runtime (ADR-0004), since
 * that one talks to the eval's *target* repo ("acme-app"), a separate
 * Gitea project the finding has nothing to do with.
 *
 * Deduped against anything already open for the same case id, by title, so
 * repeated eval runs don't spam duplicate tickets.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NEEDS_TRIAGE } from '../gitea/labels';

const execFileAsync = promisify(execFile);
const TITLE_PREFIX = 'Set C FAIL';

function titleFor(caseId: string): string {
  return `${TITLE_PREFIX}: ${caseId}`;
}

interface TeaIssueListRow {
  title: string;
}

const PAGE_SIZE = 50;

// Deliberately not `tea issues list --keyword` (Gitea's fuzzy/full-text
// search): it's backed by an async indexer with a multi-second lag, so a
// dedup check against it can miss an issue this same process just created
// (found by running the create -> immediate keyword-search sequence twice
// in a row: the freshly filed issue didn't show up for ~3s). A plain
// unfiltered `--state open` list has no such lag -- it reads straight
// through, not via the indexer -- so dedup filters that page-by-page
// client-side on exact title instead.
async function alreadyFiled(caseId: string): Promise<boolean> {
  const target = titleFor(caseId);
  for (let page = 1; ; page += 1) {
    const { stdout } = await execFileAsync('tea', [
      'issues',
      'list',
      '--state',
      'open',
      '--page',
      String(page),
      '--limit',
      String(PAGE_SIZE),
      '--output',
      'json',
    ]);
    const rows = JSON.parse(stdout) as TeaIssueListRow[];
    if (rows.some((row) => row.title === target)) return true;
    if (rows.length < PAGE_SIZE) return false;
  }
}

/**
 * Files a Set C FAIL as a `needs-triage` issue, unless one for this case id
 * is already open. Always `needs-triage`, never ADR-0006's `needs-info` --
 * that label is for "we need more from the reporter", and a Set C case has
 * no reporter to ask, only a pipeline behavior to investigate.
 *
 * Note this writes `rawReport`/`response` verbatim into a real Gitea issue
 * body, unlike the service's own typed egress (ADR-0007, which governs the
 * runtime path only). Several Set C cases (J1/J2) deliberately construct
 * `rawReport` as a live prompt-injection payload -- if a duplicate-judgment
 * call ever does leak injected text into `duplicate_verdict.rationale`
 * (exactly what those cases assert against), a filed issue would carry that
 * leak forward to whoever reads it next via `tea issues <n>`. Acceptable
 * for now since this is dev tooling read by a human/agent already treating
 * Set C findings as untrusted, but worth keeping in mind before this gets
 * more automated consumers.
 */
export async function fileSetCFailure(
  caseId: string,
  failures: string[],
  rawReport: string,
  response: unknown,
): Promise<void> {
  if (await alreadyFiled(caseId)) {
    console.log(`    (skipped filing: an open issue for ${caseId} already exists)`);
    return;
  }

  const description =
    `Set C case \`${caseId}\` failed during an eval run (\`npm run eval:set-c\`).\n\n` +
    `## Failure reasons\n\n${failures.map((f) => `- ${f}`).join('\n')}\n\n` +
    `## Raw report\n\n\`\`\`\n${rawReport}\n\`\`\`\n\n` +
    `## Raw response\n\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\`\n`;

  await execFileAsync('tea', [
    'issues',
    'create',
    '--title',
    titleFor(caseId),
    '--description',
    description,
    '--labels',
    NEEDS_TRIAGE,
  ]);
  console.log(`    (filed as a new "${NEEDS_TRIAGE}" issue: ${titleFor(caseId)})`);
}
