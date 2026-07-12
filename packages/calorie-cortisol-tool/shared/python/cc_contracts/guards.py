"""Lightweight validation / guard helpers — Python mirror of `guards.ts`.

Pure, dependency-free field-level checks shared across the Python services.
"""

from __future__ import annotations

import math
import re
from typing import List

from cc_contracts import constants
from cc_contracts.domain import (
    AlignedPair,
    CorrelationResult,
    FamilyAccount,
    FoodItem,
    Meal,
    MealItem,
    NutrientValue,
    PortionEstimate,
)

_WAKE_TIME_RE = re.compile(r"^([0-9]{2}):([0-9]{2})$")


def _is_finite(n: object) -> bool:
    return isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)


def is_valid_confidence(confidence: float) -> bool:
    """Recognition confidence lies within the inclusive 0..100 range (Req 2.2)."""
    return (
        _is_finite(confidence)
        and constants.CONFIDENCE_MIN <= confidence <= constants.CONFIDENCE_MAX
    )


def is_valid_food_item(item: FoodItem) -> bool:
    """A FoodItem has a non-empty label and an in-range confidence (Req 2.2)."""
    return (
        isinstance(item.id, str)
        and len(item.id) > 0
        and isinstance(item.label, str)
        and len(item.label) > 0
        and is_valid_confidence(item.confidence)
    )


def is_valid_portion_estimate(estimate: PortionEstimate) -> bool:
    """Portion volume is a finite value >= 0 (Req 3)."""
    return (
        _is_finite(estimate.volume_ml)
        and estimate.volume_ml >= 0
        and _is_finite(estimate.error_pct)
        and isinstance(estimate.scaled, bool)
    )


def is_valid_nutrient_value(nv: NutrientValue) -> bool:
    """lower <= value <= upper with value >= 0 (Req 4.5)."""
    return (
        _is_finite(nv.value)
        and _is_finite(nv.lower)
        and _is_finite(nv.upper)
        and nv.value >= 0
        and nv.lower <= nv.value <= nv.upper
    )


def is_valid_portion_multiplier(multiplier: float) -> bool:
    """Within 0.25..3.0 and on a 0.25 step (Req 5.1)."""
    if not _is_finite(multiplier):
        return False
    if not (
        constants.PORTION_MULTIPLIER_MIN
        <= multiplier
        <= constants.PORTION_MULTIPLIER_MAX
    ):
        return False
    steps = multiplier / constants.PORTION_MULTIPLIER_STEP
    return abs(steps - round(steps)) < 1e-9


def is_valid_meal_item(item: MealItem) -> bool:
    """A meal item has a valid food item and portion multiplier (Req 5.1)."""
    return is_valid_food_item(item.food_item) and is_valid_portion_multiplier(
        item.portion_multiplier
    )


def is_valid_meal(meal: Meal) -> bool:
    """A meal holds 0..20 valid items (Meal.items 0..20)."""
    return (
        isinstance(meal.items, list)
        and len(meal.items) <= constants.MAX_MEAL_ITEMS
        and all(is_valid_meal_item(i) for i in meal.items)
    )


def is_valid_reading_value(value: float) -> bool:
    """A wearable/patch reading value is within [0.01, 100] (Req 9.4)."""
    return (
        _is_finite(value)
        and constants.READING_VALUE_MIN <= value <= constants.READING_VALUE_MAX
    )


def is_valid_streak(streak: int) -> bool:
    """A consecutive-day streak is a whole number in [0, 3650] (Req 6.4/6.5)."""
    return (
        isinstance(streak, int)
        and not isinstance(streak, bool)
        and constants.STREAK_MIN <= streak <= constants.STREAK_MAX
    )


def is_questionnaire_complete(q_type: str, answers: List[int]) -> bool:
    """All required items answered (Req 10.2)."""
    return (
        isinstance(answers, list)
        and len(answers) == constants.QUESTIONNAIRE_ITEM_COUNT[q_type]
        and all(_is_finite(a) for a in answers)
    )


def is_valid_questionnaire_score(q_type: str, total_score: float) -> bool:
    """Total score lies within the instrument's valid range (Req 10.1)."""
    rng = constants.QUESTIONNAIRE_SCORE_RANGE[q_type]
    return _is_finite(total_score) and rng["min"] <= total_score <= rng["max"]


def is_within_alignment_window(pair: AlignedPair) -> bool:
    """An aligned pair falls within the +/-180 min window (Req 15.1)."""
    return (
        _is_finite(pair.delta_minutes)
        and abs(pair.delta_minutes) <= constants.ALIGNMENT_WINDOW_MINUTES
    )


def meets_significance_gate(result: CorrelationResult) -> bool:
    """>=20 aligned pairs AND |r| >= 0.5 AND p < 0.05 (Req 15.3/15.4)."""
    return (
        result.pair_count >= constants.SIGNIFICANCE_MIN_PAIRS
        and abs(result.coefficient) >= constants.SIGNIFICANCE_MIN_ABS_COEFFICIENT
        and result.p_value < constants.SIGNIFICANCE_MAX_P_VALUE
    )


def is_within_family_capacity(account: FamilyAccount) -> bool:
    """A family account holds no more than 5 members (Req 19.1)."""
    return (
        isinstance(account.members, list)
        and len(account.members) <= constants.MAX_FAMILY_MEMBERS
    )


def is_valid_wake_time(time: str) -> bool:
    """A valid 24h "HH:MM" in 00:00..23:59 (Req 16.5)."""
    if not isinstance(time, str):
        return False
    match = _WAKE_TIME_RE.match(time)
    if not match:
        return False
    hours = int(match.group(1))
    minutes = int(match.group(2))
    return 0 <= hours <= 23 and 0 <= minutes <= 59
