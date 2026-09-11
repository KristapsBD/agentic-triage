/**
 * Gitea issue/comment body construction, shared by every routing branch in
 * pipeline.service.ts. Mirrors the module-level helpers in app/pipeline.py
 * (_quote, _issue_body, _bug_issue_body, _review_flag_body).
 */

import * as crypto from 'node:crypto';
import { ConfidenceResult } from './confidence';
import { redactSecrets } from './redaction';
import { DuplicateVerdict, TriageDecision } from './types';

export function hashReport(rawReport: string): string {
  return crypto.createHash('sha256').update(rawReport, 'utf-8').digest('hex');
}

/**
 * Fence the Raw Report as a literal code block rather than a blockquote.
 *
 * This is the one place the Raw Report's exact original text (not the
 * model's extracted fields) always lands in a Gitea-visible body, so it's
 * the one place that needs its own defenses rather than relying on
 * ADR-0007's typed-egress guarantee, which only covers the model's output:
 *
 * - Secrets/PII a reporter pastes in get redacted here -- the single seam
 *   that guarantees no unredacted secret reaches Gitea this way.
 * - A code fence is not interpreted as markdown by Gitea, so an embedded
 *   image tag, @mention, or issue-closing keyword in the reporter's own
 *   text renders as inert text instead of live markdown.
 */
export function quote(rawReport: string): string {
  const safeReport = rawReport.trim() ? redactSecrets(rawReport) : '(empty)';
  const backtickRuns = safeReport.match(/`+/g) ?? [];
  const longestRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${safeReport}\n${fence}`;
}

export function issueBody(rawReport: string, rationale: string, extra = ''): string {
  const parts = [rationale.trim()];
  if (extra.trim()) parts.push(extra.trim());
  parts.push(`### Raw Report (verbatim)\n\n${quote(rawReport)}`);
  return parts.join('\n\n');
}

function reproStepsList(steps: TriageDecision['repro_steps']): string {
  if (!steps || steps.length === 0) return 'No reproduction steps provided.';
  return steps.map((step, i) => `${i + 1}. ${redactSecrets(step)}`).join('\n');
}

// supporting_evidence is explicitly specified (llm-client.ts's SYSTEM_PROMPT)
// to carry pasted logs/stack traces verbatim -- a second channel for a
// reporter's raw text to reach Gitea unmodified, same as the Raw Report
// quote below, so it gets the same secret-redaction treatment.
function evidenceOrNone(evidence: TriageDecision['supporting_evidence']): string {
  return evidence ? redactSecrets(evidence.trim()) : 'None.';
}

function componentsOrUnknown(components: string[]): string {
  return components.join(', ') || 'unknown';
}

export function bugIssueBody(rawReport: string, decision: TriageDecision): string {
  const steps = reproStepsList(decision.repro_steps);
  const evidence = evidenceOrNone(decision.supporting_evidence);
  const rationale =
    `**Severity:** ${decision.severity}\n` +
    `**Components:** ${componentsOrUnknown(decision.components)}\n\n` +
    `### Reproduction steps\n\n${steps}\n\n` +
    `### Supporting evidence\n\n${evidence}`;
  return issueBody(rawReport, rationale);
}

export function reviewFlagBody(rawReport: string, reason: string, confidence: ConfidenceResult, extra = ''): string {
  const rationale = `**Why this needs review:** ${reason}\n\n**Confidence:** ${confidence.band} — ${confidence.reason}`;
  return issueBody(rawReport, rationale, extra);
}

export function duplicateCommentBody(rawReport: string, rationale: string): string {
  return (
    `Automated triage matched this report as a duplicate of this issue (${rationale}).\n\n` +
    `### New report (verbatim)\n\n${quote(rawReport)}`
  );
}

/**
 * Surfaced in the extra section of a Review Flag body for any low-confidence
 * path (unclear, bundled) that also found a Duplicate Candidate worth
 * mentioning. Mirrors app/pipeline.py's _duplicate_cross_link_note.
 */
export function duplicateCrossLinkNote(verdict: DuplicateVerdict): string {
  if (verdict.tier === 'not_a_duplicate') return '';
  return `### Possibly related to an existing issue\n\nSee #${verdict.target_issue} (${verdict.rationale}).`;
}

/**
 * F8 audit observation: a Review Flagged issue (unclear/possible-duplicate)
 * gets only the needs-triage/needs-info workflow labels -- the extracted
 * severity/components are computed and persisted in the Decision Record but
 * never surface anywhere a human reviewer looks. Surfaced here as an
 * unconfirmed suggestion in the body text, not as applied labels -- the
 * design deliberately withholds labels the pipeline isn't confident enough
 * in to apply automatically (ADR-0006).
 */
function suggestedFieldsLines(decision: Pick<TriageDecision, 'severity' | 'components'>): string[] {
  const lines: string[] = [];
  if (decision.severity !== null) lines.push(`**Suggested severity:** ${decision.severity}`);
  if (decision.components.length > 0) lines.push(`**Suggested components:** ${decision.components.join(', ')}`);
  return lines;
}

export function suggestedFieldsNote(decision: Pick<TriageDecision, 'severity' | 'components'>): string {
  const lines = suggestedFieldsLines(decision);
  if (lines.length === 0) return '';
  return `### Extracted, unconfirmed\n\n${lines.join('\n')}`;
}
