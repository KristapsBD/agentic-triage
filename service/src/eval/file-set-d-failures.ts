/**
 * Ticket #64: files every Set D FAIL as a Gitea issue, mirroring
 * file-set-c-failures.ts exactly (ticket #49) -- same target repo (this
 * codebase's own bug-triage, via `tea`, not the runtime GiteaClient), same
 * dedup-by-open-title strategy, same best-effort dev-tooling contract.
 *
 * Deduped against anything already open for the same case id, by title, so
 * repeated eval runs don't spam duplicate tickets.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NEEDS_TRIAGE } from '../gitea/labels';

const execFileAsync = promisify(execFile);
const TITLE_PREFIX = 'Set D FAIL';

function titleFor(caseId: string): string {
  return `${TITLE_PREFIX}: ${caseId}`;
}

interface TeaIssueListRow {
  title: string;
}

const PAGE_SIZE = 50;

// See file-set-c-failures.ts's alreadyFiled for why this is a plain
// unfiltered `--state open` list paged client-side on exact title, rather
// than `tea issues list --keyword` (async indexer, multi-second lag that
// can miss an issue this same process just created).
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
 * Files a Set D FAIL as a `needs-triage` issue, unless one for this case id
 * is already open. See file-set-c-failures.ts's fileSetCFailure for the
 * rationale (always needs-triage, never needs-info; raw report/response
 * written verbatim into the issue body).
 */
export async function fileSetDFailure(
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
    `Set D case \`${caseId}\` failed during an eval run (\`npm run eval:set-d\`).\n\n` +
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
