/**
 * Gitea issue/comment body construction, shared by every routing branch in
 * pipeline.service.ts. Mirrors the module-level helpers in app/pipeline.py
 * (_quote, _issue_body, _bug_issue_body, _review_flag_body).
 */

import * as crypto from 'node:crypto';
import { redactSecrets } from './redaction';
import { TriageDecision } from './types';

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

export function bugIssueBody(rawReport: string, decision: TriageDecision): string {
  const steps =
    decision.repro_steps && decision.repro_steps.length > 0
      ? decision.repro_steps.map((step, i) => `${i + 1}. ${step}`).join('\n')
      : 'No reproduction steps provided.';
  // supporting_evidence is explicitly specified (llm-client.ts's SYSTEM_PROMPT)
  // to carry pasted logs/stack traces verbatim -- a second channel for a
  // reporter's raw text to reach Gitea unmodified, same as the Raw Report
  // quote below, so it gets the same secret-redaction treatment.
  const evidence = decision.supporting_evidence ? redactSecrets(decision.supporting_evidence.trim()) : 'None.';
  const rationale =
    `**Severity:** ${decision.severity}\n` +
    `**Components:** ${decision.components.join(', ') || 'unknown'}\n\n` +
    `### Reproduction steps\n\n${steps}\n\n` +
    `### Supporting evidence\n\n${evidence}`;
  return issueBody(rawReport, rationale);
}

export function reviewFlagBody(rawReport: string, reason: string, extra = ''): string {
  return issueBody(rawReport, `**Why this needs review:** ${reason}`, extra);
}
