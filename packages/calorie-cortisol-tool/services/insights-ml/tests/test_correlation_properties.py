"""Property-based tests for food/cortisol significance gating (Task 11.3).

Exercises the significance-gating core of ``POST /correlate`` in
``app.correlation`` against the design's correctness property:

- **Property 34: Significance gating and classification**
  (Task 11.3, Validates: Requirements 15.3, 15.4)

The property runs a minimum of 100 generated iterations
(``@settings(max_examples=100)``) and is tagged in the format
``Feature: calorie-cortisol-tool, Property 34``.

The implementation already exists (Task 11.1); this test only observes it.

Property 33 (alignment window correctness, Task 11.2) is intentionally out of
scope here.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Tuple

from hypothesis import given, settings
from hypothesis import strategies as st

from cc_contracts.constants import (
    SIGNIFICANCE_MAX_P_VALUE,
    SIGNIFICANCE_MIN_ABS_COEFFICIENT,
    SIGNIFICANCE_MIN_PAIRS,
)
from cc_contracts.domain import CortisolReading

from app.correlation import FoodEntry, correlate

# ---------------------------------------------------------------------------
# Shared generators
# ---------------------------------------------------------------------------

# Window anchor. Every generated pair is placed inside the rolling 30-day
# window that ends at REFERENCE_TIME, so alignment/window trimming never
# silently changes the pair count out from under the classification check.
REFERENCE_TIME = datetime(2024, 6, 30, 12, 0, 0)

# Spacing between successive pairs. Far larger than the ±180-min alignment
# window so each food entry aligns with exactly its own reading (no cross-talk)
# while every timestamp still lands well within the 30-day window
# (40 pairs x 240 min ~= 6.7 days).
_PAIR_SPACING_MINUTES = 240
# Small in-window offset between a food entry and its paired reading.
_INTRA_PAIR_OFFSET_MINUTES = 3


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _reading(reading_id: str, measured_at: datetime, value: float) -> CortisolReading:
    return CortisolReading(
        id=reading_id,
        user_id="u1",
        measured_at=_iso(measured_at),
        value_nmol_l=value,
        source="lab",
        time_of_day_bucket="noon",
        valid=True,
    )


@st.composite
def _scenarios(
    draw: st.DrawFn,
) -> Tuple[List[FoodEntry], List[CortisolReading]]:
    """Generate aligned food/cortisol scenarios spanning the classification space.

    The pair count is drawn to straddle the ``SIGNIFICANCE_MIN_PAIRS`` gate
    (both below and well above 20), and each (calorie, cortisol) pair is built
    from a latent linear model ``cortisol = intercept + slope * calorie + noise``
    whose ``slope`` and ``noise_scale`` are drawn to span the full range from
    strong (|r| well above 0.5) to negligible correlation. This ensures the
    generated data exercises both the "significant" and "not significant"
    branches as well as the "more data required" branch.
    """
    n = draw(st.integers(min_value=0, max_value=40))

    slope = draw(
        st.floats(min_value=-0.05, max_value=0.05, allow_nan=False, allow_infinity=False)
    )
    noise_scale = draw(
        st.floats(min_value=0.0, max_value=40.0, allow_nan=False, allow_infinity=False)
    )
    intercept = draw(
        st.floats(min_value=1.0, max_value=25.0, allow_nan=False, allow_infinity=False)
    )

    calories = draw(
        st.lists(
            st.floats(
                min_value=100.0, max_value=1200.0, allow_nan=False, allow_infinity=False
            ),
            min_size=n,
            max_size=n,
        )
    )
    noises = draw(
        st.lists(
            st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False),
            min_size=n,
            max_size=n,
        )
    )

    # Start far enough back that the newest pair still ends before REFERENCE_TIME.
    window_start = REFERENCE_TIME - timedelta(minutes=_PAIR_SPACING_MINUTES * (n + 1))

    entries: List[FoodEntry] = []
    readings: List[CortisolReading] = []
    for i in range(n):
        entry_ts = window_start + timedelta(minutes=_PAIR_SPACING_MINUTES * i)
        reading_ts = entry_ts + timedelta(minutes=_INTRA_PAIR_OFFSET_MINUTES)
        cal = calories[i]
        cortisol = intercept + slope * cal + noise_scale * noises[i]
        entries.append(FoodEntry(id=f"e{i}", logged_at=_iso(entry_ts), calories=cal))
        readings.append(_reading(f"r{i}", reading_ts, cortisol))

    return entries, readings


# ---------------------------------------------------------------------------
# Property 34: Significance gating and classification
# Feature: calorie-cortisol-tool, Property 34
# Validates: Requirements 15.3, 15.4
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(scenario=_scenarios())
def test_property_34_significance_gating_and_classification(
    scenario: Tuple[List[FoodEntry], List[CortisolReading]],
) -> None:
    """Feature: calorie-cortisol-tool, Property 34.

    For any rolling 30-day window, a relationship is classified significant
    (with a smart alert) if and only if there are at least
    ``SIGNIFICANCE_MIN_PAIRS`` (20) aligned pairs AND
    ``|r| >= SIGNIFICANCE_MIN_ABS_COEFFICIENT`` (0.5) AND
    ``p < SIGNIFICANCE_MAX_P_VALUE`` (0.05); otherwise, when fewer than 20
    aligned pairs exist, significance analysis is withheld with a
    "more data required" indication (Req 15.3, 15.4).
    """
    entries, readings = scenario
    outcome = correlate(entries, readings, reference_time=REFERENCE_TIME)
    result = outcome.result

    pair_count = result.pair_count

    # --- Core iff of the classification rule (Req 15.3) -------------------
    # The significant flag holds exactly when all three gates are satisfied,
    # evaluated against the statistics the engine itself computed/reported.
    expected_significant = (
        pair_count >= SIGNIFICANCE_MIN_PAIRS
        and abs(result.coefficient) >= SIGNIFICANCE_MIN_ABS_COEFFICIENT
        and result.p_value < SIGNIFICANCE_MAX_P_VALUE
    )
    assert result.significant is expected_significant, (
        f"classification mismatch: significant={result.significant} but gates give "
        f"{expected_significant} (pairs={pair_count}, r={result.coefficient}, "
        f"p={result.p_value})"
    )

    # --- A significant relationship is accompanied by a smart alert -------
    if result.significant:
        assert outcome.alert is not None, "significant relationship must yield a smart alert"
        assert outcome.more_data_required is False
        # A significant coefficient is a real (non-degenerate) relationship.
        assert abs(result.coefficient) >= SIGNIFICANCE_MIN_ABS_COEFFICIENT
        assert result.p_value < SIGNIFICANCE_MAX_P_VALUE
    else:
        # No alert is surfaced when the relationship is not significant.
        assert outcome.alert is None

    # --- "More data required" gating (Req 15.4) ---------------------------
    # Below the pair gate: analysis is withheld with a more-data indication;
    # such a relationship can never be classified significant.
    if pair_count < SIGNIFICANCE_MIN_PAIRS:
        assert outcome.more_data_required is True
        assert result.significant is False
        assert outcome.alert is None
        assert outcome.message is not None
        assert "more data required" in outcome.message.lower()
    else:
        # At or above the gate, significance analysis is performed (not withheld).
        assert outcome.more_data_required is False

    # --- Reported statistics stay in their valid domains ------------------
    assert -1.0 <= result.coefficient <= 1.0
    assert 0.0 <= result.p_value <= 1.0
    assert pair_count >= 0
