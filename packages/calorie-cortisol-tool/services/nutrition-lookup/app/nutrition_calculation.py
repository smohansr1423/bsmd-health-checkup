"""Nutrition calculation with confidence ranges and partial availability (Task 7.1).

Implements the ``POST /nutrition`` core logic described in the design's
*Nutrition Lookup Service* section:

    items + volumes -> primary macros + secondary nutrients + optional
    micronutrient overlay, per-value confidence ranges, and per-nutrient
    "unavailable" flagging while returning all calculable values; density
    lookup for volume->mass.

This module is a **pure, testable** unit that operates over a supplied list of
recognized items (food class + estimated volume + portion multiplier + the
portion estimator's error band). It performs the density lookup (volume ->
mass), scales a per-100 g reference profile to the item mass, aggregates across
items, and attaches a confidence range to every displayed value.

Kept deliberately separate from the food search / barcode / menu-OCR lookup
endpoints (Task 7.4) so the two workstreams do not collide: this file owns
*nutrition calculation* only.

The domain shapes (``NutrientValue`` etc.) mirror the shared contract in
``shared/python/cc_contracts`` (``NutrientValue`` / ``NutritionTotals``). They
are re-declared locally so the service stays self-contained and installable via
``poetry install --no-root`` (the same pattern the Food Vision service uses for
its ``result``/``accuracy_eval`` modules), rather than taking a build-time
dependency on the shared package.

Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

from app.result import Err, Ok, err, ok, validation_rejection

# ---------------------------------------------------------------------------
# Nutrient taxonomy and units (Req 4.1 / 4.2)
# ---------------------------------------------------------------------------

#: Primary macros, in display order (Req 4.1): calories in kcal; protein,
#: carbohydrates and fat in grams.
PRIMARY_NUTRIENTS: Tuple[str, ...] = ("calories", "protein", "carbs", "fat")

#: Secondary nutrients, in display order (Req 4.2): fiber/sugar/saturated fat in
#: grams, sodium/cholesterol in milligrams.
SECONDARY_NUTRIENTS: Tuple[str, ...] = (
    "fiber",
    "sugar",
    "sodium",
    "saturated_fat",
    "cholesterol",
)

#: Unit for every primary/secondary nutrient (Req 4.1 / 4.2).
NUTRIENT_UNITS: Dict[str, str] = {
    "calories": "kcal",
    "protein": "g",
    "carbs": "g",
    "fat": "g",
    "fiber": "g",
    "sugar": "g",
    "sodium": "mg",
    "saturated_fat": "g",
    "cholesterol": "mg",
}

#: Decimal places every displayed value is rounded to (Req 4.1 / 4.2).
DISPLAY_DECIMALS = 1


# ---------------------------------------------------------------------------
# Domain types (mirror of cc_contracts.NutrientValue / NutritionTotals)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NutrientValue:
    """A single nutrient value with its confidence range (Req 4.5 / 4.6).

    Invariant when ``available`` is True: ``lower <= value <= upper`` and all
    three share ``unit`` (Req 4.5). When ``available`` is False the nutrient
    could not be calculated for the meal (Req 4.6) and the numeric fields are
    zeroed placeholders that callers must not display as a real value.
    """

    value: float
    unit: str
    lower: float
    upper: float
    available: bool


@dataclass(frozen=True)
class NutritionResult:
    """The computed nutrition breakdown for a meal (Req 4.1-4.6)."""

    #: calories/protein/carbs/fat, each present (available flag set per Req 4.6).
    primary: Dict[str, NutrientValue]
    #: fiber/sugar/sodium/saturated_fat/cholesterol, each present.
    secondary: Dict[str, NutrientValue]
    #: Present only when the overlay is enabled AND >=1 micronutrient is
    #: available (Req 4.3); ``None`` otherwise.
    micronutrients: Optional[Dict[str, NutrientValue]]
    #: True when the caller enabled the micronutrient overlay.
    micronutrient_overlay_enabled: bool
    #: Set to the "no micronutrient data available" indication when the overlay
    #: is enabled but nothing is available (Req 4.4); ``None`` otherwise.
    micronutrient_message: Optional[str]
    #: Total mass (grams) the breakdown was computed from (density lookup).
    mass_g: float


# ---------------------------------------------------------------------------
# Reference database: density + per-100 g nutrient profiles
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FoodProfile:
    """A reference profile for one food class.

    ``density_g_per_ml`` drives the volume->mass lookup. ``per_100g`` maps each
    primary/secondary nutrient to its per-100 g amount, or ``None`` when the
    reference database has no value for that nutrient -- which is what surfaces
    a per-nutrient "unavailable" flag downstream (Req 4.6).
    ``micronutrients_per_100g`` maps a micronutrient name to ``(amount, unit)``.
    """

    density_g_per_ml: float
    per_100g: Dict[str, Optional[float]]
    micronutrients_per_100g: Dict[str, Tuple[float, str]] = field(default_factory=dict)


def _profile(
    density: float,
    calories: Optional[float],
    protein: Optional[float],
    carbs: Optional[float],
    fat: Optional[float],
    fiber: Optional[float],
    sugar: Optional[float],
    sodium: Optional[float],
    saturated_fat: Optional[float],
    cholesterol: Optional[float],
    micronutrients: Optional[Dict[str, Tuple[float, str]]] = None,
) -> FoodProfile:
    return FoodProfile(
        density_g_per_ml=density,
        per_100g={
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fat,
            "fiber": fiber,
            "sugar": sugar,
            "sodium": sodium,
            "saturated_fat": saturated_fat,
            "cholesterol": cholesterol,
        },
        micronutrients_per_100g=micronutrients or {},
    )


#: Small reference DB (values approximate, per 100 g). Some nutrients are
#: intentionally ``None`` to model incomplete database coverage (Req 4.6).
FOOD_DATABASE: Dict[str, FoodProfile] = {
    "rice_cooked": _profile(
        density=0.85,
        calories=130.0,
        protein=2.7,
        carbs=28.0,
        fat=0.3,
        fiber=0.4,
        sugar=0.1,
        sodium=1.0,
        saturated_fat=0.1,
        cholesterol=0.0,
        micronutrients={"iron": (0.2, "mg"), "magnesium": (12.0, "mg")},
    ),
    "chicken_breast": _profile(
        density=1.05,
        calories=165.0,
        protein=31.0,
        carbs=0.0,
        fat=3.6,
        fiber=0.0,
        sugar=0.0,
        sodium=74.0,
        saturated_fat=1.0,
        cholesterol=85.0,
        micronutrients={"potassium": (256.0, "mg"), "vitamin_b6": (0.6, "mg")},
    ),
    "broccoli": _profile(
        density=0.37,
        calories=34.0,
        protein=2.8,
        carbs=6.6,
        fat=0.4,
        fiber=2.6,
        sugar=1.7,
        sodium=33.0,
        saturated_fat=0.1,
        cholesterol=0.0,
        micronutrients={"vitamin_c": (89.2, "mg"), "vitamin_k": (101.6, "mcg")},
    ),
    "olive_oil": _profile(
        density=0.91,
        calories=884.0,
        protein=0.0,
        carbs=0.0,
        fat=100.0,
        fiber=0.0,
        sugar=0.0,
        sodium=2.0,
        saturated_fat=13.8,
        cholesterol=0.0,
        micronutrients={"vitamin_e": (14.4, "mg")},
    ),
    "apple": _profile(
        density=0.60,
        calories=52.0,
        protein=0.3,
        carbs=13.8,
        fat=0.2,
        fiber=2.4,
        sugar=10.4,
        sodium=1.0,
        saturated_fat=0.0,
        # Cholesterol data intentionally missing for this class (Req 4.6).
        cholesterol=None,
        micronutrients={"vitamin_c": (4.6, "mg")},
    ),
    "house_soup": _profile(
        # A composite dish with only partial database coverage: macros known,
        # most secondary nutrients unknown (Req 4.6). No micronutrient data.
        density=1.02,
        calories=56.0,
        protein=3.0,
        carbs=6.0,
        fat=2.0,
        fiber=None,
        sugar=None,
        sodium=410.0,
        saturated_fat=None,
        cholesterol=None,
        micronutrients={},
    ),
}


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NutritionRequestItem:
    """One recognized item to price into nutrition.

    ``volume_ml`` is the Portion_Estimator's volume estimate; ``error_pct`` is
    its reported error band (e.g. 15 for single-angle / 8 for multi-angle),
    used to widen the confidence range (Req 4.5). ``portion_multiplier`` is the
    user-facing 0.25x-3x scaling applied to the item.
    """

    food_class: str
    volume_ml: float
    portion_multiplier: float = 1.0
    error_pct: float = 0.0


# ---------------------------------------------------------------------------
# Confidence-range helpers (Req 4.5)
# ---------------------------------------------------------------------------


def _round(value: float) -> float:
    """Round to the display precision (Req 4.1 / 4.2)."""
    return round(value, DISPLAY_DECIMALS)


def confidence_bounds(value: float, fraction: float) -> Tuple[float, float]:
    """Lower/upper confidence bounds bracketing ``value`` (Req 4.5).

    ``fraction`` is the combined relative uncertainty (>= 0). The lower bound is
    clamped at 0 because nutrient amounts are non-negative. Rounding is
    monotonic, so ``lower <= value <= upper`` continues to hold after both the
    raw bounds and the value are rounded to the display precision.
    """
    if fraction < 0:
        fraction = 0.0
    lower_raw = max(0.0, value * (1.0 - fraction))
    upper_raw = value * (1.0 + fraction)
    return _round(lower_raw), _round(upper_raw)


# ---------------------------------------------------------------------------
# Core calculation
# ---------------------------------------------------------------------------


def _mass_grams(item: NutritionRequestItem, profile: FoodProfile) -> float:
    """Volume -> mass via the density lookup, scaled by the portion multiplier."""
    return item.volume_ml * profile.density_g_per_ml * item.portion_multiplier


def _uncertainty_fraction(item: NutritionRequestItem, nutrient_uncertainty_pct: float) -> float:
    """Combined relative uncertainty for an item's nutrient values (Req 4.5)."""
    return max(0.0, item.error_pct) / 100.0 + max(0.0, nutrient_uncertainty_pct) / 100.0


def _validate(items: List[NutritionRequestItem]) -> Optional[Err]:
    """Reject malformed requests at the boundary (validation rejection).

    Rejects unknown food classes (no density/profile -> volume->mass impossible)
    and negative volume / out-of-range portion multipliers. Prior state is
    preserved and nothing partial is produced.
    """
    for item in items:
        if item.food_class not in FOOD_DATABASE:
            return err(
                validation_rejection(
                    "UNKNOWN_FOOD_CLASS",
                    f"no reference profile for food class {item.food_class!r}; "
                    "cannot perform density lookup",
                )
            )
        if item.volume_ml < 0:
            return err(
                validation_rejection(
                    "NEGATIVE_VOLUME",
                    f"item {item.food_class!r} has negative volume {item.volume_ml}",
                )
            )
        if not (0.25 <= item.portion_multiplier <= 3.0):
            return err(
                validation_rejection(
                    "PORTION_MULTIPLIER_OUT_OF_RANGE",
                    f"item {item.food_class!r} portion multiplier "
                    f"{item.portion_multiplier} outside 0.25x-3x",
                )
            )
    return None


def _aggregate_named_nutrient(
    nutrient: str,
    items: List[NutritionRequestItem],
    masses: List[float],
    nutrient_uncertainty_pct: float,
) -> NutrientValue:
    """Aggregate one primary/secondary nutrient across all items.

    A nutrient is *available* for the meal only when every item's reference
    profile provides it (an honest total requires every component). If any item
    lacks the value the meal total cannot be calculated, so it is flagged
    unavailable (Req 4.6). An empty meal yields an available zero.

    The confidence range is the sum of the per-item bounds, which preserves the
    bracket ``lower <= value <= upper`` (Req 4.5).
    """
    unit = NUTRIENT_UNITS[nutrient]

    if not items:
        return NutrientValue(value=0.0, unit=unit, lower=0.0, upper=0.0, available=True)

    total_value = 0.0
    total_lower = 0.0
    total_upper = 0.0
    for item, mass in zip(items, masses):
        profile = FOOD_DATABASE[item.food_class]
        per_100g = profile.per_100g.get(nutrient)
        if per_100g is None:
            # Missing for at least one item -> meal total not calculable.
            return NutrientValue(
                value=0.0, unit=unit, lower=0.0, upper=0.0, available=False
            )
        item_value = per_100g * (mass / 100.0)
        lower, upper = confidence_bounds(
            item_value, _uncertainty_fraction(item, nutrient_uncertainty_pct)
        )
        total_value += item_value
        total_lower += lower
        total_upper += upper

    return NutrientValue(
        value=_round(total_value),
        unit=unit,
        lower=_round(total_lower),
        upper=_round(total_upper),
        available=True,
    )


def _aggregate_micronutrients(
    items: List[NutritionRequestItem],
    masses: List[float],
    nutrient_uncertainty_pct: float,
) -> Dict[str, NutrientValue]:
    """Aggregate every micronutrient present on any item (Req 4.3).

    Micronutrient coverage is sparse by nature, so a micronutrient is displayed
    when at least one item reports it; contributions from items that report it
    are summed. Each displayed value carries a confidence range (Req 4.5).
    """
    names: List[str] = []
    for item in items:
        for name in FOOD_DATABASE[item.food_class].micronutrients_per_100g:
            if name not in names:
                names.append(name)

    result: Dict[str, NutrientValue] = {}
    for name in names:
        total_value = 0.0
        total_lower = 0.0
        total_upper = 0.0
        unit = ""
        for item, mass in zip(items, masses):
            micro = FOOD_DATABASE[item.food_class].micronutrients_per_100g.get(name)
            if micro is None:
                continue
            per_100g, unit = micro
            item_value = per_100g * (mass / 100.0)
            lower, upper = confidence_bounds(
                item_value, _uncertainty_fraction(item, nutrient_uncertainty_pct)
            )
            total_value += item_value
            total_lower += lower
            total_upper += upper
        result[name] = NutrientValue(
            value=_round(total_value),
            unit=unit,
            lower=_round(total_lower),
            upper=_round(total_upper),
            available=True,
        )
    return result


def calculate_nutrition(
    items: Iterable[NutritionRequestItem],
    enable_micronutrient_overlay: bool = False,
    nutrient_uncertainty_pct: float = 0.0,
) -> Ok[NutritionResult] | Err:
    """Compute the nutrition breakdown for a set of recognized items.

    Performs the volume->mass density lookup, scales each item's per-100 g
    reference profile, aggregates across items, and attaches a confidence range
    to every displayed value (Req 4.5). Primary macros (Req 4.1) and secondary
    nutrients (Req 4.2) are always present, each flagged available/unavailable
    (Req 4.6). When the overlay is enabled, available micronutrients are
    returned (Req 4.3), or a "no micronutrient data available" message when none
    exist (Req 4.4).

    Returns ``Err`` (validation rejection) for unknown food classes, negative
    volumes, or out-of-range portion multipliers.
    """
    item_list = list(items)

    rejection = _validate(item_list)
    if rejection is not None:
        return rejection

    masses = [_mass_grams(it, FOOD_DATABASE[it.food_class]) for it in item_list]
    total_mass = sum(masses)

    primary = {
        nutrient: _aggregate_named_nutrient(
            nutrient, item_list, masses, nutrient_uncertainty_pct
        )
        for nutrient in PRIMARY_NUTRIENTS
    }
    secondary = {
        nutrient: _aggregate_named_nutrient(
            nutrient, item_list, masses, nutrient_uncertainty_pct
        )
        for nutrient in SECONDARY_NUTRIENTS
    }

    micronutrients: Optional[Dict[str, NutrientValue]] = None
    micronutrient_message: Optional[str] = None
    if enable_micronutrient_overlay:
        available_micro = _aggregate_micronutrients(
            item_list, masses, nutrient_uncertainty_pct
        )
        if available_micro:
            micronutrients = available_micro  # Req 4.3
        else:
            micronutrient_message = "No micronutrient data available"  # Req 4.4

    return ok(
        NutritionResult(
            primary=primary,
            secondary=secondary,
            micronutrients=micronutrients,
            micronutrient_overlay_enabled=enable_micronutrient_overlay,
            micronutrient_message=micronutrient_message,
            mass_g=_round(total_mass),
        )
    )
