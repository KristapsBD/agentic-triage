/**
 * Two independent, non-interfering retry budgets (ADR-0008). Mirrors
 * app/retry.py's extract_with_retry_budgets() field-for-field.
 *
 * A validation failure feeds its error back to the caller's `call` on the
 * next attempt via `feedback`, so a self-correcting model can fix its own
 * output. A transient failure retries the identical request (feedback
 * unchanged) with exponential backoff. Each budget is tracked independently:
 * exhausting one is never blamed on, or consumes, the other.
 */

import { ExtractionValidationError, TransientAPIError } from './pipeline.errors';

export interface RetryBudgets {
  validation_retry_budget: number;
  transient_retry_budget: number;
  transient_retry_backoff_seconds: number;
}

export type RetryFailure = 'validation_exhausted' | 'transient_exhausted';

export interface RetryOutcome<T> {
  result: T | null;
  failure: RetryFailure | null;
  validationAttempts: number;
  transientAttempts: number;
  lastError: string | null;
}

type Sleep = (seconds: number) => Promise<void>;

const defaultSleep: Sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export async function withRetryBudgets<T>(
  call: (feedback: string | null) => Promise<T>,
  budgets: RetryBudgets,
  sleep: Sleep = defaultSleep,
): Promise<RetryOutcome<T>> {
  let feedback: string | null = null;
  let validationAttempts = 0;
  let transientAttempts = 0;
  let lastError: string | null;

  for (;;) {
    try {
      const result = await call(feedback);
      return { result, failure: null, validationAttempts, transientAttempts, lastError: null };
    } catch (err) {
      if (err instanceof ExtractionValidationError) {
        validationAttempts += 1;
        lastError = err.message;
        feedback = lastError;
        if (validationAttempts > budgets.validation_retry_budget) {
          return { result: null, failure: 'validation_exhausted', validationAttempts, transientAttempts, lastError };
        }
        continue;
      }
      if (err instanceof TransientAPIError) {
        transientAttempts += 1;
        lastError = err.message;
        if (transientAttempts > budgets.transient_retry_budget) {
          return { result: null, failure: 'transient_exhausted', validationAttempts, transientAttempts, lastError };
        }
        await sleep(budgets.transient_retry_backoff_seconds * 2 ** (transientAttempts - 1));
        continue;
      }
      throw err;
    }
  }
}
