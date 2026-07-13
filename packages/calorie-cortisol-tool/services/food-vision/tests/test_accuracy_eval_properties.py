"""Property-based tests for the accuracy-evaluation harness (Task 6.9).

Implements one design correctness property for the Food Vision Service's
offline MAPE benchmark using Hypothesis (>=100 generated examples):

  * Property 60: Calorie estimate non-negativity and accuracy-run
                 classification (Validates: Requirements 22.3, 22.4, 22.5)

Unit-level examples for this area live in ``test_accuracy_eval.py``; this test
asserts the universal property holds across randomly generated datasets.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.accuracy_eval import (
    CaptureMode,
    ValidationItem,
    compute_mape,
    is_non_negative_estimate,
    threshold_for,
    evaluate_capture_mode,
)
from app.result import Ok, is_ok

# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------

capture_modes = st.sampled_from(list(CaptureMode))

# Non-negative calorie estimates (Req 22.5) and strictly positive ground truth
# (percentage error is undefined at zero ground truth).
estimated_kcal = st.floats(
    min_value=0.0, max_value=5000.0, allow_nan=False, allow_infinity=False
)
ground_truth_kcal = st.floats(
    min_value=1.0, max_value=5000.0, allow_nan=False, allow_infinity=False
)


@st.composite
def datasets(draw: st.DrawFn) -> tuple[CaptureMode, list[ValidationItem]]:
    """A single-mode dataset of labelled items with valid, non-negative data."""
    mode = draw(capture_modes)
    pairs = draw(
        st.lists(st.tuples(estimated_kcal, ground_truth_kcal), min_size=1, max_size=40)
    )
    items = [
        ValidationItem(
            item_id=f"item-{i}",
            capture_mode=mode,
            estimated_kcal=est,
            ground_truth_kcal=gt,
        )
        for i, (est, gt) in enumerate(pairs)
    ]
    return mode, items


# ---------------------------------------------------------------------------
# Property 60: Calorie estimate non-negativity and accuracy-run classification
# Feature: calorie-cortisol-tool, Property 60
# Validates: Requirements 22.3, 22.4, 22.5
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(data=datasets())
def test_property_60_non_negativity_and_run_classification(
    data: tuple[CaptureMode, list[ValidationItem]],
) -> None:
    """For any returned single calorie estimate the value is a number >= 0 kcal;
    and for any completed accuracy evaluation run, the run is flagged failed if
    and only if the measured MAPE is at or above the applicable threshold (15%
    single-angle, 5% multi-angle), with MAPE, capture mode, and item count
    recorded.

    Feature: calorie-cortisol-tool, Property 60
    Validates: Requirements 22.3, 22.4, 22.5
    """
    mode, items = data

    # Every generated estimate is a non-negative kcal value (Req 22.5), and the
    # non-negativity predicate agrees with the numeric fact.
    for it in items:
        assert it.estimated_kcal >= 0.0
        assert is_non_negative_estimate(it.estimated_kcal) is True

    # Use a floor of 1 so the classification property is exercised without
    # needing a 500-item dataset (the floor itself is covered by unit tests).
    result = evaluate_capture_mode(items, mode, min_dataset_size=1)
    assert is_ok(result)
    assert isinstance(result, Ok)
    run = result.value

    threshold = threshold_for(mode)
    expected_mape = compute_mape(items)

    # MAPE, capture mode, and item count are recorded (Req 22.3).
    assert run.capture_mode == mode
    assert run.item_count == len(items)
    assert run.mape == expected_mape
    assert run.threshold == threshold

    # Failed iff measured MAPE is at/above the applicable threshold (Req 22.4).
    assert run.failed is (run.mape >= threshold)
