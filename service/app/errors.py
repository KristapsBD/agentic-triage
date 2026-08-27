class ExtractionValidationError(Exception):
    """The model's structured output failed schema/Pydantic validation."""


class TransientAPIError(Exception):
    """A retryable infrastructure hiccup: network blip, rate limit, 5xx."""


class GiteaError(Exception):
    """A Gitea REST call failed (non-2xx, network error)."""


class PipelineUnavailableError(Exception):
    """The pipeline could not complete after exhausting transient retries.

    Maps to HTTP 502: the caller can safely retry the identical POST because
    the Decision Record is left in a resumable (non-completed) state.
    """

    def __init__(self, report_hash: str, error_code: str, message: str = ""):
        super().__init__(message or error_code)
        self.report_hash = report_hash
        self.error_code = error_code
