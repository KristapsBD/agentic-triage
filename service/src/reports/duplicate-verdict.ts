/**
 * Duplicate Candidate retrieval + per-candidate judgment, producing the
 * three-tier Duplicate Verdict (ADR-0005). Mirrors app/pipeline.py's
 * _find_duplicate_verdict(). Ticket #30 scope: called from the bug path
 * only; #32 extends this to the unclear/bundled paths too.
 */

import { redactSecrets } from './redaction';
import { TriagePort } from './triage-port.interface';
import { DuplicateCandidate, DuplicateJudgment, DuplicateVerdict } from './types';

const NOT_A_DUPLICATE: DuplicateVerdict = { tier: 'not_a_duplicate', target_issue: null, similarity: null, rationale: '' };

export async function findDuplicateVerdict(port: TriagePort, rawReport: string): Promise<DuplicateVerdict> {
  const openIssues = await port.listOpenIssues();
  const candidates = await port.findCandidates(rawReport, openIssues);
  if (candidates.length === 0) {
    return NOT_A_DUPLICATE;
  }

  let bestYes: [DuplicateCandidate, DuplicateJudgment] | null = null;
  let bestPossibly: [DuplicateCandidate, DuplicateJudgment] | null = null;

  for (const candidate of candidates) {
    const judgment = await port.judgeDuplicate(rawReport, candidate);
    if (judgment.same_bug === 'yes' && bestYes === null) {
      bestYes = [candidate, judgment];
    } else if (judgment.same_bug === 'possibly' && bestPossibly === null) {
      bestPossibly = [candidate, judgment];
    }
  }

  if (bestYes !== null) {
    const [candidate, judgment] = bestYes;
    return {
      tier: 'clear_duplicate',
      target_issue: candidate.issue_number,
      similarity: candidate.similarity,
      // judgment.rationale is free text the model wrote after reading the
      // *unredacted* raw report (extract()/judgeDuplicate() always see the
      // original), so it can echo a secret back even though the raw report
      // it was judging is safely redacted wherever it's quoted verbatim.
      rationale: redactSecrets(judgment.rationale),
    };
  }
  if (bestPossibly !== null) {
    const [candidate, judgment] = bestPossibly;
    return {
      tier: 'possible_duplicate',
      target_issue: candidate.issue_number,
      similarity: candidate.similarity,
      rationale: redactSecrets(judgment.rationale),
    };
  }
  return NOT_A_DUPLICATE;
}
