"""Structured error / degraded-outcome result contract (Task 1.3).

Python equivalent of the shared TypeScript contract
(``shared/src/result.ts``). The design ("Error Handling") standardises every
degraded outcome on the shape::

    {code, message, retryable: bool, retained_state: bool}

and defines four error-handling patterns:

    1. Atomic Failure       -- no partial artifact, prior state preserved.
    2. Validation Rejection -- reject at the boundary with a reason, prior
                               state preserved.
    3. Retain-and-Retry     -- retain affected data, retry on a bounded backoff
                               schedule, then notify.
    4. Timeout & Capacity   -- cancel/shed, retain input, offer retry.

Requirements: 1.2, 3.5, 21.6, 23.3
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class ErrorContract:
    """The structured error shape returned by every degraded outcome."""

    code: str
    message: str
    retryable: bool
    retained_state: bool


@dataclass(frozen=True)
class Ok(Generic[T]):
    """A successful result carrying a value."""

    value: T
    ok: bool = True


@dataclass(frozen=True)
class Err:
    """A failed result carrying a structured :class:`ErrorContract`."""

    error: ErrorContract
    ok: bool = False


Result = "Ok[T] | Err"


def ok(value: T) -> Ok[T]:
    """Construct a successful result."""
    return Ok(value=value)


def err(error: ErrorContract) -> Err:
    """Construct a failed result from a structured error contract."""
    return Err(error=error)


def is_ok(result: object) -> bool:
    """Return True if ``result`` is a success."""
    return isinstance(result, Ok)


def is_err(result: object) -> bool:
    """Return True if ``result`` is a failure."""
    return isinstance(result, Err)


# ---------------------------------------------------------------------------
# Pattern 1: Atomic Failure (no partial artifacts)
# ---------------------------------------------------------------------------


def atomic_failure(code: str, message: str, retryable: bool = True) -> ErrorContract:
    """Build an atomic-failure contract.

    No partial artifact was produced and prior state is unchanged
    (``retained_state=True``). Re-attemptable by default.

    Requirements: 3.7, 14.2, 14.3, 14.5, 14.7, 20.3, 20.7
    """
    return ErrorContract(
        code=code, message=message, retryable=retryable, retained_state=True
    )


# ---------------------------------------------------------------------------
# Pattern 2: Validation Rejection (input rejected at the boundary)
# ---------------------------------------------------------------------------


def validation_rejection(code: str, message: str) -> ErrorContract:
    """Build a validation-rejection contract.

    The input is rejected before any state mutation, so prior state is
    preserved (``retained_state=True``). The same input will fail again, so it
    is not retryable as-is.

    Requirements: 1.7, 3.5, 9.4, 10.2, 11.2, 14.2, 16.5, 27.3
    """
    return ErrorContract(
        code=code, message=message, retryable=False, retained_state=True
    )


# ---------------------------------------------------------------------------
# Pattern 3: Retain-and-Retry with bounded backoff
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RetrySchedule:
    """A bounded retry schedule (interval in minutes before each attempt)."""

    max_retries: int
    intervals_minutes: tuple[int, ...]


# Wearable background sync: 3 retries at 1, 5, 15 minutes (Req 9.7).
WEARABLE_SYNC_SCHEDULE = RetrySchedule(max_retries=3, intervals_minutes=(1, 5, 15))
# Consent-category cloud sync: 3 retries, exponential backoff (Req 17.5, 27.5).
CONSENT_SYNC_SCHEDULE = RetrySchedule(max_retries=3, intervals_minutes=(1, 2, 4))
# Weekly digest delivery: 3 retries at 30-minute intervals (Req 15.7).
DIGEST_DELIVERY_SCHEDULE = RetrySchedule(max_retries=3, intervals_minutes=(30, 30, 30))


def should_retry(schedule: RetrySchedule, attempts_made: int) -> bool:
    """Whether another retry should be attempted."""
    return 0 <= attempts_made < schedule.max_retries


def next_retry_delay_minutes(
    schedule: RetrySchedule, attempts_made: int
) -> Optional[int]:
    """Delay (minutes) before the next retry, or ``None`` when exhausted."""
    if not should_retry(schedule, attempts_made):
        return None
    idx = min(attempts_made, len(schedule.intervals_minutes) - 1)
    return schedule.intervals_minutes[idx]


@dataclass(frozen=True)
class RetainAndRetryOutcome:
    """The outcome of a retain-and-retry step."""

    error: ErrorContract
    will_retry: bool
    next_delay_minutes: Optional[int]


def retain_and_retry(
    code: str, message: str, schedule: RetrySchedule, attempts_made: int
) -> RetainAndRetryOutcome:
    """Build a retain-and-retry outcome.

    Affected data is always retained (``retained_state=True``). While retries
    remain, ``retryable`` is True; once exhausted it is False so the caller
    presents the notification / in-app fallback.

    Requirements: 9.7, 15.7, 17.5, 27.5
    """
    will_retry = should_retry(schedule, attempts_made)
    return RetainAndRetryOutcome(
        error=ErrorContract(
            code=code, message=message, retryable=will_retry, retained_state=True
        ),
        will_retry=will_retry,
        next_delay_minutes=next_retry_delay_minutes(schedule, attempts_made),
    )


# ---------------------------------------------------------------------------
# Pattern 4: Timeout & Capacity
# ---------------------------------------------------------------------------


def timeout_outcome(code: str, message: str) -> ErrorContract:
    """Cancelled in-flight operation: input retained, retry offered.

    Requirements: 1.2, 21.6
    """
    return ErrorContract(
        code=code, message=message, retryable=True, retained_state=True
    )


def capacity_exceeded(code: str, message: str) -> ErrorContract:
    """Excess load shed while accepted work is preserved; retry offered.

    Requirements: 23.3
    """
    return ErrorContract(
        code=code, message=message, retryable=True, retained_state=True
    )
