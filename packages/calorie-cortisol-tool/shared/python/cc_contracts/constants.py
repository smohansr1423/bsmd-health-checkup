"""Shared domain constants — field-level constraints (design: Data Models).

Python mirror of `@calorie-cortisol/shared` `constants.ts`.
"""

from __future__ import annotations

from typing import Dict

# Per-item recognition confidence range, inclusive (Req 2.2).
CONFIDENCE_MIN: int = 0
CONFIDENCE_MAX: int = 100

# Confidence at/above which a detection is auto-classified (Req 2.3/2.7).
CONFIDENCE_AUTO_THRESHOLD: int = 70

# Maximum number of detected/logged items in a single meal (Meal.items 0..20).
MAX_MEAL_ITEMS: int = 20

# Portion multiplier bounds and step (Req 5.1).
PORTION_MULTIPLIER_MIN: float = 0.25
PORTION_MULTIPLIER_MAX: float = 3.0
PORTION_MULTIPLIER_STEP: float = 0.25

# Wearable/patch reading value bounds in the reported unit (Req 9.4).
READING_VALUE_MIN: float = 0.01
READING_VALUE_MAX: float = 100.0

# Maximum members in a single family account (Req 19.1).
MAX_FAMILY_MEMBERS: int = 5

# Consecutive-day logging streak bounds (Req 6.4/6.5).
STREAK_MIN: int = 0
STREAK_MAX: int = 3650

# Correlation alignment window in minutes, inclusive (Req 15.1).
ALIGNMENT_WINDOW_MINUTES: int = 180

# Correlation significance gates (Req 15.3/15.4).
SIGNIFICANCE_MIN_PAIRS: int = 20
SIGNIFICANCE_MIN_ABS_COEFFICIENT: float = 0.5
SIGNIFICANCE_MAX_P_VALUE: float = 0.05

# Guidance recommendation-card count bounds (Req 13.1).
GUIDANCE_MIN_CARDS: int = 1
GUIDANCE_MAX_CARDS: int = 5

# Valid total-score ranges per questionnaire instrument (Req 10.1).
QUESTIONNAIRE_SCORE_RANGE: Dict[str, Dict[str, int]] = {
    "PSS-10": {"min": 0, "max": 40},
    "GAD-7": {"min": 0, "max": 21},
    "PSQI": {"min": 0, "max": 21},
}

# Expected item counts per questionnaire instrument (Req 10.2).
QUESTIONNAIRE_ITEM_COUNT: Dict[str, int] = {
    "PSS-10": 10,
    "GAD-7": 7,
    "PSQI": 19,
}
