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
