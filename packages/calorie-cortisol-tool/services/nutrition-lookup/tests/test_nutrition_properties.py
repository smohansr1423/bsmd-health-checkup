"""Property-based tests for nutrition calculation (Tasks 7.2, 7.3).

These optional property tests exercise the ``POST /nutrition`` core logic in
``app.nutrition_calculation`` against the design's correctness properties:

- **Property 11: Nutrient confidence ranges bracket the value**
  (Task 7.2, Validates: Requirements 4.5)
- **Property 12: Partial nutrition availability**
  (Task 7.3, Validates: Requirements 4.1, 4.2, 4.6)

Each property runs a minimum of 100 generated iterations
(``@settings(max_examples=100)``) and is tagged in the format
``Feature: calorie-cortisol-tool, Property {number}``.

The implementation already exists (Task 7.1); these tests only observe it.
"""

from __future__ import annotations

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.nutrition_calculation import (
    FOOD_DATABASE,
    NUTRIENT_UNITS,
    PRIMARY_NUTRIENTS,
    SECONDARY_NUTRIENTS,
    NutritionRequestItem,
    calculate_nutrition,
)
from app.result import is_ok

# ---------------------------------------------------------------------------
# Shared generators
# ---------------------------------------------------------------------------

#: All food classes the reference database can price (keeps requests valid so
#: they are not rejected before a breakdown is produced).
_FOOD_CLASSES = sorted(FOOD_DATABASE.keys())

#: Food classes whose reference profile is missing at least one primary or
#: secondary nutrient -- guaranteeing the "one or more nutrients cannot be
#: calculated" precondition for Property 12.
_INCOMPLETE_FOOD_CLASSES = sorted(
    fc
    for fc, profile in FOOD_DATABASE.items()
    if any(profile.per_100g.get(n) is None for n in (*PRIMARY_NUTRIENTS, *SECONDARY_NUTRIENTS))
)


def _item_strategy(food_classes: list[str]) -> st.SearchStrategy[NutritionRequestItem]:
    """A single valid recognized item.

    Volumes and error bands span a wide but valid range; the portion multiplier
    stays inside the accepted 0.25x-3x band so the request is never rejected at
    the boundary (validation rejection is out of scope for these properties).
    """
    return st.builds(
        NutritionRequestItem,
        food_class=st.sampled_from(food_classes),
        volume_ml=st.floats(
            min_value=0.0, max_value=2000.0, allow_nan=False, allow_infinity=False
        ),
        portion_multiplier=st.floats(
            min_value=0.25, max_value=3.0, allow_nan=False, allow_infinity=False
        ),
        error_pct=st.floats(
            min_value=0.0, max_value=50.0, allow_nan=False, allow_infinity=False
        ),
    )


# ---------------------------------------------------------------------------
# Property 11: Nutrient confidence ranges bracket the value
# Feature: calorie-cortisol-tool, Property 11
# Validates: Requirements 4.5
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    items=st.lists(_item_strategy(_FOOD_CLASSES), min_size=0, max_size=6),
    enable_overlay=st.booleans(),
    nutrient_uncertainty_pct=st.floats(
        min_value=0.0, max_value=30.0, allow_nan=False, allow_infinity=False
    ),
)
def test_property_11_confidence_ranges_bracket_value(
    items: list[NutritionRequestItem],
    enable_overlay: bool,
    nutrient_uncertainty_pct: float,
) -> None:
    """Feature: calorie-cortisol-tool, Property 11.

    For any displayed nutrient value, its confidence range satisfies
    ``lower <= value <= upper`` and the bounds share the value's unit
    (Req 4.5).
    """
    result = calculate_nutrition(
        items,
        enable_micronutrient_overlay=enable_overlay,
        nutrient_uncertainty_pct=nutrient_uncertainty_pct,
    )
    assert is_ok(result)

    # (group, is_macro_nutrient) pairs. Macro/secondary nutrients have a fixed
    # unit taxonomy; micronutrient units are open-ended (e.g. 'mcg'), so we only
    # require they carry a non-empty unit string.
    displayed_groups = [
        (result.value.primary, True),
        (result.value.secondary, True),
    ]
    if result.value.micronutrients is not None:
        displayed_groups.append((result.value.micronutrients, False))

    for group, is_macro in displayed_groups:
        for name, nv in group.items():
            # Only values that are actually displayed carry a real range.
            if not nv.available:
                continue
            assert nv.lower <= nv.value <= nv.upper, (
                f"range does not bracket value for {name!r}: "
                f"{nv.lower} <= {nv.value} <= {nv.upper}"
            )
            # The value and both bounds are fields of one NutrientValue, so the
            # unit is shared by construction (Req 4.5: "same unit"). Verify the
            # unit itself is well-formed for the group.
            if is_macro:
                assert nv.unit == NUTRIENT_UNITS[name]
            else:
                assert isinstance(nv.unit, str) and nv.unit != ""


# ---------------------------------------------------------------------------
# Property 12: Partial nutrition availability
# Feature: calorie-cortisol-tool, Property 12
# Validates: Requirements 4.1, 4.2, 4.6
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    # Guarantee at least one incomplete-coverage item so the "one or more
    # nutrients cannot be calculated" precondition is reachable, mixed with any
    # other valid items.
    forced_incomplete=_item_strategy(_INCOMPLETE_FOOD_CLASSES),
    others=st.lists(_item_strategy(_FOOD_CLASSES), min_size=0, max_size=5),
    enable_overlay=st.booleans(),
)
def test_property_12_partial_nutrition_availability(
    forced_incomplete: NutritionRequestItem,
    others: list[NutritionRequestItem],
    enable_overlay: bool,
) -> None:
    """Feature: calorie-cortisol-tool, Property 12.

    For any meal where one or more nutrients cannot be calculated, each
    uncalculable nutrient is flagged unavailable and every remaining calculable
    nutrient value is still displayed (Req 4.1, 4.2, 4.6).
    """
    items = [forced_incomplete, *others]
    result = calculate_nutrition(items, enable_micronutrient_overlay=enable_overlay)
    assert is_ok(result)

    primary = result.value.primary
    secondary = result.value.secondary

    # Req 4.1 / 4.2: the full primary + secondary taxonomy is always returned,
    # so no nutrient is silently dropped -- each is either a displayed value or
    # an explicit "unavailable" flag.
    assert set(primary.keys()) == set(PRIMARY_NUTRIENTS)
    assert set(secondary.keys()) == set(SECONDARY_NUTRIENTS)

    # Precondition for this property: at least one nutrient is uncalculable.
    all_values = {**primary, **secondary}
    unavailable = {name for name, nv in all_values.items() if not nv.available}
    assume(unavailable)

    # An expected-unavailable set derived directly from database coverage: a
    # meal total is calculable only when every item provides the nutrient.
    for name, nv in all_values.items():
        any_item_missing = any(
            FOOD_DATABASE[it.food_class].per_100g.get(name) is None for it in items
        )
        if any_item_missing:
            # Req 4.6: uncalculable nutrient is flagged unavailable.
            assert nv.available is False, f"{name!r} should be flagged unavailable"
        else:
            # Req 4.6: every remaining calculable nutrient is still displayed
            # with a real, unit-tagged value. (The lower <= value <= upper
            # bracket is Property 11's concern and is asserted there.)
            assert nv.available is True, f"{name!r} should still be displayed"
            assert nv.unit == NUTRIENT_UNITS[name]

    # At least one nutrient remains calculable and displayed (a meal that loses
    # one nutrient never blanks out the rest) -- macros are present for every
    # class in the reference DB.
    displayed = {name for name, nv in all_values.items() if nv.available}
    assert displayed, "a partially-available meal must still display some values"
