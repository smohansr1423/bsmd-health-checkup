"""Unit tests for the offline calorie-accuracy evaluation harness (Task 6.8).

Covers the MAPE benchmark behaviour required by the design's *Accuracy
Evaluation Harness (Req 22)* section:

  * MAPE computed per capture mode, recording MAPE + mode + item count (22.3),
  * runs flagged failed iff MAPE >= threshold while retaining results (22.4),
  * non-negative calorie estimates enforced (22.5),
  * the >=500-item dataset floor (22.1/22.2).

Requirements: 22.3, 22.4, 22.5
"""

import math

import pytest

from app.accuracy_eval import (
    MAPE_THRESHOLDS,
    MIN_DATASET_SIZE,
    AccuracyRunResult,
    CaptureMode,
    ValidationItem,
    absolute_percentage_error,
    compute_mape,
    evaluate_capture_mode,
    evaluate_dataset,
    is_non_negative_estimate,
    is_run_failed,
    threshold_for,
)
from app.result import Err, Ok, is_err, is_ok


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _items(
    mode: CaptureMode,
    *,
    count: int,
    estimated: float,
    ground_truth: float,
    prefix: str = "item",
) -> list[ValidationItem]:
    """Build ``count`` uniform labelled items for ``mode``."""
    return [
        ValidationItem(
            item_id=f"{prefix}-{i}",
            capture_mode=mode,
            estimated_kcal=estimated,
            ground_truth_kcal=ground_truth,
        )
        for i in range(count)
    ]


# ---------------------------------------------------------------------------
# Pure scoring helpers
# ---------------------------------------------------------------------------


def test_threshold_for_matches_mode_bands() -> None:
    assert threshold_for(CaptureMode.SINGLE_ANGLE) == 15.0
    assert threshold_for(CaptureMode.MULTI_ANGLE) == 5.0
    assert MAPE_THRESHOLDS[CaptureMode.SINGLE_ANGLE] == 15.0
    assert MAPE_THRESHOLDS[CaptureMode.MULTI_ANGLE] == 5.0


def test_is_non_negative_estimate() -> None:
    assert is_non_negative_estimate(0.0) is True
    assert is_non_negative_estimate(123.4) is True
    assert is_non_negative_estimate(-0.01) is False


def test_absolute_percentage_error_value() -> None:
    # |110 - 100| / 100 * 100 = 10%
    assert absolute_percentage_error(110.0, 100.0) == pytest.approx(10.0)
    # A perfect estimate has zero error.
    assert absolute_percentage_error(200.0, 200.0) == 0.0


def test_absolute_percentage_error_requires_positive_ground_truth() -> None:
    with pytest.raises(ValueError):
        absolute_percentage_error(50.0, 0.0)
    with pytest.raises(ValueError):
        absolute_percentage_error(50.0, -5.0)


def test_compute_mape_averages_percentage_errors() -> None:
    items = [
        ValidationItem("a", CaptureMode.SINGLE_ANGLE, 110.0, 100.0),  # 10%
        ValidationItem("b", CaptureMode.SINGLE_ANGLE, 80.0, 100.0),   # 20%
    ]
    assert compute_mape(items) == pytest.approx(15.0)


def test_compute_mape_empty_raises() -> None:
    with pytest.raises(ValueError):
        compute_mape([])


def test_is_run_failed_boundary_is_inclusive() -> None:
    # At threshold -> failed (>=).
    assert is_run_failed(15.0, CaptureMode.SINGLE_ANGLE) is True
    # Just below -> passed.
    assert is_run_failed(14.99, CaptureMode.SINGLE_ANGLE) is False
    assert is_run_failed(5.0, CaptureMode.MULTI_ANGLE) is True
    assert is_run_failed(4.99, CaptureMode.MULTI_ANGLE) is False


# ---------------------------------------------------------------------------
# evaluate_capture_mode: passing / failing runs (Req 22.3, 22.4)
# ---------------------------------------------------------------------------


def test_passing_single_angle_run_records_mape_mode_and_count() -> None:
    # 8% error, below the 15% single-angle threshold.
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=108.0, ground_truth=100.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    assert is_ok(result)
    assert isinstance(result, Ok)
    run: AccuracyRunResult = result.value
    assert run.capture_mode == CaptureMode.SINGLE_ANGLE
    assert run.mape == pytest.approx(8.0)
    assert run.item_count == MIN_DATASET_SIZE
    assert run.threshold == 15.0
    assert run.failed is False


def test_failing_run_is_flagged_but_results_retained() -> None:
    # 20% error, at/above the 15% single-angle threshold -> failed.
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=120.0, ground_truth=100.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    # A failed run is still returned as Ok with retained recorded results.
    assert is_ok(result)
    assert isinstance(result, Ok)
    run = result.value
    assert run.failed is True
    assert run.mape == pytest.approx(20.0)
    assert run.capture_mode == CaptureMode.SINGLE_ANGLE
    assert run.item_count == MIN_DATASET_SIZE
    # The failure message identifies the capture mode and measured error.
    assert "single-angle" in run.message
    assert "20.00%" in run.message


def test_run_failed_exactly_at_threshold() -> None:
    # Multi-angle threshold is 5%; a uniform 5% error must be flagged failed.
    items = _items(CaptureMode.MULTI_ANGLE, count=MIN_DATASET_SIZE, estimated=105.0, ground_truth=100.0)
    result = evaluate_capture_mode(items, CaptureMode.MULTI_ANGLE)

    assert isinstance(result, Ok)
    assert result.value.mape == pytest.approx(5.0)
    assert result.value.failed is True


def test_multi_angle_threshold_is_stricter() -> None:
    # 8% error passes single-angle but fails multi-angle.
    single = evaluate_capture_mode(
        _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=108.0, ground_truth=100.0),
        CaptureMode.SINGLE_ANGLE,
    )
    multi = evaluate_capture_mode(
        _items(CaptureMode.MULTI_ANGLE, count=MIN_DATASET_SIZE, estimated=108.0, ground_truth=100.0),
        CaptureMode.MULTI_ANGLE,
    )
    assert isinstance(single, Ok) and single.value.failed is False
    assert isinstance(multi, Ok) and multi.value.failed is True


# ---------------------------------------------------------------------------
# evaluate_capture_mode: rejections (dataset floor, negativity, ground truth)
# ---------------------------------------------------------------------------


def test_dataset_below_minimum_is_rejected() -> None:
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE - 1, estimated=100.0, ground_truth=100.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    assert is_err(result)
    assert isinstance(result, Err)
    assert result.error.code == "DATASET_TOO_SMALL"
    # Validation rejection preserves prior state and is not retryable as-is.
    assert result.error.retained_state is True
    assert result.error.retryable is False


def test_only_matching_mode_items_count_toward_the_floor() -> None:
    # 499 single-angle items + many multi-angle items: single-angle still short.
    dataset = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE - 1, estimated=100.0, ground_truth=100.0)
    dataset += _items(
        CaptureMode.MULTI_ANGLE, count=MIN_DATASET_SIZE, estimated=100.0, ground_truth=100.0, prefix="m"
    )
    result = evaluate_capture_mode(dataset, CaptureMode.SINGLE_ANGLE)

    assert isinstance(result, Err)
    assert result.error.code == "DATASET_TOO_SMALL"


def test_negative_calorie_estimate_is_rejected() -> None:
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=100.0, ground_truth=100.0)
    # Inject one negative estimate.
    items[7] = ValidationItem("bad", CaptureMode.SINGLE_ANGLE, -1.0, 100.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    assert isinstance(result, Err)
    assert result.error.code == "NEGATIVE_CALORIE_ESTIMATE"
    assert result.error.retained_state is True


def test_zero_estimate_is_allowed() -> None:
    # 0 kcal is a valid estimate (>= 0), even though it produces 100% error.
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=0.0, ground_truth=100.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    assert isinstance(result, Ok)
    assert result.value.mape == pytest.approx(100.0)
    assert result.value.failed is True


def test_non_positive_ground_truth_is_rejected() -> None:
    items = _items(CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=100.0, ground_truth=100.0)
    items[3] = ValidationItem("gt0", CaptureMode.SINGLE_ANGLE, 100.0, 0.0)
    result = evaluate_capture_mode(items, CaptureMode.SINGLE_ANGLE)

    assert isinstance(result, Err)
    assert result.error.code == "INVALID_GROUND_TRUTH"


# ---------------------------------------------------------------------------
# evaluate_dataset: independent per-mode runs
# ---------------------------------------------------------------------------


def test_evaluate_dataset_runs_each_mode_independently() -> None:
    dataset = _items(
        CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=108.0, ground_truth=100.0
    )  # passes single-angle
    dataset += _items(
        CaptureMode.MULTI_ANGLE, count=MIN_DATASET_SIZE, estimated=108.0, ground_truth=100.0, prefix="m"
    )  # fails multi-angle

    results = evaluate_dataset(dataset)

    assert set(results.keys()) == {CaptureMode.SINGLE_ANGLE, CaptureMode.MULTI_ANGLE}
    single = results[CaptureMode.SINGLE_ANGLE]
    multi = results[CaptureMode.MULTI_ANGLE]
    assert isinstance(single, Ok) and single.value.failed is False
    assert isinstance(multi, Ok) and multi.value.failed is True


def test_evaluate_dataset_isolates_one_mode_rejection_from_another() -> None:
    # Multi-angle mode is short (rejected); single-angle is valid (recorded).
    dataset = _items(
        CaptureMode.SINGLE_ANGLE, count=MIN_DATASET_SIZE, estimated=100.0, ground_truth=100.0
    )
    dataset += _items(
        CaptureMode.MULTI_ANGLE, count=10, estimated=100.0, ground_truth=100.0, prefix="m"
    )

    results = evaluate_dataset(dataset)

    assert isinstance(results[CaptureMode.SINGLE_ANGLE], Ok)
    assert isinstance(results[CaptureMode.MULTI_ANGLE], Err)
    assert results[CaptureMode.MULTI_ANGLE].error.code == "DATASET_TOO_SMALL"


def test_perfect_estimates_yield_zero_mape() -> None:
    items = _items(CaptureMode.MULTI_ANGLE, count=MIN_DATASET_SIZE, estimated=250.0, ground_truth=250.0)
    result = evaluate_capture_mode(items, CaptureMode.MULTI_ANGLE)

    assert isinstance(result, Ok)
    assert math.isclose(result.value.mape, 0.0)
    assert result.value.failed is False
