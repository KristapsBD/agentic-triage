/** Mirrors app/errors.py's pipeline-level error taxonomy. */

/** The model's structured output failed schema/Zod validation. */
export class ExtractionValidationError extends Error {}

/** A retryable infrastructure hiccup: network blip, rate limit, 5xx. */
export class TransientAPIError extends Error {}

/**
 * The pipeline could not complete after exhausting transient retries.
 *
 * Maps to HTTP 502: the caller can safely retry the identical POST because
 * the Decision Record is left in a resumable (non-completed) state.
 */
export class PipelineUnavailableError extends Error {
  constructor(
    public readonly reportHash: string,
    public readonly errorCode: string,
    message = '',
  ) {
    super(message || errorCode);
  }
}

/**
 * F11: Gitea permanently rejected the request (4xx -- bad token, deleted
 * repo, an oversized title). Distinct from PipelineUnavailableError:
 * retrying the identical POST will never succeed, so it must NOT carry the
 * "safe to retry" 502 contract. Maps to 500 (pipeline-exception.filter.ts).
 */
export class PipelineRejectedError extends Error {
  constructor(
    public readonly reportHash: string,
    public readonly errorCode: string,
    message = '',
  ) {
    super(message || errorCode);
  }
}
