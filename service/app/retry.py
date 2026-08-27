import time
from dataclasses import dataclass
from typing import Callable, TypeVar

from app.errors import ExtractionValidationError, TransientAPIError

T = TypeVar("T")


@dataclass
class ExtractionOutcome:
    decision: object | None
    failure: str | None  # None | "validation_exhausted" | "transient_exhausted"
    validation_attempts: int
    transient_attempts: int
    last_error: str | None = None


def extract_with_retry_budgets(
    call: Callable[[str | None], T],
    *,
    validation_budget: int,
    transient_budget: int,
    backoff_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
) -> ExtractionOutcome:
    """Run `call(feedback)` with two independent, non-interfering retry budgets.

    `call` takes the previous validation error text (or None on the first/
    non-validation attempts) and returns a parsed, validated result.

    A validation failure feeds its error back to the model on the next
    attempt via `feedback`. A transient failure retries the identical
    request (feedback unchanged) with exponential backoff. Each budget is
    tracked independently per ADR-0008: exhausting one never consumes or is
    blamed on the other.
    """
    feedback: str | None = None
    validation_attempts = 0
    transient_attempts = 0
    last_error: str | None = None

    while True:
        try:
            result = call(feedback)
            return ExtractionOutcome(
                decision=result,
                failure=None,
                validation_attempts=validation_attempts,
                transient_attempts=transient_attempts,
            )
        except ExtractionValidationError as e:
            validation_attempts += 1
            last_error = str(e)
            feedback = last_error
            if validation_attempts > validation_budget:
                return ExtractionOutcome(
                    decision=None,
                    failure="validation_exhausted",
                    validation_attempts=validation_attempts,
                    transient_attempts=transient_attempts,
                    last_error=last_error,
                )
        except TransientAPIError as e:
            transient_attempts += 1
            last_error = str(e)
            if transient_attempts > transient_budget:
                return ExtractionOutcome(
                    decision=None,
                    failure="transient_exhausted",
                    validation_attempts=validation_attempts,
                    transient_attempts=transient_attempts,
                    last_error=last_error,
                )
            sleep(backoff_seconds * (2 ** (transient_attempts - 1)))
