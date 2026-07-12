"""Focused unit tests for food/cortisol alignment and significance gating (Task 11.1).

Covers the deterministic core of ``POST /correlate``:

* Alignment within ±180 min, nearest-partner selection, and silent exclusion of
  unpartnered food entries (Req 15.1, 15.2).
* Significance gating over a rolling 30-day window: significant iff ≥20 aligned
  pairs AND |r| ≥ 0.5 AND p < 0.05, with a smart alert; otherwise withheld with
  a "more data required" indication (Req 15.3, 15.4).

Property-based tests (Properties 33 & 34) are intentionally out of scope here
(Tasks 11.2 / 11.3).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from cc_contracts.constants import (
    ALIGNMENT_WINDOW_MINUTES,
    SIGNIFICANCE_MIN_PAIRS,
)
from cc_contracts.domain import (
    CortisolReading,
    Meal,
    NutrientValue,
    NutritionTotals,
)

from app.api import CorrelateRequest, handle_correlate
from app.correlation import (
    FoodEntry,
    align_pairs,
    correlate,
    correlation_p_value,
    pearson_r,
)
from app.result import is_ok

BASE = datetime(2024, 6, 1, 12, 0, 0)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _entry(entry_id: str, minutes_from_base: float, calories: float) -> FoodEntry:
    return FoodEntry(
        id=entry_id,
        logged_at=_iso(BASE + timedelta(minutes=minutes_from_base)),
        calories=calories,
    )


def _reading(
    reading_id: str,
    minutes_from_base: float,
    value: float,
    *,
    valid: bool = True,
) -> CortisolReading:
    return CortisolReading(
        id=reading_id,
        user_id="u1",
        measured_at=_iso(BASE + timedelta(minutes=minutes_from_base)),
        value_nmol_l=value,
        source="lab",
        time_of_day_bucket="noon",
        valid=valid,
    )


def _meal(meal_id: str, minutes_from_base: float, calories: float) -> Meal:
    nv = NutrientValue(value=calories, unit="kcal", lower=calories, upper=calories, available=True)
    zero = NutrientValue(value=0.0, unit="g", lower=0.0, upper=0.0, available=True)
    return Meal(
        id=meal_id,
        user_id="u1",
        logged_at=_iso(BASE + timedelta(minutes=minutes_from_base)),
        items=[],
        totals=NutritionTotals(calories=nv, protein=zero, carbs=zero, fat=zero),
        source="photo",
        sync_status="local",
    )


# ---------------------------------------------------------------------------
# Alignment (Req 15.1, 15.2)
# ---------------------------------------------------------------------------


def test_pairs_entry_with_in_window_reading() -> None:
    pairs = align_pairs([_entry("e1", 0, 500)], [_reading("r1", 60, 10)])
    assert len(pairs) == 1
    assert pairs[0].meal_id == "e1"
    assert pairs[0].reading_id == "r1"
    assert pairs[0].delta_minutes == 60.0


def test_boundary_at_exactly_window_is_included() -> None:
    pairs = align_pairs(
        [_entry("e1", 0, 500)],
        [_reading("r1", ALIGNMENT_WINDOW_MINUTES, 10)],
    )
    assert len(pairs) == 1
    assert pairs[0].delta_minutes == float(ALIGNMENT_WINDOW_MINUTES)


def test_reading_just_beyond_window_is_excluded() -> None:
    pairs = align_pairs(
        [_entry("e1", 0, 500)],
        [_reading("r1", ALIGNMENT_WINDOW_MINUTES + 1, 10)],
    )
    assert pairs == []


def test_unpartnered_entry_excluded_without_error() -> None:
    # Req 15.2: an entry with no reading in-window is silently dropped.
    entries = [_entry("e1", 0, 500), _entry("e2", 10_000, 700)]
    readings = [_reading("r1", 30, 10)]
    pairs = align_pairs(entries, readings)
    assert [p.meal_id for p in pairs] == ["e1"]


def test_nearest_reading_is_chosen() -> None:
    entries = [_entry("e1", 0, 500)]
    readings = [_reading("r_far", 120, 10), _reading("r_near", 20, 10)]
    pairs = align_pairs(entries, readings)
    assert len(pairs) == 1
    assert pairs[0].reading_id == "r_near"
    assert pairs[0].delta_minutes == 20.0


def test_invalid_readings_are_not_eligible_partners() -> None:
    entries = [_entry("e1", 0, 500)]
    readings = [_reading("r_invalid", 10, 10, valid=False)]
    assert align_pairs(entries, readings) == []


def test_empty_inputs_align_to_nothing() -> None:
    assert align_pairs([], []) == []


# ---------------------------------------------------------------------------
# Pearson correlation + p-value sanity
# ---------------------------------------------------------------------------


def test_perfect_positive_correlation() -> None:
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert pearson_r(xs, ys) == 1.0


def test_perfect_negative_correlation() -> None:
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [10.0, 8.0, 6.0, 4.0, 2.0]
    assert pearson_r(xs, ys) == -1.0


def test_zero_variance_yields_zero_r() -> None:
    assert pearson_r([1.0, 1.0, 1.0], [1.0, 2.0, 3.0]) == 0.0


def test_p_value_small_for_strong_correlation() -> None:
    xs = [float(i) for i in range(25)]
    ys = [2.0 * i + 1.0 for i in range(25)]
    r = pearson_r(xs, ys)
    assert r > 0.99
    assert correlation_p_value(r, len(xs)) < 0.05


def test_p_value_bounded_in_unit_interval() -> None:
    p = correlation_p_value(0.3, 10)
    assert 0.0 <= p <= 1.0


# ---------------------------------------------------------------------------
# Significance gating (Req 15.3, 15.4)
# ---------------------------------------------------------------------------


def test_below_pair_gate_withholds_with_more_data_required() -> None:
    # 5 aligned pairs < 20 -> analysis withheld (Req 15.4).
    entries = [_entry(f"e{i}", i * 10, 500 + i) for i in range(5)]
    readings = [_reading(f"r{i}", i * 10 + 5, 10 + i) for i in range(5)]
    outcome = correlate(entries, readings)
    assert outcome.more_data_required is True
    assert outcome.alert is None
    assert outcome.result.significant is False
    assert outcome.result.pair_count == 5
    assert outcome.message is not None and "More data required" in outcome.message


def test_strong_correlation_at_gate_is_significant_with_alert() -> None:
    # Exactly 20 strongly-correlated pairs -> significant + smart alert (Req 15.3).
    n = SIGNIFICANCE_MIN_PAIRS
    entries = [_entry(f"e{i}", i * 60, 300.0 + 25.0 * i) for i in range(n)]
    readings = [_reading(f"r{i}", i * 60 + 5, 5.0 + 0.9 * i) for i in range(n)]
    outcome = correlate(entries, readings)
    assert outcome.more_data_required is False
    assert outcome.result.pair_count == n
    assert outcome.result.significant is True
    assert abs(outcome.result.coefficient) >= 0.5
    assert outcome.result.p_value < 0.05
    assert outcome.alert is not None


def test_enough_pairs_but_weak_correlation_not_significant() -> None:
    # 20 pairs whose food/cortisol values are unrelated -> not significant, no alert.
    n = SIGNIFICANCE_MIN_PAIRS
    cal_pattern = [300.0, 900.0, 500.0, 700.0, 400.0]
    cort_pattern = [12.0, 6.0, 15.0, 5.0, 18.0]
    entries = [_entry(f"e{i}", i * 60, cal_pattern[i % len(cal_pattern)]) for i in range(n)]
    readings = [
        _reading(f"r{i}", i * 60 + 5, cort_pattern[(i * 3) % len(cort_pattern)])
        for i in range(n)
    ]
    outcome = correlate(entries, readings)
    assert outcome.more_data_required is False
    assert outcome.result.pair_count == n
    if outcome.result.significant:
        raise AssertionError("weak correlation should not be classified significant")
    assert outcome.alert is None


def test_pairs_outside_rolling_window_are_excluded() -> None:
    # Reference time pins the window end; entries older than 30 days drop out.
    ref = BASE + timedelta(days=100)
    # 20 recent pairs (within 30 days of ref) + old pairs beyond the window.
    recent = [_entry(f"e{i}", (70 + i) * 24 * 60, 300.0 + 25.0 * i) for i in range(SIGNIFICANCE_MIN_PAIRS)]
    recent_r = [_reading(f"r{i}", (70 + i) * 24 * 60 + 5, 5.0 + 0.9 * i) for i in range(SIGNIFICANCE_MIN_PAIRS)]
    old = [_entry(f"eo{i}", i * 60, 500.0) for i in range(10)]
    old_r = [_reading(f"ro{i}", i * 60 + 5, 10.0) for i in range(10)]
    outcome = correlate(recent + old, recent_r + old_r, reference_time=ref)
    # Only the 20 recent pairs fall inside the rolling 30-day window.
    assert outcome.result.pair_count == SIGNIFICANCE_MIN_PAIRS


def test_empty_inputs_report_more_data_required() -> None:
    outcome = correlate([], [])
    assert outcome.more_data_required is True
    assert outcome.result.pair_count == 0
    assert outcome.alert is None


# ---------------------------------------------------------------------------
# Handler wiring (POST /correlate)
# ---------------------------------------------------------------------------


def test_handler_returns_ok_result_with_outcome() -> None:
    meals = [_meal(f"m{i}", i * 60, 300.0 + 25.0 * i) for i in range(SIGNIFICANCE_MIN_PAIRS)]
    readings = [_reading(f"r{i}", i * 60 + 5, 5.0 + 0.9 * i) for i in range(SIGNIFICANCE_MIN_PAIRS)]
    result = handle_correlate(CorrelateRequest(user_id="u1", meals=meals, readings=readings))
    assert is_ok(result)
    assert result.value.result.pair_count == SIGNIFICANCE_MIN_PAIRS
    assert result.value.result.significant is True


def test_handler_projects_meal_calories() -> None:
    # Meal totals.calories.value is the food-side variable projected into correlation.
    meals = [_meal("m1", 0, 640.0)]
    readings = [_reading("r1", 30, 12.0)]
    result = handle_correlate(CorrelateRequest(user_id="u1", meals=meals, readings=readings))
    assert is_ok(result)
    # One pair aligned; below gate so more data required, but pairing succeeded.
    assert result.value.result.pair_count == 1
    assert result.value.aligned_pairs[0].meal_id == "m1"
