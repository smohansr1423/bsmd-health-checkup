"""Property-based tests for recurring-pattern surfacing (Task 11.5).

Property 35: Recurring-pattern surfacing threshold.
    *For any* 30-day window, a same-direction significant relationship is surfaced
    as recurring if and only if it is detected on at least 3 separate days.

Validates: Requirements 15.5
Tag: Feature: calorie-cortisol-tool, Property 35

The test drives :func:`app.patterns.detect_recurring_patterns` with randomly
generated per-day detections and compares its output against an independent
oracle that encodes the acceptance criterion directly (group in-window
significant detections by ``(relationship_key, direction)``, count *distinct*
calendar days, surface iff that count reaches the threshold). Direction is the
sign of the correlation coefficient; a zero coefficient carries no direction.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List, Set, Tuple

from hypothesis import given, settings
from hypothesis import strategies as st

from app.patterns import (
    RECURRING_MIN_DISTINCT_DAYS,
    ROLLING_WINDOW_DAYS,
    DailyDetection,
    detect_recurring_patterns,
)

BASE = date(2024, 6, 1)

# A small key/day space so the >=3-distinct-day threshold is crossed frequently
# (both the surfaced and not-surfaced sides of the "iff" get exercised), while a
# day range wider than the 30-day window also exercises window exclusion.
_KEYS = ("calories~cortisol", "protein~cortisol")
_MAX_DAY_OFFSET = ROLLING_WINDOW_DAYS + 15  # spills past the rolling window


@st.composite
def _detections(draw: st.DrawFn) -> List[DailyDetection]:
    n = draw(st.integers(min_value=0, max_value=25))
    detections: List[DailyDetection] = []
    for _ in range(n):
        day_offset = draw(st.integers(min_value=0, max_value=_MAX_DAY_OFFSET))
        key = draw(st.sampled_from(_KEYS))
        significant = draw(st.booleans())
        coefficient = draw(
            st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False)
        )
        detections.append(
            DailyDetection(
                day=BASE + timedelta(days=day_offset),
                significant=significant,
                coefficient=coefficient,
                relationship_key=key,
            )
        )
    return detections


def _expected_recurring(detections: List[DailyDetection]) -> Set[Tuple[str, str]]:
    """Independent oracle: which (relationship_key, direction) groups must surface.

    Mirrors Req 15.5 directly: over the rolling window ending at the latest detection
    day, group significant same-direction detections and surface a group iff it spans
    at least ``RECURRING_MIN_DISTINCT_DAYS`` separate calendar days.
    """
    if not detections:
        return set()
    end = max(d.day for d in detections)
    start = end - timedelta(days=ROLLING_WINDOW_DAYS)

    groups: Dict[Tuple[str, str], Set[date]] = {}
    for det in detections:
        if not det.significant:
            continue
        if not (start <= det.day <= end):
            continue
        if det.coefficient > 0:
            direction = "positive"
        elif det.coefficient < 0:
            direction = "negative"
        else:
            continue
        groups.setdefault((det.relationship_key, direction), set()).add(det.day)

    return {key for key, days in groups.items() if len(days) >= RECURRING_MIN_DISTINCT_DAYS}


@settings(max_examples=100)
@given(_detections())
def test_recurring_surfaced_iff_three_distinct_days(
    detections: List[DailyDetection],
) -> None:
    """Property 35 — Feature: calorie-cortisol-tool, Property 35 (Validates: Req 15.5)."""
    patterns = detect_recurring_patterns(detections)
    surfaced = {(p.relationship_key, p.direction) for p in patterns}

    # iff: surfaced groups are exactly those meeting the >=3 distinct-day threshold.
    assert surfaced == _expected_recurring(detections)

    # Every surfaced pattern reports a distinct-day count at or above the threshold,
    # and no duplicate (key, direction) is emitted.
    assert len(surfaced) == len(patterns)
    for pattern in patterns:
        assert pattern.distinct_days >= RECURRING_MIN_DISTINCT_DAYS
