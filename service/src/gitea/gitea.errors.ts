/**
 * A Gitea REST call failed (non-2xx, network error). Mirrors app/errors.py's
 * GiteaError.
 *
 * F11 (scout-hire-audit-opus): `status` distinguishes a transient failure
 * (network error, 5xx) from a permanent one (4xx -- bad token, deleted
 * repo, oversized title) so the pipeline doesn't tell a caller it's safe to
 * retry an identical POST forever against a request Gitea will never
 * accept. `retryable` is undefined/network-error or >=500; a 4xx is not.
 */
export class GiteaError extends Error {
  public readonly retryable: boolean;

  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.retryable = status === undefined || status >= 500;
  }
}
