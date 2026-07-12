"""Unit tests for the shared Python guard helpers (mirror of guards.test.ts)."""

from cc_contracts import guards
from cc_contracts.domain import (
    CorrelationResult,
    FamilyAccount,
    FoodItem,
    MemberProfile,
    NutrientValue,
)


def test_confidence_boundaries() -> None:
    assert guards.is_valid_confidence(0)
    assert guards.is_valid_confidence(100)
    assert not guards.is_valid_confidence(-1)
    assert not guards.is_valid_confidence(101)


def test_food_item_validation() -> None:
    assert guards.is_valid_food_item(FoodItem(id="f1", label="apple", confidence=88))
    assert not guards.is_valid_food_item(FoodItem(id="f1", label="", confidence=88))
    assert not guards.is_valid_food_item(FoodItem(id="f1", label="a", confidence=120))


def test_nutrient_value_bracket() -> None:
    assert guards.is_valid_nutrient_value(
        NutrientValue(value=100, unit="kcal", lower=90, upper=110, available=True)
    )
    assert not guards.is_valid_nutrient_value(
        NutrientValue(value=100, unit="kcal", lower=101, upper=110, available=True)
    )


def test_portion_multiplier_grid() -> None:
    for m in (0.25, 0.5, 1.0, 1.75, 3.0):
        assert guards.is_valid_portion_multiplier(m)
    for m in (0.0, 0.1, 0.3, 3.25):
        assert not guards.is_valid_portion_multiplier(m)


def test_reading_value_boundaries() -> None:
    assert guards.is_valid_reading_value(0.01)
    assert guards.is_valid_reading_value(100.0)
    assert not guards.is_valid_reading_value(0.0)
    assert not guards.is_valid_reading_value(100.01)


def test_questionnaire_completeness_and_score() -> None:
    assert guards.is_questionnaire_complete("PSS-10", [1] * 10)
    assert not guards.is_questionnaire_complete("PSS-10", [1] * 9)
    assert guards.is_valid_questionnaire_score("GAD-7", 21)
    assert not guards.is_valid_questionnaire_score("GAD-7", 22)


def test_significance_gate() -> None:
    base = CorrelationResult(coefficient=0.6, p_value=0.01, pair_count=20, significant=True)
    assert guards.meets_significance_gate(base)
    assert not guards.meets_significance_gate(
        CorrelationResult(coefficient=0.6, p_value=0.01, pair_count=19, significant=True)
    )


def test_family_capacity() -> None:
    members = [MemberProfile(id=f"m{i}", role="member") for i in range(5)]
    assert guards.is_within_family_capacity(
        FamilyAccount(id="fam", admin_user_id="a", members=members)
    )
    assert not guards.is_within_family_capacity(
        FamilyAccount(
            id="fam",
            admin_user_id="a",
            members=members + [MemberProfile(id="m5", role="member")],
        )
    )


def test_wake_time() -> None:
    assert guards.is_valid_wake_time("00:00")
    assert guards.is_valid_wake_time("23:59")
    assert not guards.is_valid_wake_time("24:00")
    assert not guards.is_valid_wake_time("7:30")
