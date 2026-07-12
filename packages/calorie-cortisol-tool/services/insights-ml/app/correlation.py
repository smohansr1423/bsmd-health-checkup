"""Food/cortisol alignment and significance gating (Task 11.1).

Implements the ``POST /correlate`` core of the Insights & ML Service's
Correlation_Engine (design: "Insights & ML Service", Flow-level correlation).

Two responsibilities, scoped strictly to alignment + significance gating:

1. **Alignment (Req 15.1, 15.2)** — pair each food entry with the cortisol
   measurement nearest in time, provided their timestamps differ by at most
   ``±ALIGNMENT_WINDOW_MINUTES`` (180 min). Food entries with no partner inside
   the window are silently excluded (no error raised).

2. **Significance gating (Req 15.3, 15.4)** — within a rolling 30-day window,
   classify a relationship *significant* iff there are at least
   ``SIGNIFICANCE_MIN_PAIRS`` (20) aligned pairs AND
   ``|r| >= SIGNIFICANCE_MIN_ABS_COEFFICIENT`` (0.5) AND
   ``p < SIGNIFICANCE_MAX_P_VALUE`` (0.05). A significant relationship yields a
   smart alert describing it; otherwise significance analysis is withheld with a
   "more data required" indication.

Shared domain types (``AlignedPair``, ``CorrelationResult``) and shared
constants come from ``cc_contracts``. The numeric core (Pearson correlation and
its two-tailed p-value via the regularized incomplete beta function) is
implemented in pure Python so the service carries no heavy numeric dependency.

Recurring-pattern surfacing, milestone ranking (Task 11.4), guidance
(Task 11.7), and the weekly digest (Task 11.14) are intentionally out of scope.

Requirements: 15.1, 15.2, 15.3, 15.4
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Sequence

from cc_contracts.constants import (
    ALIGNMENT_WINDOW_MINUTES,
    SIGNIFICANCE_MAX_P_VALUE,
    SIGNIFICANCE_MIN_ABS_COEFFICIENT,
    SIGNIFICANCE_MIN_PAIRS,
)
from cc_contracts.domain import AlignedPair, CorrelationResult, CortisolReading, Meal

# Length of the rolling significance window (Req 15.3, 15.4).
ROLLING_WINDOW_DAYS = 30

# "More data required" indication surfaced when the pair count is below the gate.
MORE_DATA_REQUIRED_MESSAGE = (
    "More data required: at least {required} aligned food-cortisol pairs within a "
    "{days}-day window are needed before a relationship can be evaluated "
    "(currently {have})."
)


@dataclass
class FoodEntry:
    """The correlation-relevant projection of a logged food entry.

    A full :class:`cc_contracts.domain.Meal` carries far more than the two
    fields correlation needs, so the engine works on this lightweight view. Use
    :meth:`from_meal` to derive it from a shared ``Meal``.
    """

    id: str
    logged_at: str  # ISO-8601 timestamp (local + offset)
    calories: float  # the food-side variable correlated against cortisol

    @classmethod
    def from_meal(cls, meal: Meal) -> "FoodEntry":
        """Project a shared :class:`Meal` onto its correlation view."""
        return cls(
            id=meal.id,
            logged_at=meal.logged_at,
            calories=meal.totals.calories.value,
        )


@dataclass
class CorrelationOutcome:
    """The result of a ``POST /correlate`` evaluation.

    ``result`` always carries the pair count that was considered. When the pair
    count is below the gate, ``more_data_required`` is True, ``message`` holds
    the indication to surface, and the coefficient/p-value are left at their
    neutral defaults (0.0 / 1.0). When the gate is met, ``result`` carries the
    computed statistics and ``alert`` is populated iff the relationship is
    significant.
    """

    result: CorrelationResult
    aligned_pairs: List[AlignedPair]
    more_data_required: bool
    alert: Optional[str] = None
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Alignment (Req 15.1, 15.2)
# ---------------------------------------------------------------------------


def _parse_ts(value: str) -> datetime:
    """Parse an ISO-8601 timestamp, tolerating a trailing ``Z``."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _delta_minutes(a: datetime, b: datetime) -> float:
    """Absolute difference between two timestamps in minutes."""
    return abs((a - b).total_seconds()) / 60.0


def align_pairs(
    entries: Sequence[FoodEntry],
    readings: Sequence[CortisolReading],
    window_minutes: int = ALIGNMENT_WINDOW_MINUTES,
) -> List[AlignedPair]:
    """Align each food entry with its nearest in-window cortisol measurement.

    A food entry is paired with the cortisol reading closest in time, provided
    the timestamps differ by at most ``window_minutes`` (±180 by default). Food
    entries with no cortisol measurement inside the window are excluded from the
    result without raising an error (Req 15.2). Only readings flagged ``valid``
    are eligible partners (invalid readings are excluded upstream, Req 9.4).

    Returns pairs ordered by food-entry timestamp; ties on distance resolve to
    the earlier reading for determinism.

    Requirements: 15.1, 15.2
    """
    eligible = [r for r in readings if r.valid]
    parsed_readings = [(r, _parse_ts(r.measured_at)) for r in eligible]

    pairs: List[AlignedPair] = []
    for entry in sorted(entries, key=lambda e: _parse_ts(e.logged_at)):
        entry_ts = _parse_ts(entry.logged_at)
        best: Optional[CortisolReading] = None
        best_delta = float("inf")
        best_reading_ts: Optional[datetime] = None
        for reading, reading_ts in parsed_readings:
            delta = _delta_minutes(entry_ts, reading_ts)
            if delta > window_minutes:
                continue
            if delta < best_delta or (
                delta == best_delta
                and best_reading_ts is not None
                and reading_ts < best_reading_ts
            ):
                best = reading
                best_delta = delta
                best_reading_ts = reading_ts
        if best is not None:
            pairs.append(
                AlignedPair(
                    meal_id=entry.id,
                    reading_id=best.id,
                    delta_minutes=best_delta,
                )
            )
    return pairs


# ---------------------------------------------------------------------------
# Pure-Python Pearson correlation + two-tailed p-value
# ---------------------------------------------------------------------------


def _gammaln(x: float) -> float:
    """Natural log of the gamma function (Lanczos approximation)."""
    coefficients = (
        76.18009172947146,
        -86.50532032941677,
        24.01409824083091,
        -1.231739572450155,
        0.1208650973866179e-2,
        -0.5395239384953e-5,
    )
    y = x
    tmp = x + 5.5
    tmp -= (x + 0.5) * math.log(tmp)
    series = 1.000000000190015
    for coef in coefficients:
        y += 1.0
        series += coef / y
    return -tmp + math.log(2.5066282746310005 * series / x)


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Lentz's method)."""
    max_iter = 200
    eps = 3.0e-12
    fpmin = 1.0e-300

    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta function I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    bt = math.exp(
        _gammaln(a + b)
        - _gammaln(a)
        - _gammaln(b)
        + a * math.log(x)
        + b * math.log(1.0 - x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def pearson_r(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Pearson correlation coefficient, clamped to [-1, 1].

    Returns 0.0 when either variable has zero variance (relationship undefined).
    """
    n = len(xs)
    if n < 2 or n != len(ys):
        return 0.0
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    sxx = sum((x - mean_x) ** 2 for x in xs)
    syy = sum((y - mean_y) ** 2 for y in ys)
    if sxx <= 0.0 or syy <= 0.0:
        return 0.0
    r = sxy / math.sqrt(sxx * syy)
    return max(-1.0, min(1.0, r))


def correlation_p_value(r: float, n: int) -> float:
    """Two-tailed p-value for a Pearson r over ``n`` observations.

    Uses the Student-t transform ``t = r * sqrt((n-2)/(1-r^2))`` with ``n-2``
    degrees of freedom and evaluates the tail via the incomplete beta function.
    """
    if n < 3:
        return 1.0
    df = n - 2
    if abs(r) >= 1.0:
        return 0.0
    denom = 1.0 - r * r
    if denom <= 0.0:
        return 0.0
    t = r * math.sqrt(df / denom)
    return _betai(0.5 * df, 0.5, df / (df + t * t))


# ---------------------------------------------------------------------------
# Significance gating (Req 15.3, 15.4)
# ---------------------------------------------------------------------------


def _window_end(
    entries: Sequence[FoodEntry],
    readings: Sequence[CortisolReading],
    reference_time: Optional[datetime],
) -> Optional[datetime]:
    """Determine the end of the rolling window (latest timestamp by default)."""
    if reference_time is not None:
        return reference_time
    stamps: List[datetime] = [_parse_ts(e.logged_at) for e in entries]
    stamps += [_parse_ts(r.measured_at) for r in readings if r.valid]
    return max(stamps) if stamps else None


def _smart_alert(entries_by_id: dict, entry_calories: List[float], r: float) -> str:
    """Compose a plain-language smart alert describing a significant relationship."""
    direction = "higher" if r > 0 else "lower"
    return (
        f"We noticed a significant pattern: days with higher calorie intake tend to "
        f"align with {direction} cortisol readings (correlation {r:.2f}). This is a "
        f"general-wellness observation, not a medical diagnosis."
    )


def correlate(
    entries: Sequence[FoodEntry],
    readings: Sequence[CortisolReading],
    reference_time: Optional[datetime] = None,
    window_minutes: int = ALIGNMENT_WINDOW_MINUTES,
) -> CorrelationOutcome:
    """Align food/cortisol data and gate significance over a rolling 30-day window.

    Alignment excludes unpartnered food entries without error (Req 15.1, 15.2).
    Only aligned pairs whose food entry falls inside the rolling
    ``ROLLING_WINDOW_DAYS``-day window (ending at ``reference_time`` or, by
    default, the latest observed timestamp) are considered for significance.

    A relationship is significant iff at least ``SIGNIFICANCE_MIN_PAIRS`` pairs
    exist AND ``|r| >= SIGNIFICANCE_MIN_ABS_COEFFICIENT`` AND
    ``p < SIGNIFICANCE_MAX_P_VALUE``; significance yields a smart alert.
    Otherwise (too few pairs) analysis is withheld with a "more data required"
    indication.

    Requirements: 15.1, 15.2, 15.3, 15.4
    """
    entries_by_id = {e.id: e for e in entries}
    readings_by_id = {r.id: r for r in readings}

    all_pairs = align_pairs(entries, readings, window_minutes=window_minutes)

    end = _window_end(entries, readings, reference_time)
    if end is None:
        window_pairs: List[AlignedPair] = []
    else:
        start = end - timedelta(days=ROLLING_WINDOW_DAYS)
        window_pairs = [
            p
            for p in all_pairs
            if start <= _parse_ts(entries_by_id[p.meal_id].logged_at) <= end
        ]

    pair_count = len(window_pairs)

    # Req 15.4: below the pair gate, withhold analysis with a "more data" note.
    if pair_count < SIGNIFICANCE_MIN_PAIRS:
        return CorrelationOutcome(
            result=CorrelationResult(
                coefficient=0.0,
                p_value=1.0,
                pair_count=pair_count,
                significant=False,
            ),
            aligned_pairs=window_pairs,
            more_data_required=True,
            message=MORE_DATA_REQUIRED_MESSAGE.format(
                required=SIGNIFICANCE_MIN_PAIRS,
                days=ROLLING_WINDOW_DAYS,
                have=pair_count,
            ),
        )

    # Req 15.3: enough pairs — compute the relationship and classify it.
    xs = [entries_by_id[p.meal_id].calories for p in window_pairs]
    ys = [readings_by_id[p.reading_id].value_nmol_l for p in window_pairs]
    r = pearson_r(xs, ys)
    p = correlation_p_value(r, pair_count)
    significant = (
        abs(r) >= SIGNIFICANCE_MIN_ABS_COEFFICIENT and p < SIGNIFICANCE_MAX_P_VALUE
    )

    return CorrelationOutcome(
        result=CorrelationResult(
            coefficient=r,
            p_value=p,
            pair_count=pair_count,
            significant=significant,
        ),
        aligned_pairs=window_pairs,
        more_data_required=False,
        alert=_smart_alert(entries_by_id, xs, r) if significant else None,
        message=None if significant else "No significant relationship detected.",
    )
