"""Unit tests for weekly digest generation (Task 11.14).

Covers Req 15.6: Sunday-08:00 *local-time* scheduling and deterministic weekly
digest assembly, plus the delivery event modelled for the Notification Service.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from cc_contracts.domain import CorrelationResult, Insight

from app.correlation import CorrelationOutcome
from app.patterns import RecurringPattern
from app.result import is_ok
from app.digest import (
    DIGEST_DELIVERY_EVENT_TYPE,
    DigestRequest,
    assemble_weekly_digest,
    build_delivery_event,
    digest_slot_for,
    handle_digest,
    is_digest_due,
    next_weekly_digest_time,
)


def _insight(id_: str, approval: str = "approved", disclaimer: bool = True) -> Insight:
    return Insight(
        id=id_,
        template_id="t1",
        approval_status=approval,  # type: ignore[arg-type]
        disclaimer_rendered=disclaimer,
        rank_score=0.5,
    )


def _sig_outcome(significant: bool) -> CorrelationOutcome:
    return CorrelationOutcome(
        result=CorrelationResult(
            coefficient=0.7 if significant else 0.1,
            p_value=0.01 if significant else 0.4,
            pair_count=25,
            significant=significant,
        ),
        aligned_pairs=[],
        more_data_required=False,
        alert="Smart alert text." if significant else None,
        message=None if significant else "No significant relationship detected.",
    )


# ---------------------------------------------------------------------------
# Scheduling (Req 15.6)
# ---------------------------------------------------------------------------


def test_next_slot_from_midweek_is_upcoming_sunday_0800() -> None:
    # Wednesday 2024-06-05 10:00 -> Sunday 2024-06-09 08:00.
    now = datetime(2024, 6, 5, 10, 0)
    assert next_weekly_digest_time(now) == datetime(2024, 6, 9, 8, 0)


def test_next_slot_before_sunday_0800_is_same_day() -> None:
    # Sunday 2024-06-09 07:59 -> same day 08:00.
    now = datetime(2024, 6, 9, 7, 59)
    assert next_weekly_digest_time(now) == datetime(2024, 6, 9, 8, 0)


def test_next_slot_at_or_after_sunday_0800_rolls_to_following_week() -> None:
    at_slot = datetime(2024, 6, 9, 8, 0)
    after_slot = datetime(2024, 6, 9, 9, 0)
    assert next_weekly_digest_time(at_slot) == datetime(2024, 6, 16, 8, 0)
    assert next_weekly_digest_time(after_slot) == datetime(2024, 6, 16, 8, 0)


def test_is_digest_due_only_at_sunday_0800() -> None:
    assert is_digest_due(datetime(2024, 6, 9, 8, 0)) is True
    assert is_digest_due(datetime(2024, 6, 9, 8, 1)) is False
    assert is_digest_due(datetime(2024, 6, 9, 7, 0)) is False
    assert is_digest_due(datetime(2024, 6, 8, 8, 0)) is False  # Saturday


def test_scheduling_preserves_local_timezone_offset() -> None:
    # "Local time" is whatever offset the caller injects; it must be preserved.
    tz = timezone(timedelta(hours=5, minutes=30))  # e.g. IST
    now = datetime(2024, 6, 5, 10, 0, tzinfo=tz)
    slot = next_weekly_digest_time(now)
    assert slot == datetime(2024, 6, 9, 8, 0, tzinfo=tz)
    assert slot.utcoffset() == timedelta(hours=5, minutes=30)


def test_digest_slot_for_due_now_returns_now_slot() -> None:
    now = datetime(2024, 6, 9, 8, 0)
    assert digest_slot_for(now) == now
    # Off-slot falls forward to the upcoming Sunday 08:00.
    assert digest_slot_for(datetime(2024, 6, 5, 10, 0)) == datetime(2024, 6, 9, 8, 0)


# ---------------------------------------------------------------------------
# Digest assembly (Req 15.6)
# ---------------------------------------------------------------------------


def test_assemble_window_is_trailing_seven_days() -> None:
    generated = datetime(2024, 6, 9, 8, 0)
    digest = assemble_weekly_digest("u1", generated_at=generated, meals_logged=3, readings_logged=4)
    assert digest.week_end == date(2024, 6, 9)
    assert digest.week_start == date(2024, 6, 3)  # 7-day inclusive window
    assert (digest.week_end - digest.week_start) == timedelta(days=6)


def test_assemble_includes_only_approved_disclaimered_insights_sorted() -> None:
    insights = [
        _insight("b", "approved", True),
        _insight("a", "approved", True),
        _insight("c", "draft", True),  # not approved -> excluded
        _insight("d", "approved", False),  # no disclaimer -> excluded
    ]
    digest = assemble_weekly_digest("u1", datetime(2024, 6, 9, 8, 0), insights=insights)
    assert digest.insight_ids == ["a", "b"]


def test_assemble_carries_significant_correlation_alert() -> None:
    digest = assemble_weekly_digest(
        "u1", datetime(2024, 6, 9, 8, 0), correlation=_sig_outcome(True)
    )
    assert digest.significant_relationship is True
    assert digest.correlation_summary == "Smart alert text."


def test_assemble_uses_message_when_not_significant() -> None:
    digest = assemble_weekly_digest(
        "u1", datetime(2024, 6, 9, 8, 0), correlation=_sig_outcome(False)
    )
    assert digest.significant_relationship is False
    assert digest.correlation_summary == "No significant relationship detected."


def test_assemble_headline_is_nonclinical() -> None:
    digest = assemble_weekly_digest("u1", datetime(2024, 6, 9, 8, 0), meals_logged=5, readings_logged=2)
    assert "not a medical diagnosis" in digest.headline
    assert "5 meal(s)" in digest.headline


def test_assemble_recurring_patterns_surfaced() -> None:
    patterns = [
        RecurringPattern("calories~cortisol", "positive", 3, "pattern msg"),
    ]
    digest = assemble_weekly_digest(
        "u1", datetime(2024, 6, 9, 8, 0), recurring_patterns=patterns
    )
    assert digest.recurring_pattern_messages == ["pattern msg"]


def test_assemble_is_deterministic() -> None:
    generated = datetime(2024, 6, 9, 8, 0)
    a = assemble_weekly_digest("u1", generated, insights=[_insight("x")], meals_logged=1)
    b = assemble_weekly_digest("u1", generated, insights=[_insight("x")], meals_logged=1)
    assert a == b
    assert a.digest_id == "digest-u1-2024-06-09"


# ---------------------------------------------------------------------------
# Delivery event + GET /digest handler
# ---------------------------------------------------------------------------


def test_build_delivery_event_models_notification_payload() -> None:
    digest = assemble_weekly_digest("u1", datetime(2024, 6, 9, 8, 0))
    event = build_delivery_event(digest, scheduled_for=datetime(2024, 6, 9, 8, 0))
    assert event.event_type == DIGEST_DELIVERY_EVENT_TYPE
    assert event.user_id == "u1"
    assert event.digest_id == digest.digest_id
    payload = event.to_payload()
    assert payload["event_type"] == DIGEST_DELIVERY_EVENT_TYPE
    assert payload["scheduled_for"] == "2024-06-09T08:00:00"
    assert set(payload.keys()) == {
        "event_type",
        "user_id",
        "digest_id",
        "scheduled_for",
        "generated_at",
        "summary",
    }


def test_handle_digest_returns_ok_with_digest_and_event() -> None:
    request = DigestRequest(
        user_id="u1",
        now=datetime(2024, 6, 5, 10, 0),
        insights=[_insight("a")],
        recurring_patterns=[RecurringPattern("k", "positive", 3, "m")],
        correlation=_sig_outcome(True),
        meals_logged=7,
        readings_logged=3,
    )
    result = handle_digest(request)
    assert is_ok(result)
    outcome = result.value
    assert outcome.digest.user_id == "u1"
    assert outcome.digest.insight_ids == ["a"]
    assert outcome.event.event_type == DIGEST_DELIVERY_EVENT_TYPE
    # Off-slot generation: both the delivery slot and the next run are the
    # upcoming Sunday 08:00 (nothing has fired yet).
    assert outcome.scheduled_for == "2024-06-09T08:00:00"
    assert outcome.next_scheduled_for == "2024-06-09T08:00:00"


def test_handle_digest_due_now_delivers_current_slot() -> None:
    request = DigestRequest(user_id="u1", now=datetime(2024, 6, 9, 8, 0))
    outcome = handle_digest(request).value
    assert outcome.scheduled_for == "2024-06-09T08:00:00"
    assert outcome.next_scheduled_for == "2024-06-16T08:00:00"
    assert outcome.event.scheduled_for == "2024-06-09T08:00:00"
