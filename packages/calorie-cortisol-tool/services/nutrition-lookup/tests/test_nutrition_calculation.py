"""Unit tests for nutrition calculation (Task 7.1).

Covers the ``POST /nutrition`` core logic: primary macros + secondary nutrients
+ optional micronutrient overlay, per-value confidence ranges, per-nutrient
"unavailable" flagging, and the volume->mass density lookup.

Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
"""

from app.nutrition_calculation import (
    FOOD_DATABASE,
    PRIMARY_NUTRIENTS,
    SECONDARY_NUTRIENTS,
    NutritionRequestItem,
    calculate_nutrition,
    confidence_bounds,
)
from app.result import is_err, is_ok


def _value(result_ok, group: str, nutrient: str):
    breakdown = getattr(result_ok.value, group)
    return breakdown[nutrient]


# ---------------------------------------------------------------------------
# Primary macros + units (Req 4.1)
# ---------------------------------------------------------------------------


def test_primary_macros_present_with_correct_units() -> None:
    # 100 ml cooked rice at density 0.85 -> 85 g -> per-100g * 0.85.
    res = calculate_nutrition([NutritionRequestItem("rice_cooked", volume_ml=100.0)])
    assert is_ok(res)
    primary = res.value.primary
    assert set(primary.keys()) == set(PRIMARY_NUTRIENTS)
    assert primary["calories"].unit == "kcal"
    assert primary["protein"].unit == "g"
    assert primary["carbs"].unit == "g"
    assert primary["fat"].unit == "g"
    # 130 kcal/100g * 85 g / 100 = 110.5 kcal.
    assert primary["calories"].value == 110.5
    assert primary["calories"].available is True


def test_density_lookup_converts_volume_to_mass() -> None:
    # broccoli density 0.37 -> 200 ml = 74 g.
    res = calculate_nutrition([NutritionRequestItem("broccoli", volume_ml=200.0)])
    assert is_ok(res)
    assert res.value.mass_g == 74.0


def test_values_rounded_to_one_decimal_place() -> None:
    res = calculate_nutrition([NutritionRequestItem("chicken_breast", volume_ml=137.0)])
    assert is_ok(res)
    for nutrient in PRIMARY_NUTRIENTS:
        nv = res.value.primary[nutrient]
        assert round(nv.value, 1) == nv.value


# ---------------------------------------------------------------------------
# Secondary nutrients (Req 4.2)
# ---------------------------------------------------------------------------


def test_secondary_nutrients_present_with_units() -> None:
    res = calculate_nutrition([NutritionRequestItem("rice_cooked", volume_ml=100.0)])
    assert is_ok(res)
    secondary = res.value.secondary
    assert set(secondary.keys()) == set(SECONDARY_NUTRIENTS)
    assert secondary["fiber"].unit == "g"
    assert secondary["sodium"].unit == "mg"
    assert secondary["cholesterol"].unit == "mg"


# ---------------------------------------------------------------------------
# Confidence ranges bracket the value (Req 4.5)
# ---------------------------------------------------------------------------


def test_confidence_range_brackets_value() -> None:
    # Single-angle error band of 15% widens the range around each value.
    res = calculate_nutrition(
        [NutritionRequestItem("chicken_breast", volume_ml=150.0, error_pct=15.0)]
    )
    assert is_ok(res)
    for group in (res.value.primary, res.value.secondary):
        for nv in group.values():
            if nv.available:
                assert nv.lower <= nv.value <= nv.upper
                assert nv.unit in ("kcal", "g", "mg")


def test_zero_error_band_still_brackets_value() -> None:
    res = calculate_nutrition([NutritionRequestItem("apple", volume_ml=180.0)])
    assert is_ok(res)
    cal = res.value.primary["calories"]
    assert cal.lower <= cal.value <= cal.upper


def test_confidence_bounds_helper_clamps_lower_at_zero() -> None:
    lower, upper = confidence_bounds(10.0, 2.0)  # fraction > 1
    assert lower == 0.0
    assert upper >= 10.0


# ---------------------------------------------------------------------------
# Partial availability (Req 4.6)
# ---------------------------------------------------------------------------


def test_missing_nutrient_flagged_unavailable_others_still_present() -> None:
    # apple has no cholesterol data -> cholesterol unavailable, rest available.
    res = calculate_nutrition([NutritionRequestItem("apple", volume_ml=180.0)])
    assert is_ok(res)
    assert res.value.secondary["cholesterol"].available is False
    # Every other secondary nutrient remains calculable and displayed.
    for nutrient in SECONDARY_NUTRIENTS:
        if nutrient != "cholesterol":
            assert res.value.secondary[nutrient].available is True
    # All primary macros still available.
    for nutrient in PRIMARY_NUTRIENTS:
        assert res.value.primary[nutrient].available is True


def test_nutrient_unavailable_if_any_item_lacks_it() -> None:
    # rice has cholesterol data, apple does not -> combined meal cholesterol
    # cannot be fully calculated, so flagged unavailable (Req 4.6).
    res = calculate_nutrition(
        [
            NutritionRequestItem("rice_cooked", volume_ml=100.0),
            NutritionRequestItem("apple", volume_ml=120.0),
        ]
    )
    assert is_ok(res)
    assert res.value.secondary["cholesterol"].available is False
    # Calories are present on both, so the total is still calculable.
    assert res.value.primary["calories"].available is True


def test_house_soup_has_multiple_unavailable_secondary_nutrients() -> None:
    res = calculate_nutrition([NutritionRequestItem("house_soup", volume_ml=300.0)])
    assert is_ok(res)
    assert res.value.secondary["fiber"].available is False
    assert res.value.secondary["sugar"].available is False
    assert res.value.secondary["saturated_fat"].available is False
    assert res.value.secondary["cholesterol"].available is False
    # sodium is known -> available.
    assert res.value.secondary["sodium"].available is True
    # macros are known -> available.
    for nutrient in PRIMARY_NUTRIENTS:
        assert res.value.primary[nutrient].available is True


# ---------------------------------------------------------------------------
# Micronutrient overlay (Req 4.3 / 4.4)
# ---------------------------------------------------------------------------


def test_overlay_disabled_returns_no_micronutrients() -> None:
    res = calculate_nutrition(
        [NutritionRequestItem("broccoli", volume_ml=100.0)],
        enable_micronutrient_overlay=False,
    )
    assert is_ok(res)
    assert res.value.micronutrients is None
    assert res.value.micronutrient_message is None
    assert res.value.micronutrient_overlay_enabled is False


def test_overlay_enabled_with_available_micronutrients() -> None:
    res = calculate_nutrition(
        [NutritionRequestItem("broccoli", volume_ml=100.0)],
        enable_micronutrient_overlay=True,
    )
    assert is_ok(res)
    assert res.value.micronutrients is not None
    assert "vitamin_c" in res.value.micronutrients
    vit_c = res.value.micronutrients["vitamin_c"]
    assert vit_c.unit == "mg"
    assert vit_c.lower <= vit_c.value <= vit_c.upper
    assert res.value.micronutrient_message is None


def test_overlay_enabled_with_no_micronutrients_available() -> None:
    # house_soup has no micronutrient data.
    res = calculate_nutrition(
        [NutritionRequestItem("house_soup", volume_ml=300.0)],
        enable_micronutrient_overlay=True,
    )
    assert is_ok(res)
    assert res.value.micronutrients is None
    assert res.value.micronutrient_message == "No micronutrient data available"


# ---------------------------------------------------------------------------
# Validation rejection
# ---------------------------------------------------------------------------


def test_unknown_food_class_rejected() -> None:
    res = calculate_nutrition([NutritionRequestItem("unicorn_steak", volume_ml=100.0)])
    assert is_err(res)
    assert res.error.code == "UNKNOWN_FOOD_CLASS"
    assert res.error.retained_state is True


def test_negative_volume_rejected() -> None:
    res = calculate_nutrition([NutritionRequestItem("apple", volume_ml=-1.0)])
    assert is_err(res)
    assert res.error.code == "NEGATIVE_VOLUME"


def test_out_of_range_portion_multiplier_rejected() -> None:
    res = calculate_nutrition(
        [NutritionRequestItem("apple", volume_ml=100.0, portion_multiplier=4.0)]
    )
    assert is_err(res)
    assert res.error.code == "PORTION_MULTIPLIER_OUT_OF_RANGE"


# ---------------------------------------------------------------------------
# Empty meal
# ---------------------------------------------------------------------------


def test_empty_meal_yields_zero_available_totals() -> None:
    res = calculate_nutrition([])
    assert is_ok(res)
    assert res.value.mass_g == 0.0
    for nutrient in PRIMARY_NUTRIENTS:
        nv = res.value.primary[nutrient]
        assert nv.available is True
        assert nv.value == 0.0
        assert nv.lower == 0.0 and nv.upper == 0.0


# ---------------------------------------------------------------------------
# Multi-item aggregation
# ---------------------------------------------------------------------------


def test_multi_item_totals_sum_across_items() -> None:
    single_rice = calculate_nutrition([NutritionRequestItem("rice_cooked", 100.0)])
    single_chicken = calculate_nutrition([NutritionRequestItem("chicken_breast", 100.0)])
    combined = calculate_nutrition(
        [
            NutritionRequestItem("rice_cooked", 100.0),
            NutritionRequestItem("chicken_breast", 100.0),
        ]
    )
    assert is_ok(single_rice) and is_ok(single_chicken) and is_ok(combined)
    # The combined total sums raw contributions then rounds once, so it may
    # differ from the sum of the individually-rounded singles by a rounding
    # unit; compare with a tolerance rather than exact equality.
    expected = (
        single_rice.value.primary["calories"].value
        + single_chicken.value.primary["calories"].value
    )
    assert abs(combined.value.primary["calories"].value - expected) < 0.15


def test_reference_database_is_non_empty() -> None:
    assert len(FOOD_DATABASE) > 0
