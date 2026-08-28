import { ExtractionValidationError, TransientAPIError } from './pipeline.errors';
import { RetryBudgets, withRetryBudgets } from './retry';

const BUDGETS: RetryBudgets = { validation_retry_budget: 2, transient_retry_budget: 2, transient_retry_backoff_seconds: 0 };

describe('withRetryBudgets', () => {
  it('returns the result with no failure on a first-try success', async () => {
    const outcome = await withRetryBudgets(async () => 'ok', BUDGETS);
    expect(outcome).toEqual({ result: 'ok', failure: null, validationAttempts: 0, transientAttempts: 0, lastError: null });
  });

  it('passes null feedback on the very first attempt', async () => {
    const feedbacks: Array<string | null> = [];
    await withRetryBudgets(async (feedback) => {
      feedbacks.push(feedback);
      return 'ok';
    }, BUDGETS);
    expect(feedbacks).toEqual([null]);
  });

  it('sleeps with exponential backoff between transient retries only', async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    await withRetryBudgets(
      async () => {
        attempt += 1;
        if (attempt <= 2) throw new TransientAPIError('boom');
        return 'ok';
      },
      BUDGETS,
      async (seconds) => {
        sleeps.push(seconds);
      },
    );
    expect(sleeps).toEqual([0, 0]); // backoff_seconds=0 in BUDGETS; still one sleep call per transient attempt
  });

  it('never sleeps for a validation failure', async () => {
    const sleeps: number[] = [];
    let attempt = 0;
    await withRetryBudgets(
      async () => {
        attempt += 1;
        if (attempt === 1) throw new ExtractionValidationError('bad');
        return 'ok';
      },
      BUDGETS,
      async (seconds) => {
        sleeps.push(seconds);
      },
    );
    expect(sleeps).toEqual([]);
  });

  it('re-throws an error that is neither validation nor transient', async () => {
    await expect(
      withRetryBudgets(async () => {
        throw new Error('unexpected');
      }, BUDGETS),
    ).rejects.toThrow('unexpected');
  });
});
