/**
 * Zod schemas re-validating the model's forced-tool-use structured output.
 * Mirrors app/schemas.py's TriageDecision/DuplicateJudgment field-for-field
 * (ADR-0007: no model output reaches Gitea except through these fixed
 * fields).
 */

import { z } from 'zod';
import { ExtractionValidationError } from './pipeline.errors';
import { COMPONENTS, SEVERITIES } from '../gitea/labels';
import { DuplicateJudgment as DuplicateJudgmentType, TriageDecision as TriageDecisionType } from './types';

const ReportTypeSchema = z.enum(['bug', 'feature_request', 'unclear', 'spam_or_off_topic']);
const SeveritySchema = z.enum(SEVERITIES);
const ComponentSchema = z.enum(COMPONENTS);
const SameBugJudgmentSchema = z.enum(['yes', 'possibly', 'no']);

function dedupe<T>(values: T[]): T[] {
  const seen: T[] = [];
  for (const v of values) {
    if (!seen.includes(v)) seen.push(v);
  }
  return seen;
}

// The tool schema's `required` list only hints the model; it isn't a
// structural guarantee. Without the superRefine below, an omitted
// severity/components on a bug report would pass as null/[] and later hit
// an unrelated assertion deep in pipeline routing -- an unhandled crash
// instead of engaging the validation-retry budget (ADR-0008) like any other
// malformed structured output.
export const TriageDecisionSchema = z
  .object({
    title: z
      .string()
      .max(200)
      .transform((v) => v.trim())
      .pipe(z.string().min(1, 'title must not be blank')),
    report_type: ReportTypeSchema,
    severity: SeveritySchema.nullable().default(null),
    components: z
      .array(ComponentSchema)
      .default([])
      .transform((v) => dedupe(v)),
    repro_steps: z.array(z.string()).nullable().default(null),
    supporting_evidence: z.string().nullable().default(null),
    distinct_issues: z.array(z.string()).default([]),
  })
  .superRefine((decision, ctx) => {
    if (decision.report_type !== 'bug') return;
    if (decision.severity === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['severity'], message: "severity is required when report_type is 'bug'" });
    }
    if (decision.components.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['components'],
        message: "components must include at least one value (use 'unknown' if unclear) when report_type is 'bug'",
      });
    }
  });

export const DuplicateJudgmentSchema = z.object({
  same_bug: SameBugJudgmentSchema,
  rationale: z.string().default(''),
});

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

export function parseTriageDecision(input: unknown): TriageDecisionType {
  const result = TriageDecisionSchema.safeParse(input);
  if (!result.success) {
    throw new ExtractionValidationError(formatZodError(result.error));
  }
  return result.data;
}

export function parseDuplicateJudgment(input: unknown): DuplicateJudgmentType {
  const result = DuplicateJudgmentSchema.safeParse(input);
  if (!result.success) {
    throw new ExtractionValidationError(formatZodError(result.error));
  }
  return result.data;
}

/** A Raw Report that describes more than one distinct issue at once. */
export function isBundled(decision: TriageDecisionType): boolean {
  return decision.distinct_issues.length > 1;
}
