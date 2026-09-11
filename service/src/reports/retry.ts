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

interface RetryState {
  feedback: string | null;
  validationAttempts: number;
  transientAttempts: number;
  lastError: string | null;
}

function handleValidationError<T>(
  err: ExtractionValidationError,
  budgets: RetryBudgets,
  state: RetryState,
): RetryOutcome<T> | null {
  state.validationAttempts += 1;
  state.lastError = err.message;
  state.feedback = state.lastError;
  if (state.validationAttempts > budgets.validation_retry_budget) {
    return {
      result: null,
      failure: 'validation_exhausted',
      validationAttempts: state.validationAttempts,
      transientAttempts: state.transientAttempts,
      lastError: state.lastError,
    };
  }
  return null;
}

async function handleTransientError<T>(
  err: TransientAPIError,
  budgets: RetryBudgets,
  state: RetryState,
  sleep: Sleep,
): Promise<RetryOutcome<T> | null> {
  state.transientAttempts += 1;
  state.lastError = err.message;
  if (state.transientAttempts > budgets.transient_retry_budget) {
    return {
      result: null,
      failure: 'transient_exhausted',
      validationAttempts: state.validationAttempts,
      transientAttempts: state.transientAttempts,
      lastError: state.lastError,
    };
  }
  await sleep(budgets.transient_retry_backoff_seconds * 2 ** (state.transientAttempts - 1));
  return null;
}

async function attemptOnce<T>(
  call: (feedback: string | null) => Promise<T>,
  budgets: RetryBudgets,
  state: RetryState,
  sleep: Sleep,
): Promise<RetryOutcome<T> | null> {
  try {
    const result = await call(state.feedback);
    return {
      result,
      failure: null,
      validationAttempts: state.validationAttempts,
      transientAttempts: state.transientAttempts,
      lastError: null,
    };
  } catch (err) {
    if (err instanceof ExtractionValidationError) {
      return handleValidationError<T>(err, budgets, state);
    }
    if (err instanceof TransientAPIError) {
      return handleTransientError<T>(err, budgets, state, sleep);
    }
    throw err;
  }
}

export async function withRetryBudgets<T>(
  call: (feedback: string | null) => Promise<T>,
  budgets: RetryBudgets,
  sleep: Sleep = defaultSleep,
): Promise<RetryOutcome<T>> {
  const state: RetryState = { feedback: null, validationAttempts: 0, transientAttempts: 0, lastError: null };

  for (;;) {
    const outcome = await attemptOnce(call, budgets, state, sleep);
    if (outcome) {
      return outcome;
    }
  }
}
