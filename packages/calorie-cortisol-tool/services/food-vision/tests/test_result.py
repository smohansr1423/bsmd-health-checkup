"""Unit + property tests for the structured error/result contract (Task 1.3).

Requirements: 1.2, 3.5, 21.6, 23.3
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from app.result import (
    CONSENT_SYNC_SCHEDULE,
    DIGEST_DELIVERY_SCHEDULE,
    WEARABLE_SYNC_SCHEDULE,
    ErrorContract,
    RetrySchedule,
    atomic_failure,
    capacity_exceeded,
    err,
    is_err,
    is_ok,
    next_retry_delay_minutes,
    ok,
    retain_and_retry,
    should_retry,
    timeout_outcome,
    validation_rejection,
)


def _has_contract_shape(e: ErrorContract) -> bool:
    return (
        isinstance(e.code, str)
        and isinstance(e.message, str)
        and isinstance(e.retryable, bool)
        and isinstance(e.retained_state, bool)
    )


def test_ok_and_err_wrappers() -> None:
    r_ok = ok(42)
    assert is_ok(r_ok) and not is_err(r_ok)
    assert r_ok.value == 42

    contract = validation_rejection("BAD", "nope")
    r_err = err(contract)
    assert is_err(r_err) and not is_ok(r_err)
    assert r_err.error == contract


def test_atomic_failure_preserves_state_and_defaults_retryable() -> None:
    e = atomic_failure("EXPORT_FAILED", "could not write")
    assert e == ErrorContract("EXPORT_FAILED", "could not write", True, True)
    assert atomic_failure("DEL", "x", retryable=False).retryable is False


def test_validation_rejection_not_retryable_but_retains_state() -> None:
    e = validation_rejection("RES_TOO_LOW", "below 640x480")
    assert e.retryable is False
    assert e.retained_state is True


def test_wearable_retry_schedule_then_exhaust() -> None:
    s = WEARABLE_SYNC_SCHEDULE
    assert retain_and_retry("SYNC", "down", s, 0).next_delay_minutes == 1
    assert retain_and_retry("SYNC", "down", s, 1).next_delay_minutes == 5
    assert retain_and_retry("SYNC", "down", s, 2).next_delay_minutes == 15

    exhausted = retain_and_retry("SYNC", "down", s, 3)
    assert exhausted.will_retry is False
    assert exhausted.next_delay_minutes is None
    assert exhausted.error.retryable is False
    assert exhausted.error.retained_state is True


def test_digest_and_consent_schedules() -> None:
    assert next_retry_delay_minutes(DIGEST_DELIVERY_SCHEDULE, 0) == 30
    assert next_retry_delay_minutes(DIGEST_DELIVERY_SCHEDULE, 3) is None
    assert CONSENT_SYNC_SCHEDULE.intervals_minutes == (1, 2, 4)


def test_timeout_and_capacity_offer_retry_with_retained_state() -> None:
    t = timeout_outcome("ANALYSIS_TIMEOUT", "exceeded 10s")
    assert t.retryable is True and t.retained_state is True
    c = capacity_exceeded("CAPACITY_EXCEEDED", "shedding")
    assert c.retryable is True and c.retained_state is True


@settings(max_examples=100)
@given(st.text(min_size=1, max_size=40), st.text(max_size=120), st.booleans())
def test_every_factory_yields_well_formed_contract(
    code: str, message: str, retryable: bool
) -> None:
    for e in (
        atomic_failure(code, message, retryable=retryable),
        validation_rejection(code, message),
        timeout_outcome(code, message),
        capacity_exceeded(code, message),
    ):
        assert _has_contract_shape(e)


@settings(max_examples=100)
@given(
    st.text(min_size=1, max_size=40),
    st.text(max_size=120),
    st.lists(st.integers(min_value=1, max_value=60), min_size=1, max_size=5),
    st.integers(min_value=0, max_value=10),
)
def test_retain_and_retry_invariants(
    code: str, message: str, intervals: list[int], attempts_made: int
) -> None:
    schedule = RetrySchedule(max_retries=len(intervals), intervals_minutes=tuple(intervals))
    outcome = retain_and_retry(code, message, schedule, attempts_made)
    remaining = attempts_made < schedule.max_retries

    assert outcome.error.retained_state is True
    assert outcome.error.retryable is remaining
    assert outcome.will_retry is remaining
    assert should_retry(schedule, attempts_made) is remaining
    if remaining:
        assert outcome.next_delay_minutes is not None
    else:
        assert outcome.next_delay_minutes is None
